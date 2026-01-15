'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const OpenApiValidator = require('express-openapi-validator');
const fs = require('fs');
const path = require('path');

const errorHandler = require('../lib/error-handler');
const config = require('../config/config');
const authnConfiguration = require('../lib/authn-configuration');

const router = express.Router();

// Parse the request body
router.use('/api', bodyParser.json({ limit: '50mb' }));
router.use('/api', bodyParser.urlencoded({ limit: '1mb', extended: true }));

// Setup request validation
if (config.validateRequests.withOpenApi) {
  router.use(
    OpenApiValidator.middleware({
      apiSpec: config.openApi.specPath,
      validateRequests: true,
      validateResponses: false,
    }),
  );
}

// Setup passport middleware
router.use('/api', authnConfiguration.passportMiddleware());

// Set up the endpoint routes
//   All files in this directory that end in '-routes.js' will be added as endpoint routes
fs.readdirSync(path.join(__dirname, '.')).forEach(function (filename) {
  if (filename.endsWith('-routes.js')) {
    const moduleName = path.basename(filename, '.js');
    const module = require('./' + moduleName);
    router.use('/api', module);
  }
});

// Handle errors that haven't otherwise been caught
router.use(errorHandler.bodyParser);
router.use(errorHandler.requestValidation);
router.use(errorHandler.serviceExceptions);
router.use(errorHandler.catchAll);

module.exports = router;
