'use strict';

const express = require('express');

const mitigationsController = require('../controllers/mitigations-controller');
const authn = require('../lib/authn-middleware');
const authz = require('../lib/authz-middleware');

const router = express.Router();

router
  .route('/mitigations')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    mitigationsController.retrieveAll,
  )
  .post(authn.authenticate, authz.requireRole(authz.editorOrHigher), mitigationsController.create);

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
    mitigationsController.updateFull,
  )
  .delete(
    authn.authenticate,
    authz.requireRole(authz.admin),
    mitigationsController.deleteVersionById,
  );

module.exports = router;
