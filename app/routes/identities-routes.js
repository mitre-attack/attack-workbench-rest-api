'use strict';

const express = require('express');

const { identitySchema } = require('@mitre-attack/attack-data-model');

const identitiesController = require('../controllers/identities-controller');
const authn = require('../lib/authn-middleware');
const authz = require('../lib/authz-middleware');
const { validateWorkspaceStixData } = require('../lib/validation-middleware');

const router = express.Router();

router
  .route('/identities')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    identitiesController.retrieveAll,
  )
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    validateWorkspaceStixData(identitySchema),
    identitiesController.create,
  );

router
  .route('/identities/:stixId')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    identitiesController.retrieveById,
  )
  .delete(authn.authenticate, authz.requireRole(authz.admin), identitiesController.deleteById);

router
  .route('/identities/:stixId/modified/:modified')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    identitiesController.retrieveVersionById,
  )
  .put(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    validateWorkspaceStixData(identitySchema),
    identitiesController.updateFull,
  )
  .delete(
    authn.authenticate,
    authz.requireRole(authz.admin),
    identitiesController.deleteVersionById,
  );

module.exports = router;
