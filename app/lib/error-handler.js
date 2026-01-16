'use strict';

const logger = require('./logger');
const {
  MissingParameterError,
  BadlyFormattedParameterError,
  DuplicateIdError,
  DuplicateEmailError,
  DuplicateNameError,
  NotFoundError,
  InvalidQueryStringParameterError,
  CannotUpdateStaticObjectError,
  IdentityServiceError,
  TechniquesServiceError,
  TacticsServiceError,
  GenericServiceError,
  DatabaseError,
  BadRequestError,
  HostNotFoundError,
  ConnectionRefusedError,
  HTTPError,
  NotImplementedError,
  PropertyNotAllowedError,
  SystemConfigurationNotFound,
  OrganizationIdentityNotSetError,
  OrganizationIdentityNotFoundError,
  AnonymousUserAccountNotSetError,
  AnonymousUserAccountNotFoundError,
  InvalidTypeError,
  ImmutablePropertyError,
  InvalidPostOperationError,
  DefaultMarkingDefinitionsNotFoundError,
} = require('../exceptions');

exports.bodyParser = function (err, req, res, next) {
  if (err.name === 'SyntaxError') {
    logger.warn('Unable to parse body, syntax error: ' + err.type);
    res.status(400).send('Syntax error.');
  } else {
    next(err);
  }
};

exports.requestValidation = function (err, req, res, next) {
  if (err.status && err.message) {
    logger.warn('Request failed validation');
    logger.info(JSON.stringify(err));
    res.status(err.status).send(err.message);
  } else {
    next(err);
  }
};

/**
 * Helper function to build error response with all custom properties
 * @param {Error} err - The error object
 * @returns {Object|String} Error response object or message string
 */
function buildErrorResponse(err) {
  // Start with the message
  const errorResponse = { message: err.message };

  // Add any custom properties from the error (excluding standard Error properties)
  const standardErrorProps = ['name', 'message', 'stack'];
  let hasCustomProps = false;

  Object.keys(err).forEach((key) => {
    if (!standardErrorProps.includes(key)) {
      errorResponse[key] = err[key];
      hasCustomProps = true;
    }
  });

  // Return object if custom properties exist, otherwise just the message string
  return hasCustomProps ? errorResponse : err.message;
}

exports.serviceExceptions = function (err, req, res, next) {
  // Handle 400 Bad Request errors (user-related errors)
  if (
    err instanceof MissingParameterError ||
    err instanceof BadlyFormattedParameterError ||
    err instanceof InvalidQueryStringParameterError ||
    err instanceof ImmutablePropertyError ||
    err instanceof InvalidPostOperationError ||
    err instanceof InvalidTypeError ||
    err instanceof PropertyNotAllowedError ||
    err instanceof CannotUpdateStaticObjectError ||
    err instanceof BadRequestError
  ) {
    logger.warn(`Bad request: ${err.message}`);
    return res.status(400).send(buildErrorResponse(err));
  }

  // Handle 404 Not Found errors
  if (
    err instanceof NotFoundError ||
    err instanceof SystemConfigurationNotFound ||
    err instanceof OrganizationIdentityNotFoundError ||
    err instanceof AnonymousUserAccountNotFoundError ||
    err instanceof DefaultMarkingDefinitionsNotFoundError
  ) {
    logger.warn(`Not found: ${err.message}`);
    return res.status(404).send(buildErrorResponse(err));
  }

  // Handle 409 Conflict errors (duplicate resources)
  if (
    err instanceof DuplicateIdError ||
    err instanceof DuplicateEmailError ||
    err instanceof DuplicateNameError
  ) {
    logger.warn(`Conflict: ${err.message}`);
    return res.status(409).send(buildErrorResponse(err));
  }

  // Handle 500 Internal Server errors (service and system errors)
  if (
    err instanceof IdentityServiceError ||
    err instanceof TechniquesServiceError ||
    err instanceof TacticsServiceError ||
    err instanceof GenericServiceError ||
    err instanceof DatabaseError
  ) {
    logger.error(`Service error: ${err.message}`);
    return res.status(500).send(buildErrorResponse(err));
  }

  // Handle 502 Bad Gateway errors (external service errors)
  if (err instanceof HostNotFoundError || err instanceof ConnectionRefusedError) {
    logger.error(`Bad gateway: ${err.message}`);
    return res.status(502).send(buildErrorResponse(err));
  }

  // Handle 503 Service Unavailable errors (HTTP and configuration errors)
  if (
    err instanceof HTTPError ||
    err instanceof OrganizationIdentityNotSetError ||
    err instanceof AnonymousUserAccountNotSetError
  ) {
    logger.error(`Service unavailable: ${err.message}`);
    return res.status(503).send(buildErrorResponse(err));
  }

  // Handle 501 Not Implemented errors
  if (err instanceof NotImplementedError) {
    logger.warn(`Not implemented: ${err.message}`);
    return res.status(501).send(buildErrorResponse(err));
  }

  // Pass through to next error handler if not a recognized exception
  next(err);
};

// eslint-disable-next-line no-unused-vars
exports.catchAll = function (err, req, res, next) {
  logger.error('catch all: ' + err);
  res.status(500).send('Server error.');
};
