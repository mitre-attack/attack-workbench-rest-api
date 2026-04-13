# Release Tracks API V2 - Design Summary

## Overview

This document provides a high-level summary of the Release Tracks API refactor (a.k.a. "Collections V2"), tying together the versioning system and workflow integration.

**Note on Terminology:** We're replacing the overloaded term "collection" with **release track** to avoid confusion with TAXII collections, MongoDB collections, STIX bundles, and `x-mitre-collection` SDOs. See [terminology.md](./terminology.md) for complete terminology guide.

## Problem Statement

The existing Collections API has five major issues:

1. **Confusing API design** - Three separate routers (stix-bundles, collection-bundles, collections) for related functionality
2. **No version control** - Release tracks can't be tagged as releases or track version history
3. **No workflow integration** - Thousands of objects being developed in parallel with no way to filter by readiness state
4. **STIX freeze bottleneck** - Objects frozen for one release can't be modified for the next release, blocking parallel development
5. **Cross-track duplication** - Teams want to track the same objects across release tracks with different cadences (e.g., monthly Groups releases + twice-yearly Enterprise releases), leading to duplicate tracking overhead and concept fatigue

## Solution Architecture

### 0. Standard and Virtual Release Tracks

The Release Tracks API supports two types of release tracks:

**Standard Release Tracks** - Direct object lifecycle management (the traditional model)
- Manage objects through the candidate → staged → released workflow
- Source of truth for specific object types or content domains
- Create snapshots when objects are added/removed or configuration changes
- Examples: "GroupsMonthly", "TechniquesQuarterly", "SoftwareBiannual"

**Virtual Release Tracks** - Computed aggregations of other release tracks (NEW)
- Compose content from multiple standard (or other virtual) tracks
- No duplicate object tracking - objects managed in source tracks only
- Create snapshots manually or on schedule (never event-driven)
- Always compose from tagged snapshots only (never drafts)
- Examples: "EnterpriseTwiceAnnual" (aggregates Groups + Techniques + Software)

**Use Case for Virtual Tracks:**

Teams can organize objects into modular standard tracks by type (e.g., one track for Groups, one for Techniques), each with its own release cadence. Then create virtual tracks that aggregate these into domain-specific releases (e.g., Enterprise ATT&CK = Groups + Techniques + Software) without duplicating object tracking.

See [virtual-tracks.md](./virtual-tracks.md) for complete virtual track documentation.

### 1. Unified API Structure

**Old API:**
```
GET  /api/stix-bundles              (ephemeral bundles)
GET  /api/collection-bundles         (export)
POST /api/collection-bundles         (import)
GET  /api/collections                (list)
POST /api/collections                (create)
GET  /api/collections/:id            (retrieve)
```

**New API V2 (partial preview):**

The new API is still a work in progress. The source of truth is located in [api-reference.md](./api-reference.md). The following is a preview. If there are any discrepencies between what is shown here and what is shown in [api-reference.md](./api-reference.md), defer to the latter.
```
# Ephemeral bundles (stateless)
GET  /api/release-tracks/ephemeral/:domain

# Release track management
POST /api/release-tracks/new
GET  /api/release-tracks/:id
POST /api/release-tracks/:id/config
POST /api/release-tracks/:id/meta
POST /api/release-tracks/:id/clone
PUT /api/release-tracks/:id/bump
POST /api/release-tracks/:id/archive
DELETE /api/release-tracks/:id

# Candidate/workflow management
POST /api/release-tracks/:id/candidates
POST /api/release-tracks/:id/candidates/review

# Snapshot-specific operations
GET  /api/release-tracks/:id/snapshots/:modified
POST /api/release-tracks/:id/snapshots/:modified/config
POST /api/release-tracks/:id/snapshots/:modified/meta
POST /api/release-tracks/:id/snapshots/:modified/clone
DELETE /api/release-tracks/:id/snapshots/:modified
PUT /api/release-tracks/:id/snapshots/:modified/bump
```

### 2. Git-Inspired Versioning

We borrow heavily concepts from git. Snapshots are sort of like commits and tagged releases are like git tags. A release track contains snapshots: delta permutations that can be linearly tracked to deduce how the release track has evolved over time. A snapshot is generated every time a change is made, whether that be adding/removing objects, updating the release track configuration, or renaming the release track altogether.

**Snapshots** (like Git commits)
- Every modification creates a new snapshot
- Identified by `stix.modified` timestamp
- Immutable once created
- Complete audit trail
- May be a **draft release** (untagged) or **tagged release** (has version number)

**Tagged Releases** (like Git tags)
- Snapshots are tagged with `version`, which when exported/retrieved as a STIX bundle, will be expressed as `x_mitre_version`. Draft snapshots are denoted by the fact that their `version` key is set to `null`.
- Uses MAJOR.MINOR versioning (not MAJOR.MINOR.PATCH), as specified by the [`x_mitre_version` ADM schema](https://github.com/mitre-attack/attack-data-model/blob/f249442b3588de9cca84b819d480306b106d2c1f/src/schemas/common/property-schemas/attack-versioning.ts#L21:L26)
- Snapshots are tagged in-place (no duplicate data)
- When a snapshot is tagged/released, an event is captured in its `version_history` array
- Once a snapshot is tagged, it cannot be re-tagged. Tagged snapshots are **immutable**.

### 3. Three-Tier Workflow Integration with Version Pinning

We use the preexisting object workflow statuses, `work-in-progress`, `awaiting-review`, and `reviewed`, to control each object's "standing" in a release track.

There are three types of membership "standings":
  1. **Candidate**: When an object is first added to a release track, is it considered a candidate. It does not have full membership yet; if the snapshot were to be tagged and released right now, candidates would not be included.
  2. **Staged**: Once a candidate's workflow status meets the release track's ["candidacy threshold"](./release-workflow.md#candidacy-threshold-configuration) criteria, it will automatically become staged. Once the snapshot is tagged/released, staged objects will be included in the resultant bundle's `x_mitre_contents`.
  3. **Member**: Objects are considered "members" if they are "cooked" into the `x_mitre_contents` array of the current snapshot. These are considered already released.

This presents a tenable solution to the classic "STIX freeze" dilemma wherein editors cannot begin working on the next-*next* (e.g., v20) release until all objects in the next (e.g., v19) release have been released. Staged objects are locked in for the imminent release, but editors are free to continue iterating on future object changes and can queue them up as candidates without affecting the permutation that has already been staged for the imminent release.

Candidates and staged objects alike can be be statically pinned to specific versions via `stix.id` and `stix.modified` couplings, or maintain dynamic/moving references to object versions by omitting `stix.modified`. In the latter, scenario, the release track will effectively "follow" the latest permutation of the relevant object until the moment a release snapshot is generated, at which point the latest permutation will become "locked in" to `x_mitre_contents` via the `stix.id` and `stix.modified` keys of the latest permutation of the object that existed at the time of the release.

## Key Features

### Automatic Promotion

Object versions automatically move between tiers based on release track-scoped workflow status:

```
Object version added to release track
  → track-scoped status = "work-in-progress"
  → Added to workspace.candidates with version pin

Object status changed in release track
  → track-scoped status = "reviewed"
  → Auto-promoted to workspace.staged (version pin preserved)

Snapshot tagged
  → workspace.staged entries → stix.x_mitre_contents (version pins preserved)
```

### Configurable Thresholds

Each release track can set its own candidacy threshold:

```javascript
workspace.config.candidacy_threshold = "reviewed"  // Default
workspace.config.candidacy_threshold = "awaiting-review"  // Permissive
workspace.config.candidacy_threshold = "work-in-progress"  // Very permissive
```

### Multiple Output Formats

- **bundle** - Standard STIX 2.1 bundle (for publication)
- **filesystemstore** - STIX FileSystemStore directory structure
- **workbench** - Custom format with workflow metadata (for UI)

### Dry Run + Preview

"Preview" will provide a verbose/detailed diff of what will change in the next release
```
GET /api/release-tracks/:id/bump/preview
  ?format = bundle | filesystemstore | workbench
```

"Dry-run" will output the literal/exact contents of the would-be tagged release
```
POST /api/release-tracks/:id/bump
{
  "type": "major",
  "dry_run": true <-- IMPORTANT!!
}
```

Shows exactly what will be in the next release before bumping.

### Bulk Operations

```
POST /api/release-tracks/:id/candidates/review
{
  "from": "awaiting-review",
  "to": "reviewed"
}
```

Transition all candidates matching status in one operation.

## State Diagram

```
┌─────────────────────────────────────────────────────────┐
│                RELEASE TRACK LIFECYCLE                   │
└─────────────────────────────────────────────────────────┘

Release Track Created
(x_mitre_version: null)
    │
    ↓
Add/Update Objects ────────────────┐
    │                              │
    ↓                              │
New Snapshot Created               │
(stix.modified updated)            │
(x_mitre_version: null)            │
(DRAFT RELEASE)                    │
    │                              │
    ↓                              │
Ready for Tagging?                 │
    │                              │
    ├─ NO ──────────────────────────┘
    │   (continue development)
    │
    ├─ YES
    ↓
Tag Snapshot
(x_mitre_version: "1.0")
(snapshot tagged IN-PLACE)
(TAGGED RELEASE)
    │
    ↓
Tagged Release
(x_mitre_version: "1.0")
    │
    ↓
Continue Development ──────────────┐
    │                              │
    ↓                              │
New Snapshot                       │
(x_mitre_version: null)            │
(DRAFT RELEASE)                    │
    │                              │
    ↓                              │
Tag Again                          │
(x_mitre_version: "1.1")           │
(TAGGED RELEASE)                   │
    │                              │
    └──────────────────────────────┘
```