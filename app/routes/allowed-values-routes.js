'use strict';

const express = require('express');
const controller = require('../controllers/allowed-values-controller');
const authn = require('../lib/authn-middleware');
const authz = require('../lib/authz-middleware');

const router = express.Router();

router
  .route('/config/allowed-values/rules')
  .get(authn.authenticate, authz.requireRole(authz.admin), controller.retrieveRules)
  .post(authn.authenticate, authz.requireRole(authz.admin), controller.createRule);

router
  .route('/config/allowed-values/rules/:propertyName/:domainName')
  .put(authn.authenticate, authz.requireRole(authz.admin), controller.replaceRule);

router
  .route('/config/allowed-values/catalog')
  .get(authn.authenticate, authz.requireRole(authz.admin), controller.retrieveCatalog);

router
  .route('/config/allowed-values/validate')
  .post(authn.authenticate, authz.requireRole(authz.admin), controller.validateValue);

module.exports = router;
