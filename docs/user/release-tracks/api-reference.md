# Release Tracks API V2 - API Reference

## Overview

This document provides the complete API reference for Release Tracks V2 (formerly "Collections V2").

**Related Documentation:**
- [summary.md](./summary.md) - High-level design summary and problem statement
- [terminology.md](./terminology.md) - Complete terminology guide
- [versioning.md](./versioning.md) - Versioning and release process
- [virtual-tracks.md](./virtual-tracks.md) - Virtual release tracks (aggregations)
- [release-workflow.md](./release-workflow.md) - Workflow integration and candidacy
- [entities.md](../../developer/release-tracks/entities.md) - Database schemas and data models
- [output-formats.md](./output-formats.md) - Output format specifications
- [member-sync-strategies.md](../../developer/release-tracks/member-sync-strategies.md) - Automatic tracking of member object revisions

**Quick Navigation:**
- [Ephemeral Release Tracks](#ephemeral-release-tracks)
- [Release Track Management](#release-track-management)
- [Snapshot-Specific Operations](#snapshot-specific-operations)
- [Candidate Management](#candidate-management)
- [Staged Objects](#staged-objects)
- [Configuration](#configuration)
- [Preview & Dry Run](#preview--dry-run)
- [Version Pin Management](#version-pin-management)
- [Virtual Release Tracks](#virtual-release-tracks)
- [Query Variations](#query-variations)
- [Output Formats](#output-formats)
- [Error Responses](#error-responses)


## Complete Endpoint List

### Ephemeral Release Tracks
```
GET    /api/release-tracks/ephemeral/:domain
```

### Release Track Management
```
GET    /api/release-tracks
POST   /api/release-tracks/new
POST   /api/release-tracks/new-from-bundle
POST   /api/release-tracks/import
GET    /api/release-tracks/:id
POST   /api/release-tracks/:id/meta
POST   /api/release-tracks/:id/contents
POST   /api/release-tracks/:id/bump
POST   /api/release-tracks/:id/clone
DELETE /api/release-tracks/:id
```

### Snapshot Operations
```
GET    /api/release-tracks/:id/snapshots/:modified
POST   /api/release-tracks/:id/snapshots/:modified/meta
POST   /api/release-tracks/:id/snapshots/:modified/bump
POST   /api/release-tracks/:id/snapshots/:modified/clone
DELETE /api/release-tracks/:id/snapshots/:modified
```

### Candidate Management
```
POST   /api/release-tracks/:id/candidates
GET    /api/release-tracks/:id/candidates
DELETE /api/release-tracks/:id/candidates/:objectRef
POST   /api/release-tracks/:id/candidates/review
POST   /api/release-tracks/:id/candidates/promote
POST   /api/release-tracks/:id/candidates/:objectRef/update-version
```

### Staged Objects
```
GET    /api/release-tracks/:id/staged
POST   /api/release-tracks/:id/staged/demote
```

### Configuration
```
GET    /api/release-tracks/:id/config
PUT    /api/release-tracks/:id/config
```

### Preview & Dry Run
```
GET    /api/release-tracks/:id/bump/preview
```

### Version Management
```
GET    /api/release-tracks/:id/objects/:objectRef/versions
```

### Virtual Release Tracks (Additional)
```
PUT    /api/release-tracks/:id/composition
POST   /api/release-tracks/:id/snapshots/create
GET    /api/release-tracks/:id/snapshots/preview
```

---

## Ephemeral Release Tracks

"Ephemeral" release tracks refer to unmanaged, stateless release track snapshots. Upon request, a STIX bundle will be generated containing the latest copy of all objects contained within the respective domain as defined by the `:domain` path parameter.

Three options are supported in the `:domain` path parameter:
- `enterprise`
- `ics`
- `mobile`

These refer to all objects delineated by ATT&CK domain membership as reflected by the objects' `x_mitre_domains` property. 

### Get Ephemeral Bundle

```
GET /api/release-tracks/ephemeral/:domain
```

**Path Parameters:**
- `:domain` - `enterprise` | `ics` | `mobile`

**Query Parameters:**
- `format` - `bundle` | `filesystemstore` | `workbench` (default: `bundle`)

---

## Release Track Management

### List All Release Tracks

Retrieves a list of all release tracks (both standard and virtual) with summary information.

```
GET /api/release-tracks
```

**Query Parameters:**
- `releases` - `only` (filter to show only release tracks that have at least one tagged release)
- `type` - `standard` | `virtual` (filter by track type)
- `limit` - Number of results (pagination)
- `offset` - Pagination offset

**Response Example:**
```json
{
  "release_tracks": [
    {
      "id": "release-track--123",
      "type": "standard",
      "name": "Enterprise ATT&CK",
      "description": "Enterprise domain release track",
      "latest_version": "14.1",
      "latest_modified": "2024-01-15T16:20:00Z",
      "snapshot_count": 47,
      "tagged_release_count": 12,
      "summary": {
        "members_count": 3247,
        "staged_count": 18,
        "candidates_count": 42
      }
    },
    {
      "id": "release-track--456",
      "type": "virtual",
      "name": "Aggregated Enterprise",
      "description": "Virtual aggregation of multiple tracks",
      "latest_version": null,
      "latest_modified": "2024-01-10T10:00:00Z",
      "snapshot_count": 3,
      "tagged_release_count": 2,
      "summary": {
        "members_count": 870,
        "staged_count": 0,
        "candidates_count": 0
      }
    }
  ],
  "total": 2,
  "limit": 10,
  "offset": 0
}
```

### Create New Release Track

```
POST /api/release-tracks/new
```

**Request Body:**
```json
{
  "name": "Release Track Name",
  "description": "Description",
  "external_references": [],
  "object_marking_refs": []
}
```

### Bootstrap Release Track From Bundle

Creates a new release track initialized with objects from a STIX bundle. This is useful for importing existing collections or bootstrapping from published ATT&CK releases.

```
POST /api/release-tracks/new-from-bundle
```

**Request Body:**
```json
{
  "type": "bundle",
  "id": "bundle--9ed7099a-63b8-4e49-92c7-547d39aa29e0",
  "objects": [
    {
      "type": "attack-pattern",
      "id": "attack-pattern--uuid1",
      "name": "Technique A"
    },
    {
      "type": "malware",
      "id": "malware--uuid2",
      "name": "Malware B"
    }
  ]
}
```

**Response:**
```json
{
  "release_track_id": "release-track--new-uuid",
  "snapshot_id": "2024-01-15T10:00:00.000Z",
  "objects_imported": 2,
  "initial_tier": "members"
}
```

**Note:** All objects are added directly to the `members` tier. To add objects as candidates instead, use the standard [Create New Release Track](#create-new-release-track) endpoint followed by [Add Candidates](#add-candidates).

### Import Release Track (Not Implemented)

Comprehensively importing a release track would necessitate including the full snapshot history of the source release track. We don't presently have a solution for serializing an entire release track, including its snapshot history, into an atomic structure that can be exchanged between different Workbench deployments.

However, we can viably "bootstrap" a new release track from a given STIX bundle (see [Bootstrap Release Track From Bundle](#bootstrap-release-track-from-bundle)).

This endpoint should return/throw a `NotImplementedError` exception with HTTP status 501 (Not Implemented) until such a solution has been designed.

```
POST /api/release-tracks/import
```

**Request Body:** TBD

**Status:** Not Implemented (501)

### Get Latest Snapshot

Retrieves the most recent snapshot from the release track (by `modified` timestamp).

```
GET /api/release-tracks/:id
```

For raw snapshot responses, entries in the `candidates` and `staged` tiers include extra object details:

- `attack_id`
- `name`
- `description` (when available)
- `modified_by_user.name` (display name, or username if display name is missing)

**Query Parameters:**

| Parameter | Values | Description |
|-----------|--------|-------------|
| `format` | `bundle` \| `filesystemstore` \| `workbench` | Output format (default: `bundle`) |
| `include` | `staged` \| `candidates` \| `all` | Which tiers to include (default: members only) |
| `releases` | `only` | Return only the latest tagged release instead of latest snapshot |
| `version` | `X.Y` | Return specific version (e.g., `14.1`) |
| `versions` | `all` | List all snapshots with metadata |

**Examples:**

```bash
# Get latest snapshot as STIX bundle (members only)
GET /api/release-tracks/:id

# Get latest snapshot with all tiers in workbench format
GET /api/release-tracks/:id?include=all&format=workbench

# Get latest tagged release (not draft)
GET /api/release-tracks/:id?releases=only

# Get specific version
GET /api/release-tracks/:id?version=14.1

# List all snapshots
GET /api/release-tracks/:id?versions=all
```

### Update Metadata

A user or team may wish to:
- rename a release (e.g., fix a typo like `"Entrprise"` to `"Enterprise"`) or shift the scope/purpose of an existing release track without losing its history (though [cloning](#clone-latest-snapshot) is preferred in this scenario)
- update metadata (which at present consists of a `description` field, `object_marking_references` (typically only includes the global marking definition) and the author (`created_by_ref`).
```
POST /api/release-tracks/:id/meta
```

Creates new snapshot with updated metadata.

**Request Body:**
```json
{
  "name": "Updated Name",
  "description": "Updated description",
  "external_references": [],
  "object_marking_refs": []
}
```

### Update Contents

```
POST /api/release-tracks/:id/contents
```

Creates new snapshot with updated member objects. **This is intended for retroactive hotfixes only.** The main workflow for enrolling new member objects into `x_mitre_contents` is through the candidate-staging promotion cycle described in [versioning.md](./versioning.md). 

**Request Body:**
```json
{
  "x_mitre_contents": ["attack-pattern--uuid1", "malware--uuid2"]
}
```

### Bump/Tag Latest Snapshot

Converts the latest draft snapshot to a tagged release. Tags the snapshot in-place (does not create new snapshot). Dynamically sets `x_mitre_version` based on the request body options.

- If `version` is provided, uses that exact version (must be `X.Y` format)
- If `type` is provided, calculates next version based on bump type
- If omitted, defaults to minor bump
- If this is the first release, the version will be `1.0`

```
POST /api/release-tracks/:id/bump
```

**Request Body (optional):**
```json
{
  "type": "major" | "minor",  // Defaults to "minor" if omitted
  "version": "X.Y",           // Alternative: explicit version
  "dry_run": true             // Optional: preview without persisting
}
```

### Clone Release Track From Latest

Bootstraps a new `release-track` instance from an existing snapshot.
```
POST /api/release-tracks/:id/clone
```

**Request Body:**
```json
{
  "name": "Cloned Release Track" // optional
}
```

### Delete Release Track

```
DELETE /api/release-tracks/:id
```

**Query Parameters:**
- `versions` - `latest` (delete only latest, default: all)

---

## Snapshot-Specific Operations

All operations in this section operate on a specific snapshot identified by its `modified` timestamp.

### Get Specific Snapshot

Retrieves a specific snapshot by its `modified` timestamp.

```
GET /api/release-tracks/:id/snapshots/:modified
```

**Path Parameters:**
- `:modified` - ISO 8601 timestamp (e.g., `2024-01-15T16:20:00.000Z`)

**Query Parameters:**
- `format` - `bundle` | `filesystemstore` | `workbench` (default: `bundle`)
- `include` - `staged` | `candidates` | `all` (default: members only)

**Example:**
```bash
# Get snapshot from January 15, 2024 as STIX bundle
GET /api/release-tracks/:id/snapshots/2024-01-15T16:20:00.000Z

# Get with all tiers in workbench format
GET /api/release-tracks/:id/snapshots/2024-01-15T16:20:00.000Z?include=all&format=workbench
```

### Update Metadata (Specific Snapshot)

```
POST /api/release-tracks/:id/snapshots/:modified/meta
```

Creates new snapshot with updated metadata.

**Request Body:** Same as [Update Metadata](#update-metadata) for latest snapshot.

### Update Contents (Specific Snapshot)

```
POST /api/release-tracks/:id/snapshots/:modified/contents
```

Creates new snapshot with updated member objects. **This is intended for retroactive hotfixes only.**

**Request Body:** Same as [Update Contents](#update-contents) for latest snapshot.

### Bump/Tag Specific Snapshot

Converts a specific draft snapshot to a tagged release. Tags snapshot in-place (does not create new snapshot).

```
POST /api/release-tracks/:id/snapshots/:modified/bump
```

**Request Body:** Same as [Bump/Tag Latest Snapshot](#bumptag-latest-snapshot).

### Clone Specific Snapshot

Bootstraps a new release track from the specified snapshot.
```
POST /api/release-tracks/:id/snapshots/:modified/clone
```

### Delete Specific Snapshot

**TODO**: further consideration needs to be given here. We need to be careful to avoid breaking contextual continuity between snapshots.
```
DELETE /api/release-tracks/:id/snapshots/:modified
```

---

## Candidate Management

### Add Candidates

Adds STIX objects as candidates to the latest draft snapshot. Each object is identified by its `stix.id` field, as well as (optionally) its `stix.modified` field. If `stix.modified` is omitted, the latest permutation of the relevant STIX object will be added. The candidacy reference will follow the latest version of the object until the moment the draft is converted to a release, at which point the reference will become locked to the specific permutation of the object that was considered "latest" at the time the release bump occurred.

```
POST /api/release-tracks/:id/candidates
```

**Request Body:**
```json
{
  "object_refs": [
    {"id": "attack-pattern--uuid", "modified": "2024-01-15T10:00:00Z"}, // pinned to specific version
    {"id": "malware--uuid"} // follows latest version while marked as candidate
  ]
}
```

Simplified (uses latest versions):
```json
{
  "object_refs": ["attack-pattern--uuid", "malware--uuid"]
}
```

### List Candidates

Retrieves the list of candidate objects from the latest snapshot.

```
GET /api/release-tracks/:id/candidates
```

**Query Parameters:**
- `status` - Filter by workflow status: `work-in-progress` | `awaiting-review` | `reviewed`

**Response Example:**
```json
{
  "candidates": [
    {
      "object_ref": "attack-pattern--eee",
      "object_modified": "2024-01-12T09:00:00Z",
      "object_name": "New Technique XYZ",
      "object_type": "attack-pattern",
      "status": "work-in-progress",
      "added_at": "2024-01-10T10:00:00Z",
      "added_by": "alice@example.com"
    },
    {
      "object_ref": "malware--fff",
      "object_modified": "2024-01-13T14:00:00Z",
      "object_name": "New Malware ABC",
      "object_type": "malware",
      "status": "awaiting-review",
      "added_at": "2024-01-12T14:30:00Z",
      "added_by": "bob@example.com"
    }
  ],
  "total": 2
}
```

### Remove Candidate

Remove an object from the latest snapshot's candidates list (`workspace.candidates`).
```
DELETE /api/release-tracks/:id/candidates/:objectRef
```

### Bulk Object Status Transition

Bulk transition candidate objects currently in the latest snapshot from workflow status `from` to workflow status `to`. 
- Optionally target specific candidates using the `object_refs` filter. 
- `object_refs` is optional; if omitted, transitions all matching `from` status.

Bidirectional status transition is supported here. For example, objects can be transition from "reviewed" → "awaiting-review" or from "awaiting-review" → "work-in-progress".

Notably, changes to an object's status (e.g., "work-in-progress" → "awaiting-review") will automatically update its release track membership standing (e.g., candidate, staged, member). In the most restrictive (typical) scenario, a candidate object transitioning to the "reviewed" state will trigger a new draft snapshot creation wherein the object is now staged.
```
POST /api/release-tracks/:id/candidates/review
```

**Request Body:**
```json
{
  "from": "work-in-progress",
  "to": "awaiting-review",
  "object_refs": [
    {"id": "attack-pattern--uuid", "modified": "2024-01-15T10:00:00Z"}
  ]
}
```

---

## Staged Objects

### List Staged Objects

Retrieves the list of staged objects from the latest snapshot. Staged objects are ready for the next tagged release.

```
GET /api/release-tracks/:id/staged
```

**Response Example:**
```json
{
  "staged": [
    {
      "object_ref": "attack-pattern--ddd",
      "object_modified": "2024-01-14T10:00:00Z",
      "object_name": "Reviewed Technique",
      "object_type": "attack-pattern",
      "status": "reviewed",
      "staged_at": "2024-01-14T11:00:00Z",
      "staged_by": "reviewer@example.com"
    }
  ],
  "total": 1
}
```

### Promote Candidate Objects To Staged

```
POST /api/release-tracks/:id/candidates/promote
```

**Request Body:**
```json
{
  "object_refs": ["attack-pattern--eee"]
}
```

**Response:**
```json
{
  "promoted": [
    {
      "object_ref": "attack-pattern--eee",
      "status": "work-in-progress",
      "warning": "Object is not reviewed, manual override applied"
    }
  ]
}
```

### Demote Staged Objects To Candidates

```
POST /api/release-tracks/:id/staged/demote
```

**Request Body:**
```json
{
  "object_refs": [
    {"id": "attack-pattern--uuid", "modified": "2024-01-15T10:00:00Z"}
  ]
}
```

---

## Configuration

### Get Configuration

```
GET /api/release-tracks/:id/config
```

### Update Configuration

```
PUT /api/release-tracks/:id/config
```

**Request Body:**
```json
{
  "candidacy_threshold": "work-in-progress" | "awaiting-review" | "reviewed",
  "auto_promote": true | false
}
```

---

## Preview & Dry Run

> **Note on `include` Query Parameter:** The `include` query parameter (used on snapshot retrieval endpoints to filter which tiers are returned) is **NOT supported** on bump preview or dry-run operations. Bump previews and dry-runs are intended to show the user exactly what *will* happen when a bump occurs; ad-hoc filters would be misleading because they do not affect the actual release outcome.

### Preview Next Release (Read-Only)

Shows a verbose diff of what will change in the next tagged release without creating any data.

```
GET /api/release-tracks/:id/bump/preview
```

**Query Parameters:**
- `format` - `bundle` | `filesystemstore` | `workbench` (default: `workbench`)

**Response Example:**
```json
{
  "current_version": "1.1",
  "next_version": "1.2",
  "release_preview": {
    "will_include": [
      {
        "ref": "attack-pattern--ddd",
        "name": "New Technique XYZ",
        "status": "reviewed",
        "source": "staged"
      }
    ],
    "will_exclude": [
      {
        "ref": "attack-pattern--eee",
        "name": "WIP Technique",
        "status": "work-in-progress",
        "reason": "Does not meet candidacy threshold"
      }
    ]
  }
}
```

### Dry Run Bump (Returns Exact Output)

Performs all bump logic and returns the exact release contents without persisting changes to the database.

```
POST /api/release-tracks/:id/bump
```

**Request Body:**
```json
{
  "type": "minor",
  "dry_run": true
}
```

**Response:** Returns the exact snapshot that would be created, with all objects and metadata.

---

## Version Pin Management

### Update Candidate Version Pin

Updates which version of an object a candidate reference is pinned to. This allows upgrading a candidate to track a newer version of an object, or downgrading to a previous version.

```
POST /api/release-tracks/:id/candidates/:objectRef/update-version
```

**Request Body:**
```json
{
  "old_modified": "2024-01-15T10:00:00Z",
  "new_modified": "2024-01-20T14:00:00Z"
}
```

**Use Cases:**
- Upgrading a candidate to the latest version of an object
- Downgrading to a previous stable version
- Synchronizing with another release track's version

**Note:** This operation creates a new draft snapshot with the updated version pin.

### List Object Versions in Release Track

Lists all versions of a specific object referenced across all tiers (candidates, staged, members) in the release track.

```
GET /api/release-tracks/:id/objects/:objectRef/versions
```

**Response Example:**
```json
{
  "object_ref": "attack-pattern--T1234",
  "versions": [
    {
      "modified": "2024-02-15T10:00:00Z",
      "tier": "candidates",
      "status": "work-in-progress"
    },
    {
      "modified": "2024-02-01T14:00:00Z",
      "tier": "members",
      "status": "reviewed"
    }
  ]
}
```

---

## Output Formats

### `bundle` (Default)

Standard STIX 2.1 bundle.

### `filesystemstore`

STIX FileSystemStore directory structure.

### `workbench`

Custom format with workflow metadata for UI.

---

## Error Responses

### AlreadyReleasedError

**Status:** 409 Conflict

Snapshot already has a version assigned.

### InvalidVersionError

**Status:** 400 Bad Request

Invalid version format or not greater than previous versions.

### NotFoundError

**Status:** 404 Not Found

Release track not found.

---

## Virtual Release Tracks

Virtual release tracks are computed aggregations of other release tracks. Unlike standard tracks, virtual tracks don't directly manage objects through the candidate → staged → released workflow. Instead, they compose content from multiple "component tracks" based on configurable rules.

**Key Characteristics:**
- Compute contents from component standard or virtual tracks
- Only reference **tagged snapshots** from component tracks (never drafts)
- Create snapshots **manually or on schedule** (never event-driven)
- All snapshots start as **drafts** and must be explicitly tagged
- Support **resolution strategies** to control which component versions are included

**Resolution Strategies:**
1. `latest_tagged` - Always use the most recent tagged snapshot from component
2. `specific_version` - Pin to a specific semantic version (e.g., "5.0")
3. `specific_snapshot` - Pin to a specific snapshot by timestamp

See [virtual-tracks.md](./virtual-tracks.md) for complete documentation.

### Create Virtual Track

```
POST /api/release-tracks/new
```

**Request Body:**
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

### Update Virtual Track Composition

```
PUT /api/release-tracks/:id/composition
```

**Request Body:**
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

```
POST /api/release-tracks/:id/snapshots/create
```

**Request Body:**
```json
{
  "description": "Q1 2024 snapshot"
}
```

**Response:**
```json
{
  "stix": {
    "id": "x-mitre-collection--virtual-uuid",
    "modified": "2024-03-01T10:00:00Z",
    "x_mitre_version": null,
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
      }
    ],
    "total_objects": 870,
    "duplicates_resolved": 0
  }
}
```

### Preview Virtual Snapshot

Preview what a snapshot would contain without creating it:

```
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

---

## Query Variations

### Snapshot Retrieval Endpoints

The following retrieval endpoints support `include` and `format` query parameters:

- `GET /api/release-tracks/:id` (get latest snapshot)
- `GET /api/release-tracks/:id/snapshots/:modified` (get specific snapshot)
- `GET /api/release-tracks/ephemeral/:domain` (get ephemeral bundle)

**Include Parameter** (controls which tiers are returned):
```
GET /api/release-tracks/:id                            # Default: members only
GET /api/release-tracks/:id?include=staged             # Members and staged tiers
GET /api/release-tracks/:id?include=candidates         # Members and candidates tiers
GET /api/release-tracks/:id?include=all                # All tiers (members, staged, candidates)
```

**Format Parameter** (controls output format):
```
GET /api/release-tracks/:id?format=bundle              # Standard STIX 2.1 bundle (default)
GET /api/release-tracks/:id?format=filesystemstore     # STIX FileSystemStore structure
GET /api/release-tracks/:id?format=workbench           # Workbench format with metadata
```

**Combined Example:**
```
GET /api/release-tracks/:id?include=all&format=workbench
```

### Bump Operations (Preview & Dry Run)

The `include` query parameter is **NOT supported** on bump preview or dry-run endpoints:

- `GET /api/release-tracks/:id/bump/preview` — only `format` is supported
- `POST /api/release-tracks/:id/bump` with `dry_run: true` — only `format` is supported (via request body)

These endpoints are designed to show exactly what *will* happen during a release bump. Allowing ad-hoc tier filters would be misleading because they do not affect the actual release outcome.
