# Automation Run Audit Trail

## Overview

Workbench now persists a durable audit trail for non-human-driven
write workflows such as database migrations, scheduler backfills, and
future repair tasks.

The audit trail uses two MongoDB collections:

- `automationRuns`: one summary document per automation execution
- `automationRunItems`: zero or more per-item outcome documents linked
  to a parent run by `run_id`

This document defines the taxonomy, the design rationale, and the
rules for extending it.

## Design goals

The automation-run taxonomy is meant to satisfy four requirements at
once:

1. Provide operators with a durable record of what automation did.
2. Stay generic enough for many automation classes, not just
   migrations.
3. Preserve stable, queryable top-level fields for dashboards and
   tooling.
4. Avoid forcing every automation into one rigid per-item schema.

## Design rationale

The obvious starting point is a strict, fully-normalized schema. It
makes querying easy and forces strong conventions, and it is tempting
to give every item first-class fields like `stix_id`, `stix_type`,
`previous_modified`, `new_modified`, `changes`, and so on.

That fits STIX-object migrations cleanly, but it starts to chafe as
soon as the next automation looks slightly different. Scheduler jobs
may operate on many collections. Admin repair tasks may act on one
system document. Future jobs may not be versioned STIX objects at
all. A taxonomy that hard-codes the shape of a STIX migration forces
every later automation to either violate the schema or trigger
another round of schema changes.

The reflex when that becomes painful is to retreat to the other
extreme: store only opaque JSON blobs — a `payload` or `details`
field at both the run and item levels — and let each automation
describe itself however it likes. That removes schema churn entirely,
but it also removes the parts operators and tooling actually rely on:
run status, start and end timestamps, automation class, counts and
warnings, per-item status, and the linkage between a run and its
items. A purely free-form audit trail is durable but not operationally
useful.

The split that falls out of that tension is the design used here. The
parts every automation must expose for querying and dashboards — the
**envelope** — stay stable and structured. The parts that legitimately
vary by automation class — the **payload** — stay extensible and
free-form. Concretely:

- `automationRuns` has stable top-level fields like `run_id`,
  `automation_type`, `status`, `started_at`, `finished_at`, `scope`,
  `counts`, `warnings`, and `verification`.
- `automationRunItems` has stable top-level fields like `run_id`,
  `sequence`, `status`, `action`, `target`, `warnings`, and `error`.
- Automation-specific detail lives under `metadata` on the run and
  under `details` on the item.

That keeps the taxonomy durable for tooling while still absorbing new
classes of automation without a schema redesign.

## Collection taxonomy

### `automationRuns`

Each document represents one execution of an automation workflow.

Stable fields:

| Field | Purpose |
|---|---|
| `schema_version` | Version of the automation-run document taxonomy. Increment only when the persisted shape changes incompatibly. |
| `run_id` | Unique identifier shared by the run and all its items. |
| `automation_type` | Coarse automation class, such as `migration`, `scheduler`, `backfill`, or `repair`. |
| `name` | Specific automation name, such as a migration filename or scheduler task name. |
| `status` | Current terminal or in-flight run status. Common values are `running`, `completed`, `partial`, and `failed`. |
| `started_at` | UTC start timestamp. |
| `finished_at` | UTC completion timestamp, or `null` while in flight. |
| `trigger` | How the run was initiated, for example `{ source: "startup", runner: "migrate-mongo" }`. |
| `scope` | Queryable description of what the run was meant to operate on. |
| `runtime` | Host/runtime information captured at execution time. |
| `counts` | Numeric counters recorded by the automation. |
| `warnings` | Run-level warning counters or categories. |
| `verification` | Post-run verification checks. |
| `summary` | Human-readable outcome summary. |
| `error_summary` | Terminal failure detail when the run is `partial` or `failed`. |
| `items.collection` | Collection name storing per-item detail. |

Extensible fields:

| Field | Purpose |
|---|---|
| `metadata` | Automation-specific configuration or context that does not belong in the stable envelope. |

### `automationRunItems`

Each document represents the outcome for one processed unit of work.
That unit is intentionally generic: it can be a STIX object, a Mongo
document, a collection-level operation, or a system-level step.

Stable fields:

| Field | Purpose |
|---|---|
| `schema_version` | Version of the item taxonomy. |
| `run_id` | Foreign key to the parent run. |
| `automation_type` | Copied from the parent run for easier filtering. |
| `name` | Copied from the parent run for easier filtering. |
| `recorded_at` | UTC timestamp for when the item outcome was recorded. |
| `sequence` | Monotonic sequence number within the run. |
| `status` | Per-item outcome status. Common values are `changed`, `unchanged`, `skipped`, and `failed`. |
| `action` | Operation-specific verb, such as `normalize_x_mitre_platforms`. |
| `target` | Stable identity envelope for what the item refers to. |
| `warnings` | Optional array of warning codes affecting this item. |
| `error` | Serialized error detail when the item failed. |

Extensible fields:

| Field | Purpose |
|---|---|
| `details` | Automation-specific payload, such as before/after values, attempted versions, or extra counters. |

## Target envelope

`target` is intentionally generic. It should contain stable identity
information for the processed unit, but not automation-specific
payload.

Common shape:

```json
{
  "kind": "stix-object",
  "collection": "attackObjects",
  "stix_id": "attack-pattern--...",
  "stix_type": "attack-pattern"
}
```

Other valid future shapes may use:

- `document_id` for generic Mongo documents
- `collection` only for collection-level work
- `kind: "system"` for process-wide or singleton operations

Consumers should treat `target` as the identity envelope and `details`
as the execution payload.

## Why `scope` and `metadata` are separate

`scope` exists for stable, queryable descriptors of what a run was
intended to touch. For example:

```json
{
  "collections": ["attackObjects"],
  "object_kinds": ["stix-object"],
  "target_types": ["attack-pattern", "tool"]
}
```

`metadata` is for contextual detail that may vary widely from one
automation to the next, such as a migration’s replacement mapping or
the options passed to a scheduler task.

Rule of thumb:

- Put stable filtering dimensions in `scope`.
- Put automation-specific context in `metadata`.

## Example documents

Run document:

```json
{
  "schema_version": 1,
  "run_id": "2c43b1e4-0ef4-4f3d-9e77-0dd3a5d2f8cb",
  "automation_type": "migration",
  "name": "20260507130000-normalize-x-mitre-platforms",
  "status": "completed",
  "started_at": "2026-05-07T23:31:48.800Z",
  "finished_at": "2026-05-07T23:31:49.300Z",
  "trigger": {
    "source": "startup",
    "runner": "migrate-mongo"
  },
  "scope": {
    "collections": ["attackObjects"],
    "object_kinds": ["stix-object"],
    "target_types": ["x-mitre-asset", "attack-pattern"]
  },
  "counts": {
    "scanned_candidates": 4,
    "attempted_reposts": 4,
    "updated": 4,
    "unchanged": 0,
    "failed": 0,
    "removed_platform_field": 0
  },
  "warnings": {
    "existing_validation_issues": 4
  },
  "verification": {
    "remaining_latest_active_objects_with_legacy_platforms": 0
  },
  "summary": {
    "message": "Normalized x_mitre_platforms on 4 active latest object(s) after scanning 4 candidate(s); removed the field entirely on 0 object(s)."
  },
  "items": {
    "collection": "automationRunItems"
  }
}
```

Item document:

```json
{
  "schema_version": 1,
  "run_id": "2c43b1e4-0ef4-4f3d-9e77-0dd3a5d2f8cb",
  "automation_type": "migration",
  "name": "20260507130000-normalize-x-mitre-platforms",
  "recorded_at": "2026-05-07T23:31:49.100Z",
  "sequence": 1,
  "status": "changed",
  "action": "normalize_x_mitre_platforms",
  "target": {
    "kind": "stix-object",
    "collection": "attackObjects",
    "stix_id": "x-mitre-asset--68388d4f-8138-420b-be2b-5a7dfe9ff6b4",
    "stix_type": "x-mitre-asset"
  },
  "warnings": ["existing_validation_issues"],
  "details": {
    "previous_modified": "2026-05-01T12:00:00.000Z",
    "new_modified": "2026-05-07T23:31:49.001Z",
    "existing_validation_error_count": 3,
    "changes": [
      {
        "field": "stix.x_mitre_platforms",
        "before": ["Network"],
        "after": ["Network Devices"]
      }
    ]
  }
}
```

## Authoring rules for new automation

When adding a new migration or scheduler task:

1. Create one run document per execution.
2. Use `automation_type` for the coarse class and `name` for the
   specific job.
3. Put stable filtering dimensions in `scope`.
4. Put job-specific configuration in `metadata`.
5. Use `target` for stable identity only.
6. Put operation-specific payload in `details`.
7. Prefer `counts` and `warnings` as numeric maps instead of encoding
   those metrics only in free-form text.
8. Record item rows for changed and failed units of work at minimum.
   Recording unchanged items is optional and should be justified by
   the operational value versus collection growth.
9. Add a post-run `verification` check whenever the automation makes a
   correctness claim that can be measured.

## Evolution policy

The taxonomy is expected to evolve, but the stable envelope should
change slowly.

Rules:

1. Additive fields inside `metadata`, `details`, `counts`,
   `warnings`, and `verification` are safe.
2. Additive fields in the stable envelope are acceptable when broadly
   useful.
3. Renaming or deleting stable envelope fields requires bumping
   `schema_version`.
4. Consumers must not assume that `details` has the same shape across
   different automation names.

## Current implementation

The reusable recorder lives in
[`app/lib/automation-run-recorder.js`](../../app/lib/automation-run-recorder.js).
The first consumer is the platform-normalization migration in
[`migrations/20260507130000-normalize-x-mitre-platforms.js`](../../migrations/20260507130000-normalize-x-mitre-platforms.js).
