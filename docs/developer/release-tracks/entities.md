## Entities/Schemas/Data Models

This document tracks new database schemas, interfaces, etc.; as well as changes to any such existing entities.

### Collections at a glance

| Collection                           | Purpose                                                                                                                                                                                                           | Written by                                                                                                | Growth and retention                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `releaseTrackRegistry` | Track identity, counters, tagged catalogue, lifecycle lock, and live virtual schedule with cron-only nested retention. | Track creation/deletion, snapshot lifecycle and schedule updates. | One document per track. |
| `release-track--<uuid>` | Standard rolling drafts, preserved release sources, virtual-pinned source drafts and tags; virtual drafts and releases. | Snapshot service and release commit. | Virtual drafts can be bounded by count retention or explicit release-time squash; tagged snapshots are never pruned. |
| `releaseTrackContentManifests`       | The sealed bill of materials each snapshot references (`content_manifest_id`). Several snapshots share one manifest when their member sets are identical.                                                         | Sealed whenever members are written; discarded when no snapshot references it.                            | Bounded by member-changing writes, not by snapshot count.                                                    |
| `releaseTrackContentManifestEntries` | One exact-revision pointer per object a manifest emits or depends on. The `(object_ref, object_modified)` index is what protects referenced revisions from deletion.                                              | With its manifest.                                                                                        | Roughly members + relationships + a few supporting objects per manifest.                                     |
| `releaseTrackReconciliations`        | Outstanding backref reconciliation work only: a record is created before the `workspace.release_tracks` listeners run and deleted when they succeed, so anything present is pending or failed and needs repair.   | Every snapshot write.                                                                                     | Normally empty.                                                                                              |
| `releaseTrackAuditEvents` | Destructive audit and bounded cleanup intent/progress for deletion, conversion, retag, `draft_retention`, and `draft_squash`. | Destructive operations and cleanup recovery. | Durable audit records; cleanup results are discoverable independently of snapshot survival. |
| `virtualTrackScheduleOccurrences` | Ownership-fenced claims and monotonic `snapshot_modified` materialization receipts. | Scheduler and scheduled snapshot lifecycle. | One record per track/time, retained after snapshot cleanup; also covers API-originated occurrence metadata. |

Retention is `{ max_drafts: null | positive safe integer }`, supplied either on
the manual materialization request or inside the live cron `snapshot_schedule`.
There is no global registry retention policy. Workbench virtual responses
project the schedule plus registry `snapshot_count` and `tagged_release_count`
for paginated clients; these are not historical snapshot content.

Retention audit intents persist their `source` (`manual` or `recurring`), applied
`max_drafts`, and original cutoff. Manual retries use that fixed request policy;
recurring retries additionally honor the currently enabled cron policy. Legacy
intents lacking these fields cannot select further drafts, but storage repair
remains available.

A server-controlled `release_event_id` binds release-time cleanup to the original
tagging event, independently of mutable version labels and reusable virtual
snapshot timestamps. Cleanup progress belongs to its audit record, not the
released manifest or version-history content. See [Deletion Guardrails](deletion-guardrails.md)
and the [API lifecycle contracts](../../user/release-tracks/api-reference.md#virtual-draft-retention).

Removed by the sealed-manifest work: the former `releaseTrackGraphManifests`
and `releaseTrackGraphManifestEntries` collections (renamed in place by the
2026-09-02 migration), the frozen `collection` manifest entries, and the
`config.include_secondary_objects` block (secondary objects no longer exist).

### Release Track

Every new snapshot persists an immutable `creation_cause` enum describing the
operation, together with immutable `creation_actor` (`kind`: `user`, `system`,
or `unknown`; `user_account_id` for user invocations). This is distinct from
the original track's `created_by_ref`. Workbench GETs resolve safe user display
metadata for the frontend's initials avatar. The cause identifies the
operation that created it. Latest/timestamp Workbench responses and snapshot
history expose it; historical missing values read as `unknown`. See
[snapshot creation causes](snapshot-creation-causes.md) for the complete
standard/virtual operation mapping and non-creating operations.

`ReleaseTrack` instances will be tracked as independent MongoDB Collections. The reason for this is because the volume of snapshot permutations is expected to be very high given the frequency of changes that typically occur between releases.

#### Naming Conventions

**Release Track Names:**

- May contain alphanumeric characters, spaces, and ampersands:
  `[a-zA-Z0-9 &]`
- Other punctuation remains unsupported, including hyphens and underscores.
- Examples: `Enterprise`, `Groups Monthly`, `Enterprise ATT&CK`

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

### Release Track Registry

`releaseTrackRegistry` contains exactly one document per release track. It is
the global catalogue for discovering dynamic track collections and their
compact metadata; snapshot contents remain authoritative in the per-track
collections.

```javascript
{
  track_id: "release-track--123",
  type: "standard",
  name: "ATT&CK Enterprise",
  alias: "enterprise-attack",   // optional; absent when unset
  latest_snapshot_modified: "2024-02-01T10:00:00.000Z",
  latest_tagged_version: "2.0",
  snapshot_count: 47,
  tagged_release_count: 2,
  tagged_releases: [
    {
      snapshot_modified: "2024-01-15T16:20:00.000Z",
      version: "1.0",
      tagged_at: "2024-01-15T17:00:00.000Z",
      tagged_by: "user-id"
    },
    {
      snapshot_modified: "2024-02-01T10:00:00.000Z",
      version: "2.0",
      tagged_at: "2024-02-01T11:00:00.000Z",
      tagged_by: "user-id"
    }
  ]
}
```

`alias` is an optional URL-safe slug that every `:id` route accepts in place
of the track ID. It is unique under a partial unique index
(`{ alias: 1 }`, `alias` of type string), so clearing an alias unsets the
field rather than writing `null`. Resolution happens once per request in an
Express `router.param('id')` callback
([release-tracks-controller.js](../../../app/controllers/release-tracks-controller.js)
`resolveTrackId`), which rewrites `req.params.id` to the canonical ID before
any handler runs; services never see aliases. The alias is registry-only:
snapshots do not store it, and workbench snapshot responses attach it from the
registry at read time.

`tagged_release_count` is derived from `tagged_releases.length`, and
`latest_tagged_version` is the highest semantic MAJOR.MINOR version rather
than the tag on the chronologically newest snapshot. See
[releases-by-object.md](releases-by-object.md) for reconciliation and query
details.

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
  snapshot_description: "Why this snapshot matters to our team",

  // Sealed content manifest (every snapshot references one; see
  // sealed-content-manifests.md). Member-changing writes seal a new
  // manifest; other clones inherit the predecessor's by reference.
  content_manifest_id: "release-track-content-manifest--uuid",

  // Release-only fields frozen at commit
  publication: {
    collection_id: "x-mitre-collection--uuid",
    created: "2024-01-01T10:00:00.000Z",
    created_by_ref: "identity--uuid",
    object_marking_refs: ["marking-definition--uuid"],
    attack_spec_version: "3.3.0"
  },
  bundle_id: "bundle--uuid",
  bundle_hashes: { manifest_id: "release-track-content-manifest--uuid", stix_2_0: "…", stix_2_1: "…" },

  // Release track metadata
  name: "ATT&CK Enterprise",
  description: "...",
  created: "2024-01-01T10:00:00.000Z", // when the release track was created
  created_by_ref: "identity--uuid",       // the user account that created the track

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
    // Objects that are reviewed (in THIS release track) and ready for next release
    // Automatically promoted from candidates when track-scoped status → "reviewed"
    {
      object_ref: "attack-pattern--ddd",
      object_modified: "latest",                 // DYNAMIC SELECTOR: resolved at release
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
      object_modified: "2024-01-12T09:00:00Z",  // EXACT SELECTOR: fixed object version
      object_status: "work-in-progress",         // Track-scoped status
      object_added_at: "2024-01-10T10:00:00Z",
      object_added_by: "alice@example.com"
    },
    {
      object_ref: "attack-pattern--fff",
      object_modified: "latest",                 // DYNAMIC SELECTOR: follows latest
      object_status: "awaiting-review",          // Track-scoped status
      object_added_at: "2024-01-12T14:30:00Z",
      object_added_by: "bob@example.com"
    }
  ],

  // Configuration
  config: {
    candidacy_threshold: "awaiting-review",  // "work-in-progress" | "awaiting-review" | "reviewed"
    auto_promote: true,                       // Auto-promote reviewed objects to staged
    promotion_conflicts: {
      into_candidates: "prefer_latest",       // "always_overwrite" | "always_reject" | "prefer_latest" | "abort"
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
    },
    // Publication metadata for the emitted x-mitre-collection object. Each
    // attribute inherits the global system configuration unless overridden.
    // collection_id and created default to track-derived values and become
    // immutable once the track has a tagged release.
    publication: {
      collection_id: "x-mitre-collection--uuid",   // optional override
      created: "2018-01-17T12:56:55.080Z",         // optional override
      created_by_ref: { inherit: true },           // or { inherit: false, value: "identity--uuid" }
      object_marking_refs: { inherit: true }       // or { inherit: false, value: ["marking-definition--uuid"] }
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
        candidates_count: 2    // Objects left in candidates (if any)
      }
    }
  ]
}
```

`snapshot_description` is stored directly on the snapshot document and is
deliberately separate from the release track's long-lived `description`. It
becomes the emitted collection object's `description`. Editing it on a draft
does not change `modified`, tier contents, or the content manifest; once the
snapshot is released it is immutable. Rolling edits to the same draft preserve
its description; the first draft of a new release cycle starts blank.

For a tagged standard snapshot, `release_source_modified` identifies the exact
untagged draft from which it was created. The pair is unique within the track.
Draft pruning excludes these source snapshots, and the UI suppresses them
while the release exists. Removing the newest release therefore exposes the
unchanged source draft without reconstructing state from a ledger or manifest.

### Version History

The `version_history` array tracks all tagged releases in reverse chronological order (newest first):

```javascript
version_history: [
  {
    version: '2.0', // Version (MAJOR.MINOR)
    tagged_at: '2024-02-01T...', // When the tagging occurred
    tagged_by: 'user@example.com', // Who performed the tagging
    snapshot_id: '2024-02-01T10:00:00.000Z', // Which snapshot was tagged
    summary: {
      members_count: 3000,
      promoted_count: 150,
    },
  },
  // ... older versions
];
```

This provides:

- Complete audit trail of tagged releases
- Attribution for each tagged release
- Chronological release history

Correcting a release version updates the matching entry identified by
`snapshot_id`, including copies carried forward into later snapshots. Exact
snapshot identity, publication metadata, content, and bundle ID do not change;
the bundle hashes are regenerated because the projected collection version
does change.

### Object (SDO/SRO/SMO) Document Schema

Objects maintain a simple reverse reference to the release tracks that
currently reference them (implemented as `workspace.release_tracks`; see
[backref-reconciliation.md](backref-reconciliation.md) for how it is kept in
sync and the [user doc](../../user/release-tracks/object-backrefs.md) for
field semantics):

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
    // Reverse references for efficient "which tracks contain this revision?" queries
    release_tracks: [
      {
        id: "release-track--123",
        type: "standard",            // "standard" | "virtual"
        tier: "members",             // "members" | "staged" | "candidates" | "quarantine"
        status: "reviewed"           // "modified-in-place" | "work-in-progress" | "awaiting-review" | "reviewed"
      },
      {
        id: "release-track--456",
        type: "standard",
        tier: "candidates",
        status: "work-in-progress"
      }
    ]
  }
}
```

**Key Points:**

- `workspace.release_tracks` provides reverse lookup for queries like "show me all release tracks containing this object"
- Entries reflect each track's **latest** snapshot and are pinned to the specific object revision the tier entry references
- One precise revision (`stix.id` + `stix.modified`) can occupy only one tier
  in a snapshot; different revisions of the same object may occupy different tiers
- Same object version can have different statuses in different release tracks
- Multiple versions of same object can exist, each potentially referenced by different release tracks
- The field is server-controlled and maintained by event-driven reconciliation (`release-track::contents-changed`)

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
        resolution_strategy: "latest_tagged",  // "latest_tagged" | "latest_preview" | "specific_version" | "specific_snapshot"
        priority: 1,  // Always required and unique (lower number = higher priority)

        // Optional: filters to limit which objects are included
        filters: {
          object_types: ["intrusion-set"],
          domains: ["enterprise"]
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

  // Composition resolution - computed at snapshot creation time, immutable.
  // Null/absent means composition is configured but awaiting materialization;
  // that draft cannot be previewed or tagged as a release.
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

  // Optional schedule. Choose exactly one mode-specific shape.
  snapshot_schedule: {
    mode: "cron",
    cron: "0 0 1 1,7 *"  // Jan 1 and July 1 at midnight UTC
  },

  // Shared release-track configuration. Virtual tracks do not use
  // candidate/staged/member-sync workflow controls.
  config: {},

  // Version history (same as standard tracks)
  version_history: [
    {
      version: "14.0",
      tagged_at: "2024-03-05T14:00:00Z",
      tagged_by: "admin@example.com",
      snapshot_id: "2024-03-01T10:00:00.000Z",  // When snapshot was created
      component_versions: {
        "release-track--groups-monthly": "5.2",
        "release-track--techniques-quarterly": "2.1"
      }
    }
  ]
}
```

Standard `candidates` and `staged` entries may use either an exact
`object_modified` timestamp or the dynamic selector `"latest"`. Promotion
between those workflow tiers preserves the selector. During release planning,
every dynamic staged selector is resolved to the latest stored object revision
before conflict handling and rendering. Only exact revision timestamps may be
persisted in `members`, so tagged standard snapshots have deterministic primary
membership.

Virtual `members` and `quarantine` entries always store exact
`(object_ref, object_modified)` revision pairs. They never store `"latest"` or
inherit the component track's `track_latest` behavior. Composition resolution
copies the exact member revisions from the selected tagged component
snapshots, and later component activity cannot change the persisted virtual
snapshot.

Every snapshot references a sealed content manifest (`content_manifest_id`)
from birth. The manifest closes over exact `members` and stores exact-revision
pointers for those roots, relationships whose source and target IDs are both
members (pinned to the member revisions), versioned supporting objects, and
LinkById targets; only unversioned marking definitions retain a frozen
payload. No relationship-discovered secondary SDO is ever added. Writes that
change `members` seal a new manifest; other clones inherit their
predecessor's. A standard release commit reseals over the planned members;
a virtual commit publishes the materialization manifest unchanged. See
[sealed-content-manifests.md](sealed-content-manifests.md).

### Content Manifest Schema

```javascript
// releaseTrackContentManifests
{
  manifest_id: "release-track-content-manifest--uuid",
  track_id: "release-track--uuid",
  snapshot_modified: "2024-01-15T16:20:00.000Z", // the write that sealed it
  state: "active",        // "pending" while entries are written; both protect pointers
  schema_version: 2,      // 2 = pointer-only; 1 = legacy July 2026 frozen-relationship backfill
  seal_reason: "release", // track_creation | members_written | release | materialization |
                          // track_clone | source_reconstruction | migration | legacy_graph
  source_attestation: {   // source_reconstruction only: the verified bundle the pointers came from
    kind: "source-bundle", bundle_sha256: "…", collection_id: "x-mitre-collection--…",
    release: "19.1", domain: "enterprise-attack"
  },
  created_at: "2024-01-15T16:20:00.100Z"
}

// releaseTrackContentManifestEntries (one per exact revision)
{
  manifest_id: "release-track-content-manifest--uuid",
  track_id: "release-track--uuid",
  snapshot_modified: "2024-01-15T16:20:00.000Z",
  revision_key: "attack-pattern--aaa::1704880800000",
  kind: "root",                // root | relationship | supporting | link_target | secondary (legacy)
  tier: "members",             // root entries only
  object_ref: "attack-pattern--aaa",
  object_modified: "2024-01-10T10:00:00.000Z",
  source: { object_ref, object_modified },  // relationship entries: the member revisions shipped
  target: { object_ref, object_modified },
  omitted_optional_defaults: ["revoked"],   // source_reconstruction serialization hints only
  frozen_stix: { ... }                      // unversioned marking definitions only
}
```

`seal_reason` records which write produced the manifest. `migration` marks a
manifest sealed from the current database by the 2026-09-02 migration rather
than at the time of the original write, and `legacy_graph` marks a manifest
created by the retired opt-in graph endpoint; neither is a historically exact
capture. `source_reconstruction` manifests carry the administrator's
attestation. `state` exists for crash safety: entries are written and verified
under a `pending` manifest before the snapshot references it, and replay
activates a linked pending manifest opportunistically.

The three valid `snapshot_schedule` shapes are:

```javascript
// Explicit creation only
{ mode: "manual" }

// Five-field UTC cron schedule
{ mode: "cron", cron: "0 0 1 1,7 *" }

// Explicit execution dates
{
  mode: "dates",
  dates: [
    "2024-01-01T00:00:00Z",
    "2024-07-01T00:00:00Z"
  ]
}
```

These are alternatives, not fields to combine in one schedule. `manual`
persists no executable work. A scheduler reconciliation task registers UTC
cron jobs and durable due-date occurrences. Each scheduled draft records:

```javascript
scheduled_materialization: {
  schedule_mode: "cron", // "cron" | "dates"
  scheduled_for: "2027-01-01T00:00:00.000Z"
}
```

The scheduler writes this object for automated occurrences, and API clients
may write the same strict virtual-only shape during initial track creation or
composition update, as well as explicit virtual materialization. It is stored
on the resulting snapshot and projected into track-list and snapshot-history
responses. Snapshot clones clear inherited occurrence metadata unless the
mutation explicitly supplies a replacement.

The track-local unique index prevents duplicate surviving scheduled snapshots.
The occurrence ledger also retains a monotonic materialization receipt after
cleanup, so missing snapshots do not make completed work executable again.
Unmaterialized failures remain retryable; stale claim owners cannot overwrite a
new worker's completion. See [Deletion Guardrails](deletion-guardrails.md).

**Key Differences from Standard Tracks:**

1. **Type Identification**: `stix.type = "virtual"`
2. **Two-Tier System**: Only `members` and `quarantine` (no `candidates` or `staged` tiers)
3. **Composition Rules**: Defines which component tracks to aggregate and how
4. **Composition Resolution**: Immutable metadata about how snapshot was computed
5. **Effective Membership**: Published sources contribute members; `latest_preview` drafts contribute prospective membership (members plus staged changes under source conflict rules, never candidates)
6. **No Workflow States**: No work-in-progress, awaiting-review, or reviewed states
7. **Scheduled Snapshots**: Can auto-generate snapshots on schedule
8. **Component Version Tracking**: Version history records which component versions were included

**Virtual Track Constraints:**

- Select published snapshots or the newest standard snapshot with `latest_preview`
- Preview drafts through standard release membership planning; never mutate the source or include candidates
- Can only compose from **standard release tracks** (not other virtual tracks - no nesting allowed)
- Is purely compositional and has no `native_members` or second membership
  authority; aggregate-specific content belongs in another standard component
  track
- Snapshots are created **manually or on schedule** (never event-driven)
- All snapshots start as **drafts** and must be explicitly tagged
- Component tracks must exist; selected source snapshot eligibility is checked at materialization
- Each component track must have a unique **priority** value (no duplicates)
- Priority is a required non-negative integer for every component, regardless
  of deduplication strategy
- Component IDs and priorities are validated before initial virtual-track
  persistence as well as during composition updates and materialization
- Snapshot schedules are strict and mode-discriminated: `manual` accepts only
  `mode`, `cron` requires a five-field `cron` expression and accepts optional
  nested `draft_retention`, and `dates` requires only a nonempty `dates` array
- Standard tracks reject `snapshot_schedule`; virtual `cron` and `dates`
  schedules execute through the global scheduler
- `filters.object_types` uses the canonical Workbench STIX type names from
  `app/lib/types.js`. When present, it must be nonempty and duplicate-free;
  omit it to include every object type. Filtering reads the type prefix from
  each member's immutable `object_ref`, so it preserves the exact revision
  pinned by the resolved component snapshot
- Exact revisions contributed by multiple components collapse to one member
  before conflict resolution. Only genuinely different revisions of one
  `object_ref` are resolved or quarantined. Every surviving member is
  attributed to exactly one deterministic component, so summed
  `objects_contributed` equals `summary.total_objects`
- Releasing a materialized virtual draft copies each
  `composition_resolution.component_snapshots[].resolved_version` into
  `version_history[].component_versions`. This is an object keyed by immutable
  component `track_id`, not display name. It records the frozen materialization
  inputs even when a component has newer releases by the time the virtual draft
  is tagged. Draft components record `null`; tagged components record their
  version string. Standard release history entries omit the field
- Composition request objects are strict; unknown composition, component,
  filter, and deduplication keys return `400 Bad Request`
- Selector fields form a discriminated request contract:
  - `latest_tagged` and `latest_preview` reject `version` and `snapshot`
  - `specific_version` requires `version` and rejects `snapshot`
  - `specific_snapshot` requires `snapshot` and rejects `version`
- Quarantine promotion selects an exact revision in a new draft and preserves
  the source snapshot's immutable `composition_resolution`
- Retired `latest_draft` is read-only historical composition/provenance, not an
  active request strategy or an alias for preview behavior
