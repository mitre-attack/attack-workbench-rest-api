'use strict';

const express = require('express');

const validateController = require('../controllers/validate-controller');

const router = express.Router();

router.route('/validate').post(validateController.validate);

module.exports = router;
