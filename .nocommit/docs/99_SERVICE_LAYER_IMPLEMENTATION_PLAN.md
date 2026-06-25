# Release Tracks Service Layer — Comprehensive Implementation Plan

> **Purpose**: Cross-session handoff document. Each phase is self-contained with enough
> context for a new Claude session to pick up implementation without re-reading the full
> codebase. Update the **Status** markers as phases are completed.

---

## Status Tracker

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Snapshot Service + Track CRUD + Facade wiring | **DONE** |
| 2 | Standard Track Service (Candidates + Staged) | TODO |
| 3 | Workflow Service (Auto-promotion) | TODO |
| 4 | Versioning Service (Bump/Tag/Preview) | TODO |
| 5 | Virtual Track Service (Composition/Dedup) | TODO |
| 6 | Export Service + Ephemeral Service | TODO (deferred) |

---

## Architecture

```
Controller (Zod validation, app/controllers/release-tracks-controller.js)
    └─▶ release-tracks-service.js  (Facade — delegates only, zero business logic)
            ├─▶ snapshot-service.js          Phase 1  Snapshot CRUD, clone, metadata/contents
            ├─▶ standard-track-service.js    Phase 2  Candidate/staged/member tier management
            ├─▶ workflow-service.js           Phase 3  Auto-promotion, candidacy threshold
            ├─▶ versioning-service.js         Phase 4  Bump/tag, version history, preview
            ├─▶ virtual-track-service.js      Phase 5  Composition resolution, deduplication
            ├─▶ export-service.js             Phase 6  bundle/workbench/filesystemstore (deferred)
            └─▶ ephemeral-service.js          Phase 6  Stateless domain bundles (deferred)

All sub-services import these singletons:
    registryRepo   ← app/repository/release-tracks/release-track-registry.repository.js
    dynamicRepo    ← app/repository/release-tracks/release-track-dynamic.repository.js
    modelFactory   ← app/models/release-tracks/model-factory.js
```

### Sub-service dependency graph

```
snapshot-service          (no sub-service deps)
standard-track-service    (imports snapshot-service for cloneSnapshot)
workflow-service          (imports standard-track-service for tier mutations)
versioning-service        (imports snapshot-service, workflow-service)
virtual-track-service     (imports snapshot-service for component reads)
export-service            (no sub-service deps; cross-reads STIX repos) [deferred]
ephemeral-service         (no sub-service deps; cross-reads STIX repos) [deferred]
```

---

## Design Decisions (settled)

| Decision | Choice | Rationale |
|---|---|---|
| Module style | Functional `exports.method` (not class) | Matches existing facade + collection-bundles-service pattern |
| `modified: "latest"` resolution in addCandidates | Implement now | Build lightweight object-resolver that queries STIX repos via existing service-map (like import-bundle.js) |
| Bump/tag compound update | Extend `tagSnapshotInPlace` in dynamic repo | Add optional `additionalUpdateOps` param so staged→members promotion is atomic with version set |
| Config get/update | Inline in snapshot-service | Too simple for a separate file |
| Snapshot immutability | All mutations clone → new snapshot (new `modified`) | Exception: tagging is the ONLY in-place update |

---

## Key Reference Files

| File | Role |
|---|---|
| `app/services/release-tracks/release-tracks-service.js` | Facade (31 stub methods to wire) |
| `app/controllers/release-tracks-controller.js` | Defines exact call signatures the facade must satisfy |
| `app/repository/release-tracks/release-track-registry.repository.js` | Registry CRUD: `create`, `findByTrackId`, `findAll`, `updateByTrackId`, `deleteByTrackId` |
| `app/repository/release-tracks/release-track-dynamic.repository.js` | Snapshot CRUD: `getLatestSnapshot`, `getSnapshotByModified`, `getLatestTaggedSnapshot`, `getSnapshotByVersion`, `getAllSnapshots`, `saveSnapshot`, `tagSnapshotInPlace`, `updateSnapshot`, `deleteSnapshot`, `deleteAllSnapshots`, `dropCollection` |
| `app/models/release-tracks/model-factory.js` | `getModel`, `removeModel`, `ensureIndexes` |
| `app/models/release-tracks/release-track-snapshot-schema.js` | Mongoose schema: members, staged, candidates, quarantine, composition, config, version_history |
| `app/models/release-tracks/release-track-registry-model.js` | Registry schema: track_id, type, name, description, counters, schedule |
| `app/lib/release-tracks/release-track-schemas.js` | All Zod schemas (controller validation + domain types) |
| `app/lib/release-tracks/release-track-validators.js` | Mongoose custom validators wrapping Zod |
| `app/exceptions/index.js` | All exception classes (AlreadyReleasedError, InvalidVersionError, ReleaseConflictError, etc.) |
| `app/services/stix/collection-bundles-service/import-bundle.js` | Reference for cross-service STIX object resolution (serviceMap pattern) |

---

## Shared Lib Utilities

### `app/lib/release-tracks/version-utils.js` (Phase 4)

```js
exports.parseVersion = (str) => { major, minor }
exports.compareVersions = (a, b) => -1 | 0 | 1
exports.calculateNextVersion = (versionHistory, bumpType, explicitVersion) => string
exports.validateVersionProgression = (newVersion, versionHistory) => void | throw InvalidVersionError
```

### `app/lib/release-tracks/conflict-resolution.js` (Phase 2)

```js
exports.applyConflictPolicy = (existingTier, incomingEntries, policy) => { merged, rejected }
// policy: 'always_overwrite' | 'always_reject' | 'prefer_latest' | 'abort'
// 'abort' throws ReleaseConflictError if any conflict exists
// Conflict = same object_ref but different object_modified in target tier
```

### `app/lib/release-tracks/deduplication-strategies.js` (Phase 5)

```js
exports.deduplicate = (allMembers, strategy, componentMeta) => { members, quarantined, report }
// strategy: 'prioritize_latest_object' | 'prioritize_latest_snapshot' | 'prioritize_higher_priority' | 'quarantine'
```

### `app/lib/release-tracks/object-resolver.js` (Phase 2)

```js
exports.resolveLatestModified = async (objectRef) => Date
// Uses STIX service-map to find the latest version of an object by its STIX ID.
// Similar pattern to import-bundle.js serviceMap.
```

---

## Phase 1: Snapshot Service + Track CRUD

### Scope

Implement `snapshot-service.js` and wire the facade for: track listing, creation, retrieval,
metadata/contents updates, cloning, and deletion.

### New file: `app/services/release-tracks/snapshot-service.js`

**Dependencies**: `registryRepo`, `dynamicRepo`, `modelFactory`, `uuid` (npm), `logger`, exceptions

#### Method specifications

##### `createTrack(data)` → snapshot
- Generate `trackId = 'release-track--' + uuid.v4()`
- `now = new Date()`
- Build initial snapshot document:
  ```
  { id: trackId, type: data.type, modified: now, version: null,
    name: data.name, description: data.description || '',
    created: now, created_by_ref: data.userAccountId,
    object_marking_refs: data.object_marking_refs,
    members: [],
    staged: data.type === 'standard' ? [] : undefined,
    candidates: data.type === 'standard' ? [] : undefined,
    quarantine: data.type === 'virtual' ? [] : undefined,
    composition: data.type === 'virtual' ? data.composition : undefined,
    config: {}, version_history: [] }
  ```
- `await modelFactory.ensureIndexes(trackId)`
- `snapshot = await dynamicRepo.saveSnapshot(trackId, initialSnapshot)`
- Create registry entry:
  ```
  await registryRepo.create({
    track_id: trackId, type: data.type, name: data.name,
    description: data.description,
    latest_snapshot_modified: now, snapshot_count: 1,
    tagged_release_count: 0, created_at: now, updated_at: now,
    snapshot_schedule: data.type === 'virtual' ? data.snapshot_schedule : undefined })
  ```
- Return snapshot

##### `listTracks(options)` → `{ data, pagination }`
- Delegate to `registryRepo.findAll(options)`
- `options`: `{ type?, search?, limit?, offset? }`

##### `getLatestSnapshot(trackId, _options)` → snapshot
- `snapshot = await dynamicRepo.getLatestSnapshot(trackId)`
- If null, throw `TrackNotFoundError(trackId)`
- (Phase 6 will use `_options.format` for export formatting; for now, return raw snapshot)
- Return snapshot

##### `getSnapshotByModified(trackId, modified, _options)` → snapshot
- `snapshot = await dynamicRepo.getSnapshotByModified(trackId, modified)`
- If null, throw `NotFoundError({ details: '...' })`
- Return snapshot

##### `cloneSnapshot(trackId, sourceSnapshot, overrides)` → snapshot (internal helper)
- Deep-clone: `const clone = JSON.parse(JSON.stringify(sourceSnapshot))`
- Remove Mongoose metadata: `delete clone._id; delete clone.__v`
- Set `clone.modified = new Date()`
- Set `clone.version = null` (clones are always drafts)
- Apply overrides: merge `overrides` into clone (name, description, etc.)
- `saved = await dynamicRepo.saveSnapshot(trackId, clone)`
- Update registry: `await registryRepo.updateByTrackId(trackId, { latest_snapshot_modified: clone.modified, updated_at: new Date(), $inc-equivalent... })`
  - Note: registryRepo.updateByTrackId uses `$set` not `$inc`. Compute new count: call `syncRegistryCounters(trackId)` or pass computed values.
- Return saved

##### `cloneTrack(trackId, options)` → snapshot
- Load source: `source = await getLatestSnapshot(trackId)`
- Generate new track ID: `newTrackId = 'release-track--' + uuid.v4()`
- `now = new Date()`
- Clone snapshot for new track:
  ```
  const clone = JSON.parse(JSON.stringify(source))
  delete clone._id; delete clone.__v
  clone.id = newTrackId
  clone.modified = now
  clone.version = null
  clone.name = options.name || source.name + ' (copy)'
  clone.created = now
  clone.created_by_ref = options.userAccountId
  clone.version_history = []
  ```
- `await modelFactory.ensureIndexes(newTrackId)`
- `saved = await dynamicRepo.saveSnapshot(newTrackId, clone)`
- Create registry entry for new track
- Return saved

##### `cloneFromSnapshot(trackId, modified, options)` → snapshot
- Same as `cloneTrack` but source = `getSnapshotByModified(trackId, modified)`

##### `updateMetadata(trackId, updates, _userId)` → snapshot
- `source = await getLatestSnapshot(trackId)`
- Build overrides from `updates`: only `{ name?, description?, object_marking_refs? }`
- Return `cloneSnapshot(trackId, source, overrides)`

##### `updateMetadataByModified(trackId, modified, updates, _userId)` → snapshot
- `source = await getSnapshotByModified(trackId, modified)`
- Same as above

##### `updateContents(trackId, contents, _userId)` → snapshot
- `source = await getLatestSnapshot(trackId)`
- Map `contents.x_mitre_contents` to member entries:
  ```
  const members = contents.x_mitre_contents.map(c => ({
    object_ref: c.obj_ref,
    object_modified: new Date(c.obj_modified)
  }))
  ```
- Return `cloneSnapshot(trackId, source, { members })`

##### `updateContentsByModified(trackId, modified, contents, _userId)` → snapshot
- Same but from specific snapshot

##### `getConfig(trackId)` → config
- `snapshot = await getLatestSnapshot(trackId)`
- Return `snapshot.config`

##### `updateConfig(trackId, config, _userId)` → snapshot
- `source = await getLatestSnapshot(trackId)`
- Merge config: `const mergedConfig = { ...source.config, ...config }`
- Handle nested `promotion_conflicts`: `mergedConfig.promotion_conflicts = { ...source.config?.promotion_conflicts, ...config.promotion_conflicts }`
- Return `cloneSnapshot(trackId, source, { config: mergedConfig })`

##### `deleteTrack(trackId)` → void
- Verify exists: `registry = await registryRepo.findByTrackId(trackId)`
- If null, throw `TrackNotFoundError(trackId)`
- `await dynamicRepo.dropCollection(trackId)` (also cleans up model cache)
- `await registryRepo.deleteByTrackId(trackId)`

##### `deleteSnapshot(trackId, modified)` → void
- Verify snapshot exists: `snapshot = await dynamicRepo.getSnapshotByModified(trackId, modified)`
- If null, throw `NotFoundError`
- `await dynamicRepo.deleteSnapshot(trackId, modified)`
- `await syncRegistryCounters(trackId)`

##### `syncRegistryCounters(trackId)` → void (internal)
- `all = await dynamicRepo.getAllSnapshots(trackId, { projection: 'modified version' })`
- Compute: `snapshot_count`, `tagged_release_count`, `latest_snapshot_modified`, `latest_tagged_version`
- `await registryRepo.updateByTrackId(trackId, { ...computed, updated_at: new Date() })`

### Facade wiring (Phase 1)

Replace these stubs in `release-tracks-service.js`:

```js
const snapshotService = require('./snapshot-service');

exports.listTracks = (options) => snapshotService.listTracks(options);
exports.createTrack = (data) => snapshotService.createTrack(data);
exports.getLatestSnapshot = (trackId, options) => snapshotService.getLatestSnapshot(trackId, options);
exports.getSnapshotByModified = (trackId, modified, options) => snapshotService.getSnapshotByModified(trackId, modified, options);
exports.updateMetadata = (trackId, updates, userId) => snapshotService.updateMetadata(trackId, updates, userId);
exports.updateMetadataByModified = (trackId, modified, updates, userId) => snapshotService.updateMetadataByModified(trackId, modified, updates, userId);
exports.updateContents = (trackId, contents, userId) => snapshotService.updateContents(trackId, contents, userId);
exports.updateContentsByModified = (trackId, modified, contents, userId) => snapshotService.updateContentsByModified(trackId, modified, contents, userId);
exports.cloneTrack = (trackId, options) => snapshotService.cloneTrack(trackId, options);
exports.cloneFromSnapshot = (trackId, modified, options) => snapshotService.cloneFromSnapshot(trackId, modified, options);
exports.deleteTrack = (trackId) => snapshotService.deleteTrack(trackId);
exports.deleteSnapshot = (trackId, modified) => snapshotService.deleteSnapshot(trackId, modified);
exports.getConfig = (trackId) => snapshotService.getConfig(trackId);
exports.updateConfig = (trackId, config, userId) => snapshotService.updateConfig(trackId, config, userId);
```

Methods that remain as `NotImplementedError` after Phase 1:
- `createTrackFromBundle`, `importTrack`, `getEphemeralBundle`
- All candidate/staged/versioning/virtual methods (Phases 2-5)

### Verification (Phase 1)

```bash
# Run existing tests (should not break)
npm test

# Manual verification via curl (requires running server):
# 1. Create standard track
curl -X POST http://localhost:3000/api/release-tracks/new \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Track","type":"standard"}'

# 2. List tracks
curl http://localhost:3000/api/release-tracks

# 3. Get latest snapshot (use track ID from step 1)
curl http://localhost:3000/api/release-tracks/<track-id>

# 4. Update metadata
curl -X POST http://localhost:3000/api/release-tracks/<track-id>/meta \
  -d '{"name":"Renamed Track"}'

# 5. Clone track
curl -X POST http://localhost:3000/api/release-tracks/<track-id>/clone

# 6. Delete track
curl -X DELETE http://localhost:3000/api/release-tracks/<track-id>
```

---

## Phase 2: Standard Track Service (Candidates + Staged)

### Prerequisites
- Phase 1 complete
- Create `app/lib/release-tracks/conflict-resolution.js`
- Create `app/lib/release-tracks/object-resolver.js`

### New file: `app/services/release-tracks/standard-track-service.js`

**Dependencies**: `dynamicRepo`, `snapshotService` (for `cloneSnapshot`, `getLatestSnapshot`), `objectResolver`, `conflictResolution`, `logger`, exceptions

#### Method specifications

##### `addCandidates(trackId, objectRefs, userId)` → snapshot
- `source = await snapshotService.getLatestSnapshot(trackId)`
- Validate track type is 'standard'
- `now = new Date()`
- For each ref in `objectRefs`:
  - Normalize: if string, convert to `{ id: ref, modified: undefined }`
  - If `modified` is `'latest'` or undefined: `modified = await objectResolver.resolveLatestModified(entry.id)`
  - Else: parse as Date
  - Validate no duplicate in `source.candidates` (same `object_ref` + `object_modified`)
  - Build: `{ object_ref: entry.id, object_modified: modified, object_status: 'work-in-progress', object_added_at: now, object_added_by: userId }`
- Clone snapshot with `candidates = [...source.candidates, ...newEntries]`
- Return via `snapshotService.cloneSnapshot(trackId, source, { candidates: merged })`

##### `listCandidates(trackId, options)` → `{ candidates }`
- Load latest snapshot
- Filter `snapshot.candidates` by `options.status` if provided
- Return filtered candidates

##### `removeCandidate(trackId, objectRef)` → void
- Load latest snapshot
- Find candidate(s) where `object_ref === objectRef`
- If none found, throw `NotFoundError`
- Clone snapshot with those candidates removed

##### `reviewCandidates(trackId, reviewData, userId)` → snapshot
- `reviewData = { from, to, object_refs? }`
- Validate `from` < `to` (forward-only: wip→awaiting→reviewed)
- Load latest snapshot
- Find matching candidates: status === `from`, optionally filtered to `object_refs`
- Update their `object_status` to `to`
- Clone snapshot with updated candidates
- If `source.config.auto_promote === true`, call `workflowService.evaluateAutoPromotion(trackId, newSnapshot)` (Phase 3; for now, skip auto-promotion)
- Return snapshot

##### `promoteCandidates(trackId, objectRefs, userId)` → snapshot
- Load latest snapshot
- Find candidates matching `objectRefs`
- Build staged entries: `{ object_ref, object_modified, object_status, object_staged_at: now, object_staged_by: userId }`
- Apply `config.promotion_conflicts.candidates_to_staged` policy via `conflictResolution.applyConflictPolicy(source.staged, newStagedEntries, policy)`
- Clone snapshot: remove promoted from candidates, add to staged
- Return snapshot

##### `updateCandidateVersion(trackId, objectRef, data)` → snapshot
- `data = { old_modified, new_modified }`
- Load latest snapshot
- Find candidate where `object_ref === objectRef` and `object_modified === data.old_modified`
- If not found, throw `NotFoundError`
- Update `object_modified` to `data.new_modified`
- Clone snapshot

##### `listStaged(trackId)` → `{ staged }`
- Load latest snapshot, return `snapshot.staged`

##### `demoteStaged(trackId, objectRefs, userId)` → snapshot
- `objectRefs = [{ id, modified }]`
- Load latest snapshot
- For each ref: find in staged tier, remove, create candidate entry preserving `object_status`
- Clone snapshot with updated staged/candidates

##### `listObjectVersions(trackId, objectRef)` → versions
- Load latest snapshot
- Search all tiers (members, staged, candidates) for `object_ref === objectRef`
- Return `[{ tier: 'members'|'staged'|'candidates', object_modified, object_status? }]`

### `app/lib/release-tracks/object-resolver.js`

```js
// Pattern from import-bundle.js serviceMap
const types = require('../../lib/types');
const serviceMap = { /* same mapping as import-bundle.js */ };

exports.resolveLatestModified = async function(objectRef) {
  const type = objectRef.split('--')[0];
  const service = serviceMap[type];
  if (!service) throw new BadRequestError({ message: `Unknown object type: ${type}` });
  // Use service.retrieveById or equivalent to get all versions, pick latest modified
  const result = await service.retrieveById(objectRef, { versions: 'all' });
  if (!result || result.length === 0) throw new NotFoundError({ details: `Object ${objectRef} not found` });
  // Return the most recent modified timestamp
  return new Date(result[0].stix.modified); // assuming sorted desc
};
```

### `app/lib/release-tracks/conflict-resolution.js`

```js
const { ReleaseConflictError } = require('../../exceptions');

exports.applyConflictPolicy = function(existingTier, incomingEntries, policy) {
  const merged = [...existingTier];
  const rejected = [];

  for (const incoming of incomingEntries) {
    const conflictIdx = merged.findIndex(e => e.object_ref === incoming.object_ref);
    if (conflictIdx === -1) {
      merged.push(incoming);  // No conflict
      continue;
    }

    const incumbent = merged[conflictIdx];
    switch (policy) {
      case 'always_overwrite': merged[conflictIdx] = incoming; break;
      case 'always_reject':    rejected.push(incoming); break;
      case 'prefer_latest':
        if (new Date(incoming.object_modified) > new Date(incumbent.object_modified)) {
          merged[conflictIdx] = incoming;
        } else {
          rejected.push(incoming);
        }
        break;
      case 'abort':
        throw new ReleaseConflictError(`Conflict on ${incoming.object_ref}: abort policy`);
    }
  }
  return { merged, rejected };
};
```

### Facade wiring (Phase 2)

```js
const standardTrackService = require('./standard-track-service');

exports.addCandidates = (trackId, objectRefs, userId) => standardTrackService.addCandidates(trackId, objectRefs, userId);
exports.listCandidates = (trackId, options) => standardTrackService.listCandidates(trackId, options);
exports.removeCandidate = (trackId, objectRef) => standardTrackService.removeCandidate(trackId, objectRef);
exports.reviewCandidates = (trackId, reviewData, userId) => standardTrackService.reviewCandidates(trackId, reviewData, userId);
exports.promoteCandidates = (trackId, objectRefs, userId) => standardTrackService.promoteCandidates(trackId, objectRefs, userId);
exports.updateCandidateVersion = (trackId, objectRef, data) => standardTrackService.updateCandidateVersion(trackId, objectRef, data);
exports.listStaged = (trackId) => standardTrackService.listStaged(trackId);
exports.demoteStaged = (trackId, objectRefs, userId) => standardTrackService.demoteStaged(trackId, objectRefs, userId);
exports.listObjectVersions = (trackId, objectRef) => standardTrackService.listObjectVersions(trackId, objectRef);
```

---

## Phase 3: Workflow Service

### New file: `app/services/release-tracks/workflow-service.js`

```js
const STATUS_RANK = { 'work-in-progress': 0, 'awaiting-review': 1, 'reviewed': 2 };

exports.meetsThreshold = (status, threshold) => STATUS_RANK[status] >= STATUS_RANK[threshold];

exports.evaluateAutoPromotion = async function(trackId, snapshot) {
  if (!snapshot.config.auto_promote) return null;
  const threshold = snapshot.config.candidacy_threshold || 'reviewed';
  const qualifying = snapshot.candidates.filter(c => exports.meetsThreshold(c.object_status, threshold));
  if (qualifying.length === 0) return null;

  // Promote qualifying candidates to staged
  // Uses standardTrackService internally or does inline tier mutation + clone
  // ... (detailed implementation in Phase 3)
};
```

### Integration point

`standard-track-service.reviewCandidates` calls `workflowService.evaluateAutoPromotion` after status update.

---

## Phase 4: Versioning Service

### Prerequisites
- Create `app/lib/release-tracks/version-utils.js`
- Extend `dynamicRepo.tagSnapshotInPlace` to accept `additionalUpdateOps`

### Repository change: `release-track-dynamic.repository.js`

Extend `tagSnapshotInPlace(trackId, modified, versionData)`:
```js
// Current: only $set version + $push version_history
// Extended: accept versionData.additionalOps = { members: [...], staged: [], ... }
// Merge into the atomic findOneAndUpdate call
```

### New file: `app/lib/release-tracks/version-utils.js`

```js
exports.parseVersion = (str) => {
  const [major, minor] = str.split('.').map(Number);
  return { major, minor };
};

exports.calculateNextVersion = (versionHistory, bumpType, explicitVersion) => {
  if (explicitVersion) {
    // Validate > all existing versions
    return explicitVersion;
  }
  if (versionHistory.length === 0) return '1.0';
  const latest = versionHistory[versionHistory.length - 1].version;
  const { major, minor } = exports.parseVersion(latest);
  return bumpType === 'major' ? `${major + 1}.0` : `${major}.${minor + 1}`;
};
```

### New file: `app/services/release-tracks/versioning-service.js`

##### `bumpLatest(trackId, options)` → snapshot
- Load latest snapshot
- Validate `snapshot.version === null` → else throw `AlreadyReleasedError(snapshot.version)`
- Calculate version: `versionUtils.calculateNextVersion(snapshot.version_history, options.type, options.version)`
- Validate monotonic: `versionUtils.validateVersionProgression(version, snapshot.version_history)`
- Promote staged → members: `conflictResolution.applyConflictPolicy(snapshot.members, stagedAsMembers, config.promotion_conflicts.staged_to_members)`
- Build `versionHistoryEntry = { version, tagged_at: now, tagged_by: options.userAccountId, snapshot_id: snapshot.modified, summary: { members_count, promoted_count, staged_count, candidate_count } }`
- If `options.dry_run`, return preview object without persisting
- Call extended `dynamicRepo.tagSnapshotInPlace(trackId, snapshot.modified, { version, versionHistoryEntry, additionalOps: { members: merged, staged: [] } })`
- Update registry: `latest_tagged_version`, increment `tagged_release_count`
- Return updated snapshot

##### `bumpByModified(trackId, modified, options)` → snapshot
- Same as above but loads specific snapshot

##### `previewBump(trackId, _format)` → preview
- Load latest snapshot, compute version + staged→members diff, return structured preview

### Facade wiring (Phase 4)

```js
const versioningService = require('./versioning-service');
exports.bumpLatest = (trackId, options) => versioningService.bumpLatest(trackId, options);
exports.bumpByModified = (trackId, modified, options) => versioningService.bumpByModified(trackId, modified, options);
exports.previewBump = (trackId, format) => versioningService.previewBump(trackId, format);
```

---

## Phase 5: Virtual Track Service

### Prerequisites
- Create `app/lib/release-tracks/deduplication-strategies.js`

### New file: `app/lib/release-tracks/deduplication-strategies.js`

```js
exports.deduplicate = function(allMembers, strategy, componentMeta) {
  // allMembers = [{ object_ref, object_modified, _source_track_id, _source_priority }]
  // Group by object_ref, resolve duplicates per strategy
  // Returns { members: [], quarantined: [], report: { before, after, duplicates, conflicts } }
};
```

### New file: `app/services/release-tracks/virtual-track-service.js`

##### `updateComposition(trackId, composition, userId)` → snapshot
- Validate track is virtual type
- Validate all component tracks exist and are standard (not virtual → throw `InvalidComponentTypeError`)
- Validate no duplicate track_ids in component list
- Load latest snapshot, clone with updated `composition`

##### `createVirtualSnapshot(trackId, options)` → snapshot
- Load latest snapshot, read `composition`
- For each component: resolve snapshot via strategy (latest_tagged / specific_version / specific_snapshot)
- Validate resolved snapshot is tagged (throw `NoTaggedSnapshotsError` if not)
- Extract members, apply filters (object_types, domains)
- Deduplicate across all components
- Build `composition_resolution` metadata
- Save new snapshot with resolved members + quarantine + resolution metadata

##### `previewVirtualSnapshot(trackId)` → preview
- Same as above but return preview without saving

### Facade wiring (Phase 5)

```js
const virtualTrackService = require('./virtual-track-service');
exports.updateComposition = (...) => virtualTrackService.updateComposition(...);
exports.createVirtualSnapshot = (...) => virtualTrackService.createVirtualSnapshot(...);
exports.previewVirtualSnapshot = (...) => virtualTrackService.previewVirtualSnapshot(...);
```

---

## Phase 6: Export + Ephemeral (Deferred)

| Item | Reason for deferral |
|---|---|
| `export-service.js` | Requires cross-service reads to hydrate STIX object refs into full objects |
| `ephemeral-service.js` | Requires querying all STIX repos by domain; orthogonal to core |
| `createTrackFromBundle` | Requires STIX bundle parsing via existing collection-bundles infra |
| `importTrack` | Already returns NotImplementedError in controller |
| Format-aware snapshot retrieval | `queryOptions.format` param ignored until export-service exists |

---

## All Files Created/Modified (Complete)

| File | Phase | Action |
|---|---|---|
| `app/services/release-tracks/snapshot-service.js` | 1 | **Create** |
| `app/services/release-tracks/release-tracks-service.js` | 1+ | **Modify** (progressive stub replacement) |
| `app/lib/release-tracks/conflict-resolution.js` | 2 | **Create** |
| `app/lib/release-tracks/object-resolver.js` | 2 | **Create** |
| `app/services/release-tracks/standard-track-service.js` | 2 | **Create** |
| `app/services/release-tracks/workflow-service.js` | 3 | **Create** |
| `app/lib/release-tracks/version-utils.js` | 4 | **Create** |
| `app/repository/release-tracks/release-track-dynamic.repository.js` | 4 | **Modify** (extend tagSnapshotInPlace) |
| `app/services/release-tracks/versioning-service.js` | 4 | **Create** |
| `app/lib/release-tracks/deduplication-strategies.js` | 5 | **Create** |
| `app/services/release-tracks/virtual-track-service.js` | 5 | **Create** |
| `app/services/release-tracks/export-service.js` | 6 | **Create** (deferred) |
| `app/services/release-tracks/ephemeral-service.js` | 6 | **Create** (deferred) |
