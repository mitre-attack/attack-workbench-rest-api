Currently, we have the following workflow in place:

When a user revokes an object, all relationships referencing the revoked object are deleted. 

This workflow is facilitated by the frontend. In effect, a single POST request containing a revoke operation will cascade into potentially dozens or hundreds of subsequent DELETE requests. Not only is this workflow inefficient, it creates an inconsistent user experience — users interacting with the backend through means other than the frontend SPA (e.g., Python, cURL, etc.) will have to re-implement their own equivalent logic for handling relationships that become orphaned as a consequence of revoking an object.

Moreover, the workflow doesn't provide an option for preserving preexisting relationships on the _revoking_ object. A user may desire to revoke Object A with Object B — perhaps they differ only in some trivial semantic way — but preserve all of Object A's relationships on Object B. This is not currently possible. The user must separately identify the relationships _before_ revoking the object, then recreate them after Object A is revoked and its relationships are destroyed.

There is also the problem of the revoke operation itself: it's currently treated as "just another STIX operation" wherein the user makes a POST (for creating new objects as well as creating new revisions for existing objects) or PUT request (for editing existing objects in-place) to the requisite endpoint, such as `POST /api/attack-objects` for techniques and `POST /api/tactics` for tactics. Because the Revoke Workflow is orchestrated by the frontend, the backend has no conception/awareness of revocation. To the backend, toggling `revoked` is no different than modifying the object's `description`. Thus, I want to introduce a new backend workflow for handling revocations, and I want to make it accessible over a explicit endpoint (or set of endpoints), e.g., `POST /api/{type}/revoke`.

The endpoint should support the following query parameters:

- name: `preserveRelationships`
  type: `boolean`
  default: `false`
  description: Tells the backend whether _revoked_ object's relationships (i.e., the relationships of Object A) should be carried over to the _revoking_ object (Object B). If true, Object A's relationships should be destroyed AND recreated on Object B.

As for specifying the _revoked_ and _revoking_ objects themselves, we have two options:

1. We can use a path parameter to specify the _revoked_ object and thus expose a Revoke Operation on each of the existing STIX type-specific routers, e.g., `/api/:type/:stixId/revoke`. In this solution, `stixId` would refer to the _revoked_ object, and we would specify the _revoking_ object in the request body, e.g.:
```json
{
    "revoking": {
        "id": "attack-pattern--0002",
        "modified": $Date
    }
}
```
1. Alternatively, we can setup a new, dedicated, type-agnostic router (e.g., `/api/revoke`) and specify _all_ required information in the request body:
```json
{
    "revoking": {
        "id": "attack-pattern--0001",
        "modified": $Date
    },
    "revoking": {
        "id": "attack-pattern--0002",
        "modified": $Date
    }
}
```

Read the supporting architectural documentation in the `docs/` folder. Pay particular attention to the following:
- `docs/CROSS_SERVICE_READS_PATTERN.md`
- `docs/EVENT_BUS_ARCHITECTURE.md`
- `docs/LIFECYCLE_HOOKS_GUIDE.md`
- `docs/SERVICE_REQUEST_MIDDLEWARE.md`

The backend uses OOP makes ample use of inheritance throughout the service layer. All STIX-oriented services extend the `BaseService` class. Core worfklows such as `create` and `updateFull` are orchestrated by the `BaseService` and should NOT be overridden by child classes. Instead, child classes (such as `TechniquesService` and `TacticsService`) should implement lifecycle hook functions like `beforeCreate` and `afterCreate` to augment or modify core workflow behavior.

In this particular case, we may want to implement a new "core" workflow in the `BaseService`. It might be a method called `revoke`. This would coincide with a new set of router endpoints and controller functions.

Notably, the backend is an Express.js REST API, and the frontend is an Angular SPA.

- Backend code: `/Users/ssica/Development/attack/workbench/attack-workbench-rest-api`
- Frontend code: `/Users/ssica/Development/attack/workbench/attack-workbench-frontend`

Please weigh the pros and cons of each approach and propose a plan for implementing this feature, starting with the backend.

---

 Revoke Workflow — Implementation Plan                                                                                      
                                                        
 Context

 Revoking an object (replacing Object A with Object B) is currently orchestrated by the frontend SPA. The backend has no
 concept of revocation — setting stix.revoked = true is indistinguishable from modifying description. This means:

 1. Non-SPA consumers (Python, cURL) must reimplement the cascade logic themselves
 2. There's no option to preserve Object A's relationships on Object B
 3. A single revoke cascades into dozens of DELETE requests from the frontend

 This plan introduces a backend-orchestrated Revoke Workflow accessible via dedicated endpoints.

 Endpoint Design: Type-Specific Routes (Approach 1)

 Chosen: POST /api/techniques/:stixId/revoke (and equivalent for each type)

 Why not type-agnostic (POST /api/revoke)?
 - Every existing route is type-specific — a cross-type endpoint would be the only exception
 - Auth middleware is applied per-type in each router file
 - Controllers already import their singleton service — no dispatch logic needed
 - Service resolution from STIX ID prefix would be fragile and unprecedented in this codebase

 Request format:
 POST /api/techniques/attack-pattern--0001/revoke?preserveRelationships=true

 Body:
 {
   "revoking": {
     "stixId": "attack-pattern--0002",
     "modified": "2026-03-20T00:00:00.000Z"
   }
 }

 Response format:
 {
   "revokedObject": { },
   "revokedByRelationship": { },
   "relationshipsSummary": {
     "deleted": 5,
     "transferred": 5,
     "warnings": []
   }
 }

 Revoke Workflow (BaseService.revoke)

 1. VALIDATE INPUTS
    - stixId required (path param = Object A)
    - body.revoking.stixId required (Object B)
    - body.revoking.modified required
    - A !== B (no self-revocation)

 2. RETRIEVE OBJECTS
    - objectA = this.repository.retrieveLatestByStixId(stixId)
    - Throw NotFoundError if null
    - Throw AlreadyRevokedError if objectA.stix.revoked === true
    - objectB = this.repository.retrieveOneByVersion(revokingStixId, revokingModified)
    - Throw NotFoundError if null

 3. LIFECYCLE HOOK: beforeRevoke(objectA, objectB, options)

 4. MARK OBJECT A AS REVOKED
    - Clone objectA's data, set stix.revoked = true
    - Call this.create() internally to create a new version
    - This reuses the full create pipeline (ATT&CK ID reuse, field composition, ADM validation)

 5. CREATE REVOKED-BY RELATIONSHIP
    - Call relationshipsService.create() with:
      { stix: { type: 'relationship', relationship_type: 'revoked-by',
                source_ref: objectA.stix.id, target_ref: objectB.stix.id } }

 6. HANDLE RELATIONSHIPS
    - Query all relationships where source_ref OR target_ref = objectA.stix.id
    - Exclude the revoked-by relationship just created
    - If preserveRelationships === true:
      - For each relationship, clone it with objectB substituted for objectA
      - Save clones via relationshipsService.create()
    - Delete all originals referencing objectA

 7. LIFECYCLE HOOK: afterRevoke(revokedDocument, objectB, options)

 8. EMIT EVENT: emitRevokedEvent(revokedDocument, objectB, options)

 9. RETURN result with revokedObject, revokedByRelationship, relationshipsSummary

 Note on cross-service writes: Step 5-6 involve writing to the relationships collection from BaseService. Per the
 architecture docs, cross-service writes should use events. However, the revoke workflow is inherently transactional — the
 caller needs to know if relationship transfer failed. Since EventBus.emit() uses Promise.allSettled and swallows errors,
 I'll use direct orchestration (calling relationshipsService.create() directly from BaseService.revoke()). This is the same
  pragmatic approach used in TechniquesService._propagateShortnameViaNewVersions which directly calls this.create() for
 related objects. The event is still emitted afterward for observability.

 Implementation Sequence

 Step 1: Add Exception Classes

 File: app/exceptions/index.js
 - Add AlreadyRevokedError (→ 409 Conflict)
 - Add SelfRevocationError (→ 400 Bad Request)

 File: app/lib/error-handler.js
 - Register AlreadyRevokedError in 409 block
 - Register SelfRevocationError in 400 block

 Step 2: Add Event Constants

 File: app/lib/event-constants.js
 - Add *_REVOKED constants for each STIX type (following existing pattern)

 Step 3: Add Lifecycle Hooks

 File: app/services/meta-classes/hooks.service.js
 - Add beforeRevoke(objectA, objectB, options) — no-op default
 - Add afterRevoke(revokedDocument, objectB, options) — no-op default
 - Add emitRevokedEvent(revokedDocument, revokingDocument, options) — emits ${this.type}::revoked

 Step 4: Add Repository Methods

 File: app/repository/relationships-repository.js
 - Add retrieveAllBySourceOrTarget(stixId) — finds latest version of all relationships referencing a STIX ID as source or
 target
 - Add deleteManyBySourceOrTarget(stixId, excludeStixIds) — deletes all relationship documents (all versions) where
 source_ref or target_ref matches, excluding specified stix.ids

 Step 5: Add revoke() to BaseService

 File: app/services/meta-classes/base.service.js
 - Add the revoke(stixId, data, options) method implementing the workflow above
 - Import relationshipsService and relationshipsRepository at the top

 Step 6: Add Controller Method

 Files: All type-specific controllers that support revocation:
 - app/controllers/techniques-controller.js
 - app/controllers/tactics-controller.js
 - app/controllers/software-controller.js
 - app/controllers/groups-controller.js
 - app/controllers/mitigations-controller.js
 - app/controllers/campaigns-controller.js
 - app/controllers/data-sources-controller.js
 - app/controllers/data-components-controller.js
 - app/controllers/assets-controller.js
 - app/controllers/matrices-controller.js

 Each gets a revoke export:
 exports.revoke = async function (req, res, next) {
   try {
     const options = {
       preserveRelationships: req.query.preserveRelationships === 'true',
       userAccountId: req.user?.userAccountId,
     };
     const result = await service.revoke(req.params.stixId, req.body, options);
     return res.status(200).send(result);
   } catch (err) {
     return next(err);
   }
 };

 Step 7: Add Routes

 Files: All matching router files:
 - app/routes/techniques-routes.js
 - app/routes/tactics-routes.js
 - app/routes/software-routes.js
 - app/routes/groups-routes.js
 - app/routes/mitigations-routes.js
 - app/routes/campaigns-routes.js
 - app/routes/data-sources-routes.js
 - app/routes/data-components-routes.js
 - app/routes/assets-routes.js
 - app/routes/matrices-routes.js

 Each gets:
 router
   .route('/<type>/:stixId/revoke')
   .post(authn.authenticate, authz.requireRole(authz.editorOrHigher), controller.revoke);

 Edge Cases

 ┌────────────────────────────────────────┬──────────────────────────────────────────────────────┐
 │                  Case                  │                       Handling                       │
 ├────────────────────────────────────────┼──────────────────────────────────────────────────────┤
 │ Object A not found                     │ 404 NotFoundError                                    │
 ├────────────────────────────────────────┼──────────────────────────────────────────────────────┤
 │ Object A already revoked               │ 409 AlreadyRevokedError                              │
 ├────────────────────────────────────────┼──────────────────────────────────────────────────────┤
 │ Object B not found                     │ 404 NotFoundError                                    │
 ├────────────────────────────────────────┼──────────────────────────────────────────────────────┤
 │ Self-revocation (A === B)              │ 400 SelfRevocationError                              │
 ├────────────────────────────────────────┼──────────────────────────────────────────────────────┤
 │ Object A has no relationships          │ Steps 5-6 are no-ops; revoked-by still created       │
 ├────────────────────────────────────────┼──────────────────────────────────────────────────────┤
 │ Relationship clone fails mid-way       │ Log warning, continue; return warnings array         │
 ├────────────────────────────────────────┼──────────────────────────────────────────────────────┤
 │ Concurrent revocation                  │ First writer wins (create() throws DuplicateIdError) │
 ├────────────────────────────────────────┼──────────────────────────────────────────────────────┤
 │ Cross-type revocation (A and B differ) │ Allow — STIX spec permits it                         │
 └────────────────────────────────────────┴──────────────────────────────────────────────────────┘

 Verification

 1. Unit tests: Test revoke() in isolation with mocked repositories
 2. Integration tests:
   - Revoke without preserving relationships → verify A is revoked, relationships deleted, revoked-by created
   - Revoke with preserving relationships → verify relationships cloned to B then deleted from A
   - Error cases (not found, already revoked, self-revocation)
 3. Manual API test: POST /api/techniques/:stixId/revoke via cURL