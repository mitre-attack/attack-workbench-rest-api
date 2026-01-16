'use strict';

const express = require('express');

const { groupSchema } = require('@mitre-attack/attack-data-model');

const groupsController = require('../controllers/groups-controller');
const authn = require('../lib/authn-middleware');
const authz = require('../lib/authz-middleware');

const { validateWorkspaceStixData } = require('../lib/validation-middleware');

const router = express.Router();

router
  .route('/groups')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    groupsController.retrieveAll,
  )
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    validateWorkspaceStixData(groupSchema),
    groupsController.create,
  );

router
  .route('/groups/:stixId')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    groupsController.retrieveById,
  )
  .delete(authn.authenticate, authz.requireRole(authz.admin), groupsController.deleteById);

router
  .route('/groups/:stixId/modified/:modified')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    groupsController.retrieveVersionById,
  )
  .put(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    validateWorkspaceStixData(groupSchema),
    groupsController.updateFull,
  )
  .delete(authn.authenticate, authz.requireRole(authz.admin), groupsController.deleteVersionById);

module.exports = router;
