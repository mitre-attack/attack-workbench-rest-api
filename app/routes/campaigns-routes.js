'use strict';

const express = require('express');

const campaignsController = require('../controllers/campaigns-controller');
const authn = require('../lib/authn-middleware');
const authz = require('../lib/authz-middleware');

const router = express.Router();

router
  .route('/campaigns')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    campaignsController.retrieveAll,
  )
  .post(authn.authenticate, authz.requireRole(authz.editorOrHigher), campaignsController.create);

router
  .route('/campaigns/:stixId')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    campaignsController.retrieveById,
  )
  .delete(authn.authenticate, authz.requireRole(authz.admin), campaignsController.deleteById);

router
  .route('/campaigns/:stixId/modified/:modified')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    campaignsController.retrieveVersionById,
  )
  .put(authn.authenticate, authz.requireRole(authz.editorOrHigher), campaignsController.updateFull)
  .delete(
    authn.authenticate,
    authz.requireRole(authz.admin),
    campaignsController.deleteVersionById,
  );

module.exports = router;
