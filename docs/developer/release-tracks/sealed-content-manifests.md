# ADR: Sealed snapshot content manifests

Status: accepted 2026-09-02. Supersedes the opt-in "deterministic graph"
cache described in earlier revisions of [bundle-export.md](bundle-export.md).

## Context

Release-track bundle export had two paths. A tagged snapshot that had opted
into a graph manifest replayed pointers; every other export resolved a
"bounded" ATT&CK graph live, including relationship-discovered secondary
objects. Editors could delete and recreate the manifest, which regenerated the
frozen `x-mitre-collection` object with a new `modified` timestamp and new
bundle hashes. The collection object's `created`, `modified`,
`created_by_ref`, and `object_marking_refs` were each derived differently on
the two paths, and the track-level `object_marking_refs` field was never read
by either.

Separately, every new SDO revision cloned every active relationship pinned to
the previous revision so that relationship revisions stayed paired 1:1 with
endpoint revisions. The frontend also created new WIP revisions of both
endpoint objects on every relationship save. Editing one relationship
description therefore produced three revisions of that relationship, two
endpoint revisions, and a clone of every other relationship touching either
endpoint.

## Decisions

1. **Every snapshot owns a sealed content manifest from birth.** A manifest
   is computed whenever a snapshot's `members` tier is written: release
   commit, virtual materialization, bundle import, quarantine promotion, track
   clone, and track creation. Snapshots produced by candidate, staged, config,
   and metadata clones inherit the predecessor's manifest by reference. A
   manifest is deleted only when no snapshot in its track references it.
2. **One graph algorithm.** Roots are the exact `members` revisions. A
   relationship is selected when its `source_ref` and `target_ref` are both
   member IDs; the newest revision of each relationship lineage is chosen and
   discarded if it is revoked, deprecated, or a deprecated pattern. The member
   revisions are recorded as the manifest entry's exact endpoint pins.
   Identities and marking definitions referenced by emitted objects are
   supporting entries; LinkById targets outside the bundle are non-emitted
   `link_target` entries. No secondary SDO is ever discovered through a
   relationship. The bounded resolver survives only behind the deprecated
   ephemeral and legacy endpoints.
3. **Relationship revisions are no longer cloned when an endpoint advances.**
   `workspace.relationship_endpoints` remains as authoring context recorded on
   create, and the release preview flags relationships whose authored endpoint
   revision differs from the member revision being shipped. Exact pairing for
   a release lives in the sealed manifest.
4. **The `x-mitre-collection` object is a projection, not a stored object.**
   It is rendered at export from the snapshot and its manifest. The TAXII
   server and other consumers read it from emitted STIX 2.1 bundles, so it is
   always present in STIX 2.1 output and never present in STIX 2.0 output.
   - `id`: `config.publication.collection_id`, defaulting to
     `x-mitre-collection--<track uuid>`; immutable once the track has a release.
   - `created`: `config.publication.created`, defaulting to the track's
     `created`; immutable once the track has a release.
   - `modified`: the snapshot's `modified`.
   - `x_mitre_version`: the tagged version. Drafts omit the key. ATT&CK
     requires the field, so draft bundles are previews that do not conform to
     the ATT&CK specification; a placeholder such as `0.1` collides with a
     legitimate first release and is a lie about publication state.
   - `created_by_ref` and `object_marking_refs`: resolved through the
     publication inheritance rule below.
   - `description`: the snapshot's `snapshot_description`, falling back to
     the track description.
   - `x_mitre_contents`: every emitted object except marking definitions.
5. **Publication metadata inherits from the global scope unless overridden
   at the track scope.** `config.publication.created_by_ref` and
   `config.publication.object_marking_refs` each take the shape
   `{ inherit: true }` (default) or `{ inherit: false, value }`. Inherited
   values come from the organization identity and the default marking
   definitions in system configuration. Drafts resolve the rule at export so
   they preview the current configuration. Release commit freezes the
   resolved values into the tagged snapshot's `publication` field, so a later
   change to global or track configuration cannot alter a published release.
   The former top-level track `object_marking_refs` field is migrated into
   this rule and removed.
6. **Release commit seals.** A standard commit computes the manifest over the
   planned member set at commit time, so relationships added since the last
   seal are captured even when nothing was staged. A virtual commit publishes
   the materialization manifest unchanged, because the materialized draft is
   the artifact that was reviewed. Commit also stores a stable `bundle_id`
   and SHA-256 hashes of both serializations on the tagged snapshot. Draft
   bundles use a deterministic UUIDv5 derived from the track ID and snapshot
   `modified`; the bundle ID changes across snapshots while the collection ID
   stays constant per track.
7. **Tagged snapshots are immutable including notes.** `snapshot_description`
   is editable on drafts only. The graph create and delete endpoints are
   removed. The admin-only source-attested reconstruction endpoint remains
   and can replace an existing manifest when the caller names the manifest it
   expects to replace. Standard release commit creates a tagged clone and
   retains its exact source draft. The correction path for a mistaken latest
   release is rollback: an administrator supplies typed version confirmation,
   the clone is removed, and the preserved draft becomes active again.
   Rollback is blocked while any virtual snapshot resolves the release.
   Version-only corrections preserve content and snapshot identity but
   regenerate export hashes.
8. **Storage is named for what it holds.** Manifests live in
   `releaseTrackContentManifests` and `releaseTrackContentManifestEntries`
   with `release-track-content-manifest--` ids. A manifest header carries
   `seal_reason` (which write produced it), `schema_version` (2 for pointer
   manifests, 1 for the legacy frozen-relationship backfill), `state`, and
   the optional `source_attestation`; the former `resolver_version` and
   `baseline_reconstruction` fields are gone. `releaseTrackReconciliations`
   holds outstanding backref work only and is normally empty. See the
   collections table in [entities.md](entities.md).
9. **Bundles never add workflow tiers.** `include` is a workbench tier
   selector; `format=bundle` rejects it with `400`. A draft bundle is exactly
   its inherited manifest, and the release preview (`format=bundle`) is the
   one live path, resolving the planned members. (An earlier revision of this
   design kept a draft-only `include=staged,candidates` preview; it was
   removed on 2026-09-03 because it produced bundles that matched no manifest
   and duplicated the release preview.)

## Consequences

### Rollback and retag concurrency / recovery

Release conversion is now explicit: `POST /snapshots/:modified/draft` replaces
the old tagged-snapshot DELETE path. Standard conversion retires the release
clone and restores its preserved source; virtual conversion clears the tag and
release-only export fields in place, keeping the manifest and provenance.
`DELETE /snapshots/:modified` only removes eligible drafts. Both operations
check downstream virtual dependencies under the release lock. A preserved
standard source must still exist and be untagged before its release is retired.
Creation cause and creator describe the original snapshot creation and are
never rewritten by conversion. Legacy `delete_release` audit entries remain
valid; new conversions use `convert_release_to_draft`.

Virtual materialization acquires the existing database-backed release locks
for all component tracks in sorted order, before resolving any source snapshot, and
holds them through snapshot persistence. Partial acquisition and failed
materialization unwind the locks. Contention fails fast with 409. The rollback
dependency scan therefore cannot miss an in-flight materialization: either
rollback owns the lock first, or it sees the persisted virtual dependency
after materialization releases the lock.
Standard clone save/prune acquires the same lock, so a source draft cannot
disappear between resolution and persistence. Pruning retains drafts referenced
by virtual provenance; after the final dependent is removed, a later standard
clone can prune an otherwise-unprotected draft.

Retag prepares both bundle serializations before writing, then atomically
publishes the version, publication metadata, bundle ID, and hashes on the
snapshot document. Export failure leaves the old release unchanged. Copied
version histories are repaired by snapshot identity, not by the previous
version string; this and catalogue/counter reconciliation run even on
same-version retries. This makes an interrupted multi-document update
recoverable without MongoDB transactions. STIX 2.0 bytes do not include the
release tag, so only the STIX 2.1 digest changes on a version-only correction.

History's repository projection and service summary both expose
`release_source_modified` so clients can identify retained source drafts.

- Determinism is unconditional: exporting a tagged snapshot replays pointers
  and never queries relationships, and a draft replays its inherited members
  graph.
- Manifest storage is bounded by the number of member-changing writes, not
  the number of snapshots. Standard tracks retain one active draft plus release
  sources and drafts referenced by virtual provenance.
- Editing an object creates no relationship revisions; editing a relationship
  creates exactly one relationship revision.
- Existing databases are migrated in place: the `graph_manifest_id` field is
  renamed, tagged snapshots without a manifest are sealed and labeled as
  baseline reconstructions, drafts inherit or seal, publication values are
  frozen onto tagged snapshots, and bundle hashes are recomputed. Release-track
  exports in production had not been published externally (publication still
  used the legacy `GET /api/stix-bundles` endpoint), so recomputing hashes
  does not invalidate a distributed artifact.
- Tracks intended to replace a legacy domain bundle set
  `config.publication.collection_id` and `config.publication.created` to the
  canonical ATT&CK values before their first release.
