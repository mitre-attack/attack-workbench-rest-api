# Member Sync Strategies

## Overview

This document describes the **Member Sync Strategy** system, which governs how release tracks respond when new revisions of member objects are created. This feature addresses a critical gap in the release track workflow: ensuring that future revisions of already-released objects are automatically queued for subsequent releases.

**Related Documentation:**
- [api-reference.md](../../user/release-tracks/api-reference.md) - Complete API reference
- [terminology.md](../../user/release-tracks/terminology.md) - Core terminology (candidates, staged, members)
- [release-workflow.md](../../user/release-tracks/release-workflow.md) - Workflow states and promotion
- [entities.md](./entities.md) - Database schemas and data models

---

## Problem Statement

### The Post-Release Gap

Consider a typical release workflow:

1. A release track is created and objects are added as candidates
2. Objects progress through the workflow: `candidates` → `staged` → `members`
3. A release is tagged, and all staged objects are merged into `members`
4. The `staged` array is emptied

At this point, users continue editing objects that are now in `members`. They create new revisions of techniques, groups, and other STIX objects. However, because `staged` has been emptied and there are no longer any dynamic references tracking these objects, **new revisions do not automatically appear in the release track**.

This creates a frustrating user experience. Intuitively, users expect that once an object is enrolled in a release track's `members` list, all future revisions will automatically be queued for the next release. Instead, users must remember to manually hit the "Add Candidates" endpoint for every object they edit after each release. This is tedious, error-prone, and counterintuitive.

### Illustrative Example

```yaml
# Initial state: Release track after v1.0 has been tagged
release-track:
  version: "1.0"
  candidates: []
  staged: []
  members:
    - object_ref: attack-pattern--abc
      object_modified: 2025-01-01  # The v1.0 version

# User edits attack-pattern--abc, creating a new revision
# In the database, there are now TWO versions:
objects:
  - id: attack-pattern--abc
    modified: 2025-01-01  # v1.0 (released)
  - id: attack-pattern--abc
    modified: 2025-06-15  # v1.1 (new revision)

# PROBLEM: The release track has no idea about v1.1!
# The new revision is NOT automatically tracked.
# User must manually add it as a candidate.
```

### The Solution: Member Sync Strategies

Member Sync Strategies provide configurable behavior that automatically enrolls new object revisions as candidates when the object is already a member of the release track. This eliminates the manual re-enrollment burden and aligns the system with user expectations.

---

## Core Concepts

### What is a Member Sync Strategy?

A **Member Sync Strategy** is a configuration setting on a release track that determines how the system responds when a new revision of a member object is created. The strategy answers several questions:

1. **Should the new revision be automatically added to candidates?**
2. **If a previous revision already exists in candidates or staged, what should happen?**
3. **What workflow status should the new revision start with?**

### When Does Member Sync Apply?

Member sync logic is triggered by **object modification events**. Specifically, when a STIX object is created or updated (resulting in a new `modified` timestamp), the system checks whether that object is a member of any release tracks. For each release track where the object is a member, the configured member sync strategy determines what action (if any) to take.

**Important:** Member sync only applies to objects that are currently in the `members` array of a release track. It does not apply to objects that are only in `candidates` or `staged`. The rationale is that objects in `candidates` or `staged` are still progressing through the workflow and have not yet been "committed" to the release track as official members.

### Relationship to Existing Features

Member sync strategies integrate with several existing release track features:

- **Candidacy Threshold:** When a new revision is auto-enrolled as a candidate, it may be immediately promoted to `staged` if its status meets the candidacy threshold.
- **Conflict Resolution Policies:** When member sync adds a new revision and a previous revision already exists in `candidates` or `staged`, the configured conflict resolution policy (from `config.promotion_conflicts`) determines how to handle the overlap.
- **Snapshot Creation:** Any change to a release track's object lists (`candidates`, `staged`, `members`) results in a new draft snapshot being created. Member sync follows this convention.

---

## Configuration

Member sync behavior is configured at the **release track level** via the `config.member_sync` object. This configuration applies uniformly to all member objects in the release track.

### Configuration Schema

```javascript
{
  config: {
    // Existing configuration...
    candidacy_threshold: "reviewed",
    auto_promote: true,
    promotion_conflicts: {
      candidates_to_staged: "prefer_latest",
      staged_to_members: "abort"
    },

    // Member Sync Strategy Configuration
    member_sync: {
      // The core sync strategy
      strategy: "track_latest",  // "track_latest" | "manual"

      // Supplant behavior when a new revision is created
      // and an older revision already exists in candidates or staged
      supplant: {
        behavior: "replace",     // "replace" | "queue" | "ignore"
        status_policy: "reset"   // "reset" | "preserve"
      }
    }
  }
}
```

### Configuration Options Explained

#### `member_sync.strategy`

The `strategy` field determines the primary behavior of member sync.

##### `"track_latest"` (Default for New Release Tracks)

When a new revision of a member object is created, **automatically add it to `candidates`**.

This is the recommended setting for most release tracks. It provides the intuitive "once enrolled, always tracked" behavior that users expect. With this strategy enabled, users can focus on editing objects without worrying about manually re-enrolling them after each release.

**Example:**

```yaml
# Configuration
config:
  member_sync:
    strategy: "track_latest"

# Initial state after v1.0 release
members:
  - object_ref: attack-pattern--abc
    object_modified: 2025-01-01

candidates: []
staged: []

# User creates a new revision of attack-pattern--abc (modified: 2025-06-15)

# Resulting state (new draft snapshot):
members:
  - object_ref: attack-pattern--abc
    object_modified: 2025-01-01  # Still the released version

candidates:
  - object_ref: attack-pattern--abc
    object_modified: 2025-06-15  # Automatically enrolled!
    object_status: "work-in-progress"
    object_added_at: "2025-06-15T10:30:00Z"
    object_added_by: "system"  # Indicates auto-enrollment

staged: []
```

##### `"manual"`

Do **not** automatically enroll new revisions. Users must explicitly add new revisions via the Add Candidates endpoint (`POST /api/release-tracks/:id/candidates`).

This setting preserves the traditional behavior and provides maximum control. It is appropriate for release tracks where only hand-picked revisions should be included, or where the team prefers explicit enrollment over automatic tracking.

**Example:**

```yaml
# Configuration
config:
  member_sync:
    strategy: "manual"

# Initial state after v1.0 release
members:
  - object_ref: attack-pattern--abc
    object_modified: 2025-01-01

# User creates a new revision of attack-pattern--abc (modified: 2025-06-15)

# Resulting state: NO CHANGE
# The release track is unaware of the new revision.
# User must manually add it as a candidate if they want it tracked.
```

#### `member_sync.supplant`

The `supplant` configuration controls what happens when a new revision is created **and** an older revision of the same object already exists in `candidates` or `staged`. This scenario is common when users make multiple edits to an object before a release occurs.

##### `supplant.behavior`

Determines how to handle the coexistence of old and new revisions.

###### `"replace"` (Default)

Remove the older revision and add the newer revision in its place.

This is the recommended setting for most workflows. It keeps the release track focused on the latest work and prevents accumulation of stale revisions. When combined with `status_policy: "reset"`, it ensures that significant changes trigger a re-review.

**Example:**

```yaml
# Configuration
config:
  member_sync:
    strategy: "track_latest"
    supplant:
      behavior: "replace"
      status_policy: "reset"

# Initial state: v26 is in staged (already reviewed)
staged:
  - object_ref: attack-pattern--abc
    object_modified: 2026-01-01  # v26
    object_status: "reviewed"

# User creates v27 (modified: 2027-01-01)

# Resulting state:
# v26 is REMOVED from staged
# v27 is ADDED to candidates with reset status

candidates:
  - object_ref: attack-pattern--abc
    object_modified: 2027-01-01  # v27
    object_status: "work-in-progress"  # Status reset

staged: []  # v26 removed
```

###### `"queue"`

Keep the older revision where it is and add the newer revision to `candidates` alongside it.

This setting allows both revisions to coexist and progress through the workflow independently. It is useful when a previous revision needs to ship in an imminent release while a newer revision is still being developed for a subsequent release.

**Example:**

```yaml
# Configuration
config:
  member_sync:
    strategy: "track_latest"
    supplant:
      behavior: "queue"

# Initial state: v26 is in staged (ready for next release)
staged:
  - object_ref: attack-pattern--abc
    object_modified: 2026-01-01  # v26
    object_status: "reviewed"

# User creates v27 (modified: 2027-01-01)

# Resulting state:
# v26 REMAINS in staged (will ship in next release)
# v27 is ADDED to candidates (for a future release)

candidates:
  - object_ref: attack-pattern--abc
    object_modified: 2027-01-01  # v27
    object_status: "work-in-progress"

staged:
  - object_ref: attack-pattern--abc
    object_modified: 2026-01-01  # v26 unchanged
    object_status: "reviewed"
```

**Note:** When using `queue`, multiple versions of the same object can exist across `candidates` and `staged`. The existing conflict resolution policies (configured via `config.promotion_conflicts`) will handle conflicts when these versions are eventually promoted. For example, if the release track is configured with `staged_to_members: "abort"`, the system will prevent releasing if both v26 and v27 somehow end up competing for promotion to `members`.

###### `"ignore"`

Do not add the new revision if an older revision already exists in `candidates` or `staged`.

This setting respects explicit version decisions. If someone has deliberately staged or queued a specific revision, the system will not override that decision with a newer revision. Users must manually remove the old revision and add the new one if they want to switch.

**Example:**

```yaml
# Configuration
config:
  member_sync:
    strategy: "track_latest"
    supplant:
      behavior: "ignore"

# Initial state: v26 is in staged
staged:
  - object_ref: attack-pattern--abc
    object_modified: 2026-01-01  # v26
    object_status: "reviewed"

# User creates v27 (modified: 2027-01-01)

# Resulting state: NO CHANGE
# v27 is NOT added because v26 already exists in staged.
# The system assumes v26 was deliberately chosen and should not be overridden.
```

##### `supplant.status_policy`

Determines the workflow status assigned to a new revision when `supplant.behavior` is `"replace"`. This setting is ignored when `behavior` is `"queue"` or `"ignore"`.

###### `"reset"` (Default)

Assign the new revision `work-in-progress` status and place it in `candidates`, regardless of where the old revision was or what status it had.

This is the safer option. It ensures that any new revision undergoes the full review workflow, even if the previous revision had already been reviewed. The rationale is that new changes might introduce issues that require fresh review.

**Example:**

```yaml
# Old revision was reviewed and staged
staged:
  - object_ref: attack-pattern--abc
    object_modified: 2026-01-01
    object_status: "reviewed"

# With status_policy: "reset", the new revision:
candidates:
  - object_ref: attack-pattern--abc
    object_modified: 2027-01-01
    object_status: "work-in-progress"  # Starts fresh
```

###### `"preserve"`

Assign the new revision the same status as the old revision and place it in the same tier.

This option trusts that new revisions are at least as complete as previous ones. It accelerates the workflow by avoiding redundant reviews. This is appropriate for release tracks with trusted contributors or where changes are typically incremental refinements.

**Example:**

```yaml
# Old revision was reviewed and staged
staged:
  - object_ref: attack-pattern--abc
    object_modified: 2026-01-01
    object_status: "reviewed"

# With status_policy: "preserve", the new revision:
staged:
  - object_ref: attack-pattern--abc
    object_modified: 2027-01-01
    object_status: "reviewed"  # Preserved from old revision
```

**Caution:** Using `preserve` means that significant changes (including potentially breaking ones) could skip review. Only use this setting in release tracks where all contributors are trusted and where changes are typically low-risk.

---

## Detailed Behavior Scenarios

This section walks through various scenarios to illustrate how member sync strategies behave in practice.

### Scenario 1: Simple Auto-Enrollment

**Setup:**
- Release track has `track_latest` strategy
- Object `attack-pattern--T1` is in `members` (version v25)
- No pending revisions in `candidates` or `staged`

**Event:** User creates a new revision of `attack-pattern--T1` (v26)

**Result:**
```yaml
# Before
members:
  - { object_ref: attack-pattern--T1, object_modified: v25 }
candidates: []
staged: []

# After
members:
  - { object_ref: attack-pattern--T1, object_modified: v25 }
candidates:
  - { object_ref: attack-pattern--T1, object_modified: v26, object_status: "work-in-progress" }
staged: []
```

**Explanation:** The new revision v26 is automatically enrolled as a candidate. The released version v25 remains in `members`. This is the most common scenario and demonstrates the core value of member sync.

### Scenario 2: Replacement with Status Reset

**Setup:**
- Release track has `track_latest` strategy with `replace` + `reset`
- Object `attack-pattern--T1` has v25 in `members`
- v26 is already in `staged` with status `reviewed`

**Event:** User creates v27

**Result:**
```yaml
# Before
members:
  - { object_ref: attack-pattern--T1, object_modified: v25 }
candidates: []
staged:
  - { object_ref: attack-pattern--T1, object_modified: v26, object_status: "reviewed" }

# After
members:
  - { object_ref: attack-pattern--T1, object_modified: v25 }
candidates:
  - { object_ref: attack-pattern--T1, object_modified: v27, object_status: "work-in-progress" }
staged: []
```

**Explanation:** v26 is removed from `staged` and v27 is added to `candidates` with reset status. The user will need to re-review v27 before it can be staged again. This ensures that the new changes receive proper scrutiny.

### Scenario 3: Replacement with Status Preserved

**Setup:**
- Release track has `track_latest` strategy with `replace` + `preserve`
- Object `attack-pattern--T1` has v25 in `members`
- v26 is in `staged` with status `reviewed`

**Event:** User creates v27

**Result:**
```yaml
# Before
members:
  - { object_ref: attack-pattern--T1, object_modified: v25 }
staged:
  - { object_ref: attack-pattern--T1, object_modified: v26, object_status: "reviewed" }

# After
members:
  - { object_ref: attack-pattern--T1, object_modified: v25 }
staged:
  - { object_ref: attack-pattern--T1, object_modified: v27, object_status: "reviewed" }
```

**Explanation:** v26 is replaced by v27, but v27 inherits the `reviewed` status and remains in `staged`. This is faster but assumes the new changes don't require re-review.

### Scenario 4: Queueing Alongside Existing Revision

**Setup:**
- Release track has `track_latest` strategy with `queue`
- Object `attack-pattern--T1` has v25 in `members`
- v26 is in `staged` (ready for imminent release)

**Event:** User creates v27 (for a future release)

**Result:**
```yaml
# Before
members:
  - { object_ref: attack-pattern--T1, object_modified: v25 }
staged:
  - { object_ref: attack-pattern--T1, object_modified: v26, object_status: "reviewed" }
candidates: []

# After
members:
  - { object_ref: attack-pattern--T1, object_modified: v25 }
staged:
  - { object_ref: attack-pattern--T1, object_modified: v26, object_status: "reviewed" }
candidates:
  - { object_ref: attack-pattern--T1, object_modified: v27, object_status: "work-in-progress" }
```

**Explanation:** Both v26 and v27 coexist. v26 will ship in the next release while v27 progresses through the workflow for a subsequent release. This is useful for parallel development across release cycles.

### Scenario 5: Ignoring When Revision Already Exists

**Setup:**
- Release track has `track_latest` strategy with `ignore`
- Object `attack-pattern--T1` has v25 in `members`
- v26 is in `candidates` (being worked on)

**Event:** User creates v27

**Result:**
```yaml
# Before
members:
  - { object_ref: attack-pattern--T1, object_modified: v25 }
candidates:
  - { object_ref: attack-pattern--T1, object_modified: v26, object_status: "work-in-progress" }

# After: NO CHANGE
members:
  - { object_ref: attack-pattern--T1, object_modified: v25 }
candidates:
  - { object_ref: attack-pattern--T1, object_modified: v26, object_status: "work-in-progress" }
```

**Explanation:** v27 is not added because v26 already exists in `candidates`. The user must manually remove v26 and add v27 if they want to switch. This setting respects deliberate version choices.

### Scenario 6: Multiple Objects with Mixed States

**Setup:**
- Release track has `track_latest` with `replace` + `reset`
- Three objects in `members`: T1 (v25), T2 (v25), T3 (v25)
- T1 also has v26 in `staged`
- T2 has no pending revisions
- T3 has v26 in `candidates`

**Event:** User creates new revisions: T1-v27, T2-v26, T3-v27

**Result:**
```yaml
# Before
members:
  - { object_ref: T1, object_modified: v25 }
  - { object_ref: T2, object_modified: v25 }
  - { object_ref: T3, object_modified: v25 }
staged:
  - { object_ref: T1, object_modified: v26, object_status: "reviewed" }
candidates:
  - { object_ref: T3, object_modified: v26, object_status: "awaiting-review" }

# After
members:
  - { object_ref: T1, object_modified: v25 }
  - { object_ref: T2, object_modified: v25 }
  - { object_ref: T3, object_modified: v25 }
staged: []  # T1-v26 removed
candidates:
  - { object_ref: T1, object_modified: v27, object_status: "work-in-progress" }  # Replaced T1-v26
  - { object_ref: T2, object_modified: v26, object_status: "work-in-progress" }  # New enrollment
  - { object_ref: T3, object_modified: v27, object_status: "work-in-progress" }  # Replaced T3-v26
```

**Explanation:** Each object is handled according to the strategy:
- T1: v26 in `staged` is replaced by v27 in `candidates` with reset status
- T2: No existing revision, so v26 is simply enrolled in `candidates`
- T3: v26 in `candidates` is replaced by v27 in `candidates` with reset status

### Scenario 7: Auto-Promotion After Enrollment

**Setup:**
- Release track has:
  - `track_latest` with `replace` + `reset`
  - `candidacy_threshold: "work-in-progress"` (very permissive)
  - `auto_promote: true`
- Object `attack-pattern--T1` has v25 in `members`

**Event:** User creates v26

**Result:**
```yaml
# Before
members:
  - { object_ref: T1, object_modified: v25 }
candidates: []
staged: []

# After (auto-enrollment + auto-promotion)
members:
  - { object_ref: T1, object_modified: v25 }
candidates: []  # Immediately promoted!
staged:
  - { object_ref: T1, object_modified: v26, object_status: "work-in-progress" }
```

**Explanation:** v26 is auto-enrolled to `candidates`, but because the candidacy threshold is `work-in-progress` and auto-promote is enabled, v26 is immediately promoted to `staged`. This demonstrates how member sync integrates with existing promotion logic.

---

## Integration with Existing Features

### Interaction with Candidacy Threshold

When a new revision is auto-enrolled as a candidate, the standard candidacy threshold logic applies. If the new revision's status meets or exceeds the configured threshold, and `auto_promote` is enabled, the revision will be immediately promoted to `staged`.

This can lead to interesting scenarios:
- With `reset` status policy, the new revision starts as `work-in-progress`, which typically does not meet the default threshold of `reviewed`.
- With `preserve` status policy, a revision that replaces a `reviewed` entry in `staged` will retain `reviewed` status and could theoretically be immediately re-staged.

### Interaction with Conflict Resolution Policies

When `supplant.behavior` is `queue`, multiple revisions of the same object can coexist across `candidates` and `staged`. This creates potential for conflicts during promotion:

1. **Candidates to Staged:** If v26 is in `candidates` and v27 is also in `candidates`, promoting one may conflict with the other. The `candidates_to_staged` conflict policy determines resolution.

2. **Staged to Members:** If v26 and v27 are both in `staged` (which can happen with `queue` + subsequent manual promotions), the `staged_to_members` policy applies during release.

The existing conflict resolution policies (`always_overwrite`, `always_reject`, `prefer_latest`, `abort`) handle these situations. No changes to conflict resolution are required for member sync to function correctly.

### Snapshot Creation

Any change to a release track's `candidates`, `staged`, or `members` arrays results in a new draft snapshot. Member sync follows this convention. When a new revision is auto-enrolled or an existing revision is supplanted, the system creates a new draft snapshot with the updated arrays.

This means:
- Auto-enrollment generates a new snapshot
- Supplanting (whether `replace` or `queue`) generates a new snapshot
- Multiple objects being updated simultaneously (e.g., bulk import) generates a single snapshot reflecting all changes

### Event-Driven Architecture

Member sync requires listening for object modification events. When a STIX object is created or modified:

1. The system identifies all release tracks where this object appears in `members`
2. For each relevant release track, the configured member sync strategy is evaluated
3. If the strategy dictates action (e.g., auto-enrollment), the appropriate snapshot modifications are made

This event-driven approach ensures that member sync is reactive and automatic, requiring no manual intervention from users.

---

## Default Configuration

Release tracks use the following default member sync configuration:

```javascript
{
  member_sync: {
    strategy: "track_latest",
    supplant: {
      behavior: "replace",
      status_policy: "reset"
    }
  }
}
```

This default provides:
- **Automatic tracking** of new revisions (solves the core problem)
- **Clean replacement** of outdated revisions (prevents accumulation)
- **Safe re-review** requirement (ensures quality control)

### Rationale for Defaults

The defaults were chosen to balance convenience with safety:

1. **`track_latest`** is the default because it matches user expectations. Users intuitively expect enrolled objects to be tracked continuously.

2. **`replace`** is the default because most teams want to focus on the latest work, not accumulate stale revisions that clutter the workflow.

3. **`reset`** is the default because it's safer. New revisions might introduce issues that weren't present in the previous revision. Requiring re-review ensures that changes receive appropriate scrutiny.

---

## API Reference

### Updating Member Sync Configuration

Member sync settings are managed via the existing configuration endpoint:

```
PUT /api/release-tracks/:id/config
```

**Request Body:**
```json
{
  "member_sync": {
    "strategy": "track_latest",
    "supplant": {
      "behavior": "replace",
      "status_policy": "reset"
    }
  }
}
```

**Response:** Returns the updated configuration.

**Note:** Updating the member sync configuration does not retroactively process existing member objects. It only affects how the system responds to future object modification events.

### Retrieving Configuration

```
GET /api/release-tracks/:id/config
```

**Response:**
```json
{
  "candidacy_threshold": "reviewed",
  "auto_promote": true,
  "promotion_conflicts": {
    "candidates_to_staged": "prefer_latest",
    "staged_to_members": "abort"
  },
  "member_sync": {
    "strategy": "track_latest",
    "supplant": {
      "behavior": "replace",
      "status_policy": "reset"
    }
  }
}
```

---

## Decision Matrix

The following matrix summarizes the behavior for each combination of settings:

| Scenario | `track_latest` + `replace` + `reset` | `track_latest` + `replace` + `preserve` | `track_latest` + `queue` | `track_latest` + `ignore` | `manual` |
|----------|--------------------------------------|----------------------------------------|--------------------------|--------------------------|----------|
| New revision created (nothing in candidates/staged) | Add to candidates as WIP | Add to candidates as WIP | Add to candidates as WIP | Add to candidates as WIP | No action |
| New revision created (older in candidates as WIP) | Replace in candidates as WIP | Replace in candidates as WIP | Add alongside as WIP | No action | No action |
| New revision created (older in candidates as awaiting-review) | Replace in candidates as WIP | Replace in candidates as awaiting-review | Add alongside as WIP | No action | No action |
| New revision created (older in staged as reviewed) | Remove from staged, add to candidates as WIP | Replace in staged as reviewed | Keep in staged, add to candidates as WIP | No action | No action |

---

## Best Practices

### Recommended Configuration for Production Release Tracks

For release tracks that publish to production environments:

```javascript
{
  member_sync: {
    strategy: "track_latest",
    supplant: {
      behavior: "replace",
      status_policy: "reset"
    }
  },
  candidacy_threshold: "reviewed",
  promotion_conflicts: {
    candidates_to_staged: "prefer_latest",
    staged_to_members: "abort"
  }
}
```

**Rationale:**
- `track_latest` ensures no revisions are missed
- `replace` + `reset` ensures all changes are reviewed
- `staged_to_members: "abort"` prevents accidental overwrites during release

### Recommended Configuration for Development Release Tracks

For release tracks used in development or testing:

```javascript
{
  member_sync: {
    strategy: "track_latest",
    supplant: {
      behavior: "replace",
      status_policy: "preserve"
    }
  },
  candidacy_threshold: "work-in-progress",
  auto_promote: true
}
```

**Rationale:**
- `track_latest` ensures continuous tracking
- `preserve` speeds up iteration by not requiring re-review
- Permissive threshold allows rapid release cycles

### When to Use `queue` Behavior

Use `queue` when:
- Your team works on multiple release cycles in parallel
- You need to ship hotfixes while continuing development on the next major version
- You want to preserve staged work while tracking new development

### When to Use `ignore` Behavior

Use `ignore` when:
- Specific version pinning is important for compliance or reproducibility
- You want manual control over which revisions enter the workflow
- Your team makes deliberate decisions about version selection

### When to Use `manual` Strategy

Use `manual` when:
- You only want hand-picked revisions in the release track
- The release track is for archival purposes (capturing specific historical state)
- You're migrating from an older workflow and want to preserve existing behavior

---

## Limitations and Future Considerations

### Release-Track-Level Configuration Only

Member sync configuration applies uniformly to all member objects in a release track. There is no per-object override mechanism in the current design.

**Rationale:** Per-object overrides would require tracking configuration on individual object references across three tiers (`candidates`, `staged`, `members`). This significantly increases schema complexity and API surface area. The current release track schema and API are not designed for per-object configuration, and introducing it would require substantial refactoring.

**Future Consideration:** If use cases emerge where per-object sync behavior is essential (e.g., specific objects that should never be auto-tracked), this limitation can be revisited. A potential approach would be to introduce an "exclusion list" that specifies objects exempt from member sync, rather than full per-object configuration.

### No Retroactive Processing

Changing the member sync configuration does not retroactively process existing member objects. For example, if you switch from `manual` to `track_latest`, the system will not immediately scan all members and enroll their latest revisions. It will only respond to future object modifications.

**Workaround:** If you need to bulk-enroll the latest revisions of all member objects after switching to `track_latest`, you can use the Add Candidates endpoint with the list of member object IDs (without specifying `modified`, which defaults to latest).

### Event Ordering

When multiple objects are modified in rapid succession (e.g., during a bulk import), the system processes events in order. This should not cause issues in normal operation, but be aware that:
- Each modification event may trigger a new snapshot
- The final state reflects all modifications, but intermediate snapshots may exist

---

## Glossary

| Term | Definition |
|------|------------|
| **Member Sync** | The system that automatically responds to new object revisions by enrolling them in release tracks |
| **Auto-enrollment** | The act of automatically adding a new object revision to `candidates` |
| **Supplant** | The act of replacing an older revision with a newer one |
| **Status Policy** | The rule determining what workflow status a new revision receives during supplanting |
| **Track Latest** | A sync strategy that automatically enrolls new revisions of member objects |
| **Manual** | A sync strategy that requires explicit user action to enroll new revisions |

---

## Appendix: Schema Update

The release track configuration schema is extended as follows:

```javascript
// In release-track-snapshot-schema.js

config: {
  // Existing fields...
  candidacy_threshold: {
    type: String,
    enum: ["work-in-progress", "awaiting-review", "reviewed"],
    default: "reviewed"
  },
  auto_promote: {
    type: Boolean,
    default: true
  },
  promotion_conflicts: {
    candidates_to_staged: {
      type: String,
      enum: ["always_overwrite", "always_reject", "prefer_latest"],
      default: "prefer_latest"
    },
    staged_to_members: {
      type: String,
      enum: ["always_overwrite", "always_reject", "prefer_latest", "abort"],
      default: "abort"
    }
  },

  // NEW: Member Sync Configuration
  member_sync: {
    strategy: {
      type: String,
      enum: ["track_latest", "manual"],
      default: "track_latest"
    },
    supplant: {
      behavior: {
        type: String,
        enum: ["replace", "queue", "ignore"],
        default: "replace"
      },
      status_policy: {
        type: String,
        enum: ["reset", "preserve"],
        default: "reset"
      }
    }
  }
}
```
