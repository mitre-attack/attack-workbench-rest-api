I recently introduced a new feature to the ATT&CK Workbench REST API that uses the ATT&CK Data Model (ADM) library (`@mitre-attack/attack-data-model`) to validate request bodies for POST and PUT requests. The ADM provides a comprehensive set of Zod schemas for parsing/validating any ATT&CK type, whether fields and objects alike. Thus, it provides us an opportunity to add much more granular, robust data validation checks to ensure that Workbench does not permit users to create non-compliant objects. This validation takes the form of a middleware function called `validateWorkspaceStixdata`. Here is an example of it in action in the techniques routing module, `app/routes/techniques-routes.js`:
```javascript
'use strict';

const express = require('express');

const techniquesController = require('../controllers/techniques-controller');
const authn = require('../lib/authn-middleware');
const authz = require('../lib/authz-middleware');
const { validateWorkspaceStixData } = require('../lib/validation-middleware');

const router = express.Router();

router
  .route('/techniques')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    techniquesController.retrieveAll,
  )
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    validateWorkspaceStixData('attack-pattern'),
    techniquesController.create,
  );
```

Behind the scenes, the middleware crafts a custom Zod schema using the underlying ADM-source schema. There are certain backend-controlled fields, like `x_mitre_attack_spec_version` that need to be omitted from the schema because users will never set them and thereby never includes them in the request body. There are also workflow states wherein users might create a draft of an object and curate it over time, in which case we don't want the validation middleware to prematurely throw if an otherwise required field is excluded while the object is a work-in-progress. Lastly, there are additional metadata fields we track in Workbench that aren't in-scope of ATT&CK or STIX. These things are all dynamically handled under the hood by the `validateWorkspaceStixData` middleware.