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

    logger.info('RelationshipsService: Event listeners initialized');
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

    const relationships = await relationshipsRepository.retrieveAllBySourceOrTarget(stixId);

    const toDeprecate = relationships.filter(
      (rel) => !excludeRelationshipIds.includes(rel.stix.id),
    );

    let deprecatedCount = 0;
    for (const rel of toDeprecate) {
      try {
        const relData = rel.toObject ? rel.toObject() : { ...rel };
        delete relData._id;
        delete relData.__v;
        delete relData.__t;

        relData.stix.x_mitre_deprecated = true;
        relData.stix.modified = new Date().toISOString();

        await relationshipsRepository.save(relData);
        deprecatedCount++;

        logger.info(
          `Deprecated relationship ${rel.stix.id} (was referencing revoked object ${stixId})`,
        );
      } catch (error) {
        logger.error(`Failed to deprecate relationship ${rel.stix.id}: ${error.message}`);
      }
    }

    logger.info(
      `RelationshipsService: deprecated ${deprecatedCount}/${toDeprecate.length} relationships for revoked object ${stixId}`,
    );
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
