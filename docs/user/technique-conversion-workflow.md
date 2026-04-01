# Technique Conversion Workflows

There are two conversion workflows for techniques:

- **Convert to subtechnique** — promotes a standalone technique to a subtechnique of an existing parent technique.
- **Convert to technique** — promotes a subtechnique to a standalone technique, removing its parent association.

Both workflows create a new version of the object (same `stix.id`, new `modified` timestamp) with updated properties. The `x_mitre_is_subtechnique` field cannot be changed through a normal PUT update — these endpoints are the only way to change a technique's subtechnique status.

## Convert Technique to Subtechnique

### Usage

```
POST /api/techniques/:stixId/convert-to-subtechnique
```

Where `:stixId` is the STIX ID of the technique to convert (e.g., `attack-pattern--15dbf668-795c-41e6-8219-f0447c0e64ce`).

Requires **editor** role or higher.

**Request Body:**

```json
{
  "parentTechniqueAttackId": "T1234"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `parentTechniqueAttackId` | string | yes | ATT&CK ID of the parent technique. Must match the pattern `T####` and refer to an existing, non-revoked technique. |

### What Happens

1. **Validation** — The endpoint verifies that:
   - The target technique exists and is not already a subtechnique
   - The target technique is not revoked
   - The target technique has no child subtechniques (rehome them first)
   - The parent technique (`parentTechniqueAttackId`) exists in the system

2. **New version created** — A new version of the technique is saved with:
   - `x_mitre_is_subtechnique` set to `true`
   - A new ATT&CK ID in subtechnique format (e.g., `T1234.001`), auto-generated as the next available number under the parent
   - Updated `external_references` with the new ATT&CK ID and URL
   - A new `modified` timestamp

3. **Relationship created** — A `subtechnique-of` relationship is created linking the converted subtechnique (`source_ref`) to the parent technique (`target_ref`).

### Response

On success, returns **200 OK** with a [workflow response envelope](../../docs/developer/workflow-response-pattern.md):

```json
{
  "workflow": "convert-to-subtechnique",
  "primary": {
    "workspace": {
      "workflow": { "state": "work-in-progress" },
      "attack_id": "T1234.001"
    },
    "stix": {
      "type": "attack-pattern",
      "id": "attack-pattern--15dbf668-795c-41e6-8219-f0447c0e64ce",
      "name": "Example Technique",
      "x_mitre_is_subtechnique": true,
      "external_references": [
        {
          "source_name": "mitre-attack",
          "external_id": "T1234.001",
          "url": "https://attack.mitre.org/techniques/T1234/001"
        }
      ]
    }
  },
  "sideEffects": {
    "created": [
      {
        "workspace": { "workflow": { "state": "reviewed" } },
        "stix": {
          "type": "relationship",
          "relationship_type": "subtechnique-of",
          "source_ref": "attack-pattern--15dbf668-795c-41e6-8219-f0447c0e64ce",
          "target_ref": "attack-pattern--a1234567-abcd-1234-abcd-1234567890ab"
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

| Field | Description |
|-------|-------------|
| `workflow` | Always `"convert-to-subtechnique"` |
| `primary` | The technique in its post-conversion state (new version) |
| `sideEffects.created` | The `subtechnique-of` relationship linking the new subtechnique to its parent |
| `sideEffects.deprecated` | Empty for this workflow |
| `warnings` | Non-fatal issues encountered during the workflow |

### Error Responses

#### 400 Bad Request

| Condition | Details |
|-----------|---------|
| Technique is already a subtechnique | `Technique attack-pattern--... is already a subtechnique` |
| Technique is revoked | `Cannot convert a revoked technique` |
| Technique has child subtechniques | `Technique attack-pattern--... has N subtechnique(s). Rehome or remove the subtechnique-of relationships before converting this technique to a subtechnique.` |
| Parent technique does not exist | `Parent technique with ATT&CK ID T#### not found` |
| `parentTechniqueAttackId` missing | Missing parameter error |
| `parentTechniqueAttackId` invalid format | `Invalid parent technique ATT&CK ID format: .... Must be T####.` |

#### 404 Not Found

Returned when the target technique (`stixId`) does not exist.

---

## Convert Subtechnique to Technique

### Usage

```
POST /api/techniques/:stixId/convert-to-technique
```

Where `:stixId` is the STIX ID of the subtechnique to convert.

Requires **editor** role or higher.

No request body is required.

### What Happens

1. **Validation** — The endpoint verifies that:
   - The target technique exists and is currently a subtechnique (`x_mitre_is_subtechnique` is `true`)
   - The target technique is not revoked

2. **New version created** — A new version of the technique is saved with:
   - `x_mitre_is_subtechnique` set to `false`
   - A new ATT&CK ID in technique format (e.g., `T1235`), auto-generated as the next available number
   - Updated `external_references` with the new ATT&CK ID and URL
   - A new `modified` timestamp

3. **Relationship deprecated** — Any active `subtechnique-of` relationships where this object is the `source_ref` are deprecated (a new version of each relationship is created with `x_mitre_deprecated` set to `true`). The original relationship versions are preserved in history.

### Response

On success, returns **200 OK** with a [workflow response envelope](../../docs/developer/workflow-response-pattern.md):

```json
{
  "workflow": "convert-to-technique",
  "primary": {
    "workspace": {
      "workflow": { "state": "work-in-progress" },
      "attack_id": "T1235"
    },
    "stix": {
      "type": "attack-pattern",
      "id": "attack-pattern--15dbf668-795c-41e6-8219-f0447c0e64ce",
      "name": "Example Subtechnique",
      "x_mitre_is_subtechnique": false,
      "external_references": [
        {
          "source_name": "mitre-attack",
          "external_id": "T1235",
          "url": "https://attack.mitre.org/techniques/T1235"
        }
      ]
    }
  },
  "sideEffects": {
    "created": [],
    "modified": [],
    "deprecated": [
      {
        "workspace": { "workflow": { "state": "reviewed" } },
        "stix": {
          "type": "relationship",
          "relationship_type": "subtechnique-of",
          "source_ref": "attack-pattern--15dbf668-795c-41e6-8219-f0447c0e64ce",
          "target_ref": "attack-pattern--a1234567-abcd-1234-abcd-1234567890ab",
          "x_mitre_deprecated": true
        }
      }
    ],
    "deleted": { "count": 0, "stixIds": [] }
  },
  "warnings": []
}
```

| Field | Description |
|-------|-------------|
| `workflow` | Always `"convert-to-technique"` |
| `primary` | The technique in its post-conversion state (new version) |
| `sideEffects.deprecated` | The `subtechnique-of` relationship(s) that were deprecated |
| `sideEffects.created` | Empty for this workflow |
| `warnings` | Non-fatal issues encountered during the workflow |

### Error Responses

#### 400 Bad Request

| Condition | Details |
|-----------|---------|
| Technique is not a subtechnique | `Technique attack-pattern--... is not a subtechnique` |
| Technique is revoked | `Cannot convert a revoked technique` |

#### 404 Not Found

Returned when the target technique (`stixId`) does not exist.
