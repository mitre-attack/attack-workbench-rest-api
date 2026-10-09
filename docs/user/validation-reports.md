# Optional ADM exemption reports

Object writes, dry-run previews, lifecycle/revoke/conversion workflows, collection
imports, release-track writes and release previews accept `exemptionReport=summary`
or `exemptionReport=details`. Ordinary requests retain their existing response and
warning behavior. Release previews evaluate proposed members without changing
stored workflow or diagnostics; their reports identify visits as `preflight`. ADM
failures return 400 with partial evidence for every preview format, with or without
reporting enabled. Exemption reporting explains why ADM was skipped; it does not
establish conformance and does not change enforcement.

| Parameter           | Meaning                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `exemptionReport`   | `summary` or `details`; omit for an ordinary response                                       |
| `exemptionStatuses` | Comma-separated `revoked`, `deprecated`, or both                                            |
| `exemptionRuleIds`  | Comma-separated stable ObjectIds of object exemption rules in the captured operation policy |
| `exemptionLimit`    | Positive detail page size, default 50, maximum 100                                          |

Select rule IDs/names through the existing validation-bypasses API. Status and rule
filters intersect. Filters select matching applications before counting; they never
remove rules from enforcement. Unknown IDs, categories, malformed values and
filters supplied without `exemptionReport` return 400 before the operation starts.
No report parameters are accepted on STIX bundle exports.

An object response gains an `exemptionReport` field outside `stix` and `workspace`.
An original array, string or other primitive is returned as
`{ "result": <original response>, "exemptionReport": <report> }` when reporting is
requested. Existing HTTP status codes remain unchanged, including errors. A malformed
`stix.modified` value rejected by ADM still returns the original 400 validation
error with either report mode; reporting does not repair the input or make it valid.

```json
{
  "policyRevision": 12,
  "state": "completed",
  "evaluatedScope": {
    "revisions": 1,
    "byOutcome": { "exempt": 1 },
    "preflightOnlyRevisions": 0
  },
  "filters": { "statuses": ["deprecated"], "ruleIds": [] },
  "reportedExemptRevisions": 1,
  "ruleApplications": 1,
  "byRule": [
    {
      "ruleId": "0123456789abcdef01234567",
      "ruleName": "Deprecated objects",
      "retirementStatus": "deprecated",
      "count": 1
    }
  ],
  "byStatus": { "revoked": 0, "deprecated": 1 }
}
```

`reportedExemptRevisions` counts distinct selected `(id, modified)` revisions.
`ruleApplications`, per-rule counts and per-status counts count matching rule
applications. A revision with both retirement flags can match several rules; it is
counted once as a revision and separately for each matching rule. Zero selected
matches says nothing about ADM conformance. `evaluatedScope` describes visited
revisions independently of reporting filters; it includes valid, invalid, exempt,
disabled and unsupported outcomes as observed.

Details requested on the original operation retain all matched applications for
24 hours, even when the initial filter selected none. They add `availability`,
`reportId`, `expiresAt`, `details`, `nextCursor`, `hasMore` and `truncated`. Each detail
has `object_ref`, `object_modified` (null when the timestamp is absent or unusable), `ruleId`,
`ruleName`, `retirementStatus` and `phase` (`preflight` or `evaluation`). Duplicate
preflight and evaluation visits to the same revision/rule occupy one detail;
evaluation replaces the preflight phase. A preflight detail can identify a proposed
revision timestamp; phase describes the evaluation visit and does not prove
whether that revision was persisted. Rule names and IDs come from the original
snapshot and survive later renames/deletions.

Use `GET /api/validation-reports/{reportId}` to filter or continue retained details.
This request inherently requests reporting and does not take `exemptionReport`.
It accepts `exemptionStatuses`, `exemptionRuleIds`, `exemptionLimit` and
`exemptionCursor`. Omit selectors to see all captured matches. Repeat the same
selectors when passing `nextCursor`; changing selectors requires starting a new
first page. Cursor contents are opaque and authenticated. Malformed, altered,
cross-report or different-filter cursors return 400. Page size may change between
pages. `hasMore` and `truncated` mean more selected applications remain after this
page; `nextCursor` is null at the end.

Access requires the initiating human/service principal or a human administrator,
plus current permission for the original operation. Services also need their
current configured role. Basic API keys, challenge API keys and OIDC service
clients occupy separate authentication realms. An ID alone grants no access.
Authentication/current-permission failures return 401, another owner returns 403,
invalid/unavailable reports return 404, and expired reports return 410. Expiry is
checked against wall-clock time even after database TTL cleanup.

`completed` means the HTTP operation completed. Dry runs can be completed without
saving anything. Failed operations show `partial`, including visits performed
before failure; they never claim that unvisited revisions were evaluated or that
persistent changes were rolled back. Imports can preserve some writes on an
unexpected failure. Existing `workspace.import_categories` history is unchanged.

If optional report retention fails, the actual object/import result and status are
preserved. Details return `availability: "unavailable"`, `reportId: null`,
`expiresAt: null` and an explanatory `availabilityMessage`, with the bounded inline
detail page where available. `hasMore`/`truncated` may still be true, but a null
cursor means continuation is unavailable. Successful core writes remain successful.

Organization identity/namespace changes keep their existing 204 response. Opt-in
summary and details are both retained and returned through compact headers:
`X-Validation-Report-Id`, `X-Validation-Report-Availability`,
`X-Validation-Report-State`, `X-Validation-Report-Policy-Revision`,
`X-Validation-Report-Exempt-Revisions` and `X-Validation-Report-Rule-Applications`.
The ID header is absent when unavailable. Fetch the retained report for readable
per-rule counts and details. Clients such as Angular should observe the full HTTP
response to read these headers. The API exposes these names through CORS for
opt-in 204 responses.

Streaming collection imports keep the SSE progress protocol. Opt-in reporting
adds `exemptionReport` to the original terminal `complete` or `error` event's JSON
data. Progress and heartbeat events remain unchanged, and HTTP 200 remains the
stream transport status; the terminal event determines import success or failure.

## Retrieve retained evidence

Use the `reportId` returned by the original operation and the same authenticated
principal. For example, the first page of deprecated-rule matches is:

```http
GET /api/validation-reports/RETURNED_REPORT_ID?exemptionStatuses=deprecated&exemptionLimit=25
```

Use the returned `nextCursor` on the next request, URL-encoding it and keeping the
same selectors:

```http
GET /api/validation-reports/RETURNED_REPORT_ID?exemptionStatuses=deprecated&exemptionLimit=25&exemptionCursor=RETURNED_CURSOR
```

The placeholders represent opaque returned values. To change to a specific rule,
start again without a cursor and add `exemptionRuleIds=RULE_OBJECT_ID`; combine it
with `exemptionStatuses` only to intersect those choices. Fetching this endpoint
never reevaluates the original revision or changes its policy. A partial preview
report can be retained after the preview fails; subsequent actual save or release
publication returns separate evidence under its own snapshot.

A rare report-finalization failure may return only `availability` and
`availabilityMessage`, without counts or details. Treat missing evidence as
unavailable, not as zero matches or an ADM pass.
