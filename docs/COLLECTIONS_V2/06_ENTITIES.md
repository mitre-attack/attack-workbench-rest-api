## Entities/Schemas/Data Models

This document tracks new database schemas, interfaces, etc.; as well as changes to any such existing entities.

### Release Track

`ReleaseTrack` instances will be tracked as independent MongoDB Collections. The reason for this is because the volume of snapshot permutations is expected to be very high given the frequency of changes that typically occur between releases.

#### Naming Conventions

**Release Track Names:**
- Must contain only alphanumeric characters and spaces: `[a-zA-Z0-9 ]`
- No special characters allowed (no hyphens, underscores, or other punctuation)
- Examples: `Enterprise`, `Groups Monthly`, `Techniques Quarterly`

**Release Track IDs:**
MongoDB Collections and release track IDs follow a simple naming convention:
```
release-track--$uuid
```

Where:
- `release-track--` is a fixed prefix
- `$uuid` is a dynamically generated UUIDv4 identifier (must be unique)

**Example:**
A user creates a release track named `Groups Monthly`:
1. Name: `Groups Monthly` (user-specified, stored in the `name` field)
2. UUID: `8b0ff8f9-27fd-4d7e-bbc9-8fe9465342af` (generated)
3. Final ID: `release-track--8b0ff8f9-27fd-4d7e-bbc9-8fe9465342af`

This ID is used for:
- MongoDB Collection name
- The `id` field in release track snapshots
- API endpoint references (`/api/release-tracks/:id`)


### Release Track Types

Release tracks can be one of two types:

1. **Standard Release Tracks**: Traditional release tracks that directly manage objects through the candidate → staged → released workflow
2. **Virtual Release Tracks**: Computed aggregations of other release tracks, used to compose releases from multiple source tracks

The type is identified by the `stix.type` field:
- Standard tracks: `stix.type` is omitted or set to `"standard"`
- Virtual tracks: `stix.type = "virtual"`

### Standard Release Track Snapshot Schema

Each release track snapshot will be tracked as an individual MongoDB Document in its respective `ReleaseTrack` Collection.

```javascript
{
  // Identity
  id: "release-track--123",
  type: "standard",  // or "virtual"

  // Snapshot metadata
  modified: "2024-01-15T16:20:00.000Z", // when the snapshot was created
  version: "18.0",  // null if draft release

  // Release track metadata
  name: "ATT&CK Enterprise",
  description: "...",
  created: "2024-01-01T10:00:00.000Z", // when the release track was created
  created_by_ref: "identity--uuid",
  object_marking_refs: ["marking-definition--uuid"],

  // Objects in this snapshot
  members: [
    // Objects included in the current/latest release
    // These are in the published STIX bundle
    {
      object_ref: "attack-pattern--aaa",
      object_modified: "2024-01-10T10:00:00.000Z"
    },
    {
      object_ref: "malware--bbb",
      object_modified: "2024-01-11T14:30:00.000Z"
    },
    {
      object_ref: "tool--ccc",
      object_modified: "2024-01-12T09:15:00.000Z"
    }
  ],

  // Staged for next release
  staged: [
    // Objects that are reviewed (in THIS release track) and ready for next bump
    // Automatically promoted from candidates when track-scoped status → "reviewed"
    {
      object_ref: "attack-pattern--ddd",
      object_modified: "2024-01-14T10:00:00Z",  // VERSION PIN: specific object version
      object_status: "reviewed",                 // Track-scoped status
      object_staged_at: "2024-01-14T11:00:00Z",
      object_staged_by: "reviewer@example.com"
    }
  ],

  // Work in progress
  candidates: [
    // Objects being worked on (in THIS release track), not yet ready for release
    {
      object_ref: "attack-pattern--eee",
      object_modified: "2024-01-12T09:00:00Z",  // VERSION PIN: specific object version
      object_status: "work-in-progress",         // Track-scoped status
      object_added_at: "2024-01-10T10:00:00Z",
      object_added_by: "alice@example.com"
    },
    {
      object_ref: "attack-pattern--fff",
      object_modified: "2024-01-13T14:00:00Z",  // VERSION PIN: specific object version
      object_status: "awaiting-review",          // Track-scoped status
      object_added_at: "2024-01-12T14:30:00Z",
      object_added_by: "bob@example.com"
    }
  ],

  // Configuration
  config: {
    candidacy_threshold: "awaiting-review",  // "work-in-progress" | "awaiting-review" | "reviewed"
    auto_promote: true,                       // Auto-promote reviewed objects to staged
    include_candidates_in_snapshots: false,   // Whether snapshots include candidates
    include_secondary_objects: {
      enabled: true,
      status_threshold: "reviewed"
    },
    promotion_conflicts: {
      candidates_to_staged: "prefer_latest",  // "always_overwrite" | "always_reject" | "prefer_latest"
      staged_to_members: "abort"              // "always_overwrite" | "always_reject" | "prefer_latest" | "abort"
    },
    // Member sync strategy - controls auto-enrollment of new member object revisions
    // See 08_MEMBER_SYNC_STRATEGIES.md for comprehensive documentation
    member_sync: {
      strategy: "track_latest",              // "track_latest" | "manual"
      supplant: {
        behavior: "replace",                 // "replace" | "queue" | "ignore"
        status_policy: "reset"               // "reset" | "preserve"
      }
    }
  },

  // Version history
  version_history: [
    {
      version: "1.1",
      tagged_at: "2024-01-15T17:00:00Z",
      tagged_by: "admin@example.com",
      snapshot_id: "2024-01-15T16:20:00.000Z",
      summary: {
        members_count: 3,     // Objects in members
        promoted_count: 1,    // Objects promoted from staged to members
        staged_count: 0,      // Objects left in staged (if any)
        candidate_count: 2    // Objects left in candidates (if any)
      }
    }
  ]
}
```

### Version History

The `version_history` array tracks all tagged releases in reverse chronological order (newest first):

```javascript
version_history: [
  {
    version: "2.0",                          // Version (MAJOR.MINOR)
    tagged_at: "2024-02-01T...",             // When the tagging occurred
    tagged_by: "user@example.com",           // Who performed the tagging
    snapshot_id: "2024-02-01T10:00:00.000Z", // Which snapshot was tagged
    summary: {
      members_count: 3000,
      promoted_count: 150
    }
  },
  // ... older versions
]
```

This provides:
- Complete audit trail of tagged releases
- Attribution for each tagged release
- Chronological release history

### Object (SDO/SRO/SMO) Document Schema

Objects maintain a simple reference to which release tracks reference them:

```javascript
{
  stix: {
    id: "attack-pattern--eee",
    modified: "2024-01-12T09:00:00Z",  // This version's timestamp
    type: "attack-pattern",
    name: "New Technique",
    // ... other STIX properties
  },
  workspace: {
    // NO global workflow status - status is tracked per-release-track

    // Simple reverse reference for efficient queries
    referenced_by: [
      {
        release_track_id: "release-track--123",
        snapshot_id: "2024-12-15T16:20:00.000Z",
        membership_tier: "members",  // "members" | "staged" | "candidates"
        review_status: "reviewed"    // "work-in-progress" | "awaiting-review" | "reviewed"
      },
      {
        release_track_id: "release-track--456",
        snapshot_id: "2025-01-10T11:00:00.000Z",
        membership_tier: "candidates",
        review_status: "work-in-progress"
      }
    ],

    // Attribution metadata
    workflow_history: [
      {
        timestamp: "2024-01-12T09:00:00Z",
        modified_by: "alice@example.com",
        action: "created"
      }
    ]
  }
}
```

**Key Points:**
- **No global `workflow.status`** - status is release-track-specific
- `referenced_by` provides reverse lookup for queries like "show me all release tracks containing this object"
- Same object version can have different statuses in different release tracks
- Multiple versions of same object can exist, each potentially referenced by different release tracks

### Virtual Release Track Snapshot Schema

Virtual release tracks compute their contents by aggregating objects from component release tracks. Each virtual track snapshot stores composition rules and resolution metadata.

```javascript
{
  // Identity
  id: "release-track--virtual-uuid",
  type: "virtual",  // Distinguishes from standard tracks

  // Snapshot metadata
  snapshot_id: "2024-03-01T10:00:00.000Z",
  modified: "2024-03-01T10:00:00Z",
  version: null,  // null for draft, or "14.0" for tagged release

  // Release track metadata
  name: "Enterprise ATT&CK",
  description: "Virtual aggregation of Enterprise content across multiple source tracks",
  created: "2024-01-01T10:00:00.000Z",
  created_by_ref: "identity--uuid",
  object_marking_refs: ["marking-definition--uuid"],

  // Objects in this snapshot (Virtual tracks use 2-tier system)
  members: [
    {
      object_ref: "intrusion-set--APT1",
      object_modified: "2024-02-01T10:00:00Z"
    }
    // ... 870 total objects synced from component tracks
  ],
  quarantine: [],  // Conflicting objects requiring manual resolution

  // Composition rules - defines how this virtual track is built
  composition: {
    component_tracks: [
      {
        track_id: "release-track--groups-monthly",
        resolution_strategy: "latest_tagged",  // "latest_tagged" | "specific_version" | "specific_snapshot"
        priority: 1,  // Required for prioritize_higher_priority strategy (lower number = higher priority)

        // Optional: version/snapshot specification for non-latest strategies
        version: "5.0",  // Used with "specific_version" strategy
        snapshot: "2024-02-01T10:00:00Z",  // Used with "specific_snapshot" strategy

        // Optional: filters to limit which objects are included
        filters: {
          object_types: ["intrusion-set"],
          domains: ["enterprise"],
          stix_pattern: {}  // Advanced STIX filtering
        }
      },
      {
        track_id: "release-track--techniques-quarterly",
        resolution_strategy: "latest_tagged",
        priority: 2,
        filters: {
          object_types: ["attack-pattern"]
        }
      }
    ],

    // Deduplication strategy when same object appears in multiple component tracks
    deduplication: {
      strategy: "prioritize_latest_object"  // "prioritize_latest_object" | "prioritize_latest_snapshot" | "prioritize_higher_priority" | "quarantine"
    }
  },

  // Composition resolution - computed at snapshot creation time, immutable
  composition_resolution: {
    resolved_at: "2024-03-01T10:00:00Z",

    component_snapshots: [
      {
        track_id: "release-track--groups-monthly",
        track_name: "Groups Monthly",
        track_type: "standard",

        // Which snapshot was resolved
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
      },
      {
        track_id: "release-track--techniques-quarterly",
        track_name: "Techniques Quarterly",
        track_type: "standard",
        resolved_snapshot_id: "2024-01-15T10:00:00.000Z",
        resolved_version: "2.1",
        strategy_used: "latest_tagged",
        filters_applied: {
          object_types: ["attack-pattern"]
        },
        total_objects_in_source: 823,
        objects_after_filter: 823,
        objects_contributed: 823
      }
    ],

    // Deduplication report
    deduplication: {
      total_objects_before: 870,
      total_objects_after: 870,
      duplicates_found: 0,
      conflicts_resolved: []
    },

    // Native objects (if virtual track has its own objects in addition to composed)
    native_objects: {
      members_count: 0  // Virtual tracks can optionally have native members
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
        "quarantine": 0
      }
    }
  },

  // Optional: Virtual tracks can schedule automatic snapshot creation
  snapshot_schedule: {
    mode: "manual",  // "manual" | "cron" | "dates"
    cron: "0 0 1 1,7 *",  // Cron expression (e.g., Jan 1 and July 1 at midnight)
    dates: [  // Or specific dates
      "2024-01-01T00:00:00Z",
      "2024-07-01T00:00:00Z"
    ]
  },

  // Configuration
  config: {
    notification_email: "enterprise-team@example.com"
  },

  // Version history (same as standard tracks)
  version_history: [
    {
      version: "14.0",
      tagged_at: "2024-03-05T14:00:00Z",
      tagged_by: "admin@example.com",
      snapshot_id: "2024-03-01T10:00:00.000Z",  // When snapshot was created
      component_versions: {
        "GroupsMonthly": "5.2",
        "TechniquesQuarterly": "2.1"
      }
    }
  ]
}
```

**Key Differences from Standard Tracks:**

1. **Type Identification**: `stix.type = "virtual"`
2. **Two-Tier System**: Only `members` and `quarantine` (no `candidates` or `staged` tiers)
3. **Composition Rules**: Defines which component tracks to aggregate and how
4. **Composition Resolution**: Immutable metadata about how snapshot was computed
5. **Sync from Members Only**: Always pulls from component tracks' `members` tier (never staged or candidates)
6. **No Workflow States**: No work-in-progress, awaiting-review, or reviewed states
7. **Scheduled Snapshots**: Can auto-generate snapshots on schedule
8. **Component Version Tracking**: Version history records which component versions were included

**Virtual Track Constraints:**

- Can only reference **tagged snapshots** from component tracks (not drafts)
- Can only sync from component tracks' **`members` tier** (released objects only)
- Can only compose from **standard release tracks** (not other virtual tracks - no nesting allowed)
- Snapshots are created **manually or on schedule** (never event-driven)
- All snapshots start as **drafts** and must be explicitly tagged
- Component tracks must exist and have at least one tagged release
- Each component track must have a unique **priority** value (no duplicates)