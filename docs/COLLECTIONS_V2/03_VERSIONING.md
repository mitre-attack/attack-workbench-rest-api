# Release Track Versioning and Release Process

## Overview

The Release Tracks API uses a Git-inspired versioning strategy that separates two distinct concerns:

1. **Snapshot History** - Every modification creates a new timestamped snapshot for complete audit trail
2. **Release Versioning** - Specific snapshots can be "tagged" as releases using semantic versioning

This approach allows continuous development while providing stable, versioned releases for publication.

**Note on Terminology:** We use **release track** instead of "collection" to avoid confusion with TAXII collections, MongoDB collections, STIX bundles, and `x-mitre-collection` SDOs. See [02_TERMINOLOGY.md](02_TERMINOLOGY.md) for the complete terminology guide.

## Core Concepts

### Snapshots

A **snapshot** is an immutable state of a release track at a specific point in time, identified by:
- `stix.id` - The release track's STIX identifier (constant across all snapshots)
- `stix.modified` - ISO 8601 timestamp when the snapshot was created (unique per snapshot)

Every modification operation creates a new snapshot with a new `stix.modified` timestamp.

A snapshot may be either a **draft release** (untagged) or a **tagged release** (has version number).

### Draft Releases vs Tagged Releases

A **draft release** is a snapshot without a version number (`x_mitre_version === null`). It represents work-in-progress.

A **tagged release** is a snapshot that has been marked as production-ready for publication, identified by:
- `stix.x_mitre_version` - Version string in MAJOR.MINOR format (e.g., "1.0")

**Note:** ATT&CK release tracks use a two-part versioning scheme (MAJOR.MINOR), not the three-part semver format (MAJOR.MINOR.PATCH). The patch component is not tracked in `x_mitre_version`.

Not all snapshots are tagged releases. Only snapshots explicitly tagged via the `tag` operation become tagged releases.

**Example Timeline with Tagged Releases:**
```
id: "release-track--123", snapshot_id: "2024-01-01T10:00:00.000Z"
  version: null  ← DRAFT RELEASE (work in progress)

id: "release-track--123", snapshot_id: "2024-01-02T14:30:00.000Z"
  version: null  ← DRAFT RELEASE (work in progress)

id: "release-track--123", snapshot_id: "2024-01-05T09:15:00.000Z"
  version: "1.0"  ← TAGGED RELEASE (via tagging operation)
  version_history: [{
    version: "1.0",
    tagged_at: "2024-01-05T10:00:00Z",
    tagged_by: "user@example.com",
    snapshot_id: "2024-01-05T09:15:00.000Z"
  }]

id: "release-track--123", snapshot_id: "2024-01-10T11:00:00.000Z"
  version: null  ← DRAFT RELEASE (more development)

id: "release-track--123", snapshot_id: "2024-01-15T16:20:00.000Z"
  version: "1.1"  ← TAGGED RELEASE (via tagging operation)
  version_history: [
    { version: "1.1", tagged_at: "2024-01-15T17:00:00Z", tagged_by: "user@example.com", snapshot_id: "2024-01-15T16:20:00.000Z" },
    { version: "1.0", tagged_at: "2024-01-05T10:00:00Z", tagged_by: "user@example.com", snapshot_id: "2024-01-05T09:15:00.000Z" }
  ]
```

## The Tagging Operation

### What is "Tagging"?

The `tag` operation **tags an existing snapshot as a release** by assigning it a semantic version number (without the patch number). It does **NOT** create a new snapshot.

This is analogous to Git's tagging system:
- Git commits = release track snapshots (identified by `stix.modified`)
- Git tags = tagged releases (identified by `stix.x_mitre_version`)

### In-Place Tagging Strategy

When you tag a snapshot:

1. The **existing** snapshot is updated in-place
2. `version` is set to the new version
3. An entry is added to `version_history` for audit trail
4. The `modified` timestamp **does not change**

**Why in-place?**
- Avoids duplicate data (no need to copy the entire release track)
- Clear semantics: tagging is metadata, not a content change
- Snapshots remain immutable except for the version tag
- Matches Git's model where tags point to existing commits

### Tagging Endpoints

#### Tag Latest Snapshot
```
POST /api/release-tracks/:id/bump
```

Tags the most recent snapshot (highest `stix.modified`) as a tagged release.

**Request Body (optional):**
```json
{
  "type": "major" | "minor",  // Default: "minor"
  "version": "2.0"            // Alternative: explicit version (MAJOR.MINOR format)
}
```

**Examples:**

1. **Automatic version calculation:**
```bash
# Current latest tagged release: 1.2
# Tag as: 1.3 (minor increment)
POST /api/release-tracks/release--123/bump
{
  "type": "minor"
}
```

2. **Major version increment:**
```bash
# Current latest tagged release: 1.2
# Tag as: 2.0 (major increment)
POST /api/release-tracks/release--123/bump
{
  "type": "major"
}
```

3. **Explicit version:**
```bash
# Set specific version (must be greater than previous)
POST /api/release-tracks/release--123/bump
{
  "version": "2.0"
}
```

4. **Default behavior (no body):**
```bash
# Defaults to minor increment
POST /api/release-tracks/release--123/bump
```

#### Tag Specific Snapshot
```
POST /api/release-tracks/:id/snapshots/:modified/bump
```

Tags a specific snapshot as a tagged release. Can tag retroactively, (i.e., a non-latest snapshot can be tagged), granted no [versioning rules](#versioning-rules) are violated.

**Use Cases:**
- You want to tag snapshot 3, then later also tag snapshot 5
- You forgot to tag a snapshot and want to mark it retroactively
- You want to create multiple tagged releases from different development branches

**Constraint:** The version must be greater than any previously tagged version (no semver regression).

## Versioning Rules

### Version Format

Collections use a **two-part versioning scheme** (MAJOR.MINOR), inspired by semantic versioning but simplified for ATT&CK's release model:

- **MAJOR** (`X.0`) - Significant releases with substantial changes, may include breaking changes
- **MINOR** (`X.Y`) - Incremental releases with additions, updates, or fixes

**Note:** Unlike full semantic versioning (MAJOR.MINOR.PATCH), ATT&CK collections do not track patch versions. All changes, including bug fixes, increment the minor version or major version depending on significance.

### Version Constraints

1. **Monotonically increasing** - New versions must always be greater than previous versions
2. **Immutable once set** - Once a snapshot has `version` assigned, it cannot be changed
3. **Cannot re-tag** - A snapshot can only be tagged once (throws `AlreadyReleasedError` if attempted)
4. **Valid version format** - Must match `/^\d+\.\d+$/` (MAJOR.MINOR only, no patch component)

### First Tagged Release

For release tracks with no prior tagged releases:
- The first tag sets `version: "1.0"` (regardless of increment type)
- Or you can specify an explicit version like `"0.1"`