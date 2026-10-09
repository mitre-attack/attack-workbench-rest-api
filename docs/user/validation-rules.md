# Validation rule contracts

The `/api/config/validation-bypasses` collection manages two rule kinds.
Existing `error-bypass` rules match an exact ADM issue path, code, and STIX type
(or `all`). They suppress matching errors or convert them to the configured
warning. Requests without `kind` keep this interpretation, and omitted
`suppressError` defaults to true.

An `object-exemption` describes an entire retired revision:

```json
{
  "kind": "object-exemption",
  "name": "Deprecated software",
  "enabled": true,
  "retirementStatus": "deprecated",
  "stixTypes": ["malware", "tool"]
}
```

New and upgraded instances seed two enabled all-type defaults, one for revoked
revisions and one for deprecated revisions. Each rule is independent. Restart
does not re-enable disabled defaults or recreate deleted ones.

Names can change without changing rule identity. `stixTypes` may also be `all`.
Lists must contain supported types and at least one item; repeated types are
removed and stored in sorted order. Two exemption rules cannot have the same
normalized retirement-status/type selector. Rules with different scopes may
overlap. Exemptions do not accept error path, code, suppression, or warning fields.

The policy evaluator matches a revision's actual Boolean `revoked` or
`x_mitre_deprecated` flag. Either matching enabled rule grants exemption;
disabled rules do not negate matches. An active revision restored from retired
content is evaluated normally. A retired object type alone is insufficient.
Exemption means that ADM is skipped, not that the content conforms to ADM.
Request, reference, persistence, and authorization checks retain their own rules.

Creation returns 201, replacement returns 200, deletion returns 204, missing rule
IDs return 404, invalid requests return 400, and duplicate selectors return 409.
The list endpoint retains `offset`, `limit`, and `includePagination`. Writes
require administrator access; existing read permissions remain unchanged.

Policy edits take effect for subsequent operations immediately. A logical operation
keeps its starting policy through its entire import, review, or lifecycle workflow.
Current diagnostics on existing revisions are refreshed asynchronously; earlier
import reports, review decisions, and published release content are preserved.
If concurrent policy edits exhaust the server's retries, the rule write returns
HTTP 500 with JSON `details` explaining that the operation can be retried.

Administrators can read `GET /api/config/validation-bypasses/reconciliation` for
`status`, `policy_revision`, `generation`, outcome `counts`, `checkpoint`,
`last_error`, and `progress` (`processed`, `total`). The total is initially unknown
and is an estimate while scanning. `POST /api/config/validation-bypasses/reconciliation/retry`
requeues a failed scan from its checkpoint. Repeated retry on work that is already
pending, running, or completed leaves that work unchanged. Both endpoints require
an administrator; unauthenticated or insufficient-role requests return 401.

Optional [exemption reports](validation-reports.md) explain actual matching rules
from a write, import, dry run or release operation's immutable snapshot. Report
filters select evidence only and never change which rules enforce the policy.

## Administration examples

Using an authenticated administrator session, list the rules and create a selected
type exemption. `cookies.txt` represents your existing session cookie jar.

```sh
curl -b cookies.txt \
  'http://localhost:3000/api/config/validation-bypasses?includePagination=true&limit=50&offset=0'
curl -b cookies.txt -H 'Content-Type: application/json' \
  --data '{"kind":"object-exemption","name":"Deprecated software","enabled":true,"retirementStatus":"deprecated","stixTypes":["malware","tool"]}' \
  'http://localhost:3000/api/config/validation-bypasses'
```

Use the returned rule `_id` in the item URL. PUT replaces that rule; send its whole
editable payload. For example, disable the selected rule while preserving its scope:

```http
PUT /api/config/validation-bypasses/0123456789abcdef01234567
Content-Type: application/json

{"kind":"object-exemption","name":"Deprecated software","enabled":false,"retirementStatus":"deprecated","stixTypes":["malware","tool"]}
```

`DELETE /api/config/validation-bypasses/0123456789abcdef01234567` removes the rule.
The ID above is illustrative. Disabling the selected software rule still leaves
software exempt if the default all-type deprecated rule remains enabled. Remove or
narrow every applicable enabled exemption to restore the ordinary ADM gate.
Legacy clients can continue sending error-bypass payloads without `kind`.

In the frontend's Validation Bypasses page, choose the rule kind, readable name,
enabled state, retirement flag and either All types or named type choices. Error
path/code and warning fields apply only to error bypasses. Reconciliation status
and retry show historical cleanup progress separately from the saved policy.

Validation dialogs show optional evidence in a collapsed **ADM validation details**
section. Matching explanations are not warnings, badges or Save blockers. Expansion
filters/pages the retained operation report instead of repeating validation; actual
save/publication has its own current policy snapshot and evidence. Frontend name,
citation and reference checks continue to apply, as do backend lifecycle guards.
