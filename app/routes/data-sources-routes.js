'use strict';

const express = require('express');

const { dataSourceSchema } = require('@mitre-attack/attack-data-model');

const dataSourcesController = require('../controllers/data-sources-controller');
const authn = require('../lib/authn-middleware');
const authz = require('../lib/authz-middleware');
const { validateWorkspaceStixData } = require('../lib/validation-middleware');

const router = express.Router();

router
  .route('/data-sources')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    dataSourcesController.retrieveAll,
  )
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    validateWorkspaceStixData(dataSourceSchema),
    dataSourcesController.create,
  );

router
  .route('/data-sources/:stixId')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    dataSourcesController.retrieveById,
  )
  .delete(authn.authenticate, authz.requireRole(authz.admin), dataSourcesController.deleteById);

router
  .route('/data-sources/:stixId/modified/:modified')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    dataSourcesController.retrieveVersionById,
  )
  .put(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    validateWorkspaceStixData(dataSourceSchema),
    dataSourcesController.updateFull,
  )
  .delete(
    authn.authenticate,
    authz.requireRole(authz.admin),
    dataSourcesController.deleteVersionById,
  );

module.exports = router;
