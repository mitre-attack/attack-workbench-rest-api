# Release Track Versioning and Release Process

## Overview

The Release Tracks API uses a Git-inspired versioning strategy that separates two distinct concerns:

1. **Draft State** - Standard tracks keep one rolling, untagged snapshot
2. **Release History** - Tagged snapshots are retained as immutable releases using semantic versioning

This approach allows continuous development while providing stable, versioned releases for publication.

**Note on Terminology:** We use **release track** instead of "collection" to avoid confusion with TAXII collections, MongoDB collections, STIX bundles, and `x-mitre-collection` SDOs. See [terminology.md](terminology.md) for the complete terminology guide.

## Core Concepts

### Snapshots

A **snapshot** is an immutable state of a release track at a specific point in time, identified by:

- `id` - The release track's STIX identifier (constant across all snapshots)
- `modified` - ISO 8601 timestamp when the snapshot was created (unique per snapshot)

Every content-changing operation creates a replacement snapshot with a new
`modified` timestamp. For a standard track, the replacement is saved first and
then older untagged drafts are pruned, except preserved release sources and
drafts referenced by persisted virtual provenance. Tagged snapshots are never pruned.

A snapshot may be either a **draft release** (untagged) or a **tagged release** (has version number).

### Draft Releases vs Tagged Releases

A **draft release** is a snapshot without a version number (`version === null`). It represents work-in-progress.

A **tagged release** is a snapshot that has been marked as production-ready for publication, identified by:

- `version` - Version string in MAJOR.MINOR format (e.g., "1.0")

**Note:** ATT&CK release tracks use a two-part versioning scheme (MAJOR.MINOR), not the three-part semver format (MAJOR.MINOR.PATCH). The patch component is not tracked in `version`.

Not all snapshots are tagged releases. Only snapshots explicitly tagged via the **release** operation become tagged releases.

**Example Timeline with Tagged Releases (standard track):**

```
id: "release-track--123", modified: "2024-01-01T10:00:00.000Z"
  version: null  ← FIRST ROLLING DRAFT

id: "release-track--123", modified: "2024-01-02T14:30:00.000Z"
  version: null  ← REPLACEMENT DRAFT; THE 2024-01-01 DRAFT IS PRUNED

id: "release-track--123", modified: "2024-01-05T09:15:00.000Z"
  version: "1.0"  ← TAGGED RELEASE (via release operation)
  version_history: [{
    version: "1.0",
    tagged_at: "2024-01-05T10:00:00Z",
    tagged_by: "user@example.com",
    modified: "2024-01-05T09:15:00.000Z"
  }]

id: "release-track--123", modified: "2024-01-10T11:00:00.000Z"
  version: null  ← NEW ROLLING DRAFT AFTER RELEASE 1.0

id: "release-track--123", modified: "2024-01-15T16:20:00.000Z"
  version: "1.1"  ← TAGGED RELEASE (via release operation)
  version_history: [
    { version: "1.1", tagged_at: "2024-01-15T17:00:00Z", tagged_by: "user@example.com", modified: "2024-01-15T16:20:00.000Z" },
    { version: "1.0", tagged_at: "2024-01-05T10:00:00Z", tagged_by: "user@example.com", modified: "2024-01-05T09:15:00.000Z" }
  ]
```

The timeline lists the first draft only to illustrate its replacement. In this
example it has no virtual dependents or tagged release preserving it, so once
the second draft is durably stored, the first draft is no longer retrievable.

## The Release Operation

### What Does Releasing Do?

The `release` operation assigns a semantic version number (without the patch
number). Standard tracks create a separate tagged snapshot and preserve the
exact source draft; virtual tracks tag their materialized draft in place.
`release` is the command; `tagged` describes the resulting snapshot state.

The snapshot lifecycle has three separate operations:

- `POST /release-tracks/:id/snapshots/:modified/release` tags a draft.
- `POST /release-tracks/:id/snapshots/:modified/draft` converts the newest
  tagged release back to a draft, with administrator authorization and an exact
  `confirm_version` in the body. Standard tracks restore the preserved source;
  virtual tracks retain the snapshot, its content, and composition provenance
  but clear its tag and publication metadata. Downstream resolved dependencies
  block conversion.
- `DELETE /release-tracks/:id/snapshots/:modified` deletes only the newest
  draft. The sole snapshot, preserved release sources, and resolved components
  of downstream virtual snapshots cannot be deleted. Tagged releases must
  first be converted to drafts; administrators cannot bypass this requirement.

This is analogous to Git's tagging system:

- Git commits = release track snapshots (identified by `modified` key)
- Git tags = tagged releases (identified by `version` key)

For a standard track, release planning also freezes workflow selectors.
Candidate entries are not released. Staged entries with an explicit timestamp
retain that exact revision; staged entries whose `object_modified` value is
`"latest"` are resolved to the actual latest `stix.modified` timestamp when
the preview or commit request is handled. Only exact revisions are promoted
into `members`, so the tagged release never contains a dynamic member
reference.

Releasing a standard track seals a fresh content manifest over the final
member set, so the relationships shipped are exactly those connecting members
at the moment of release; the release preview lists the relationships that
seal would add or remove. Releasing a virtual track publishes the manifest
sealed at materialization. Release also freezes the collection object's
publication metadata, assigns a stable bundle identifier, and records SHA-256
hashes of both bundle serializations. A released snapshot is immutable,
including its notes.

### Preserved Standard-Track Release Strategy

When you release a snapshot:

1. The selected standard draft remains unchanged as the rollback point.
2. A new tagged snapshot is created with a new `modified` timestamp.
3. `release_source_modified` points to the exact source draft.
4. `version` and a matching `version_history` entry are added to the release.
5. Staged objects are promoted into `members` and a fresh content manifest is
   sealed over the release.

Virtual tracks still tag their already-materialized draft in place. Standard
tracks use a clone because rollback must restore notes, workflow tiers,
dynamic selectors, and manifest identity exactly as they existed immediately
before release.

The preserved source draft is hidden from the normal Releases timeline while
its tagged clone exists. Rolling-draft cleanup does not prune it.

Administrators can correct a tagged snapshot's version with `PUT
/snapshots/:modified/release`. This preserves snapshot identity and content,
while enforcing the adjacent semantic-version bounds.

For a version-only correction, the STIX 2.1 SHA-256 changes because the
collection object contains `x_mitre_version`. The STIX 2.0 SHA-256 stays the
same: that format omits the collection object. The bundle ID is unchanged.
Hashes are generated before the version is changed and stored together with
the new version. If later history or catalogue updates fail, retry the same
PUT with the same version to finish them; a same-version request repairs
derived state rather than being a no-op.

Virtual materialization holds the component release locks until its snapshot
is persisted. Concurrent release, rollback, retag, or materialization on a
shared component may return `409`; retry after the other operation finishes.
Once the virtual snapshot exists, rollback is blocked by its dependency.

### Tagging Endpoints

#### Release Latest Snapshot

```
POST /api/release-tracks/:id/snapshots/latest/release
```

Releases the most recent snapshot (highest `modified`) as a tagged release.

**Request Body:**

```json
{
  "increment": "major"
}
```

Use `"version": "2.0"` instead of `increment` for an explicit version.
The selectors are mutually exclusive: supplying both returns `400 Bad
Request`, and the server never chooses one over the other. Omitting both
version selectors defaults to a minor increment. The `latest` path segment
selects whichever snapshot is latest when the release request is handled.
Callers that need to pin the operation to one snapshot should use the
`:modified` endpoint.

**Examples:**

1. **Automatic version calculation:**

```bash
# Current latest tagged release: 1.2
# Tag as: 1.3 (minor increment)
POST /api/release-tracks/release--123/snapshots/latest/release
{
  "increment": "minor"
}
```

1. **Major version increment:**

```bash
# Current latest tagged release: 1.2
# Tag as: 2.0 (major increment)
POST /api/release-tracks/release--123/snapshots/latest/release
{
  "increment": "major"
}
```

1. **Explicit version:**

```bash
# Set a specific version within the selected snapshot's chronological bounds
POST /api/release-tracks/release--123/snapshots/latest/release
{
  "version": "2.0"
}
```

1. **Default version selection:**

```bash
# Defaults to minor increment
POST /api/release-tracks/release--123/snapshots/latest/release
{}
```

#### Release Specific Snapshot

```
POST /api/release-tracks/:id/snapshots/:modified/release
```

Publishes a specific draft. For a standard track, the server preserves that
draft and creates a tagged clone at the current time.

**Use Cases:**

- You want to release the content of an earlier retained draft
- You want to pin the operation to a snapshot rather than use `latest`

**Constraint:** A standard release created from an earlier draft is not
backdated. Its version must be greater than the current latest release.

## Versioning Rules

### Version Format

Collections use a **two-part versioning scheme** (MAJOR.MINOR), inspired by semantic versioning but simplified for ATT&CK's release model:

- **MAJOR** (`X.0`) - Significant releases with substantial changes, may include breaking changes
- **MINOR** (`X.Y`) - Incremental releases with additions, updates, or fixes

**Note:** Unlike full semantic versioning (MAJOR.MINOR.PATCH), ATT&CK collections do not track patch versions. All changes, including bug fixes, increment the minor version or major version depending on significance.

### Version Constraints

1. **Chronologically increasing** - Tagged versions increase with release
   snapshot `modified` time.
2. **Immutable content** - Release contents and identity cannot be changed.
   Administrators may correct the version within its adjacent bounds.
3. **Cannot release twice** - A draft already linked to a tagged standard
   release cannot be released again.
4. **Valid version format** - Must match `/^\d+\.\d+$/` (MAJOR.MINOR only, no patch component)
5. **Unique within the track** - Exactly one snapshot may hold a given tagged
   version. If concurrent release requests race for the same version, one
   succeeds and the other receives `409 Conflict` with the conflicting
   `track_id` and `version`.

Relative `minor` and `major` increments are calculated from the latest tagged
release. For example, a track after explicit v19.1 previews as v19.2 for
`minor` and v20.0 for `major`, even when the selected source draft is older.

### First Tagged Release

For release tracks with no prior tagged releases:

- The first tag sets `version: "1.0"` (regardless of increment type)
- Or you can specify an explicit version like `"0.1"`
