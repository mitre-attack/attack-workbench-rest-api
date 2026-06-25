When you post/create a new object with `workspace: {}` a TypeError will throw:
```
  message: "catch all: TypeError: Cannot set properties of undefined (setting 'created_by_user_account')",
```

The root cause is this line in `BaseService.create`:
```
    if (options.userAccountId) {
      data.workspace.workflow.created_by_user_account = options.userAccountId;
    }
```

Here's the `data` payload it's trying to process:
```
{
  workspace: {
    attack_id: "M1077",
  },
  stix: {
    type: "course-of-action",
    spec_version: "2.1",
    created: "2026-03-26T20:16:47.000Z",
    modified: "2026-03-26T20:16:47.000Z",
    id: "course-of-action--059ba11e-e3dc-49aa-84ca-88197f40d4eb",
    created_by_ref: "identity--6c14b02a-d7d6-49e3-a1f6-1a8b9f0ff24f",
    external_references: [
      {
        source_name: "mitre-attack",
        external_id: "M1077",
        url: "https://attack.mitre.org/mitigations/M1077",
      },
    ],
    object_marking_refs: [
      "marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168",
    ],
    name: "Application Isolation and Sandboxing",
    description: "Restrict the execution of code to a virtual environment on or in-transit to an endpoint system.",
    labels: [
      "IEC 62443-3-3:2013 - SR 5.4",
      "IEC 62443-4-2:2019 - CR 5.4",
      "NIST SP 800-53 Rev. 5 - SI-3",
    ],
    x_mitre_modified_by_ref: "identity--6c14b02a-d7d6-49e3-a1f6-1a8b9f0ff24f",
    x_mitre_deprecated: false,
    x_mitre_domains: [
      "ics-attack",
    ],
    x_mitre_version: "1.0",
    x_mitre_attack_spec_version: "3.3.0",
  },
}
```


---

This error pops up during the revoke workflow due to the repository layer returning Date objects in returned entities.
```
[
  {
    message: "created is Invalid STIX timestamp format: must be an RFC3339 timestamp with a timezone specification of 'Z'.",
    path: [
      "created",
    ],
    code: "invalid_type",
    input: undefined,
  },
  {
    message: "modified is Invalid STIX timestamp format: must be an RFC3339 timestamp with a timezone specification of 'Z'.",
    path: [
      "modified",
    ],
    code: "invalid_type",
    input: undefined,
  },
]
```

The service layer needs to coerce them before running through ADM validation.
The proper solution would be to address this inside the repository layer. Essentially, the DAO should normalize dates when returning aggregation results. Since its the boundary between MongoDB and the application layer, consumers shouldn't need to know Mongoose return Date objects, let alone Mongoose artifacts like `__t` and `__v`. 
However, updating the repository layer to consistently return STIX compliant date strings as opposed to Date objects would break a lot of things. At least 9 files would break, including critical paths:                                  
                                                                                                                      
  - relationships-service.js and reports-service.js — sort by Date subtraction: b.stix.modified - a.stix.modified     
  (works with Dates, not strings)                                                                                     
  - sync-collection-indexes-task.js — calls .getTime() directly on stix.modified                                      
  - Release tracks layer (4+ files) — heavy use of .getTime() for conflict resolution, deduplication, export schemas  
  - detection-strategies-repository.js — direct > comparison on stix.modified Date objects                            
                                                                                                                      
The compromise solution: normalize dates in create()'s input pipeline. It's a single fix point, it doesn't change the repository contract, and it protects any future code path that feeds DB data back through create().
```
/**
* Coerces any STIX date fields that are JavaScript Date objects into ISO-8601 strings.
*
* Mongoose schemas define timestamp fields (created, modified, start_time, stop_time)
* as `{ type: Date }`, so documents retrieved from MongoDB carry JS Date objects.
* The ADM validation layer (Zod) expects RFC3339 strings.  This method bridges that
* gap so that data originating from the repository can safely pass through create()
* without manual per-call-site coercion.
*
* @param {Object} data - The request data ({ stix, workspace })
*/
normalizeDateFields(data) {
const stix = data.stix;
if (!stix) return;

const dateFields = ['created', 'modified', 'start_time', 'stop_time'];
for (const field of dateFields) {
    if (stix[field] instanceof Date) {
    stix[field] = stix[field].toISOString();
    }
}
}
```

We will likely address this more holistically using systems design principles in the future. For now, this is the most pragmatic solution.