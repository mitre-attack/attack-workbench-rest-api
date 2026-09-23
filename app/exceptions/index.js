'use strict';

function isErrorOptions(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeErrorOptions(options) {
  if (options instanceof Error) {
    const normalized = {};

    if (options.message) {
      normalized.details = options.message;
    }

    normalized.cause = options;

    for (const key of Object.keys(options)) {
      if (!(key in normalized)) {
        normalized[key] = options[key];
      }
    }

    return normalized;
  }

  if (isErrorOptions(options)) {
    return options;
  }

  return null;
}

class CustomError extends Error {
  constructor(message, options = {}) {
    super(message);

    // Set the error name to the class name
    this.name = this.constructor.name;

    // Apply options (if defined) to the error object
    const normalizedOptions = normalizeErrorOptions(options);
    if (normalizedOptions) {
      if (normalizedOptions.cause instanceof Error) {
        Object.defineProperty(this, 'cause', {
          value: normalizedOptions.cause,
          enumerable: false,
          writable: true,
          configurable: true,
        });
      }

      for (const key in normalizedOptions) {
        if (key !== 'cause' && Object.prototype.hasOwnProperty.call(normalizedOptions, key)) {
          this[key] = normalizedOptions[key];
        }
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
  constructor(messageOrOptions, options) {
    if (typeof messageOrOptions === 'string') {
      super(messageOrOptions, options);
      return;
    }

    super('Duplicate id', messageOrOptions);
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

class ActiveOrganizationIdentityDeleteError extends CustomError {
  constructor(identityRef, options) {
    super(
      `Cannot delete active organization identity ${identityRef}. Select a different organization identity before deleting this identity.`,
      options,
    );
  }
}

class MitreIdentityWriteError extends CustomError {
  constructor(identityRef, options) {
    super(
      `Cannot create, update, or delete protected MITRE identity ${identityRef}. Enable MITRE identity writes to modify this identity.`,
      options,
    );
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
  constructor(messageOrOptions, options) {
    if (typeof messageOrOptions === 'string') {
      super(messageOrOptions, options);
      return;
    }

    super('Invalid stix.type', messageOrOptions);
  }
}

class ImmutablePropertyError extends CustomError {
  constructor(propertyName, options) {
    super(`Cannot modify immutable property: ${propertyName}`, options);
  }
}

class InvalidPostOperationError extends CustomError {
  constructor(messageOrOptions, options) {
    if (typeof messageOrOptions === 'string') {
      super(messageOrOptions, options);
      return;
    }

    super('Cannot set the following keys:', messageOrOptions);
  }
}

class ValidationError extends CustomError {
  constructor(message = 'Validation failed', options) {
    super(message, options);
  }
}

class SchemaValidationError extends CustomError {
  constructor(schemaName, zodError, options = {}) {
    const errorDetails = zodError.errors
      .map((err) => `${err.path.join('.')}: ${err.message}`)
      .join('; ');

    super(`Schema validation failed for ${schemaName}: ${errorDetails}`, {
      ...options,
      zodError,
      schemaName,
    });
  }
}

class AlreadyRevokedError extends CustomError {
  constructor(options) {
    super('Object has already been revoked', options);
  }
}

class SelfRevocationError extends CustomError {
  constructor(options) {
    super('An object cannot revoke itself', options);
  }
}

class AlreadyReleasedError extends CustomError {
  constructor(version, options) {
    super(`This snapshot has already been tagged as version ${version}`, options);
  }
}

class DuplicateReleaseVersionError extends CustomError {
  constructor(trackId, version, options = {}) {
    super(`Release track ${trackId} already has tagged version ${version}`, {
      ...options,
      track_id: trackId,
      version,
    });
  }
}

class InvalidObjectRevisionError extends CustomError {
  constructor(missingReferences, options = {}) {
    super('One or more object revisions do not exist', {
      ...options,
      missing_references: missingReferences,
    });
  }
}

class ReleaseContentIntegrityError extends CustomError {
  constructor(missingReferences, options = {}) {
    super('Release-track primary content is incomplete', {
      ...options,
      missing_references: missingReferences,
    });
  }
}

class ReleaseTrackReconciliationError extends CustomError {
  constructor(trackId, reconciliationId, options = {}) {
    super('Release-track membership protection could not be reconciled', {
      ...options,
      track_id: trackId,
      reconciliation_id: reconciliationId,
    });
  }
}

class ReleasePublicationError extends CustomError {
  constructor(options) {
    super(
      'Release publication did not complete; inspect or retry the existing cleanup operation',
      options,
    );
  }
}

class ReleaseTrackAuditError extends CustomError {
  constructor(trackId, auditEventId, options = {}) {
    super('Release-track audit recording could not be finalized', {
      ...options,
      track_id: trackId,
      audit_event_id: auditEventId,
    });
  }
}

class TaggedSnapshotDeletionError extends CustomError {
  constructor(version, options) {
    super(
      `Tagged snapshot version ${version} cannot be deleted; convert it to a draft first`,
      options,
    );
  }
}

class HistoricalSnapshotDeletionError extends CustomError {
  constructor(snapshotModified, latestSnapshotModified, options = {}) {
    super('Only the latest untagged snapshot can be deleted', {
      ...options,
      snapshot_modified: new Date(snapshotModified).toISOString(),
      latest_snapshot_modified: latestSnapshotModified
        ? new Date(latestSnapshotModified).toISOString()
        : null,
    });
  }
}

class MemberPinnedRevisionError extends CustomError {
  constructor(options) {
    super(
      'This revision is pinned in the members tier of a release track and is released content: ' +
        'it cannot be deleted. Create a new revision instead ' +
        '(set x_mitre_deprecated on a new revision to retire the object).',
      options,
    );
  }
}

class SnapshotGraphPinnedRevisionError extends CustomError {
  constructor(options) {
    super(
      'This revision is referenced by a release-track snapshot graph and cannot be deleted. ' +
        'Create a new revision instead.',
      options,
    );
  }
}

class ImmutableStixRevisionError extends CustomError {
  constructor(options) {
    super(
      'Persisted STIX revisions are immutable and cannot be modified in place. ' +
        'Create a new revision with POST instead.',
      options,
    );
  }
}

class InvalidVersionError extends CustomError {
  constructor(message, options) {
    super(message || 'Invalid version', options);
  }
}

class InsufficientRoleError extends CustomError {
  constructor(requiredRole, options) {
    super(`This operation requires the ${requiredRole} role`, options);
  }
}

class ReleaseConflictError extends CustomError {
  constructor(message, options) {
    super(message || 'Release conflict: promotion aborted due to conflicting objects', options);
  }
}

class NoTaggedSnapshotsError extends CustomError {
  constructor(trackId, options) {
    super(`Component track ${trackId} has no tagged snapshots`, options);
  }
}

class InvalidComponentTypeError extends CustomError {
  constructor(trackId, options) {
    super(
      `Component track ${trackId} must be a standard track (virtual nesting is not allowed)`,
      options,
    );
  }
}

class VirtualSnapshotNotMaterializedError extends CustomError {
  constructor(trackId, options) {
    super(
      `Virtual release track ${trackId} has not been materialized from its composition`,
      options,
    );
  }
}

class TrackNotFoundError extends CustomError {
  constructor(trackId, options) {
    super(`Release track ${trackId} not found`, options);
  }
}

class ObjectHasValidationIssuesError extends CustomError {
  constructor(message = 'Object has unresolved validation issues', options) {
    super(message, options);
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

  //** Validation errors */
  ValidationError,
  SchemaValidationError,
  ObjectHasValidationIssuesError,

  //** Revocation errors */
  AlreadyRevokedError,
  SelfRevocationError,

  //** Version control errors */
  AlreadyReleasedError,
  DuplicateReleaseVersionError,
  InvalidObjectRevisionError,
  TaggedSnapshotDeletionError,
  HistoricalSnapshotDeletionError,
  InvalidVersionError,

  //** Release track errors */
  ReleaseConflictError,
  InsufficientRoleError,
  ReleaseContentIntegrityError,
  ReleaseTrackReconciliationError,
  ReleaseTrackAuditError,
  ReleasePublicationError,
  NoTaggedSnapshotsError,
  InvalidComponentTypeError,
  VirtualSnapshotNotMaterializedError,
  TrackNotFoundError,
  MemberPinnedRevisionError,
  SnapshotGraphPinnedRevisionError,
  ImmutableStixRevisionError,

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
  ActiveOrganizationIdentityDeleteError,
  MitreIdentityWriteError,
  AnonymousUserAccountNotSetError,
  AnonymousUserAccountNotFoundError,
};
