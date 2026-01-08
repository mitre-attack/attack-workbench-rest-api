'use strict';

const express = require('express');

const reportsController = require('../controllers/reports-controller');
const authn = require('../lib/authn-middleware');
const authz = require('../lib/authz-middleware');

const router = express.Router();

router
  .route('/reports/link-by-id/missing')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    reportsController.getMissingLinkById,
  );

router
  .route('/reports/parallel-relationships')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    reportsController.getParallelRelationships,
  );

module.exports = router;
