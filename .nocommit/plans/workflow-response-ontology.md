# Plan: Universal Workflow Response Ontology

## Problem

Backend workflow endpoints (revoke, convert-to-subtechnique, convert-to-technique) orchestrate
multi-step operations but return inconsistent response shapes. The revoke endpoint returns a
bespoke `{ revokedObject, revokedByRelationship, relationshipsSummary }`. The convert endpoints
return only the bare technique object — side-effect documents (created/deprecated relationships)
are invisible to the caller.

## Universal Response Schema

Every workflow endpoint returns the same top-level shape:

```json
{
  "workflow": "convert-to-subtechnique",
  "primary": { /* the main object acted upon — full workspace+stix document */ },
  "sideEffects": {
    "created":    [ /* full documents */ ],
    "modified":   [ /* full documents */ ],
    "deprecated": [ /* full documents */ ],
    "deleted":    { "count": 0, "stixIds": [] }
  },
  "warnings": []
}
```

| Field | Purpose |
|---|---|
| `workflow` | Discriminator string (`"revoke"`, `"convert-to-subtechnique"`, `"convert-to-technique"`) |
| `primary` | The one object the user directly acted on — always exactly one, always a full document |
| `sideEffects.created` | Full documents created as consequences (e.g., `revoked-by` or `subtechnique-of` relationships) |
| `sideEffects.modified` | Full documents modified as consequences (reserved for future use) |
| `sideEffects.deprecated` | Full documents where `x_mitre_deprecated` was set to `true` |
| `sideEffects.deleted` | Count + STIX IDs of hard-deleted documents (only IDs — the docs no longer exist) |
| `warnings` | Non-fatal issues (failed transfers, handler errors, etc.) |

Counts are derived from array lengths. The `deleted` category is the exception because deleted
documents can't be returned in full.

## Implementation Sequence

### 1. WorkflowResult DTO — `app/lib/workflow-result.js`

Builder class with:
- `setPrimary(doc)`
- `addCreated(docOrDocs)`, `addModified(docOrDocs)`, `addDeprecated(docOrDocs)`
- `addDeleted(stixIds)`
- `addWarning(msg)`, `addWarnings(msgs)`
- `mergeEventResults(eventResults)` — merges `{ created, deprecated, warnings }` from handlers
- `toJSON()` — defensively calls `.toObject()` on Mongoose docs

### 2. EventBus — return handler results from `emit()`

Modify `emit()` to collect and return fulfilled values from `Promise.allSettled`. Non-breaking —
no existing caller inspects the return value.

### 3. RelationshipsService event handlers — return side-effect documents

Each handler returns a `{ created, deprecated, warnings }` object:
- `handleTechniqueConvertedToSubtechnique` → `{ created: [rel] }`
- `handleSubtechniqueConvertedToTechnique` → `{ deprecated: [rel1, ...] }`
- `handleObjectRevoked` → `{ deprecated: [...] }`

Catch blocks return `{ warnings: [...] }` instead of swallowing errors silently.

### 4. Update `base.service.js` `revoke()`

Replace bespoke return object with `WorkflowResult`. Merge event handler results via
`result.mergeEventResults()`. Remove the post-hoc cross-service read that counts deprecated
relationships (now derived from the returned array).

### 5. Update `techniques-service.js` convert methods

Both methods: create `WorkflowResult`, set primary, capture `EventBus.emit()` return value,
merge, return `result.toJSON()`.

### 6. OpenAPI schema — `app/api/definitions/components/workflow-response.yml`

Define reusable `workflow-response` and `side-effects` component schemas. Update
`techniques-paths.yml` to reference them for all three workflow endpoints.

### 7. Tests and documentation

- Unit tests for `WorkflowResult`
- Update integration tests for new response shape
- Developer doc at `docs/developer/workflow-response-pattern.md`
- Update user docs (revoke-workflow.md, technique-conversion-workflow.md)

## Key Design Decisions

- **Full documents in arrays, not just IDs** — the frontend never needs a follow-up GET.
- **`deleted` is count + IDs only** — deleted documents can't be returned in full.
- **Breaking change to revoke response is acceptable** — the endpoint is new.
  `revokedObject` → `primary`, `revokedByRelationship` → `sideEffects.created[0]`.
- **Single PR** — contained change surface: one new file, four service mods, one EventBus
  tweak, OpenAPI updates.

## Mapping: Old Revoke Response → New Shape

```
revokedObject              → primary
revokedByRelationship      → sideEffects.created[0]
relationshipsSummary       → (derived from sideEffects arrays + warnings)
```
