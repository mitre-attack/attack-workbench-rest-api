Feedback

I don't mind amending the validation bypass rule model to accommdate distinguishing between different types of trigger events. i.e., I don't mind the spirit of adding `autoCreatedReason`. However, the approach seems under developed. If we stick with this approach, we should constrain the possible values of `autoCreatedReason` to a specific set of strings that are defined in a central location, and we should also add a `triggerEvent` field that specifies the event that triggered the bypass rule to be created. This way, we can easily query bypass rules based on the trigger event and reason, and we can also ensure consistency in the values of `autoCreatedReason`.

Creating an entirely new service to handle the propagation of identity changes seems like overkill. Since the propogation service will rely on the `AttackObject` model/repository to make updates to objects, it seems like we could just add methods to the `AttackObjectService` to handle the propogation logic. We could then call these methods from the `IdentitiesService` when an identity is created, updated, or deleted. The `AttackObjectsService` would just listen for the `SYSTEM_CONFIGURATION_IDENTITY_CHANGED` event and then execute the necessary updates to attack objects based on the identity changes.

Rather than add `organization_identity_history` to the one system configuration entity/document, I think it would be better to create new system configuration document for each organization identity change. This way, we can maintain a clear history of all system configuration changes over time, and we can also easily query this history if needed. Each time the system configuration is changed, we would create a new system configuration document with the new updated values and a timestamp (which we can track via a new `created_at` field). This approach aligns better with the way we version control other types of entities in the system.

Currently, system configuration documents look like the following:

```json
{
  "_id": {
    "$oid": "6969691cd1aed3fbdf8f8007"
  },
  "organization_identity_ref": "identity--6c14b02a-d7d6-49e3-a1f6-1a8b9f0ff24f",
  "default_marking_definitions": [],
  "organization_namespace": {
    "range_start": 0,
    "prefix": "SEAN"
  },
  "__v": 0,
  "anonymous_user_account_id": "identity--69d554cd-8ce0-41d0-8aef-502a821525f1"
}
```

Thus, we'll need to edit the workflows for creating/updating organization identities (which maps to the `organization_identity_ref` field in the system configuration), as well as the workflows for editing the namespace prefix (which maps to the `organization_namespace.prefix` field in the system configuration). Each time either of these fields is updated, we would create a new system configuration document with the updated values and a timestamp. This way, we can maintain a clear history of all changes to the organization identity and namespace prefix over time.

---

This draft looks good overall. I just want to clarify an important point about the propagation of identity changes:

1. An object that has been imported into Workbench but not edited yet: In this case, we expect `created_by_ref` and `x_mitre_modified_by_ref` to both point to an external identity that is not part of the provenance chain. In this case, we would NOT update either field, because the object was created externally and has not been modified by any internal identities.
2. An object that has been created within Workbench and has been edited by internal identities: In this case, we expect `created_by_ref` to point to an external identity that is not part of the provenance chain, and we expect `x_mitre_modified_by_ref` to point to one or more internal identities that are part of the provenance chain. In this case, we would update `x_mitre_modified_by_ref` values to point to the organization identity, but we would NOT update `created_by_ref`, because the object was created externally.
3. An object that was created within Workbench: In this case, we expect both `created_by_ref` and `x_mitre_modified_by_ref` to point to one or more internal identities that are part of the provenance chain. In this case, we would update both `created_by_ref` and `x_mitre_modified_by_ref` values to point to the organization identity, because the object was created and modified by internal identities.

---

Observed issues from looking through the code changes:

1. For the change to the `systemConfigurationSchema`, we need to add a startup script that will backfill existing system configuration documents with the new `created_at` field. This script will need to query all existing system configuration documents and add a `created_at` field with the current timestamp to each document. This way, we can ensure that all system configuration documents have a `created_at` field, which will allow us to maintain a clear history of changes over time. Luckily, we already have a workflow for running startup scripts: see `www/bin` calling `migrateDatabase` for details.

2. In the `system-configuration-controller.js` module, we should edit all endpoints to pass `next` so we can stop handling each service layer exception manually and instead return `next(err)` and let the global error handler take care of it. See any of the other controllers for examples of this pattern.

3. In `attack-objects-service.js`, you imported the `AttackObject` Mongoose model. This violates the separation of concerns between the service layer and the repository layer. The service layer should not be directly importing Mongoose models, as this creates tight coupling between the layers and makes it harder to maintain and test the code. Instead, the service layer should only interact with the repository layer, which is responsible for managing the Mongoose models and database interactions.

The integration test results from `npm test` are in `npm_test_output.txt`. The 777 core tests are passing, but there are 9 failing tests in `adm-validation-middleware.spec.js`:
```
  8 passing (1s)
  9 failing

  1) ADM Validation Middleware
       POST operations - work-in-progress (partial validation)
         should accept valid complete data in work-in-progress state:
     Error: expect(received).toBe(expected) // Object.is equality

Expected: 201
Received: 400
      at Context.<anonymous> (app/tests/middleware/adm-validation-middleware.spec.js:184:26)
      at process.processTicksAndRejections (node:internal/process/task_queues:105:5)

  2) ADM Validation Middleware
       POST operations - work-in-progress (partial validation)
         should accept partial data in work-in-progress state (missing optional fields):
     Error: expect(received).toBe(expected) // Object.is equality

Expected: 201
Received: 400
      at Context.<anonymous> (app/tests/middleware/adm-validation-middleware.spec.js:217:26)
      at process.processTicksAndRejections (node:internal/process/task_queues:105:5)

  3) ADM Validation Middleware
       POST operations - reviewed (full validation)
         should accept valid complete data in reviewed state:
     Error: expect(received).toBe(expected) // Object.is equality

Expected: 201
Received: 400
      at Context.<anonymous> (app/tests/middleware/adm-validation-middleware.spec.js:273:26)
      at process.processTicksAndRejections (node:internal/process/task_queues:105:5)

  4) ADM Validation Middleware
       PUT operations - work-in-progress (partial validation)
         "before each" hook for "should accept valid updates in work-in-progress state":
     Error: expected 201 "Created", got 400 "Bad Request"
      at Context.<anonymous> (app/tests/middleware/adm-validation-middleware.spec.js:388:10)
      at process.processImmediate (node:internal/timers:491:21)
  ----
      at Test._assertStatus (node_modules/supertest/lib/test.js:309:14)
      at /Users/ssica/Development/attack/workbench/attack-workbench-rest-api/node_modules/supertest/lib/test.js:365:13
      at Test._assertFunction (node_modules/supertest/lib/test.js:342:13)
      at Test.assert (node_modules/supertest/lib/test.js:195:23)
      at localAssert (node_modules/supertest/lib/test.js:138:14)
      at Server.<anonymous> (node_modules/supertest/lib/test.js:152:11)
      at Object.onceWrapper (node:events:632:28)
      at Server.emit (node:events:518:28)
      at emitCloseNT (node:net:2416:8)
      at process.processTicksAndRejections (node:internal/process/task_queues:89:21)

  5) ADM Validation Middleware
       PUT operations - reviewed (full validation)
         "before each" hook for "should accept valid complete updates in reviewed state":
     Error: expected 201 "Created", got 400 "Bad Request"
      at Context.<anonymous> (app/tests/middleware/adm-validation-middleware.spec.js:516:10)
      at process.processImmediate (node:internal/timers:491:21)
  ----
      at Test._assertStatus (node_modules/supertest/lib/test.js:309:14)
      at /Users/ssica/Development/attack/workbench/attack-workbench-rest-api/node_modules/supertest/lib/test.js:365:13
      at Test._assertFunction (node_modules/supertest/lib/test.js:342:13)
      at Test.assert (node_modules/supertest/lib/test.js:195:23)
      at localAssert (node_modules/supertest/lib/test.js:138:14)
      at Server.<anonymous> (node_modules/supertest/lib/test.js:152:11)
      at Object.onceWrapper (node:events:632:28)
      at Server.emit (node:events:518:28)
      at emitCloseNT (node:net:2416:8)
      at process.processTicksAndRejections (node:internal/process/task_queues:89:21)

  6) ADM Validation Middleware
       Server-controlled field stripping
         should silently strip x_mitre_attack_spec_version from client input:
     Error: expect(received).toBe(expected) // Object.is equality

Expected: 201
Received: 400
      at Context.<anonymous> (app/tests/middleware/adm-validation-middleware.spec.js:673:26)
      at process.processTicksAndRejections (node:internal/process/task_queues:105:5)

  7) ADM Validation Middleware
       Server-controlled field stripping
         should silently strip ATT&CK external references from client input:
     Error: expect(received).toBe(expected) // Object.is equality

Expected: 201
Received: 400
      at Context.<anonymous> (app/tests/middleware/adm-validation-middleware.spec.js:705:26)
      at process.processTicksAndRejections (node:internal/process/task_queues:105:5)

  8) ADM Validation Middleware
       dryRun support
         should return composed object without persisting on POST with dryRun=true:
     Error: expect(received).toBe(expected) // Object.is equality

Expected: 200
Received: 400
      at Context.<anonymous> (app/tests/middleware/adm-validation-middleware.spec.js:739:26)
      at process.processTicksAndRejections (node:internal/process/task_queues:105:5)

  9) ADM Validation Middleware
       dryRun support
         should return composed object without persisting on PUT with dryRun=true:
     Error: expected 201 "Created", got 400 "Bad Request"
      at Context.<anonymous> (app/tests/middleware/adm-validation-middleware.spec.js:798:10)
      at process.processImmediate (node:internal/timers:491:21)
  ----
      at Test._assertStatus (node_modules/supertest/lib/test.js:309:14)
      at /Users/ssica/Development/attack/workbench/attack-workbench-rest-api/node_modules/supertest/lib/test.js:365:13
      at Test._assertFunction (node_modules/supertest/lib/test.js:342:13)
      at Test.assert (node_modules/supertest/lib/test.js:195:23)
      at localAssert (node_modules/supertest/lib/test.js:138:14)
      at Server.<anonymous> (node_modules/supertest/lib/test.js:152:11)
      at Object.onceWrapper (node:events:632:28)
      at Server.emit (node:events:518:28)
      at emitCloseNT (node:net:2416:8)
      at process.processTicksAndRejections (node:internal/process/task_queues:89:21)
```

---

The tests are failing because the validation bypass rules that are needed to allow the test objects to be created/updated without `x_mitre_modified_by_ref` values are not being created. Here's an example of one of the validation errors that occurs in one of the tests:
```
{
  success: false,
  error: {
    name: "ZodError",
    message: `[
  {
    "code": "invalid_value",
    "values": [
      "identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5"
    ],
    "path": [
      "x_mitre_modified_by_ref"
    ],
    "message": "Invalid input: expected \\"identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5\\""
  }
]`,
  },
}
```

This is occurring because the necessary bypass rules are not being created at startup when the placeholder organization identity is created.

The app starts via `bin/www`. In this startup script, we run `await databaseConfiguration.checkSystemConfiguration()`, which in turn calls `checkForOrganizationIdentity`; that then calls `createPlaceholderOrganizationIdentity()`. This is where we should add logic to create the necessary validation bypass rules for `x_mitre_modified_by_ref`. All we need to do is emit the `SYSTEM_CONFIGURATION_IDENTITY_CHANGED` event from `createPlaceholderOrganizationIdentity()`; that will trigger the `ValidationBypassesService` to create the necessary bypass rules for `x_mitre_modified_by_ref` validation. 

This should ensure that the necessary bypass rules are always in place whenever the app is started, which will allow the tests to pass successfully.

---

I don't think this fix resolves the issue and here's why: When the application starts up, it runs `await databaseConfiguration.checkSystemConfiguration()`.
This is turn calls `createPlaceholderOrganizationIdentity()`, which calls `systemConfigurationService.setOrganizationIdentity()`.
`SystemConfigurationService.setOrganizationIdentity()` only emits the `SYSTEM_CONFIGURATION_IDENTITY_CHANGED` event if there is a change in the organization identity. However, when the app starts up for the first time and creates the placeholder organization identity, there is no "change" per se, because there was no existing organization identity before. Thus, the `SYSTEM_CONFIGURATION_IDENTITY_CHANGED` event is not emitted during startup, and the validation bypass rules are not created. I verified this in the debugger by putting a breakpoint in the `setOrganizationIdentity()` method and observed that `currentConfig` is `null` when the placeholder identity is created, so the condition to emit the event is not met.

---

The issue is persisting because there are no listeners for the `SYSTEM_CONFIGURATION_IDENTITY_CHANGED` event at the time when the placeholder organization identity is created during startup. The listeners for this event are registered in the `ValidationBypassesService`, which is initialized in the `services/index.js` module. However, the `checkSystemConfiguration()` function (which calls `createPlaceholderOrganizationIdentity()`) is executed before the services are initialized in the startup sequence. 

```javascript
// in bin/www

// Check for valid database configuration
const databaseConfiguration = require('../app/lib/database-configuration');
await databaseConfiguration.checkSystemConfiguration();

// Create the app
const app = await require('../app').initializeApp(); // <-- services, including event listeners, are initialized in this step
```

Thus, when the placeholder organization identity is created and the `SYSTEM_CONFIGURATION_IDENTITY_CHANGED` event is emitted, there are no listeners registered to handle that event, so the validation bypass rules are not created.


---

All tests passing.
Summary of changes:

feat: version system config, validate org identity, and propagate identity changes to objects

- Refactor system-configuration-controller to use \`next\` for error handling; defer to global error handler instead of handling service layer exceptions manually in the controller.
- Add new \`app/lib/bypass-rule-constants.js\` module to define constants for validation bypass rule reasons and trigger events.
- Update \`app/lib/database-configuration.js\` to load the \`ValidationBypassesService\` before calling \`checkSystemConfiguration()\`. This is critical to ensure that the event listeners for \`SYSTEM_CONFIGURATION_IDENTITY_CHANGED\` are registered before we attempt to emit that event during the creation of the placeholder organization identity. This way, when the placeholder identity is created and the event is emitted, the listeners will be in place to create the necessary validation bypass rules for \`x_mitre_modified_by_ref\`, which will allow the tests to pass successfully.
- Add new event type, \`SYSTEM_CONFIGURATION_IDENTITY_CHANGED\`, to \`app/lib/event-constants.js\`.
- Add new field, \`created_at\`, to \`systemConfigurationSchema\` in \`app/models/system-configuration.js\` to track when each system configuration document is created. This will allow us to maintain a clear history of changes to the system configuration over time.
- Add new field, \`autoCreatedReason\`, to the validation bypass rule model in \`app/models/validation-bypass-rule.js\` to track the reason why a validation bypass rule was automatically created. This will allow us to easily identify and manage validation bypass rules that were created due to identity changes.
- Add new repository method, \`AttackObjectsRepository.retrieveAllLatestByOrgIdentityRefs()\`, to retrieve all latest attack objects that have \`created_by_ref\` or \`x_mitre_modified_by_ref\` values matching any of the provided organization identity refs. This will allow us to easily find all attack objects that are associated with any of the organization identities in the history of organization identity changes.
- Add new repository method, \`SystemConfigurationRepository.retrieveAllDistinctIdentityRefs()\`, to retrieve a list of all distinct organization identity refs that are currently referenced in any system configuration documents. This will allow us to easily track all organization identities that have been used in the system configuration over time.
- Modify \`SystemConfigurationRepository.retrieveOne\` to retrieve the latest system configuration document based on the \`created_at\` timestamp, rather than just retrieving a single document without any sorting. This will ensure that we always get the most recent system configuration, which is important now that we are creating a new system configuration document each time there is a change to the organization identity or namespace prefix.
- Add new repository method, \`ValidationBypassesRepository.deleteByReason\`, to delete validation bypass rules based on the reason they were created. This will allow us to easily clean up old validation bypass rules that were created due to previous identity changes when a new identity change occurs.
- Add new event handler to \`AttackObjectsService\` to handle the \`SYSTEM_CONFIGURATION_IDENTITY_CHANGED\` event. This handler will retrieve all attack objects that are associated with any of the organization identities in the history of identity changes, and it will update their \`created_by_ref\` and \`x_mitre_modified_by_ref\` values to point to the new organization identity as appropriate based on the rules outlined in the implementation plan. This will ensure that all attack objects are properly updated to reflect the new organization identity whenever an identity change occurs.
- Refactor \`system-configuration-service.js\` to create a new system configuration document each time there is a change to the organization identity or namespace prefix, rather than updating an existing document. This will allow us to maintain a clear history of all changes to the system configuration over time, and it will also allow us to easily query this history if needed. Each time there is a change, we will create a new system configuration document with the updated values and a \`created_at\` timestamp. This way, we can track the evolution of the system configuration over time and have a clear record of when changes occurred.
- Add event hanlder to \`validation-bypasses-service.js\` to handle the \`SYSTEM_CONFIGURATION_IDENTITY_CHANGED\` event. This handler will create new validation bypass rules for \`x_mitre_modified_by_ref\` based on the new organization identity, and it will also clean up old validation bypass rules that were created due to previous identity changes. This will ensure that the necessary validation bypass rules are always in place whenever an identity change occurs, which will allow the tests to pass successfully and will also ensure that the system continues to function properly after identity changes.
- Add startup migration script to backfill existing system configuration documents with the new \`created_at\` field. This script will query all existing system configuration documents and add a \`created_at\` field with the current timestamp to each document. This way, we can ensure that all system configuration documents have a \`created_at\` field, which will allow us to maintain a clear history of changes over time. This script can be run as part of the existing database migration workflow that is executed at startup.

Please provide a conventional commit message for this PR that summarizes the list above. I plan to include the list above in the PR description, so the commit message can be a concise summary of the changes.


---

Findings:

Tactics:
Frontend:
```txt
x_mitre_shortname: x_mitre_shortname is Invalid option: expected one of "credential-access"|"execution"|"impact"|"persistence"|"privilege-escalation"|"lateral-movement"|"defense-evasion"|"exfiltration"|"discovery"|"collection"|"resource-development"|"reconnaissance"|"command-and-control"|"initial-access"|"inhibit-response-function"|"evasion"|"impair-process-control"|"network-effects"|"remote-service-effects"
```
dryRun res.body:
```json
{
    "message": "ADM validation failed",
    "details": [
        {
            "message": "x_mitre_shortname is Invalid option: expected one of \"credential-access\"|\"execution\"|\"impact\"|\"persistence\"|\"privilege-escalation\"|\"lateral-movement\"|\"defense-evasion\"|\"exfiltration\"|\"discovery\"|\"collection\"|\"resource-development\"|\"reconnaissance\"|\"command-and-control\"|\"initial-access\"|\"inhibit-response-function\"|\"evasion\"|\"impair-process-control\"|\"network-effects\"|\"remote-service-effects\"",
            "path": [
                "x_mitre_shortname"
            ],
            "code": "invalid_value"
        }
    ],
    "warnings": []
}
```

Possible solutions:
1. By default, run a migration script that preloads the database with the necessary validation bypass rules for `x_mitre_tactic_shortname` validation.
2. Add an option to load validation bypass rules from a JSON file at startup, and provide a default JSON file that includes the necessary bypass rules for `x_mitre_tactic_shortname` validation.
3. Nothing -- explicitly require teams add (POST) the necessary validation bypass rules for `x_mitre_tactic_shortname` validation as part of their setup process. We can provide documentation and examples to guide them through this process.

When namespace prefix changes, we need to propagate to all objects with that prefix that originated from the current Workbench deployment.


---

Notably, tactic creation will break if you set a non-compliant name because I reversed the rule that converts the ZodError to a warning — so you'll see something like this in the dryRun response:

{
    "message": "ADM validation failed",
    "details": [
        {
            "message": "x_mitre_shortname is Invalid option: expected one of \"credential-access\"|\"execution\"|\"impact\"|\"persistence\"|\"privilege-escalation\"|\"lateral-movement\"|\"defense-evasion\"|\"exfiltration\"|\"discovery\"|\"collection\"|\"resource-development\"|\"reconnaissance\"|\"command-and-control\"|\"initial-access\"|\"inhibit-response-function\"|\"evasion\"|\"impair-process-control\"|\"network-effects\"|\"remote-service-effects\"",
            "path": [
                "x_mitre_shortname"
            ],
            "code": "invalid_value"
        }
    ],
    "warnings": []
}

Possible solutions:
1. By default, run a migration script that preloads the database with the necessary validation bypass rules for x_mitre_tactic_shortname validation.
2. Add an option to load validation bypass rules from a JSON file at startup, and provide a default JSON file that includes the necessary bypass rules for x_mitre_tactic_shortname validation.
3. Do nothing — explicitly require teams add (POST) the necessary validation bypass rules for x_mitre_tactic_shortname validation as part of their setup process. We can provide documentation and examples to guide them through this process.
4. Tangential to this — we can/should build out a frontend CRUD interface for managing bypass rules

There are additional rules that were inadvertently left out of the original list of bypass rules that we will need to address:
```javascript
const ERROR_TRANSFORMATION_RULES = [
  // Server always sets x_mitre_attack_spec_version
  {
    fieldPath: ['x_mitre_attack_spec_version'],
    errorCode: 'invalid_type',
    stixType: 'all',
    suppressError: true,
  },
  // Server sets x_mitre_modified_by_ref based on authenticated user - user does not need to supply it
  {
    fieldPath: ['x_mitre_modified_by_ref'],
    errorCode: 'invalid_value',
    stixType: 'all',
    suppressError: true,
  },
  // Warn about non-standard tactic shortnames
  {
    fieldPath: ['x_mitre_shortname'],
    errorCode: 'invalid_value',
    stixType: 'x-mitre-tactic',
    warningMessage:
      'Tactic shortname does not match predefined ATT&CK tactics. This may prevent compatibility with official ATT&CK data but can be used for custom taxonomies.',
  },
  // Server sets x_mitre_domains for certain types (assigned during bundle export)
  {
    fieldPath: ['x_mitre_domains'],
    errorCode: 'invalid_type',
    stixType: ['intrusion-set', 'campaign', 'x-mitre-matrix', 'x-mitre-detection-strategy'],
    suppressError: true,
  },
  // Server sets object_marking_refs for certain types
  {
    fieldPath: ['object_marking_refs'],
    errorCode: 'invalid_type',
    stixType: ['campaign', 'identity'],
    suppressError: true,
  },
  // Server sets created_by_ref for certain types
  {
    // catch Zod error pertaining to field:
    fieldPath: ['created_by_ref'],
    // catch Zod error type:
    errorCode: 'invalid_type',
    // applicable to:
    stixType: ['campaign', 'x-mitre-matrix', 'x-mitre-asset', 'course-of-action'],
    suppressError: true,
  },
];
```

Here's an example of how to interpret the above rules:
```json
{
  // catch Zod error pertaining to field:
  "fieldPath": ['created_by_ref'],
  // catch Zod error type:
  "errorCode": 'invalid_type',
  // applicable to:
  "stixType": ['campaign', 'x-mitre-matrix', 'x-mitre-asset', 'course-of-action'],
  "suppressError": true,
},
```

Please build out the necessary functionality to load bypass rules via JSON file at startup. Create a default JSON file that addresses the above rules. Add an environment variable that allows teams to specify a custom JSON file if they want to override the default path. This way, we can ensure that the necessary bypass rules are always in place for the above scenarios, which will allow the tests to pass successfully and will also ensure that the system continues to function properly in these scenarios.

---

When I create (via `POST /api/campaigns`) a new campaign in the `awaiting-review` status, it unexpectedly fails validation with the following errors:
```json
{"workspace":{"workflow":{"state":"awaiting-review"}},"stix":{"type":"campaign","id":"campaign--920c66ad-eff2-40f2-904e-6700b53a23eb","created":"2026-04-07T17:40:11.145Z","modified":"2026-04-07T17:40:11.145Z","x_mitre_version":"0.1","x_mitre_deprecated":false,"revoked":false,"spec_version":"2.1","name":"campane","first_seen":"2003-04-01T05:00:00.000Z","last_seen":"2026-04-01T04:00:00.000Z","x_mitre_first_seen_citation":"(Citation: Sean)","x_mitre_last_seen_citation":"(Citation: Sica)","aliases":["placeholder"]}}
```
Response:
```json
{
    "message": "ADM validation failed",
    "details": [
        {
            "message": "revoked is Invalid input: expected nonoptional, received undefined",
            "path": [
                "revoked"
            ],
            "code": "invalid_type"
        },
        {
            "message": "description is Invalid input: expected string, received undefined",
            "path": [
                "description"
            ],
            "code": "invalid_type"
        }
    ],
    "warnings": []
}
```
The error related to `description` is expected. No issues there.
But the error related to `related` is NOT expected. The request is clearly setting `revoked` to `false`, so why does the ADM validation think it's `undefined`?

---

I changed a bunch of Mongoose model properties from `[String]` to `{ type: [String], default: undefined }` to protect from writing empty arrays to entities (Mongo documents) because that would cause response bodies to contain empty list properties, which would be a violation of the STIX 2.1 specification, which states that lists cannot be empty.

Example:
```
// before
x_mitre_aliases: [String],
// after
x_mitre_aliases: { type: [String], default: undefined }
```

Please provide a database migration script in the `migrations/` folder that target the models which are staged in git to bring the database into harmony with the updated models.

app/models/campaign-model.js
app/models/data-source-model.js
app/models/detection-strategy-model.js
app/models/group-model.js
app/models/identity-model.js
app/models/matrix-model.js
app/models/software-model.js
app/models/tactic-model.js