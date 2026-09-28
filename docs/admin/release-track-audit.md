# Release-Track Destructive Audit Events

Workbench stores destructive attempts in `releaseTrackAuditEvents`: full-track
deletion (`delete_track`), release conversion (`convert_release_to_draft`),
version correction (`retag_release`), virtual draft retention (`draft_retention`),
and opt-in release-time draft squash (`draft_squash`). Recurring retention records
a system actor under the saved cron policy; one-shot retention and explicit
destructive actions record the authenticated administrator. Retention intents
record their source, applied threshold and original cutoff. Legacy unscoped
intents can repair storage but cannot select additional drafts.

Older `delete_release` events retain their historical meaning. New snapshot
DELETE requests reject tagged releases; conversion and draft deletion are
separate operations. Conversion results identify the restored draft timestamp
and have `version: null`.

Each record contains:

- `event_id`, `action`, and `track_id`
- the authenticated `actor`
- the exact destructive `confirmation` supplied by the caller (or the prior
  version for `retag_release`)
- a bounded request/result summary
- `pending`, `completed`, or `failed` status
- start/finish timestamps and failure detail

Inspect recent events:

```javascript
db.releaseTrackAuditEvents.find().sort({ started_at: -1 }).limit(50).pretty();
```

Inspect destructive actions for one track:

```javascript
db.releaseTrackAuditEvents
  .find({
    track_id: 'release-track--...',
  })
  .sort({ started_at: -1 })
  .pretty();
```

Inspect incomplete or failed attempts:

```javascript
db.releaseTrackAuditEvents
  .find({
    status: { $in: ['pending', 'failed'] },
  })
  .sort({ started_at: 1 })
  .pretty();
```

A `pending` event can mean the process stopped after the audit insert or the
operation committed before final audit/progress recording. Do not repeat a tag
to repair draft cleanup. Inspect
`GET /api/release-tracks/:id/virtual/draft-cleanup`; administrators can resume an
existing operation with
`POST /api/release-tracks/:id/virtual/draft-cleanup/:operationId/retry`.

Cleanup events retain bounded selectors, the original release-event identity
where relevant, and a bounded write-ahead batch. Missing snapshots from a
partially processed batch are repaired idempotently. A retry never expands the
approved interval or attaches an old intent to a rollback/re-tagged release.
`release_committed: true` means the release exists even if cleanup failed; an
omitted outcome means a store failure prevented establishing it.

The canonical safety explanation is [Deletion Guardrails](../developer/release-tracks/deletion-guardrails.md).

These records have no automatic TTL. Establish retention and archive policy
according to local audit requirements.
