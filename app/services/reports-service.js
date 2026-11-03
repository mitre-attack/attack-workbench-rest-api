'use strict';

const attackObjectsRepository = require('../repository/attack-objects-repository');
const relationshipsRepository = require('../repository/relationships-repository');
const identitiesService = require('./stix/identities-service');

// ATT&CK SDO types whose ADM schema carries x_mitre_domains. Relationships,
// identities, marking definitions, and notes are not domain-bearing.
const DOMAIN_BEARING_TYPES = Object.freeze([
  'attack-pattern',
  'campaign',
  'course-of-action',
  'intrusion-set',
  'malware',
  'tool',
  'x-mitre-analytic',
  'x-mitre-asset',
  'x-mitre-data-component',
  'x-mitre-data-source',
  'x-mitre-detection-strategy',
  'x-mitre-matrix',
  'x-mitre-tactic',
]);

function domainsOf(document) {
  const domains = document?.stix?.x_mitre_domains;
  return Array.isArray(domains) ? domains : [];
}

function isActive(document) {
  return !document.stix?.revoked && !document.stix?.x_mitre_deprecated;
}

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
   * Domain consistency: release-track bundles never discover objects through
   * relationships, so a relationship only ships when both endpoints are members
   * of the same track. Endpoints that share no x_mitre_domains value, and
   * domain-bearing objects with no domains at all, are therefore content that
   * can never be published together and should be fixed at the source.
   *
   * Evaluates the latest revision of every active relationship against the
   * latest revision of each endpoint. A relationship whose endpoint is missing
   * or has no domains is not reported as cross-domain (the missing-domain
   * object is listed separately).
   *
   * @returns {Promise<{
   *   cross_domain_relationships: Array<Object>,
   *   objects_without_domains: Array<Object>,
   *   summary: { cross_domain_relationship_count: number, objects_without_domains_count: number },
   * }>}
   */
  async getDomainConsistency() {
    const [relationships, objectsResult] = await Promise.all([
      relationshipsRepository.retrieveAll({ versions: 'latest' }),
      attackObjectsRepository.retrieveAll({
        versions: 'latest',
        includeRevoked: true,
        includeDeprecated: true,
      }),
    ]);
    const objects = objectsResult[0]?.documents || [];
    const latestById = new Map(objects.map((document) => [document.stix.id, document]));

    const crossDomainRelationships = [];
    for (const relationship of relationships) {
      const source = latestById.get(relationship.stix.source_ref);
      const target = latestById.get(relationship.stix.target_ref);
      if (!source || !target) continue;
      const sourceDomains = domainsOf(source);
      const targetDomains = domainsOf(target);
      if (sourceDomains.length === 0 || targetDomains.length === 0) continue;
      if (sourceDomains.some((domain) => targetDomains.includes(domain))) continue;
      crossDomainRelationships.push({
        ...relationship,
        source_object: source,
        target_object: target,
        source_domains: sourceDomains,
        target_domains: targetDomains,
      });
    }

    const objectsWithoutDomains = objects.filter(
      (document) =>
        DOMAIN_BEARING_TYPES.includes(document.stix.type) &&
        isActive(document) &&
        domainsOf(document).length === 0,
    );

    await identitiesService.addCreatedByAndModifiedByIdentitiesToAll([
      ...crossDomainRelationships,
      ...objectsWithoutDomains,
    ]);

    return {
      cross_domain_relationships: crossDomainRelationships,
      objects_without_domains: objectsWithoutDomains,
      summary: {
        cross_domain_relationship_count: crossDomainRelationships.length,
        objects_without_domains_count: objectsWithoutDomains.length,
      },
    };
  }

  /**
   * Report coverage of all supported domain-bearing SDOs, including inactive ones.
   * Recorded backrefs describe stored membership, not an immutable enrollment history.
   */
  async getReleaseTrackCoverage() {
    const results =
      await attackObjectsRepository.retrieveReleaseTrackCoverage(DOMAIN_BEARING_TYPES);
    return {
      ...results,
      summary: {
        untracked_latest_revision_count: results.untracked_latest_revisions.length,
        never_enrolled_object_count: results.never_enrolled_objects.length,
      },
    };
  }

  /**
   * Retrieves parallel relationships - relationships that share the same source_ref,
   * target_ref, and relationship_type.
   * @returns {Promise<Map>} Map of relationship keys to arrays of parallel relationships
   */
  async getParallelRelationships(options = { lookupRefs: true }) {
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
module.exports.DOMAIN_BEARING_TYPES = DOMAIN_BEARING_TYPES;
