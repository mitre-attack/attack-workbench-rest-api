'use strict';

const express = require('express');
const { toolSchema, malwareSchema } = require('@mitre-attack/attack-data-model');

const softwareController = require('../controllers/software-controller');
const authn = require('../lib/authn-middleware');
const authz = require('../lib/authz-middleware');
const { validateWorkspaceStixData } = require('../lib/validation-middleware');

const router = express.Router();

router
  .route('/software')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    softwareController.retrieveAll,
  )
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    validateWorkspaceStixData([toolSchema, malwareSchema]),
    softwareController.create,
  );

router
  .route('/software/:stixId')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    softwareController.retrieveById,
  )
  .delete(authn.authenticate, authz.requireRole(authz.admin), softwareController.deleteById);

router
  .route('/software/:stixId/modified/:modified')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    softwareController.retrieveVersionById,
  )
  .put(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    validateWorkspaceStixData([toolSchema, malwareSchema]),
    softwareController.updateFull,
  )
  .delete(authn.authenticate, authz.requireRole(authz.admin), softwareController.deleteVersionById);

module.exports = router;
