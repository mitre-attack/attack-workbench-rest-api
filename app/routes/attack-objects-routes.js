'use strict';

const express = require('express');

const attackObjectsController = require('../controllers/attack-objects-controller');
const authn = require('../lib/authn-middleware');
const authz = require('../lib/authz-middleware');

const router = express.Router();

router
  .route('/attack-objects')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    attackObjectsController.retrieveAll,
  );

router
  .route('/attack-objects/attack-id/next')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    attackObjectsController.getNextAttackId,
  );

module.exports = router;
