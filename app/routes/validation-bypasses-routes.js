'use strict';

const express = require('express');

const validationBypassesController = require('../controllers/validation-bypasses-controller');
const authn = require('../lib/authn-middleware');
const authz = require('../lib/authz-middleware');

const router = express.Router();

router
  .route('/config/validation-bypasses')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    validationBypassesController.retrieveAll,
  )
  .post(authn.authenticate, authz.requireRole(authz.admin), validationBypassesController.create);

router
  .route('/config/validation-bypasses/:id')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    validationBypassesController.retrieveById,
  )
  .delete(
    authn.authenticate,
    authz.requireRole(authz.admin),
    validationBypassesController.deleteById,
  );

module.exports = router;
