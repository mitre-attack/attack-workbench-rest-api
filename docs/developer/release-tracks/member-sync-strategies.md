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

Member sync logic is triggered by **object modification events**. Specifically,
when a STIX object is created or updated, the system checks whether that object
is referenced by any release track's latest snapshot — in `members`,
`candidates`, or `staged`. For each referencing track, the configured member
sync strategy determines what workflow action (if any) to take:

- **Object in `members`:** the object is auto-enrolled as a candidate with
  `object_modified: "latest"`. The exact released member remains unchanged.
- **Object referenced only in `candidates`/`staged`:** a dynamic selector
  already follows the new revision. `replace` may reset or preserve its
  workflow standing; `queue` cannot add a second indistinguishable `"latest"`
  entry; and `ignore` leaves workflow standing unchanged. If the existing
  workflow entry is explicitly timestamp-pinned, the supplant policy can
  replace it with `"latest"`, queue a dynamic candidate beside it, or retain
  the exact pin.

> **Behavior evolution (2026-07-10):** member sync originally applied *only* to
> objects in `members`, on the rationale that candidates/staged entries were
> still in-flight. In practice that meant a candidate pin silently went stale
> the moment the author kept editing — the release would ship the old pinned
> revision, and the object's latest view lost its `workspace.release_tracks`
> backref (the membership appeared to vanish). Under `track_latest`, workflow
> entries now use an explicit `"latest"` selector. Exact `members` pins never
> move. A `manual` track does not auto-enroll or replace entries, although a
> manually created `"latest"` candidate/staged selector still follows the
> object by definition.
> Relationships are deliberately excluded from sync — bundle export pulls
> relationships: sealed content manifests select them by member closure whenever a snapshot's members are written.
>
> **Behavior evolution (2026-07-13):** further change-capture rules, all
> placement decisions now centralized in the **workflow gate**
> (`app/lib/release-tracks/workflow-gate.js`):
>
> - Sync also fires on the per-type `::revoked` events and on the
>   technique/subtechnique conversion events
>   (`attack-pattern::converted-to-subtechnique` / `::converted-to-technique`).
>   Both workflows save the new revision directly via the repository (no
>   `::created`/`::updated` fires), so without these subscriptions a track
>   silently kept exporting the pre-revoke / pre-conversion revision.
> - The gate codifies the candidacy threshold into placement itself: an
>   entry whose resulting status meets `candidacy_threshold` (with
>   `auto_promote`) is placed directly in `staged` — one snapshot instead of
>   bouncing through candidates and a post-hoc auto-promotion pass.
> - Repeat no-op changes (entry already in the gate-decided tier/status) and
>   enrollment of already-pinned revisions (e.g. a re-import announcing an
>   already-released revision) skip snapshot creation.
>
> **Behavior evolution (2026-08-03):** every persisted STIX revision is now
> immutable, not only released content. A PUT that changes `stix` returns 409;
> authors POST a new revision and member sync handles the resulting `::created`
> event. Metadata-only PUTs may update `workspace` but do not emit a STIX
> update event or create a track snapshot. The legacy `modified-in-place`
> transition remains readable for stored data but is no longer produced by
> the object update path.

### Relationship to Existing Features

Member sync strategies integrate with several existing release track features:

- **Candidacy Threshold:** When a new revision is auto-enrolled as a candidate, it may be immediately promoted to `staged` if its status meets the candidacy threshold.
- **Conflict Resolution Policies:** Member sync resolves overlaps with existing `candidates`/`staged` entries through its own `supplant` config (below). *Manual* candidate adds and demotions instead go through `config.promotion_conflicts.into_candidates` (default `prefer_latest`) — see `release-workflow.md`. The two are deliberately separate: supplant expresses sync intent (replace/queue/ignore), while `into_candidates` uses the same policy vocabulary as the other tier transitions.
- **Snapshot Creation:** Any change to a release track's object lists (`candidates`, `staged`, `members`) creates a replacement draft snapshot. After it is durably saved, older untagged drafts are pruned unless they are preserved release sources or referenced by virtual provenance. Tagged snapshots remain historical. Member sync follows this convention.

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

When a new revision of a member object is created, **automatically add a
dynamic `"latest"` reference to `candidates`**.

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
    object_modified: latest  # Resolves to 2025-06-15 now and keeps following
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

The `supplant` configuration controls workflow placement and status when a new
revision is created and the same object already exists in `candidates` or
`staged`. For an exact existing selector, it also controls whether that fixed
revision is retained or replaced by a dynamic one. It never changes the
meaning of an already-persisted `"latest"` selector.

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
    object_modified: latest  # Currently resolves to v27
    object_status: "work-in-progress"  # Status reset

staged: []  # v26 removed
```

###### `"queue"`

Keep an exact older revision where it is and add a dynamic `"latest"`
candidate alongside it.

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
    object_modified: latest  # Currently resolves to v27
    object_status: "work-in-progress"

staged:
  - object_ref: attack-pattern--abc
    object_modified: 2026-01-01  # v26 unchanged
    object_status: "reviewed"
```

**Note:** `queue` can preserve parallel work only when the incumbent entry is
an exact timestamp. If it is already `"latest"`, a second dynamic entry would
be indistinguishable, so the existing selector simply continues following the
object. Multiple exact/dynamic selectors can otherwise coexist across
`candidates` and `staged`; release-time resolution occurs before the configured
promotion conflict policy is applied.

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
    object_modified: latest
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
  - { object_ref: attack-pattern--T1, object_modified: latest, object_status: "work-in-progress" }
staged: []
```

**Explanation:** A dynamic candidate is automatically enrolled and currently
resolves to v26. The released version v25 remains exactly pinned in `members`.

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
  - { object_ref: attack-pattern--T1, object_modified: latest, object_status: "work-in-progress" }
staged: []
```

**Explanation:** The exact v26 selector is removed from `staged` and a
dynamic selector, currently resolving to v27, is added to `candidates` with
reset status. The user must re-review it before staging.

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
  - { object_ref: attack-pattern--T1, object_modified: latest, object_status: "reviewed" }
```

**Explanation:** The exact v26 selector is replaced by `"latest"`, which
currently resolves to v27, but it inherits `reviewed` and remains staged.

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
  - { object_ref: attack-pattern--T1, object_modified: latest, object_status: "work-in-progress" }
```

**Explanation:** Exact v26 and dynamic `"latest"` coexist. v26 can ship in
the imminent release while the moving candidate, currently v27, progresses
for a later release.

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
  - { object_ref: T1, object_modified: latest, object_status: "work-in-progress" }  # Currently T1-v27
  - { object_ref: T2, object_modified: latest, object_status: "work-in-progress" }  # Currently T2-v26
  - { object_ref: T3, object_modified: latest, object_status: "work-in-progress" }  # Currently T3-v27
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
  - { object_ref: T1, object_modified: latest, object_status: "work-in-progress" }
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

When `supplant.behavior` is `queue`, an exact selector and a dynamic selector
for the same object can coexist across `candidates` and `staged`. This creates
potential for conflicts during promotion:

1. **Candidates to Staged:** If v26 is in `candidates` and v27 is also in `candidates`, promoting one may conflict with the other. The `candidates_to_staged` conflict policy determines resolution.

2. **Staged to Members:** Release planning resolves `"latest"` first. If the
   resulting exact revision conflicts with an existing member, the
   `staged_to_members` policy applies.

The existing conflict resolution policies (`always_overwrite`, `always_reject`, `prefer_latest`, `abort`) handle these situations. No changes to conflict resolution are required for member sync to function correctly.

### Snapshot Creation

Any change to a release track's `candidates`, `staged`, or `members` arrays
results in a new draft snapshot. If an existing dynamic selector needs no
workflow change, member sync skips the redundant snapshot and emits a
contents-changed reconciliation so its backref moves to the newly latest
object revision.

This means:
- Auto-enrollment generates a new snapshot
- Supplanting (whether `replace` or `queue`) generates a new snapshot
- Multiple objects being updated simultaneously (e.g., bulk import) generates a single snapshot reflecting all changes

### Event-Driven Architecture

Member sync requires listening for object modification events. When a STIX object is created or modified:

1. The system identifies all release tracks where this object appears in
   `members`, `candidates`, or `staged`
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
| New revision created (nothing in candidates/staged) | Add `"latest"` to candidates as WIP | Add `"latest"` to candidates as WIP | Add `"latest"` to candidates as WIP | Add `"latest"` to candidates as WIP | No auto-enrollment |
| New revision created (exact older candidate as WIP) | Replace with `"latest"` as WIP | Replace with `"latest"` as WIP | Add `"latest"` alongside | Keep exact pin | Keep exact pin |
| New revision created (exact older candidate as awaiting-review) | Replace with `"latest"` as WIP | Replace with `"latest"` as awaiting-review | Add `"latest"` alongside | Keep exact pin | Keep exact pin |
| New revision created (exact older staged as reviewed) | Replace with candidate `"latest"` as WIP | Replace with staged `"latest"` as reviewed | Keep exact staged and add candidate `"latest"` | Keep exact pin | Keep exact pin |
| New revision created (existing workflow selector is `"latest"`) | Apply reset/preserve workflow policy; selector stays dynamic | Apply reset/preserve workflow policy; selector stays dynamic | No duplicate; selector keeps following | No workflow change; selector keeps following | No workflow change; selector keeps following |

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
