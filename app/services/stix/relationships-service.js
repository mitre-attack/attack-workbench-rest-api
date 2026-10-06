'use strict';

const { BaseService } = require('../meta-classes');
const relationshipsRepository = require('../../repository/relationships-repository');
const attackObjectsRepository = require('../../repository/attack-objects-repository');
const { Relationship: RelationshipType } = require('../../lib/types');
const EventBus = require('../../lib/event-bus');
const EventConstants = require('../../lib/event-constants');
const logger = require('../../lib/logger');
const { BadRequestError, InvalidObjectRevisionError } = require('../../exceptions');

// Map STIX types to ATT&CK types
const objectTypeMap = new Map([
  ['malware', 'software'],
  ['tool', 'software'],
  ['attack-pattern', 'technique'],
  ['intrusion-set', 'group'],
  ['campaign', 'campaign'],
  ['x-mitre-asset', 'asset'],
  ['course-of-action', 'mitigation'],
  ['x-mitre-tactic', 'tactic'],
  ['x-mitre-matrix', 'matrix'],
  ['x-mitre-data-component', 'data-component'],
  ['x-mitre-detection-strategy', 'detection-strategy'],
]);

class RelationshipsService extends BaseService {
  /**
   * Record the exact object revisions the endpoints resolve to when this
   * relationship revision is created.
   *
   * The pins are authoring context: they let release previews warn when a
   * relationship is shipped against a different endpoint revision than the
   * one its author saw. They do not drive selection (sealed content manifests
   * pair each relationship with the member revisions it ships with) and a
   * later endpoint revision never clones the relationship.
   *
   * The pins are Workbench metadata rather than custom STIX properties. They
   * are therefore validated by Mongoose, remain server-controlled, and are
   * naturally omitted from emitted STIX bundles.
   *
   * @param {Object} data Workbench-shaped relationship document
   * @returns {Promise<void>}
   */
  static async pinEndpointRevisions(data) {
    const [source, target] = await Promise.all([
      attackObjectsRepository.retrieveLatestByStixIdLean(data.stix.source_ref),
      attackObjectsRepository.retrieveLatestByStixIdLean(data.stix.target_ref),
    ]);

    const missing = [];
    if (!source) {
      missing.push({
        endpoint: 'source',
        object_ref: data.stix.source_ref,
        object_modified: 'latest',
      });
    }
    if (!target) {
      missing.push({
        endpoint: 'target',
        object_ref: data.stix.target_ref,
        object_modified: 'latest',
      });
    }
    if (missing.length > 0) {
      throw new InvalidObjectRevisionError(missing, {
        details:
          'Relationship endpoints must resolve to exact object revisions before the ' +
          'relationship can be persisted.',
      });
    }

    data.workspace = data.workspace || {};
    data.workspace.relationship_endpoints = {
      source: {
        object_ref: source.stix.id,
        object_modified: source.stix.modified,
      },
      target: {
        object_ref: target.stix.id,
        object_modified: target.stix.modified,
      },
    };
  }

  async beforeCreate(data) {
    await RelationshipsService.pinEndpointRevisions(data);
  }

  async beforeUpdate(_stixId, _stixModified, data, existingDocument) {
    for (const field of ['source_ref', 'target_ref', 'relationship_type']) {
      if (data.stix[field] !== existingDocument.stix[field]) {
        throw new BadRequestError({
          details:
            `Relationship ${field} cannot be changed in place because that would alter the ` +
            'meaning of an existing graph revision. Create a new relationship revision instead.',
          immutable_property: field,
        });
      }
    }

    data.workspace = data.workspace || {};
    data.workspace.relationship_endpoints = existingDocument.workspace.relationship_endpoints;
  }

  /**
   * Initialize event listeners.
   * Called once on module load.
   */
  static initializeEventListeners() {
    EventBus.on(
      EventConstants.TECHNIQUE_CONVERTED_TO_SUBTECHNIQUE,
      this.handleTechniqueConvertedToSubtechnique.bind(this),
    );

    EventBus.on(
      EventConstants.SUBTECHNIQUE_CONVERTED_TO_TECHNIQUE,
      this.handleSubtechniqueConvertedToTechnique.bind(this),
    );

    EventBus.on(
      EventConstants.RELEASE_TRACK_CONTENTS_CHANGED,
      this.handleReleaseTrackContentsChanged.bind(this),
    );

    EventBus.on(
      EventConstants.BUNDLE_RELATIONSHIPS_REQUESTED,
      this.handleBundleRelationshipsRequested.bind(this),
    );

    logger.info('RelationshipsService: Event listeners initialized');
  }

  /**
   * Return the latest active relationship revisions whose endpoints are both
   * in the requested bundle object set.
   *
   * @param {Object} payload
   * @param {Array<string>} payload.objectRefs
   * @returns {Promise<Array<Object>>}
   */
  static async handleBundleRelationshipsRequested({ objectRefs }) {
    if (!objectRefs || objectRefs.length === 0) return [];
    return relationshipsRepository.retrieveAllForBundle({
      includeRevoked: false,
      includeDeprecated: false,
      objectRefs,
    });
  }

  /**
   * Reconcile workspace.release_tracks backrefs on relationship documents
   * when a release track's contents change. Relationships live in their own
   * collection, so this service handles the relationship refs while
   * AttackObjectsService handles everything else.
   *
   * @param {Object} payload - { trackId, snapshot } (snapshot null = track deleted)
   */
  static async handleReleaseTrackContentsChanged(payload) {
    const backrefReconciler = require('../../lib/release-tracks/backref-reconciler');
    return backrefReconciler.reconcile(
      relationshipsRepository,
      payload.trackId,
      payload.snapshot,
      (objectRef) => objectRef.startsWith('relationship--'),
    );
  }

  /**
   * Create a subtechnique-of SRO when a technique is converted to a subtechnique.
   *
   * Uses the service instance's create() method (via module.exports singleton)
   * so that the relationship gets a proper stix.id, server-controlled fields,
   * and ADM validation — the same path as any user-created relationship.
   *
   * @param {Object} payload - Event payload
   * @param {string} payload.stixId - STIX ID of the converted subtechnique
   * @param {string} payload.parentStixId - STIX ID of the parent technique
   * @param {string} [payload.userAccountId] - Authenticated user's account ID
   */
  static async handleTechniqueConvertedToSubtechnique(payload) {
    const { stixId, parentStixId, userAccountId } = payload;

    logger.info(
      `RelationshipsService: Creating subtechnique-of relationship for ${stixId} -> ${parentStixId}`,
    );

    try {
      // Use the singleton instance exported by this module
      const relationshipsService = module.exports;
      const now = new Date().toISOString();
      const createdRelationship = await relationshipsService.create(
        {
          workspace: {
            workflow: { state: 'reviewed' }, // TODO introduce a new workflow state for entities that are never reviewed by users; for now, set to 'reviewed' to ensure they undergo full ADM validation
          },
          stix: {
            type: 'relationship',
            spec_version: '2.1',
            relationship_type: 'subtechnique-of',
            source_ref: stixId,
            target_ref: parentStixId,
            created: now,
            modified: now,
          },
        },
        { userAccountId },
      );

      logger.info(
        `RelationshipsService: Created subtechnique-of relationship for ${stixId} -> ${parentStixId}`,
      );

      return { created: [createdRelationship] };
    } catch (error) {
      logger.error(
        `RelationshipsService: Error creating subtechnique-of relationship for ${stixId}: ${error.message}`,
      );
      return {
        warnings: [
          {
            message: 'Failed to create subtechnique-of relationship',
            stixId,
            error: error.message,
          },
        ],
      };
    }
  }

  /**
   * Deprecate subtechnique-of SROs when a subtechnique is converted to a technique.
   *
   * Creates a new version of each active subtechnique-of relationship where
   * source_ref = the converted object, setting x_mitre_deprecated = true.
   *
   * @param {Object} payload - Event payload
   * @param {string} payload.stixId - STIX ID of the converted subtechnique
   */
  static async handleSubtechniqueConvertedToTechnique(payload) {
    const { stixId } = payload;

    logger.info(`RelationshipsService: Deprecating subtechnique-of relationships for ${stixId}`);

    const deprecatedDocs = [];
    const warnings = [];

    try {
      const subtechniqueOfRels = await relationshipsRepository.retrieveAll({
        sourceRef: stixId,
        relationshipType: 'subtechnique-of',
        versions: 'latest',
        includeRevoked: false,
        includeDeprecated: false,
      });

      for (const rel of subtechniqueOfRels) {
        try {
          const deprecatedVersion = rel.toObject ? rel.toObject() : { ...rel };
          delete deprecatedVersion._id;
          delete deprecatedVersion.__v;
          delete deprecatedVersion.__t;

          deprecatedVersion.stix.x_mitre_deprecated = true;
          deprecatedVersion.stix.modified = new Date().toISOString();
          // Backrefs are pinned to the exact revision a track references —
          // never carried onto a new revision.
          if (deprecatedVersion.workspace) {
            delete deprecatedVersion.workspace.release_tracks;
          }

          const saved = await relationshipsRepository.save(deprecatedVersion);
          deprecatedDocs.push(saved);
        } catch (error) {
          logger.error(
            `RelationshipsService: Error deprecating relationship ${rel.stix?.id}: ${error.message}`,
          );
          warnings.push({
            message: 'Failed to deprecate relationship',
            relationshipId: rel.stix?.id,
            error: error.message,
          });
        }
      }

      logger.info(
        `RelationshipsService: Deprecated ${deprecatedDocs.length}/${subtechniqueOfRels.length} subtechnique-of relationship(s) for ${stixId}`,
      );
    } catch (error) {
      logger.error(
        `RelationshipsService: Error handling subtechnique-to-technique conversion for ${stixId}:`,
        error,
      );
      warnings.push({
        message: 'Failed to deprecate subtechnique-of relationships',
        stixId,
        error: error.message,
      });
    }

    return { deprecated: deprecatedDocs, warnings };
  }

  async retrieveAll(options) {
    let results = await this.repository.retrieveAll(options);

    // Filter out relationships that don't reference the source type
    if (options.sourceType) {
      results = results.filter((document) => {
        if (document.source_objects.length === 0) {
          return false;
        } else {
          document.source_objects.sort((a, b) => b.stix.modified - a.stix.modified);
          return objectTypeMap.get(document.source_objects[0].stix.type) === options.sourceType;
        }
      });
    }

    // Filter out relationships that don't reference the target type
    if (options.targetType) {
      results = results.filter((document) => {
        if (document.target_objects.length === 0) {
          return false;
        } else {
          document.target_objects.sort((a, b) => b.stix.modified - a.stix.modified);
          return objectTypeMap.get(document.target_objects[0].stix.type) === options.targetType;
        }
      });
    }

    const prePaginationTotal = results.length;

    // Apply pagination parameters
    if (options.offset || options.limit) {
      const start = options.offset || 0;
      if (options.limit) {
        const end = start + options.limit;
        results = results.slice(start, end);
      } else {
        results = results.slice(start);
      }
    }

    // Move latest source and target objects to a non-array property, then remove array of source and target objects
    for (const document of results) {
      if (Array.isArray(document.source_objects)) {
        if (document.source_objects.length === 0) {
          document.source_objects = undefined;
        } else {
          document.source_object = document.source_objects[0];
          document.source_objects = undefined;
        }
      }

      if (Array.isArray(document.target_objects)) {
        if (document.target_objects.length === 0) {
          document.target_objects = undefined;
        } else {
          document.target_object = document.target_objects[0];
          document.target_objects = undefined;
        }
      }
    }

    if (options.includeIdentities) {
      await this.addCreatedByAndModifiedByIdentitiesToAll(results);
    }

    if (options.includePagination) {
      return {
        pagination: {
          total: prePaginationTotal,
          offset: options.offset,
          limit: options.limit,
        },
        data: results,
      };
    } else {
      return results;
    }
  }
}

RelationshipsService.initializeEventListeners();

// Default export
module.exports.RelationshipsService = RelationshipsService;

// Default export - export an instance of the service
module.exports = new RelationshipsService(RelationshipType, relationshipsRepository);
