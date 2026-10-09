# Operation exemption report contracts

The existing HTTP `validation-operation-service` context installs a report
collector only for explicit reporting requests. The collector receives
`{data, result, snapshot, phase}` from actual evaluations. It immediately copies
revision identity and matching rule identities/names/statuses, deduplicating
`(stix.id, stix.modified, ruleId)`. Preflight/evaluation visits share the operation's
proposed timestamps. The collector normalizes usable string/Date timestamps to ISO
and represents absent or unusable timestamps as null without mutating input.
Collection runs after evaluation and before error propagation, so malformed revision
identities must not throw and replace the original ADM error or exemption result.
An evaluation phase replaces its preflight duplicate. No
report code reevaluates revisions or passes selectors to the evaluator/publisher.

Revocation passes its internal preflight phase through lifecycle creation with the
symbol-keyed `lifecycle.VALIDATION_PHASE` option. Ordinary HTTP `dryRun` creation
still records an evaluation. Related and primary revisions keep their planned
identities for actual writes, whose evaluations replace preflight visits.
Subtechnique-to-technique conversion carries planned hierarchy retirement
timestamps in the `hierarchyRetirements` event payload so relationship persistence
and preflight refer to the same revision.

The route boundary validates selectors against the captured snapshot before core
work. `validation-report-middleware` augments JSON/send success and global or
controller-local error responses, preserving statuses. Authentication/authorization
failures do not create reports. Original array/primitive responses use a `result`
envelope; object responses keep their existing fields plus `exemptionReport`.
Configuration 204 responses use compact headers; streaming imports add the field
to their original terminal SSE event. See the [HTTP contract](../user/validation-reports.md).

Successful `requireRole` stores its original allowed user/service role lists in
request metadata. A retained report copies them. GET authenticates first, verifies
owner or human administrator, then invokes the same role middleware against the
current human role/current service configuration. Service realm identities are
basic API key, challenge API key or OIDC client plus configured JWKS URI; human
identity includes userAccountId and strategy, or OIDC issuer URI. Credentials are
never stored in a report.

`validationReports` stores operation metadata, owner, original role lists,
immutable exemption-rule snapshot, completion state, unfiltered visited scope and
expiry. `validationReportApplications` stores one compact row per deduplicated
matched application, with report-local order and expiry. Rows are inserted in
batches of 500. Metadata is `building` until all rows are persisted; only completed
or partial reports can be retrieved. Insertion failures best-effort remove rows
and metadata; TTL indexes clean up leftovers. Report retention is 24 hours and
explicit wall-clock checks precede retrieval, independent of the TTL monitor.

A separate `validationReportKeys` singleton holds one random 256-bit secret,
atomically inserted on first report use. It is independent of policy, sessions and
TTL retention. AES-GCM authenticated opaque report IDs contain internal UUID,
owner, original permissions and expiry claims. Verified claims permit owner/role
checks and explicit 410 responses even after TTL deletes report metadata. HMAC
cursors bind public report ID, canonical sorted selectors and offset. Key storage
survives API restarts, including instances with randomly generated session defaults;
sharing the database shares the key. Removing/replacing that singleton and restarting API processes invalidates
old identifiers/cursors. Do not expose or log it.

Summary requests normally do not persist reports. Details always retain all
matching applications before filtering, including single writes and failures.
Bodyless 204 summary requests also retain details so per-rule evidence remains
available. `evaluatedScope` counts unique visited revisions and their final observed
outcomes and records preflight-only visits separately. It does not enumerate
unvisited input or certify rollback. Display `partial` without assuming no writes.

Report filters run before summary aggregation and detail pagination. Database
queries count distinct revision pairs separately from application counts, and
sort details by captured order. Filters never recompute matching. Unknown rule
selectors validate against original snapshot identities, allowing deleted/renamed
rules from the operation to remain selectable. Detail pages are bounded 50 by
default and 100 maximum; summary per-rule lists reflect all selected rules.

The operation retains lightweight revision/application maps until response
finalization; memory grows with visited scope. Persisted rows avoid MongoDB's
single-document limit for bulk details. Policy bounds still apply to captured
rule snapshots. Report retention/paging adds database operations only to opt-in
requests. Unexpected process termination before finalization can leave no report;
reporting does not add transaction rollback or crash-resume semantics to primary
writes. Core reconciliation recovery remains independent.
