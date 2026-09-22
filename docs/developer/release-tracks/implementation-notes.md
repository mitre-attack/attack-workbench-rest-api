# Implementation Notes

## Database Indexes

```javascript
// Collection candidates lookup
db.collections.createIndex({ 'workspace.candidates.object_ref': 1 });
db.collections.createIndex({ 'workspace.candidates.status': 1 });

// Object collection membership
db.objects.createIndex({ 'workspace.collections.candidates': 1 });
db.objects.createIndex({ 'workspace.collections.staged': 1 });
db.objects.createIndex({ 'workspace.workflow.status': 1 });
```

Each release track also owns a dynamic snapshot collection. Tagged versions
use a unique partial index on `{ id: 1, version: 1 }`, restricted to documents
whose `version` is a string. Drafts therefore remain unlimited at
`version: null`, while the database—not an application-level preflight—decides
which concurrent release may claim a version.

Alpha and beta builds are ephemeral and do not establish a database upgrade
contract. Development databases created by those builds are reset or recreated
rather than carried forward by permanent migration scripts. Migrations are
reserved for upgrade paths between stable releases.

## Validation Rules

- `POST /api/release-tracks/new` and `PUT /api/release-tracks/:id/config`
  share the same Zod configuration schema. Creation passes the parsed config
  directly into the initial snapshot so Mongoose applies defaults only to
  omitted options instead of replacing caller-supplied values with an empty
  config.
- `x_mitre_domains` is required by ADM for domain-bearing ATT&CK objects.
  Workbench no longer suppresses the missing-field validation error for
  campaigns, intrusion sets, detection strategies, or matrices. The established
  partial-ADM contract still permits an incomplete `work-in-progress` draft,
  but it cannot advance as valid reviewed content without domains.
- **Same revision selector** can only be in one tier per release-track snapshot
  (`members`, `staged`, `candidates`, or `quarantine`)
- **Different selectors** for the same object CAN exist in multiple tiers simultaneously
- Status transitions must be valid: WIP → Awaiting → Reviewed (no backwards transitions)
- Candidacy threshold must be valid enum value
- Object version must exist before adding as candidate (validate `stix.id` and `stix.modified` exist)
- Candidate/staged `object_modified` may be an exact timestamp or `"latest"`;
  member/quarantine entries must be exact
- Release version selection accepts either an `increment` or an explicit
  `version`, never both. Controller validation returns 400 at the HTTP boundary,
  and `version-utils.calculateNextVersion` repeats the invariant so internal
  release-planning callers cannot silently choose one selector.
- Release versions are ordered by snapshot time. Relative increments use the
  nearest earlier tagged snapshot; explicit and calculated values must be
  greater than that lower bound and less than the nearest later tag. Version
  uniqueness remains track-wide. Commits acquire a per-track registry lock so
  separate API processes cannot validate and write incompatible tags from the
  same stale bounds; abandoned locks become reclaimable after 15 minutes.
- Snapshot descriptions are bounded to 4000 characters and are editable only
  on drafts; a released snapshot is immutable including its notes. They are
  stored as `snapshot_description` on the selected document and never update
  the registry or the track-level `description`. Bundle exports map the local
  value to `x-mitre-collection.description`, falling back to the track
  description.

### ATT&CK canonical-domain migration

Migration
`20260730230000-backfill-canonical-x-mitre-domains.js` establishes the stricter
domain contract for data created under the former validation bypasses. It
derives domain unions from the canonical Enterprise, ICS, and Mobile
collection references already persisted on exact object revisions; startup
never downloads release data and is not tied to a release-specific manifest.

The migration examines the latest revision of every ADM domain-bearing ATT&CK
type, including active, revoked, and deprecated content:

- Active domainless revisions are reposted through their normal service
  `create` workflow. This performs ADM validation and emits the ordinary
  created event, so standard release tracks enroll the new revision according
  to their member-sync configuration.
- Revoked or deprecated domainless revisions are copied directly into
  `attackObjects` as a new immutable revision. This intentionally avoids
  lifecycle guardrails that can reject inactive content. The copy preserves
  both lifecycle flags, advances `stix.modified`, removes revision-specific
  release-track backrefs and the now-resolved validation error, and invokes
  release-track member sync directly. It does not emit a generic created event,
  because that would falsely imply that every ordinary lifecycle hook ran and
  could trigger unrelated active-content side effects. The original revision
  remains unchanged.
- Already canonical latest revisions are skipped. A rerun after partial
  completion therefore processes only the remaining domainless chains.

The repair is batch-oriented to keep startup bounded on production-sized
datasets. It processes 50 candidates at a time, permits four concurrent active
service reposts, inserts inactive clones with bounded native-driver
concurrency, verifies replacement/original pairs with one read per batch, and
bulk-inserts the corresponding automation audit items. Inactive clone `_id`
values are generated by the same native driver performing the insert; this
prevents BSON-major incompatibilities between Mongoose and migrate-mongo.
Analytics, data-component, and detection-strategy reposts remain serial
because their backref hooks are read-modify-write operations.
Member-sync mutations use a per-track lock and refresh the latest snapshot
inside that lock; otherwise two concurrent reposts affecting the same track
could each clone a stale snapshot and lose one candidate update.

Before changing data, the migration resolves the complete candidate set from
persisted canonical collection provenance. A latest domainless target object
without recognized provenance is left unchanged; lack of a TOC match cannot
justify Enterprise membership. The run records a bounded warning sample and
an `unmapped_skipped` count. Persisted domain-validation bypasses remain while
any such object exists, so startup can complete without enforcing an
unsatisfied contract. Failures while repairing mapped objects still fail the
migration.

The migration deletes database copies of retired `x_mitre_domains` bypass
rules only after every target object has been repaired. Removing the rules
only from `default-bypass-rules.json` would be insufficient because static
rules are seeded additively. If object repair is partial, the persisted
bypasses remain and startup fails; the next boot safely retries the remaining
chains. Completion is recorded in `automationRuns` and
`automationRunItems`, with active reposts and inactive clones reported
separately.

### Primary revision integrity boundary

`app/services/release-tracks/primary-revision-service.js` is the shared
existence and hydration boundary for primary snapshot content. It resolves
dynamic selectors, batches exact `(object_ref, object_modified)` reads by STIX
type, preserves request order, and reports every missing revision instead of
silently dropping it.

The error contract distinguishes who can correct the problem:

- Request ingress returns `400` with `missing_references` when candidate
  selection names a revision that does not exist.
- Operations over already-persisted content return `409` with
  `missing_references` when a release preview/commit, track clone, virtual
  materialization, quarantine promotion, or bundle export encounters a
  dangling primary reference.
- Repository failures propagate as server errors. They are never interpreted
  as an empty query result, because doing so could emit a partial release.

Bundle bootstrap is also fail-closed. Every primary bundle object must have a
supported Workbench repository and must either be persisted successfully or
already exist as the exact revision being imported. The track registry and
initial snapshot are not created if any primary object fails. Import is not a
database transaction across the heterogeneous object collections, so objects
successfully created before a later failure may remain as ordinary Workbench
objects; no partial release track points at them.

### Cross-tier revision enforcement

`app/lib/release-tracks/tier-revision-invariant.js` owns selector identity
(`object_ref` + normalized `object_modified`) and normalization.
Every clone-based mutation passes through `snapshot-service.cloneSnapshot`;
track cloning uses the same normalizer. Standard tagging also creates a clone,
while virtual tagging remains an in-place mutation of its materialized draft.
`versioning-service` normalizes before either commit. This covers
candidate adds, manual/automatic promotion, demotion, status transitions,
candidate pin changes, member sync, direct content replacement, bundle
import, standard/virtual snapshot creation, and release commits without
route-specific guards.

Normalization keeps the first identical selector in the authoritative order
`members` → `staged` → `candidates` → `quarantine`. The order matches
backref reconciliation's defensive precedence: published membership wins
over in-flight workflow state, and resolved virtual membership wins over
quarantine. Exact duplicates within one tier are not collapsed because
quarantine entries may retain source-specific provenance.

`conflict-resolution.applyConflictPolicy` separately treats an identical
destination selector as an idempotent successful move. It does not reject the
incoming entry, so callers remove its source-tier occurrence. Conflict
policies remain responsible only for different selectors of one object.

### Standard release resolution boundary

Candidate requests that omit `modified` or specify `"latest"` persist that
literal selector. Candidate-to-staged promotion does not freeze it.
`versioning-service.planLoadedSnapshot` is the single resolution boundary for
both latest and historical standard release targets: it resolves staged
selectors before normalization, conflict detection, summary calculation, or
workbench/bundle rendering. The pure `planRelease` function rejects any
standard input whose staged tier still contains `"latest"`, preventing
internal callers from accidentally persisting a dynamic member.

Preview and commit intentionally resolve independently. A new object revision
between those requests may change the plan; the successful commit freezes the
revision it resolved. Candidate entries remain workflow state and are not
resolved or promoted by release.

## Performance Considerations

- Bulk operations should use batch updates
- Event handlers should be async and non-blocking
- Large collections (>10k objects) may need pagination
- Consider caching for `release/preview` on large collections

### Virtual draft creation and release planning

Virtual-only operations are deliberately scoped beneath
`/api/release-tracks/:id/virtual`:

- `PUT /virtual/composition` clones a pending draft with revised composition
  rules, empty members/quarantine tiers, and
  `composition_resolution: null`. Clearing all three prevents a materialized
  result from surviving a change to the rules that produced it.
- `POST /virtual/snapshots/create` resolves tagged or active-draft component snapshots and
  persists the concrete members, quarantine, and immutable
  `composition_resolution`.
- Every persisted member and quarantine entry uses an exact
  `(object_ref, object_modified)` revision. Standard candidate/staged entries
  may persist `"latest"`, but standard release planning resolves staged
  selectors before they enter members. Virtual materialization also normalizes
  unresolved legacy component entries at its boundary; it never persists a
  moving reference.
- `member_sync.strategy = track_latest` applies only to standard tracks. New
  object revisions may update a component's newer candidate/staged draft, but
  they cannot rewrite the members of the component snapshot selected during
  virtual materialization or an already-persisted virtual snapshot.
- `POST /virtual/quarantine/promote` clones the latest virtual snapshot,
  selects one exact quarantined revision for members, and removes all
  quarantined alternatives for that object.

Composition input uses strict Zod objects at the composition, component,
filter, and deduplication levels. Components form a discriminated union on
`resolution_strategy`: `latest_tagged` and `latest_draft` accept no selector,
`specific_version` requires only `version`, and `specific_snapshot` requires
only `snapshot`. This prevents misspelled filters or irrelevant selectors from
being silently stripped before persistence. The same schema is used for
initial virtual-track creation and composition updates.

`latest_draft` resolves the newest standard snapshot only when it is untagged
and not a preserved release source. It does not search older retained drafts
or fall back to a release. An unavailable active draft returns `400 Bad Request`.
All strategies contribute members only; candidates and staged entries are
never composed. `specific_snapshot` remains tagged-only.

Standard clone save/prune and virtual materialization share the existing
release lock. Concurrent operations fail fast with `409 Conflict`, preventing
pruning between source resolution and persisted virtual provenance. Pruning
retains every source snapshot named by persisted virtual provenance, including
historical virtual drafts. Once the last dependent disappears, the next
standard clone can prune the source if no other retention rule protects it.

Component `priority` is always required, even when the selected deduplication
strategy does not inspect it. Zod rejects duplicate component IDs and
priorities before service delegation. The facade also asks the virtual-track
service to verify that every component exists and is a standard track before
persisting an initial virtual track; update and materialization retain the same
service-layer validation. Standard type is a positive requirement, so virtual
tracks cannot compose other virtual tracks. Virtual tracks are also purely
compositional: the strict creation contract rejects unsupported properties
such as `native_members`, and content unique to an aggregate must be modeled in
a standard component track.

Snapshot retrieval never re-runs composition, so there is no `resolve` query
parameter or `resolved_content` response wrapper. Workbench retrieval returns
the persisted primary membership. Bundle export always replays the snapshot's sealed content manifest. A
materialized virtual draft is sealed at materialization and that manifest is
published unchanged at release; relationship revisions are selected by member
ID closure and pinned to the member revisions. See
[sealed-content-manifests.md](sealed-content-manifests.md).

Snapshot schedules use the same strict, mode-discriminated Zod schema at the
controller and service boundaries. `manual` has no selector field, `cron`
requires a five-field cron expression, and `dates` requires a nonempty array of
ISO timestamps. Standard-track creation rejects `snapshot_schedule` instead of
silently dropping it. Mongoose repeats the mode and track-type invariants for
direct persistence callers.

`scheduled_materialization` uses a separate strict virtual-only schema. Track
creation, composition update, and explicit virtual-materialization requests
can attach it to the snapshot they create; the scheduler uses that same
service input for automated occurrences. Full snapshot reads return the stored
object directly, while track listing and snapshot history explicitly project
it. Ordinary clones clear inherited occurrence metadata so it never migrates
to a different snapshot implicitly.

The virtual snapshot scheduler reconciles persisted schedules at startup and
on `VIRTUAL_TRACK_SCHEDULES_CRON`. Cron jobs use `Etc/UTC`; explicit dates at
or before the reconciliation time become durable occurrences. Atomic
occurrence claims prevent concurrent workers from processing the same run,
and a unique scheduled-materialization index on each track collection prevents
duplicate snapshots after restarts or duplicate delivery. Failures are
recorded in the automation-run audit trail and retried at the next eligible
reconciliation.

Component `filters.object_types` values are constrained to the canonical
Workbench STIX vocabulary exported by `app/lib/types.js`. The request schema
requires a nonempty, duplicate-free array when the property is present, and
the Mongoose composition schema repeats that invariant. Omitting the property
means no type filter. Materialization compares each value to the type prefix
already encoded in the resolved snapshot member's `object_ref`; it never
re-resolves that member to the latest database revision.

Component `filters.domains` is also evaluated against the exact pinned
revision. It normalizes public and STIX domain names, then uses set
intersection (any-match) semantics. A canonical multi-domain revision is
therefore eligible for every matching domain composition without being cloned
or narrowed. Domainless revisions fail a configured domain filter, except for
the established matrix fallback through
`external_references[].external_id`.

Virtual deduplication distinguishes duplicate contributions from revision
conflicts. Entries are grouped first by `object_ref`, then by the exact
`object_modified` timestamp. Multiple components contributing the same exact
revision produce one member and no conflict; multiple distinct revisions of
one object invoke the configured resolution strategy. For exact-revision
source ownership, `prioritize_latest_snapshot` selects the newest resolved
component snapshot, while the other strategies use the required component
priority; priority also breaks equal-snapshot ties.

Deduplication returns an internal source attribution for every surviving
member. `objects_contributed` is calculated from those attributions rather
than matching each output member back to every input contribution. Therefore
the component contribution total equals
`composition_resolution.summary.total_objects`. Under `quarantine`, repeated
copies of one exact revision remain a single member, and genuine conflicts
produce one quarantine entry per distinct revision.

There is no side-effect-free virtual snapshot-creation preview. Once a virtual
draft is persisted, it uses the same retrieval and release endpoints as a
standard draft. Release planning never resolves composition and rejects a
virtual draft without `composition_resolution` with `409 Conflict`. Generic
snapshot member replacement is not supported for either track type. Standard
membership enters through the candidate/staged/release lifecycle; virtual
membership has composition resolution as its sole authority.

Quarantine promotion is a snapshot mutation, not a composition
re-resolution. It preserves `composition_resolution` so that field continues
to describe the immutable component inputs and deduplication result that
created the source draft. The preceding snapshot retains every quarantined
source alternative; the new draft records the operator's choice through its
exact member revision. Normal clone behavior reconciles latest-snapshot object
back-references after the move.

For virtual summary previews, `versioning-service` loads the latest tagged
snapshot whose `modified` timestamp is strictly earlier than the selected
draft. This chronological lookup matters for historical drafts: a release
tagged later in the track must not become the comparison baseline. The pure
planner compares member IDs and exact revision timestamps and reports:

- `new_count`: IDs present only in the draft;
- `updated_count`: IDs present in both with different revision sets;
- `removed_count`: IDs present only in the preceding release;
- `quarantined_count`: entries currently quarantined in the draft.

The first virtual release uses zero-valued `before` counts and
`previous_release: null`. Workbench and bundle previews render the same frozen
planned snapshot, and the commit path tags that snapshot in place.

Virtual release planning also derives
`version_history[].component_versions` directly from the selected draft's
immutable `composition_resolution.component_snapshots`. The property is a
component track ID to tagged `MAJOR.MINOR` version or `null` map. It deliberately
does not query the component tracks at preview or commit time: a component can
advance after materialization without changing the already-frozen provenance.
Standard release history entries omit the property. Mongoose validates string
values with the shared release-version validator. Component resolutions require
a tagged `resolved_version` for tagged strategies and allow `null` for
`latest_draft`.

Standard release commit assigns a fresh timestamp, stores
`release_source_modified`, and inserts the tagged clone while retaining the
source. Release, retag, and rollback share the registry release lock. Rollback
queries exact virtual provenance (`track_id` + `resolved_snapshot_id`) across
all virtual snapshot collections and fails closed when any dependent exists;
this catches both implicit `latest_tagged` and explicit resolution rules.

Retagging preserves `resolved_snapshot_id`. Existing virtual provenance keeps
the `resolved_version` label observed when it materialized; future explicit
rules that name an obsolete label must be updated by the caller.

### Snapshot history reads

Snapshot history is exposed as a nested collection at
`GET /api/release-tracks/:id/snapshots`; latest-snapshot retrieval is exposed
only at `GET /api/release-tracks/:id/snapshots/latest`. The track resource path
retains `DELETE` but intentionally has no `GET` method because the release-track
API was still prerelease when this contract was adopted. The collection route
also replaces the previously documented but unimplemented `?versions=all`
polymorphism, so a single endpoint never changes between a full snapshot object
and a list response.

`release-track-dynamic.repository.getSnapshotSummaries` performs tagged-state
filtering, descending timestamp ordering, pagination, and tier counts in
MongoDB. It projects counts with `$size` rather than hydrating the potentially
large tier arrays. The filter is applied to both the data query and
`countDocuments`, making `pagination.total` the filtered total.

The service shapes projected counts according to `snapshot.type`:

- standard: `members_count`, `staged_count`, `candidates_count`
- virtual: `members_count`, `quarantine_count`

This omits structurally inapplicable counts instead of making a zero value
ambiguous. An omitted `tagged` parameter adds no version predicate;
`tagged=true` matches string versions and `tagged=false` matches null draft
versions.

For `content_statistics`, the snapshot service collects every
`content_manifest_id` from the paginated result and performs one aggregation
against `releaseTrackContentManifestEntries`, grouped by `manifest_id` and
`kind`. The existing `{ manifest_id: 1, kind: 1, tier: 1 }` index supports the
match, and shared manifests are counted once. The service fills zero-valued
categories for empty manifests. This keeps history latency to one additional
bounded query rather than one query per snapshot.

## Integrating with the Event-Driven Architecture

### Events Published

```javascript
// When object status changes within a collection (collection-scoped)
eventBus.emit('release-track:status-changed', {
  collectionId: 'x-mitre-collection--123',
  objectId: 'attack-pattern--eee',
  objectModified: '2024-01-12T09:00:00Z', // Version pin
  oldStatus: 'work-in-progress',
  newStatus: 'awaiting-review',
  changedBy: 'user@example.com',
  changedAt: '2024-01-15T10:00:00Z',
});

// When object version is added to collection candidates
eventBus.emit('release-track:candidate-added', {
  collectionId: 'x-mitre-collection--123',
  objectId: 'attack-pattern--eee',
  objectModified: '2024-01-12T09:00:00Z', // Version pin
  status: 'work-in-progress',
  addedBy: 'user@example.com',
});

// When object is promoted to staged
eventBus.emit('release-track:object-staged', {
  collectionId: 'x-mitre-collection--123',
  objectId: 'attack-pattern--ddd',
  objectModified: '2024-01-14T10:00:00Z', // Version pin
  status: 'reviewed',
  promotedBy: 'auto', // or user email
});

// When collection is released
eventBus.emit('release-track:released', {
  collectionId: 'x-mitre-collection--123',
  version: '1.2',
  promotedCount: 1,
  promotedObjects: [
    {
      objectId: 'attack-pattern--ddd',
      objectModified: '2024-01-14T10:00:00Z', // Version included in release
    },
  ],
  releasedBy: 'admin@example.com',
});
```

### Event Handlers

```javascript
// Auto-promote on status change (collection-scoped)
eventBus.on('release-track:status-changed', async (event) => {
  if (event.newStatus === 'reviewed') {
    const collection = await Collection.findById(event.collectionId);

    if (collection.workspace.config.auto_promote) {
      // Move this specific version from candidates to staged
      await promoteToStaged(
        collection,
        event.objectId,
        event.objectModified, // Preserve version pin
      );
    }
  }
});

// Update object's referenced_by tracking
eventBus.on('release-track:object-staged', async (event) => {
  // Update the specific object version
  await updateObject(
    { 'stix.id': event.objectId, 'stix.modified': event.objectModified },
    {
      $set: {
        'workspace.referenced_by.$[elem].tier': 'staged',
        'workspace.referenced_by.$[elem].status': event.status,
      },
    },
    {
      arrayFilters: [
        {
          'elem.collection_id': event.collectionId,
          'elem.tier': 'candidates',
        },
      ],
    },
  );
});
```
