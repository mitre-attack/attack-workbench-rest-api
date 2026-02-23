'use strict';

/**
 * Do not set the upgrade-insecure-requests directive on the Content-Security-Policy header
 * @param {object} app - express app
 * @param {object} helmet - helmet module
 */
function disableUpgradeInsecureRequests(app, helmet) {
  const defaultDirectives = helmet.contentSecurityPolicy.getDefaultDirectives();
  delete defaultDirectives['upgrade-insecure-requests'];

  app.use(
    helmet.contentSecurityPolicy({
      directives: {
        ...defaultDirectives,
      },
    }),
  );
}

/**
 * Configures and applies the CORS middleware to the Express application.
 *
 * - If `corsAllowedOrigins` is set to `disable`, CORS middleware is not applied, effectively disabling CORS.
 * - If `corsAllowedOrigins` is `*`, it allows all origins.
 * - Otherwise, it parses the comma-separated list of origins and uses them as the allowed origins.
 *
 * @param {import('express').Application} app - The Express application instance.
 * @param {Object} config - The application configuration object.
 * @param {Object} config.server - The server-specific configuration.
 * @param {string} config.server.corsAllowedOrigins - The CORS allowed origins setting.
 * @param {import('winston').Logger} logger - The logger instance for logging messages.
 *
 * @throws {Error} Throws an error if the configuration is invalid or missing required fields.
 *
 * @example
 * // CORS is disabled
 * const config = { server: { corsAllowedOrigins: 'disable' } };
 * setupCors(app, config, logger); // No CORS middleware applied
 *
 * @example
 * // CORS allows all origins
 * const config = { server: { corsAllowedOrigins: '*' } };
 * setupCors(app, config, logger); // CORS middleware with `origin: true`
 *
 * @example
 * // CORS with specific origins
 * const config = { server: { corsAllowedOrigins: 'example.com,api.example.com' } };
 * setupCors(app, config, logger); // CORS middleware with specific origins
 */
function setupCors(app, config, logger) {
  const cors = require('cors');

  const corsAllowedOrigins = config.server.corsAllowedOrigins;

  logger.info(corsAllowedOrigins);

  if (corsAllowedOrigins == 'disable') {
    app.use(cors({ origin: false }));
    logger.info('CORS is disabled');
    return;
  } else if (corsAllowedOrigins == '*') {
    app.use(
      cors({
        credentials: true,
        origin: true,
      }),
    );
    logger.info('CORS is enabled for all domains');
    return;
  } else {
    app.use(
      cors({
        credentials: true,
        origin: corsAllowedOrigins,
      }),
    );
    logger.info(`CORS is enabled for domains: ${corsAllowedOrigins}`);
  }
}

/**
 * Creates a new instance of the express app.
 * @return The new express app
 */
exports.initializeApp = async function () {
  const logger = require('./lib/logger');
  logger.info('ATT&CK Workbench REST API app starting');

  // Configure the app
  logger.info('Configuring the app');
  const config = require('./config/config');

  // Create the express application
  logger.info('Starting express');
  const express = require('express');
  const app = express();

  // Add a unique id to each request
  const requestId = require('./lib/requestId');
  app.use(requestId);

  setupCors(app, config, logger);

  // Compress response bodies
  const compression = require('compression');
  app.use(compression());

  // Set HTTP response headers
  const helmet = require('helmet');
  app.use(helmet());
  disableUpgradeInsecureRequests(app, helmet);

  // Development Environment
  if (config.app.env === 'development') {
    // Enable request logging
    logger.info('Enabling HTTP request logging');
    const morgan = require('morgan');
    app.use(morgan('dev', { stream: logger.stream }));
    //        morgan.token('requestId', req => req.id);
    //        app.use(morgan('[:requestId] :method :url :status :response-time ms - :res[content-length]', { stream: logger.stream }));

    // Enable Swagger UI
    logger.info('Enabling Swagger UI');
    const swaggerUi = require('swagger-ui-express');
    const refParser = require('@apidevtools/json-schema-ref-parser');
    const openApiDoc = await refParser.dereference(config.openApi.specPath);
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDoc));
  }

  // Configure server-side sessions
  const session = require('express-session');
  const MongoStore = require('connect-mongo');
  const { createWebCryptoAdapter } = require("connect-mongo");
  const mongoose = require('mongoose');

  // Generate unique session cookie name based on container hostname
  // This ensures multiple instances on the same domain don't conflict
  // which is important for local development environments with multiple instances
  const os = require('os');
  const crypto = require('crypto');
  const hostname = os.hostname();
  const cookieName =
    hostname && hostname !== 'localhost'
      ? `connect.${crypto.createHash('sha256').update(hostname).digest('hex').substring(0, 8)}.sid`
      : 'connect.sid';

  const sessionOptions = {
    name: cookieName,
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.MongoStore.create({
      client: mongoose.connection.getClient(),
      cryptoAdapter: createWebCryptoAdapter({
        secret: config.session.mongoStoreCryptoSecret,
      }),
    }),
  };
  app.use(session(sessionOptions));

  // Set up the static routes
  logger.info('Configuring static routes');
  app.use(express.static('public'));

  // Configure passport with the user authentication mechanism
  const authnConfiguration = require('./lib/authn-configuration');
  if (config.userAuthn.mechanism === 'oidc') {
    await authnConfiguration.configurePassport('oidc');
  } else if (config.userAuthn.mechanism === 'anonymous') {
    await authnConfiguration.configurePassport('anonymous');
  }

  // Configure passport for service authentication if enabled
  if (
    config.serviceAuthn.oidcClientCredentials.enable ||
    config.serviceAuthn.challengeApikey.enable
  ) {
    await authnConfiguration.configurePassport('bearer');
  }
  if (config.serviceAuthn.oidcClientCredentials.enable) {
    logger.info('Enabled service authentication: client credentials');
  }
  if (config.serviceAuthn.challengeApikey.enable) {
    logger.info('Enabled service authentication: challenge apikey');
  }
  if (config.serviceAuthn.basicApikey.enable) {
    await authnConfiguration.configurePassport('basic');
    logger.info('Enabled service authentication: basic apikey');
  }

  // Set up the api routes
  logger.info('Configuring REST API routes');
  const routes = require('./routes');
  app.use(routes);

  // Make the config and logger objects accessible from the app object
  app.set('config', config);
  app.set('logger', logger);

  return app;
};
