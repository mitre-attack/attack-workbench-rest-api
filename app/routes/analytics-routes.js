'use strict';

const express = require('express');

const { analyticSchema } = require('@mitre-attack/attack-data-model');

const analyticsController = require('../controllers/analytics-controller');
const authn = require('../lib/authn-middleware');
const authz = require('../lib/authz-middleware');
const { validateWorkspaceStixData } = require('../lib/validation-middleware');

const router = express.Router();

router
  .route('/analytics')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    analyticsController.retrieveAll,
  )
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    validateWorkspaceStixData(analyticSchema),
    analyticsController.create,
  );

router
  .route('/analytics/:stixId')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    analyticsController.retrieveById,
  )
  .delete(authn.authenticate, authz.requireRole(authz.admin), analyticsController.deleteById);

router
  .route('/analytics/:stixId/modified/:modified')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    analyticsController.retrieveVersionById,
  )
  .put(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    validateWorkspaceStixData(analyticSchema),
    analyticsController.updateFull,
  )
  .delete(
    authn.authenticate,
    authz.requireRole(authz.admin),
    analyticsController.deleteVersionById,
  );

module.exports = router;
