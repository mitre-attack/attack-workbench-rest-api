# Release Workflow

## Overview

This document describes how object workflow states integrate with the release track versioning and release system. It addresses the critical challenge of managing thousands of objects being developed in parallel by multiple users while maintaining clean, production-ready tagged releases.

**Key Design Decision:** This system uses **release track-centric status with version pinning** to solve the "STIX freeze" problem. Each release track tracks its own workflow status for objects and pins to specific object versions, allowing the same object to be in different states across different release tracks and enabling work on future releases while current releases are frozen.

**Note on Terminology:** We use **release track** instead of "collection" to avoid confusion with TAXII collections, MongoDB collections, STIX bundles, and `x-mitre-collection` SDOs. See [terminology.md](./terminology.md) for the complete terminology guide.

**Related Documentation:**
- [member-sync-strategies.md](../../developer/release-tracks/member-sync-strategies.md) - Automatic tracking of new member object revisions

## Core Concepts

### Object Workflow States (Release Track-Centric)

Workflow status is **scoped to each release track**, not global to the object. This means:
- The same object can have different workflow states in different release tracks
- Release Track A can track an object as "reviewed" while Release Track B tracks it as "work-in-progress"
- Each release track independently manages which objects are ready for release

The three workflow states tracked per release track:
1. **work-in-progress** - Object is being actively developed, not ready for review
2. **awaiting-review** - Object is complete and waiting for team review
3. **reviewed** - Object has been reviewed and approved, ready for release

### Version Pinning

Each tier entry includes **version pinning** via the `object_modified` timestamp:
- Release tracks track a reference to a **specific version** of an object (identified by its `stix.modified` timestamp)
- Different release tracks can pin to different versions of the same object
- This enables working on future object versions while a tagged release containing an earlier version is frozen

### Release Track Membership Tiers

Release tracks maintain objects in three distinct tiers, with each entry pinning to a specific object version:

1. **Candidates** (`candidates`) - Objects being worked on with track-scoped status
2. **Staged** (`staged`) - Reviewed objects (in this release track) ready for the next tagged release
3. **Released** (`members`) - Object versions included in the current/latest tagged release

### Automatic Promotion Flow

```
Object version added to release track
  ↓
Track-scoped status: work-in-progress → Added to candidates with version pin
  ↓
Track-scoped status: awaiting-review → Remains in candidates
  ↓
Track-scoped status: reviewed → Automatically promoted to staged
  ↓
Snapshot tagged → staged entries moved to members
  ↓
Snapshot exported → members reflected in stix.x_mitre_contents of the output bundle
```

### STIX Freeze Solution

Version pinning solves the "STIX freeze" problem:

**The Problem:**
- User completes changes to Object A for Release Track A's next tagged release
- Cannot start working on Object A for the next-next release until after current release ships
- Must wait for STIX freeze to end before continuing development

**The Solution:**
- Release Track A pins to `attack-pattern--A, modified: 2024-01-15T10:00:00Z` for the v1.5 tagged release
- User creates new version of Object A: `attack-pattern--A, modified: 2024-01-20T14:00:00Z`
- New version can be added to Release Track A as a candidate for the NEXT release (v1.6)
- Release Track A now tracks TWO versions of the same object:
  - Released tier: `modified: 2024-01-15T10:00:00Z` (frozen for v1.5)
  - Candidates tier: `modified: 2024-01-20T14:00:00Z` (in development for v1.6)
- Work continues on v1.6 while v1.5 is frozen

## Candidacy Threshold Configuration

Release tracks can be configured with different thresholds for what workflow states are acceptable. This controls how the "auto-promotion" mechanism works; if an object status meets the candidacy threshold, then the object will be automatically staged for the next release.

Typical release tracks will use the default candidacy threshold setting of `reviewed`, which requires that the object(s) status be `reviewed` in order for the object to become staged.

However, smaller teams operating in purely developmenet or research capacities may prefer a more permissive model. Perhaps they simply want all objects to be included in the release irrespective of object status. In such situations, the candidacy threshold can be lowered to `awaiting-review` or `work-in-progress`.

### Option 1: Include Only Reviewed (Default)
```javascript
workspace.config.candidacy_threshold = "reviewed"
```
- Only objects with `status: "reviewed"` are auto-promoted to staged
- Strictest option for production collections

### Option 2: Include Awaiting Review
```javascript
workspace.config.candidacy_threshold = "awaiting-review"
```
- Objects with `status: "awaiting-review"` or `"reviewed"` are auto-promoted to staged
- Good for collections with trusted contributors

### Option 3: Include Work in Progress
```javascript
workspace.config.candidacy_threshold = "work-in-progress"
```
- All objects are immediately promoted to staged
- Useful for development/testing collections
- No filtering based on workflow status

## Workflow Operations

### 1. Adding Objects as Candidates (with Version Pinning)

Candidates can be added or modified with the following endpoint:
```
POST /api/release-tracks/:id/candidates
```

**Request Body:**
```json
{
  "object_refs": [
    {
      "id": "attack-pattern--eee",
      "modified": "2024-01-12T09:00:00Z"  // Optional: pin to specific version, defaults to latest
    },
    {
      "id": "attack-pattern--fff"  // No modified = use latest version
    }
  ]
}
```

**Simplified Request Body (defaults to latest version):**
```json
{
  "object_refs": ["attack-pattern--eee", "attack-pattern--fff"]
}
```

**Response:**
```json
{
  "added": [
    {
      "object_ref": "attack-pattern--eee",
      "object_modified": "2024-01-12T09:00:00Z",
      "status": "work-in-progress",
      "added_to": "candidates"
    },
    {
      "object_ref": "attack-pattern--fff",
      "object_modified": "2024-01-13T14:00:00Z",
      "status": "work-in-progress",
      "added_to": "staged"  // Auto-promoted if meets threshold
    }
  ],
  "errors": []
}
```

**Business Logic:**
1. Validate all object_refs exist
2. Resolve `object_modified` timestamp:
   - If provided: validate that specific version exists
   - If omitted: use latest version (highest `stix.modified`)
3. Set initial track-scoped status (defaults to "work-in-progress")
4. Add to `workspace.candidates` with version pin
5. If status meets `candidacy_threshold`, auto-promote to `workspace.staged`
6. Update object's `workspace.referenced_by` array

Importantly, candidate removal/deletion must occur separately using the `DELETE` operation:
```bash
DELETE /api/release-tracks/:id/candidates
```

### 2. Bulk Workflow Status Change

Update the workflow status of many candidates at once using one bulk operation. Target specific candidates using `object_refs` or all objects by omitting.
```
POST /api/release-tracks/:id/candidates/Review
```

**Request Body:**
```json
{
  "from": "work-in-progress",
  "to": "awaiting-review",
  "object_refs": ["attack-pattern--eee"]  // optional, transitions all if omitted
}
```

**Response:**
```json
{
  "transitioned": [
    {
      "object_ref": "attack-pattern--eee",
      "object_modified": "2024-01-12T09:00:00Z",
      "old_status": "work-in-progress",
      "new_status": "awaiting-review",
      "promoted_to_staged": false  // Doesn't meet threshold yet
    }
  ],
  "errors": []
}
```

**Business Logic:**
1. Find all entries in `workspace.candidates` matching `from` status
2. Filter by `object_refs` if provided
3. Update track-scoped status for each entry from `from` to `to`
4. If new status meets `candidacy_threshold`, promote entry to `workspace.staged`
5. Update object's `workspace.referenced_by` to reflect new status
6. Fire `collection:status-changed` event for each object
7. Return summary of transitions

**Important:** This only affects status within THIS collection. The same object may have different statuses in other collections.

### 3. Manual Promotion to Staged

Editors may bypass auto-promotion (via candidacy threshold) by *manually* promoting candidates to the staged status. Importantly, the workflow status will remain unchanged which may be in conflict with the release track's candidacy threshold setting. Realistic use cases include situations where WIP objects need to be rushed out the door in some imminent release before a reviewer has time to officially review and update its workflow status accordingly. 
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

**Business Logic:**
- Allows manual promotion even if status doesn't meet threshold
- Useful for exceptions or urgent fixes
- Logs warning for audit trail

### 4. Promotion Conflict Resolution

When promoting objects between tiers, conflicts can occur if multiple versions of the same object (same `stix.id`, different `stix.modified` timestamps) exist. Release tracks use **conflict resolution policies** to determine how to handle these situations.

**When do conflicts occur?**
- Promoting from `candidates` to `staged` when a different version of the object already exists in `staged`
- Promoting from `staged` to `members` (during tagging/release) when a different version already exists in `members`

**Promotions can happen via:**
- **Manual promotion** via REST API endpoint (e.g., `POST /api/release-tracks/:id/candidates/promote`)
- **Auto-promotion** based on candidacy threshold (e.g., object status changes to `awaiting-review`)
- **Tagging/release operations** (e.g., `POST /api/release-tracks/:id/bump`)

#### Conflict Resolution Policies

Release tracks can be configured with different policies for handling promotion conflicts:

```javascript
config: {
  promotion_conflicts: {
    candidates_to_staged: "prefer_latest",     // Candidates → Staged promotions
    staged_to_members: "abort"                 // Staged → Members promotions (during release)
  }
}
```

#### Policy Options

##### 1. `always_overwrite`

Always keep the incoming object and discard the incumbent object.

**Example:**
```javascript
// Current state:
// - staged: attack-pattern--T1234, modified: 2024-01-15

// Promotion request:
// - Promote attack-pattern--T1234, modified: 2024-02-20 from candidates to staged

// Result with always_overwrite:
// - staged: attack-pattern--T1234, modified: 2024-02-20  (new version)
// - candidates: attack-pattern--T1234, modified: 2024-02-20 (removed)
```

**Use case:** "Always use the latest work, overwrite previous versions"

##### 2. `always_reject`

Always keep the incumbent object and reject the incoming object. The rejected object remains in its current tier.

**Example:**
```javascript
// Current state:
// - staged: attack-pattern--T1234, modified: 2024-01-15

// Promotion request:
// - Promote attack-pattern--T1234, modified: 2024-02-20 from candidates to staged

// Result with always_reject:
// - staged: attack-pattern--T1234, modified: 2024-01-15  (unchanged)
// - candidates: attack-pattern--T1234, modified: 2024-02-20 (stays in candidates)

// Response:
{
  "rejected": [
    {
      "object_ref": "attack-pattern--T1234",
      "object_modified": "2024-02-20T10:00:00Z",
      "reason": "Conflict: Different version already in staged tier",
      "incumbent_version": "2024-01-15T10:00:00Z",
      "resolution": "Rejected per always_reject policy"
    }
  ]
}
```

**Use case:** "Protect already-staged content from being overwritten"

##### 3. `prefer_latest`

Keep whichever version has the newer `modified` timestamp.

**Example:**
```javascript
// Current state:
// - staged: attack-pattern--T1234, modified: 2024-01-15

// Promotion request:
// - Promote attack-pattern--T1234, modified: 2024-02-20 from candidates to staged

// Result with prefer_latest:
// - staged: attack-pattern--T1234, modified: 2024-02-20  (newer version wins)
```

**Use case:** "Trust the most recent edits, regardless of current tier"

##### 4. `abort` (Tagging/Release Operations Only)

[](./release-workflow.md#4-abort-taggingrelease-operations-only)
**Only available for `staged_to_members` during tagging/release operations.**

If a conflict occurs during a tagging/release operation (`POST /api/release-tracks/:id/bump`), reject and abort the entire release. The snapshot will NOT be tagged, and no immutable snapshot will be created.

**The error response will include ALL conflicting objects**, not just the first one encountered. This allows editors to see the full scope of conflicts that must be resolved before the release can proceed.

**Example with single conflict:**
```javascript
// Current state:
// - members: attack-pattern--T1234, modified: 2024-01-15
// - staged: attack-pattern--T1234, modified: 2024-02-20

// Tagging request:
POST /api/release-tracks/release-track--123/bump
{ "type": "minor" }

// Result with abort:
// ERROR Response:
{
  "error": "ReleaseConflictError",
  "message": "Cannot complete release: 1 conflict(s) detected",
  "conflicts": [
    {
      "object_ref": "attack-pattern--T1234",
      "incumbent_version": "2024-01-15T10:00:00Z",
      "incoming_version": "2024-02-20T10:00:00Z"
    }
  ]
}
```

**Example with multiple conflicts:**
```javascript
// Current state:
// - members: attack-pattern--T1234, modified: 2024-01-15
// - members: attack-pattern--T5678, modified: 2024-01-16
// - staged: attack-pattern--T1234, modified: 2024-02-20
// - staged: attack-pattern--T5678, modified: 2024-02-21
// - staged: attack-pattern--T9999, modified: 2024-02-22 (no conflict)

// Tagging request:
POST /api/release-tracks/release-track--123/bump
{ "type": "minor" }

// Result with abort - shows ALL conflicts:
// ERROR Response:
{
  "error": "ReleaseConflictError",
  "message": "Cannot complete release: 2 conflict(s) detected",
  "conflicts": [
    {
      "object_ref": "attack-pattern--T1234",
      "incumbent_version": "2024-01-15T10:00:00Z",
      "incoming_version": "2024-02-20T10:00:00Z"
    },
    {
      "object_ref": "attack-pattern--T5678",
      "incumbent_version": "2024-01-16T10:00:00Z",
      "incoming_version": "2024-02-21T10:00:00Z"
    }
  ]
}

// State unchanged:
// - Snapshot NOT tagged
// - No new version history entry
// - Objects remain in current tiers
// - Editor must resolve both conflicts before retrying
```

**Use case:** "Never accidentally overwrite released content during a release; require explicit conflict resolution"

**Why abort is important:** Once a snapshot is tagged and released, it becomes immutable. The `abort` policy ensures that releases don't inadvertently overwrite existing released content, providing an additional safety guardrail for critical release operations.

**Why report all conflicts:** When multiple conflicts exist, reporting all of them in a single error response allows editors to address all issues at once, rather than discovering them one at a time through repeated release attempts. This significantly improves the workflow efficiency when dealing with complex release scenarios.

#### Configuring Conflict Resolution Policies

**Update release track configuration:**
```bash
PUT /api/release-tracks/:id/config
```

**Request:**
```json
{
  "promotion_conflicts": {
    "candidates_to_staged": "prefer_latest",
    "staged_to_members": "abort"
  }
}
```

**Default values:**
- `candidates_to_staged`: `"prefer_latest"`
- `staged_to_members`: `"abort"`

#### Best Practices

1. **Production tracks**: Use `abort` for `staged_to_members` to prevent accidental overwrites during releases
2. **Development tracks**: Use `always_overwrite` or `prefer_latest` for faster iteration
3. **Review conflicts before releasing**: Always run `GET /api/release-tracks/:id/bump/preview` to identify potential conflicts
4. **Manual resolution**: When `abort` triggers, manually resolve conflicts before retrying the release

### 5. Viewing Latest Snapshot with All Tiers

Set the `include` query parameter to `members`, `staged`, `candidates` or `all` to view different subsets of a given snapshot.
```
GET /api/release-tracks/:id?include=all
```

**Response:**
```json
{
  "id": "release-track--123",
  "version": "1.1",
  "members": [
    {
      "ref": "attack-pattern--aaa",
      "modified": "2024-01-10T10:00:00Z"
    },
    {
      "ref": "malware--bbb",
      "modified": "2024-01-11T14:30:00Z"
    }
  ],
  "staged": [
    {
      "ref": "attack-pattern--ddd",
      "modified": "2024-01-14T10:00:00Z",
      "status": "reviewed",
      "object_name": "New Technique XYZ"
    }
  ],
  "candidates": [
    {
      "ref": "attack-pattern--eee",
      "modified": "2024-01-12T09:00:00Z",
      "status": "work-in-progress",
      "object_name": "WIP Technique"
    }
  ],
  "summary": {
    "members_count": 2,
    "staged_count": 1,
    "candidate_count": 1,
    "total_count": 4
  }
}
```

### 6. Preview Release

Compute a release preview, which outputs a verbose diff of what will change in the next release. **This endpoint will detect and report all conflicts** that would prevent the release from proceeding, allowing editors to resolve issues before attempting to tag.

```
GET /api/release-tracks/:id/bump/preview
```

**Response (success - no conflicts):**
```json
{
  "current_version": "1.1",
  "next_version": "1.2",
  "release_preview": {
    "will_include": [
      {
        "ref": "attack-pattern--aaa",
        "modified": "2024-01-10T10:00:00Z",
        "object_type": "attack-pattern",
        "name": "Technique A",
        "status": "reviewed",
        "source": "members"
      },
      {
        "ref": "attack-pattern--ddd",
        "modified": "2024-01-14T10:00:00Z",
        "object_type": "attack-pattern",
        "name": "New Technique XYZ",
        "status": "reviewed",
        "source": "staged"
      }
    ],
    "will_exclude": [
      {
        "ref": "attack-pattern--eee",
        "modified": "2024-01-12T09:00:00Z",
        "object_type": "attack-pattern",
        "name": "WIP Technique",
        "status": "work-in-progress",
        "reason": "Object is work-in-progress, not meeting candidacy threshold"
      }
    ]
  },
  "statistics": {
    "total_objects": 3,
    "included_objects": 2,
    "excluded_objects": 1
  }
}
```

**Response (with conflicts detected):**
```json
{
  "track_id": "release-track--123",
  "snapshot_modified": "2024-01-15T16:20:00.000Z",
  "is_already_tagged": false,
  "current_version": null,
  "next_version_minor": "1.2",
  "next_version_major": "2.0",
  "staged_count": 3,
  "members_count": 2,
  "candidates_count": 1,
  "conflicts": [
    {
      "object_ref": "attack-pattern--T1234",
      "incumbent_version": "2024-01-15T10:00:00Z",
      "incoming_version": "2024-02-20T10:00:00Z"
    },
    {
      "object_ref": "attack-pattern--T5678",
      "incumbent_version": "2024-01-16T10:00:00Z",
      "incoming_version": "2024-02-21T10:00:00Z"
    }
  ]
}
```

**Note:** When the `staged_to_members` conflict policy is set to `abort` and conflicts are detected, the preview will include a `conflicts` array listing **all** conflicting objects, not just the first one encountered.

### 7. Bump with Staging

```
POST /api/collections/:id/bump
```

**Request:**
```json
{
  "type": "minor",
  "dry_run": false // <-- optionally perform a dry run to preview the next release4
}
```

**Response:**
```json
{
  "id": "release-track--123",
  "snapshot_id": "2024-01-15T16:20:00.000Z",
  "modified": "2024-01-15T16:20:00Z",
  "version": "1.2",
  "members": [
    {
      "ref": "attack-pattern--aaa",
      "modified": "2024-01-10T10:00:00Z"
    },
    {
      "ref": "malware--bbb",
      "modified": "2024-01-11T14:30:00Z"
    },
    {
      "ref": "attack-pattern--ddd",
      "modified": "2024-01-14T10:00:00Z"  // Promoted from staged
    }
  ],
  "release_summary": {
    "promoted_from_staged": [
      {
        "ref": "attack-pattern--ddd",
        "modified": "2024-01-14T10:00:00Z",
        "name": "New Technique XYZ"
      }
    ],
    "remaining_staged": [],
    "remaining_candidates": [
      {
        "ref": "attack-pattern--eee",
        "modified": "2024-01-12T09:00:00Z",
        "name": "WIP Technique",
        "status": "work-in-progress"
      }
    ]
  }
}
```

**Business Logic:**
1. Validate no `AlreadyReleasedError`
2. Calculate next version
3. Move all entries from `staged` to `members` (preserving version pins)
4. Update object documents: change tier in `workspace.referenced_by` from "staged" → "members"
5. Set `version` on release track
6. Add entry to `version_history`
7. Return summary showing what was promoted

**Note on Version Pins:** The `modified` timestamps are preserved during promotion. Released objects remain pinned to the specific version that was reviewed and staged.

## Solving the STIX Freeze Problem

### The Problem in Detail

Workbench was originally designed such that objects have a single global status. When preparing a release:
1. Object A is marked "reviewed" and frozen for the v1.5 release
2. Release process begins (can take days or weeks)
3. During this freeze period, developers **cannot** work on Object A for the v1.6 release
4. Must wait for v1.5 release to complete before resuming work
5. This creates significant workflow bottlenecks

### The Solution: Version Pinning + Collection-Scoped Status

With version pinning, collections track specific object versions:

**Step-by-Step Example:**

```bash
# 1. Initial state: Collection v1.4 released
GET /api/release-tracks/release-track--enterprise
# Response shows:
# - version: "1.4"
# - members includes: attack-pattern--T1234, modified: 2024-01-01T10:00:00Z

# 2. Developer updates T1234 for v1.5 release
POST /api/objects/attack-pattern--T1234
{ "description": "Updated for v1.5..." }
# Creates NEW version: attack-pattern--T1234, modified: 2024-02-01T14:00:00Z

# 3. Add new version to collection as candidate
POST /api/collections/collection--enterprise/candidates
{
  "object_refs": [{
    "id": "attack-pattern--T1234",
    "modified": "2024-02-01T14:00:00Z"  // Pin to new version
  }]
}

# 4. Review and promote to staged
POST /api/collections/collection--enterprise/candidates/review
{
  "object_refs": [{
    "id": "attack-pattern--T1234",
    "modified": "2024-02-01T14:00:00Z"
  }],
  "from": "work-in-progress",
  "to": "reviewed"
}
# → Promoted to staged tier

# 5. Bump collection to v1.5
POST /api/collections/collection--enterprise/bump
{ "type": "minor" }
# → Release track now at v1.5
# → Released tier: attack-pattern--T1234, modified: 2024-02-01T14:00:00Z

# 6. *** KEY MOMENT: v1.5 is now frozen, but we can keep working! ***

# 7. Developer immediately starts work on v1.6 changes
POST /api/objects/attack-pattern--T1234
{ "description": "Updated for v1.6..." }
# Creates ANOTHER new version: attack-pattern--T1234, modified: 2024-02-15T09:00:00Z

# 8. Add v1.6 version to collection as candidate while v1.5 is still published
POST /api/collections/collection--enterprise/candidates
{
  "object_refs": [{
    "id": "attack-pattern--T1234",
    "modified": "2024-02-15T09:00:00Z"  // Pin to newest version
  }]
}

# 9. Current collection state:
GET /api/release-tracks/release-track--enterprise?include=all
# Response shows:
# {
#   "version": "1.5",
#   "members": [{
#     "ref": "attack-pattern--T1234",
#     "modified": "2024-02-01T14:00:00Z"  // v1.5 version (FROZEN)
#   }],
#   "candidates": [{
#     "ref": "attack-pattern--T1234",
#     "modified": "2024-02-15T09:00:00Z",  // v1.6 version (IN DEVELOPMENT)
#     "status": "work-in-progress"
#   }]
# }

# Same object, TWO versions tracked simultaneously:
# - members: 2024-02-01 version (frozen for v1.5)
# - candidates: 2024-02-15 version (in development for v1.6)
```

### Multi-Collection Independence

Version pinning also solves cross-collection conflicts:

```bash
# Collection A: Enterprise ATT&CK
POST /api/collections/collection--enterprise/candidates
{
  "object_refs": [{
    "id": "attack-pattern--T1234",
    "modified": "2024-01-15T10:00:00Z"  // Pin to specific version
  }]
}
# Status in Enterprise collection: "work-in-progress"

# Collection B: Mobile ATT&CK
POST /api/collections/collection--mobile/candidates
{
  "object_refs": [{
    "id": "attack-pattern--T1234",
    "modified": "2024-01-20T14:00:00Z"  // Pin to DIFFERENT version
  }]
}
# Status in Mobile collection: "reviewed"

# Collections are completely independent:
# - Enterprise tracks v1 (2024-01-15) as WIP
# - Mobile tracks v2 (2024-01-20) as reviewed
# - No conflict of interest
# - No cross-collection coupling
```

### Updating Version Pins

Collections can update which version they're tracking:

```
POST /api/release-tracks/:id/candidates/:objectRef/update-version
```

**Request:**
```json
{
  "old_modified": "2024-01-15T10:00:00Z",
  "new_modified": "2024-01-20T14:00:00Z"
}
```

**Use Cases:**
- Upgrading a candidate to latest version
- Downgrading to previous stable version
- Synchronizing with another collection's version

## Workflow Scenarios

### Scenario 1: Standard Release Cycle

```bash
# 1. Add new techniques as candidates
POST /api/collections/collection--123/candidates
{ "object_refs": ["attack-pattern--new1", "attack-pattern--new2"] }

# 2. Work on objects (they start as work-in-progress)
# ... development happens ...

# 3. Transition to awaiting review
POST /api/collections/collection--123/candidates/review
{
  "from": "work-in-progress",
  "to": "awaiting-review",
  "object_refs": ["attack-pattern--new1"]
}

# 4. Review and approve
POST /api/collections/collection--123/candidates/review
{
  "from": "awaiting-review",
  "to": "reviewed",
  "object_refs": ["attack-pattern--new1"]
}
# → auto-promoted to workspace.staged

# 5. Preview the release
GET /api/release-tracks/collection--123/bump/preview
# → Shows attack-pattern--new1 will be included

# 6. Bump the collection
POST /api/collections/collection--123/bump
{ "type": "minor" }
# → attack-pattern--new1 moved to x_mitre_contents
# → attack-pattern--new2 remains in candidates (still WIP)
```

### Scenario 2: Bulk Review Before Release

```bash
# Team has been working on 50 techniques
# All are awaiting-review

# Preview what's ready
GET /api/release-tracks/collection--123/candidates?status=awaiting-review
# → Returns 50 candidates

# Bulk approve all awaiting review
POST /api/collections/collection--123/candidates/review
{
  "from": "awaiting-review",
  "to": "reviewed"
}
# → All 50 auto-promoted to staged

# Preview release
GET /api/release-tracks/collection--123/bump/preview
# → Shows all 50 will be included

# Release
POST /api/collections/collection--123/bump
{ "type": "major" }
# → All 50 moved to x_mitre_contents
```

### Scenario 3: STIX Freeze Workflow (No Bottleneck)

```bash
# Realistic timeline demonstrating no freeze bottleneck

# January 15: Preparing v1.5 release
POST /api/collections/collection--123/candidates
{
  "object_refs": [
    { "id": "attack-pattern--A", "modified": "2024-01-15T10:00:00Z" },
    { "id": "attack-pattern--B", "modified": "2024-01-15T11:00:00Z" }
  ]
}

# January 20: Review complete, promote to staged
POST /api/collections/collection--123/candidates/review
{
  "from": "awaiting-review",
  "to": "reviewed"
}

# January 25: Bump to v1.5 (freeze begins for v1.5 release)
POST /api/collections/collection--123/bump
{ "type": "minor" }
# v1.5 now released with:
# - attack-pattern--A, modified: 2024-01-15T10:00:00Z
# - attack-pattern--B, modified: 2024-01-15T11:00:00Z

# January 26: *** v1.5 is frozen, but work continues on v1.6 ***

# Developer starts new changes to Object A
POST /api/objects/attack-pattern--A
{ "description": "Changes for v1.6..." }
# Creates: attack-pattern--A, modified: 2024-01-26T09:00:00Z

# Add new version as candidate for v1.6
POST /api/collections/collection--123/candidates
{
  "object_refs": [{
    "id": "attack-pattern--A",
    "modified": "2024-01-26T09:00:00Z"  // New version
  }]
}

# February 10: More v1.6 work continues
POST /api/objects/attack-pattern--A
{ "description": "More v1.6 updates..." }
# Creates: attack-pattern--A, modified: 2024-02-10T14:00:00Z

# Update candidate pin to latest version
POST /api/collections/collection--123/candidates/attack-pattern--A/update-version
{
  "old_modified": "2024-01-26T09:00:00Z",
  "new_modified": "2024-02-10T14:00:00Z"
}

# March 1: v1.5 freeze finally ends, v1.6 work is already mostly complete!
# Current state:
# - members (v1.5): attack-pattern--A, modified: 2024-01-15 (still frozen)
# - candidates: attack-pattern--A, modified: 2024-02-10 (already in review)

# March 5: Bump to v1.6
POST /api/collections/collection--123/bump
{ "type": "minor" }
# No bottleneck - work continued throughout v1.5 freeze
```

### Scenario 4: Development Collection (Permissive Threshold)

```bash
# Configure collection to include WIP objects
PUT /api/release-tracks/collection--dev/config
{
  "candidacy_threshold": "work-in-progress",
  "auto_promote": true
}

# Add candidates
POST /api/collections/collection--dev/candidates
{ "object_refs": ["attack-pattern--exp1"] }
# → Immediately promoted to staged (meets threshold)

# Bump immediately
POST /api/collections/collection--dev/bump
{ "type": "minor" }
# → WIP objects included in release
```

## Best Practices

### 1. Use Appropriate Thresholds

- **Production collections**: `candidacy_threshold: "reviewed"`
- **Team preview collections**: `candidacy_threshold: "awaiting-review"`
- **Development collections**: `candidacy_threshold: "work-in-progress"`

### 2. Leverage Dry Run

Always preview releases before bumping:
```bash
GET /api/release-tracks/:id/bump/preview?format=workbench
```

### 3. Bulk Operations for Efficiency

Use bulk transitions for large-scale reviews:
```bash
POST /api/release-tracks/:id/candidates/review
{
  "from": "awaiting-review",
  "to": "reviewed"
}
```

### 4. Monitor Candidates

Regularly check candidate status:
```bash
GET /api/release-tracks/:id?include=all
```

### 5. Use Events for Automation

Set up event handlers for:
- Notifications when objects are reviewed
- Auto-staging based on custom rules
- Audit logging for compliance

---

## Virtual Release Track Workflows

Virtual release tracks follow a different workflow since they don't manage objects directly. Instead, they aggregate content from component tracks.

See [virtual-tracks.md](virtual-tracks.md) for complete virtual track documentation.

### Basic Virtual Track Workflow

```
1. Create virtual track (one-time setup)
   - Define which component tracks to aggregate
   - Configure resolution strategies (latest_tagged, specific_version, etc.)
   - Set up snapshot schedule (optional)

2. Component tracks release independently
   - GroupsMonthly releases v1.0, v1.1, v1.2, etc.
   - TechniquesQuarterly releases v2.0, v2.1, etc.
   - Each on their own cadence

3. Virtual track snapshot creation (manual or scheduled)
   - Resolves latest (or pinned) version from each component
   - Creates draft snapshot with resolved composition
   - Team receives notification to review

4. Review and tag
   - Team reviews which component versions were included
   - Verifies object counts and composition
   - Tags snapshot when satisfied
```

### Example: Enterprise Virtual Track

**Setup (one-time):**

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
    "dates": ["2024-01-15T00:00:00Z", "2024-07-15T00:00:00Z"]
  }
}
```

**Ongoing workflow:**

```
Timeline:

January - June:
  - GroupsMonthly releases v1.0, v1.1, v1.2, v1.3, v1.4, v1.5
  - TechniquesQuarterly releases v2.0, v2.1

July 15 (scheduled):
  - Virtual track snapshot auto-created
  - Resolves to:
    * GroupsMonthly v1.5 (latest tagged as of July 15)
    * TechniquesQuarterly v2.1 (latest tagged as of July 15)
  - Draft snapshot created

July 16 (manual):
  - Team reviews draft
  - Verifies composition
  - Tags as Enterprise v14.0
```

### Key Differences from Standard Tracks

| Aspect | Standard Track | Virtual Track |
|--------|---------------|---------------|
| Object management | Direct (add candidates, transition status) | Indirect (composed from components) |
| Snapshot creation | When objects/config change | Manual or scheduled only |
| Workflow states | Candidates → Staged → Members | N/A (uses component track states) |
| Version control | Own object versions | Aggregates component versions |
| Primary use case | Source of truth for objects | Publication/release packaging |

### Virtual Track Best Practices

1. **Organize standard tracks by object type or domain**
   - Example: GroupsMonthly, TechniquesQuarterly, SoftwareBiannual

2. **Use virtual tracks for publication**
   - Standard tracks = internal working tracks
   - Virtual tracks = external publication releases

3. **Schedule snapshots in advance**
   - Define release dates up front for predictability
   - Use `mode: "dates"` with explicit schedule

4. **Always review before tagging**
   - Scheduled snapshots create drafts
   - Manually review composition resolution
   - Tag only when satisfied

5. **Pin component versions conservatively**
   - Default to `latest_tagged` to stay current
   - Pin only when stability required

### Virtual Track Constraints

- Only references **tagged snapshots** from components (never drafts)
- Snapshots created **manually or on schedule** (never event-driven)
- All snapshots start as **drafts** (must explicitly tag)
- Component tracks must have at least one tagged release
- Circular dependencies not allowed

