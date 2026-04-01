'use strict';

const { BaseService } = require('../meta-classes');
const relationshipsRepository = require('../../repository/relationships-repository');
const { Relationship: RelationshipType } = require('../../lib/types');
const EventBus = require('../../lib/event-bus');
const EventConstants = require('../../lib/event-constants');
const logger = require('../../lib/logger');

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
   * Initialize event listeners.
   * Called once on module load.
   */
  static initializeEventListeners() {
    const revokedEvents = [
      EventConstants.ATTACK_PATTERN_REVOKED,
      EventConstants.TACTIC_REVOKED,
      EventConstants.COURSE_OF_ACTION_REVOKED,
      EventConstants.INTRUSION_SET_REVOKED,
      EventConstants.MALWARE_REVOKED,
      EventConstants.TOOL_REVOKED,
      EventConstants.CAMPAIGN_REVOKED,
      EventConstants.DATA_SOURCE_REVOKED,
      EventConstants.DATA_COMPONENT_REVOKED,
      EventConstants.MATRIX_REVOKED,
      EventConstants.ASSET_REVOKED,
    ];

    for (const event of revokedEvents) {
      EventBus.on(event, this.handleObjectRevoked.bind(this));
    }

    EventBus.on(
      EventConstants.TECHNIQUE_CONVERTED_TO_SUBTECHNIQUE,
      this.handleTechniqueConvertedToSubtechnique.bind(this),
    );

    EventBus.on(
      EventConstants.SUBTECHNIQUE_CONVERTED_TO_TECHNIQUE,
      this.handleSubtechniqueConvertedToTechnique.bind(this),
    );

    logger.info('RelationshipsService: Event listeners initialized');
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
      return { warnings: [`Failed to create subtechnique-of relationship for ${stixId}`] };
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

          const saved = await relationshipsRepository.save(deprecatedVersion);
          deprecatedDocs.push(saved);
        } catch (error) {
          logger.error(
            `RelationshipsService: Error deprecating relationship ${rel.stix?.id}: ${error.message}`,
          );
          warnings.push(`Failed to deprecate relationship ${rel.stix?.id}`);
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
      warnings.push(`Failed to deprecate subtechnique-of relationships for ${stixId}`);
    }

    return { deprecated: deprecatedDocs, warnings };
  }

  /**
   * Handle an object being revoked by deprecating all relationships that reference it.
   * Creates a new version of each relationship with x_mitre_deprecated = true and bumped modified,
   * preserving the original version in history.
   * @param {object} payload - Event payload
   * @param {string} payload.stixId - STIX ID of the revoked object
   * @param {string[]} [payload.excludeRelationshipIds] - Relationship STIX IDs to skip (e.g. the revoked-by relationship)
   */
  static async handleObjectRevoked(payload) {
    const { stixId, excludeRelationshipIds = [] } = payload;

    logger.info(`RelationshipsService heard event: object revoked for ${stixId}`);

    const deprecatedDocs = [];
    const warnings = [];

    try {
      const relationships = await relationshipsRepository.retrieveAllBySourceOrTarget(stixId);

      const toDeprecate = relationships.filter(
        (rel) => !excludeRelationshipIds.includes(rel.stix.id),
      );

      for (const rel of toDeprecate) {
        try {
          const relData = rel.toObject ? rel.toObject() : { ...rel };
          delete relData._id;
          delete relData.__v;
          delete relData.__t;

          relData.stix.x_mitre_deprecated = true;
          relData.stix.modified = new Date().toISOString();

          const saved = await relationshipsRepository.save(relData);
          deprecatedDocs.push(saved);

          logger.info(
            `Deprecated relationship ${rel.stix.id} (was referencing revoked object ${stixId})`,
          );
        } catch (error) {
          logger.error(`Failed to deprecate relationship ${rel.stix.id}: ${error.message}`);
          warnings.push(`Failed to deprecate relationship ${rel.stix.id}`);
        }
      }

      logger.info(
        `RelationshipsService: deprecated ${deprecatedDocs.length}/${toDeprecate.length} relationships for revoked object ${stixId}`,
      );
    } catch (error) {
      logger.error(`RelationshipsService: Error handling object revoked for ${stixId}:`, error);
      warnings.push(`Failed to deprecate relationships for revoked object ${stixId}`);
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
