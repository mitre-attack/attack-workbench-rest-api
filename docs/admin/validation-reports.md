# Validation report retention

Optional ADM exemption details are stored separately in `validationReports` and
`validationReportApplications`, with TTL indexes on `expiresAt`. Reports expire
24 hours after completion. Retrieval enforces expiry immediately even if MongoDB
has not swept expired rows. The two collections can be inspected for storage
usage; deleting them removes report evidence without changing ATT&CK content,
import history, diagnostics, workflow or release membership.

The separate `validationReportKeys` singleton holds the cryptographic key for
opaque report IDs and cursors. Preserve it with database backups and restrict
access as with other instance secrets. It has no TTL and must not be included in
API responses. Restarting the API or changing the session secret does not alter
this key. Removing it and restarting the API invalidates report URLs and continuation
cursors.

Retained-report access uses original operation permissions and current identity
and service-role configuration. Removing service credentials or downgrading a
service role removes its report access. The same service name in Basic and
challenge API-key configurations represents different report owners. OIDC realms
include configured identity-provider URLs.

A report-storage failure does not reverse successful object/config/import writes.
Opt-in responses explicitly show retention as unavailable. Ordinary operations do
not persist reports. See [request parameters, response contracts and failure
states](../user/validation-reports.md).
