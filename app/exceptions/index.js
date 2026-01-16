'use strict';

class CustomError extends Error {
  constructor(message, options = {}) {
    super(message);

    // Set the error name to the class name
    this.name = this.constructor.name;

    // Apply options (if defined) to the error object
    for (const key in options) {
      if (Object.prototype.hasOwnProperty.call(options, key)) {
        this[key] = options[key];
      }
    }
  }
}

class MissingParameterError extends CustomError {
  constructor(parameter, options) {
    super(`Missing required parameter: ${parameter}`, options);
  }
}

class BadlyFormattedParameterError extends CustomError {
  constructor(options) {
    super('Badly formatted parameter', options);
  }
}

class DuplicateIdError extends CustomError {
  constructor(options) {
    super('Duplicate id', options);
  }
}

class DuplicateEmailError extends CustomError {
  constructor(options) {
    super('Duplicate email', options);
  }
}

class DuplicateNameError extends CustomError {
  constructor(options) {
    super('Duplicate name', options);
  }
}

class NotFoundError extends CustomError {
  constructor(options) {
    super('Document not found', options);
  }
}

class InvalidQueryStringParameterError extends CustomError {
  constructor(options) {
    super('Invalid query string parameter', options);
  }
}

class CannotUpdateStaticObjectError extends CustomError {
  constructor(options) {
    super('Cannot update static object', options);
  }
}

class IdentityServiceError extends CustomError {
  constructor(options) {
    super('An error occurred in the identities service.', options);
  }
}

class TechniquesServiceError extends CustomError {
  constructor(options) {
    super('An error occurred in the techniques service.', options);
  }
}

class TacticsServiceError extends CustomError {
  constructor(options) {
    super('An error occurred in the tactics service.', options);
  }
}

class GenericServiceError extends CustomError {
  constructor(options) {
    super('An error occurred in a service.', options);
  }
}

class DatabaseError extends CustomError {
  constructor(options) {
    super('The database operation failed.', options);
  }
}

class BadRequestError extends CustomError {
  constructor(options) {
    super('Bad request.', options);
  }
}

class HostNotFoundError extends CustomError {
  constructor(options) {
    super('Host not found.', options);
  }
}

class ConnectionRefusedError extends CustomError {
  constructor(options) {
    super('Connection refused.', options);
  }
}

class HTTPError extends CustomError {
  constructor(options) {
    super('The HTTP operation failed.', options);
  }
}

class NotImplementedError extends CustomError {
  constructor(moduleName, functionName, options) {
    super(`The function ${functionName} in module ${moduleName} is not implemented!`, options);
  }
}

class PropertyNotAllowedError extends CustomError {
  constructor(propertyName, options) {
    super(`Unable to create software, property ${propertyName} is not allowed`, options);
  }
}

class SystemConfigurationNotFound extends CustomError {
  constructor(options) {
    super(`System configuration not found`, options);
  }
}

class OrganizationIdentityNotSetError extends CustomError {
  constructor(options) {
    super(`Organization identity not set`, options);
  }
}

class DefaultMarkingDefinitionsNotFoundError extends CustomError {
  constructor(options) {
    super(`Default marking definitions not found`, options);
  }
}

class OrganizationIdentityNotFoundError extends CustomError {
  constructor(identityRef, options) {
    super(`Identity with id ${identityRef} not found`, options);
  }
}

class AnonymousUserAccountNotSetError extends CustomError {
  constructor(options) {
    super(`Anonymous user account not set`, options);
  }
}

class AnonymousUserAccountNotFoundError extends CustomError {
  constructor(userAccountid, options) {
    super(`Anonymous user account ${userAccountid} not found`, options);
  }
}

class InvalidTypeError extends CustomError {
  constructor(options) {
    super('Invalid stix.type', options);
  }
}

class ImmutablePropertyError extends CustomError {
  constructor(propertyName, options) {
    super(`Cannot modify immutable property: ${propertyName}`, options);
  }
}

class InvalidPostOperationError extends CustomError {
  constructor(options) {
    super('Cannot set the following keys:', options);
  }
}

module.exports = {
  //** General errors */
  NotImplementedError,
  InvalidTypeError,

  //** User-related errors */
  MissingParameterError,
  BadlyFormattedParameterError,
  InvalidQueryStringParameterError,
  CannotUpdateStaticObjectError,
  ImmutablePropertyError,
  InvalidPostOperationError,

  //** Database-related errors */
  DuplicateIdError,
  DuplicateEmailError,
  DuplicateNameError,
  NotFoundError,
  DatabaseError,

  //** HTTP-related errors*/
  BadRequestError,
  HostNotFoundError,
  ConnectionRefusedError,
  HTTPError,

  //** Service-specific errors */
  GenericServiceError,
  IdentityServiceError,
  TechniquesServiceError,
  TacticsServiceError,
  PropertyNotAllowedError,
  SystemConfigurationNotFound,
  DefaultMarkingDefinitionsNotFoundError,
  OrganizationIdentityNotSetError,
  OrganizationIdentityNotFoundError,
  AnonymousUserAccountNotSetError,
  AnonymousUserAccountNotFoundError,
};
