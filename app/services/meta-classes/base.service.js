'use strict';

const uuid = require('uuid');
const logger = require('../../lib/logger');
const config = require('../../config/config');
const attackIdGenerator = require('../../lib/attack-id-generator');
const {
  buildAttackExternalReference,
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
  //InvalidPostOperationError,
  ValidationError,
  BadRequestError,
  NotFoundError,
  AlreadyRevokedError,
  SelfRevocationError,
} = require('../../exceptions');
const { getSchema } = require('../../lib/validation-schemas');
const ServiceWithHooks = require('./hooks.service');
const WorkflowResult = require('../../lib/workflow-result');

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
  static ALWAYS_STRIPPED_STIX_FIELDS = ['x_mitre_attack_spec_version', 'revoked'];

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
  static stripServerControlledFields(data, options = {}) {
    const stix = data.stix;
    if (!stix) return;

    // Strip universally server-controlled STIX fields
    for (const field of BaseService.ALWAYS_STRIPPED_STIX_FIELDS) {
      delete stix[field];
    }

    // Strip workspace.validation — server-controlled; recomputed on every
    // create/update so a stale entry from a prior GET cannot ride along.
    if (data.workspace) {
      delete data.workspace.validation;
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
   * Recursively removes properties whose value is an empty string from an object.
   * This prevents clients from persisting meaningless empty-string values.
   *
   * @param {Object} obj - Any plain object (stix, workspace, nested sub-objects)
   */
  static stripEmptyStrings(obj) {
    if (!obj || typeof obj !== 'object') return;

    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val === '') {
        delete obj[key];
      } else if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
        BaseService.stripEmptyStrings(val);
      }
    }
  }

  /**
   * Coerces any STIX date fields that are JavaScript Date objects into ISO-8601 strings.
   *
   * Mongoose schemas define timestamp fields (created, modified, start_time, stop_time)
   * as `{ type: Date }`, so documents retrieved from MongoDB carry JS Date objects.
   * The ADM validation layer (Zod) expects RFC3339 strings.  This method bridges that
   * gap so that data originating from the repository can safely pass through create()
   * without manual per-call-site coercion.
   *
   * @param {Object} data - The request data ({ stix, workspace })
   */
  static normalizeDateFields(data) {
    const stix = data.stix;
    if (!stix) return;

    const dateFields = ['created', 'modified', 'start_time', 'stop_time'];
    for (const field of dateFields) {
      if (stix[field] instanceof Date) {
        stix[field] = stix[field].toISOString();
      }
    }
  }

  /**
   * Validates the fully-composed STIX object against the ADM schema.
   *
   * This runs AFTER all server-controlled fields have been populated (external_references,
   * x_mitre_attack_spec_version, created_by_ref, etc.) and BEFORE the repository save.
   * Validation errors that match a stored bypass rule are filtered out.
   *
   * @param {Object} data - The composed request data ({ stix, workspace })
   * @returns {Promise<{ errors: Array, warnings: Array }>} Validation results
   */
  async validateComposedObject(data) {
    const empty = { errors: [], warnings: [] };
    if (!config.validateRequests.withAttackDataModel) return empty;

    const stixType = data.stix?.type;
    const status = data.workspace?.workflow?.state || 'reviewed';

    const schema = getSchema(stixType, status);
    if (!schema) return empty;

    const result = schema.safeParse(data.stix);
    if (result.success) return empty;

    // Convert Zod issues to error objects
    const allErrors = result.error.issues.map((issue) => ({
      message: `${issue.path.join('.')} is ${issue.message}`,
      path: issue.path,
      code: issue.code,
      input: issue.input,
    }));

    // Filter out bypassed errors via the event bus
    const EventBus = require('../../lib/event-bus');
    const Events = require('../../lib/event-constants');
    const results = await EventBus.emit(Events.VALIDATION_BYPASS_CHECK_REQUESTED, {
      errors: allErrors,
      stixType,
    });

    // The handler returns { errors, warnings }
    const bypassResult = results?.[0] ?? { errors: allErrors, warnings: [] };

    return { errors: bypassResult.errors, warnings: bypassResult.warnings };
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

    // For matrices, capture the external_id from the client-provided ATT&CK reference
    // before stripping removes it. Matrices don't have auto-generated ATT&CK IDs;
    // their external_id is the domain name (e.g., "enterprise-attack").
    let matrixExternalId;
    if (data.stix?.type === 'x-mitre-matrix') {
      matrixExternalId =
        findAttackExternalReference(existingVersion?.stix?.external_references)?.external_id ||
        findAttackExternalReference(data.stix?.external_references)?.external_id;
    }

    BaseService.stripServerControlledFields(data, options);
    BaseService.stripEmptyStrings(data.stix);
    BaseService.stripEmptyStrings(data.workspace);
    BaseService.normalizeDateFields(data);
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
          logger.warn(
            'Subtechniques require a parentTechniqueId query parameter. Provide the parent technique ATT&CK ID (e.g., T1234).',
          );
          // TODO start throwing after migrating workflow to BE
          // throw new InvalidPostOperationError(
          //   'Subtechniques require a parentTechniqueId query parameter. Provide the parent technique ATT&CK ID (e.g., T1234).',
          // );
        }
        if (!isSubtechnique && parentTechniqueId) {
          logger.warn(
            'parentTechniqueId query parameter is only valid for subtechniques (x_mitre_is_subtechnique: true).',
          );
          // TODO start throwing after migrating workflow to BE
          // throw new InvalidPostOperationError(
          //   'parentTechniqueId query parameter is only valid for subtechniques (x_mitre_is_subtechnique: true).',
          // );
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
    let attackRef;
    if (matrixExternalId) {
      // Matrices derive their external reference from the domain name, not workspace.attack_id
      attackRef = buildAttackExternalReference(matrixExternalId, data.stix.type);
    } else {
      attackRef = createAttackExternalReference(data, { previousVersion: existingVersion });
    }
    if (attackRef) {
      data.stix.external_references.unshift(attackRef);
    }

    // TODO is this the best approach?
    if (data.stix.external_references.length === 0) {
      // remove field
      delete data.stix.external_references;
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
      // New version of an existing object — carry forward revoked status, set modified_by
      data.stix.revoked = existingObject.stix.revoked ?? false;
      data.stix.x_mitre_modified_by_ref = organizationIdentityRef;
    } else {
      // Brand-new object — set ID, created_by, modified_by, revoked
      if (!data.stix.id) {
        data.stix.id = `${data.stix.type}--${uuid.v4()}`;
      }
      if (!data.stix.created) {
        data.stix.created = new Date().toISOString();
      }
      data.stix.revoked = false;
      data.stix.created_by_ref = organizationIdentityRef;
      data.stix.x_mitre_modified_by_ref = organizationIdentityRef;
    }

    // Set modified timestamp if not set by client — set for both new and existing objects
    if (!data.stix.modified) {
      data.stix.modified = new Date().toISOString();
    }

    // Set default spec_version if not provided by client
    if (!data.stix.spec_version) {
      data.stix.spec_version = '2.1';
    }

    // 3b. Metadata fields
    if (options.userAccountId) {
      // TODO is this the best approach? We should explore using a DTO or similar pattern to avoid mutating the input data object directly
      if (!data.workspace.workflow) {
        data.workspace.workflow = {};
      }
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
    const { errors, warnings } = await this.validateComposedObject(data);

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
    // Strip workspace.validation — server-controlled; the fail-open block
    // below is the only legitimate writer of this field on the import path.
    if (data.workspace) {
      delete data.workspace.validation;
    }

    // Extract ATT&CK ID from external_references and propagate to workspace.attack_id
    const attackIdInExternalReferences = attackIdGenerator.extractAttackIdFromExternalReferences(
      data.stix,
    );
    if (attackIdInExternalReferences) {
      data.workspace = data.workspace || {};
      data.workspace.attack_id = attackIdInExternalReferences;
    }

    // Skip validation entirely for revoked or deprecated objects
    const isRevoked = data.stix?.revoked === true;
    const isDeprecated = data.stix?.x_mitre_deprecated === true;

    let errors = [];
    let warnings = [];

    if (!isRevoked && !isDeprecated) {
      ({ errors, warnings } = await this.validateComposedObject(data));
    }

    if (errors.length > 0) {
      if (options.validateContents) {
        throw new ValidationError('ADM validation failed', { details: errors, warnings });
      }

      // Fail-open: store validation errors on the document
      const { ATTACK_SPEC_VERSION } = require('@mitre-attack/attack-data-model');
      const admPkg = require('@mitre-attack/attack-data-model/package.json');

      data.workspace = data.workspace || {};
      data.workspace.validation = {
        errors: errors.map((e) => ({ message: e.message, path: e.path, code: e.code })),
        attack_spec_version: ATTACK_SPEC_VERSION,
        adm_version: admPkg.version,
        validated_at: new Date(),
      };

      logger.warn(
        `Import: ${data.stix.id} has ${errors.length} validation error(s), storing on document`,
      );
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

    // For matrices, capture the external_id before stripping removes the client-provided
    // ATT&CK reference. Used as a fallback when the stored document lacks one
    // (e.g., matrices created before ATT&CK ref generation was added).
    let matrixExternalId;
    if (data.stix?.type === 'x-mitre-matrix') {
      matrixExternalId =
        findAttackExternalReference(document.stix?.external_references)?.external_id ||
        findAttackExternalReference(data.stix?.external_references)?.external_id;
    }

    BaseService.stripServerControlledFields(data, options);
    BaseService.stripEmptyStrings(data.stix);
    BaseService.stripEmptyStrings(data.workspace);
    BaseService.normalizeDateFields(data);

    // Compose server-controlled fields from existing document
    data.stix.x_mitre_attack_spec_version = document.stix.x_mitre_attack_spec_version;
    data.stix.revoked = document.stix.revoked ?? false;

    // Preserve x_mitre_is_subtechnique — changing subtechnique status requires
    // the dedicated conversion endpoints, not the generic update path.
    if (document.stix.x_mitre_is_subtechnique !== undefined) {
      data.stix.x_mitre_is_subtechnique = document.stix.x_mitre_is_subtechnique;
    }

    if (document.workspace?.attack_id) {
      data.workspace = data.workspace || {};
      data.workspace.attack_id = document.workspace.attack_id;
    }

    // Compose external_references: prepend existing ATT&CK ref onto user's refs
    data.stix.external_references = data.stix.external_references || [];
    const existingAttackRef = findAttackExternalReference(document.stix.external_references);
    if (existingAttackRef) {
      data.stix.external_references.unshift(existingAttackRef);
    } else if (matrixExternalId) {
      // Fallback for matrices created before ATT&CK ref generation was added
      const matrixRef = buildAttackExternalReference(matrixExternalId, data.stix.type);
      if (matrixRef) {
        data.stix.external_references.unshift(matrixRef);
      }
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
    const { errors, warnings } = await this.validateComposedObject(data);

    if (errors.length > 0) {
      throw new ValidationError('ADM validation failed', { details: errors, warnings });
    }

    // Validation passed — clear any stored validation issues from a previous import
    if (document.workspace?.validation) {
      data.workspace = data.workspace || {};
      data.workspace.validation = undefined;
    }

    // ──────────────────────────────────────────────
    // 6. PERSIST (skip if dry-run)
    // ──────────────────────────────────────────────
    if (options.dryRun) return { ...data, warnings };

    const newDocument = await this.repository.updateAndSave(document, data);

    if (newDocument === document) {
      // If the document previously had validation issues, explicitly unset them
      if (document.workspace?.validation !== undefined) {
        await this.repository.unsetField(document._id, 'workspace.validation');
      }

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

  // ============================
  // Revoke Operation
  // ============================

  /**
   * Revokes an object (Object A) in favor of another object (Object B).
   *
   * Workflow:
   *   1. Validate inputs
   *   2. Retrieve objects A and B
   *   3. Lifecycle hook: beforeRevoke
   *   4. Mark Object A as revoked (creates a new version via this.create)
   *   5. Create a revoked-by relationship (A → B)
   *   6. Handle relationships (transfer to B if preserveRelationships)
   *   7. Lifecycle hook: afterRevoke
   *   8. Emit revoked event (RelationshipsService deprecates original relationships via event listener)
   *   9. Return result
   *
   * @param {string} stixId - The STIX ID of the object to revoke (Object A)
   * @param {Object} data - Request body containing { revoking: { stixId, modified } }
   * @param {Object} [options] - Options
   * @param {boolean} [options.preserveRelationships] - If true, clone relationships to Object B before deleting
   * @param {string} [options.userAccountId] - The authenticated user's account ID
   * @returns {Object} Result with revokedObject, revokedByRelationship, relationshipsSummary
   */
  async revoke(stixId, data, options = {}) {
    logger.info(
      `REVOKING ${stixId} in favor of ${data?.revoking?.stixId} (preserveRelationships: ${options.preserveRelationships})`,
    );

    // Lazy-load to avoid circular dependency
    const relationshipsService = require('../stix/relationships-service');
    const relationshipsRepository = require('../../repository/relationships-repository');

    // ──────────────────────────────────────────────
    // 1. VALIDATE INPUTS
    // ──────────────────────────────────────────────
    if (!stixId) {
      throw new MissingParameterError('stixId');
    }
    if (!data?.revoking?.stixId) {
      throw new MissingParameterError('revoking.stixId');
    }
    if (!data?.revoking?.modified) {
      throw new MissingParameterError('revoking.modified');
    }
    if (stixId === data.revoking.stixId) {
      throw new SelfRevocationError();
    }

    // ──────────────────────────────────────────────
    // 2. RETRIEVE OBJECTS
    // ──────────────────────────────────────────────
    const objectA = await this.repository.retrieveLatestByStixId(stixId);
    if (!objectA) {
      throw new NotFoundError({ details: `Object A with stixId ${stixId} not found` });
    }
    if (objectA.stix.revoked === true) {
      throw new AlreadyRevokedError({ details: `Object ${stixId} is already revoked` });
    }

    const objectB = await this.repository.retrieveOneByVersion(
      data.revoking.stixId,
      data.revoking.modified,
    );
    if (!objectB) {
      throw new NotFoundError({
        details: `Object B with stixId ${data.revoking.stixId} and modified ${data.revoking.modified} not found`,
      });
    }
    if (objectB.stix.type !== this.type) {
      throw new BadRequestError({
        details: `Revoking object must be of the same type (${this.type}), got ${objectB.stix.type}`,
      });
    }

    // ──────────────────────────────────────────────
    // 3. LIFECYCLE HOOK: beforeRevoke
    // ──────────────────────────────────────────────
    await this.beforeRevoke(objectA, objectB, options);

    // ──────────────────────────────────────────────
    // 4. MARK OBJECT A AS REVOKED
    // ──────────────────────────────────────────────
    // Clone Object A and set revoked = true, then persist directly via the repository.
    // We bypass this.create() because the object is already fully composed and validated —
    // routing it through create() would strip the revoked flag (which is server-controlled).
    const objectAData = objectA.toObject ? objectA.toObject() : { ...objectA };
    delete objectAData._id;
    delete objectAData.__v;
    delete objectAData.__t;
    objectAData.stix.revoked = true;
    objectAData.stix.modified = new Date().toISOString();
    if (options.userAccountId) {
      objectAData.workspace = objectAData.workspace || {};
      objectAData.workspace.workflow = objectAData.workspace.workflow || {};
      objectAData.workspace.workflow.created_by_user_account = options.userAccountId;
    }

    const revokedDocument = await this.repository.save(objectAData);

    const result = new WorkflowResult('revoke');
    result.setPrimary(revokedDocument);

    // ──────────────────────────────────────────────
    // 5. CREATE REVOKED-BY RELATIONSHIP
    // ──────────────────────────────────────────────
    // NOTE: This is a direct cross-service write (BaseService → RelationshipsService.create).
    // The revoke workflow predates the event-driven architecture and is shared by all SDO types.
    // TODO: Migrate to an event-driven pattern for consistency with the conversion workflows.
    const now = new Date().toISOString();
    const revokedByRelationship = await relationshipsService.create(
      {
        workspace: {
          workflow: {},
        },
        stix: {
          type: 'relationship',
          spec_version: '2.1',
          relationship_type: 'revoked-by',
          source_ref: objectA.stix.id,
          target_ref: objectB.stix.id,
          created: now,
          modified: now,
        },
      },
      { userAccountId: options.userAccountId },
    );
    result.addCreated(revokedByRelationship);

    // TODO what if relationshipsService.create fails after we've already marked Object A as revoked?
    // We should have error handling to attempt to roll back the revoked status if the relationship
    // creation fails, to avoid leaving the system in a broken state where Object A is revoked but
    // there's no link to Object B. This could be done with a try/catch around the relationship creation,
    // and in the catch block we would attempt to set revoked back to false on Object A and save it again.
    // We would also need to handle potential errors in that rollback attempt and log them appropriately.

    // ──────────────────────────────────────────────
    // 6. HANDLE RELATIONSHIPS (transfer if preserveRelationships is set)
    // ──────────────────────────────────────────────
    if (options.preserveRelationships) {
      const existingRelationships = await relationshipsRepository.retrieveAllBySourceOrTarget(
        objectA.stix.id,
      );

      // Exclude the revoked-by relationship we just created
      const relationshipsToProcess = existingRelationships.filter(
        (rel) => rel.stix.id !== revokedByRelationship.stix.id,
      );
      // Build a set of relationship triples (source_ref--relationship_type--target_ref)
      // that Object B already participates in, so we can skip duplicates.
      const objectBRelationships = await relationshipsRepository.retrieveAllBySourceOrTarget(
        objectB.stix.id,
      );
      const objectBRelTriples = new Set(
        objectBRelationships.map(
          (r) => `${r.stix.source_ref}--${r.stix.relationship_type}--${r.stix.target_ref}`,
        ),
      );

      for (const rel of relationshipsToProcess) {
        try {
          // Skip subtechnique-of relationships — hierarchy relationships must be managed
          // separately via the conversion endpoints, not transferred during revocation.
          if (rel.stix.relationship_type === 'subtechnique-of') {
            logger.info(
              `Skipping subtechnique-of relationship ${rel.stix.id} during preservation (hierarchy relationships are not transferred)`,
            );
            result.addWarning({
              message: 'Hierarchy relationship not transferred',
              reason: 'subtechnique-of',
              relationship: {
                id: rel.stix.id,
                source_ref: rel.stix.source_ref,
                target_ref: rel.stix.target_ref,
                relationship_type: rel.stix.relationship_type,
              },
            });
            continue;
          }

          // TODO here is another use case for a more robust composition layer or a DTO pattern — we are manually cloning and modifying relationship objects, which is error-prone and may not scale well if relationships have more complex fields in the future. A composition layer could handle cloning an existing relationship and substituting references while ensuring all required fields are correctly set.
          const relData = { ...rel };
          delete relData._id;
          delete relData.__v;
          delete relData.__t;

          // Reset timestamps
          relData.stix.created = now;
          relData.stix.modified = now;

          // Substitute Object B for Object A
          if (relData.stix.source_ref === objectA.stix.id) {
            relData.stix.source_ref = objectB.stix.id;
          }
          if (relData.stix.target_ref === objectA.stix.id) {
            relData.stix.target_ref = objectB.stix.id;
          }

          // Skip if Object B already has an equivalent relationship
          const candidateTriple = `${relData.stix.source_ref}--${relData.stix.relationship_type}--${relData.stix.target_ref}`;
          if (objectBRelTriples.has(candidateTriple)) {
            logger.info(
              `Skipping duplicate relationship transfer: ${candidateTriple} already exists on Object B`,
            );
            result.addWarning({
              message: 'Duplicate relationship transfer skipped',
              skipped: {
                id: rel.stix.id,
                source_ref: rel.stix.source_ref,
                target_ref: rel.stix.target_ref,
                relationship_type: rel.stix.relationship_type,
                description: rel.stix.description,
              },
              existing: {
                id: relData.stix.id,
                source_ref: relData.stix.source_ref,
                target_ref: relData.stix.target_ref,
                relationship_type: relData.stix.relationship_type,
                description: relData.stix.description,
              },
            });
            continue;
          }

          // Generate a new STIX ID for the cloned relationship
          relData.stix.id = `relationship--${uuid.v4()}`;

          const transferredRel = await relationshipsService.create(relData, {
            userAccountId: options.userAccountId,
          });
          result.addCreated(transferredRel);

          // Track the newly created triple so subsequent iterations don't create duplicates
          objectBRelTriples.add(candidateTriple);
        } catch (err) {
          logger.warn(`Failed to transfer relationship ${rel.stix.id}: ${err.message}`);
          result.addWarning({
            message: 'Relationship transfer failed',
            relationship: {
              id: rel.stix.id,
              description: rel.stix.description,
              source_ref: rel.stix.source_ref,
              target_ref: rel.stix.target_ref,
              relationship_type: rel.stix.relationship_type,
            },
            error: err.message,
          });
        }
      }
    }

    // ──────────────────────────────────────────────
    // 7. LIFECYCLE HOOK: afterRevoke
    // ──────────────────────────────────────────────
    await this.afterRevoke(revokedDocument, objectB, options);

    // ──────────────────────────────────────────────
    // 8. EMIT EVENT
    // ──────────────────────────────────────────────
    // RelationshipsService listens for revoked events and deprecates all relationships
    // referencing the revoked object (except those in excludeRelationshipIds).
    // EventBus.emit() awaits all listeners, so deprecation completes before we return.
    // Handler results (deprecated docs, warnings) are merged into the WorkflowResult.
    const excludeRelationshipIds = [revokedByRelationship.stix.id];
    const eventResults = await this.emitRevokedEvent(revokedDocument, objectB, options, {
      excludeRelationshipIds,
    });
    result.mergeEventResults(eventResults);

    // ──────────────────────────────────────────────
    // 9. RETURN RESULT
    // ──────────────────────────────────────────────
    return result.toJSON();
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
