# Virtual Release Tracks

## Overview

Virtual release tracks are computed aggregations of standard release tracks. They provide a way to compose releases from multiple source tracks without duplicating object tracking, reducing mental overhead and storage requirements.

**Key Characteristics:**

- Virtual tracks **compute** their contents from component standard tracks
- Reference published snapshots or the newest standard snapshot's prospective release contents
- Maintain their own **independent snapshot history and versioning**
- Create snapshots **manually or on schedule** (never event-driven)
- All snapshots start as **drafts** and must be explicitly tagged

The active schedule is registry metadata rather than historical snapshot
content. Replace it with `PUT /api/release-tracks/:id/virtual/schedule`; this
does not create a draft. Workbench-format snapshot responses project the
current schedule for configuration interfaces.

## Draft Retention and Release-Time Squash

Administrators can set `draft_retention.max_drafts` to a positive integer such
as 10; the default is unlimited (`null`). The policy is live registry metadata,
like the schedule. Updating it creates no draft and deletes nothing immediately.
After successful draft creation, older eligible drafts are removed. Manual,
scheduled, configuration, metadata and quarantine-resolution drafts all count;
tagged releases never count against the limit or get removed.

When tagging a reviewed draft, administrators can separately opt into deleting
earlier drafts since the preceding tagged snapshot. The preview reports the
strict timestamp bounds and eligible/protected counts, and its fingerprint must
still match at commit. First-release squash considers all earlier eligible
drafts. Historical tagging preserves all newer snapshots. This removes history,
not content: the selected snapshot and its manifest remain unchanged.

Both controls preserve protected snapshots and expose incomplete cleanup as a
retryable operation distinct from release success. Deleted drafts and their
notes cannot be restored by rollback. See the
[API retention, squash and recovery contracts](api-reference.md#virtual-draft-retention)
and [Deletion Guardrails](../../developer/release-tracks/deletion-guardrails.md).

## Use Cases

### Scenario 1: Different Cadences for Different Object Types

```
Standard Tracks (source of truth):
  - GroupsMonthly: intrusion-set objects, releases monthly
  - TechniquesQuarterly: attack-pattern objects, releases quarterly
  - SoftwareBiannual: malware + tool objects, releases twice yearly

Virtual Track (aggregation):
  - EnterpriseTwiceAnnual: Aggregates all three, releases twice yearly
```

**Workflow:**

1. Each standard track releases independently on its own schedule
2. Enterprise virtual track snapshots twice yearly (Jan 1, July 1)
3. Each snapshot captures the **latest tagged release** from each component track
4. Enterprise team reviews snapshot, then tags it as a release

**Benefit:** Groups can release 12 times/year while Enterprise releases 2 times/year, without tracking Groups in both places.

### Scenario 2: Modular Content Organization

```
Standard Tracks:
  - CoreTactics: All tactics
  - CoreTechniques: All attack-patterns
  - CoreGroups: All intrusion-sets
  - CoreSoftware: All malware + tools
  - CoreMitigations: All course-of-action objects

Virtual Tracks:
  - EnterpriseATT&CK: Aggregates all five
  - MobileATT&CK: Aggregates relevant subsets with mobile domain filter
  - ICSATT&CK: Aggregates relevant subsets with ICS domain filter
```

**Benefit:** Maintain objects by type in standard tracks, compose domain-specific releases as virtual tracks.

## Virtual Track Types

### Type: `virtual`

Virtual tracks are identified by `stix.type = "virtual"` in their schema.

```javascript
{
  // Identity
  id: "release-track--uuid-virtual",
  type: "virtual",  // Distinguishes from standard tracks

  // Snapshot metadata
  snapshot_id: "2024-03-01T10:00:00.000Z",
  modified: "2024-03-01T10:00:00Z",
  version: null,  // Draft snapshot (or "14.0" if tagged)

  // Release track metadata
  name: "Enterprise ATT&CK",
  description: "Virtual aggregation of Enterprise content",
  created: "2024-01-01T10:00:00.000Z",
  created_by_ref: "identity--uuid",
  object_marking_refs: ["marking-definition--uuid"],

  // Objects in this snapshot (Virtual tracks use a 2-tier system)
  members: [],      // Successfully synced objects from component tracks
  quarantine: [],   // Conflicting objects that require manual resolution

  // Composition rules (how to build this virtual track)
  composition: {
    component_tracks: [
      {
        track_id: "release-track--uuid-1",
        resolution_strategy: "latest_tagged",
        priority: 1,  // Required and unique; lower number = higher priority
        filters: {
          object_types: ["intrusion-set"],
          // Additional filters...
        }
      },
      {
        track_id: "release-track--uuid-2",
        resolution_strategy: "latest_tagged",
        priority: 2,
        filters: {
          object_types: ["attack-pattern"]
        }
      }
    ],

    deduplication: {
      strategy: "prioritize_latest_object"  // See Deduplication Strategies below
    }
  },

  // Snapshot schedule configuration
  snapshot_schedule: {
    mode: "manual"  // "manual" | "cron" | "dates"
  },

  // Configuration
  config: {
    candidacy_threshold: "reviewed",
    auto_promote: true
  },

  version_history: []
}
```

## Composition Resolution

### Resolution Strategies

#### 1. `latest_tagged`

Always resolves to the most recent **tagged snapshot** from the component track.

```javascript
{
  track_id: "release-track--uuid-1",
  resolution_strategy: "latest_tagged",
  priority: 0
}

// At virtual snapshot time (e.g., March 1, 2024):
// 1. Query GroupsMonthly for all snapshots where version !== null
// 2. Sort by modified DESC
// 3. Take first result
// → Resolves to GroupsMonthly v5.2 (released Feb 15, 2024)
```

**Use case:** "Always include the latest Groups release in Enterprise"

#### 2. `specific_version`

Resolves to a specific semantic version from the component track.

```javascript
{
  track_id: "release-track--uuid-1",
  resolution_strategy: "specific_version",
  version: "5.0",
  priority: 0
}

// At virtual snapshot time:
// 1. Query GroupsMonthly for snapshot where version === "5.0"
// → Resolves to GroupsMonthly v5.0 (regardless of when snapshot occurs)
```

**Use case:** "Pin Enterprise to Groups v5.0 until we're ready to upgrade"

#### 3. `specific_snapshot`

Resolves to a specific snapshot by its `modified` timestamp.

```javascript
{
  track_id: "release-track--uuid-1",
  resolution_strategy: "specific_snapshot",
  snapshot: "2024-02-01T10:00:00Z",
  priority: 0
}

// At virtual snapshot time:
// 1. Query GroupsMonthly for snapshot where modified === "2024-02-01T10:00:00Z"
// → Resolves to that specific snapshot
```

**Use case:** "Lock to exact snapshot for reproducibility"

#### 4. `latest_preview`

Resolves the newest standard-track snapshot, whether draft or tagged:

```javascript
{
  track_id: "release-track--uuid-1",
  resolution_strategy: "latest_preview",
  priority: 0
}
```

For an untagged source, composition uses the same membership calculation as a
standard release preview: existing members plus staged objects under the source
track's `promotion_conflicts.staged_to_members` policy. Exact duplicates are
normalized, dynamic `"latest"` selectors resolve to exact revisions, and
candidates are excluded. This is not a simple concatenation of the two tiers.

For a tagged newest snapshot, composition uses its published members. A new
source draft is not required after tagging, and no older draft is selected.
`latest_tagged` remains distinct: it selects the newest published release even
when a newer draft exists.

Component planning happens before object/domain filters and cross-component
deduplication. A blocking source promotion conflict aborts materialization with
`409 Conflict`, identifying the component and conflict. Virtual filters cannot
bypass a conflict that would prevent releasing that source.

Neither materialization nor tagging the virtual snapshot tags, promotes,
allocates a version for, or otherwise mutates the standard source. Operators can
stage changes, create a virtual snapshot to review the downstream composition,
and leave standard-track publication to its own release cadence. Revisions
freeze at virtual materialization; later source edits do not rewrite that result.

Provenance records `strategy_used: "latest_preview"` and the original source
`resolved_snapshot_id`. `resolved_version` is `null` for a source draft and its
actual version for a tagged source. Source/contribution counts use the planned
member set, which can be nonempty even when the draft's stored members are empty.

**Cutover:** `latest_draft` is retired and rejected in new composition requests.
Existing rules must explicitly select `latest_preview` or `latest_tagged` before
rematerialization; they are not silently upgraded to include staged content.
Historical members-only provenance retains its original `latest_draft` label and
contents and remains readable/releasable.

Component selectors are strict and strategy-specific:

- `latest_tagged` and `latest_preview` reject both `version` and `snapshot`.
- `specific_version` requires `version` and rejects `snapshot`.
- `specific_snapshot` requires `snapshot` and rejects `version`.

Unknown component properties are rejected with `400 Bad Request`; they are
not silently discarded.

### Component Track Sync Rules

Published and pinned strategies use the selected source's members. `latest_preview` uses prospective release membership for a draft, or published members for a tagged newest snapshot.

**Important:**

- `latest_preview` includes staged changes through the standard release membership planner
- Candidates are never composed; the other strategies remain tagged-members-only
- Each materialization freezes exact member revisions and source provenance

Source drafts referenced by virtual snapshots are retained when the standard
track advances. Deletion remains blocked while a virtual snapshot depends on
the source. After the last dependent is removed, a later standard draft write
can prune that otherwise-unprotected source.

### Filters

Each component track can specify filters to limit which objects are included:

```javascript
filters: {
  // Only include specific object types
  object_types: ["intrusion-set", "malware"],

  // Match the pinned revision's x_mitre_domains values. Both public names
  // ("enterprise") and STIX names ("enterprise-attack") are accepted.
  domains: ["enterprise", "mobile"]
}
```

Domain filters hydrate the exact revisions pinned by the selected component
snapshot; they do not inspect the latest database revision. Matching uses
inclusive **any-match** semantics, not exact-array equality: an object is
included when at least one value in its canonical `x_mitre_domains` array
matches at least one configured domain. For example,
`["enterprise-attack", "mobile-attack"]` is included by both an Enterprise
filter and a Mobile filter, while `["mobile-attack"]` is excluded by an
Enterprise filter. Objects without `x_mitre_domains` are excluded when a
domain filter is set.

The domain constraint determines the virtual snapshot's exact member set. The
content manifest sealed at materialization is closed over that set, so no
relationship can pull any secondary SDO into the virtual bundle. Domainless
identities, marking definitions, and other supporting metadata may still be
included when referenced by an included object.

`x_mitre_domains` is canonical object data. A cross-domain object has one
revision containing the complete domain union; Workbench does not create or
emit separate domain-narrowed revisions of that object. Consequently, the
same exact `(object_ref, object_modified)` member can appear in multiple
domain-filtered virtual snapshots.
Current matrix revisions follow the same canonical-domain requirement. For
exact historical matrix revisions created before enforcement, virtual
filtering retains a compatibility fallback to the domain in
`external_references[].external_id`.

`object_types` values are case-sensitive canonical Workbench STIX type names.
When the property is present, it must contain at least one value and cannot
contain duplicates. Omit `object_types` to include every type. The filter reads
the type prefix from each resolved member's `object_ref`, so a newer database
revision cannot replace the exact revision pinned by the component release.
Unsupported values return `400 Bad Request`.

`stix_pattern` is not part of the current request schema and is not
implemented. Filter objects are strict, so misspelled or unsupported keys such
as `domain` fail with `400 Bad Request`; use the plural `domains`.

### Deduplication Strategies

When multiple component tracks contain the same object (same `stix.id`), the
materialization records one duplicate object. Contributions with the same
`modified` timestamp are the same exact revision, so they collapse to one
member and do not constitute a conflict. The configured strategy is applied
only when multiple distinct revisions remain. Four strategies are available:

Each surviving member is attributed to one component. The active strategy
selects that source where applicable, with the component's required unique
priority providing a stable tie-breaker. As a result, the sum of
`component_snapshots[].objects_contributed` equals
`composition_resolution.summary.total_objects`.

#### 1. `prioritize_latest_object`

Keep the version with the newest `modified` timestamp, regardless of which component track it came from.

```javascript
deduplication: {
  strategy: 'prioritize_latest_object';
}
```

**Example:**

```javascript
// GroupsMonthly v5.2 has:
//   intrusion-set--APT1, modified: 2024-02-01T10:00:00Z

// MobileGroups v3.1 has:
//   intrusion-set--APT1, modified: 2024-01-15T14:00:00Z

// Virtual track sync result:
//   → Uses 2024-02-01 version from GroupsMonthly (newer object)
//   → Added to virtual track's members
```

**Use case:** "Always use the most recently updated object, regardless of source"

#### 2. `prioritize_latest_snapshot`

Keep the version from the component track whose resolved snapshot has the newest `modified` timestamp. This can result in syncing **older** versions of objects if they came from a more recently released snapshot.

```javascript
deduplication: {
  strategy: 'prioritize_latest_snapshot';
}
```

**Example:**

```javascript
// GroupsMonthly v5.2
//   - Snapshot created: 2024-02-15T10:00:00Z
//   - intrusion-set--APT1, modified: 2024-02-01T10:00:00Z

// MobileGroups v3.1
//   - Snapshot created: 2024-01-10T10:00:00Z
//   - intrusion-set--APT1, modified: 2024-02-05T10:00:00Z

// Virtual track sync result:
//   → Uses 2024-02-01 version from GroupsMonthly
//   → GroupsMonthly snapshot is newer (2024-02-15), even though APT1 object is older
//   → Added to virtual track's members
```

**Use case:** "Trust the more recently released track, even if individual objects are older"

#### 3. `prioritize_higher_priority`

Keep the version from the component track with the higher priority (lower priority number). Every component track requires a unique, non-negative integer priority.

```javascript
composition: {
  component_tracks: [
    {
      track_id: "release-track--authoritative",
      resolution_strategy: "latest_tagged",
      priority: 1,  // Higher priority (lower number = higher priority)
      filters: { object_types: ["intrusion-set"] }
    },
    {
      track_id: "release-track--supplemental",
      resolution_strategy: "latest_tagged",
      priority: 2,  // Lower priority
      filters: { object_types: ["intrusion-set"] }
    }
  ],
  deduplication: {
    strategy: "prioritize_higher_priority"
  }
}
```

**Example:**

```javascript
// Authoritative track (priority: 1) has:
//   intrusion-set--APT1, modified: 2024-01-01T10:00:00Z

// Supplemental track (priority: 2) has:
//   intrusion-set--APT1, modified: 2024-02-15T10:00:00Z

// Virtual track sync result:
//   → Uses 2024-01-01 version from Authoritative track
//   → Priority 1 wins, even though object is older
//   → Added to virtual track's members
```

**Use case:** "One track is authoritative; always prefer its version over others"

**Important:** Component tracks cannot have duplicate priority values. The API will reject composition configurations with conflicting priorities.

#### 4. `quarantine`

Don't automatically choose a version. Instead, store **both** versions in the virtual track's `quarantine` tier for manual review and resolution.

Only distinct revisions are quarantined. If several components contribute the
same exact revision, it remains one ordinary member. If two distinct revisions
are present and either is contributed repeatedly, quarantine contains one
entry for each distinct revision rather than one entry per component.

```javascript
deduplication: {
  strategy: 'quarantine';
}
```

**Example:**

```javascript
// GroupsMonthly has: intrusion-set--APT1, modified: 2024-02-01
// MobileGroups has: intrusion-set--APT1, modified: 2024-01-15

// Virtual track sync result:
{
  members: [
    // APT1 is NOT included here
    // ... other non-conflicting objects
  ],
  quarantine: [
    {
      object_ref: "intrusion-set--APT1",
      object_modified: "2024-02-01T10:00:00Z",
      source_track_id: "release-track--groups-monthly",
      source_track_name: "Groups Monthly",
      source_snapshot_version: "5.2",
      conflict_reason: "duplicate_object"
    },
    {
      object_ref: "intrusion-set--APT1",
      object_modified: "2024-01-15T14:00:00Z",
      source_track_id: "release-track--mobile-groups",
      source_track_name: "Mobile Groups",
      source_snapshot_version: "3.1",
      conflict_reason: "duplicate_object"
    }
  ]
}
```

**Use case:** "Conflicts require human review; don't automatically choose a version"

**Follow-up workflow:** Users review the quarantined objects and manually
promote one exact version to `members`. Promotion creates a new draft and
removes every quarantined alternative for that object. Other quarantined
objects remain until separately resolved.

### Virtual Track Two-Tier System

Unlike standard release tracks (which use a three-tier system: candidates → staged → members), virtual tracks use a simplified **two-tier system**:

1. **`members`** - Successfully synced objects from component tracks
   - Contains objects that were either:
     - Synced from component tracks without conflicts, OR
     - Manually promoted from quarantine after conflict resolution
   - These objects are included in published STIX bundles
   - No duplicate objects allowed (unique by `stix.id`)

2. **`quarantine`** - Conflicting objects requiring manual resolution
   - Contains objects that couldn't be automatically resolved due to conflicts
   - Only populated when using `quarantine` deduplication strategy
   - Can contain multiple versions of the same object (different `modified` timestamps)
   - NOT included in published STIX bundles
   - Requires manual intervention to resolve

**Comparison to Standard Tracks:**

| Feature           | Standard Track                              | Virtual Track                     |
| ----------------- | ------------------------------------------- | --------------------------------- |
| Tiers             | candidates, staged, members                 | quarantine, members               |
| Object management | Direct (add/remove objects)                 | Indirect (synced from components) |
| Workflow states   | work-in-progress, awaiting-review, reviewed | N/A                               |
| Auto-promotion    | Based on candidacy threshold                | N/A                               |
| Manual promotion  | candidates → staged → members               | quarantine → members              |

**Why only two tiers?**

Virtual tracks compose an effective member set rather than managing a separate authoring workflow. Published sources contribute members; draft previews calculate members plus eligible staged changes without promoting them in the source. The virtual snapshot freezes that result directly into members or quarantine, so it does not need its own staged tier.

## Virtual Track Snapshot Lifecycle

### 1. Snapshot Creation

Virtual track snapshots are created either **manually** or **on schedule**.

#### Manual Snapshot

```bash
POST /api/release-tracks/:id/virtual/snapshots/create
```

**Request:**

```json
{
  "description": "Q1 2024 Enterprise snapshot"
}
```

**Response:**

```json
{
  "id": "release-track--uuid-virtual",
  "type": "virtual",
  "snapshot_id": "2024-03-01T10:00:00.000Z",
  "modified": "2024-03-01T10:00:00Z",
  "version": null,
  "name": "Enterprise ATT&CK",
  "description": "Virtual aggregation of Enterprise content",
  "snapshot_description": "Q1 2024 Enterprise snapshot",

  "composition_resolution": {
    "resolved_at": "2024-03-01T10:00:00Z",
    "component_snapshots": [
      {
        "track_id": "release-track--uuid-1",
        "track_name": "Groups Monthly",
        "track_type": "standard",
        "resolved_snapshot_id": "2024-02-15T10:00:00.000Z",
        "resolved_version": "5.2",
        "strategy_used": "latest_tagged",
        "total_objects_in_source": 47,
        "objects_after_filter": 47,
        "objects_contributed": 47
      },
      {
        "track_id": "release-track--uuid-2",
        "track_name": "Techniques Quarterly",
        "track_type": "standard",
        "resolved_snapshot_id": "2024-01-15T10:00:00.000Z",
        "resolved_version": "2.1",
        "strategy_used": "latest_tagged",
        "total_objects_in_source": 823,
        "objects_after_filter": 823,
        "objects_contributed": 823
      }
    ],
    "deduplication": {
      "total_objects_before": 870,
      "total_objects_after": 870,
      "duplicates_found": 0,
      "conflicts_resolved": []
    },
    "summary": {
      "total_objects": 870
    }
  }
}
```

**Business Logic:**
The request `description` is stored as the snapshot-local
`snapshot_description`; it never replaces the virtual track's long-lived
description.

1. For each component track in `composition.component_tracks`:
   - Resolve snapshot based on `resolution_strategy`
   - Require a tagged source for published/pinned strategies; `latest_preview` accepts the newest draft or release
   - For a previewed draft, calculate prospective members with standard release conflict rules; otherwise use published members
   - Apply `filters` to get subset of objects
   - Collect all object references with source metadata
2. Apply deduplication rules across all components:
   - Collapse identical `(object_ref, object_modified)` contributions
   - If no distinct-revision conflicts remain: objects go to virtual track's `members`
   - If conflicts + `quarantine` strategy: both versions go to `quarantine`
   - If conflicts + other strategies: winning version goes to `members`
   - Attribute every surviving member to one deterministic source component
3. Create new virtual track snapshot with:
   - New `snapshot_id` and `modified` timestamp
   - `version = null` (always starts as draft)
   - `members` array (successfully synced objects)
   - `quarantine` array (conflicting objects, if any)
   - `composition_resolution` metadata (what was included)
4. Return snapshot with resolution details

#### Scheduled Snapshot

Virtual tracks can be configured to auto-generate snapshots on a schedule:

```javascript
snapshot_schedule: {
  mode: "cron",
  cron: "0 0 1 1,7 *"  // Jan 1 and July 1 at midnight
}
```

Schedule payloads are strict and mode-specific:

- `manual` accepts only `{ mode: "manual" }`.
- `cron` requires `cron` and rejects `dates`.
- `dates` requires a nonempty `dates` array and rejects `cron`.

Unknown schedule fields return `400 Bad Request`. Standard tracks do not
support `snapshot_schedule`.

The global scheduler must be enabled. Five-field cron expressions and dates
are interpreted in UTC. Each cron occurrence creates a draft while the server
is running; missed cron occurrences are not backfilled. Due dates are durable:
the scheduler recovers them after a restart and persists exactly one draft per
configured timestamp. A failed occurrence is audited and retried once per
scheduler reconciliation interval.

Scheduled drafts follow the same composition resolution, deduplication,
validation, and persistence path as
`POST /api/release-tracks/:id/virtual/snapshots/create`. They also include:

```json
{
  "scheduled_materialization": {
    "schedule_mode": "cron",
    "scheduled_for": "2027-01-01T00:00:00.000Z"
  }
}
```

Clients may attach the same strict object to the initial virtual snapshot with
`POST /api/release-tracks/new`, or to the pending draft created by
`PUT /api/release-tracks/:id/virtual/composition`, or to an explicitly
materialized draft with
`POST /api/release-tracks/:id/virtual/snapshots/create`. `schedule_mode` must
be `cron` or `dates`, `scheduled_for` must be an ISO timestamp, and unknown
keys are rejected. Standard tracks cannot set this property.

The persisted value is observable through `GET /api/release-tracks`, snapshot
history, latest-snapshot retrieval, and timestamp-selected snapshot retrieval.
It belongs to one immutable snapshot occurrence; later snapshot clones omit it
unless the write creating that snapshot supplies a new value.

### 2. Snapshot Review

Before tagging, team reviews the draft snapshot:

```bash
GET /api/release-tracks/:id/snapshots/:modified?format=workbench&include=all
```

**Response includes:**

- All objects that will be in the release
- Composition resolution details (which component versions were used)
- The exact persisted members and quarantine tiers

### 3. Release Preview

Preview the selected draft against its preceding tagged release:

```bash
GET /api/release-tracks/:id/snapshots/:modified/release/preview
```

The summary reports the next version, previous tagged release, type-oriented
before/after counts, and new, updated, removed, and quarantined object counts.
Use `format=workbench` for the literal would-be tagged snapshot or
`format=bundle` for its publication artifact. Previewing does not persist and
never re-resolves composition.

### 4. Snapshot Tagging

Once reviewed, explicitly tag the draft snapshot:

```bash
POST /api/release-tracks/:id/snapshots/:modified/release
```

**Request:**

```json
{
  "increment": "major" // or "minor", or explicit "version": "14.0"
}
```

**Response:**

```json
{
  "id": "release-track--uuid-virtual",
  "type": "virtual",
  "snapshot_id": "2024-03-01T10:00:00.000Z",
  "modified": "2024-03-01T10:00:00Z",
  "version": "14.0",
  "name": "Enterprise ATT&CK",

  "composition_resolution": {
    "resolved_at": "2024-03-01T10:00:00Z",
    "component_snapshots": [...]
  },

  "version_history": [
    {
      "version": "14.0",
      "tagged_at": "2024-03-05T14:00:00Z",
      "tagged_by": "admin@example.com",
      "snapshot_id": "2024-03-01T10:00:00.000Z",
      "component_versions": {
        "release-track--groups-monthly": "5.2",
        "release-track--techniques-quarterly": "2.1"
      }
    }
  ]
}
```

`component_versions` is keyed by immutable component track ID. Values are
tagged version strings or `null` for draft components, copied from the selected
virtual draft's `composition_resolution`. If a component advances or is tagged
after materialization, the virtual release still records its original source
state and exact snapshot ID. Standard release history entries omit this
virtual-only property.

The snapshot-history endpoint (`GET /api/release-tracks/:id/snapshots`) also
returns the provenance portion of each virtual snapshot's
`composition_resolution`: `resolved_at` and `component_snapshots`. This lets
clients present provenance beside the draft or release it describes rather
than presenting only the virtual track's current HEAD resolution. In each
component entry, `resolved_snapshot_id` is the exact component snapshot's
creation timestamp and stable retrieval key; `resolved_version` names its
tagged version or is `null` for a draft. The stored source, filtered, and contributed counts belong to
that materialization and are not recomputed from the component track's current
state. Full snapshot retrieval additionally returns the deduplication report
and resolution summary.

**Business Logic:**

1. Validate snapshot exists and is a draft (version === null)
2. Calculate/validate version number
3. Set version on snapshot (in-place update)
4. Copy resolved component versions into the virtual release-history entry
5. Add entry to version_history
6. Snapshot is now immutable

### 5. Snapshot Export

Export virtual track snapshot as STIX bundle:

```bash
# STIX 2.1 (default)
GET /api/release-tracks/:id/snapshots/:modified?format=bundle

# STIX 2.0
GET /api/release-tracks/:id/snapshots/:modified?format=bundle&stixVersion=2.0
```

**Response:**

```json
{
  "type": "bundle",
  "id": "bundle--uuid",
  "objects": [
    {
      "type": "x-mitre-collection",
      "id": "x-mitre-collection--virtual-uuid",
      "modified": "2024-03-01T10:00:00Z",
      "x_mitre_version": "14.0",
      "name": "Enterprise ATT&CK",
      "x_mitre_contents": [
        { "object_ref": "intrusion-set--APT1", "object_modified": "2024-02-01T10:00:00Z" },
        { "object_ref": "intrusion-set--APT2", "object_modified": "2024-01-15T10:00:00Z" },
        { "object_ref": "attack-pattern--T1234", "object_modified": "2024-01-10T10:00:00Z" }
        // ... all 870 objects
      ]
    }
    // ... all 870 actual STIX objects
  ]
}
```

The default is STIX 2.1. Set `stixVersion=2.0` to serialize the same exact
materialized revision set under the STIX 2.0 rules used by the legacy bundle
exporter. A STIX 2.0 bundle carries `spec_version: "2.0"` on its envelope and
omits `spec_version` from its objects; a STIX 2.1 bundle omits the envelope
property and declares `spec_version: "2.1"` on each object. Version-specific
object conversion also applies, including malware/tool label handling.

**Note:** The exported bundle is **materialized** - it contains concrete object references, not composition metadata. Consumers see a standard STIX bundle, unaware it came from a virtual track.

## Composition Resolution Details

### Resolution Metadata

Each virtual track snapshot stores metadata about how it was composed:

```javascript
{
  // Identity and snapshot metadata
  id: "release-track--uuid-virtual",
  type: "virtual",
  snapshot_id: "2024-03-01T10:00:00.000Z",
  modified: "2024-03-01T10:00:00Z",
  version: "14.0",

  // Composition resolution metadata
  composition_resolution: {
    resolved_at: "2024-03-01T10:00:00Z",

    component_snapshots: [
      {
        track_id: "release-track--uuid-1",
        track_name: "Groups Monthly",
        track_type: "standard",

        // Which snapshot was used
        resolved_snapshot_id: "2024-02-15T10:00:00.000Z",
        resolved_version: "5.2",

        // How it was resolved
        strategy_used: "latest_tagged",
        filters_applied: {
          object_types: ["intrusion-set"]
        },

        // Statistics
        total_objects_in_source: 47,
        objects_after_filter: 47,
        objects_contributed: 47  // After deduplication
      }
    ],

    // Deduplication report
    deduplication: {
      total_objects_before: 870,
      total_objects_after: 870,
      duplicates_found: 0,
      conflicts_resolved: []
    },

    // Final statistics
    summary: {
      total_objects: 870,
      by_type: {
        "intrusion-set": 47,
        "attack-pattern": 823
      },
      by_tier: {
        "members": 870,
        "staged": 0,
        "candidates": 0
      }
    }
  }
}
```

### Validation Rules

#### 1. Component snapshots must satisfy their resolution strategy

`latest_tagged`, `specific_version`, and `specific_snapshot` require a tagged
source. `latest_preview` accepts the newest standard snapshot whether tagged or
untagged. Draft preview conflicts block materialization before filters. Component
identity and type are validated when composition is configured; snapshot
eligibility and prospective membership are checked at materialization.

#### 2. Component tracks must be standard tracks

```javascript
// When creating/updating virtual track composition
async function validateComponentsAreStandard(virtualTrack) {
  for (const component of virtualTrack.composition.component_tracks) {
    const track = await getReleaseTrack(component.track_id);

    if (track.type === 'virtual') {
      throw new ValidationError(
        `Virtual tracks can only compose from standard tracks. ` +
          `Component track ${component.track_id} is a virtual track.`,
      );
    }
  }
}
```

## API Reference

### Create Virtual Track

```bash
POST /api/release-tracks/new
```

**Request:**

```json
{
  "type": "virtual",
  "name": "Enterprise ATT&CK",
  "description": "Virtual aggregation of Enterprise content",

  "composition": {
    "component_tracks": [
      {
        "track_id": "release-track--uuid-1",
        "resolution_strategy": "latest_tagged",
        "priority": 0,
        "filters": {
          "object_types": ["intrusion-set"]
        }
      }
    ],
    "deduplication": {
      "strategy": "prioritize_latest_object"
    }
  },

  "snapshot_schedule": {
    "mode": "cron",
    "cron": "0 0 1 1,7 *"
  }
}
```

### Update Composition

```bash
PUT /api/release-tracks/:id/virtual/composition
```

**Request:**

```json
{
  "component_tracks": [
    {
      "track_id": "release-track--uuid-1",
      "resolution_strategy": "latest_tagged",
      "priority": 0
    },
    {
      "track_id": "release-track--uuid-2",
      "resolution_strategy": "specific_version",
      "version": "2.0",
      "priority": 1
    }
  ]
}
```

Composition requests are strict at every nested level. Unknown composition,
component, filter, or deduplication properties return `400 Bad Request`.
Selector fields must match `resolution_strategy`: `latest_tagged` accepts
neither selector, `specific_version` requires only `version`, and
`specific_snapshot` requires only `snapshot`.
Every component also requires a unique, non-negative integer `priority`.
Referenced tracks must exist and must be standard tracks; these rules are
checked during initial virtual-track creation as well as composition updates.

**Note:** Updating composition creates a pending draft with the new rules and
invalidates any previously materialized contents. The draft has empty
`members` and `quarantine` arrays and `composition_resolution: null`. Run the
virtual snapshot creation operation before attempting release preview or
tagging; those release operations return `409 Conflict` for a pending draft.

### Create Virtual Snapshot

```bash
POST /api/release-tracks/:id/virtual/snapshots/create
```

**Request:**

```json
{
  "description": "Q1 2024 snapshot"
}
```

### Tag Virtual Snapshot

```bash
POST /api/release-tracks/:id/snapshots/:modified/release
```

**Request:**

```json
{
  "increment": "major"
}
```

Release preview uses the same shared path as standard tracks:

```bash
GET /api/release-tracks/:id/snapshots/:modified/release/preview
```

Virtual composition is not recomputed during preview or release. The summary
compares the selected persisted draft with the tagged release that immediately
preceded it, reporting members/quarantine counts and new, updated, removed, and
quarantined object counts. Use `format=workbench` or `format=bundle` to inspect
the literal snapshot or publication artifact that would be tagged. The draft
must have a non-null `composition_resolution`, proving that its members and
quarantine tiers were materialized from its current composition.
Bundle preview resolves the same closed-member graph live. Tagging publishes
the content manifest sealed at materialization unchanged and freezes the
collection object's publication metadata.

### Retrieve a Materialized Virtual Snapshot

```bash
GET /api/release-tracks/:id/snapshots/latest?format=workbench&include=all
```

**Query params:**

- `format`: `bundle` | `workbench` | `filesystemstore` (`filesystemstore` is not yet implemented and returns HTTP 501)
- `include`: `members` | `quarantine` | `all`

There is no `resolve` query parameter and no `resolved_content` response
property. Composition is resolved eagerly when the virtual draft is created.
The concrete `members`, `quarantine`, and `composition_resolution` fields are
stored directly on that snapshot and are returned without consulting the
component tracks again.

Every member and quarantined entry contains an exact
`(object_ref, object_modified)` pair. Standard candidate and staged entries may
persist the dynamic selector `"latest"`, but standard release planning resolves
it before promoting those entries into members. Direct standard member
replacement likewise resolves `"latest"` before persistence. A component
track's `track_latest` member-sync policy can create or move dynamic workflow
selectors in newer component drafts, but it cannot change the exact members
already present in a tagged component snapshot or in an existing virtual
snapshot.

Consequently, while the track does not acquire a newer snapshot,
`GET /snapshots/latest` returns the same primary member revision set.
`GET /snapshots/:modified` identifies that persisted set directly. The
`latest` path segment selects the most recent snapshot; it is not a dynamic
object-revision selector.

This guarantee also covers `format=bundle`: materialization seals a content
manifest that emits only exact members plus relationships whose source and
target are both members; supporting objects and LinkById render targets are
pinned as dependencies. Released snapshots also carry a stable bundle
identifier and hashes. See
[Bundle Export](../../developer/release-tracks/bundle-export.md#sealed-content-manifests).

## Quarantine Management

When using the `quarantine` deduplication strategy, conflicting objects are stored in the virtual track's `quarantine` tier. Users must manually resolve these conflicts:

**View quarantined objects:**

```bash
GET /api/release-tracks/:id/snapshots/latest?include=quarantine
```

**Manually promote a quarantined object to members:**

```bash
POST /api/release-tracks/:id/virtual/quarantine/promote
```

**Request:**

```json
{
  "object_ref": "intrusion-set--11111111-1111-4111-8111-111111111111",
  "object_modified": "2024-02-01T10:00:00Z"
}
```

**Effect:**

- Requires the exact `(object_ref, object_modified)` pair to be quarantined
- Creates a new draft with the selected revision in `members`
- Replaces any prior member revision with the same `object_ref`
- Removes every version of the same object from `quarantine`
- Leaves the materialized source snapshot and its composition-resolution
  provenance unchanged
- Reconciles object back-references to the new latest snapshot
- Allows the next snapshot tagging operation to include the selected revision

Malformed requests and attempts against standard tracks return `400 Bad
Request`. Selecting a revision that is not quarantined returns `404 Not Found`
without creating a snapshot.

## Pure Composition

Virtual tracks do not own native members and cannot compose other virtual
tracks. Every member must originate from a tagged snapshot of a standard
component track. This keeps one authoritative object lifecycle and one
membership authority for every contributed object.

If an aggregate needs content that does not belong in its existing component
tracks, create a dedicated standard track for that content and add it to the
virtual composition. Requests containing unsupported properties such as
`native_members`, or composition entries that reference a virtual track,
return `400 Bad Request`.

## Migration Strategy

### Phase 1: Create Standard Tracks

```bash
# Create standard tracks for each object type
POST /api/release-tracks/new
{
  "name": "Groups Monthly",
  "description": "All intrusion-set objects"
}

# Add existing Groups as candidates
POST /api/release-tracks/release-track--uuid-1/candidates
{
  "object_refs": ["intrusion-set--APT1", "intrusion-set--APT2", ...]
}

# Tag initial release
POST /api/release-tracks/release-track--uuid-1/snapshots/latest/release
{ "version": "1.0" }
```

### Phase 2: Create Virtual Track

```bash
POST /api/release-tracks/new
{
  "type": "virtual",
  "name": "Enterprise ATT&CK",
  "composition": {
    "component_tracks": [
      {
        "track_id": "release-track--uuid-1",
        "resolution_strategy": "latest_tagged",
        "priority": 0
      },
      {
        "track_id": "release-track--uuid-2",
        "resolution_strategy": "latest_tagged",
        "priority": 1
      }
    ]
  },
  "snapshot_schedule": {
    "mode": "dates",
    "dates": ["2024-07-01T00:00:00Z", "2025-01-01T00:00:00Z"]
  }
}
```

### Phase 3: Create First Virtual Snapshot

```bash
# Manually trigger first snapshot
POST /api/release-tracks/release-track--uuid-virtual/virtual/snapshots/create

# Review draft snapshot
GET /api/release-tracks/release-track--uuid-virtual/snapshots/:modified

# Tag as Enterprise v14.0
POST /api/release-tracks/release-track--uuid-virtual/snapshots/:modified/release
{ "version": "14.0" }
```

### Phase 4: Ongoing Workflow

```
Timeline:

Jan 15: GroupsMonthly releases v1.1 (updated Groups)
Feb 15: GroupsMonthly releases v1.2 (more updates)
Mar 15: TechniquesQuarterly releases v2.1 (updated Techniques)
Apr 15: GroupsMonthly releases v1.3

July 1: Enterprise scheduled snapshot triggers
  → Resolves GroupsMonthly v1.3 (latest tagged)
  → Resolves TechniquesQuarterly v2.1 (latest tagged)
  → Creates draft snapshot

July 5: Team reviews draft, tags as Enterprise v14.1
```

## Implementation Characteristics

### 1. Eager, Parallel Component Resolution

Virtual composition is resolved only during explicit or scheduled snapshot
creation. Component snapshots are fetched in parallel:

Resolve component tracks in parallel:

```javascript
const resolutions = await Promise.all(
  composition.component_tracks.map(async (component) => {
    return await resolveComponentSnapshot(component);
  }),
);
```

### 2. Deduplication

Use Set for O(1) duplicate detection:

```javascript
const seen = new Set();
const deduplicated = [];

for (const obj of allObjects) {
  const key = `${obj.object_ref}:${obj.object_modified}`;
  if (!seen.has(key)) {
    seen.add(key);
    deduplicated.push(obj);
  }
}
```

The persisted snapshot is already the reusable composition result. No
cross-request snapshot cache is implemented. Caching should be considered only
if measured bundle-rendering latency or database load justifies the additional
invalidation and multi-instance consistency work.

## Best Practices

### 1. Snapshot Before Tagging

Always create snapshot, review, then tag:

```bash
# Create draft
POST /api/release-tracks/:id/virtual/snapshots/create

# Review
GET /api/release-tracks/:id/snapshots/:modified?format=workbench

# Preview release artifact
GET /api/release-tracks/:id/snapshots/:modified/release/preview?format=bundle

# Tag only when satisfied
POST /api/release-tracks/:id/snapshots/:modified/release
```

If composition changes after materialization, repeat the create step. Direct
member replacement is not supported.

### 2. Use Scheduled Snapshots for Consistency

Define snapshot schedule up front:

```javascript
snapshot_schedule: {
  mode: "dates",
  dates: [
    "2024-01-15T00:00:00Z",
    "2024-07-15T00:00:00Z",
    "2025-01-15T00:00:00Z"
  ]
}
```

### 3. Document Component Versions

Add metadata to virtual track for documentation:

```javascript
{
  description: 'Enterprise ATT&CK v14.0 includes:\n' +
    '- Groups Monthly v1.3 (47 Groups)\n' +
    '- Techniques Quarterly v2.1 (823 Techniques)\n' +
    '- Software Biannual v1.0 (450 Software)';
}
```

## Limitations

### 1. No Event-Driven Snapshots

Virtual tracks do NOT automatically snapshot when component tracks release.

**Rationale:** Prevents snapshot explosion when many component tracks release frequently.

**Alternative:** Create snapshots manually or configure a cron/date schedule.
Component-release notifications are not implemented; they require an approved
operator workflow defining recipients, delivery channel, deduplication, and
the expected follow-up action.

### 2. No Workflow on Composed Objects

Virtual tracks cannot transition workflow status of composed objects.

**Rationale:** Composed objects are owned by standard tracks; virtual tracks are read-only views.

**Alternative:** If you need to change object status, do it in the source standard track.

### 3. Preview Excludes Candidates

`latest_preview` composes members plus staged changes under the source's release
conflict policy, without actually releasing or promoting source content.
Candidates remain excluded. Stage an intended change before previewing it in a
virtual composition; source publication is not required.

## Error Handling

### Error: Component Preview Has a Blocking Conflict

A draft whose staged-to-members promotion would fail also fails virtual
materialization with `409 Conflict`. The response identifies the source track
and conflicts. Resolve the source conflict or deliberately change its promotion
policy; component filters do not bypass this requirement.

### Error: Retired `latest_draft` Rule

New requests reject the retired rule with `400 Bad Request`. Existing saved
rules also block materialization until an operator explicitly replaces them in
Config. Choose `latest_preview` for staged changes or `latest_tagged` for
published content. Historical snapshots are not relabeled or recomputed.

### Error: Component Has No Tagged Snapshots

```json
{
  "error": "NoTaggedSnapshotsError",
  "message": "Component track 'GroupsMonthly' has no tagged releases",
  "resolution": "Tag at least one snapshot in the component track before creating virtual snapshot"
}
```

### Error: Component Is Virtual Track

```json
{
  "error": "InvalidComponentTypeError",
  "message": "Virtual tracks can only compose from standard tracks. Component 'release-track--uuid-x' is a virtual track.",
  "resolution": "Remove the virtual track from component_tracks. Virtual tracks cannot compose from other virtual tracks."
}
```
