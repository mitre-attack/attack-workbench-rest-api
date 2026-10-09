'use strict';

const { assertNoAdmErrors } = require('../../lib/adm-validation');

const attackObjectsRepository = require('../../repository/attack-objects-repository');
const { BaseService } = require('../meta-classes');
const identitiesService = require('./identities-service');
const relationshipsService = require('./relationships-service');
const logger = require('../../lib/logger');
const { NotImplementedError, DatabaseError } = require('../../exceptions');

class AttackObjectsService extends BaseService {
  async deprecationCheck(stixId) {
    return require('./lifecycle-service').deprecationCheck(stixId);
  }

  /**
   * Override of base class retrieveAll() because:
   * 1. Adds special handling for relationships
   * 2. Uses custom pagination logic
   */
  async retrieveAll(options) {
    // Get attack objects from repository
    const results = await this.repository.retrieveAll(options);
    let documents = results[0].documents;

    // Add relationships from separate collection if not filtering by attackId or search
    if (!options.attackId && !options.search) {
      const relationshipsOptions = {
        includeRevoked: options.includeRevoked,
        includeDeprecated: options.includeDeprecated,
        state: options.state,
        versions: options.versions,
        lookupRefs: false,
        includeIdentities: false,
        lastUpdatedBy: options.lastUpdatedBy,
      };
      const relationships = await relationshipsService.retrieveAll(relationshipsOptions);
      documents = documents.concat(relationships);
    }

    // Add identities
    await identitiesService.addCreatedByAndModifiedByIdentitiesToAll(documents);

    // Handle pagination
    if (options.includePagination) {
      return {
        pagination: {
          total: results[0].totalCount[0]?.totalCount || 0,
          offset: options.offset,
          limit: options.limit,
        },
        data: documents,
      };
    }
    return documents;
  }

  /**
   * Override of base class retrieveVersionById() because:
   * 1. Adds special handling for relationships
   */
  async retrieveVersionById(stixId, modified) {
    // Handle relationships separately
    if (stixId.startsWith('relationship')) {
      const relationship = await relationshipsService.retrieveVersionById(stixId, modified);
      await identitiesService.addCreatedByAndModifiedByIdentities(relationship);
      return relationship;
    }

    // Otherwise use base class implementation
    return super.retrieveVersionById(stixId, modified);
  }

  /**
   * Stream multiple attack objects by their version identifiers, handling relationships separately
   * @param {Array<{object_ref: string, object_modified: string}>} xMitreContents - Array of x_mitre_contents elements
   * @yields {Object} Attack objects and relationships with identities populated
   */
  async *streamBulkByIdAndModified(xMitreContents) {
    const relationshipIdAndModified = xMitreContents.filter((content) =>
      content.object_ref.startsWith('relationship'),
    );
    const nonRelationshipIdAndModified = xMitreContents.filter(
      (content) => !content.object_ref.startsWith('relationship'),
    );

    // Stream relationships first
    if (relationshipIdAndModified.length > 0) {
      yield* relationshipsService.streamBulkByIdAndModified(relationshipIdAndModified);
    }

    // Then stream non-relationships
    if (nonRelationshipIdAndModified.length > 0) {
      yield* super.streamBulkByIdAndModified(nonRelationshipIdAndModified);
    }
  }

  /**
   * Retrieve multiple attack objects by their version identifiers, handling relationships separately
   * @param {Array<{object_ref: string, modified: string}>} xMitreContents - Array of x_mitre_contents elements
   * @returns {Promise<Array<Object>>} Array of attack objects and relationships with identities populated
   */
  async getBulkByIdAndModified(xMitreContents) {
    const relationshipIdAndModified = xMitreContents.filter((content) =>
      content.object_ref.startsWith('relationship'),
    );
    const nonRelationshipIdAndModified = xMitreContents.filter(
      (content) => !content.object_ref.startsWith('relationship'),
    );

    const [relationships, nonRelationships] = await Promise.all([
      relationshipIdAndModified.length > 0
        ? relationshipsService.getBulkByIdAndModified(relationshipIdAndModified)
        : [],
      nonRelationshipIdAndModified.length > 0
        ? super.getBulkByIdAndModified(nonRelationshipIdAndModified)
        : [],
    ]);

    return [...relationships, ...nonRelationships];
  }

  /**
   * Record that this object is part of a collection
   */
  async insertCollection(stixId, modified, collectionId, collectionModified) {
    // Validate inputs
    if (!stixId || !modified || !collectionId || !collectionModified) {
      throw new Error('Missing required parameter');
    }

    // Get the document
    const document = await this.retrieveVersionById(stixId, modified);
    if (!document) {
      throw new Error('Document not found');
    }

    // Create the collection reference
    const collection = {
      collection_ref: collectionId,
      collection_modified: collectionModified,
    };

    // Initialize collections array if needed
    if (!document.workspace.collections) {
      document.workspace.collections = [];
    }

    // Check for duplicate collection
    const isDuplicate = document.workspace.collections.some(
      (item) =>
        item.collection_ref === collection.collection_ref &&
        item.collection_modified === collection.collection_modified,
    );
    if (isDuplicate) {
      throw new Error('Duplicate collection');
    }

    // Add collection and save
    document.workspace.collections.push(collection);
    return this.repository.saveDocument(document);
  }

  /**
   * Override of base class create() because:
   * 1. create() requires a STIX `type` -- this service does not define a type
   */
  // eslint-disable-next-line no-unused-vars
  create(data, options) {
    throw new NotImplementedError(this.constructor.name, 'create');
  }

  async findByIdAndUpdate(documentId, update) {
    try {
      return await this.repository.findByIdAndUpdate(documentId, update);
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async findByIdAndDelete(documentId) {
    try {
      const deletedDocument = await this.repository.findByIdAndDelete(documentId);
      if (deletedDocument) {
        logger.verbose('Document deleted:', documentId);
      } else {
        logger.warn('Document not found');
      }
    } catch (err) {
      logger.error(err.message);
      throw DatabaseError(err);
    }
  }

  /**
   * Initialize event listeners for organization identity propagation.
   */
  static initializeEventListeners() {
    const EventBus = require('../../lib/event-bus');
    const Events = require('../../lib/event-constants');

    EventBus.on(
      Events.SYSTEM_CONFIGURATION_IDENTITY_CHANGE_PREFLIGHT_REQUESTED,
      AttackObjectsService.handleOrganizationIdentityChangePreflightRequested,
    );

    EventBus.on(
      Events.SYSTEM_CONFIGURATION_IDENTITY_CHANGED,
      AttackObjectsService.handleOrganizationIdentityChanged,
    );

    EventBus.on(
      Events.RELEASE_TRACK_CONTENTS_CHANGED,
      AttackObjectsService.handleReleaseTrackContentsChanged,
    );

    EventBus.on(
      Events.ATTACK_OBJECT_REVISIONS_REQUESTED,
      AttackObjectsService.handleRevisionsRequested,
    );

    EventBus.on(
      Events.RELEASE_TRACK_OBJECTS_REVIEWED,
      AttackObjectsService.handleReleaseTrackObjectsReviewed,
    );

    logger.info('AttackObjectsService: Event listeners initialized');
  }

  /**
   * Hydrate exact ATT&CK object revisions for cross-service consumers.
   *
   * @param {Object} payload
   * @param {Array<{object_ref: string, object_modified: string|Date}>} payload.entries
   * @returns {Promise<Array<Object>>}
   */
  static async handleRevisionsRequested({ entries }) {
    if (!entries || entries.length === 0) return [];
    return attackObjectsRepository.findManyByIdAndModified(entries);
  }

  static async handleReleaseTrackObjectsReviewed({ entries }) {
    return module.exports.markRevisionsReviewed(
      entries.filter((entry) => !entry.object_ref.startsWith('relationship--')),
    );
  }

  /**
   * Reconcile workspace.release_tracks backrefs on attackObjects documents
   * when a release track's contents change. Covers every STIX type stored in
   * the attackObjects collection; relationship refs are handled by
   * RelationshipsService (separate collection).
   *
   * @param {Object} payload - { trackId, snapshot } (snapshot null = track deleted)
   */
  static async handleReleaseTrackContentsChanged(payload) {
    const backrefReconciler = require('../../lib/release-tracks/backref-reconciler');
    return backrefReconciler.reconcile(
      attackObjectsRepository,
      payload.trackId,
      payload.snapshot,
      (objectRef) => !objectRef.startsWith('relationship--'),
    );
  }

  /**
   * Handle organization identity changes by creating new versions of affected objects.
   * Objects are updated based on field-specific provenance:
   * - created_by_ref is updated only if it matches an identity in the provenance chain
   * - x_mitre_modified_by_ref is updated only if it matches an identity in the provenance chain
   * @param {Object} payload
   * @param {string} payload.previousIdentityRef
   * @param {string} payload.newIdentityRef
   * @param {string[]} payload.organizationIdentityHistory
   */
  static async handleOrganizationIdentityChangePreflightRequested(payload) {
    return AttackObjectsService.handleOrganizationIdentityChanged(payload, { preflight: true });
  }

  static async handleOrganizationIdentityChanged(payload, { preflight = false } = {}) {
    const graphWriteLock = require('../../lib/graph-write-lock');
    if (!graphWriteLock.isHeld()) {
      return graphWriteLock.run(() =>
        AttackObjectsService.handleOrganizationIdentityChanged(payload, { preflight }),
      );
    }
    const {
      previousIdentityRef,
      newIdentityRef,
      organizationIdentityHistory,
      propagationModified,
    } = payload;

    // Skip propagation on first-time setup (no previous identity to propagate from)
    // or if required payload fields are missing.
    if (!previousIdentityRef || !organizationIdentityHistory || !newIdentityRef) {
      return;
    }

    const objects = await attackObjectsRepository.retrieveAllLatestByOrgIdentityRefs(
      organizationIdentityHistory,
    );

    logger.info(
      `AttackObjectsService: Creating new versions for ${objects.length} object(s) due to organization identity change`,
      { newIdentityRef },
    );

    for (const obj of objects) {
      try {
        const createdByInHistory = organizationIdentityHistory.includes(obj.stix.created_by_ref);
        const modifiedByInHistory = organizationIdentityHistory.includes(
          obj.stix.x_mitre_modified_by_ref,
        );

        const newVersion = {
          // Preserve the concrete model when saving through the heterogeneous
          // repository, so modified and type-specific STIX fields survive casting.
          __t: obj.__t,
          workspace: { ...obj.workspace },
          stix: {
            ...obj.stix,
            modified: propagationModified || new Date().toISOString(),
          },
        };
        // Release-track backrefs are pinned to specific revisions — the new
        // revision is not referenced by any track.
        delete newVersion.workspace.release_tracks;

        if (createdByInHistory) {
          newVersion.stix.created_by_ref = newIdentityRef;
        }
        if (modifiedByInHistory) {
          newVersion.stix.x_mitre_modified_by_ref = newIdentityRef;
        }

        delete newVersion.workspace?.validation;
        delete newVersion.workspace?.evaluation_context;
        const evaluation = await module.exports.validateComposedObject(newVersion, {
          phase: preflight ? 'preflight' : 'evaluation',
        });
        assertNoAdmErrors(evaluation);
        if (preflight) continue;
        await attackObjectsRepository.save(newVersion);

        logger.info(
          `AttackObjectsService: Created new version of ${obj.stix.id} with updated identity refs`,
          {
            createdByUpdated: createdByInHistory,
            modifiedByUpdated: modifiedByInHistory,
          },
        );
      } catch (error) {
        if (error instanceof require('../../exceptions').ValidationError) throw error;
        logger.error(`AttackObjectsService: Error creating new version of ${obj.stix?.id}:`, error);
      }
    }
  }

  async retrieveOneByVersionLean(stixId, stixModified) {
    try {
      return await this.repository.retrieveOneByVersionLean(stixId, stixModified);
    } catch (err) {
      throw new DatabaseError(err);
    }
  }
}

module.exports.AttackObjectsService = AttackObjectsService;

// Initialize event listeners for identity propagation
for (const name of ['handleOrganizationIdentityChanged']) {
  AttackObjectsService[name] = require('../system/validation-operation-service').wrap(
    AttackObjectsService[name],
  );
}

AttackObjectsService.initializeEventListeners();

// Export an instance of the service
module.exports = new AttackObjectsService(null, attackObjectsRepository);
