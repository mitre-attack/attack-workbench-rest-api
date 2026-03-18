# Virtual Release Tracks

## Overview

Virtual release tracks are computed aggregations of standard release tracks. They provide a way to compose releases from multiple source tracks without duplicating object tracking, reducing mental overhead and storage requirements.

**Key Characteristics:**
- Virtual tracks **compute** their contents from component standard tracks
- Only reference **tagged snapshots** from standard tracks (never drafts)
- Maintain their own **independent snapshot history and versioning**
- Create snapshots **manually or on schedule** (never event-driven)
- All snapshots start as **drafts** and must be explicitly tagged

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
        priority: 1,  // Used with prioritize_higher_priority strategy (lower number = higher priority)
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
    mode: "manual",  // "manual" | "cron" | "dates"
    cron: "0 0 1 1,7 *",  // Jan 1 and July 1 at midnight
    dates: ["2024-01-01T00:00:00Z", "2024-07-01T00:00:00Z"]
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
  resolution_strategy: "latest_tagged"
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
  version: "5.0"
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
  snapshot: "2024-02-01T10:00:00Z"
}

// At virtual snapshot time:
// 1. Query GroupsMonthly for snapshot where modified === "2024-02-01T10:00:00Z"
// → Resolves to that specific snapshot
```

**Use case:** "Lock to exact snapshot for reproducibility"

### Component Track Sync Rules

Virtual tracks **only sync from component tracks' `members` tier** (`x_mitre_contents`). This ensures that virtual tracks only aggregate objects that have been officially released in their source tracks.

**Important:**
- Virtual tracks reference **tagged snapshots only** (never drafts)
- Virtual tracks pull objects from **`members` tier only** (never staged or candidates)
- This guarantees that virtual track releases are composed of stable, released content

**Rationale:** Since virtual tracks can only reference tagged snapshots from component tracks, it makes sense to only pull from the `members` tier, which contains the released objects from those snapshots.

### Filters

Each component track can specify filters to limit which objects are included:

```javascript
filters: {
  // Only include specific object types
  object_types: ["intrusion-set", "malware"],

  // Only include objects with specific domains (if applicable)
  domains: ["enterprise", "mobile"],

  // Only include objects matching STIX filter pattern (advanced)
  stix_pattern: {
    "x_mitre_platforms": { "$in": ["Windows", "macOS"] }
  }
}
```

### Deduplication Strategies

When multiple component tracks contain the same object (same `stix.id`), a conflict occurs during the sync operation. The virtual track's deduplication strategy determines how to resolve the conflict. Four strategies are available:

#### 1. `prioritize_latest_object`

Keep the version with the newest `modified` timestamp, regardless of which component track it came from.

```javascript
deduplication: {
  strategy: "prioritize_latest_object"
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
  strategy: "prioritize_latest_snapshot"
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

Keep the version from the component track with the higher priority (lower priority number). Each component track must have a unique priority value.

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

```javascript
deduplication: {
  strategy: "quarantine"
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

**Follow-up workflow:** Users review the quarantined objects and manually promote one version to `members` during a future snapshot update. The quarantined objects remain in the virtual track until manual intervention occurs.

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

| Feature | Standard Track | Virtual Track |
|---------|---------------|---------------|
| Tiers | candidates, staged, members | quarantine, members |
| Object management | Direct (add/remove objects) | Indirect (synced from components) |
| Workflow states | work-in-progress, awaiting-review, reviewed | N/A |
| Auto-promotion | Based on candidacy threshold | N/A |
| Manual promotion | candidates → staged → members | quarantine → members |

**Why only two tiers?**

Virtual tracks aggregate content from component tracks that have already gone through the full workflow (candidates → staged → members). Virtual tracks don't need the intermediate `staged` tier because they're composing already-released content. The only workflow step is resolving conflicts via the `quarantine` tier.

## Virtual Track Snapshot Lifecycle

### 1. Snapshot Creation

Virtual track snapshots are created either **manually** or **on schedule**.

#### Manual Snapshot

```bash
POST /api/release-tracks/:id/snapshots/create
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
1. For each component track in `composition.component_tracks`:
   - Resolve snapshot based on `resolution_strategy`
   - **Validate that resolved snapshot is tagged** (version !== null)
   - Pull objects from component track's **`members` tier only** (`x_mitre_contents`)
   - Apply `filters` to get subset of objects
   - Collect all object references with source metadata
2. Apply deduplication rules across all components:
   - If no conflicts: objects go to virtual track's `members`
   - If conflicts + `quarantine` strategy: both versions go to `quarantine`
   - If conflicts + other strategies: winning version goes to `members`
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

**Scheduler integration:**
```javascript
scheduler.register({
  type: "virtual-track-snapshot",
  trackId: "release-track--uuid-virtual",
  schedule: "0 0 1 1,7 *",
  handler: async (trackId) => {
    await virtualTrackService.createSnapshot(trackId, {
      description: `Scheduled snapshot ${new Date().toISOString()}`
    });

    // Optionally notify team
    await notificationService.send({
      to: "enterprise-team@example.com",
      subject: "Enterprise ATT&CK snapshot created",
      body: "A new draft snapshot is ready for review and tagging"
    });
  }
});
```

### 2. Snapshot Review

Before tagging, team reviews the draft snapshot:

```bash
GET /api/release-tracks/:id/snapshots/:modified?format=workbench&include=all
```

**Response includes:**
- All objects that will be in the release
- Composition resolution details (which component versions were used)
- Statistics and diff from previous tagged release

### 3. Snapshot Tagging

Once reviewed, explicitly tag the draft snapshot:

```bash
POST /api/release-tracks/:id/snapshots/:modified/bump
```

**Request:**
```json
{
  "type": "major",  // or "minor", or explicit "version": "14.0"
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
        "Groups Monthly": "5.2",
        "Techniques Quarterly": "2.1"
      }
    }
  ]
}
```

**Business Logic:**
1. Validate snapshot exists and is a draft (version === null)
2. Calculate/validate version number
3. Set version on snapshot (in-place update)
4. Add entry to version_history
5. Snapshot is now immutable

### 4. Snapshot Export

Export virtual track snapshot as STIX bundle:

```bash
GET /api/release-tracks/:id/snapshots/:modified?format=bundle
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
    },
    // ... all 870 actual STIX objects
  ]
}
```

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

    // Native objects (if any)
    native_objects: {
      candidates_count: 0,
      staged_count: 0,
      members_count: 0
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

#### 1. Component tracks must have tagged snapshots

```javascript
// When creating virtual snapshot
for (const component of composition.component_tracks) {
  const snapshot = await resolveSnapshot(component);

  if (snapshot.version === null) {
    throw new ValidationError(
      `Component track ${component.track_id} resolved to draft snapshot. ` +
      `Virtual tracks can only reference tagged snapshots.`
    );
  }
}
```

**User experience:**
```bash
POST /api/release-tracks/release-track--uuid-virtual/snapshots/create

# Error response:
{
  "error": "ValidationError",
  "message": "Cannot create virtual snapshot: component track 'GroupsMonthly' has no tagged releases",
  "details": {
    "component": "release-track--uuid-1",
    "issue": "No tagged snapshots found (all snapshots are drafts)"
  }
}
```

#### 2. Component tracks must be standard tracks

```javascript
// When creating/updating virtual track composition
async function validateComponentsAreStandard(virtualTrack) {
  for (const component of virtualTrack.composition.component_tracks) {
    const track = await getReleaseTrack(component.track_id);

    if (track.type === "virtual") {
      throw new ValidationError(
        `Virtual tracks can only compose from standard tracks. ` +
        `Component track ${component.track_id} is a virtual track.`
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
        "filters": {
          "object_types": ["intrusion-set"]
        }
      }
    ],
    "deduplication": {
      "strategy": "prefer_latest_modified",
      "tier_resolution": "highest_tier",
      "status_resolution": "highest_status"
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
PUT /api/release-tracks/:id/composition
```

**Request:**
```json
{
  "component_tracks": [
    {
      "track_id": "release-track--uuid-1",
      "resolution_strategy": "latest_tagged"
    },
    {
      "track_id": "release-track--uuid-2",
      "resolution_strategy": "specific_version",
      "version": "2.0"
    }
  ]
}
```

**Note:** Updating composition creates a new draft snapshot with the new composition rules.

### Create Virtual Snapshot

```bash
POST /api/release-tracks/:id/snapshots/create
```

**Request:**
```json
{
  "description": "Q1 2024 snapshot"
}
```

### Preview Virtual Snapshot

Preview what a snapshot would contain without creating it:

```bash
GET /api/release-tracks/:id/snapshots/preview
```

**Response:**
```json
{
  "preview": {
    "would_resolve_to": {
      "component_snapshots": [...],
      "total_objects": 870
    },
    "comparison_to_latest_tagged": {
      "current_version": "13.1",
      "new_objects": 12,
      "updated_objects": 45,
      "removed_objects": 3
    }
  }
}
```

### Tag Virtual Snapshot

```bash
POST /api/release-tracks/:id/snapshots/:modified/bump
```

**Request:**
```json
{
  "type": "major"
}
```

### Get Virtual Track with Resolved Content

```bash
GET /api/release-tracks/:id?format=workbench&include=all
```

**Query params:**
- `format`: `bundle` | `workbench` | `filesystemstore`
- `include`: `members` | `quarantine` | `all`
- `resolve`: `true` (default) | `false` - Whether to resolve composition

**Response when `resolve=true`:**
```json
{
  "id": "release-track--uuid-virtual",
  "type": "virtual",
  "snapshot_id": "2024-03-05T10:00:00.000Z",
  "modified": "2024-03-05T10:00:00Z",
  "version": null,
  "name": "Enterprise ATT&CK",

  "resolved_content": {
    "members": [
      {
        "object_ref": "intrusion-set--APT1",
        "object_modified": "2024-02-01T10:00:00Z",
        "source_track": "release-track--uuid-1",
        "source_version": "5.2"
      }
      // ... all resolved objects
    ],
    "quarantine": []
  },

  "composition_resolution": {
    "resolved_at": "2024-03-05T10:00:00Z",
    "component_snapshots": [...]
  }
}
```

## Quarantine Management

When using the `quarantine` deduplication strategy, conflicting objects are stored in the virtual track's `quarantine` tier. Users must manually resolve these conflicts:

**View quarantined objects:**
```bash
GET /api/release-tracks/:id?include=quarantine
```

**Manually promote a quarantined object to members:**
```bash
POST /api/release-tracks/:id/quarantine/promote
```

**Request:**
```json
{
  "object_ref": "intrusion-set--APT1",
  "object_modified": "2024-02-01T10:00:00Z"
}
```

**Effect:**
- Moves the specified version from `quarantine` to `members`
- Removes other versions of the same object from `quarantine`
- Next snapshot tagging will include this object in the release

## Hybrid Model: Virtual Track + Native Objects

Virtual tracks can optionally have **native objects** in addition to composed content. This is an advanced use case where a virtual track needs to include objects that don't exist in any component track:

```javascript
{
  id: "release-track--uuid-virtual",
  type: "virtual",

  // Composed from standard tracks
  composition: {
    component_tracks: [
      { track_id: "release-track--uuid-1", priority: 1 },
      { track_id: "release-track--uuid-2", priority: 2 }
    ],
    deduplication: {
      strategy: "prioritize_latest_object"
    }
  },

  // PLUS virtual track's own native members
  native_members: [
    {
      object_ref: "marking-definition--enterprise-only",
      object_modified: "2024-01-01T10:00:00Z"
    }
  ],

  // Final result after sync
  members: [
    // ... objects from component tracks
    // ... plus native_members
  ],
  quarantine: []
}
```

**Use case:** Enterprise track includes Groups and Techniques from standard tracks, PLUS Enterprise-specific marking definitions or custom objects that don't belong in any component track.

**When virtual snapshot is created:**
1. Resolve composed content from component tracks (goes to `members` or `quarantine`)
2. Merge with virtual track's `native_members` (goes to `members`)
3. If any `native_members` conflict with composed objects, apply deduplication strategy

**Note:** This is an advanced feature. Most virtual tracks should only use composition without native members.

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
POST /api/release-tracks/release-track--uuid-1/bump
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
        "resolution_strategy": "latest_tagged"
      },
      {
        "track_id": "release-track--uuid-2",
        "resolution_strategy": "latest_tagged"
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
POST /api/release-tracks/release-track--uuid-virtual/snapshots/create

# Review draft snapshot
GET /api/release-tracks/release-track--uuid-virtual/snapshots/:modified

# Tag as Enterprise v14.0
POST /api/release-tracks/release-track--uuid-virtual/snapshots/:modified/bump
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

## Performance Optimizations

### 1. Snapshot Caching

Since virtual snapshots are immutable once created, cache resolved content:

```javascript
const cacheKey = `virtual-snapshot:${trackId}:${modified}:resolved`;

const cached = await cache.get(cacheKey);
if (cached) return cached;

const resolved = await resolveVirtualSnapshot(trackId, modified);
await cache.set(cacheKey, resolved, { ttl: 3600 });  // 1 hour cache
```

### 2. Lazy Resolution

For `GET /api/release-tracks/:id` (latest snapshot), only resolve if:
- Query param `resolve=true` is specified
- Format requires resolution (e.g., `format=bundle`)

Otherwise, return composition metadata without resolving:

```javascript
if (!query.resolve && query.format === 'workbench') {
  // Return composition config without resolving
  return {
    id: snapshot.id,
    type: snapshot.type,
    snapshot_id: snapshot.snapshot_id,
    modified: snapshot.modified,
    version: snapshot.version,
    name: snapshot.name,
    composition: snapshot.composition,
    composition_resolution: snapshot.composition_resolution  // Pre-computed
  };
}
```

### 3. Parallel Component Resolution

Resolve component tracks in parallel:

```javascript
const resolutions = await Promise.all(
  composition.component_tracks.map(async (component) => {
    return await resolveComponentSnapshot(component);
  })
);
```

### 4. Deduplication Optimization

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

## Best Practices

### 1. Snapshot Before Tagging

Always create snapshot, review, then tag:

```bash
# Create draft
POST /api/release-tracks/:id/snapshots/create

# Review
GET /api/release-tracks/:id/snapshots/:modified?format=workbench

# Preview export
GET /api/release-tracks/:id/snapshots/:modified?format=bundle

# Tag only when satisfied
POST /api/release-tracks/:id/snapshots/:modified/bump
```

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
  description: "Enterprise ATT&CK v14.0 includes:\n" +
    "- Groups Monthly v1.3 (47 Groups)\n" +
    "- Techniques Quarterly v2.1 (823 Techniques)\n" +
    "- Software Biannual v1.0 (450 Software)"
}
```

### 4. Monitor Component Track Releases

Set up alerts when component tracks release:

```javascript
eventBus.on('release-track:released', async (event) => {
  // Find virtual tracks that reference this standard track
  const virtualTracks = await findVirtualTracksByComponent(event.collectionId);

  // Notify virtual track owners
  for (const vt of virtualTracks) {
    await notificationService.send({
      to: vt.owner_email,
      subject: `Component track ${event.collectionName} released v${event.version}`,
      body: `Your virtual track "${vt.name}" references this component. ` +
        `Consider creating a new snapshot to include the latest release.`
    });
  }
});
```

## Limitations

### 1. No Event-Driven Snapshots

Virtual tracks do NOT automatically snapshot when component tracks release.

**Rationale:** Prevents snapshot explosion when many component tracks release frequently.

**Alternative:** Use notifications + manual snapshots, or scheduled snapshots.

### 2. No Workflow on Composed Objects

Virtual tracks cannot transition workflow status of composed objects.

**Rationale:** Composed objects are owned by standard tracks; virtual tracks are read-only views.

**Alternative:** If you need to change object status, do it in the source standard track.

### 3. Only Reference Tagged Snapshots

Virtual tracks cannot compose from draft snapshots.

**Rationale:** Ensures stability and prevents virtual snapshots from inadvertently including WIP content.

**Alternative:** Tag the standard track snapshot first, then create virtual snapshot.

## Error Handling

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
