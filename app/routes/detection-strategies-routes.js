'use strict';

const express = require('express');

const { detectionStrategySchema } = require('@mitre-attack/attack-data-model');

const detectionStrategiesController = require('../controllers/detection-strategies-controller');
const authn = require('../lib/authn-middleware');
const authz = require('../lib/authz-middleware');

const { validateWorkspaceStixData } = require('../lib/validation-middleware');

const router = express.Router();

router
  .route('/detection-strategies')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    detectionStrategiesController.retrieveAll,
  )
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    validateWorkspaceStixData(detectionStrategySchema),
    detectionStrategiesController.create,
  );

router
  .route('/detection-strategies/:stixId')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    detectionStrategiesController.retrieveById,
  )
  .delete(
    authn.authenticate,
    authz.requireRole(authz.admin),
    detectionStrategiesController.deleteById,
  );

router
  .route('/detection-strategies/:stixId/modified/:modified')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    detectionStrategiesController.retrieveVersionById,
  )
  .put(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    validateWorkspaceStixData(detectionStrategySchema),
    detectionStrategiesController.updateFull,
  )
  .delete(
    authn.authenticate,
    authz.requireRole(authz.admin),
    detectionStrategiesController.deleteVersionById,
  );

module.exports = router;
