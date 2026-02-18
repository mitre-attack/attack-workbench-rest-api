'use strict';

const attackObjectsRepository = require('../repository/attack-objects-repository');
const relationshipsRepository = require('../repository/relationships-repository');
const identitiesService = require('./stix/identities-service');

/**
 * Service for generating reports on ATT&CK objects and relationships.
 * These are read-only analytical queries that identify potential data quality issues.
 */
class ReportsService {
  /**
   * Retrieves all objects (ATT&CK objects and/or relationships) that contain
   * "attack.mitre.org" in their description, indicating a likely missing LinkById reference.
   * @param {Object} options - Query options
   * @param {string} [options.type] - Filter by STIX type (e.g., 'relationship', 'attack-pattern')
   * @returns {Promise<Array>} Array of objects with attack.mitre.org in description
   */
  async getMissingLinkById(options = {}) {
    const results = [];

    // If type is 'relationship' or not specified, include relationships
    if (!options.type || options.type === 'relationship') {
      const relationships = await relationshipsRepository.retrieveAllWithAttackURLInDescription();
      await identitiesService.addCreatedByAndModifiedByIdentitiesToAll(relationships);
      results.push(...relationships);
    }

    // If type is not 'relationship' or not specified, include attack objects
    if (!options.type || options.type !== 'relationship') {
      const attackObjects = await attackObjectsRepository.retrieveAllWithAttackURLInDescription();
      // If a specific type is requested, filter attack objects by type
      const filteredObjects = options.type
        ? attackObjects.filter((obj) => obj.stix?.type === options.type)
        : attackObjects;
      await identitiesService.addCreatedByAndModifiedByIdentitiesToAll(filteredObjects);
      results.push(...filteredObjects);
    }

    return results;
  }

  /**
   * Retrieves parallel relationships - relationships that share the same source_ref,
   * target_ref, and relationship_type.
   * @returns {Promise<Map>} Map of relationship keys to arrays of parallel relationships
   */
  async getParallelRelationships(options = {lookupRefs: true}) {
    const relationshipMap = await relationshipsRepository.retrieveParallelRelationships();

    // Add identity information to each relationship in the map
    for (const relationships of relationshipMap.values()) {
      // Get source and target objects
      if (options.lookupRefs) {
        for (const document of relationships) {
          if (Array.isArray(document.source_objects)) {
            if (document.source_objects.length === 0) {
              document.source_objects = undefined;
            } else {
              document.source_objects.sort((a, b) => b.stix.modified - a.stix.modified);
              document.source_object = document.source_objects[0];
              document.source_objects = undefined;
            }
          }
          if (Array.isArray(document.target_objects)) {
            if (document.target_objects.length === 0) {
              document.target_objects = undefined;
            } else {
              document.target_objects.sort((a, b) => b.stix.modified - a.stix.modified);
              document.target_object = document.target_objects[0];
              document.target_objects = undefined;
            }
          }
        }
      }
      await identitiesService.addCreatedByAndModifiedByIdentitiesToAll(relationships);
    }

    return relationshipMap;
  }
}

module.exports = new ReportsService();
