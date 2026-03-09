'use strict';

const uuid = require('uuid');
const logger = require('../../lib/logger');
const config = require('../../config/config');
const attackIdGenerator = require('../../lib/attack-id-generator');
const {
  createAttackExternalReference,
  findAttackExternalReference,
} = require('../../lib/external-reference-builder');
const {
  DatabaseError,
  IdentityServiceError,
  MissingParameterError,
  InvalidQueryStringParameterError,
  InvalidTypeError,
  OrganizationIdentityNotSetError,
  InvalidPostOperationError,
  ValidationError,
} = require('../../exceptions');
const { getSchema, processValidationIssues } = require('../system/validate-service');
const ServiceWithHooks = require('./hooks.service');

// Import required repositories
const systemConfigurationRepository = require('../../repository/system-configurations-repository');
const identitiesRepository = require('../../repository/identities-repository');
const userAccountsService = require('../system/user-accounts-service');

class BaseService extends ServiceWithHooks {
  constructor(type, repository) {
    super();
    this.type = type;
    this.repository = repository;

    // Initialize caches for identity lookups
    this.identityCache = new Map();
    this.userAccountCache = new Map();
  }

  // ============================
  // Pagination and Utility Methods
  // ============================

  static paginate(options, results) {
    if (options.includePagination) {
      let derivedTotalCount = 0;
      if (results[0].totalCount && results[0].totalCount.length > 0) {
        derivedTotalCount = results[0].totalCount[0].totalCount;
      }
      return {
        pagination: {
          total: derivedTotalCount,
          offset: options.offset,
          limit: options.limit,
        },
        data: results[0].documents,
      };
    } else {
      return results[0].documents;
    }
  }

  // ============================
  // System Configuration Methods
  // ============================

  async retrieveOrganizationIdentityRef() {
    const systemConfig = await systemConfigurationRepository.retrieveOne();

    if (systemConfig && systemConfig.organization_identity_ref) {
      return systemConfig.organization_identity_ref;
    } else {
      throw new OrganizationIdentityNotSetError();
    }
  }

  async setDefaultMarkingDefinitionsForObject(attackObject) {
    const systemConfig = await systemConfigurationRepository.retrieveOne({ lean: true });
    if (!systemConfig) return;

    const defaultMarkingDefinitions = systemConfig.default_marking_definitions || [];

    if (attackObject.stix.object_marking_refs) {
      attackObject.stix.object_marking_refs = attackObject.stix.object_marking_refs.concat(
        defaultMarkingDefinitions.filter((e) => !attackObject.stix.object_marking_refs.includes(e)),
      );
    } else {
      attackObject.stix.object_marking_refs = defaultMarkingDefinitions;
    }
  }

  // ============================
  // Identity Management Methods
  // ============================

  async addCreatedByAndModifiedByIdentitiesToAll(attackObjects) {
    for (const attackObject of attackObjects) {
      await this.addCreatedByAndModifiedByIdentities(attackObject);
    }
  }

  async addCreatedByAndModifiedByIdentities(attackObject) {
    if (attackObject?.stix?.created_by_ref) {
      await this.addCreatedByIdentity(attackObject);
    }

    if (attackObject?.stix?.x_mitre_modified_by_ref) {
      await this.addModifiedByIdentity(attackObject);
    }

    if (attackObject?.workspace?.workflow?.created_by_user_account) {
      await this.addCreatedByUserAccountWithCache(attackObject);
    }
  }

  async addCreatedByIdentity(attackObject) {
    if (this.identityCache.has(attackObject.stix.created_by_ref)) {
      attackObject.created_by_identity = this.identityCache.get(attackObject.stix.created_by_ref);
      return;
    }

    if (!attackObject.created_by_identity) {
      try {
        const identityObject = await identitiesRepository.retrieveLatestByStixIdLean(
          attackObject.stix.created_by_ref,
        );
        attackObject.created_by_identity = identityObject;
        this.identityCache.set(attackObject.stix.created_by_ref, identityObject);
      } catch (err) {
        // Ignore lookup errors
        logger.warn(err.message);
      }
    }
  }

  async addModifiedByIdentity(attackObject) {
    if (this.identityCache.has(attackObject.stix.x_mitre_modified_by_ref)) {
      attackObject.modified_by_identity = this.identityCache.get(
        attackObject.stix.x_mitre_modified_by_ref,
      );
      return;
    }

    if (!attackObject.modified_by_identity) {
      try {
        const identityObject = await identitiesRepository.retrieveLatestByStixIdLean(
          attackObject.stix.x_mitre_modified_by_ref,
        );
        attackObject.modified_by_identity = identityObject;
        this.identityCache.set(attackObject.stix.x_mitre_modified_by_ref, identityObject);
      } catch (err) {
        // Ignore lookup errors
        logger.warn(err.message);
      }
    }
  }

  async addCreatedByUserAccountWithCache(attackObject) {
    const userAccountRef = attackObject?.workspace?.workflow?.created_by_user_account;
    if (!userAccountRef) return;

    if (this.userAccountCache.has(userAccountRef)) {
      attackObject.created_by_user_account = this.userAccountCache.get(userAccountRef);
      return;
    }

    if (!attackObject.created_by_user_account) {
      await userAccountsService.addCreatedByUserAccount(attackObject);
      this.userAccountCache.set(userAccountRef, attackObject.created_by_user_account);
    }
  }

  // ============================
  // CRUD Operations
  // ============================

  async retrieveAll(options) {
    let results;
    try {
      results = await this.repository.retrieveAll(options);
    } catch (err) {
      throw new DatabaseError(err);
    }

    try {
      await this.addCreatedByAndModifiedByIdentitiesToAll(results[0].documents);
    } catch (err) {
      throw new IdentityServiceError({
        details: err.message,
        cause: err,
      });
    }
    return BaseService.paginate(options, results);
  }

  async retrieveById(stixId, options) {
    if (!stixId) {
      throw new MissingParameterError('stixId');
    }

    if (options.versions === 'all') {
      const documents = await this.repository.retrieveAllById(stixId);

      try {
        await this.addCreatedByAndModifiedByIdentitiesToAll(documents);
      } catch (err) {
        throw new IdentityServiceError({
          details: err.message,
          cause: err,
        });
      }
      return documents;
    } else if (options.versions === 'latest') {
      const document = await this.repository.retrieveLatestByStixIdLean(stixId);

      if (document) {
        try {
          await this.addCreatedByAndModifiedByIdentities(document);
        } catch (err) {
          throw new IdentityServiceError({
            details: err.message,
            cause: err,
          });
        }
        return [document];
      } else {
        return [];
      }
    } else {
      throw new InvalidQueryStringParameterError({ parameterName: 'versions' });
    }
  }

  async retrieveVersionById(stixId, modified) {
    if (!stixId) {
      throw new MissingParameterError('stixId');
    }

    if (!modified) {
      throw new MissingParameterError('modified');
    }

    const document = await this.repository.retrieveOneByVersion(stixId, modified);

    if (!document) {
      return null;
    } else {
      try {
        await this.addCreatedByAndModifiedByIdentities(document);
      } catch (err) {
        throw new IdentityServiceError({
          details: err.message,
          cause: err,
        });
      }
      return document;
    }
  }

  /**
   * Stream multiple attack objects by their version identifiers
   * @param {Array<{object_ref: string, object_modified: string}>} xMitreContents - Array of x_mitre_contents elements
   * @yields {Object} Attack objects with identities populated
   */
  async *streamBulkByIdAndModified(xMitreContents) {
    if (!xMitreContents || !Array.isArray(xMitreContents) || xMitreContents.length === 0) {
      return;
    }

    // Process identities in small batches as we stream
    const identityBatch = [];
    const IDENTITY_BATCH_SIZE = 50;

    for await (const doc of this.repository.streamManyByIdAndModified(xMitreContents)) {
      identityBatch.push(doc);

      // Process identities when batch is full
      if (identityBatch.length >= IDENTITY_BATCH_SIZE) {
        await Promise.all(identityBatch.map((d) => this.addCreatedByAndModifiedByIdentities(d)));

        // Yield processed documents
        for (const processedDoc of identityBatch) {
          yield processedDoc;
        }

        // Clear the batch
        identityBatch.length = 0;
      }
    }

    // Process remaining documents
    if (identityBatch.length > 0) {
      await Promise.all(identityBatch.map((d) => this.addCreatedByAndModifiedByIdentities(d)));

      for (const processedDoc of identityBatch) {
        yield processedDoc;
      }
    }
  }

  /**
   * Retrieve multiple attack objects by their version identifiers
   * @param {Array<{object_ref: string, object_modified: string}>} xMitreContents - Array of x_mitre_contents elements
   * @returns {Promise<Array<Object>>} Array of attack objects with identities populated
   */
  async getBulkByIdAndModified(xMitreContents) {
    if (!xMitreContents || !Array.isArray(xMitreContents) || xMitreContents.length === 0) {
      return [];
    }
    const documents = await this.repository.findManyByIdAndModified(xMitreContents);

    // Process identities in parallel
    await Promise.all(documents.map((doc) => this.addCreatedByAndModifiedByIdentities(doc)));

    return documents;
  }

  /**
   * Fields that are always server-controlled, regardless of STIX type or operation.
   * Declared as a static class property for discoverability and future expansion.
   *
   * Note: Fields like `created_by_ref`, `x_mitre_modified_by_ref`, and `object_marking_refs`
   * are intentionally NOT here — they are only server-controlled in certain contexts
   * (e.g., new objects only, specific STIX types) or use merge semantics (marking definitions).
   * Their handling remains in the existing composition logic of create() and updateFull().
   *
   * Future additions: 'id', 'created', 'modified' (when server takes control of these)
   */
  static ALWAYS_STRIPPED_STIX_FIELDS = ['x_mitre_attack_spec_version'];

  /**
   * Silently strips universally server-controlled fields from client input.
   *
   * The API is idempotent with respect to these fields: clients can send them
   * and they'll be ignored. The server always composes the correct values during
   * the subsequent composition and set-server-controlled-fields pipeline stages.
   *
   * @param {Object} data - The incoming request data ({ stix, workspace })
   * @param {Object} [options] - Options
   * @param {boolean} [options.preserveAttackId] - If true, preserve workspace.attack_id
   *   and ATT&CK external references (plumbing for future admin override scenarios)
   */
  stripServerControlledFields(data, options = {}) {
    const stix = data.stix;
    if (!stix) return;

    // Strip universally server-controlled STIX fields
    for (const field of BaseService.ALWAYS_STRIPPED_STIX_FIELDS) {
      delete stix[field];
    }

    if (!options.preserveAttackId) {
      // Strip workspace.attack_id — server generates/carries forward
      if (data.workspace) {
        delete data.workspace.attack_id;
      }

      // Filter ATT&CK source refs from external_references; preserve user-provided refs.
      // The server will generate the correct ATT&CK ref and prepend it at index 0.
      if (stix.external_references) {
        stix.external_references = stix.external_references.filter(
          (ref) => !config.attackSourceNames.includes(ref.source_name),
        );
      }
    }
  }

  /**
   * Validates the fully-composed STIX object against the ADM schema.
   *
   * This runs AFTER all server-controlled fields have been populated (external_references,
   * x_mitre_attack_spec_version, created_by_ref, etc.) and BEFORE the repository save.
   * Because the object is fully composed, the raw ADM schema validates cleanly —
   * ERROR_TRANSFORMATION_RULES suppression rules naturally don't fire since the
   * server-controlled fields are present. Only warning rules (e.g., x_mitre_shortname)
   * may apply.
   *
   * @param {Object} data - The composed request data ({ stix, workspace })
   * @returns {{ errors: Array, warnings: Array }} Validation results
   */
  validateComposedObject(data) {
    const empty = { errors: [], warnings: [] };
    if (!config.validateRequests.withAttackDataModel) return empty;

    const stixType = data.stix?.type;
    const status = data.workspace?.workflow?.state || 'reviewed';

    const schema = getSchema(stixType, status);
    if (!schema) return empty;

    const result = schema.safeParse(data.stix);
    if (result.success) return empty;

    return processValidationIssues(result.error.issues, stixType);
  }

  /**
   * Creates a new STIX object or a new version of an existing object.
   *
   * Pipeline stages:
   *   1. ANALYZE REQUEST — validate type, determine new vs new-version
   *   2. COMPOSE OBJECT — strip server-controlled fields, generate ATT&CK ID + external refs
   *   3. SET SERVER-CONTROLLED FIELDS — spec version, identity refs, marking definitions
   *   4. LIFECYCLE HOOKS — subclass data transformations (beforeCreate)
   *   5. VALIDATE WITH ADM — full schema validation on the composed object
   *   6. PERSIST — save document, run afterCreate hook, emit event (skip if dryRun)
   *
   * @param {Object} data - The request data ({ stix, workspace })
   * @param {Object} [options] - Options
   * @param {boolean} [options.import] - If true, use the import path (STIX bundle import)
   * @param {string} [options.userAccountId] - The authenticated user's account ID
   * @param {string} [options.parentTechniqueId] - Parent technique ATT&CK ID (for subtechniques)
   * @param {boolean} [options.dryRun] - If true, compose and validate but skip persistence
   * @returns {Object} The created document (or composed data if dryRun) with warnings array
   */
  async create(data, options) {
    options = options || {};

    // ──────────────────────────────────────────────
    // 1. ANALYZE REQUEST
    // ──────────────────────────────────────────────
    if (data?.stix?.type !== this.type) {
      throw new InvalidTypeError();
    }

    if (options.import) {
      return this._createFromImport(data, options);
    }

    // Determine if this is a new object or a new version of an existing object
    let existingVersion = null;
    if (data.stix?.id) {
      // TODO change this to repository's get latest method - there should be a method for that
      const existingVersions = await this.repository.retrieveAllById(data.stix.id);
      if (existingVersions?.length > 0) {
        existingVersion = existingVersions[0];
        logger.debug(
          `Found existing version(s) with stix.id: ${data.stix.id}, will reuse attack_id: ${existingVersion.workspace?.attack_id}`,
        );
      }
    }
    // TODO: diff analysis — compare posted fields vs existingVersion fields

    // ──────────────────────────────────────────────
    // 2. COMPOSE OBJECT
    // ──────────────────────────────────────────────
    this.stripServerControlledFields(data, options);
    data.stix.external_references = data.stix.external_references || [];

    // Generate or reuse the ATT&CK ID
    if (attackIdGenerator.requiresAttackId(this.type)) {
      let attackId;

      if (existingVersion) {
        // Reuse the attack_id from the existing version
        attackId = existingVersion.workspace.attack_id;
        logger.debug(`Reusing ATT&CK ID from existing version: ${attackId}`);
      } else {
        const isSubtechnique = data.stix?.x_mitre_is_subtechnique === true;
        const parentTechniqueId = options?.parentTechniqueId;

        // Validate subtechnique requirements
        if (isSubtechnique && !parentTechniqueId) {
          throw new InvalidPostOperationError(
            'Subtechniques require a parentTechniqueId query parameter. Provide the parent technique ATT&CK ID (e.g., T1234).',
          );
        }
        if (!isSubtechnique && parentTechniqueId) {
          throw new InvalidPostOperationError(
            'parentTechniqueId query parameter is only valid for subtechniques (x_mitre_is_subtechnique: true).',
          );
        }

        // Generate a new ATT&CK ID
        attackId = await attackIdGenerator.generateAttackId(
          this.type,
          this.repository,
          isSubtechnique,
          parentTechniqueId,
        );
        logger.debug(`Generated new ATT&CK ID: ${attackId}`);
      }

      data.workspace = data.workspace || {};
      data.workspace.attack_id = attackId;
    }

    // Generate and prepend the ATT&CK external reference
    const attackRef = createAttackExternalReference(data);
    if (attackRef) {
      data.stix.external_references.unshift(attackRef);
    }

    // ──────────────────────────────────────────────
    // 3. SET SERVER-CONTROLLED FIELDS
    // ──────────────────────────────────────────────
    // 3a. STIX fields
    data.stix.x_mitre_attack_spec_version = config.app.attackSpecVersion;
    // TODO: data.stix.modified = new Date().toISOString() (when server controls timestamps)

    const organizationIdentityRef = await this.retrieveOrganizationIdentityRef();

    // Check for an existing object (may differ from existingVersion if stix.id was just generated)
    let existingObject;
    if (data.stix.id) {
      existingObject = await this.repository.retrieveOneById(data.stix.id);
    }

    if (existingObject) {
      // New version of an existing object — only set modified_by
      data.stix.x_mitre_modified_by_ref = organizationIdentityRef;
    } else {
      // Brand-new object — set ID, created_by, modified_by
      if (!data.stix.id) {
        data.stix.id = `${data.stix.type}--${uuid.v4()}`;
      }
      data.stix.created_by_ref = organizationIdentityRef;
      data.stix.x_mitre_modified_by_ref = organizationIdentityRef;
    }

    // 3b. Metadata fields
    if (options.userAccountId) {
      data.workspace.workflow.created_by_user_account = options.userAccountId;
    }
    await this.setDefaultMarkingDefinitionsForObject(data);

    // ──────────────────────────────────────────────
    // 4. LIFECYCLE HOOKS
    // ──────────────────────────────────────────────
    await this.beforeCreate(data, options);

    // ──────────────────────────────────────────────
    // 5. VALIDATE WITH ADM
    // ──────────────────────────────────────────────
    const { errors, warnings } = this.validateComposedObject(data);

    if (errors.length > 0) {
      throw new ValidationError('ADM validation failed', { details: errors, warnings });
    }

    // ──────────────────────────────────────────────
    // 6. PERSIST (skip if dry-run)
    // ──────────────────────────────────────────────
    if (options.dryRun) {
      return { ...data, warnings };
    }

    const createdDocument = await this.repository.save(data);
    await this.afterCreate(createdDocument, options);
    await this.emitCreatedEvent(createdDocument, options);

    const result = createdDocument.toObject ? createdDocument.toObject() : createdDocument;
    result.warnings = warnings;
    return result;
  }

  /**
   * Import path for create(): handles STIX bundle imports where the object
   * already has server-controlled fields populated by the source system.
   *
   * @param {Object} data - The request data ({ stix, workspace })
   * @param {Object} options - Options passed from create()
   * @returns {Object} The created document
   * @private
   */
  async _createFromImport(data, options) {
    // Extract ATT&CK ID from external_references and propagate to workspace.attack_id
    const attackIdInExternalReferences = attackIdGenerator.extractAttackIdFromExternalReferences(
      data.stix,
    );
    if (attackIdInExternalReferences) {
      data.workspace = data.workspace || {};
      data.workspace.attack_id = attackIdInExternalReferences;
    }

    const { errors, warnings } = this.validateComposedObject(data);

    if (errors.length > 0) {
      throw new ValidationError('ADM validation failed', { details: errors, warnings });
    }

    if (options.dryRun) {
      return { ...data, warnings };
    }

    await this.beforeCreate(data, options);
    const createdDocument = await this.repository.save(data);
    await this.afterCreate(createdDocument, options);
    await this.emitCreatedEvent(createdDocument, options);

    const result = createdDocument.toObject ? createdDocument.toObject() : createdDocument;
    result.warnings = warnings;
    return result;
  }

  /**
   * Updates an existing STIX object version in-place.
   *
   * Pipeline stages:
   *   1. ANALYZE REQUEST — retrieve existing document by stixId + modified
   *   2. COMPOSE OBJECT — strip server-controlled fields, compose from existing document
   *   3. SET SERVER-CONTROLLED FIELDS — (future: bump modified timestamp)
   *   4. LIFECYCLE HOOKS — subclass data transformations (beforeUpdate)
   *   5. VALIDATE WITH ADM — full schema validation on the composed object
   *   6. PERSIST — merge and save document, run afterUpdate hook, emit event (skip if dryRun)
   *
   * @param {string} stixId - The STIX ID of the object to update
   * @param {string} stixModified - The modified timestamp identifying the specific version
   * @param {Object} data - The request data ({ stix, workspace })
   * @param {Object} [options] - Options
   * @param {boolean} [options.dryRun] - If true, compose and validate but skip persistence
   * @returns {Object|null} The updated document (or composed data if dryRun), null if not found
   */
  async updateFull(stixId, stixModified, data, options) {
    options = options || {};

    // ──────────────────────────────────────────────
    // 1. ANALYZE REQUEST
    // ──────────────────────────────────────────────
    if (!stixId) {
      throw new MissingParameterError('stixId');
    }
    if (!stixModified) {
      throw new MissingParameterError('modified');
    }

    const document = await this.repository.retrieveOneByVersion(stixId, stixModified);
    if (!document) {
      return null;
    }
    // TODO: diff analysis — detect field-level changes vs document
    // TODO: if no changes detected, short-circuit (no-op)

    // ──────────────────────────────────────────────
    // 2. COMPOSE OBJECT
    // ──────────────────────────────────────────────
    this.stripServerControlledFields(data, options);

    // Compose server-controlled fields from existing document
    data.stix.x_mitre_attack_spec_version = document.stix.x_mitre_attack_spec_version;

    if (document.workspace?.attack_id) {
      data.workspace = data.workspace || {};
      data.workspace.attack_id = document.workspace.attack_id;
    }

    // Compose external_references: prepend existing ATT&CK ref onto user's refs
    data.stix.external_references = data.stix.external_references || [];
    const existingAttackRef = findAttackExternalReference(document.stix.external_references);
    if (existingAttackRef) {
      data.stix.external_references.unshift(existingAttackRef);
    }

    // ──────────────────────────────────────────────
    // 3. SET SERVER-CONTROLLED FIELDS
    // ──────────────────────────────────────────────
    // TODO: bump stix.modified if diff analysis detects changes
    // TODO: set x_mitre_modified_by_ref to current user's org identity

    // ──────────────────────────────────────────────
    // 4. LIFECYCLE HOOKS
    // ──────────────────────────────────────────────
    await this.beforeUpdate(stixId, stixModified, data, document, options);

    // ──────────────────────────────────────────────
    // 5. VALIDATE WITH ADM
    // ──────────────────────────────────────────────
    const { errors, warnings } = this.validateComposedObject(data);

    if (errors.length > 0) {
      throw new ValidationError('ADM validation failed', { details: errors, warnings });
    }

    // ──────────────────────────────────────────────
    // 6. PERSIST (skip if dry-run)
    // ──────────────────────────────────────────────
    if (options.dryRun) return { ...data, warnings };

    const newDocument = await this.repository.updateAndSave(document, data);

    if (newDocument === document) {
      await this.afterUpdate(newDocument, document);
      await this.emitUpdatedEvent(newDocument, document);
      const result = newDocument.toObject ? newDocument.toObject() : newDocument;
      result.warnings = warnings;
      return result;
    } else {
      throw new DatabaseError({
        details: 'Document could not be saved',
        document,
      });
    }
  }

  // TODO rename to deleteVersionByStixId and repurpose the existing name for deleting by the document's unique _id
  async deleteVersionById(stixId, stixModified) {
    if (!stixId) {
      throw new MissingParameterError('stixId');
    }

    if (!stixModified) {
      throw new MissingParameterError('modified');
    }

    const document = await this.repository.findOneAndDelete(stixId, stixModified);

    if (!document) {
      //Note: document is null if not found
      return null;
    }
    return document;
  }

  // TODO rename to deleteManyByStixId
  async deleteById(stixId) {
    if (!stixId) {
      throw new MissingParameterError('stixId');
    }
    return await this.repository.deleteMany(stixId);
  }
}

module.exports = BaseService;
