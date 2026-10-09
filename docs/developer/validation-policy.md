# Canonical validation policy

`ValidationPolicy` is a singleton in `validationPolicies`, with `_id` equal to
`validation-policy`. It owns embedded rules, the current policy revision,
evaluation generation, active engine identity, and durable reconciliation intent.
Embedded rule IDs are BSON ObjectIds and remain stable across edits. The legacy
`validationbypassrules` collection is used only before initialization.

## Rule mutation and cutover

The validation-bypasses repository is the compatibility facade. It reads the
singleton when present and routes every rule write through `mutateRules` in the
policy repository. That method validates the complete rule set, compares the
observed revision and generation, and atomically replaces rules while advancing
both counters and setting reconciliation to `pending`. A conflicting write retries
against the latest state, preserving concurrent edits. Exact no-op mutations do
not advance either counter. Duplicate normalized selectors return the existing
409 error; invalid contracts or size limits return 400. After 100 conflicting
attempts, mutation raises a typed database error; the HTTP 500 JSON response
preserves retry guidance in `details`.

The document is limited to 8 MiB and 10,000 rules. Reconciliation control data must
remain bounded; per-revision results and operation reports belong outside this
document. Its `publication_sequence` allocates ordered diagnostic publication
tokens independently of rule edits.

`replaceGeneratedGroup(reason, rules)` atomically replaces one auto-created rule
group, retaining IDs for unchanged selectors. Namespace and organization identity
listeners use this operation. Existing manually managed selectors take precedence
over generated replacements. Static file seeding upserts selectors and leaves
existing payloads untouched.

`20261008000000-initialize-validation-policy.js` runs after all historical legacy
rule migrations. It copies their final rules and IDs, adds the two retirement
defaults, and atomically inserts the destination singleton. Historical seeding and
service imports never initialize it. Restart and migration retries never recopy
legacy rows or restore removed defaults. `checkSystemConfiguration` initializes
fresh test/runtime databases before normal application use.

## Evaluation interfaces

`app/services/system/validation-policy-service.js` exports:

- `initialize({ db?, ObjectId?, activateEngine = false })`: initialize absent
  storage, otherwise verify the active engine. Explicit activation updates the
  engine and advances generation once without changing policy revision.
- `loadSnapshot()`: load an isolated, recursively frozen JSON snapshot; fail if
  initialization is missing or the active engine differs from this process.
- `readEngineContext()`: return `{ adm_version, attack_spec_version,
evaluator_version }` for the installed package and implementation.
- `evaluateObject(data, snapshot, { enabled = true })`: synchronous pure ADM
  evaluation, also exported by `app/lib/adm-validation.js`.

Snapshots contain `rules`, `policy_revision`, `evaluation_generation`, and
`engine_context`. Their IDs are strings. Every logical operation acquires
one snapshot and retains it throughout evaluation of its revisions. Legacy
migration callers operate before singleton initialization and must explicitly
use the legacy rules path; normal runtime callers must not silently substitute
legacy policy when snapshot loading fails.

Evaluation returns `{ outcome, errors, warnings, matchingExemptions }`. Outcomes
are `valid`, `invalid`, `exempt`, `disabled`, or `unsupported`. Matching exemptions
are `{ id, name, retirementStatus }`; an exempt result is not ADM conformance.
The evaluator first honors operation enablement, then matches enabled exemptions
against actual Boolean retirement flags and type scope, then selects the current
full or WIP partial schema. Dates are serialized in an isolated copy. Field/code/
type error bypass matching occurs only after parsing, preserving warnings and
suppression. The evaluator performs no persistence or event emission.

## Reconciliation control contract

The singleton stores `defaults_seeded`, `policy_revision`,
`evaluation_generation`, `engine_context`, `publication_sequence`, and
`reconciliation`. The reconciliation object stores:

- `status`: pending, running, completed, failed, or superseded;
- `desired_policy_revision`, `desired_generation`, `desired_engine_context`;
- `counts`: scanned, valid, invalid, exempt, disabled, unsupported;
- `checkpoint`, `claim_token`, `owner`, `lease_expires_at`, `publication_token`;
- `error`, `requested_at`, `started_at`, `completed_at`.

Rule changes and explicit engine activation reset progress, claims, errors, and
checkpoints while preserving the global publication sequence. The repository's
`contextFilter(snapshot)` supplies the current revision/generation/engine fence.
`allocatePublicationToken(snapshot)` increments that sequence only for a current
context, returning null for a stale context. Workers must additionally fence
claim/checkpoint/completion writes by claim token and lease ownership; allocating
a publication token alone is not a worker claim or publication authorization.

For the stopped-writer cutover and runnable activation command, see the
[upgrade procedure](../admin/configuration.md#validation-policy-storage-and-upgrades).
Only the designated initializer may activate a changed engine. Ordinary startup,
snapshot loading, and rule mutation verify the active context, so an older binary
cannot silently activate itself. Increment `evaluator_version` whenever schema
selection, matching, or evaluation semantics change independently of ADM/spec
versions.

## Operation and report collection boundary

`validation-operation-service.run(callback, { snapshot?, collector? })` starts an
AsyncLocalStorage scope. Nested calls reuse it. `current()` returns the immutable
`snapshot`, allocated `publicationToken`, and optional `collector`. The HTTP router,
graph write lock, BaseService entry points, bulk importer, and release services
establish boundaries before revision evaluation. Explicit worker snapshots cannot
be silently replaced if superseded. Missing canonical storage and engine mismatch
fail normal runtime operations.

BaseService `validateComposedObject` returns the evaluator's `outcome`, `errors`,
`warnings`, and `matchingExemptions`, plus `context`. It awaits the operation
collector with `{ data, result, snapshot, phase }` for every evaluated revision, including
rejected revisions and preflight evaluations. The HTTP report middleware installs
`current().collector` before invoking services; it must deduplicate repeated
preflight/save evaluations by exact revision when counting distinct revisions.
`phase` is `preflight` or `evaluation`; tactic and identity propagation reuse the
same proposed modification timestamp for both visits.
Collectors do not alter eligibility. The separate report middleware and service
implement the [report HTTP API](../user/validation-reports.md).

Historical migrations explicitly use `runLegacyMigration(callback)`. Only that
scope permits a missing singleton to load legacy rules; it carries no canonical
publication authority. This never permits an engine mismatch fallback.

## Persistence boundary

The operation service establishes snapshots and stores the active context through
the service-independent `app/lib/validation-operation-context.js`. Repositories
read that context to persist prepared results without calling validation services.
`BaseService.markRevisionsReviewed` evaluates proposed reviewed revisions and
orchestrates publication; repositories only retrieve revisions and save results.
`assertNoAdmErrors` in `app/lib/adm-validation.js` provides the common ADM rejection
contract while callers retain their evaluation phases and import behavior.

`validation-policy-repository` owns conditional reconciliation claims, lease
renewals, checkpoints, completion, failure, retry and recovery-intent writes.
`validation-diagnostics-repository` owns bounded revision scans and guarded
diagnostic publication. The reconciliation service decides which work to run,
evaluates revisions, and handles retry/stop orchestration through those repository
operations; it does not construct Mongo queries.

## Durable worker lifecycle

Production starts `validation-reconciliation-service.start()` after migration and
system initialization, independently of `ENABLE_SCHEDULER`, and awaits `stop()`
during shutdown. Importing the worker or periodic validation module creates no
background jobs. The scheduler explicitly starts its validation task.

The worker claims pending or expired running intent with a UUID ownership token,
a 30-second lease, and a new canonical publication sequence. It scans both
`attackObjects` and `relationships`, including historical revisions, in batches of
100 ordered by `_id`. A heartbeat renews ownership every 10 seconds, including
while initial counting, batch reads or diagnostic publication await MongoDB.
Renewals are serialized with explicit scan renewals; renewal errors enter the
worker failure path, and a replaced claim stops further work. The heartbeat is
cleared and any in-flight renewal awaited whenever processing exits. Checkpoints
contain collection index and last object ID;
counts and checkpoints commit only while the same context, claim, and lease remain
current. An input changed during publication is reloaded and reevaluated. A newer
per-document publication is retained. Rule/context changes supersede the old claim
and reset the new intent to a full scan. The singleton retains only the newest
intent; superseded claim processors return `status: superseded` without replacing
that intent.

`claim`, `processClaim`, and `runOnce` expose deterministic worker entry points for
tests and operational integration. Failures store a bounded error and checkpoint;
`retry()` changes failed work to pending without discarding completed checkpoints.
`status()` reports policy revision, generation, counts, checkpoint, last error,
and processed/total progress without exposing owner or claim credentials. Totals
are estimated during an active scan and finalized to processed revisions at
completion. `stop()` finishes the current bounded batch; a later process can resume
the retained checkpoint after lease expiry.

New revisions atomically persist an internal `workspace.evaluation_needed` flag
with their content. Guarded diagnostic publication clears it. The worker checks
these indexed flags after a scan completes and reopens a full scan when necessary,
so an interrupted insert publication or an older operation inserting behind a
checkpoint remains recoverable after restart even with the scheduler disabled.
Clients cannot set this flag, and HTTP projections omit it.

## Recursive validation failures

Conversion preflights both its primary and required hierarchy retirement under the
same snapshot before primary persistence. Dedicated revocation likewise preflights
its primary and related revisions. Tactic shortname and organization identity
propagation preflight every proposed dependent revision before saving the primary
tactic or configuration. Preflight and persistence hold the graph write lock and
reuse the operation snapshot and proposed timestamps. A deterministic ADM failure
therefore leaves the primary and dependents unchanged; repairing the dependent and
retrying the same ordinary request completes propagation. Identity propagation
preserves concrete model discriminators so revision timestamps and type-specific
STIX fields survive persistence through the heterogeneous repository. Their opted-in
`EventBus.emitValidationRequired` dispatch propagates ADM `ValidationError` to the
caller while preserving other event failure behavior. Propagation remains a
multi-document operation; unrelated persistence or event failures retain their
existing handling and can leave partial state.

## Optional operation reports

[Validation report contracts](validation-reports.md) document the collector,
separate storage, retained authorization, bounded pagination and failure handling.
The report layer consumes existing operation evaluations and keeps presentation
selectors separate from enforcement.
