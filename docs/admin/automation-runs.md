# Automation Run Audit Trail

## Overview

Workbench persists a durable audit trail for non-human-driven
automation. This currently includes the new migration workflow and is
intended to support scheduler backfills and future repair tasks.

Two MongoDB collections are used:

- `automationRuns`: one summary row per automation execution
- `automationRunItems`: per-item detail linked to a parent run by
  `run_id`

These collections are operational diagnostics and audit records. They
do not replace the version history stored on ATT&CK objects
themselves.

## When these collections are created

The collections are created lazily the first time an automation uses
the recorder. The recorder also creates indexes needed for common
queries.

As of now, the first built-in consumer is the
`20260507130000-normalize-x-mitre-platforms` migration.

## What to expect in `automationRuns`

Each run document includes:

- `run_id`: unique identifier for the execution
- `automation_type`: coarse class such as `migration`
- `name`: specific job name
- `status`: `running`, `completed`, `partial`, or `failed`
- `started_at` and `finished_at`
- `scope`: what the job intended to operate on
- `counts`: numeric counters from the job
- `warnings`: warning counters from the job
- `verification`: post-run checks
- `summary`: human-readable outcome
- `error_summary`: terminal failure detail, if any

## What to expect in `automationRunItems`

Each item document includes:

- `run_id`: parent run identifier
- `sequence`: item ordering within the run
- `status`: per-item result such as `changed`, `unchanged`, or `failed`
- `action`: operation-specific verb
- `target`: identity envelope for the processed unit
- `warnings`: optional warning codes
- `details`: automation-specific payload such as before/after values
- `error`: serialized failure detail when the item failed

Not every automation will use exactly the same `details` payload. That
field is intentionally extensible.

## Common operator workflows

### Inspect the latest automation runs

```javascript
db.automationRuns.find().sort({ started_at: -1 }).limit(10).pretty()
```

### Inspect the latest platform-normalization migration run

```javascript
db.automationRuns.find(
  { name: '20260507130000-normalize-x-mitre-platforms' }
).sort({ started_at: -1 }).limit(1).pretty()
```

### Fetch all item records for a run

```javascript
const run = db.automationRuns.findOne(
  { name: '20260507130000-normalize-x-mitre-platforms' },
  { sort: { started_at: -1 } }
);

db.automationRunItems.find({ run_id: run.run_id }).sort({ sequence: 1 }).pretty();
```

### Inspect failures only

```javascript
db.automationRunItems.find({
  run_id: run.run_id,
  status: 'failed'
}).sort({ sequence: 1 }).pretty();
```

### Inspect all runs that touched a specific STIX object

```javascript
db.automationRunItems.find({
  'target.stix_id': 'attack-pattern--01234567-89ab-cdef-0123-456789abcdef'
}).sort({ recorded_at: -1 }).pretty();
```

## Interpreting run status

- `running`: the automation started but has not recorded terminal
  state yet
- `completed`: the automation finished without item failures
- `partial`: the automation made some progress but also encountered
  one or more failures
- `failed`: the automation did not complete successfully and did not
  produce a usable result set

The exact threshold between `partial` and `failed` is determined by
the automation implementation. Always inspect `counts`,
`verification`, and `error_summary` before deciding whether manual
intervention is required.

## Interpreting verification

`verification` contains post-run checks claimed by the automation.
For example, the platform-normalization migration records
`remaining_latest_active_objects_with_legacy_platforms`.

This is the fastest way to answer, “Did the automation actually finish
the intended repair?”

## Logs vs persisted records

Container logs remain useful for real-time observation, but they are
not the system of record. The durable record is MongoDB:

- logs are best for live troubleshooting
- `automationRuns` and `automationRunItems` are best for audit and
  post-hoc analysis

When an automation emits a `run_id` in the logs, use that `run_id` to
retrieve the persisted record in MongoDB.

## Retention and growth

There is currently no TTL or automatic pruning for these collections.
That is intentional: operators may want to retain a complete history
of database repairs and other automation.

If you later decide to prune:

1. confirm any local retention or audit requirements
2. prune old `automationRunItems` only alongside their parent
   `automationRuns`
3. never confuse these records with the authoritative STIX object
   history stored in `attackObjects` and `relationships`

## Relationship to migration startup

If automatic migrations are enabled, migrations run on server startup.
See [Configuration](configuration.md) for the
`database.migration.enable` setting.

The automation audit trail is especially useful in environments where
migrations run automatically, because it provides durable visibility
into what happened after startup rather than relying only on container
logs.
