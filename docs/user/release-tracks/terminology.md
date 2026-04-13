# Collections V2 - Terminology Guide

## Overview

This document defines the new terminology for Collections V2, replacing the overloaded term "collection" with a clearer vocabulary that distinguishes Workbench-specific concepts from STIX bundles, TAXII collections, MongoDB collections, and `x-mitre-collection` SDOs.

## Problem Statement

The term "collection" is heavily overloaded in the ATT&CK Workbench context:

- **MongoDB Collection** - Database table/collection in MongoDB
- **TAXII Collection** - TAXII 2.1 specification concept for grouping STIX content
- **STIX Bundle** - A STIX 2.1 bundle (JSON object with type "bundle")
- **Collection Bundle** - A STIX bundle that contains an `x-mitre-collection` object
- **`x-mitre-collection` SDO** - A custom STIX Domain Object that acts as a table of contents
- **Collection Index** - Workbench-specific concept for subscribing to remote STIX bundles
- **Workbench Collection** (V1) - The existing Workbench concept being replaced

This overloading creates confusion in documentation, code, and conversation. Collections V2 introduces new terminology to eliminate this ambiguity.

---

## Core Terminology

### Release Track

A **release track** (RT) is a series/chain (linked list) of **snapshots**, where each snapshot is either a draft release or a tagged release.

**Technical Definition:**
- A release track is represented by all documents in a RT-designated Mongo collection sharing the same `id`
  - There exists exactly one Mongo collection for each release track.
- Each document in the series represents a snapshot at a specific point in time
- The release track provides version control and release management for curated sets of STIX objects

**Characteristics:**
- Has a unique identifier (e.g., `release-track--uuid`) (see [naming conventions](../../developer/release-tracks/entities.md#naming-conventions) for details)
- Contains a chronological history of all changes
- Supports Git-inspired versioning workflow

#### Types of Release Tracks

There are two types of release tracks:

1. **Standard Release Track** - Directly manages objects through workflow states (candidates → staged → released)
   - Source of truth for specific objects
   - Creates snapshots when objects are added/removed or metadata changes
   - Examples: "GroupsMonthly", "TechniquesQuarterly"

2. **Virtual Release Track** - Computes content by aggregating other release tracks
   - No direct object management (objects managed in source tracks)
   - Creates snapshots **manually** or on **schedule**
     - **Event-driven snapshots are not supported** to avoid from RT snapshot explosion. Consider for example a virtual RT that composes from 10 standard RTs, each of which releases on a daily basis: an enormous amount of virtual snapshots would quickly accrue, making it difficult to ascertain the causal relationships to the originating snapshots and which should actually be tagged/released. 
     - Instead, users are encouraged to use virtual release tracks carefully and intentionally, creating aggregate releases on a more controlled, infrequent cadence than their non-virtual counterparts.
   - Examples: "EnterpriseTwiceAnnual" (aggregates Groups + Techniques + Software)

**Examples:**
- "Enterprise release track" (could be standard or virtual)
- "Mobile release track" (could be standard or virtual)
- "ICS release track" (could be standard or virtual)
- "Groups Monthly" (typically standard)
- "Techniques Quarterly" (typically standard)

---

### Snapshot

A **snapshot** is a *node* in the release track's version history, identified by its `modified` timestamp.

**Technical Definition:**
- Each snapshot is a MongoDB document with a specific `id` and `modified` timestamp
- **Snapshots are immutable** once created (**except** for tagging operations)
- The snapshot identifier is the combination of `id` + `modified`

**Characteristics:**
- Unique `modified` timestamp (ISO 8601 format)
- May be a **draft** release or a **tagged** release
- Contains the full state of the release track at that point in time
- Analogous to a Git commit

**Types of Snapshots:**
1. **Draft Release** - Untagged snapshot, still in development
2. **Tagged Release** - Snapshot marked with a version number, considered published

**Examples:**
- "Snapshot from 2024-01-15T16:20:00Z"
- "The latest snapshot in the Enterprise release track"
- "Show me all snapshots created in January"

---

### Draft Release

A **draft release** (or **draft snapshot**) is an untagged snapshot - still in development, not yet published.

**Technical Definition:**
- A snapshot where `version === null`
- Represents work-in-progress that has not been marked as production-ready
- Can be freely modified (creates new snapshots) without affecting published releases

**Characteristics:**
- No version number assigned
- Not considered production-ready
- Can transition from draft to tagged state via tagging (in-place) operation
- May contain candidate, staged, and member objects in various states

**Examples:**
- "The current draft release has 150 candidate objects"
- "Let's review the draft before tagging it"
- "This draft release includes updates to 50 techniques"

---

### Tagged Release

A **tagged release** (or **tagged snapshot**) is a snapshot that has been marked with a version number (`version`) and is considered published/released.

**Technical Definition:**
- A snapshot where `version !== null`
- The version follows MAJOR.MINOR format (e.g., "1.0", "2.3", "15.1")
- Created by performing a tagging operation on a draft release
- The `stix.modified` timestamp does not change during tagging (in-place operation)

**Characteristics:**
- Has an explicit version number
- Considered production-ready and published
- **Immutable** - cannot be re-tagged or untagged
- Recorded in `version_history` for audit trail
- Analogous to a Git tag

**Examples:**
- "Enterprise release track v14.1 is a tagged release"
- "Tag this snapshot as release v2.0"
- "Show me all tagged releases from 2024"
- "The latest tagged release contains 3,000 techniques"

---

### Tagging Operation

The **tagging operation** marks an existing snapshot as a tagged release by assigning it a version number.

**Technical Definition:**
- Sets `version` on an existing snapshot (in-place update)
- Does NOT create a new snapshot (does NOT change `modified`)
- Adds an entry to `version_history` for audit trail
- Can be performed on the latest snapshot or a specific historical snapshot

**Characteristics:**
- Version must be greater than all previous tagged releases (monotonically increasing)
- Cannot tag a snapshot that is already tagged (throws `AlreadyReleasedError`)
- Supports automatic version calculation (MAJOR/MINOR bump) or explicit version

**Examples:**
- "Tag the latest snapshot as v1.5"
- "Tag snapshot from 2024-01-15 as v2.0"
- "Tagging operation failed - snapshot already tagged as v1.3"

---

### Object Membership Tiers

The tier system differs between **standard release tracks** and **virtual release tracks**.

#### Standard Release Tracks: Three-Tier System

Standard release tracks use three tiers to manage the object lifecycle from development to release:

##### 1. Candidate Objects

**Location:** `candidates`

**Definition:** Objects being worked on; not yet ready for release.

**Characteristics:**
- When an object is first added to a release track, is it considered a candidate. It does not have full membership yet; if the snapshot were to be tagged and released right now, candidates would not be included.
- Each entry can either be statically pinned to a specific version (via its `object_modified` timestamp), or dynamically pinned to the latest version.
- Each entry has a collection-scoped status: `work-in-progress`, `awaiting-review`, or `reviewed`
- Objects in this tier are NOT included in published STIX bundles by default
- Automatically promoted to staged tier when status reaches the candidacy threshold

**Duplicate Rules:**
- Cannot contain exact duplicates (same `object_ref` + `object_modified` pair)
- **CAN** contain multiple versions of the same object (same `object_ref`, different `object_modified` timestamps)
  - Example: Can have `attack-pattern--T1234, modified: 2024-01-15` AND `attack-pattern--T1234, modified: 2024-02-20` simultaneously
  - However, only one version of a given object can be promoted to the `staged` tier and `members` tier

**Examples:**
- "Add these 10 techniques as candidate objects"
- "There are 47 candidate objects in work-in-progress status"
- "Transition candidate objects from awaiting-review to reviewed"

##### 2. Staged Objects

**Location:** `staged`

**Definition:** Objects that have been reviewed (in this release track) and are ready for the next tagged release.

**Characteristics:**
- Once a candidate's workflow status meets the release track's ["candidacy threshold"](./release-workflow.md#candidacy-threshold-configuration) criteria, it will automatically become staged. Once the snapshot is tagged/released, staged objects will be included in `members`. 
 
When the release is exported as a `bundle`, all `members` will be included in the resultant bundle's `x_mitre_contents` array.

- Each `staged` entry includes a version pin (`object_modified` timestamp), which can either equal an ISO 8601 timestamp (designating a specific object version) or `"latest"` (designating a dynamic reference to the latest permutation of the relevant object)
- Auto-promoted from candidates when objects meet the [candidacy threshold](./release-workflow.md#candidacy-threshold-configuration)
- Moved to member objects tier (`members`) when the snapshot is tagged
- NOT included in published STIX bundles until the snapshot is tagged

**Duplicate Rules:**
- Cannot contain exact duplicates (same `object_ref` + `object_modified` pair)
- **CANNOT** contain multiple versions of the same object
- If a promotion would create a duplicate (different version of same object already in staged), conflict resolution policy applies

**Examples:**
- "There are 12 staged objects ready for the next release"
- "Promote all reviewed candidates to staged"
- "Preview which staged objects will be included in the next tagged release"

##### 3. Member Objects

**Location:** `members`

**Definition:** Objects included in the current/latest released version of this release track.

**Characteristics:**
- Objects are considered "members" if they are contained in the `x_mitre_contents` array of the current snapshot. These are considered *already* released.
- Each entry is a version-pinned reference (`object_ref` + `object_modified`). Dynamic references (`object_modified: "latest"`) are not supported on member objects.
- These objects are included in published STIX bundles
- Represents the production-ready, published content
- Only updated when a snapshot is tagged (staged objects are promoted to members)

**Duplicate Rules:**
- Cannot contain exact duplicates (same `object_ref` + `object_modified` pair)
- **CANNOT** contain multiple versions of the same object
- If a promotion would create a duplicate (different version of same object already in members), conflict resolution policy applies

**Examples:**
- "The Enterprise release track has 3,247 member objects"
- "Export all member objects as a STIX bundle"
- "Which version of Technique T1234 is in the member objects?"

#### Virtual Release Tracks: Two-Tier System

Virtual release tracks use a simplified two-tier system since they aggregate already-released content:

##### 1. Member Objects

**Location:** `members`

**Definition:** Successfully synced objects from component tracks.

**Characteristics:**
- Contains objects synced from component tracks' `members` tiers
- Objects that were automatically resolved using the deduplication strategy
- OR objects manually promoted from quarantine
- These objects are included in published STIX bundles
- No workflow states (no work-in-progress, awaiting-review, reviewed)

**Duplicate Rules:**
- Cannot contain exact duplicates (same `object_ref` + `object_modified` pair)
- **CANNOT** contain multiple versions of the same object
- Deduplication strategy determines which version to keep when conflicts occur

##### 2. Quarantine

**Location:** `quarantine`

**Definition:** Conflicting objects that require manual resolution.

**Characteristics:**
- Only populated when using `quarantine` deduplication strategy
- Contains objects that couldn't be automatically resolved due to conflicts
- NOT included in published STIX bundles
- Requires manual intervention to promote one version to members

**Duplicate Rules:**
- Cannot contain exact duplicates (same `object_ref` + `object_modified` pair)
- **CAN** contain multiple versions of the same object (different versions from different component tracks)
- Example: Can have `attack-pattern--T1234, modified: 2024-01-15` (from Track A) AND `attack-pattern--T1234, modified: 2024-02-20` (from Track B) simultaneously

---

### Virtual Release Track

A **virtual release track** is a special type of release track that computes its contents by aggregating objects from other release tracks (called **component tracks**).

**Technical Definition:**
- A virtual track is identified by `stix.type = "virtual"` in its schema
- Instead of managing objects directly, it defines **composition rules** that specify which tracks to aggregate and how
- Snapshots are created manually or on schedule by **resolving** the composition rules

**Characteristics:**
- Does NOT manage objects through candidate/staged/released workflow
- Aggregates content from **component tracks** (standard or other virtual tracks)
- Only references **tagged snapshots** from component tracks (never drafts)
- Creates snapshots **manually** or **on schedule** (*never* event-driven; see [Types of Release Tracks](#types-of-release-tracks) for explanation)
- All snapshots start as drafts and must be explicitly tagged
- Can optionally have **native objects** in addition to composed content (hybrid model)

**Examples:**
- "EnterpriseTwiceAnnual" virtual track aggregates:
  - GroupsMonthly (latest tagged release)
  - TechniquesQuarterly (latest tagged release)
  - SoftwareBiannual (latest tagged release)
- "MobileQuarterly" virtual track aggregates:
  - GroupsMobile (filtered to mobile domain)
  - TechniquesMobile (filtered to mobile domain)

---

### Component Track

A **component track** is a release track (standard or virtual) that is referenced by a virtual release track.

**Technical Definition:**
- A component track is specified in a virtual track's `composition.component_tracks` array
- Each component defines a `resolution_strategy` (how to select which snapshot to use)
- Each component can optionally specify `filters` (which objects to include)

**Characteristics:**
- Component tracks are independent - they don't know they're being referenced
- Virtual tracks "pull" content from components via composition rules
- Components can be standard tracks (manage objects) or virtual tracks (aggregate)
- Components must have at least one tagged snapshot for virtual track to resolve

**Examples:**
- "GroupsMonthly" is a component track of "EnterpriseTwiceAnnual"
- "TechniquesQuarterly" is a component track of "EnterpriseTwiceAnnual"

---

### Composition

**Composition** refers to the rules and configuration that define how a virtual release track aggregates content from component tracks.

**Technical Definition:**
- Defined in `composition` object of virtual track
- Specifies which component tracks to include
- Defines resolution strategies, filters, and deduplication rules

**Characteristics:**
- Composition is configuration, not data
- Resolved at snapshot creation time into concrete object references
- Can be updated, which creates a new draft snapshot with new composition

**Example:**
```javascript
{
  component_tracks: [
    {
      track_id: "GroupsMonthly--uuid",
      resolution_strategy: "latest_tagged",
      filters: { object_types: ["intrusion-set"] }
    }
  ],
  deduplication: {
    strategy: "prefer_latest_modified"
  }
}
```

---

### Resolution

**Resolution** is the process of converting a virtual track's composition rules into concrete object references.

**Technical Definition:**
- Occurs when a virtual track snapshot is created
- For each component track, resolves to a specific snapshot based on strategy
- Collects all objects from resolved snapshots
- Applies filters and deduplication
- Produces immutable `composition_resolution` metadata

**Characteristics:**
- Resolution happens at snapshot creation time (not query time)
- Resolution metadata is stored in snapshot (`composition_resolution`)
- Once resolved, a snapshot's composition is immutable
- Different snapshots of same virtual track may resolve to different component versions

**Example:**

```
Virtual track "EnterpriseTwiceAnnual" has composition:
  - GroupsMonthly: strategy = "latest_tagged"

When snapshot created on March 1:
  → Resolves to GroupsMonthly v5.2 (latest tagged on March 1)

When snapshot created on July 1:
  → Resolves to GroupsMonthly v5.8 (latest tagged on July 1)
```

---

### Resolution Strategy

A **resolution strategy** determines which snapshot from a component track to use.

**Options:**
1. **latest_tagged** - Use the most recent tagged snapshot from the component track
2. **specific_version** - Use a specific semantic version (e.g., "5.0")
3. **specific_snapshot** - Use a specific snapshot by timestamp

**Examples:**
- `{ resolution_strategy: "latest_tagged" }` → Always gets latest
- `{ resolution_strategy: "specific_version", version: "5.0" }` → Always uses v5.0
- `{ resolution_strategy: "specific_snapshot", snapshot: "2024-02-01T10:00:00Z" }` → Always uses that exact snapshot

---

## Terminology Mapping

### Old Term (V1) → New Term (V2)

| Old Term (V1) | New Term (V2) | Notes |
|---------------|---------------|-------|
| Collection | Release Track | Top-level container concept |
| Collection version | Snapshot | Individual node in version history |
| Collection (unpublished) | Draft Release | Snapshot without version number |
| Collection (published) | Tagged Release | Snapshot with version number |
| Collection contents | Member objects | Objects in `members` |
| Collection Bundle | -- | STIX bundle exported from a released/tagged snapshot |

### Technical Mappings

| Concept | MongoDB Representation |
|---------|------------------------|
| Release Track | Mongo collection following name format `$name--$uuid` |
| Snapshot | Doc with specific `id` + `modified` |
| Draft Release | Snapshot where `version === null` |
| Tagged Release | Snapshot where `version !== null` |
| Tagging Operation | Set `version` on existing doc |
| Candidate Objects | Array at `candidates` |
| Staged Objects | Array at `staged` |
| Member Objects | Array at `members` |

---

## Conversational Usage

**Development Workflow:**
- "Did you review Technique-A in the latest draft release?"
- "Add these techniques as candidates to the Enterprise release track"
- "Transition all candidate objects from work-in-progress to awaiting-review"
- "Which objects are staged for the next release?"

**Release Management:**
- "Are we ready to tag this snapshot as a release?"
- "Tag the current draft as v14.1"
- "The Enterprise release track has 47 snapshots, 12 of which are tagged releases"
- "Show me all tagged releases from Q1 2024"

**Version Control:**
- "Let's create a new release track for the space domain"
- "Compare snapshots from the Mobile and Enterprise release tracks"
- "Which snapshot introduced Technique T1234?"
- "Roll back to the previous tagged release"

**Object Management:**
- "The current snapshot contains 3,000 member objects and 150 staged objects"
- "Move these candidate objects to staged"
- "Export the member objects as a STIX bundle"