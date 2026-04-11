# The 'Revoke Object' workflow

The Revoke Object workflow allows you to revoke an existing object in the system, which creates a new revoked version of the object with a new STIX ID and updated metadata. The original object remains in the system but is marked as revoked and is not returned in default queries.

Formerly, this workflow was orchestrated by the frontend, which made multiple API calls to achieve the desired result. Now, the backend has a dedicated endpoint that handles the entire revoke workflow in a single request, simplifying the process and reducing the potential for errors.

## Usage

To revoke an object, send a POST request to the following endpoint:

```
POST /api/:type/:stixId/revoke
```
Where `:stixId` is the STIX ID of the object you want to revoke and `:type` is the type of the object.

e.g., `POST /api/attack-patterns/attack-pattern--00290ac5-551e-44aa-bbd8-c4b913488a6c/revoke`

**Request Body**:

Specify the `id` and `modified` timestamp for the revoked object in the request body. The `id` should be a new STIX ID that follows the standard format (e.g., `attack-pattern--xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`), and the `modified` timestamp should be in RFC3339 format.

```json
{
  "revoking": {
    "stixId": "attack-pattern--00290ac5-551e-44aa-bbd8-c4b913488a6f",
    "modified": "2022-10-24T15:09:07.609Z"
  }
}
```

### Query Parameters

Optionally, you can set the following query parameter to preserve relationships:

- `preserveRelationships` (boolean): If set to `true`, the workflow clones each relationship that references the revoked object so that it points to the revoking object instead, then deprecates the original. If not set or set to `false`, relationships referencing the revoked object are deprecated without being transferred. During transfer, each relationship on the revoked object (Object A) is rewritten so that Object A's STIX ID is replaced with Object B's STIX ID. If the revoking object (Object B) already participates in an equivalent relationship (i.e., one with the same source, target, and relationship type after substitution), the transfer is skipped and a warning is included in the response. Additionally, `subtechnique-of` relationships are never transferred — they are deprecated along with the other relationships but are excluded from the preservation process because transferring hierarchy relationships could create invalid parent/child states. A warning is emitted for each skipped `subtechnique-of` relationship.

### Techniques and Subtechniques

Both techniques (parents) and subtechniques are of STIX type `attack-pattern`, so the type check alone does not prevent cross-hierarchy revocations. The following rules apply:

| Scenario | Allowed? | Notes |
|---|---|---|
| Parent revokes parent | Yes | Standard flow, no hierarchy concerns |
| Sub revokes sub (same parent) | Yes | `subtechnique-of` relationships are skipped during preservation (shared parent) |
| Sub revokes sub (different parent) | **No** | Would give the revoking subtechnique two parents, which is not permitted |
| Parent revokes sub | Yes | `subtechnique-of` relationships are skipped during preservation |
| Sub revokes parent (parent has no children) | Yes | `subtechnique-of` relationships are skipped during preservation |
| Sub revokes parent (parent has children) | **No** | Would orphan the parent's subtechniques; convert the subtechnique to a parent first via the conversion endpoint |

When a revocation is blocked due to these rules, the API returns a **400 Bad Request** with a message explaining the constraint violation.

## Response

### Success Response

On success, the API returns a **200 OK** with a [workflow response envelope](../../docs/developer/workflow-response-pattern.md). The response includes the revoked object, the `revoked-by` relationship, any transferred relationships, and any deprecated relationships:

```json
{
  "workflow": "revoke",
  "primary": {
    "workspace": {
      "workflow": { "state": "work-in-progress" },
      "attack_id": "T0006"
    },
    "stix": {
      "type": "attack-pattern",
      "spec_version": "2.1",
      "id": "attack-pattern--83efdc56-d35f-4508-9f10-152bbfffde79",
      "revoked": true,
      "modified": "2026-03-27T14:31:52.744Z",
      "name": "technique-E"
    }
  },
  "sideEffects": {
    "created": [
      {
        "workspace": { "workflow": {} },
        "stix": {
          "type": "relationship",
          "relationship_type": "revoked-by",
          "source_ref": "attack-pattern--83efdc56-d35f-4508-9f10-152bbfffde79",
          "target_ref": "attack-pattern--ab992c5a-4a03-4374-ad15-440fac072760"
        }
      }
    ],
    "modified": [],
    "deprecated": [
      {
        "workspace": { "workflow": { "state": "reviewed" } },
        "stix": {
          "type": "relationship",
          "relationship_type": "uses",
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
| `workflow` | Always `"revoke"` |
| `primary` | The technique in its post-revocation state (`revoked: true`) |
| `sideEffects.created` | The `revoked-by` relationship, plus any transferred relationships (when `preserveRelationships=true`) |
| `sideEffects.deprecated` | Relationships that referenced the revoked object, deprecated with `x_mitre_deprecated: true` |
| `warnings` | Non-fatal issues (e.g., duplicate relationships skipped during transfer) |

> **Note:** When `preserveRelationships=true`, relationships are cloned to point to the revoking object (appearing in `sideEffects.created`) and the originals are deprecated (appearing in `sideEffects.deprecated`). If a duplicate relationship already exists on the revoking object, the transfer is skipped and a warning is emitted instead.

### Error Responses

#### 409 Conflict

If you attempt to revoke an object that has already been revoked, you will receive a 409 Conflict response with the following message:

```json
{
  "message": "Object has already been revoked",
  "details": "Object attack-pattern--00290ac5-551e-44aa-bbd8-c4b913488a6c is already revoked"
}
```

#### 404 Not Found

If you attempt to revoke an object that does not exist, you will receive a 404 Not Found response with the following message:

```json
{
  "message": "Document not found",
  "details": "Object B with stixId attack-pattern--00290ac5-551e-44aa-bbd8-c4b913488a6f and modified 2022-10-24T15:09:07.609Z not found"
}
```

#### 400 Self Revocation Error

If you attempt to revoke an object by revoking with the same STIX ID and modified timestamp as the original object (i.e., self-revocation), you will receive a 400 Bad Request response with the following message:

```html
"An object cannot revoke itself"
```