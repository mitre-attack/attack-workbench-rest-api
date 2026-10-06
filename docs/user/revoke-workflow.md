# Revoking objects

Revocation means **replace this object with another existing object**. Call the
original object **A** and its replacement **B** throughout this guide.

On success, Workbench stores a new revision of A with the **same STIX ID**, a
later `modified` timestamp, and `revoked: true`. It creates an active
`A --revoked-by--> B` SRO. It does not delete A, create B from scratch, or rewrite
historical revisions. Revoked objects are excluded from default lists but remain
retrievable.

For retirement without a replacement, use [deprecation](deprecation-workflow.md).

## Deprecation versus revocation

| Question | Deprecation | Revocation |
|---|---|---|
| Intent | Retire without naming a replacement | Retire A in favor of existing B |
| Must the original be orphaned first? | Blocking references must be detached; existing `subtechnique-of` and `revoked-by` SROs are exempt | No; the backend handles the planned SRO changes and optional embedded transfer |
| Who orchestrates relationship writes? | Frontend or API caller, before the final SDO POST | Backend, within the dedicated revoke request |
| Existing active SROs | Caller retires ordinary SROs first; preserves `subtechnique-of` and `revoked-by` unchanged | Backend retires them; optionally creates equivalents involving B |
| Existing embedded references | Must be explicitly detached before deprecation | Transferred when preservation is enabled; left in place when it is disabled |
| Replacement link | None created | New active `revoked-by` SRO |
| History | Retained | Retained |

Active means neither `revoked: true` nor `x_mitre_deprecated: true`. Relationship
planning uses each STIX ID's latest stored revision, not all historical versions.
Attribution, markings, external citations, and release inventory are not domain
embedded references for these workflows.

## Before starting

- A must exist and must not already be revoked.
- B must be a different existing object of the same STIX type. For example,
  malware and tools share an API resource but are not the same STIX type.
- B must be active, and the supplied `modified` timestamp must identify its latest
  revision. If it changed since selection, refresh and choose the current revision.
- The proposed writes must satisfy the installed ATT&CK Data Model and normal
  authoring constraints. A revoke route alone does not make every type or payload
  a valid `revoked-by` relationship.
- For embedded preservation, incoming referrers that need new revisions must be
  active. An inactive referrer blocks preservation; it is not silently skipped
  or rewritten.

The current REST API exposes revoke routes for techniques, tactics, mitigations,
groups, software, campaigns, data sources, data components, matrices, and assets.
There is no dedicated analytic or detection-strategy revoke route. Schema
validation still limits which of the exposed workflows can succeed; this feature
does not add unsupported endpoint types or bypass ADM validation.

## What the frontend does

1. The user opens the revoke control on a supported object.
2. Workbench presents replacement candidates, excluding A and inactive objects.
3. The user selects B and chooses whether to preserve relationships. The checkbox
   defaults to **off**.
4. The frontend sends **one mutation request** to A's revoke endpoint, containing
   B's STIX ID, its selected revision timestamp, and the preservation option.
5. The backend performs the workflow. The frontend does not separately migrate
   embedded references or issue an SRO-deprecation loop for revocation.
6. On successful completion, the frontend reloads the object. On error it displays
   the failure and does not confirm the local object as successfully revoked.

This differs from deprecation, where the frontend orchestrates separate ordinary
SRO retirements before the final object-deprecation request, preserving existing
`subtechnique-of` and `revoked-by` links. Those deprecation exemptions do not change
the dedicated revocation workflow described below.

## What the backend does

The dedicated revoke request coordinates the operation, not merely its validation:

1. **Exclude competing graph writes.** Acquire the shared graph-write lock.
2. **Validate A, B, and hierarchy constraints.** Reject self-revocation, an already
   revoked A, an invalid replacement, or an incompatible technique hierarchy.
3. **Plan the complete changes.** Find A's latest active incident SROs. Plan their
   retirement, optional replacement SROs, optional embedded source/replacement
   revisions, and the new `A --revoked-by--> B` link.
4. **Preflight the planned writes.** Validate the proposed revisions through their
   owning services before persisting them. Expected schema errors and reference
   conflicts stop here, without revoking A or saving the planned changes.
5. **Persist the plan.** Save embedded source/replacement revisions when requested,
   deprecated revisions of the original SROs, replacement SROs when applicable,
   and the new `revoked-by` SRO. Then save A's new revoked revision.
6. **Reconcile affected metadata.** With preservation enabled, rebuild affected
   latest embedded relationship caches from authoritative STIX. Notify the normal
   revocation lifecycle listeners, including release-track revision handling.
7. **Return the workflow result.** The response identifies A and the created,
   revised, and deprecated objects.

The graph lock prevents authoring changes from racing validation and persistence.
It is **not a multi-document database transaction**; see failure handling below.

## Preservation choices

### `preserveRelationships=false` — the default

- Create deprecated revisions of A's latest active incident SROs. Keep their
  original IDs and endpoints; older revisions remain stored.
- Create the new active `A --revoked-by--> B` SRO.
- Do not create replacement copies of the original SROs.
- Do not detach or migrate incoming or outgoing embedded references.

For example, if active analytic X references component A, revoking A without
preservation leaves X referencing **revoked A**, not B. A still exists, so this
is a resolvable inactive reference rather than a hard-delete dangling reference.

**This is an intentional boundary of the current implementation:** the prohibition
on *adding* references to inactive objects does not retroactively remove existing
references when preservation is disabled. Revocation is not the orphan-first
operation; deprecation is.

### `preserveRelationships=true`

#### Formal SROs

For each eligible latest active SRO touching A, substitute B for A in its
endpoints and create a **new relationship ID**. Retire the original SRO through
a new deprecated revision.

Example: `Group --uses--> A` becomes a new active `Group --uses--> B`, while the
old edge's latest revision becomes deprecated.

An equivalent active SRO already involving B is not duplicated. Equality here
means the same source, relationship type, and target. A warning reports each
skipped duplicate. Already-retired SROs are not transferred.

#### Incoming embedded references

For each other latest object that references A, create a **new revision of that
source object**, replacing the domain reference to A with B. Keep the source's
STIX ID; do not change its historical revisions.

Example: analytic X has a log-source record containing component A, a log-source
name, and a channel. The new X revision points to component B and retains that
name and channel. Its old revision still points to A.

An inactive source object that would need this change causes `409 inactive_referrer`.
The workflow does not automatically reactivate it or write another revoked revision.

#### Outgoing embedded references

Merge A's outgoing domain references into B, creating a new B revision if needed:

- Preserve B's existing references.
- Union reference-bearing arrays, deduplicating equal entries without discarding
  distinct log-source name/channel records.
- Reject a conflicting single-reference field with `409 embedded_reference_conflict`.
  Do not guess which value should win.

For example, if component A references source S and B has no source reference,
a new B revision can acquire S. If B already references a different source T,
preservation is blocked until the conflict is resolved explicitly.

A's new revoked revision retains A's original outgoing STIX references. Therefore,
a target can correctly show backlinks from both revoked A and active B after
outgoing preservation. Those backlinks describe stored references, not an
active-only projection. Relevant source and target workspace caches are reconciled;
historical STIX and sealed release contents are not rewritten.

### Special SROs: retirement is not transfer

`subtechnique-of` SROs are **retired but never copied onto B** during revocation,
even when preservation is enabled. Blindly substituting B could create an invalid
parent/child hierarchy. Each skipped hierarchy transfer produces a warning.

This does not restore the former *deprecation* exemption: deprecation also requires
those edges to be retired. The difference is that revocation additionally decides
which edges may be recreated for a replacement.

A pre-existing active `revoked-by` SRO touching A participates in the ordinary
retirement/transfer plan. The **new** `A --revoked-by--> B` SRO is created after that
plan is collected and remains active. It is the record of this replacement.

For techniques, the backend specifically rejects replacing a parent technique
with a subtechnique while the parent still has active child `subtechnique-of`
relationships. Rehome the children or convert the proposed replacement into a
parent first. Other transfers still do not automatically reparent children.
See [technique conversion](technique-conversion-workflow.md).

## REST API usage

Mutation requires an authenticated editor-or-higher account. Use the plural API
resource name, not the STIX type name:

```http
POST /api/techniques/:stixId/revoke?preserveRelationships=true
Content-Type: application/json
```

```json
{
  "revoking": {
    "stixId": "attack-pattern--00290ac5-551e-44aa-bbd8-c4b913488a6f",
    "modified": "2026-03-27T14:31:52.744Z"
  }
}
```

The path identifies **A**; `revoking` identifies **B**. Use an actual existing
replacement and its latest timestamp. Omitting `preserveRelationships` is the
same as setting it to `false`. The endpoint does not accept a new replacement
object body or require the caller to POST `revoked: true` separately.

### Successful response

Success returns `200` with the [workflow response envelope](../developer/workflow-response-pattern.md):

| Field | Meaning |
|---|---|
| `workflow` | `revoke` |
| `primary` | A's new revoked revision |
| `sideEffects.created` | The new `revoked-by` SRO and any transferred SROs |
| `sideEffects.modified` | New revisions of embedded referrers and/or B; these are not in-place STIX edits |
| `sideEffects.deprecated` | New deprecated revisions of original SROs |
| `sideEffects.deleted` | No objects are hard-deleted by this workflow |
| `warnings` | Non-fatal skips, such as duplicate SROs or hierarchy transfers |

API clients should inspect the envelope and warnings. A successful request does
not mean every original edge was copied: hierarchy and duplicate rules still apply.

### Errors and recovery

| Response | Meaning / next action |
|---|---|
| `400` | Missing/invalid input, self-revocation, hierarchy constraint, or proposed writes rejected by schema validation |
| `404` | A or an appropriate same-type B cannot be found |
| `409 invalid_replacement` | B is inactive or the supplied timestamp is not its latest revision; refresh B |
| `409 inactive_referrer` | Embedded preservation would require revising an inactive source; review that source explicitly |
| `409 embedded_reference_conflict` | B has an incompatible single-reference value; resolve the conflict rather than overwriting it |
| `409 inactive_reference` | A proposed new domain reference or active ordinary SRO would involve an inactive target/endpoint |
| `409 graph_write_conflict` | Another worker owns graph-write exclusion; refresh/retry after it completes, or ask an operator to investigate a crashed writer |
| `409` for an already-revoked original | A cannot be revoked again |
| Unexpected persistence/service error | Inspect A, B, and affected revisions before retrying; some planned writes may have persisted |

Preflight protects against expected validation failures, but it cannot roll back
an unexpected database failure. Since the backend writes side effects before A's
revoked revision, a failed request may leave migrated references or retired SROs
while A is still active. A later failure can also occur after A was saved. Do not
assume an error means that nothing changed, and do not manually delete history as
recovery. A crashed writer's lock requires the documented
[operator recovery procedure](../admin/configuration.md#stix-graph-write-exclusion).

## Ongoing reference restrictions and scope

After retirement, authoring new domain embedded references requires an existing
active target. Creating an active ordinary SRO requires active endpoints.
`revoked-by` is exempt from that inactivity restriction because it records a
replacement involving a revoked object; schema and existence checks still apply.

Unchanged legacy embedded references may remain on unrelated revisions. Adding a
new occurrence or changing a reference-bearing record is checked. Collection
imports use their separate source-fidelity contract: importing `revoked: true`
is not a call to this workflow, does not automatically migrate existing local
references, and is not silently filtered by these authoring rules.

For the distinct orphan-first rule, its frontend ordering, and the reasons the
old deprecation exemptions/cascade were removed, see
[Deprecating objects](deprecation-workflow.md).
