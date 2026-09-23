# Virtual Release-Track Schedules

Virtual release tracks can materialize draft snapshots explicitly or through
their persisted `snapshot_schedule`. Scheduled execution uses the same
composition-resolution and snapshot-persistence services as the explicit
virtual snapshot creation endpoint.

## Activation and timing

`ENABLE_SCHEDULER=true` activates all Workbench scheduler tasks, including
virtual-track materialization. `VIRTUAL_TRACK_SCHEDULES_CRON` controls how
often the server reconciles persisted schedules; it defaults to once per
minute.

All five-field cron expressions and explicit dates are interpreted in UTC.
Cron jobs fire only while a scheduler instance is running. They do not
backfill occurrences missed during downtime. Date schedules are durable:
every configured timestamp at or before reconciliation is registered and
processed after startup.

`manual` schedules register no executable work. Operators must call
`POST /api/release-tracks/:id/virtual/snapshots/create`.

Editors can replace the active schedule through
`PUT /api/release-tracks/:id/virtual/schedule`. The change is visible
immediately in track and Workbench-format snapshot responses; executable jobs
are refreshed on the next `VIRTUAL_TRACK_SCHEDULES_CRON` reconciliation pass.

## Idempotency and multiple instances

The `virtualTrackScheduleOccurrences` collection stores one durable occurrence
per track and UTC timestamp. Workers atomically claim pending or retryable
occurrences with an ownership token. The resulting snapshot also records
`scheduled_materialization.scheduled_for` under a unique track-local index.
The occurrence's monotonic `snapshot_modified` receipt survives snapshot cleanup;
it must not be TTL-expired while the track remains in use.

If a worker persists a snapshot but exits before marking the occurrence complete,
the next worker recovers the existing snapshot or its receipt. A receipt whose
snapshot has been deleted means the occurrence already materialized and was
subsequently removed; it never authorizes recomputing composition. API-originated
scheduled metadata and legacy snapshots receive the same receipt protection
before deletion. Explicit attempts to recreate removed occurrences return `409`.

Recovery is audited as `recover_scheduled_virtual_snapshot`, including
`materialized_and_removed` when no snapshot remains. Claim ownership prevents
stale worker failure/completion from reopening another worker's completed run.

For why scheduled execution evidence must outlive retained snapshots, see
[Deletion Guardrails](../developer/release-tracks/deletion-guardrails.md).

## Failures and retries

An occurrence commonly fails when a component resolution has no matching
tagged snapshot. The occurrence remains `failed` and becomes retryable after
one minute. The reconciliation task retries it automatically; no schedule
resubmission is required. Permanent configuration errors continue to retry
until an operator corrects the component release state or removes the track.

Every attempt creates an `automationRuns` record with:

- `automation_type: "scheduler"`
- `name: "virtual-track-snapshot-materialization"`
- `scope.track_id` and `scope.schedule_mode`
- `trigger.scheduled_for`
- terminal counts and an item-level error or created snapshot timestamp

See [Automation Run Audit Trail](automation-runs.md) for queries and
operational inspection patterns.
