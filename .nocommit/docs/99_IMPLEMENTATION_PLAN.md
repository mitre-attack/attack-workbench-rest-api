# Release Tracks V2 - Implementation Design

## Architecture Overview

```
                          ┌─────────────────────────────┐
                          │  release-tracks-routes.js    │  (auto-discovered)
                          └──────────────┬──────────────┘
                                         │
                     ┌───────────────────┴───────────────────┐
                     │  release-tracks-controller.js          │
                     │  (Zod validation, response formatting) │
                     └───────────────────┬───────────────────┘
                                         │
              ┌──────────────────────────┴───────────────────────────┐
              │             release-tracks-service.js                 │
              │          (Facade / Orchestrator)                      │
              ├──────────┬──────────┬──────────┬──────────┬──────────┤
              │ snapshot  │ standard │ version  │ virtual  │ export   │
              │ -service  │ -track   │ -ing     │ -track   │ -service │
              │          │ -service │ -service │ -service │          │
              │          │          │          │          │          │
              │          │ workflow │          │          │          │
              │          │ -service │          │          │          │
              └──────┬───┴──────────┴────┬─────┴──────────┴──────────┘
                     │                   │
        ┌────────────┴────┐    ┌────────┴────────────────┐
        │ registry.repo   │    │ dynamic.repo             │
        │ (releaseTrack   │    │ (per-track collections   │
        │  Registry coll) │    │  via ModelFactory)        │
        └─────────────────┘    └─────────┬───────────────┘
                                         │
                               ┌─────────┴───────────┐
                               │   ModelFactory       │
                               │ (dynamic Mongoose    │
                               │  model cache)        │
                               └─────────────────────┘
```

### Key Architectural Decision: Collection-per-Track

Each release track gets its own MongoDB collection (named `release-track--<uuid>`). A central `releaseTrackRegistry` collection indexes all tracks for discovery/listing. This requires a **ModelFactory** that dynamically creates and caches Mongoose models at runtime -- the single most novel infrastructure component.

### Relationship to Existing V2 Stubs

The existing `collections-controller-v2.js` and `collections-routes-v2.js` serve endpoints under `/api/collections/`. These will be **deleted** and replaced by the new `/api/release-tracks/` routes. The existing stubs can serve as reference for patterns (Zod validation, error handling) but the new implementation starts fresh under the `release-tracks` namespace. Clean break -- no dual-routing.

---

## File Layout

```
app/
  models/release-tracks/
    release-track-registry-model.js       ← Mongoose schema for registry collection
    release-track-snapshot-schema.js       ← Reusable schema for per-track snapshot docs
    model-factory.js                       ← Dynamic Mongoose model creation/caching

  repository/release-tracks/
    release-track-registry.repository.js   ← CRUD on releaseTrackRegistry collection
    release-track-dynamic.repository.js    ← CRUD on per-track collections via ModelFactory

  routes/
    release-tracks-routes.js               ← All ~30 endpoints (auto-discovered)

  controllers/
    release-tracks-controller.js           ← Request parsing, validation, delegation

  services/release-tracks/
    release-tracks-service.js              ← Facade: delegates to sub-services
    snapshot-service.js                    ← Snapshot creation, clone, delete
    standard-track-service.js             ← Candidate/staged/member management
    workflow-service.js                   ← Auto-promotion, candidacy threshold logic
    versioning-service.js                 ← Bump/tag, version history, preview
    virtual-track-service.js             ← Composition resolution, deduplication
    export-service.js                    ← bundle/workbench/filesystemstore serialization
    ephemeral-service.js                 ← Stateless domain bundle generation

  lib/release-tracks/
    release-track-validators.js           ← Zod schemas for all request bodies
    version-utils.js                      ← MAJOR.MINOR parse/compare/increment
    deduplication-strategies.js           ← 4 strategies for virtual track conflicts
    resolution-strategies.js             ← 3 strategies for component track resolution
    conflict-resolution-policies.js      ← 4 policies for tier promotion conflicts
    snapshot-differ.js                   ← Diff/preview between snapshots

  scheduler/
    virtual-track-snapshot-task.js        ← Auto-discovered by scheduler/index.js

  exceptions/index.js                    ← Add: ReleaseConflictError, NoTaggedSnapshotsError,
                                            InvalidComponentTypeError, TrackNotFoundError

  lib/event-constants.js                 ← Add: release-track::created, ::released,
                                            ::candidate-added, ::object-staged, etc.

  lib/error-handler.js                   ← Add: HTTP status mappings for new exceptions
```

---

## Data Model

### Registry Collection (`releaseTrackRegistry`)

```javascript
{
  track_id: "release-track--<uuid>",       // unique, indexed -- also the Mongo collection name
  type: "standard" | "virtual",
  name: "Enterprise ATT&CK",
  description: "...",

  // Denormalized for fast listing (updated on each snapshot/tag)
  latest_snapshot_modified: Date,
  latest_tagged_version: String | null,
  snapshot_count: Number,
  tagged_release_count: Number,

  // Virtual tracks only
  snapshot_schedule: { mode, cron?, dates? },

  created_at: Date,
  updated_at: Date
}
```

### Snapshot Document (one per doc in per-track collection)

```javascript
{
  id: "release-track--<uuid>",              // same across all snapshots in this collection
  type: "standard" | "virtual",
  modified: Date,                           // unique per snapshot, compound index with id
  version: String | null,                   // null = draft, "X.Y" = tagged

  name: String,
  description: String,
  created: Date,                            // when the track was first created
  created_by_ref: String,
  object_marking_refs: [String],

  // --- Standard track tiers ---
  members: [{ object_ref, object_modified }],
  staged: [{ object_ref, object_modified, object_status, object_staged_at, object_staged_by }],
  candidates: [{ object_ref, object_modified, object_status, object_added_at, object_added_by }],

  // --- Virtual track tiers ---
  quarantine: [{ object_ref, object_modified, source_track_id, source_track_name,
                  source_snapshot_version, conflict_reason }],

  // --- Virtual track composition ---
  composition: {
    component_tracks: [{ track_id, resolution_strategy, priority, version?, snapshot?, filters? }],
    deduplication: { strategy }
  },
  composition_resolution: { resolved_at, component_snapshots[], deduplication{}, summary{} },

  // --- Shared ---
  config: {
    candidacy_threshold: "reviewed",
    auto_promote: true,
    promotion_conflicts: { candidates_to_staged, staged_to_members }
  },
  version_history: [{ version, tagged_at, tagged_by, snapshot_id, summary, component_versions? }]
}
```

### Object Documents (existing attackObjects)

**Deferred**: The `workspace.referenced_by` reverse index (tracking which release tracks reference each object version) is **not** included in the initial scaffolding. Queries like "which tracks contain this object?" will require scanning track collections rather than a reverse lookup. This will be added as a follow-up phase once the core release track system is stable.

---

## Data Flow: Key Operations

### 1. Create Standard Track

```
POST /new → controller → releaseTracksService.createTrack()
  → Generate UUID → "release-track--<uuid>"
  → registryRepo.create({ track_id, name, type: "standard", ... })
  → modelFactory.getModel(track_id) → creates Mongoose model + Mongo collection
  → dynamicRepo.saveSnapshot(track_id, { id, modified: now, version: null, members: [], ... })
  → modelFactory.ensureIndexes(track_id)
  → eventBus.emit('release-track::created')
  → Return initial snapshot
```

### 2. Add Candidates + Auto-Promotion

```
POST /:id/candidates → controller → standardTrackService.addCandidates()
  → dynamicRepo.getLatestSnapshot(trackId)
  → For each object_ref:
      → Validate object exists in attackObjects collection
      → Resolve modified (use latest if omitted)
      → Check duplicates in candidates[]
      → Create candidate entry { object_ref, object_modified, status: "work-in-progress" }
      → workflowService.checkAutoPromotion():
          If status meets config.candidacy_threshold → move to staged[]
          If conflict with existing staged entry → apply conflict resolution policy
  → Clone snapshot with new modified timestamp, save
  → Update registry (latest_snapshot_modified, snapshot_count)
  → eventBus.emit('release-track::candidate-added')
  → Return { added, autoPromoted, errors }
```

### 3. Bump/Tag

```
POST /:id/bump → controller → versioningService.bumpLatest()
  → dynamicRepo.getLatestSnapshot(trackId)
  → Validate version === null (else throw AlreadyReleasedError)
  → versionUtils.calculateNextVersion(version_history, bumpType)
  → workflowService.promoteStagedToMembers():
      Resolve dynamic pins ("latest" → actual modified timestamp)
      For each staged entry: check conflict with members → apply policy
      If policy=abort and conflicts exist → throw ReleaseConflictError
      Move staged → members, clear staged
  → If dry_run: return computed result without persisting
  → dynamicRepo.tagSnapshotInPlace(trackId, modified, { version, historyEntry })
  → Update registry (latest_tagged_version, tagged_release_count)
  → eventBus.emit('release-track::released')
  → Return tagged snapshot with release_summary
```

### 4. Virtual Track Snapshot Creation

```
POST /:id/snapshots/create → controller → virtualTrackService.createSnapshot()
  → dynamicRepo.getLatestSnapshot(trackId)
  → Validate type === "virtual"
  → For each component_tracks entry:
      → resolutionStrategies.resolve(component, dynamicRepo) → component snapshot
      → Validate snapshot is tagged (version !== null)
      → Validate component is standard (not virtual)
      → Collect members from resolved snapshot
      → Apply filters (object_types, domains)
  → deduplicationStrategies.deduplicate(allObjects, config) → { members, quarantine, report }
  → Build snapshot: { modified: now, version: null, members, quarantine, composition_resolution }
  → dynamicRepo.saveSnapshot(trackId, snapshot)
  → Update registry
  → Return snapshot with composition_resolution
```

### 5. Export as STIX Bundle

```
GET /:id?format=bundle → controller → exportService.exportAsBundle()
  → Resolve snapshot (latest, or by version/modified)
  → Build x-mitre-collection SDO from snapshot metadata
  → Batch-fetch member objects from attackObjects collection
  → Strip workspace data, keep only stix.* properties
  → Return { type: "bundle", id: "bundle--<uuid>", objects: [collectionSDO, ...memberObjects] }
```

---

## Parallel Work Streams

Seven independent streams with a clean dependency graph:

```
  WS1 (Infrastructure) ←── Foundation, no dependencies
    │
    ├── WS2 (Routes + Controller) ←── Independent (uses service stubs)
    │
    ├── WS3 (Standard Track Core) ←── depends on WS1
    │     │
    │     ├── WS4 (Workflow Engine) ←── depends on WS1
    │     │     │
    │     │     └── WS5 (Versioning) ←── depends on WS1, optionally WS4
    │     │
    │     └── WS7 (Export Engine) ←── depends on WS1
    │
    └── WS6 (Virtual Track Engine) ←── depends on WS1 only
```

### WS1: Infrastructure Layer (Foundation)
**Scope**: MongoDB schemas, ModelFactory, both repositories
**Files**: `models/release-tracks/*`, `repository/release-tracks/*`
**Tests**: Unit tests for ModelFactory caching, registry CRUD, dynamic repo CRUD

### WS2: Route + Controller Shell
**Scope**: All ~30 endpoints wired with auth/validation, returning 501 until services ready
**Files**: `routes/release-tracks-routes.js`, `controllers/release-tracks-controller.js`, `lib/release-tracks/release-track-validators.js`
**Tests**: Route registration, auth gating, Zod validation (400 on bad input)

### WS3: Standard Track Core (Create, Read, Delete, Clone)
**Scope**: Track lifecycle -- create, list, retrieve, clone, delete, metadata/contents update, ephemeral bundles
**Files**: `services/release-tracks/release-tracks-service.js` (facade), `snapshot-service.js`, `ephemeral-service.js`
**Tests**: Full lifecycle tests against in-memory MongoDB

### WS4: Workflow Engine (Candidates, Staging, Auto-Promotion)
**Scope**: Three-tier lifecycle, status transitions, auto-promotion, conflict resolution
**Files**: `services/release-tracks/standard-track-service.js`, `workflow-service.js`, `lib/release-tracks/conflict-resolution-policies.js`
**Tests**: Promotion flows, threshold configs, conflict scenarios

### WS5: Versioning Engine (Bump, Tag, Preview, Dry-Run)
**Scope**: Version calculation, in-place tagging, version history, preview/diff, dry-run
**Files**: `services/release-tracks/versioning-service.js`, `lib/release-tracks/version-utils.js`, `lib/release-tracks/snapshot-differ.js`
**Tests**: Version arithmetic, tag validation, preview accuracy

### WS6: Virtual Track Engine (Composition, Resolution, Deduplication)
**Scope**: Virtual track CRUD, composition resolution, deduplication, quarantine, scheduling
**Files**: `services/release-tracks/virtual-track-service.js`, `lib/release-tracks/resolution-strategies.js`, `lib/release-tracks/deduplication-strategies.js`, `scheduler/virtual-track-snapshot-task.js`
**Tests**: Resolution strategy correctness, dedup strategy correctness, quarantine flows

### WS7: Export Engine (Bundle, FileSystemStore, Workbench Formats)
**Scope**: Serialize snapshots to output formats, fetch STIX objects, strip workspace data
**Files**: `services/release-tracks/export-service.js`
**Tests**: Format correctness, large bundle handling

---

## Interface Contracts

### ModelFactory
```javascript
getModel(trackId: string): mongoose.Model       // Get or create cached model
removeModel(trackId: string): void               // Cleanup on track delete
ensureIndexes(trackId: string): Promise<void>    // Create indexes on new collection
```

### RegistryRepository
```javascript
create(data): Promise<Object>                    // Register new track
findByTrackId(trackId): Promise<Object|null>     // Lookup single track
findAll(options): Promise<{data, pagination}>    // List with filtering/pagination
updateByTrackId(trackId, updates): Promise       // Update denormalized fields
deleteByTrackId(trackId): Promise                // Remove registry entry
```

### DynamicRepository
```javascript
getLatestSnapshot(trackId): Promise<Object|null>
getSnapshotByModified(trackId, modified): Promise<Object|null>
getLatestTaggedSnapshot(trackId): Promise<Object|null>
getSnapshotByVersion(trackId, version): Promise<Object|null>
getAllSnapshots(trackId, options): Promise<Object[]>
saveSnapshot(trackId, snapshotData): Promise<Object>
tagSnapshotInPlace(trackId, modified, versionData): Promise<Object|null>
updateSnapshot(trackId, modified, updateOps): Promise<Object>
deleteSnapshot(trackId, modified): Promise
deleteAllSnapshots(trackId): Promise
dropCollection(trackId): Promise                  // Drops entire Mongo collection
```

### Facade Service (consumed by controller)
```javascript
// Track management
listTracks(options), createTrack(data), getLatestSnapshot(trackId, options),
getSnapshotByModified(trackId, modified, options), updateMetadata(trackId, updates),
updateContents(trackId, contents), cloneTrack(trackId, options),
deleteTrack(trackId), deleteSnapshot(trackId, modified),
createTrackFromBundle(bundleData)

// Candidates
addCandidates(trackId, objectRefs, userId), listCandidates(trackId, options),
removeCandidate(trackId, objectRef), reviewCandidates(trackId, reviewData),
promoteCandidates(trackId, objectRefs), updateCandidateVersion(trackId, objectRef, data)

// Staged
listStaged(trackId), demoteStaged(trackId, objectRefs)

// Versioning
bumpLatest(trackId, options), bumpSpecific(trackId, modified, options), previewBump(trackId)

// Config
getConfig(trackId), updateConfig(trackId, config)

// Virtual
updateComposition(trackId, composition), createVirtualSnapshot(trackId, options),
previewVirtualSnapshot(trackId)

// Export
exportSnapshot(trackId, modified, format), getEphemeralBundle(domain, format)
```

---

## Integration Points with Existing Codebase

| Concern | How to Integrate |
|---------|-----------------|
| **Route auto-discovery** | File named `release-tracks-routes.js` in `app/routes/` is auto-registered |
| **Auth middleware** | Use existing `authn.authenticate` + `authz.requireRole()` |
| **Error handling** | Add 4 new exception classes to `app/exceptions/index.js`; add HTTP mappings to `app/lib/error-handler.js` |
| **Event system** | Add ~10 event constants to `app/lib/event-constants.js`; emit from services |
| **Scheduler** | File named `virtual-track-snapshot-task.js` in `app/scheduler/` is auto-discovered |
| **STIX object lookup** | Use existing services (techniques, groups, etc.) for object validation and bulk retrieval |
| **Validation** | Zod schemas in `release-track-validators.js`; ADM schema for bundle import |

---

## Verification Plan

1. **Unit tests**: Each utility module (`version-utils`, `deduplication-strategies`, `resolution-strategies`, `conflict-resolution-policies`) tested in isolation
2. **Repository tests**: ModelFactory + DynamicRepository against `mongodb-memory-server`
3. **Service integration tests**: Each sub-service tested with real MongoDB, mocked dependencies
4. **API integration tests**: Full HTTP round-trips via supertest for all ~30 endpoints
5. **End-to-end scenario tests**: Multi-step workflows (create track → add candidates → review → bump → export)
