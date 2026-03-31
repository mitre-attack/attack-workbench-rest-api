/* eslint-disable no-unused-vars */
// Note there is a bug in eslint where single line comment will not work ^
'use strict';

const logger = require('../../lib/logger');
const EventBus = require('../../lib/event-bus');
const Exceptions = require('../../exceptions');

class ServiceWithHooks {
  /** ******************************** CREATE ******************************** */
  /**
   * Lifecycle hook: Called before create() saves the document
   * Subclasses can override to prepare data
   * @param {object} _data - The data being created
   * @param {object} _options - Creation options
   */

  async beforeCreate(_data, _options) {
    // Default: no-op
  }

  create(data, options) {
    throw new Exceptions.NotImplementedError(this.constructor.name, 'create');
  }

  /**
   * Lifecycle hook: Called after create() saves the document
   * Subclasses can override to handle post-creation logic
   * @param {object} _document - The created document
   * @param {object} _options - Creation options
   */

  async afterCreate(_document, _options) {
    // Default: no-op
  }

  /**
   * Emit event after document creation
   * @param {object} document - The created document
   * @param {object} options - Creation options
   */
  async emitCreatedEvent(document, options) {
    const eventName = `${this.type}::created`;

    logger.info(`Emitting event '${eventName}' for ${document.stix.id}`);

    await EventBus.emit(eventName, {
      stixId: document.stix.id,
      document: document.toObject ? document.toObject() : document,
      type: this.type,
      options,
    });

    logger.info(`Event '${eventName}' emission complete`);
  }

  /** ******************************** READ ******************************** */
  /** ************ (these dont need hooks or event emitters) *************** */

  // TODO add JSDoc
  retrieveAll(options) {
    throw new Exceptions.NotImplementedError(this.constructor.name, 'retrieveAll');
  }

  // TODO add JSDoc
  retrieveById(stixId, options) {
    throw new Exceptions.NotImplementedError(this.constructor.name, 'retrieveById');
  }

  // TODO add JSDoc
  retrieveVersionById(stixId, modified) {
    throw new Exceptions.NotImplementedError(this.constructor.name, 'retrieveVersionById');
  }
  /** ******************************** UPDATE ******************************** */

  /**
   * Lifecycle hook: Called before updateFull() saves the document
   * Subclasses can override to prepare data
   * @param {string} _stixId - The STIX ID
   * @param {string} _stixModified - The modified timestamp
   * @param {object} _data - The update data
   * @param {object} _existingDocument - The existing document
   * @param {object} [_options] - Options (e.g., { dryRun: true })
   */
  async beforeUpdate(_stixId, _stixModified, _data, _existingDocument, _options) {
    // Default: no-op
  }

  // TODO add JSDoc
  updateFull(stixId, stixModified, data) {
    throw new Exceptions.NotImplementedError(this.constructor.name, 'updateFull');
  }

  /**
   * Lifecycle hook: Called after updateFull() saves the document
   * Subclasses can override to handle post-update logic
   * @param {object} _updatedDocument - The updated document
   * @param {object} _previousDocument - The previous document (before update)
   */
  async afterUpdate(_updatedDocument, _previousDocument) {
    // Default: no-op
  }

  /**
   * Emit event after document update
   * @param {object} updatedDocument - The updated document
   * @param {object} previousDocument - The previous document (before update)
   */
  async emitUpdatedEvent(updatedDocument, previousDocument) {
    const EventBus = require('../../lib/event-bus');
    const eventName = `${this.type}::updated`;
    await EventBus.emit(eventName, {
      stixId: updatedDocument.stix.id,
      stixModified: updatedDocument.stix.modified,
      document: updatedDocument.toObject ? updatedDocument.toObject() : updatedDocument,
      previousDocument: previousDocument.toObject ? previousDocument.toObject() : previousDocument,
      type: this.type,
    });
  }

  /** ******************************** DELETE ******************************** */
  // TODO there are multiple delete methods (e.g., deleteById, deleteVersionById): it is unclear whether they can/should share lifecycle hooks or have their own; if their own, then can the delete methods be consolidated?

  /**
   * Lifecycle hook: Called before deleteVersionById() saves the document
   * Subclasses can override to prepare data
   * @param {string} _stixId - The STIX ID
   * @param {string} _stixModified - The modified timestamp
   * @param {object} _data - The update data
   * @param {object} _existingDocument - The existing document
   */

  async beforeDeleteVersionById(_stixId, _stixModified, _data, _existingDocument) {
    // Default: no-op
  }

  async afterDeleteVersionById(_deletedDocument) {
    /// Default: no-op
  }

  /** ******************************** REVOKE ******************************** */

  /**
   * Lifecycle hook: Called before revoke() processes the revocation
   * Subclasses can override to validate or prepare data
   * @param {object} _objectA - The object being revoked
   * @param {object} _objectB - The revoking object
   * @param {object} _options - Revocation options
   */
  async beforeRevoke(_objectA, _objectB, _options) {
    // Default: no-op
  }

  /**
   * Lifecycle hook: Called after revoke() completes
   * Subclasses can override to handle post-revocation logic
   * @param {object} _revokedDocument - The revoked document
   * @param {object} _objectB - The revoking object
   * @param {object} _options - Revocation options
   */
  async afterRevoke(_revokedDocument, _objectB, _options) {
    // Default: no-op
  }

  /**
   * Emit event after document revocation
   * @param {object} revokedDocument - The revoked document
   * @param {object} revokingDocument - The revoking document
   * @param {object} options - Revocation options
   * @param {object} [metadata] - Additional event metadata
   * @param {string[]} [metadata.excludeRelationshipIds] - Relationship STIX IDs to exclude from deprecation
   */
  async emitRevokedEvent(revokedDocument, revokingDocument, options, metadata = {}) {
    const eventName = `${this.type}::revoked`;

    logger.info(`Emitting event '${eventName}' for ${revokedDocument.stix.id}`);

    await EventBus.emit(eventName, {
      stixId: revokedDocument.stix.id,
      revokedDocument: revokedDocument.toObject ? revokedDocument.toObject() : revokedDocument,
      revokingDocument: revokingDocument.toObject ? revokingDocument.toObject() : revokingDocument,
      type: this.type,
      options,
      excludeRelationshipIds: metadata.excludeRelationshipIds || [],
    });

    logger.info(`Event '${eventName}' emission complete`);
  }
}

module.exports = ServiceWithHooks;
