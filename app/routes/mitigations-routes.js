'use strict';

const express = require('express');

const { mitigationSchema } = require('@mitre-attack/attack-data-model');

const mitigationsController = require('../controllers/mitigations-controller');
const authn = require('../lib/authn-middleware');
const authz = require('../lib/authz-middleware');
const { validateWorkspaceStixData } = require('../lib/validation-middleware');

const router = express.Router();

router
  .route('/mitigations')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    mitigationsController.retrieveAll,
  )
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    validateWorkspaceStixData(mitigationSchema),
    mitigationsController.create,
  );

router
  .route('/mitigations/:stixId')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    mitigationsController.retrieveById,
  )
  .delete(authn.authenticate, authz.requireRole(authz.admin), mitigationsController.deleteById);

router
  .route('/mitigations/:stixId/modified/:modified')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    mitigationsController.retrieveVersionById,
  )
  .put(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    validateWorkspaceStixData(mitigationSchema),
    mitigationsController.updateFull,
  )
  .delete(
    authn.authenticate,
    authz.requireRole(authz.admin),
    mitigationsController.deleteVersionById,
  );

module.exports = router;
