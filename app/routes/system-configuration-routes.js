'use strict';

const express = require('express');

const systemConfigurationController = require('../controllers/system-configuration-controller');
const authn = require('../lib/authn-middleware');
const authz = require('../lib/authz-middleware');

const router = express.Router();

router
  .route('/config/system-version')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    systemConfigurationController.retrieveSystemVersion,
  );

router
  .route('/config/allowed-values')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    systemConfigurationController.retrieveAllowedValues,
  );

router
  .route('/config/organization-identity')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    systemConfigurationController.retrieveOrganizationIdentity,
  )
  .post(
    authn.authenticate,
    authz.requireRole(authz.admin),
    systemConfigurationController.setOrganizationIdentity,
  );

router.route('/config/authn').get(
  // No authentication or authorization required
  systemConfigurationController.retrieveAuthenticationConfig,
);

router
  .route('/config/default-marking-definitions')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    systemConfigurationController.retrieveDefaultMarkingDefinitions,
  )
  .post(
    authn.authenticate,
    authz.requireRole(authz.admin),
    systemConfigurationController.setDefaultMarkingDefinitions,
  );

router
  .route('/config/organization-namespace')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    systemConfigurationController.retrieveOrganizationNamespace,
  )
  .post(
    authn.authenticate,
    authz.requireRole(authz.admin),
    systemConfigurationController.setOrganizationNamespace,
  );

router
  .route('/config/mitre-identity-writes')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    systemConfigurationController.retrieveMitreIdentityWrites,
  )
  .post(
    authn.authenticate,
    authz.requireRole(authz.admin),
    systemConfigurationController.setMitreIdentityWrites,
  );

module.exports = router;
