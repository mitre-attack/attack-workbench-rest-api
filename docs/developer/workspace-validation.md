# Stateful Validation Tracking (`workspace.validation`)

## Overview

Every Mongoose document in the Workbench REST API has an optional
`workspace.validation` subdocument that records the result of validating
the document's `stix` payload against the [ATT&CK Data Model
(ADM)](https://github.com/mitre-attack/attack-data-model) schemas.

The field is **server-controlled** and **diagnostic**: it does not
gate reads, but it tells operators and client UIs which documents are
known to fail current ADM validation and why. It exists so that a long-
lived database can carry forward documents that were valid under an
older ADM version (or that pre-date validation entirely) without losing
visibility into their non-compliance.

This document defines the field, its invariants, and the pipelines that
write or clear it.

## Why state-track validation at all?

ADM validation is the gate at the write boundary: every POST and PUT
runs the composed STIX object through the ADM schemas before
persistence (see [`base.service.js`](../../app/services/meta-classes/base.service.js)
pipeline stage 5, "VALIDATE WITH ADM"). If validation fails on a write,
the request throws and nothing is persisted.

Given that gate, **a freshly-seeded database should never contain
validation errors.** State-tracking is only meaningful for documents
that bypassed the gate or were validated under different rules:

1. **Legacy content** — documents that existed before ADM-based
   validation was introduced into the request pipeline. These
   documents may have shapes that current schemas reject and were
   never gated on entry.

2. **Version-skewed content** — documents written under one ADM
   version that subsequently became non-compliant when Workbench
   upgraded to a later ADM version. For example, content authored
   under ADM v1.0 may fail ADM v2.0 validation if v2.0 tightened a
   constraint or renamed a required field.

   Schema-changing Workbench upgrades are expected to ship database
   migration scripts that bring existing content into compliance, so
   this case should be rare in practice. It remains technically
   possible whenever an upgrade lands without a corresponding migration,
   or when a migration cannot fully repair a document.

3. **Imported content** — STIX bundle imports use a fail-open path
   (see below). When an imported object fails validation but the
   import is allowed to proceed, the errors are recorded on the
   document so they are visible after the import completes.

## Field shape

```jsonc
{
  "workspace": {
    "validation": {
      "errors": [
        { "message": "stix.x_mitre_domains is Required",
          "path": ["x_mitre_domains"],
          "code": "invalid_type" }
      ],
      "attack_spec_version": "3.3.0",
      "adm_version": "1.4.2",
      "validated_at": "2026-05-06T12:00:00.000Z"
    }
  }
}
```

| Field | Meaning |
|---|---|
| `errors` | Array of `{ message, path, code }` derived from Zod issues, after bypass rules are applied. |
| `attack_spec_version` | ATT&CK spec version under which validation was performed. |
| `adm_version` | NPM version of `@mitre-attack/attack-data-model` at validation time. |
| `validated_at` | UTC timestamp of the validation run. |

The presence of the `validation` subdocument means "this document had
unresolved errors as of `validated_at`." Its **absence** means "this
document was either never validated or last passed validation."

## Invariants

1. `workspace.validation` is **server-controlled.** Clients cannot
   set, modify, or carry forward this field through any write path.
2. The field is **recomputed (or omitted) on every successful write.**
   A POST or PUT that passes ADM validation produces a document with
   no `workspace.validation`. A POST or PUT that fails ADM validation
   throws — nothing is persisted, and the prior document (if any) is
   untouched until a future write or scheduler tick revisits it.
3. The only paths that may legitimately *set* `workspace.validation`
   are the scheduler and the import fail-open path. All other paths
   either clear it or leave it absent.

## Writers and behavior

### 1. `BaseService.create()` — POST a new (version of an) object

[`base.service.js`](../../app/services/meta-classes/base.service.js)

- `stripServerControlledFields()` removes any client-supplied
  `workspace.validation` at the top of the pipeline.
- ADM validation runs.
- If validation fails, the request throws — nothing persists.
- If validation passes, the new document is saved with no
  `workspace.validation`.

### 2. `BaseService.updateFull()` — PUT an existing version

- `stripServerControlledFields()` removes any client-supplied
  `workspace.validation`.
- ADM validation runs against the composed object.
- If validation fails, the request throws — the existing document is
  untouched.
- If validation passes:
  - The composed document is merged onto the existing one.
  - If the existing document had `workspace.validation`, the merge
    sets it to `undefined` and a follow-up `repository.unsetField`
    call removes the field from the persisted document.

### 3. `BaseService._createFromImport()` — STIX bundle import

This path is intentionally **fail-open**: import is the primary way
that legacy and version-skewed content enters the system, so blocking
on every validation error would make migrations impossible.

- Any client-supplied `workspace.validation` is stripped at entry.
- Revoked or deprecated objects skip validation entirely and are
  persisted with no `workspace.validation`.
- Otherwise, ADM validation runs.
- If validation fails and `options.validateContents` is set, the
  import throws.
- If validation fails and `validateContents` is not set, the errors
  are recorded on `workspace.validation` (with current ADM and spec
  versions) and the document persists. **This is the only legitimate
  client-facing setter.**
- If validation passes, the document persists with no
  `workspace.validation`.

### 4. The `validate-objects` scheduler task

[`app/scheduler/validate-objects-task.js`](../../app/scheduler/validate-objects-task.js)

The scheduler exists to combat **concept drift**: a document that
passed validation last week may fail today if Workbench has since
upgraded ADM. On its configured cron schedule, the task iterates every
SDO and SRO in the database, re-runs validation, and brings each
document's `workspace.validation` field back in sync with the current
ADM rules.

For each document:

- Revoked/deprecated objects are skipped (validation is not
  meaningful for retired content).
- Validation runs and bypass rules are applied.
- If the document passes, any existing `workspace.validation` is
  unset (`totalCleared`).
- If the document fails, `workspace.validation` is set to the current
  errors with current ADM/spec versions (`totalErrored`).

Because the scheduler is the only writer that can transition a
document from "valid" to "has-validation-errors" without a user
write, it is also the only mechanism that surfaces version-skewed
documents after a Workbench upgrade.

## Lifecycle summary

| Path | Validation outcome | `workspace.validation` after the write |
|---|---|---|
| `create()` | passes | absent |
| `create()` | fails | request throws; nothing persisted |
| `updateFull()` | passes | absent (cleared if previously present) |
| `updateFull()` | fails | request throws; existing doc untouched |
| `_createFromImport()` | passes | absent |
| `_createFromImport()` | fails + `validateContents` | request throws |
| `_createFromImport()` | fails + fail-open | server-set with current ADM/spec |
| `_createFromImport()` | revoked/deprecated | absent |
| Scheduler | passes | absent (cleared if previously present) |
| Scheduler | fails | server-set with current ADM/spec |

## Bypass rules

Both the request pipeline and the scheduler consult
`validation-bypasses-repository` to filter Zod issues that match a
stored bypass rule (matching on `stixType`, `errorCode`, and
`fieldPath`). A bypassed error is removed from the `errors` array
before the field is written. This allows operators to suppress known-
benign validation noise without modifying ADM itself.

The set of bypass rules is shared between the synchronous write path
and the scheduler so that a document's validation status is consistent
regardless of which writer last touched it.

## Reading `workspace.validation`

There is no public endpoint that filters on this field today. Clients
that need to surface "documents needing attention" should retrieve
the relevant collection and check for the presence of
`workspace.validation` on each document. The field is a diagnostic
hint, not a workflow gate — read paths do not consult it.
