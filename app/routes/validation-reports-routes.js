'use strict';

const router = require('express').Router();
const authn = require('../lib/authn-middleware');
const controller = require('../controllers/validation-reports-controller');
router.get('/validation-reports/:reportId', authn.authenticate, controller.retrieve);
module.exports = router;
