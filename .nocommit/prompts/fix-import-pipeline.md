We recently made a lot of changes to the core `create` and `updateFull` pipelines for STIX objects. See `BaseService` for details.

One of the biggest changes was the introduction of the ATT&CK Data Model (ADM) for validating STIX objects. After the STIX object has been composed from the user's request body and right before it's actually created or updated via the repository, we now validate the composed object against the ADM. If there are validation errors, we throw a `ValidationError` with details about the validation errors and warnings (unless the `dryRun` option is set, in which case we just return the validation errors and warnings in the response without throwing an error).

This change has broken the 'Import Collection Bundle' workflow.

The 'Import Collection Bundle' workflow allows users to import a STIX bundle containing multiple objects. It is orchestrated by the `app/services/stix/collection-bundles-service/import-bundle.js` module, which processes each object in the bundle and creates it using the appropriate service. The function is attached to the `POST /collection-bundles` endpoint in the `app/routes/collection-bundles-routes.js` module and `app/controllers/collection-bundles-controller.js` controller.

In `import-bundle.js`, we call each service's `create` method with the `import` option set to `true`:
```javascript
try {
    // TODO should we bypass validation for imports?
    // or possibly fail open on validation errors where we record the validation error on the object but still allow the import to proceed?
    // for validation errors, the object may need to be placed into a quarantined state where it is visible but read-only except through a PUT operation that allows updates to be made to fix the validation errors
    await service.create(newObject, { import: true });
} catch (err) {
    if (err.message === service.errors?.duplicateId || err instanceof DuplicateIdError) {
        throw err;
    }
    // Record save error but continue import
    const importError = {
        object_ref: importObject.id,
        object_modified: importObject.modified,
        error_type: importErrors.saveError,
        error_message: err.message,
    };
    logger.verbose(
        `Import Bundle Error: Unable to save object. id=${importObject.id}, modified=${importObject.modified}, ${err.message}`,
    );
    importedCollection.workspace.import_categories.errors.push(importError);
}
```
The `import` option is used to indicate that the object is being created as part of an import operation. In the `BaseService`, we check for this option and run a different `create` pipeline that bypasses certain steps. In actuality, we have not given sufficient thought to how the `import` option should affect the `create` pipeline.

To ground the discussion, let's consider the case of importing the ATT&CK Mobile bundle. 1997 new objects were added. 538 objects could not be imported. The import errors are captured in `import-errors.json`. In addition, I modified the `BaseService._createFromImport` method to log the validation errors and warnings right before throwing the `ValidationError`. The logged validation errors and warnings are captured in `import_bundle_runtime_logs.txt`. In here, we see the exact Zod validation errors that are occurring during the import.

Let's look at at some examples.

The following object is triggering one ADM error:
```
{
  workspace: {
    collections: [
      {
        collection_ref: "x-mitre-collection--dac0d2d7-8653-445c-9bff-82f934c1e858",
        collection_modified: "2025-11-13T14:00:00.188Z",
      },
    ],
    attack_id: "DET0680",
  },
  stix: {
    type: "x-mitre-detection-strategy",
    spec_version: "2.1",
    id: "x-mitre-detection-strategy--9935655b-cd9b-485f-84ea-1b3b4b765413",
    created: "2025-10-21T15:10:28.402Z",
    created_by_ref: "identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5",
    external_references: [
      {
        source_name: "mitre-attack",
        url: "https://attack.mitre.org/detectionstrategies/DET0680",
        external_id: "DET0680",
      },
    ],
    object_marking_refs: [
      "marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168",
    ],
    modified: "2025-10-21T15:10:28.402Z",
    name: "Detection of Security Software Discovery",
    x_mitre_modified_by_ref: "identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5",
    x_mitre_version: "1.0",
    x_mitre_attack_spec_version: "3.3.0",
    x_mitre_domains: [
      "mobile-attack",
    ],
    x_mitre_analytic_refs: [
      "x-mitre-analytic--87d2ccc4-f82e-493d-9c6f-03303253aec2",
      "x-mitre-analytic--9c721bd4-75df-4381-bd70-29679aa78a4b",
    ],
    x_mitre_deprecated: false,
  },
}
```

Here is the ADM error:
```
[
  {
    message: "x_mitre_contributors is Invalid input: expected array, received undefined",
    path: [
      "x_mitre_contributors",
    ],
    code: "invalid_type",
    input: undefined,
  },
]
```

This is an _actual_ issue. The detection strategy should absolutely have an `x_mitre_contributors` field.

This begs the question: how should we handle it?

One options is that we can permit the object to be imported, but block subsequent POST requests for the object and instead permit only PUT operations. For context, the POST operations results in new permutations of the object being created, i.e., when you POST an object, a new document is created in the database. PUT on the other hand modifies an existing document in-place. Thus, the idea here is that we can permit users to do in-place modifications to the imported document to make it compliant.

In addition, it might be beneficial to capture the validation errors in the entity document. This would make it easy to query a list of objects in the database with known validation issues, and it would also make it easy for GET/retrieve requests to return responses that include the known errors so the user can be informed that the retrieved object is not fully STIX/ATT&CK compliant.

Another issue is that we are validating the ATT&CK bundles which contain objects that pre-date the ADM; there are bound to be validation issues that we can simply ignore, at least until we can review them and decide whether to retroactively amend them or update the ATT&CK specification (the ADM) to accommodate them. Thus, we need to identify non-revoked and non-deprecated objects and create bypass rules for them.

Additionally, we need to implement logic for bypassing ADM validation on revoked and deprecated objects when importing. We don't retroactively amend revoked objects or deprecated objects by design, so there's no need to validate them (or if we do validate them, we should fail open).

Please devise a plan to address the following:

1. Capture all of the validation errors that occur during bundle importation so we can review them. 
2. Update the Mongoose models to enable storing validation errors to make querying for objects with known validation errors easier. Make sure to capture information about which ADM version was used. There are two values we should capture: the ATT&CK Specification version, and the ADM TypeScript library version. The former can be retrieved from a global const which is exported from the ADM library root path: `export const ATTACK_SPEC_VERSION = '3.3.0' as const;`. The latter can be inferred/retrieved from the ADM's `package.json`, or perhaps we can grab it from the server's `@mitre-attack/attack-data-model` dependency version. 
3. During import, fail-open or skip validation for revoked objects.
4. During import, fail-open or skip validation for deprecated objects.
5. Amend the create pipeline to reject requests if object has known validation issues. Restrict writing of objects with known validation issues to PUT/updateFull operations only.

