# The 'Revoke Object' workflow

The Revoke Object workflow allows you to revoke an existing object in the system, which creates a new revoked version of the object with a new STIX ID and updated metadata. The original object remains in the system but is marked as revoked and is not returned in default queries.

Formerly, this workflow was orchestrated by the frontend, which made multiple API calls to achieve the desired result. Now, the backend has a dedicated endpoint that handles the entire revoke workflow in a single request, simplifying the process and reducing the potential for errors.

## Usage

To revoke an object, send a POST request to the following endpoint:

```
POST /api/objects/:stixId/revoke
```
Where `:stixId` is the STIX ID of the object you want to revoke.

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

- `preserveRelationships` (boolean): If set to `true`, the workflow will attempt to preserve existing relationships by substituting the revoked object with the new revoked version in those relationships. If not set or set to `false`, all relationships involving the revoked object will be deleted. Notably, if the revoking object (Object B) already participates in a relationship with the same source, target, and relationship type as an existing relationship of the revoked object (Object A), that relationship will be preserved as-is without creating a new relationship for Object B. 

## Response

### Success Response

On success, the API will return a 200 OK response with the following body, which includes the revoked object, the new "revoked-by" relationship, and a summary of how relationships were handled:

```json
{
  "revokedObject": {
    "workspace": {
      "workflow": {
        "state": "work-in-progress",
        "created_by_user_account": "identity--3562fbf3-795f-4955-8e64-6c964f598e1c"
      },
      "attack_id": "T0006",
      "collections": [],
      "embedded_relationships": []
    },
    "stix": {
      "type": "attack-pattern",
      "spec_version": "2.1",
      "id": "attack-pattern--83efdc56-d35f-4508-9f10-152bbfffde79",
      "created": "2026-03-27T14:31:52.711Z",
      "created_by_ref": "identity--c21f0782-50a8-4e5f-87a1-b56703e78e48",
      "revoked": true,
      "external_references": [
        {
          "source_name": "mitre-attack",
          "url": "https://attack.mitre.org/techniques/T0006",
          "external_id": "T0006"
        }
      ],
      "object_marking_refs": [
        "marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168"
      ],
      "modified": "2026-03-27T14:31:52.744Z",
      "name": "technique-E",
      "description": "This technique will be revoked.",
      "kill_chain_phases": [
        {
          "kill_chain_name": "kill-chain-name-1",
          "phase_name": "phase-1"
        }
      ],
      "x_mitre_attack_spec_version": "3.3.0",
      "x_mitre_contributors": [],
      "x_mitre_deprecated": false,
      "x_mitre_is_subtechnique": false,
      "x_mitre_modified_by_ref": "identity--c21f0782-50a8-4e5f-87a1-b56703e78e48",
      "x_mitre_platforms": [
        "platform-1"
      ]
    }
  },
  "revokedByRelationship": {
    "workspace": {
      "workflow": {
        "created_by_user_account": "identity--3562fbf3-795f-4955-8e64-6c964f598e1c"
      },
      "collections": [],
      "embedded_relationships": []
    },
    "stix": {
      "type": "relationship",
      "spec_version": "2.1",
      "id": "relationship--64d45634-f855-4fea-b084-33a87858406d",
      "created": "2026-03-27T14:31:52.745Z",
      "created_by_ref": "identity--c21f0782-50a8-4e5f-87a1-b56703e78e48",
      "object_marking_refs": [],
      "modified": "2026-03-27T14:31:52.745Z",
      "relationship_type": "revoked-by",
      "source_ref": "attack-pattern--83efdc56-d35f-4508-9f10-152bbfffde79",
      "target_ref": "attack-pattern--ab992c5a-4a03-4374-ad15-440fac072760",
      "x_mitre_modified_by_ref": "identity--c21f0782-50a8-4e5f-87a1-b56703e78e48",
      "x_mitre_attack_spec_version": "3.3.0",
      "external_references": []
    },
    "_id": "69c694d8eb64093bcd182721",
    "__v": 0,
    "warnings": []
  },
  "relationshipsSummary": {
    "deleted": 1,
    "transferred": 0,
    "warnings": [],
    "duplicatesSkipped": 1
  }
}
```


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