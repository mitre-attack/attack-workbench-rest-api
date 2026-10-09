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

router.get(
  '/config/validation-bypasses/reconciliation',
  authn.authenticate,
  authz.requireRole(authz.admin),
  validationBypassesController.reconciliationStatus,
);
router.post(
  '/config/validation-bypasses/reconciliation/retry',
  authn.authenticate,
  authz.requireRole(authz.admin),
  validationBypassesController.retryReconciliation,
);

router
  .route('/config/validation-bypasses/:id')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    validationBypassesController.retrieveById,
  )
  .put(authn.authenticate, authz.requireRole(authz.admin), validationBypassesController.updateById)
  .delete(
    authn.authenticate,
    authz.requireRole(authz.admin),
    validationBypassesController.deleteById,
  );

module.exports = router;
