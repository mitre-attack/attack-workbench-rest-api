'use strict';

/**
 * DTO builder for universal workflow endpoint responses.
 *
 * All workflow endpoints (revoke, convert-to-subtechnique, convert-to-technique)
 * return a WorkflowResult so that the caller has full visibility into every
 * object that was created, modified, deprecated, or deleted as a consequence
 * of their request.
 *
 * @see docs/developer/workflow-response-pattern.md
 */
class WorkflowResult {
  /**
   * @param {string} workflowName - Discriminator string (e.g., 'revoke', 'convert-to-subtechnique')
   */
  constructor(workflowName) {
    this.workflow = workflowName;
    this.primary = null;
    this.sideEffects = {
      created: [],
      modified: [],
      deprecated: [],
      deleted: { count: 0, stixIds: [] },
    };
    this.warnings = [];
  }

  /**
   * Set the primary object that the user acted on.
   * @param {Object} document - Full workspace+stix document (Mongoose doc or plain object)
   */
  setPrimary(document) {
    this.primary = document;
  }

  /**
   * Add one or more documents to the created side-effects list.
   * @param {Object|Array<Object>} docOrDocs - Document(s) created as a consequence
   */
  addCreated(docOrDocs) {
    this._pushDocs(this.sideEffects.created, docOrDocs);
  }

  /**
   * Add one or more documents to the modified side-effects list.
   * @param {Object|Array<Object>} docOrDocs - Document(s) modified as a consequence
   */
  addModified(docOrDocs) {
    this._pushDocs(this.sideEffects.modified, docOrDocs);
  }

  /**
   * Add one or more documents to the deprecated side-effects list.
   * @param {Object|Array<Object>} docOrDocs - Document(s) deprecated as a consequence
   */
  addDeprecated(docOrDocs) {
    this._pushDocs(this.sideEffects.deprecated, docOrDocs);
  }

  /**
   * Record hard-deleted documents by their STIX IDs.
   * @param {Array<string>} stixIds - STIX IDs of deleted documents
   */
  addDeleted(stixIds) {
    if (!Array.isArray(stixIds)) return;
    this.sideEffects.deleted.stixIds.push(...stixIds);
    this.sideEffects.deleted.count = this.sideEffects.deleted.stixIds.length;
  }

  /**
   * Add a single warning.
   * @param {string|Object} message - Warning string or structured warning object
   */
  addWarning(message) {
    this.warnings.push(message);
  }

  /**
   * Add multiple warnings.
   * @param {Array<string|Object>} messages - Warning strings or structured warning objects
   */
  addWarnings(messages) {
    if (!Array.isArray(messages)) return;
    this.warnings.push(...messages);
  }

  /**
   * Merge results returned by EventBus.emit() into this WorkflowResult.
   *
   * Each element in eventResults is an object returned by an event handler
   * with any subset of: { created, modified, deprecated, warnings }.
   *
   * @param {Array<Object>} eventResults - Array of handler return values
   */
  mergeEventResults(eventResults) {
    if (!Array.isArray(eventResults)) return;
    for (const handlerResult of eventResults) {
      if (!handlerResult || typeof handlerResult !== 'object') continue;
      if (handlerResult.created) this.addCreated(handlerResult.created);
      if (handlerResult.modified) this.addModified(handlerResult.modified);
      if (handlerResult.deprecated) this.addDeprecated(handlerResult.deprecated);
      if (handlerResult.warnings) this.addWarnings(handlerResult.warnings);
    }
  }

  /**
   * Serialize to a plain JSON-safe object.
   *
   * Calls .toObject() on any Mongoose documents and strips internal fields
   * (_id, __v, __t) from all documents.
   *
   * @returns {Object} Plain object suitable for res.json()
   */
  toJSON() {
    return {
      workflow: this.workflow,
      primary: WorkflowResult._toPlain(this.primary),
      sideEffects: {
        created: this.sideEffects.created.map(WorkflowResult._toPlain),
        modified: this.sideEffects.modified.map(WorkflowResult._toPlain),
        deprecated: this.sideEffects.deprecated.map(WorkflowResult._toPlain),
        deleted: { ...this.sideEffects.deleted },
      },
      warnings: [...this.warnings],
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /**
   * Push one or more documents into an array.
   * @param {Array} target
   * @param {Object|Array<Object>} docOrDocs
   * @private
   */
  _pushDocs(target, docOrDocs) {
    if (Array.isArray(docOrDocs)) {
      target.push(...docOrDocs);
    } else if (docOrDocs) {
      target.push(docOrDocs);
    }
  }

  /**
   * Convert a Mongoose document (or plain object) to a clean plain object.
   * Strips _id, __v, __t which are internal Mongoose/MongoDB fields.
   * @param {Object} doc
   * @returns {Object}
   * @private
   */
  static _toPlain(doc) {
    if (!doc) return doc;
    const plain = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
    delete plain._id;
    delete plain.__v;
    delete plain.__t;
    return plain;
  }
}

module.exports = WorkflowResult;
