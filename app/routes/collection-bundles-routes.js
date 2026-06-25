'use strict';

const express = require('express');

const collectionBundlesController = require('../controllers/collection-bundles-controller');
const authn = require('../lib/authn-middleware');
const authz = require('../lib/authz-middleware');

const router = express.Router();

// Middleware to route import requests to streaming or regular endpoint
const importBundleRouter = (req, res, next) => {
  // Use streaming if requested
  if (req.query.stream === 'true' || req.query.stream === true) {
    return collectionBundlesController.streamImportBundle(req, res, next);
  }
  // Otherwise use regular import
  return collectionBundlesController.importBundle(req, res, next);
};

router
  .route('/collection-bundles')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    collectionBundlesController.exportBundle,
  )
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher, [authz.serviceRoles.collectionManager]),
    importBundleRouter,
  );

module.exports = router;
