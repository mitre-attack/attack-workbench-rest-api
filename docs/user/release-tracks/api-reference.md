# Release Tracks API V2 - API Reference

## Overview

This document provides the complete API reference for Release Tracks V2 (formerly "Collections V2").

Snapshot latest/timestamp GETs in Workbench format and the snapshot-history
list return `creation_cause`, a read-only enum identifying the operation that
created each snapshot. Standard release creation uses `release_tagged`; virtual
tagging retains the original cause. Historical missing
values return `unknown`. The [creation-cause reference](../../developer/release-tracks/snapshot-creation-causes.md)
lists all standard and virtual causes.

`creation_actor` records the invoker independently of the track's original
`created_by_ref`. Its `kind` is `user`, `system`, or `unknown`. User actors
persist `user_account_id`; GETs additionally resolve a minimal `user` object
(`id`, `username`, `displayName`, `name`) for initials/name display. Missing
or deleted accounts retain their ID but omit `user`. Historical snapshots
return `{ "kind": "unknown" }`. Clients cannot set either provenance field.
Scheduled jobs are system actors; human-triggered automatic promotion retains
the initiating user. Neither field is included in STIX bundle exports.

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
- [Release Previews](#release-previews)
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
GET    /api/release-tracks/objects/:objectRef/releases
POST   /api/release-tracks/new
POST   /api/release-tracks/new-from-bundle
POST   /api/release-tracks/import
POST   /api/release-tracks/:id/meta
POST   /api/release-tracks/:id/snapshots/latest/release
POST   /api/release-tracks/:id/clone
DELETE /api/release-tracks/:id?confirm_track_id=:id
```

### Snapshot Operations

```
GET    /api/release-tracks/:id/snapshots
GET    /api/release-tracks/:id/snapshots/latest
GET    /api/release-tracks/:id/snapshots/:modified
POST   /api/release-tracks/:id/snapshots/:modified/release
PUT    /api/release-tracks/:id/snapshots/:modified/release
POST   /api/release-tracks/:id/snapshots/:modified/draft
POST   /api/release-tracks/:id/snapshots/:modified/clone
PUT    /api/release-tracks/:id/snapshots/:modified/description
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

### Release Previews

```
GET    /api/release-tracks/:id/snapshots/latest/release/preview
```

### Version Management

```
GET    /api/release-tracks/:id/objects/:objectRef/versions
```

### Virtual Release Tracks (Additional)

```
PUT  /api/release-tracks/:id/virtual/composition
PUT  /api/release-tracks/:id/virtual/schedule
POST /api/release-tracks/:id/virtual/snapshots/create
POST /api/release-tracks/:id/virtual/quarantine/promote
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

This endpoint supplants the deprecated `GET /api/stix-bundles` endpoint. The
generated bundle preserves the legacy object-selection behavior: primary
objects are retrieved by domain, secondary objects (groups, campaigns,
detection strategies) are discovered through relationships, and referenced
identities and marking definitions are included so the bundle is
self-contained.

**Path Parameters:**

- `:domain` - `enterprise` | `ics` | `mobile`

**Query Parameters:**

| Parameter                           | Values                                       | Default  | Description                                                                                                                                                                                                              |
| ----------------------------------- | -------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `format`                            | `bundle` \| `workbench` \| `filesystemstore` | `bundle` | Output format (`filesystemstore` is not yet implemented)                                                                                                                                                                 |
| `stixVersion`                       | `2.0` \| `2.1`                               | `2.1`    | STIX version the emitted bundle conforms to (bundle format only)                                                                                                                                                         |
| `includeToc`                        | `true` \| `false`                            | `true`   | Include a table-of-contents object (of type `x-mitre-collection`) in STIX 2.1. STIX 2.0 always omits it. The TOC uses `x_mitre_version: "0.1"`, the current timestamp, and the deployment's default ATT&CK spec version. |
| `includeObjectsWithMissingAttackId` | `true` \| `false`                            | `false`  | Include objects that should have an ATT&CK ID set but do not                                                                                                                                                             |
| `includeDeprecated`                 | `true` \| `false`                            | `false`  | Include objects with `x_mitre_deprecated: true` (this also governs deprecated Data Sources)                                                                                                                              |
| `includeRevoked`                    | `true` \| `false`                            | `false`  | Include objects with `revoked: true`                                                                                                                                                                                     |

> [!Note]
> The ephemeral endpoint does not support the `include` tier selector because
> it does not read from a persisted release-track snapshot — it includes all
> objects in the domain.

---

## Release Track Management

### Track identifiers and aliases

Every track has a canonical ID of the form `release-track--<uuid>`. A track
may also carry an **alias**: a URL-safe slug (2–64 lowercase letters, digits,
and hyphens, starting and ending with a letter or digit) that is unique across
tracks. Every `/api/release-tracks/:id/...` path accepts either form, so
`/api/release-tracks/enterprise-attack/snapshots/latest` and
`/api/release-tracks/release-track--<uuid>/snapshots/latest` are the same
request. Responses always report the canonical `id`; workbench snapshot
responses and registry entries also carry `alias` (or `null`).

Aliases are set at creation (`alias` in the create body) or later through
[Update Metadata](#update-metadata) (`alias: null` clears one). A slug that
would shadow a static path segment (`new`, `new-from-bundle`, `import`,
`objects`, `ephemeral`, `latest`) or begins with `release-track` is rejected
with `400`; an alias already used by another track returns `409`; an unknown
alias in a path returns `404`. Values that expect a track ID — such as
`confirm_track_id` on track deletion and `component_tracks[].track_id` in a
virtual composition — take the canonical ID only.

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
      "tagged_releases": [
        {
          "snapshot_modified": "2024-01-15T16:20:00Z",
          "version": "14.1",
          "tagged_at": "2024-01-15T17:00:00Z",
          "tagged_by": "user-id"
        }
      ],
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
  "alias": "release-track-name",
  "description": "Description",
  "snapshot_description": "Context for the initial draft",
  "type": "standard",
  "object_marking_refs": [],
  "config": {
    "candidacy_threshold": "awaiting-review",
    "auto_promote": false,
    "promotion_conflicts": {
      "into_candidates": "always_reject",
      "candidates_to_staged": "prefer_latest",
      "staged_to_members": "abort"
    },
    "member_sync": {
      "strategy": "manual",
      "supplant": {
        "behavior": "queue",
        "status_policy": "preserve"
      }
    }
  }
}
```

`config` is optional. When supplied, it uses the same fields and validation
rules as [Update Configuration](#update-configuration), and the validated
values are persisted on the initial draft snapshot. Omitted config fields use
their model defaults.

`description` is long-lived track metadata. `snapshot_description` is an
optional, snapshot-local annotation for the initial draft and is limited to
4000 characters.

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

Bundle bootstrap is fail-closed. Unsupported primary object types, invalid
objects, and primary revisions that cannot be persisted cause HTTP `400`, and
the release track is not created. Objects successfully persisted before a
later object fails may remain available in Workbench, but no partial track or
snapshot is registered.

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
GET /api/release-tracks/:id/snapshots/latest
```

`GET /api/release-tracks/:id` is not supported. That resource path is reserved
for operations such as deleting the track; use `/snapshots/latest` whenever the
full latest snapshot is required.

Workbench responses return the release-track snapshot shape. Entries in the `members`,
`staged`, `candidates`, and `quarantine` tiers include UI-friendly object details:

- `attack_id`
- `name`
- `type` (STIX object type of the selected revision)
- `x_mitre_version` (ATT&CK version of the selected revision)
- `description` (when available)
- `modified_by_user.name` (display name, or username if display name is missing)

**Query Parameters:**

| Parameter  | Values                                                         | Description                                                                    |
| ---------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `format`   | `workbench` \| `bundle` \| `filesystemstore`                   | Output format (default: `workbench`; `filesystemstore` is not yet implemented) |
| `include`  | `members` \| `staged` \| `candidates` \| `quarantine` \| `all` | Which tier arrays to include in `workbench` responses (default: all tiers)     |
| `releases` | `only`                                                         | Return only the latest tagged release instead of latest snapshot               |
| `version`  | `X.Y`                                                          | Return specific version (e.g., `14.1`)                                         |

**Additional query parameters for `format=bundle`:**

| Parameter     | Values         | Description                                                                                                                                          |
| ------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stixVersion` | `2.0` \| `2.1` | STIX version the emitted bundle conforms to (default: `2.1`). STIX 2.1 bundles always begin with the `x-mitre-collection` object; STIX 2.0 omits it. |

A bundle always replays the snapshot's sealed content manifest; `include` is
rejected with `400` for `format=bundle`. Use the
[release preview](#preview-latest-release) with `format=bundle` to see what
the next release would ship. See [Output Formats](output-formats.md) for
details on the bundle structure.

**Examples:**

```bash
# Get latest snapshot for the Workbench UI
GET /api/release-tracks/:id/snapshots/latest

# Get latest snapshot as STIX bundle (sealed content)
GET /api/release-tracks/:id/snapshots/latest?format=bundle

# Get latest snapshot with members and quarantine only
GET /api/release-tracks/:id/snapshots/latest?include=quarantine

# Get latest tagged release (not draft)
GET /api/release-tracks/:id/snapshots/latest?releases=only

# Get specific version
GET /api/release-tracks/:id/snapshots/latest?version=14.1
```

### List Snapshots

Returns a paginated history of lightweight snapshot summaries, ordered by
`modified` from newest to oldest. Omitting `tagged` applies no tagged-state
filter.

```
GET /api/release-tracks/:id/snapshots
```

**Query Parameters:**

| Parameter | Values          | Default | Description                                      |
| --------- | --------------- | ------- | ------------------------------------------------ |
| `tagged`  | `true`\|`false` | omitted | Include only tagged snapshots or untagged drafts |
| `limit`   | `1`–`200`       | `50`    | Maximum summaries to return                      |
| `offset`  | integer ≥ `0`   | `0`     | Matching summaries to skip                       |

Filtering occurs before pagination, so `pagination.total` is the total number
of snapshots matching `tagged`, not the total number in the track.

Every summary contains `id`, `type`, `modified`, `version`, `name`, the
track-level `description` (when set), `snapshot_description` (when the snapshot
has user-authored notes), `members_count`, the opaque `content_manifest_id`
of the snapshot's sealed content manifest, and `content_statistics`. Released
snapshots also contain `bundle_id` and `bundle_hashes`; `bundle_hashes`
contains the manifest ID plus the SHA-256 digests in `stix_2_0` and
`stix_2_1` for the exact four-space-indented UTF-8 JSON files downloaded by
the browser. Content statistics describe the sealed manifest at a glance:

- `primary_count`: member objects deliberately selected for the snapshot.
- `secondary_count`: legacy source-attested historical non-member objects.
  Sealed manifests report zero because relationships never expand SDO
  membership.
- `relationship_count`: relationships whose source and target are both members.
- `supporting_count`: supporting identities and marking definitions.
- `link_target_count`: objects pinned for deterministic LinkById expansion.
- `total_count`: all entries across those manifest roles.

The UI groups supporting and LinkById targets together as **Dependencies**.
Snapshot tier count keys continue to reflect the track type:

- `type: "standard"` adds `staged_count` and `candidates_count`.
- `type: "virtual"` adds `quarantine_count` and the snapshot's immutable
  `composition_resolution`. Its `component_snapshots` entries identify the
  exact standard-track snapshot used by track ID, tagged version, and
  `resolved_snapshot_id` creation timestamp, together with the resolution
  strategy, filters, source count, filtered count, and final contributed
  count. An unmaterialized virtual draft returns the field as `null`.

Inapplicable count keys are omitted rather than returned as zero.

```json
{
  "data": [
    {
      "id": "release-track--a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "type": "standard",
      "modified": "2024-01-15T16:20:00.000Z",
      "version": "14.1",
      "content_manifest_id": "release-track-content-manifest--01234567-89ab-4cde-8f01-23456789abcd",
      "bundle_id": "bundle--0f9d2a4e-1c3b-4b7e-9a6d-8e5f4c3b2a10",
      "name": "Enterprise ATT&CK",
      "description": "Enterprise domain release track",
      "snapshot_description": "Reviewed publication for the Q1 threat model.",
      "members_count": 3247,
      "content_statistics": {
        "primary_count": 3247,
        "secondary_count": 0,
        "relationship_count": 6841,
        "supporting_count": 5,
        "link_target_count": 17,
        "total_count": 10110
      },
      "staged_count": 18,
      "candidates_count": 5
    }
  ],
  "pagination": {
    "total": 47,
    "limit": 50,
    "offset": 0
  }
}
```

**Examples:**

```bash
# All tagged and untagged snapshots
GET /api/release-tracks/:id/snapshots

# Tagged releases only
GET /api/release-tracks/:id/snapshots?tagged=true

# Untagged drafts only, second page
GET /api/release-tracks/:id/snapshots?tagged=false&limit=25&offset=25
```

### Update Snapshot Description

Editors can attach or replace notes on any draft or tagged snapshot:

```
PUT /api/release-tracks/:id/snapshots/:modified/description
```

```json
{
  "description": "Reviewed publication for the Q1 threat model."
}
```

The value is trimmed and limited to 4000 characters. Send an empty string to
clear it. The API returns the updated snapshot as `snapshot_description` and
does not change the snapshot's `modified` timestamp, tier contents, or the
release track's long-lived description. Notes become the emitted collection
object's `description`, so a released snapshot is immutable and this endpoint
returns `409 Conflict`; set release notes through the release request's
`description` instead.

### Update Metadata

A user or team may wish to:

- rename a release (e.g., fix a typo like `"Entrprise"` to `"Enterprise"`) or shift the scope/purpose of an existing release track without losing its history (though [cloning](#clone-latest-snapshot) is preferred in this scenario)
- update the long-lived `description`. Publication metadata for the emitted collection object (identity, markings, collection ID, creation time) lives in the track configuration; see [Publication configuration](#publication-configuration).
- set or clear the track's [alias](#track-identifiers-and-aliases).

```
POST /api/release-tracks/:id/meta
```

Name and description live on the snapshot, so changing either creates a new
snapshot with the updated metadata. The alias is registry-only routing
metadata: an alias-only update changes no snapshot and returns the latest
snapshot unchanged.

**Request Body:**

```json
{
  "name": "Updated Name",
  "description": "Updated description",
  "alias": "updated-name"
}
```

Send `"alias": null` to remove an alias.

### Snapshot content is append-only

There is no endpoint for replacing a persisted snapshot's `members` tier.
Standard tracks add or revise content through candidates, promote those
objects to staged, and freeze them into members during release. Virtual tracks
derive members only when a composition is materialized.

If an operator makes an unwanted draft, delete it while it is still the latest
untagged snapshot or continue with a newer corrective draft. Historical drafts
and tagged releases remain part of the immutable track history. Bootstrapping a
new track from a bundle is the supported way to start with an existing member
set.

### Release Latest Snapshot

Creates a tagged snapshot from the latest standard-track draft and retains the
exact source draft as its rollback point. The tagged snapshot has a new
`modified` timestamp and records the source in `release_source_modified`.
Virtual-track releases continue to tag their materialized draft in place.

The request may also include an optional `description` (up to 4000 characters)
to set the tagged snapshot's notes in the same operation:

```json
{
  "increment": "minor",
  "description": "Initial production release for the Q1 threat model."
}
```

- If `version` is provided, uses that exact version (must be `X.Y` format)
- If `increment` is provided, calculates the next `major` or `minor` version
- `increment` and `version` are mutually exclusive; supplying both returns
  `400 Bad Request` rather than choosing one
- If both are omitted, defaults to a minor release
- If this is the first release, the version will be `1.0`
- Relative increments use the latest tagged release. Releasing a historical
  standard draft still creates a new release at the current time, so its
  version must follow the current release lineage.

```
POST /api/release-tracks/:id/snapshots/latest/release
```

**Request Body:**

```json
{
  "increment": "major"
}
```

Use `"version": "2.4"` instead of `increment` to select an explicit
`MAJOR.MINOR` version. The `latest` selector is resolved when the request is
handled. Use the `:modified` release endpoint when a caller needs to pin the
operation to a specific snapshot.

For virtual tracks, the selected draft must have a non-null
`composition_resolution`. An initial or composition-update draft is pending
until the virtual snapshot creation endpoint materializes it; preview and
release return `409 Conflict` before then.

The virtual release response records the materialized component provenance in
`version_history[].component_versions`:

```json
{
  "component_versions": {
    "release-track--groups-monthly": "5.2",
    "release-track--techniques-quarterly": "2.1"
  }
}
```

Keys are immutable component track IDs and values are the tagged versions
or `null` for draft components stored in the selected draft's `composition_resolution`. The server does not
look up the components' current releases, so advancing a component after
materialization does not rewrite the virtual release's provenance. Standard
release history entries omit `component_versions`.

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
DELETE /api/release-tracks/:id?confirm_track_id=:id
```

This irreversible operation requires the administrator role and removes the
track's complete snapshot history. `confirm_track_id` must exactly equal the
`:id` path parameter. Every accepted attempt is recorded in the durable
release-track destructive audit trail.

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

- `format` - `workbench` | `bundle` | `filesystemstore` (default: `workbench`; `filesystemstore` is not yet implemented)
- `include` - `members` | `staged` | `candidates` | `quarantine` | `all` (default: all tiers)

For `format=bundle`, `stixVersion` applies as for
[Get Latest Snapshot](#get-latest-snapshot); `include` is rejected.

**Example:**

```bash
# Get snapshot from January 15, 2024 for the Workbench UI
GET /api/release-tracks/:id/snapshots/2024-01-15T16:20:00.000Z

# Get snapshot from January 15, 2024 as STIX bundle
GET /api/release-tracks/:id/snapshots/2024-01-15T16:20:00.000Z?format=bundle
```

### Release/Tag Specific Snapshot

Releases a specific draft snapshot. Standard tracks create a new tagged
snapshot and preserve the selected draft; virtual tracks tag the selected
materialized draft in place.

```
POST /api/release-tracks/:id/snapshots/:modified/release
```

**Request Body:** Same as [Release Latest Snapshot](#release-latest-snapshot).

### Change a Release Version

```
PUT /api/release-tracks/:id/snapshots/:modified/release
```

Administrators may correct the `MAJOR.MINOR` version of a tagged snapshot
without changing its `modified` identity, bundle ID, publication metadata, or
content. The replacement must remain strictly between the preceding and
following release versions. Copied version ledgers, the release catalogue,
bundle hashes, and the audit trail are updated. Virtual snapshots that already
resolved this release retain their exact `resolved_snapshot_id`; their stored
`resolved_version` remains the historical label observed at materialization.

### Clone Specific Snapshot

Bootstraps a new release track from the specified snapshot.

```
POST /api/release-tracks/:id/snapshots/:modified/clone
```

### Sealed content manifests

Every snapshot references a sealed content manifest (`content_manifest_id`)
from the moment it is created. The manifest is the bill of materials that
bundle export replays: exact member revisions, relationships whose source and
target are both members (pinned to those member revisions), supporting
identities and marking definitions, and non-emitted LinkById targets. It never
adds a secondary SDO through a relationship and never follows a relationship
to a newer revision of a member.

A new manifest is sealed whenever a snapshot's members are written: release,
virtual materialization, bundle import, quarantine promotion, and track
cloning. Candidate, staged, configuration, and metadata changes inherit the
previous manifest by reference. Releasing a standard track reseals over the
final member set, so relationships created since the previous release ship;
the release preview reports them under `relationships` (`added`, `removed`,
`stale_endpoints`, and counts). A stale endpoint means the relationship was
authored against a different revision of an endpoint than the member revision
being shipped. Releasing a virtual track publishes the materialization
manifest unchanged.

Released snapshots also carry `publication` (the frozen collection metadata),
a stable `bundle_id`, and `bundle_hashes` with SHA-256 values for both exact
download files. There is no operation to delete or regenerate a manifest;
a correction is a new release.

Administrators may use `POST /api/release-tracks/:id/snapshots/:modified/graph/reconstruct`
for a historical baseline backed by an independently verified source bundle.
The request sends the bundle's SHA-256/collection/release/domain attestation
plus exact graph pointers; it does not import source STIX payloads. Because
the snapshot already references a sealed manifest, the request must name it in
`replace_manifest_id`; repeating the same attestation is idempotent and any
other current manifest is rejected with `409`. The server rejects plans whose
roots differ from `members`, whose revisions are missing, or whose relationship
endpoints are inconsistent, and recomputes the bundle hashes after replacement.
This recovery endpoint exists for controlled bootstrap tooling.

Pointer roles may also include `link_target`: an exact, non-emitted dependency
used only to render historical `(LinkById: ...)` fields deterministically.
An entry may carry `omitted_optional_defaults` containing `revoked` and/or
`x_mitre_remote_support` when the attested publication omitted those
false-valued defaults. This is a serialization-shape hint, not frozen STIX
content; all other fields still come from the exact persisted revision.

### Publication configuration

The emitted `x-mitre-collection` object's metadata follows an inheritance
rule configured under `config.publication` (see
[Get Config](#get-configuration) and [Update Config](#update-configuration)):

```json
{
  "publication": {
    "collection_id": "x-mitre-collection--1f5f1533-f617-4ca8-9ab4-6a02367fa019",
    "created": "2018-01-17T12:56:55.080Z",
    "created_by_ref": {
      "inherit": false,
      "value": "identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5"
    },
    "object_marking_refs": { "inherit": true }
  }
}
```

- `created_by_ref` and `object_marking_refs` each take `{ "inherit": true }`
  (the default) to use the organization identity or default marking
  definitions from the global system configuration, or
  `{ "inherit": false, "value": ... }` for a track-scoped override. When
  neither scope configures markings, the collection object carries the
  marking definitions referenced by its contents.
- `collection_id` and `created` are optional overrides. They default to a
  collection ID derived from the track UUID and the track creation time.
  Tracks that replace a legacy ATT&CK domain bundle set them to the canonical
  values before the first release. Once the track has a tagged release,
  changing either returns `409 Conflict`; `null` clears an override.
- `GET /config` also returns `publication_resolved`: the values currently in
  effect for the latest snapshot and, under `sources`, whether each came from
  the `track`, the `global` scope, was `derived`, or (for markings) falls back
  to `content`.
- Drafts resolve the rule at export so they preview the current
  configuration. Release freezes the resolved values onto the tagged snapshot
  as `publication`, so later changes never alter a published release.

### Convert a Tagged Release Back to Draft

```http
POST /api/release-tracks/:id/snapshots/:modified/draft
Content-Type: application/json

{ "confirm_version": "1.1" }
```

Administrator-only; returns `200` with the restored draft. Standard releases
restore their exact preserved source draft, including its original timestamp,
tiers, manifest, notes, creation cause, and creator. Virtual releases become
drafts in place: identity, materialized contents, composition provenance,
notes, and creation attribution remain; release-only publication/bundle/hash
fields are cleared. Both retract the release ledger entry and reconcile the
catalogue, counters, and backrefs. The action is audited as
`convert_release_to_draft`. Later drafts survive and remain current if newer.

Only the most recent tagged release may be converted. Downstream virtual
dependencies block conversion (`409`), as does a missing preserved standard
source. Missing/incorrect confirmation returns `400`, and non-administrators
receive `403`. The confirmation is checked under the release lock.

### Delete a Draft Snapshot

```
DELETE /api/release-tracks/:id/snapshots/:modified
```

Editors may delete the latest untagged draft; the track reverts to the
preceding snapshot and returns `204`. Tagged snapshots always return `409`,
even for administrators and even with the deprecated `confirm_version` query
parameter. Convert the release to a draft first, then delete the returned
draft timestamp in a separate request.

Deletion also returns `409` for historical drafts, the only remaining
snapshot, preserved sources of tagged releases, or any draft resolved by a
downstream virtual snapshot. Thus conversion alone does not guarantee deletion
eligibility. Deletion and dependency checks share the same release lock as
tagging and component materialization. A missing snapshot returns `404`.

---

## Candidate Management

### Add Candidates

Adds STIX objects as candidates to the latest draft snapshot. Each object is identified by its `stix.id` field, as well as (optionally) its `stix.modified` field. If `stix.modified` is omitted, the latest permutation of the relevant STIX object will be added. The candidacy reference will follow the latest version of the object until the moment the draft is converted to a release, at which point the reference will become locked to the specific permutation of the object that was considered "latest" at the time the release occurred.

If the same selector is already present in any tier of the snapshot, the add
is idempotently skipped. Thus, a second omitted/`"latest"` request does not
create another dynamic entry. An exact revision and a dynamic selector are
different workflow references, and an older or newer exact revision of an
object already in `members` can still be added as a candidate.

```
POST /api/release-tracks/:id/candidates
```

**Request Body:**

```json
{
  "object_refs": [
    { "id": "attack-pattern--uuid", "modified": "2024-01-15T10:00:00Z" }, // pinned to specific version
    { "id": "malware--uuid" } // follows latest version while marked as candidate
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
      "object_modified": "latest",
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

Tier transitions preserve selector uniqueness. If legacy state already
contains the same exact revision in `members` and `candidates`, the transition
repairs the duplicate and retains the `members` occurrence. A dynamic
candidate remains `"latest"` if it is promoted to staged.

````
POST /api/release-tracks/:id/candidates/review
```/

**Request Body:**

```json
{
  "from": "work-in-progress",
  "to": "awaiting-review",
  "object_refs": [{ "id": "attack-pattern--uuid", "modified": "2024-01-15T10:00:00Z" }]
}
````

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
      "object_modified": "latest",
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

Promotion conflict policies apply when `staged` contains a different revision
selector for the same object. An identical selector already present in another
tier is not a conflict; the operation retains a single occurrence, with
`members` taking precedence over workflow tiers.

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

Demotion follows the same rule: different selectors are handled by
`promotion_conflicts.into_candidates`, while an identical selector is retained
in only one tier. The request's `modified` value may be an exact timestamp or
`"latest"`.

```
POST /api/release-tracks/:id/staged/demote
```

**Request Body:**

```json
{
  "object_refs": [{ "id": "attack-pattern--uuid", "modified": "2024-01-15T10:00:00Z" }]
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
  "candidacy_threshold": "awaiting-review",
  "auto_promote": true,
  "promotion_conflicts": {
    "into_candidates": "prefer_latest",
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

All fields are optional. Configuration updates merge with the latest draft;
nested `promotion_conflicts` and `member_sync.supplant` values are also
merged. The same configuration object may be supplied when creating a track.

---

## Release Previews

Release previews and commits use the same planner. Preview requests never
persist data. Representation filters change only the rendered preview; they do
not change the release plan.

### Preview Next Release (Read-Only)

Returns a before/after delta by default. Use the historical form
`/snapshots/:modified/release/preview` to target a specific draft.

```
GET /api/release-tracks/:id/snapshots/latest/release/preview
```

**Query Parameters:**

- `format` - `summary` | `workbench` | `bundle` | `filesystemstore` (default:
  `summary`; `filesystemstore` returns 501)
- `increment` - `major` | `minor` (default: `minor`)
- `version` - explicit `MAJOR.MINOR` version; mutually exclusive with
  `increment`
- Supplying both selectors returns `400 Bad Request`; the server never chooses
  one selector over the other
- `include` - for `workbench`, selects returned tiers; bundle previews reject
  it
- `stixVersion` - bundle representation option; summary previews of standard
  tracks add `relationships` describing what the release would seal

**Response Example:**

```json
{
  "track_id": "release-track--123",
  "type": "standard",
  "source_snapshot_modified": "2024-01-15T16:20:00.000Z",
  "release_snapshot_modified": "2024-02-01T10:00:00.000Z",
  "version": "1.2",
  "version_bounds": {
    "lower": { "version": "1.1", "modified": "2024-01-01T12:00:00.000Z" },
    "upper": null
  },
  "releasable": true,
  "before": { "members_count": 10, "staged_count": 2, "candidates_count": 1 },
  "after": { "members_count": 12, "staged_count": 0, "candidates_count": 1 },
  "changes": { "promoted_count": 2 },
  "conflicts": []
}
```

`release_snapshot_modified` is the new identity a standard release would
receive; for a virtual release it equals `source_snapshot_modified`.
`version_bounds` reports the exclusive adjacent tagged releases used by both
relative and explicit selection. A standard release is created at the current
time, so it ordinarily has no upper bound; a historical virtual draft can have
both bounds.

`format=workbench` returns the complete would-be persisted snapshot.
`format=bundle` returns its publication-ready STIX bundle. Thus “dry run” is
not a separate command: it is a release preview with the desired format.
For a materialized virtual draft, the workbench preview includes the same
track-ID-keyed `version_history[].component_versions` map that a successful
release would persist.

For a standard track, `before` is the selected draft before staged members are
promoted and `after` is the would-be tagged result. Before either summary or
rendered preview output is produced, every staged `"latest"` selector is
resolved to the object revision that is latest for that request. The would-be
members in `format=workbench` and `format=bundle` therefore contain exact
timestamps. A later commit performs its own resolution and may select a newer
revision if the object changed after the preview.

For a virtual track, the contents were already resolved and frozen when the
draft was explicitly created. A virtual draft without
`composition_resolution` returns `409 Conflict` instead of previewing stale or
empty members. A materialized draft's release summary compares that persisted
draft with the most recent tagged snapshot that precedes it:

```json
{
  "track_id": "release-track--virtual",
  "type": "virtual",
  "source_snapshot_modified": "2024-07-15T10:00:00.000Z",
  "version": "14.0",
  "releasable": true,
  "previous_release": {
    "version": "13.1",
    "modified": "2024-01-15T10:00:00.000Z"
  },
  "before": { "members_count": 850, "quarantine_count": 2 },
  "after": { "members_count": 870, "quarantine_count": 0 },
  "changes": {
    "new_count": 30,
    "updated_count": 12,
    "removed_count": 10,
    "quarantined_count": 0
  },
  "conflicts": []
}
```

For the first virtual release, `previous_release` is `null` and the `before`
counts are zero. Historical draft previews compare against the tagged release
that chronologically preceded the selected draft, not a later release. Release
preview and release never re-resolve virtual composition.

---

## Version Pin Management

### Update Candidate Version Pin

Updates the revision selector of a candidate reference. Either value may be an
exact ISO timestamp or `"latest"`, allowing a candidate to switch between a
specific revision and a moving reference.

```
POST /api/release-tracks/:id/candidates/:objectRef/update-version
```

**Request Body:**

```json
{
  "old_modified": "latest",
  "new_modified": "2024-01-20T14:00:00Z"
}
```

**Use Cases:**

- Upgrading a candidate to the latest version of an object
- Downgrading to a previous stable version
- Synchronizing with another release track's version

**Note:** This operation creates a new draft snapshot with the updated version pin.

### List Object Versions in Release Track

Lists all occurrences of a specific object across candidates, staged, and
members. Candidate and staged occurrences may report `"latest"`; members
always report an exact timestamp.

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

### List Tagged Releases Containing an Object

Lists tagged snapshots across all release tracks whose `members` tier directly
contains the supplied STIX ID. The result spans all revisions and reports the
exact `object_modified` pin used by each release.

```
GET /api/release-tracks/objects/:objectRef/releases
```

Optional query parameters are `type=standard|virtual`, `order=asc|desc`,
`limit`, and `offset`. Drafts, candidates, staged/quarantined entries, and
secondary objects added only during bundle export are excluded. See
[Find Tagged Releases Containing an Object](releases-by-object.md) for the
complete response contract and semantics.

---

## Output Formats

### `workbench` (Default)

Release-track snapshot shape optimized for the Workbench frontend. Tier entries
include UI-friendly object details such as `attack_id`, `name`, `description`,
and `modified_by_user`.

### `bundle`

Standard STIX 2.1 bundle.

### `filesystemstore` (Not Implemented)

Planned STIX FileSystemStore directory structure. Requests with
`format=filesystemstore` currently return HTTP 501.

---

## Error Responses

### AlreadyReleasedError

**Status:** 409 Conflict

Snapshot already has a version assigned.

### InvalidVersionError

**Status:** 400 Bad Request

Invalid version format or not greater than previous versions.

### TaggedSnapshotDeletionError

**Status:** 409 Conflict

Tagged contents are immutable. Ordinary draft deletion cannot delete a tagged
snapshot; administrators use the guarded newest-release rollback described
above.

### NotFoundError

**Status:** 404 Not Found

Release track not found.

---

## Virtual Release Tracks

Virtual release tracks are computed aggregations of standard release tracks.
Unlike standard tracks, virtual tracks don't directly manage objects through
the candidate → staged → released workflow. Instead, they compose content from
multiple standard component tracks based on configurable rules.

**Key Characteristics:**

- Compute contents only from standard component tracks; virtual-track nesting
  is rejected
- Are purely compositional and cannot own native members
- Reference **tagged snapshots** or explicitly selected **active drafts**
- Create snapshots **manually or on schedule** (never event-driven)
- All snapshots start as **drafts** and must be explicitly tagged
- Support **resolution strategies** to control which component versions are included

**Resolution Strategies:**

1. `latest_tagged` - Always use the most recent tagged snapshot from component
2. `specific_version` - Pin to a specific semantic version (e.g., "5.0")
3. `specific_snapshot` - Pin to a specific tagged snapshot by timestamp
4. `latest_preview` - Use the newest standard snapshot's prospective release membership

`latest_preview` accepts drafts and tagged snapshots. Draft input contributes
members plus staged changes through the standard release membership planner,
including dynamic revision resolution and source conflict policies. Tagged input
contributes published members. Candidates are excluded. The source is not tagged
or mutated, and standard release version allocation/publication is not performed.
Filters and cross-component deduplication run after source membership planning;
blocking source conflicts return `409` with the source track ID and conflicts.

Published and pinned strategies remain members-only. Preview provenance records
the exact source snapshot timestamp and `resolved_version: null` for a draft, or
the actual version for a tagged source. `total_objects_in_source` counts planned
preview members before filters, not just the source draft's stored members.
Later changes cannot rewrite the frozen virtual materialization.

New composition requests reject retired `latest_draft`. Existing saved rules
must be explicitly changed to a supported strategy before materialization.
Historical composition/provenance retains its original label and contents.

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
        "track_id": "release-track--uuid",
        "resolution_strategy": "latest_tagged",
        "priority": 0,
        "filters": {
          "object_types": ["intrusion-set"],
          "domains": ["enterprise"]
        }
      }
    ],
    "deduplication": {
      "strategy": "prioritize_latest_object"
    }
  },
  "snapshot_schedule": {
    "mode": "cron",
    "cron": "0 0 1 1,7 *"
  },
  "scheduled_materialization": {
    "schedule_mode": "cron",
    "scheduled_for": "2027-01-01T00:00:00.000Z"
  }
}
```

`filters.domains` matches the exact pinned revision's canonical
`x_mitre_domains`. Short names (`enterprise`, `ics`, `mobile`) and STIX names
ending in `-attack` are equivalent. The comparison is inclusive: any
intersection between the object's domains and the configured domains includes
the object. Thus, `["enterprise-attack", "mobile-attack"]` matches either an
Enterprise or Mobile component filter; `["mobile-attack"]` does not match an
Enterprise filter. Objects without a matching domain are excluded.

Cross-domain objects retain the complete domain array in every representation.
The filter selects an exact revision; it does not narrow or rewrite that
revision for the requested virtual track.
Current matrix revisions must also persist `x_mitre_domains`. For an exact
historical matrix revision created before that requirement, the domain can
still be read from `external_references[].external_id` as a compatibility
fallback.

`filters.object_types` accepts canonical Workbench STIX type names:
`attack-pattern`, `campaign`, `course-of-action`, `identity`, `intrusion-set`,
`malware`, `marking-definition`, `note`, `relationship`, `tool`,
`x-mitre-analytic`, `x-mitre-asset`, `x-mitre-collection`,
`x-mitre-data-component`, `x-mitre-data-source`,
`x-mitre-detection-strategy`, `x-mitre-matrix`, and `x-mitre-tactic`.
When present, the array must contain at least one unique value. Omit it to
include all object types. Type filtering preserves each member revision pinned
by the resolved component snapshot.

`snapshot_schedule` controls virtual draft creation when the server scheduler
is enabled. Its shape depends on `mode`:

- `manual` accepts only `{ "mode": "manual" }`;
- `cron` requires a five-field `cron` expression and rejects `dates`;
- `dates` requires at least one ISO timestamp and rejects `cron`.

Unknown schedule properties return `400 Bad Request`. Standard tracks also
reject `snapshot_schedule` rather than silently ignoring it.

Cron expressions and explicit dates are interpreted in UTC. Cron occurrences
run while the scheduler is active; they are not backfilled after downtime.
Every due date is recovered after restart and creates exactly one draft.
Failed cron and date occurrences are retried by the scheduler. Scheduled
drafts include a `scheduled_materialization` object with `schedule_mode` and
`scheduled_for`. Clients may set the same strict object when creating a
virtual track. Standard tracks reject it. The value is attached immutably to
that snapshot and is returned by track listing, snapshot history, latest
snapshot, and timestamp-selected snapshot GET requests.

Composition, component, filter, and deduplication objects are strict. Unknown
keys, including the incorrect singular `filters.domain`, return
`400 Bad Request`. Component selectors are also strategy-specific:
`latest_tagged` and `latest_preview` reject `version` and `snapshot`;
`specific_version` requires only `version`; `specific_snapshot` requires only `snapshot`.
Every component requires a unique, non-negative integer `priority`; lower
numbers have higher priority. When composition is supplied during creation,
each referenced track must already exist and must be a standard track. Virtual
tracks cannot reference other virtual tracks, and unsupported top-level
properties such as `native_members` return `400 Bad Request`.

### Update Virtual Track Schedule

```
PUT /api/release-tracks/:id/virtual/schedule
```

Replaces a virtual track's persisted `snapshot_schedule` without creating or
modifying a content snapshot. The body is one of the same strict `manual`,
`cron`, or `dates` shapes accepted during track creation. The response contains
the normalized value under `snapshot_schedule`. Standard tracks return
`400 Bad Request`; unknown tracks return `404 Not Found`.

Workbench-format snapshot responses expose the current registry-backed
`snapshot_schedule` so configuration clients do not mistake a historical
snapshot for the active schedule. Scheduler reconciliation applies a saved
change on its next configured pass.

### Update Virtual Track Composition

```
PUT /api/release-tracks/:id/virtual/composition
```

**Request Body:**

```json
{
  "component_tracks": [
    {
      "track_id": "GroupsMonthly--uuid",
      "resolution_strategy": "latest_tagged",
      "priority": 0
    },
    {
      "track_id": "TechniquesQuarterly--uuid",
      "resolution_strategy": "specific_version",
      "version": "2.0",
      "priority": 1
    }
  ],
  "scheduled_materialization": {
    "schedule_mode": "dates",
    "scheduled_for": "2027-07-01T00:00:00.000Z"
  }
}
```

The same strict composition and selector validation applies to this update
operation. Invalid fields are rejected rather than removed from the persisted
configuration. Component track IDs and priorities must each be unique. The
optional `scheduled_materialization` value uses the same strict shape as
creation and is persisted on the new pending virtual draft.

**Note:** Updating composition creates a pending draft containing the new
rules. To prevent stale materialization from being released, the draft has
empty `members` and `quarantine` arrays and
`composition_resolution: null`. It cannot be previewed or tagged as a release
until `POST /api/release-tracks/:id/virtual/snapshots/create` materializes the
configured composition. Release preview and release return `409 Conflict`
while the draft is pending.

### Create Virtual Snapshot

```
POST /api/release-tracks/:id/virtual/snapshots/create
```

**Request Body:**

```json
{
  "description": "Q1 2024 snapshot",
  "scheduled_materialization": {
    "schedule_mode": "dates",
    "scheduled_for": "2027-07-01T00:00:00.000Z"
  }
}
```

`scheduled_materialization` is optional and follows the same strict,
virtual-only contract as track creation and composition update.

**Response:**

```json
{
  "id": "release-track--virtual-uuid",
  "type": "virtual",
  "modified": "2024-03-01T10:00:00Z",
  "version": null,
  "name": "Enterprise ATT&CK",
  "members": [],
  "quarantine": [],
  "composition_resolution": {
    "resolved_at": "2024-03-01T10:00:00Z",
    "component_snapshots": [
      {
        "track_id": "release-track--groups-monthly",
        "track_name": "Groups Monthly",
        "track_type": "standard",
        "resolved_snapshot_id": "2024-02-15T10:00:00Z",
        "resolved_version": "5.2",
        "strategy_used": "latest_tagged",
        "total_objects_in_source": 47,
        "objects_after_filter": 47,
        "objects_contributed": 47
      }
    ],
    "deduplication": {
      "total_objects_before": 47,
      "total_objects_after": 47,
      "duplicates_found": 0,
      "conflicts_resolved": []
    },
    "summary": {
      "total_objects": 47,
      "quarantined_objects": 0
    }
  }
}
```

The response is the persisted draft. Review it through the shared snapshot
retrieval endpoints, then use the shared release-preview and release endpoints
to tag it. There is no separate virtual snapshot-creation preview: the release
preview is the authoritative comparison and representation of the persisted
draft that would be tagged. A non-null `composition_resolution` is the
readiness marker for those shared release operations.

Each resulting `members` and `quarantine` entry contains an exact
`(object_ref, object_modified)` pair. Virtual materialization preserves exact
revisions already frozen in the selected tagged or active-draft component snapshots. It also
resolves any unresolved legacy component entry before persistence. The virtual
snapshot never stores `"latest"` and does not inherit a standard component's
`track_latest` member-sync behavior.

Shared snapshot retrieval returns these persisted fields directly. There is no
`resolve` query parameter and no `resolved_content` response property;
retrieval never recomputes virtual composition. As long as the track does not
acquire a newer snapshot, `/snapshots/latest` selects the same primary revision
set, and `/snapshots/:modified` addresses that set explicitly.

Virtual snapshot persistence freezes primary membership, not the bundle graph.
A tagged snapshot may opt into the graph separately through the graph endpoint
above. The deterministic graph is closed over those exact members; until it is
created, relationships and secondary objects resolve live. Hard deletes of
graph-pinned revisions return `409 Conflict`; every STIX-changing PUT returns
`409` regardless of graph state.

Candidate and staged exports are intentionally live, including exact-selector
entries, because determinism is guaranteed only for `members`. A `"latest"`
selector is resolved at request time until release. Tagged standard members
and all materialized virtual members are exact.

`duplicates_found` counts object IDs contributed by more than one component,
including repeated contributions of the same exact revision.
`conflicts_resolved` includes only object IDs for which multiple distinct
`object_modified` revisions remained after exact-revision collapse. The
component `objects_contributed` counts partition the surviving `members`, so
their sum equals `summary.total_objects`. With the `quarantine` strategy,
identical revisions remain one member and only distinct conflicting revisions
enter `quarantine`.

### Promote a Quarantined Virtual Revision

```
POST /api/release-tracks/:id/virtual/quarantine/promote
```

Select one exact quarantined revision for membership in the latest virtual
snapshot:

```json
{
  "object_ref": "attack-pattern--11111111-1111-4111-8111-111111111111",
  "object_modified": "2024-02-01T10:00:00Z"
}
```

The selected `(object_ref, object_modified)` pair must exist in the latest
snapshot's `quarantine` tier. A successful request creates a new draft,
replaces any existing member revision for that object with the selected
revision, and removes every quarantined alternative with the same
`object_ref`. The materialized source snapshot remains unchanged and
retrievable by its `modified` timestamp. Its `composition_resolution` is
carried forward unchanged as the immutable record of the original component
resolution.

The endpoint returns `400 Bad Request` for standard tracks or malformed
requests and `404 Not Found` when the exact selected revision is not
quarantined.

---

## Query Variations

### Snapshot Retrieval Endpoints

The following release-track snapshot retrieval endpoints support `include` and
`format` query parameters:

- `GET /api/release-tracks/:id/snapshots/latest` (get latest snapshot)
- `GET /api/release-tracks/:id/snapshots/:modified` (get specific snapshot)

The ephemeral bundle endpoint supports `format`, but not tier `include`, because
it does not read from a persisted release-track snapshot. `include` applies to
`workbench` responses only; `format=bundle` rejects it because a bundle always
replays the sealed content manifest.

**Include Parameter** (workbench format — controls which tiers are returned):

```
GET /api/release-tracks/:id/snapshots/latest                            # Default: all tiers
GET /api/release-tracks/:id/snapshots/latest?include=members            # Members tier only
GET /api/release-tracks/:id/snapshots/latest?include=staged             # Members and staged tiers
GET /api/release-tracks/:id/snapshots/latest?include=candidates         # Members and candidates tiers
GET /api/release-tracks/:id/snapshots/latest?include=quarantine         # Members and quarantine tiers
GET /api/release-tracks/:id/snapshots/latest?include=all                # All tiers
```

**Format Parameter** (controls output format):

```
GET /api/release-tracks/:id/snapshots/latest?format=workbench           # Workbench snapshot with metadata (default)
GET /api/release-tracks/:id/snapshots/latest?format=bundle              # Standard STIX bundle
GET /api/release-tracks/:id/snapshots/latest?format=filesystemstore     # Not implemented; returns 501
```

**Combined Example:**

```
GET /api/release-tracks/:id/snapshots/latest?include=all&format=workbench
```

### Release preview representations

`format=summary` describes the release delta. `format=workbench` renders the
would-be snapshot for the UI, and `format=bundle` renders the publication
artifact. `include` and bundle filters affect only those representations, not
what the release command will persist.
