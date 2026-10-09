# Configurable ADM validation architecture

This document describes the implemented architecture for [ADR 0001](../adr/0001-configurable-retired-object-adm-exemptions.md).
It describes repository behavior; deployment and database cutover remain operator
steps. The [glossary](../../GLOSSARY.md) defines the shared domain terms.

## Responsibilities and contracts

| Responsibility                  | Implementation                                                          | Contract                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Policy ownership                | `validation-policy-model`, repository, and service                      | [Canonical policy](validation-policy.md)                                                  |
| Compatible rule API             | Existing validation-bypasses repository, service, controller and routes | [Validation rules](../user/validation-rules.md)                                           |
| Pure ADM evaluation             | `app/lib/adm-validation.js`                                             | [Evaluation interfaces](validation-policy.md#evaluation-interfaces)                       |
| One operation snapshot          | `validation-operation-service` and HTTP/service boundaries              | [Operation boundary](validation-policy.md#operation-and-report-collection-boundary)       |
| Current diagnostics             | `validation-diagnostic-service` and repository publication              | [Workspace diagnostics](workspace-validation.md)                                          |
| Durable reevaluation            | `validation-reconciliation-service` and canonical intent                | [Worker lifecycle](validation-policy.md#durable-worker-lifecycle)                         |
| Optional evidence               | Report middleware, collector, service and separate collections          | [Report internals](validation-reports.md), [HTTP contract](../user/validation-reports.md) |
| Administration and presentation | Frontend Validation Bypasses page and shared ADM details component      | [Rules and UI](../user/validation-rules.md)                                               |

Rule enforcement, diagnostic publication, reporting and background scheduling are
separate responsibilities. Reporting filters cannot change which exemptions apply.

## Eligibility and operation boundaries

The API retains legacy error-bypass payloads, IDs, exact type/path/code matching,
error suppression, warnings and generated-rule metadata. Object exemptions are a
second rule kind with independent revoked/deprecated status and all/selected STIX
type scopes. Two enabled all-type defaults are seeded once. Any enabled matching
rule exempts the revision; disabling or deleting one rule cannot cancel another
match. A restored active revision undergoes ordinary ADM evaluation regardless of
historical retired revisions. Deprecation of a STIX type does not retire its objects.

An enabled evaluation first checks exemptions, then applies full or WIP partial ADM
schemas and existing error bypasses. Results distinguish `valid`, `invalid`,
`exempt`, `disabled` and `unsupported`. Only `valid` asserts an ADM pass.
Request ADM validation defaults to enabled and is independent of legacy OpenAPI
validation. Reconciliation and periodic validation explicitly enable ADM regardless
of the request switch; the periodic task alone depends on `ENABLE_SCHEDULER`.

The HTTP router, graph lock and service entry points establish an AsyncLocalStorage
operation context. Nested lifecycle writes, propagation, imports, review and release
work reuse its frozen snapshot and ordered publication token. Rule edits affect the
next operation, not the remainder of an operation already evaluating revisions.
Preview and actual save/publication are separate operations with separate evidence.

Revoke and hierarchy conversion preflight primary and related revisions before
side effects. Tactic and identity propagation preflight their proposed dependents
under the graph lock with the same proposed revision timestamps used for saving.
Deterministic ADM failures therefore precede primary writes. These operations are
still multi-document workflows: unrelated persistence/event failures can leave
partial effects. Authorization, request/model validation, reference and lifecycle
guards, revision immutability, frontend citation/name checks and import compatibility
remain independently enforced.

## Storage, upgrades and recovery

A canonical singleton embeds rules, revision, evaluation generation, active engine
identity, publication sequence and newest reconciliation intent. Compare-and-set
rule mutation atomically saves policy and requests reevaluation, including generated
group replacements. This supports standalone MongoDB without transactions. Default
seeding does not recreate deleted defaults or undo administrator edits on restart.

Historical migrations explicitly use legacy storage before the final policy
migration copies rules and IDs. The canonical document is authoritative afterward;
there is no two-way legacy synchronization. Stop all old writers and use one
designated upgrader. Engine changes also require explicit activation after older
workers stop. Ordinary startup verifies the active engine and refuses a mismatch.
The [operator procedure](../admin/configuration.md#validation-policy-storage-and-upgrades)
covers both boundaries; mixed old/new storage or validation-engine deployments are
unsupported.

Startup connects the database, runs migrations, updates views and system
configuration, then starts reconciliation before the HTTP server and periodic
scheduler. Shutdown awaits worker stop. The durable worker scans all object and
relationship revisions in bounded batches, renewing its lease and checkpointing.
Edits or engine activation supersede old intent and request a full scan. Failures
retain progress for explicit retry. Recovery flags written with new content also
recover interrupted diagnostic publication and late inserts after a completed scan.

Guarded publication fences policy, generation, engine, claim ownership where
applicable, publication order, observed STIX and workflow. Errors and successful
clears share the same guard. Read projections hide obsolete diagnostics. Current
ADM diagnostics and server-owned evaluation metadata never change source STIX,
historical import reports, past review decisions or published release manifests.
Future operations evaluate under their own current snapshot.

## Quiet reporting and frontend behavior

Consumers explicitly request summary or details on the original operation. The
collector observes actual evaluations, including failures, and deduplicates exact
revision/rule applications. Status and rule filters intersect before counts and
pagination. A revision matching both retirement categories counts once as a
revision and separately for each matching rule. Zero selected matches does not
establish conformance. Details retain the original rule names and IDs after edits.

Details are retained for 24 hours with authenticated pagination. Access requires
original-operation permission and the initiating principal or human administrator;
current service credentials/roles still apply. Ordinary requests remain quiet.
Configuration 204 responses expose bounded report headers, while streaming imports
attach evidence to their original terminal SSE event. Optional storage failures
preserve the actual core result and identify report availability limits.

The admin form separates exemption fields from error-bypass fields, offers readable
type choices and all-type scope, and shows durable progress/retry. The collapsed ADM
validation details section keeps notices out of errors, warnings, badges and Save
gates. Expansion, filtering and paging use retained evidence without another dry
run. Preview failures keep their partial reports. Actual saves, imports and release
publication capture their own results, replacing or separating earlier preview
reports as appropriate. Successful object saves retain existing dialog completion;
a completed save does not keep a dialog open merely to show exemption evidence.

## Implementation choices relative to the original proposal

- Rule mutation uses internal compare-and-set retries. There is no public revision
  precondition field or optimistic concurrency token for administrators; concurrent
  replacement of the same rule follows ordinary replacement semantics.
- Reconciliation stores the newest intent only. An old processor can return
  `superseded`, but there is no durable list of superseded jobs or separate
  automation-run audit history for validation reconciliation.
- Every details request retains evidence, including single writes and failures.
  Bodyless 204 summary requests also retain evidence so clients can fetch it.
- Reports keep lightweight maps until response finalization, so memory grows with
  visited scope. Separate application rows avoid MongoDB's per-document size limit.
  Reports do not provide crash recovery or rollback for the original operation.
- Reports may be unavailable or partial; a rare finalization failure returns only
  availability information. Consumers tolerate absent count/detail fields.

The focused behavioral suites cover policy migration, legacy clients, runtime
publication/recovery, lifecycle/import/release integration, retained report access
and frontend evidence handling. See repository test scripts for runnable checks;
verification results belong in implementation reports rather than this contract.
