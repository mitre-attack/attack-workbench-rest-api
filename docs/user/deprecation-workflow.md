# Deprecating objects

Deprecation means **retire this object without naming a replacement**. Workbench
stores a new revision with the same STIX ID, a later `modified` timestamp, and
`x_mitre_deprecated: true`. It does not hard-delete the object or its history.
Deprecated objects are excluded from default lists but remain retrievable.

For replacement rather than retirement, use the [revocation workflow](revoke-workflow.md).
The two operations intentionally have different relationship-handling rules.

## Business rule: detach blocking references first

An SDO being deprecated must have no blocking relationships in the **current domain graph**:

- No incoming or outgoing **active formal relationships (SROs)** other than
  `subtechnique-of` and `revoked-by`. These existing hierarchy and replacement
  links are preserved, in either direction, without creating new SRO revisions.
- No incoming or outgoing **domain embedded references** on latest object revisions.
- An incoming embedded reference still counts if its source is already revoked
  or deprecated. Retiring the source without removing its reference does not
  detach it from the target.

Here, active means neither `revoked: true` nor `x_mitre_deprecated: true`.
Latest means the most recent stored revision of each STIX ID. Workbench selects
that revision before considering its lifecycle state; an older active SRO does
not become a blocker again after its latest revision is deprecated.

### What counts as a reference?

| Reference | How it is represented | How to detach it |
|---|---|---|
| Formal SRO other than `subtechnique-of` / `revoked-by` | A separate `relationship` object with `source_ref` and `target_ref` | POST a new revision of the SRO with `x_mitre_deprecated: true` |
| Existing `subtechnique-of` / `revoked-by` SRO | Hierarchy or replacement link | Preserve unchanged; it does not block SDO deprecation |
| Strategy to analytic | `x_mitre_analytic_refs` on the strategy | Save a new strategy revision without that reference |
| Analytic to data component | `x_mitre_log_source_references[].x_mitre_data_component_ref` on the analytic | Remove or replace the relevant log-source records in a new analytic revision |
| Data component to data source | `x_mitre_data_source_ref` on the component | Remove or replace the source reference in a new component revision |
| Other domain embedded reference | Domain `_ref` / `_refs` fields, including nested fields | Edit the object that owns the STIX field, subject to its schema |

`workspace.embedded_relationships` is derived navigation metadata, not the source
of truth. Editing or clearing that cache does not detach an authoritative STIX
reference and cannot bypass the guard.

Historical revisions, already-retired SROs, attribution references, markings,
external citations, and release inventory do not block deprecation. In particular,
`created_by_ref`, `x_mitre_modified_by_ref`, `object_marking_refs`, and collection
`x_mitre_contents` are not domain relationships for this check. Existing published
snapshots and historical STIX are not rewritten.

## What the frontend does

An authenticated editor initiates deprecation from an object's deprecate control.
The shared frontend workflow then performs these steps:

1. **Check the server's authoritative blockers.** The frontend calls
   `GET /api/attack-objects/:stixId/deprecation-check`.
2. **Stop for any embedded blocker.** A dialog identifies each reference's source,
   target, field path, and direction relative to the selected object. No SRO or
   object writes are attempted. Resolve the references on their source objects,
   save those changes, then try again.
3. **Ask for confirmation.** If only blocking SROs remain, confirmation explains
   that those relationships will be retired before the object, while existing
   `subtechnique-of` and `revoked-by` links are preserved. If no blockers remain,
   it confirms object deprecation alone.
4. **Recheck after confirmation.** If embedded references appeared or the blocking
   SRO set gained a new or changed revision, stop and ask the user to review again.
5. **Retire blocking SROs sequentially.** Fetch each current blocking SRO and POST
   its new deprecated revision. Wait for completion before proceeding. Do not
   fetch or retire preserved `subtechnique-of` or `revoked-by` SROs.
6. **Check again, then save the object.** Only after no blocking references remain
   does the frontend POST the object's deprecated revision. The frontend applies
   the same type exemptions at every check, even if an older API reports preserved
   SROs as blockers. The server independently validates the final write; an older
   server can still reject it, in which case the frontend reports the failure
   without retiring the preserved links.
7. **Reload on success.** If any step fails, report the error rather than treating
   the object as successfully deprecated.

The shared retirement flow is used by the main object controls, applicable STIX
dialogs, and duplicate-relationship retirement. Retiring an SRO does not require
first removing its endpoint fields: those fields describe the retired edge and
remain in its history. Object-editor schema validation still applies to edits
used to resolve embedded blockers.

### Preserving hierarchy and replacement links

Deprecating an SDO preserves existing active `subtechnique-of` and `revoked-by`
SROs in both directions. Their STIX IDs, lifecycle flags, `modified` timestamps,
and revisions remain unchanged. This retains hierarchy and replacement navigation
without reparenting, reactivating, or retiring another endpoint object.

This exemption is specific to the **SDO deprecation cascade**. An editor can still
explicitly retire either type of SRO itself, including duplicate relationships in
the data-quality bulk action. Such retirement creates a new deprecated SRO revision
and remains legal when an endpoint is inactive.

Preserving an existing link is not permission to create a new active link to an
inactive endpoint. `revoked-by` remains the only relationship-type exemption from
that authoring guard; new active `subtechnique-of` links still require active
endpoints. The dedicated [revocation workflow](revoke-workflow.md) is unchanged.

### Why data-source dependent objects are no longer automatically deprecated

The old data-source UI flow gathered related data components and their SROs and
scheduled their deprecation alongside the data source. That retired additional
objects; it was not merely removal of relationships.

The current policy requires explicit embedded-reference resolution instead.
For example:

1. Component C contains `x_mitre_data_source_ref: S`.
2. Deprecating source S is blocked by C's incoming reference.
3. Merely deprecating C would not help: C's latest revision would still reference
   S, and references from inactive sources also count.
4. Remove or replace C's source reference in a valid new C revision. Resolve all
   other blockers in the same way, then retry deprecating S.

If C must itself be deprecated, that is a separate decision. Its own incoming
analytic references and outgoing source reference must be resolved first.
Workbench does not assume that retiring S authorizes retiring every component or
analytic that depends on it. There is no force option that silently removes
references from inactive referrers; such blockers need explicit review consistent
with the source object's lifecycle and schema constraints.

## What the REST API does

The API provides the blocker query and protects the final write. It does **not**
interpret an object-deprecation POST as an instruction to cascade through other
objects or SROs. Scripts must perform the preparation that the frontend performs.

### Query eligibility

```http
GET /api/attack-objects/:stixId/deprecation-check
```

An authenticated reader can request this check. A missing object returns `404`.
A successful check returns `200`, even when deprecation is blocked. For example:

```json
{
  "stix_id": "x-mitre-data-component--00290ac5-551e-44aa-bbd8-c4b913488a6c",
  "can_deprecate": false,
  "blockers": {
    "sros": [],
    "embedded": [{
      "source_ref": "x-mitre-analytic--00290ac5-551e-44aa-bbd8-c4b913488a6f",
      "target_ref": "x-mitre-data-component--00290ac5-551e-44aa-bbd8-c4b913488a6c",
      "path": "x_mitre_log_source_references[0].x_mitre_data_component_ref",
      "direction": "inbound"
    }]
  }
}
```

SRO blockers contain `stix_id`, `modified`, `relationship_type`, and `direction`.
Embedded blockers contain `source_ref`, `target_ref`, `path`, and `direction`.
Paths are relative to the source object's `stix` object.

### Perform the writes

After resolving embedded references, POST new deprecated revisions of blocking SROs
to `/api/relationships`, leaving existing `subtechnique-of` and `revoked-by` SROs
unchanged. Then POST a new deprecated SDO revision to its ordinary resource endpoint,
such as `/api/techniques` or `/api/data-components`, using the usual
`{ "workspace": ..., "stix": ... }` request shape. Keep the object's STIX ID and
advance `stix.modified`; do not use DELETE or a STIX-changing PUT.
Retirement of an SRO remains legal if an endpoint is already inactive.

The final authoring write checks authoritative relationships under graph-write
exclusion. If blockers remain, it returns `409`, `code: "deprecation_blocked"`,
and the same blocker structure. An eligibility response is advisory, not a token
that overrides later changes. A request may remove its own outgoing embedded
references in the same proposed deprecated revision; it still cannot remove
incoming references owned by other objects that way.

## Restoring a deprecated object

Un-deprecation creates a new revision of the selected object with the same STIX ID,
a later `modified` timestamp, and `x_mitre_deprecated: false`. It does not clear
`revoked`, and it is not an undo of every relationship change made when the
object was deprecated.

The current object-restoration path saves the selected SDO; it does **not**
automatically restore ordinary SROs linked to that object. UI availability varies:
the main object toolbar disables its deprecate action after deprecation, while
applicable STIX dialogs can expose an un-deprecate action. API clients can POST
a valid new object revision directly.

Restoring a retired SRO is a separate authoring request: POST a new revision of
that relationship with `x_mitre_deprecated: false`. The API checks **both endpoints'
latest revisions**, even when the relationship ID already exists:

- If either endpoint is deprecated or revoked, an ordinary SRO restoration returns
  `409 inactive_reference`. Its current retired revision and history remain unchanged.
- If both endpoints are active, an otherwise valid restoration is permitted.
- `revoked-by` retains its inactive-endpoint exception. Preserving an existing
  `subtechnique-of` edge during SDO deprecation does not grant an exception for
  explicitly restoring a retired `subtechnique-of` edge.

For example, consider `Marcher (S0317) --uses--> Deliver Malicious Application via
Other Means (T1476)`:

1. Retire the `uses` SRO, then deprecate T1476.
2. Deprecate S0317 as well.
3. Un-deprecate T1476. The `uses` SRO remains retired.
4. An explicit attempt to restore that SRO is rejected while S0317 is inactive.
5. Once S0317 is also active, the SRO can be explicitly restored as a new revision.

The same rule applies with source and target reversed, or when the other endpoint
is revoked instead of deprecated. A bulk caller must not infer that restoring
one endpoint authorizes restoring all incident relationships.

## Failure handling and boundaries

- If the first check finds embedded blockers, the frontend makes **no writes**.
- If an SRO retirement fails or the final check/write is rejected, the frontend
  stops. Earlier successful SRO retirements are not rolled back. Refresh the
  object and relationships before retrying.
- A failed write can leave persisted work after an unexpected database or
  post-persistence failure. Do not infer database state solely from the local UI
  flag or blindly retry a multi-step operation.
- `409 graph_write_conflict` means another graph writer owns the lock. A crashed
  writer requires the documented [operator recovery procedure](../admin/configuration.md#stix-graph-write-exclusion),
  not deletion of STIX history.
- This policy protects **authoring operations**. Collection imports retain their
  separate source-fidelity contract. Existing imported inactive objects are not
  retroactively orphaned by this workflow.
- New embedded references to inactive targets and new active ordinary SROs with
  inactive endpoints are rejected. `revoked-by` is the SRO creation exception.
  Unchanged legacy embedded references may remain on unrelated revisions;
  adding an occurrence or changing a reference-bearing record is checked.

See [revocation](revoke-workflow.md) for replacement, preservation choices, and
why revocation does not require the original object to be orphaned first.
