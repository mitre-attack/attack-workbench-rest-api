'use strict';

const express = require('express');

const relationshipsController = require('../controllers/relationships-controller');
const authn = require('../lib/authn-middleware');
const authz = require('../lib/authz-middleware');

const router = express.Router();

router
  .route('/relationships')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    relationshipsController.retrieveAll,
  )
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    relationshipsController.create,
  );

router
  .route('/relationships/:stixId')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    relationshipsController.retrieveById,
  )
  .delete(authn.authenticate, authz.requireRole(authz.admin), relationshipsController.deleteById);

router
  .route('/relationships/:stixId/modified/:modified')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    relationshipsController.retrieveVersionById,
  )
  .put(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    relationshipsController.updateFull,
  )
  .delete(
    authn.authenticate,
    authz.requireRole(authz.admin),
    relationshipsController.deleteVersionById,
  );

module.exports = router;
