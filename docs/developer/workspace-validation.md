# Current ADM diagnostics

`workspace.validation` contains unresolved ADM errors only. Its absence does not
assert schema conformance: a revision may be exempt, request validation may be
disabled, or its schema may be unsupported. The independent server-controlled
`workspace.evaluation_context` records the outcome and the authority of that
result. Both fields, and the internal recovery flag described below, are stripped
from POST, PUT, and imported client input.

The shared evaluator uses one immutable policy snapshot throughout a logical
operation, including recursive lifecycle writes, bulk imports, and release review.
It honors request ADM enablement, matches enabled object exemptions, and then
applies full or WIP partial ADM schemas and error bypass rules. Periodic validation
and durable policy reconciliation always enable ADM evaluation independently of
the request toggle. See [validation policy](validation-policy.md).

## Stored fields

`workspace.validation` contains `errors` (complete message, path, and code),
`attack_spec_version`, `adm_version`, and `validated_at`. It is written only for
an invalid result. All other outcomes clear these current errors.

`workspace.evaluation_context` contains:

- `policy_revision`, `evaluation_generation`, and `engine_context` (ADM, ATT&CK
  spec, and evaluator versions);
- `workflow_state` and `schema_mode` (`partial` or `full`);
- globally ordered `publication_token`;
- `outcome`: `valid`, `invalid`, `exempt`, `disabled`, or `unsupported`.

Metadata never enters STIX or exported bundles. Reconciliation preserves workflow
review decisions, release manifests, and historical `workspace.import_categories`.

## Guarded publication

`validation-diagnostic-service` owns diagnostic stamping and read projections.
Pure marker/error serialization lives in `app/lib/validation-diagnostics.js`.
Publication delegates to `validation-diagnostics-repository`, which verifies the
active canonical context and, for workers, live claim ownership. Its atomic
document update compares the full
observed STIX and workflow with stored input and refuses to replace a larger
publication token. Both error writes and successful clears use these checks.
Metadata PUT and release review combine workspace changes with this guarded
update. New revision and bulk insert paths strip prepared diagnostics before
insertion and publish them through the same guard afterward. A concurrent newer
publisher wins; responses read its actual stored diagnostics.

Inserts persist an internal `workspace.evaluation_needed` flag in the content
write. Guarded publication clears it. The worker checks these indexed flags even
after completing a scan and starts another scan when necessary, recovering
interrupted publication and late inserts from superseded operation snapshots
independently of the periodic scheduler. HTTP responses omit this flag.

Before metadata PUT uses the native atomic update, the merged candidate is cast
and validated with its concrete Mongoose model. Workflow enums, schema dates, and
strict field handling remain enforced when ADM exempts the revision or legacy
OpenAPI request validation is disabled.

The evaluator does not normalize or replace persisted STIX. Mongoose documents
and dates are copied to plain ADM input. Full error contents, rather than issue
counts alone, determine whether issues have changed.

HTTP projections omit diagnostics and evaluation markers whose policy, generation,
engine, or workflow no longer matches the operation snapshot. Historical import
reports remain visible as historical evidence. Services implementing additional
report projections can use `validation-diagnostic-service.isCurrent` and `project`.

## Write behavior

Ordinary authoring, metadata updates, review, and release admission reject invalid
ADM results when request validation is enabled. Dedicated revocation preflights
its primary revoked revision before saving any side effects. A default exemption
may permit that revision; deleting the exemption restores the primary ADM gate.
Active restored revisions are evaluated normally.

Imports with `validateContents=true` reject invalid revisions. Fail-open imports
retain the errors both as current diagnostics and in the original import report.
Retirement is governed by configured exemptions on every path; it is not an
unconditional import skip. Removing, disabling or narrowing all applicable exemptions therefore changes
strict import behavior as well as subsequent ordinary operations. An overlapping
enabled rule still grants exemption. Strict mode rejects invalid revisions while
other eligible bundle members can continue importing; it is not a bundle transaction.
Opt-in [operation reports](../user/validation-reports.md) explain matches separately
from current errors and historical import reports.
