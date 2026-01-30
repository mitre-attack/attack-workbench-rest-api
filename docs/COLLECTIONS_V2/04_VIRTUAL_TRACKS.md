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
  stix: {
    id: "x-mitre-collection--virtual-uuid",
    type: "virtual",  // Distinguishes from standard tracks
    modified: "2024-03-01T10:00:00Z",
    x_mitre_version: null,  // Draft snapshot (or "14.0" if tagged)
    name: "Enterprise ATT&CK",
    description: "Virtual aggregation of Enterprise content"
  },

  workspace: {
    // Composition rules (how to build this virtual track)
    composition: {
      component_tracks: [
        {
          track_id: "GroupsMonthly--uuid",
          resolution_strategy: "latest_tagged",
          filters: {
            object_types: ["intrusion-set"],
            // Additional filters...
          }
        },
        {
          track_id: "TechniquesQuarterly--uuid",
          resolution_strategy: "latest_tagged",
          filters: {
            object_types: ["attack-pattern"]
          }
        }
      ],

      deduplication: {
        strategy: "prefer_latest_modified",
        tier_resolution: "highest_tier",
        status_resolution: "highest_status"
      }
    },

    // Snapshot schedule configuration
    snapshot_schedule: {
      mode: "manual" | "cron" | "dates",
      cron: "0 0 1 1,7 *",  // Jan 1 and July 1 at midnight
      dates: ["2024-01-01T00:00:00Z", "2024-07-01T00:00:00Z"]
    },

    // Optional: Virtual track can also have its own native objects
    candidates: [],  // Virtual track's own objects (not from components)
    staged: [],

    config: {
      candidacy_threshold: "reviewed",
      auto_promote: true
    },

    version_history: []
  }
}
```

## Composition Resolution

### Resolution Strategies

#### 1. `latest_tagged`

Always resolves to the most recent **tagged snapshot** from the component track.

```javascript
{
  track_id: "GroupsMonthly--uuid",
  resolution_strategy: "latest_tagged"
}

// At virtual snapshot time (e.g., March 1, 2024):
// 1. Query GroupsMonthly for all snapshots where x_mitre_version !== null
// 2. Sort by stix.modified DESC
// 3. Take first result
// → Resolves to GroupsMonthly v5.2 (released Feb 15, 2024)
```

**Use case:** "Always include the latest Groups release in Enterprise"

#### 2. `specific_version`

Resolves to a specific semantic version from the component track.

```javascript
{
  track_id: "GroupsMonthly--uuid",
  resolution_strategy: "specific_version",
  version: "5.0"
}

// At virtual snapshot time:
// 1. Query GroupsMonthly for snapshot where x_mitre_version === "5.0"
// → Resolves to GroupsMonthly v5.0 (regardless of when snapshot occurs)
```

**Use case:** "Pin Enterprise to Groups v5.0 until we're ready to upgrade"

#### 3. `specific_snapshot`

Resolves to a specific snapshot by its `stix.modified` timestamp.

```javascript
{
  track_id: "GroupsMonthly--uuid",
  resolution_strategy: "specific_snapshot",
  snapshot: "2024-02-01T10:00:00Z"
}

// At virtual snapshot time:
// 1. Query GroupsMonthly for snapshot where stix.modified === "2024-02-01T10:00:00Z"
// → Resolves to that specific snapshot
```

**Use case:** "Lock to exact snapshot for reproducibility"

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

### Deduplication Rules

When multiple component tracks contain the same object:

```javascript
deduplication: {
  // Which version of the object to include
  strategy: "prefer_latest_modified" | "prefer_highest_version" | "error",

  // If object is in different tiers across components, which tier wins?
  tier_resolution: "highest_tier" | "source_priority",

  // If object has different statuses across components, which status wins?
  status_resolution: "highest_status" | "source_priority"
}
```

**Example:**

```javascript
// GroupsMonthly has: intrusion-set--APT1
//   - modified: 2024-02-01
//   - tier: members (released)
//   - status: reviewed

// MobileGroups has: intrusion-set--APT1
//   - modified: 2024-01-15
//   - tier: candidates
//   - status: work-in-progress

// Virtual track with deduplication:
{
  strategy: "prefer_latest_modified",  // → Use 2024-02-01 from GroupsMonthly
  tier_resolution: "highest_tier",     // → Use "members" tier
  status_resolution: "highest_status"  // → Use "reviewed" status
}
```

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
  "stix": {
    "id": "x-mitre-collection--virtual-uuid",
    "modified": "2024-03-01T10:00:00Z",
    "x_mitre_version": null,  // Draft snapshot
    "type": "virtual"
  },

  "composition_resolution": {
    "resolved_at": "2024-03-01T10:00:00Z",
    "component_snapshots": [
      {
        "track_id": "GroupsMonthly--uuid",
        "track_name": "Groups Monthly",
        "resolved_snapshot": "2024-02-15T10:00:00Z",
        "resolved_version": "5.2",
        "strategy_used": "latest_tagged",
        "object_count": 47
      },
      {
        "track_id": "TechniquesQuarterly--uuid",
        "track_name": "Techniques Quarterly",
        "resolved_snapshot": "2024-01-15T10:00:00Z",
        "resolved_version": "2.1",
        "strategy_used": "latest_tagged",
        "object_count": 823
      }
    ],
    "total_objects": 870,
    "duplicates_resolved": 0
  }
}
```

**Business Logic:**
1. For each component track in `composition.component_tracks`:
   - Resolve snapshot based on `resolution_strategy`
   - **Validate that resolved snapshot is tagged** (x_mitre_version !== null)
   - Apply `filters` to get subset of objects
   - Collect all object references
2. Apply deduplication rules across all components
3. Create new virtual track snapshot with:
   - New `stix.modified` timestamp
   - `x_mitre_version = null` (always starts as draft)
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
  trackId: "EnterpriseTwiceAnnual--uuid",
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
  "stix": {
    "id": "x-mitre-collection--virtual-uuid",
    "modified": "2024-03-01T10:00:00Z",  // Unchanged
    "x_mitre_version": "14.0",  // Now tagged
    "type": "virtual"
  },

  "composition_resolution": {
    // Preserved from snapshot creation
    "resolved_at": "2024-03-01T10:00:00Z",
    "component_snapshots": [...]
  },

  "version_history": [
    {
      "version": "14.0",
      "tagged_at": "2024-03-05T14:00:00Z",  // Later than snapshot creation
      "tagged_by": "admin@example.com",
      "snapshot_created_at": "2024-03-01T10:00:00Z",
      "component_versions": {
        "GroupsMonthly": "5.2",
        "TechniquesQuarterly": "2.1"
      }
    }
  ]
}
```

**Business Logic:**
1. Validate snapshot exists and is a draft (x_mitre_version === null)
2. Calculate/validate version number
3. Set x_mitre_version on snapshot (in-place update)
4. Add entry to workspace.version_history
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
        "intrusion-set--APT1",
        "intrusion-set--APT2",
        "attack-pattern--T1234",
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
  stix: {
    modified: "2024-03-01T10:00:00Z",
    x_mitre_version: "14.0"
  },

  workspace: {
    composition_resolution: {
      resolved_at: "2024-03-01T10:00:00Z",

      component_snapshots: [
        {
          track_id: "GroupsMonthly--uuid",
          track_name: "Groups Monthly",
          track_type: "standard",

          // Which snapshot was used
          resolved_snapshot: "2024-02-15T10:00:00Z",
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
}
```

### Validation Rules

#### 1. Component tracks must have tagged snapshots

```javascript
// When creating virtual snapshot
for (const component of composition.component_tracks) {
  const snapshot = await resolveSnapshot(component);

  if (snapshot.stix.x_mitre_version === null) {
    throw new ValidationError(
      `Component track ${component.track_id} resolved to draft snapshot. ` +
      `Virtual tracks can only reference tagged snapshots.`
    );
  }
}
```

**User experience:**
```bash
POST /api/release-tracks/EnterpriseTwiceAnnual--uuid/snapshots/create

# Error response:
{
  "error": "ValidationError",
  "message": "Cannot create virtual snapshot: component track 'GroupsMonthly' has no tagged releases",
  "details": {
    "component": "GroupsMonthly--uuid",
    "issue": "No tagged snapshots found (all snapshots are drafts)"
  }
}
```

#### 2. Circular dependency prevention

```javascript
// When creating/updating virtual track composition
async function validateNoCycles(virtualTrack) {
  const visited = new Set();
  const stack = [virtualTrack.stix.id];

  while (stack.length > 0) {
    const currentId = stack.pop();

    if (visited.has(currentId)) {
      throw new ValidationError(`Circular dependency detected: ${currentId}`);
    }

    visited.add(currentId);

    const track = await getReleaseTrack(currentId);

    if (track.stix.type === "virtual") {
      for (const component of track.workspace.composition.component_tracks) {
        stack.push(component.track_id);
      }
    }
  }
}
```

#### 3. Maximum composition depth

```javascript
workspace: {
  config: {
    max_composition_depth: 3  // Limit nesting to prevent performance issues
  }
}
```

Virtual track nesting example:
```
VirtualA (depth 0)
  → VirtualB (depth 1)
    → VirtualC (depth 2)
      → StandardD (depth 3) ✓ allowed
        → StandardE (depth 4) ✗ exceeds max_composition_depth
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
        "track_id": "GroupsMonthly--uuid",
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
      "track_id": "GroupsMonthly--uuid",
      "resolution_strategy": "latest_tagged"
    },
    {
      "track_id": "TechniquesQuarterly--uuid",
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
- `include`: `members` | `staged` | `candidates` | `all`
- `resolve`: `true` (default) | `false` - Whether to resolve composition

**Response when `resolve=true`:**
```json
{
  "stix": {
    "id": "x-mitre-collection--virtual-uuid",
    "type": "virtual",
    "x_mitre_version": null
  },

  "resolved_content": {
    "members": [
      {
        "object_ref": "intrusion-set--APT1",
        "object_modified": "2024-02-01T10:00:00Z",
        "source_track": "GroupsMonthly--uuid",
        "source_version": "5.2"
      }
      // ... all resolved objects
    ],
    "staged": [],
    "candidates": []
  },

  "composition_resolution": {
    "resolved_at": "2024-03-05T10:00:00Z",
    "component_snapshots": [...]
  }
}
```

## Hybrid Model: Virtual Track + Native Objects

Virtual tracks can have **both** composed content **and** native objects:

```javascript
{
  stix: {
    type: "virtual"
  },

  workspace: {
    // Composed from standard tracks
    composition: {
      component_tracks: [
        { track_id: "GroupsMonthly--uuid" },
        { track_id: "TechniquesQuarterly--uuid" }
      ]
    },

    // PLUS virtual track's own candidates/staged
    candidates: [
      {
        object_ref: "marking-definition--enterprise-only",
        object_modified: "2024-01-01T10:00:00Z",
        status: "reviewed"
      }
    ],

    staged: []
  }
}
```

**Use case:** Enterprise track includes Groups and Techniques from standard tracks, PLUS Enterprise-specific marking definitions or custom objects.

**When virtual snapshot is created:**
1. Resolve composed content from component tracks
2. Merge with virtual track's native candidates/staged/members
3. Apply deduplication if any native objects overlap with composed objects

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
POST /api/release-tracks/GroupsMonthly--uuid/candidates
{
  "object_refs": ["intrusion-set--APT1", "intrusion-set--APT2", ...]
}

# Tag initial release
POST /api/release-tracks/GroupsMonthly--uuid/bump
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
        "track_id": "GroupsMonthly--uuid",
        "resolution_strategy": "latest_tagged"
      },
      {
        "track_id": "TechniquesQuarterly--uuid",
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
POST /api/release-tracks/EnterpriseTwiceAnnual--uuid/snapshots/create

# Review draft snapshot
GET /api/release-tracks/EnterpriseTwiceAnnual--uuid/snapshots/:modified

# Tag as Enterprise v14.0
POST /api/release-tracks/EnterpriseTwiceAnnual--uuid/snapshots/:modified/bump
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
    stix: snapshot.stix,
    workspace: {
      composition: snapshot.workspace.composition,
      composition_resolution: snapshot.workspace.composition_resolution  // Pre-computed
    }
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

### Error: Circular Dependency

```json
{
  "error": "CircularDependencyError",
  "message": "Virtual track composition creates circular dependency: VirtualA → VirtualB → VirtualA",
  "resolution": "Remove one of the component track references to break the cycle"
}
```

### Error: Composition Depth Exceeded

```json
{
  "error": "CompositionDepthExceededError",
  "message": "Virtual track composition exceeds maximum depth of 3",
  "resolution": "Reduce nesting of virtual tracks"
}
```
