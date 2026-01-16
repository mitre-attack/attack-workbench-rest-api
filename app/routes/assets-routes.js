'use strict';

const express = require('express');

const { assetSchema } = require('@mitre-attack/attack-data-model');

const assetsController = require('../controllers/assets-controller');
const authn = require('../lib/authn-middleware');
const authz = require('../lib/authz-middleware');
const { validateWorkspaceStixData } = require('../lib/validation-middleware');

const router = express.Router();

router
  .route('/assets')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    assetsController.retrieveAll,
  )
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    validateWorkspaceStixData(assetSchema),
    assetsController.create,
  );

router
  .route('/assets/:stixId')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    assetsController.retrieveById,
  )
  .delete(authn.authenticate, authz.requireRole(authz.admin), assetsController.deleteById);

router
  .route('/assets/:stixId/modified/:modified')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    assetsController.retrieveVersionById,
  )
  .put(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    validateWorkspaceStixData(assetSchema),
    assetsController.updateFull,
  )
  .delete(authn.authenticate, authz.requireRole(authz.admin), assetsController.deleteVersionById);

module.exports = router;
