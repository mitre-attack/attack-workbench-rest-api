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

// Keep one snapshot across all recursive and bulk work in this HTTP operation.
router.use('/api', (req, res, next) => {
  const operation = require('../services/system/validation-operation-service');
  operation
    .run(({ snapshot }) => {
      const reports = require('../lib/validation-report-middleware');
      const collector = reports.prepare(req, snapshot);
      if (collector) {
        operation.current().collector = collector.collect;
        reports.install(req, res, collector);
      }
      const json = res.json;
      res.json = function (body) {
        const project = (value) => {
          if (!value || typeof value !== 'object') return value;
          if (Array.isArray(value)) return value.map(project);
          if (value.toObject) value = value.toObject();
          if (value.stix && value.workspace) {
            require('../services/system/validation-diagnostic-service').project(value, snapshot);
          }
          for (const key of Object.keys(value))
            if (key !== 'stix') value[key] = project(value[key]);
          return value;
        };
        return json.call(this, project(JSON.parse(JSON.stringify(body))));
      };
      next();
    })
    .catch(next);
});

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
