# Workflow Response Pattern

## Overview

The ATT&CK Workbench REST API exposes several backend workflow endpoints that orchestrate complex, multi-step operations in a single atomic request. Examples include revoking an object, converting a technique to a subtechnique, and converting a subtechnique to a technique.

These workflows create, modify, deprecate, or delete multiple documents as side effects. The user needs visibility into all changes that occurred as a consequence of their request. To support this, all workflow endpoints return a universal response structure called a **Workflow Result**.

## Response Schema

Every workflow endpoint returns the same top-level shape:

```json
{
  "workflow": "convert-to-subtechnique",
  "primary": {
    "workspace": { ... },
    "stix": { ... }
  },
  "sideEffects": {
    "created":    [ { "workspace": { ... }, "stix": { ... } } ],
    "modified":   [],
    "deprecated": [],
    "deleted":    { "count": 0, "stixIds": [] }
  },
  "warnings": [
    {
      "message": "Duplicate relationship transfer skipped",
      "skipped": { "id": "relationship--...", "source_ref": "...", "target_ref": "...", "relationship_type": "uses", "description": "..." },
      "existing": { "source_ref": "...", "target_ref": "...", "relationship_type": "uses" }
    }
  ]
}
```

### Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `workflow` | `string` | Discriminator identifying which workflow was executed. One of: `"revoke"`, `"convert-to-subtechnique"`, `"convert-to-technique"`. |
| `primary` | `object` | The main object the user acted on. Always exactly one full `workspace + stix` document. |
| `sideEffects.created` | `array` | Full documents created as consequences of the workflow (e.g., `revoked-by` relationship, `subtechnique-of` relationship). |
| `sideEffects.modified` | `array` | Full documents modified as consequences (e.g., transferred relationships). |
| `sideEffects.deprecated` | `array` | Full documents that had `x_mitre_deprecated` set to `true` as a consequence. |
| `sideEffects.deleted` | `object` | Hard-deleted documents. Only count + STIX IDs are returned (the documents no longer exist). |
| `sideEffects.deleted.count` | `integer` | Number of deleted documents. |
| `sideEffects.deleted.stixIds` | `array<string>` | STIX IDs of deleted documents. |
| `warnings` | `array<object>` | Non-fatal issues encountered during the workflow. Each warning is a structured object with a `message` field and additional context fields specific to the warning type (see [Warning Object Schema](#warning-object-schema) below). |

**Design rationale:** Counts are derivable from array lengths, so no separate summary object is needed. The `deleted` category is the sole exception because deleted documents cannot be returned in full — only their IDs survive.

### Warning Object Schema

Every warning is an object with at least a `message` field. Additional fields vary by warning type:

| Warning type                              | `message`                                                                                                         | Additional fields                                                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Hierarchy relationship not transferred    | `"Hierarchy relationship not transferred"`                                                                        | `reason`, `relationship: { id, source_ref, target_ref, relationship_type }`                                                          |
| Duplicate relationship skipped            | `"Duplicate relationship transfer skipped"`                                                                       | `skipped: { id, source_ref, target_ref, relationship_type, description }`, `existing: { source_ref, target_ref, relationship_type }` |
| Relationship transfer failed              | `"Relationship transfer failed"`                                                                                  | `relationship: { id, source_ref, target_ref, relationship_type }`, `error`                                                           |
| Failed to create relationship             | `"Failed to create subtechnique-of relationship"`                                                                 | `stixId`, `error`                                                                                                                    |
| Failed to deprecate relationship          | `"Failed to deprecate relationship"`                                                                              | `relationshipId`, `error`                                                                                                            |
| Failed to deprecate relationships (batch) | `"Failed to deprecate relationships for revoked object"` or `"Failed to deprecate subtechnique-of relationships"` | `stixId`, `error`                                                                                                                    |

## Which Endpoints Use This Pattern

| Endpoint | `workflow` value | `primary` | Typical side effects |
|----------|-----------------|-----------|----------------------|
| `POST /api/:type/:stixId/revoke` | `"revoke"` | Revoked object | `created`: revoked-by relationship; `deprecated`: relationships referencing the revoked object |
| `POST /api/techniques/:stixId/convert-to-subtechnique` | `"convert-to-subtechnique"` | Converted subtechnique | `created`: subtechnique-of relationship |
| `POST /api/techniques/:stixId/convert-to-technique` | `"convert-to-technique"` | Converted technique | `deprecated`: subtechnique-of relationship(s) |

## WorkflowResult Builder

The `WorkflowResult` class (`app/lib/workflow-result.js`) is a DTO builder that assembles the response. Services construct a `WorkflowResult`, populate it, then return `result.toJSON()`.

### API

```javascript
const WorkflowResult = require('../../lib/workflow-result');

// Create
const result = new WorkflowResult('convert-to-subtechnique');

// Set the primary object
result.setPrimary(savedDocument);

// Add side effects
result.addCreated(relationshipDoc);        // single doc or array
result.addModified(transferredRelDoc);     // single doc or array
result.addDeprecated(deprecatedRelDoc);    // single doc or array
result.addDeleted(['attack-pattern--...']); // array of STIX IDs

// Add warnings
result.addWarning('Could not deprecate relationship--...');

// Merge results returned by event handlers (see below)
const eventResults = await EventBus.emit(eventName, payload);
result.mergeEventResults(eventResults);

// Serialize (calls .toObject() on Mongoose docs, strips _id/__v/__t)
return result.toJSON();
```

### `mergeEventResults(eventResults)`

Accepts the array returned by `EventBus.emit()` and merges each handler's result into the appropriate side-effect category:

```javascript
mergeEventResults(eventResults) {
  for (const handlerResult of eventResults) {
    if (handlerResult.created)    this.addCreated(handlerResult.created);
    if (handlerResult.modified)   this.addModified(handlerResult.modified);
    if (handlerResult.deprecated) this.addDeprecated(handlerResult.deprecated);
    if (handlerResult.warnings)   this.addWarnings(handlerResult.warnings);
  }
}
```

## Event Handler Return Contract

To surface side effects in the workflow response, event handlers must return their results.

### Before (results discarded)

```javascript
static async handleSubtechniqueConvertedToTechnique(payload) {
  // ... deprecate relationships ...
  logger.info(`Deprecated ${count} relationships`);
  // Returns undefined — caller has no visibility
}
```

### After (results returned)

```javascript
static async handleSubtechniqueConvertedToTechnique(payload) {
  // ... deprecate relationships ...
  return { deprecated: deprecatedDocs };
}
```

### Return Shape

Event handlers return a plain object with any subset of these keys:

```javascript
{
  created:    [ /* full documents */ ],
  modified:   [ /* full documents */ ],
  deprecated: [ /* full documents */ ],
  warnings:   [ /* structured warning objects — each must have a `message` field */ ]
}
```

Handlers that encounter errors in their catch blocks should return `{ warnings: [...] }` rather than swallowing the error silently:

```javascript
} catch (error) {
  logger.error(`Failed to deprecate relationship ${relId}: ${error.message}`);
  return { warnings: [{ message: 'Failed to deprecate relationship', relationshipId: relId, error: error.message }] };
}
```

## EventBus: Returning Handler Results

`EventBus.emit()` uses `Promise.allSettled` to execute listeners. It collects the fulfilled return values and returns them as an array:

```javascript
async emit(eventName, payload) {
  // ... existing logging ...
  const results = await Promise.allSettled(
    listeners.map(async (listener) => {
      return await listener(payload);  // return value preserved
    }),
  );

  // Return fulfilled values (undefined returns filtered out)
  return results
    .filter((r) => r.status === 'fulfilled' && r.value != null)
    .map((r) => r.value);
}
```

This is backward-compatible: callers that do not inspect the return value are unaffected. Handlers that do not return anything produce `undefined`, which is filtered out.

## Usage Example: Convert to Subtechnique

Full flow from service → event handler → response:

```javascript
// In TechniquesService.convertToSubtechnique():
const result = new WorkflowResult('convert-to-subtechnique');

// 1. Save the converted technique
const savedDocument = await this.repository.save(newVersion);
result.setPrimary(savedDocument);

// 2. Emit event — RelationshipsService creates the subtechnique-of SRO
const eventResults = await EventBus.emit(
  EventConstants.TECHNIQUE_CONVERTED_TO_SUBTECHNIQUE,
  { stixId, parentStixId, userAccountId },
);
result.mergeEventResults(eventResults);

// 3. Return the assembled response
return result.toJSON();


// In RelationshipsService.handleTechniqueConvertedToSubtechnique():
static async handleTechniqueConvertedToSubtechnique(payload) {
  const { stixId, parentStixId, userAccountId } = payload;
  try {
    const rel = await relationshipsService.create({ ... }, { userAccountId });
    return { created: [rel] };
  } catch (error) {
    logger.error(`Failed to create subtechnique-of: ${error.message}`);
    return { warnings: [{ message: 'Failed to create subtechnique-of relationship', stixId, error: error.message }] };
  }
}
```

The HTTP response body will be:

```json
{
  "workflow": "convert-to-subtechnique",
  "primary": {
    "workspace": { "attack_id": "T1234.001", ... },
    "stix": { "x_mitre_is_subtechnique": true, ... }
  },
  "sideEffects": {
    "created": [
      {
        "stix": {
          "type": "relationship",
          "relationship_type": "subtechnique-of",
          "source_ref": "attack-pattern--...",
          "target_ref": "attack-pattern--..."
        }
      }
    ],
    "modified": [],
    "deprecated": [],
    "deleted": { "count": 0, "stixIds": [] }
  },
  "warnings": []
}
```

## Adding a New Workflow: Checklist

1. Choose a `workflow` discriminator string (e.g., `"deprecate"`).
2. In your service method:
   - Create `new WorkflowResult('your-workflow-name')`
   - Call `result.setPrimary(...)` after persisting the primary object
   - Call `result.addCreated/addDeprecated/etc.` for any side effects performed directly
   - Capture `EventBus.emit()` return value and call `result.mergeEventResults(...)`
   - Return `result.toJSON()`
3. In each event handler that produces side effects:
   - Return `{ created, modified, deprecated, warnings }` (include only the keys that apply)
   - On error, return `{ warnings: [...] }` instead of swallowing silently
4. Add the new workflow value to the `workflow` enum in the OpenAPI schema (`app/api/definitions/components/workflow-response.yml`).
5. Reference the `workflow-response` schema in the endpoint's OpenAPI path definition.
6. Update user-facing documentation in `docs/user/`.
