# Release-Track Authorization

Release-track access follows the existing Workbench roles. Read operations are
available to visitors and higher. Normal draft workflow operations require an
editor, team lead, or administrator. Deleting an entire track and all of its
history requires an administrator.

## Authorization matrix

| Capability                                                            | Visitor | Editor / team lead | Administrator |
| --------------------------------------------------------------------- | ------: | -----------------: | ------------: |
| List tracks, snapshots, candidates, and staged objects                |     Yes |                Yes |           Yes |
| Preview releases and export snapshots                                 |     Yes |                Yes |           Yes |
| Create tracks and drafts; manage candidates/staged/config/composition |      No |                Yes |           Yes |
| Tag a standard or virtual snapshot                                    |      No |                Yes |           Yes |
| Delete the latest untagged draft snapshot                             |      No |                Yes |           Yes |
| Convert the track's most recent release to draft                      |      No |                 No |           Yes |
| Change a tagged release's semantic version                            |      No |                 No |           Yes |
| Delete an entire track and all snapshot history                       |      No |                 No |           Yes |
| Inspect pending/failed virtual draft cleanup                          |     Yes |                Yes |           Yes |
| Configure virtual draft retention                                    |      No |                 No |           Yes |
| Opt into draft squash when tagging or retry draft cleanup              |      No |                 No |           Yes |

Full-track deletion also requires `confirm_track_id` to equal the `:id` path
parameter. `POST /snapshots/:modified/draft` requires a JSON `confirm_version`
equal to the release version and an administrator (service-checked, `403`
otherwise). `DELETE /snapshots/:modified` is draft-only, editor-or-higher;
tagged snapshots always return `409`, including for administrators. Draft
deletion keeps latest/sole-snapshot, preserved-source, and dependency guards.

Release-version correction uses `PUT /snapshots/:modified/release`, is also
checked in the service, and does not require destructive confirmation because
it preserves the snapshot. It is serialized with release and rollback and is
recorded as `retag_release`.

Release conversion re-reads the snapshot and checks `confirm_version` under the
release lock. Both conversion and retag capture audit identity under that same
lock, so a competing version correction cannot invalidate confirmation or
change the version between audit capture and mutation.

Draft retention configuration and explicit squash/retry use the existing global
administrator role; there is no track-specific administrator role. Ordinary
tagging retains editor-or-higher access. Squash authorization and the reviewed
fingerprint are checked before tagging. Automatic retention runs under the
administrator-configured policy and records its system actor.

## Audited destructive actions

The `delete_track`, `convert_release_to_draft`, `retag_release`, `draft_retention`,
and `draft_squash` actions create `releaseTrackAuditEvents` records.
Cleanup actions use bounded durable intent/progress; see
[Deletion Guardrails](deletion-guardrails.md) for the recovery rationale.
The legacy `delete_release` value remains readable for historical audit events;
new requests never use it.

Each event records the authenticated actor, confirmation value, target track,
request summary, timestamps, and a `pending`, `completed`, or `failed` status.
An audit insert failure prevents the destructive operation. If the operation
persists but final audit-state recording fails, the API returns a structured
`500` containing the audit event ID instead of reporting unconditional
success.

Cleanup-only failures after successful creation/release are reported in
`draft_cleanup` without undoing the committed snapshot. Interrupted publication
uses a structured `500` with the cleanup operation ID and the known release
outcome. Administrators resume via the cleanup retry endpoint, not another tag.

See the [operator audit guide](../../admin/release-track-audit.md).
