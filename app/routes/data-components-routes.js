'use strict';

const express = require('express');

const dataComponentsController = require('../controllers/data-components-controller');
const authn = require('../lib/authn-middleware');
const authz = require('../lib/authz-middleware');

const router = express.Router();

router
  .route('/data-components')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    dataComponentsController.retrieveAll,
  )
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    dataComponentsController.create,
  );

router
  .route('/data-components/:stixId')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    dataComponentsController.retrieveById,
  )
  .delete(authn.authenticate, authz.requireRole(authz.admin), dataComponentsController.deleteById);

router
  .route('/data-components/:stixId/channels')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    dataComponentsController.retrieveChannelsById,
  );

router
  .route('/data-components/:stixId/log-sources')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    dataComponentsController.retrieveLogSourcesById,
  );

router
  .route('/data-components/:stixId/modified/:modified')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    dataComponentsController.retrieveVersionById,
  )
  .put(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    dataComponentsController.updateFull,
  )
  .delete(
    authn.authenticate,
    authz.requireRole(authz.admin),
    dataComponentsController.deleteVersionById,
  );

module.exports = router;
