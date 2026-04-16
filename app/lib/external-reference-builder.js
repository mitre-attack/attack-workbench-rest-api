'use strict';

const logger = require('./logger');

/**
 * Map STIX types to their corresponding ATT&CK website URL paths
 */
const STIX_TYPE_TO_URL_PATH = {
  'attack-pattern': 'techniques',
  'intrusion-set': 'groups',
  malware: 'software',
  tool: 'software',
  'course-of-action': 'mitigations',
  campaign: 'campaigns',
  'x-mitre-data-source': 'datasources',
  'x-mitre-data-component': 'datacomponents',
  'x-mitre-detection-strategy': 'detection-strategies',
  'x-mitre-analytic': 'analytics',
  'x-mitre-asset': 'assets',
  'x-mitre-tactic': 'tactics',
  'x-mitre-matrix': 'matrices',
};

/**
 * Build the ATT&CK external reference object for a given ATT&CK ID and STIX type
 * @param {string} attackId - The ATT&CK ID (e.g., T0001, G0042, T1234.001)
 * @param {string} stixType - The STIX type (e.g., attack-pattern, intrusion-set)
 * @param {object} options - Optional parameters
 * @param {boolean} options.isSubtechnique - Whether this is a subtechnique
 * @param {string} options.parentDetectionStrategyId - For analytics, the parent detection strategy ATT&CK ID
 * @returns {object} External reference object with source_name, external_id, and url
 */
function buildAttackExternalReference(attackId, stixType, options = {}) {
  if (!attackId && !stixType) {
    logger.warn('buildAttackExternalReference called with no attackId or stixType');
    return null;
  }

  // Special case: Analytics with a parent detection strategy get a custom URL
  if (stixType === 'x-mitre-analytic') {
    if (options.parentDetectionStrategyId) {
      return {
        source_name: 'mitre-attack',
        external_id: attackId,
        url: `https://attack.mitre.org/detectionstrategies/${options.parentDetectionStrategyId}#${attackId}`,
      };
    } else {
      // No parent detection strategy, return reference without URL
      return {
        source_name: 'mitre-attack',
        external_id: attackId,
      };
    }
  }

  const urlPath = STIX_TYPE_TO_URL_PATH[stixType];
  if (!urlPath) {
    // Type doesn't have a URL mapping, return reference without URL
    logger.debug(
      `No URL path mapping for STIX type '${stixType}'; omitting url from external reference`,
    );
    return {
      source_name: 'mitre-attack',
      external_id: attackId,
    };
  }

  let url;
  if (stixType === 'x-mitre-matrix') {
    // Matrices use the domain name as external_id (e.g., "enterprise-attack")
    // and the URL path strips the "-attack" suffix (e.g., /matrices/enterprise)
    const urlSegment = attackId.replace(/-attack$/, '');
    url = `https://attack.mitre.org/${urlPath}/${urlSegment}`;
  } else {
    const isSubtechnique = options.isSubtechnique || attackId.includes('.');
    if (stixType === 'attack-pattern' && isSubtechnique) {
      // Subtechniques use format: /techniques/T1234/001
      const [parentId, subId] = attackId.split('.');
      url = `https://attack.mitre.org/${urlPath}/${parentId}/${subId}`;
    } else {
      url = `https://attack.mitre.org/${urlPath}/${attackId}`;
    }
  }

  return {
    source_name: 'mitre-attack',
    external_id: attackId,
    url,
  };
}

/**
 * Extract parent detection strategy ATT&CK ID from workspace embedded relationships
 * @param {object} data - The data object containing workspace
 * @param {object} options - Optional fallback context
 * @param {object} options.previousVersion - Previous persisted version for version-aware lookups
 * @returns {string|null} The detection strategy ATT&CK ID or null
 */
function extractParentDetectionStrategyId(data, options = {}) {
  // Check if this is an analytic
  if (data.stix?.type !== 'x-mitre-analytic') {
    return null;
  }

  const embeddedRelationshipCandidates = [
    data.workspace?.embedded_relationships,
    options.previousVersion?.workspace?.embedded_relationships,
  ];

  // Look for parent detection strategy in embedded relationships. Analytics are referenced
  // by detection strategies via x_mitre_analytic_refs, so we look for inbound relationships.
  for (const embeddedRelationships of embeddedRelationshipCandidates) {
    if (
      embeddedRelationships &&
      Array.isArray(embeddedRelationships) &&
      embeddedRelationships.length > 0
    ) {
      const parentDetectionStrategy = embeddedRelationships.find(
        (rel) =>
          rel.direction === 'inbound' && rel.stix_id?.startsWith('x-mitre-detection-strategy--'),
      );

      if (parentDetectionStrategy) {
        return parentDetectionStrategy.attack_id || null;
      }
    }
  }

  return null;
}

/**
 * Create an ATT&CK external reference for the given data
 * @param {object} data - The data object containing stix and workspace
 * @param {object} options - Optional context for deriving the reference
 * @param {object} options.previousVersion - Previous persisted version for version-aware lookups
 * @returns {object|null} The ATT&CK external reference object, or null if not applicable
 */
function createAttackExternalReference(data, options = {}) {
  const stixType = data.stix?.type;

  // Matrices don't have ATT&CK IDs; their external_id is the domain name
  // (e.g., "enterprise-attack") taken from x_mitre_domains[0].
  if (stixType === 'x-mitre-matrix') {
    const domain = data.stix?.x_mitre_domains?.[0];
    if (!domain) {
      logger.debug('Matrix has no x_mitre_domains; omitting ATT&CK external reference');
      return null;
    }
    return buildAttackExternalReference(domain, stixType);
  }

  const attackId = data.workspace?.attack_id;

  if (!attackId) {
    // No ATT&CK ID means no external reference to generate.
    // This is expected for types like relationships that never have ATT&CK IDs.
    return null;
  }

  // Prepare options for URL building
  const buildOptions = {};
  if (stixType === 'attack-pattern') {
    buildOptions.isSubtechnique = data.stix?.x_mitre_is_subtechnique === true;
  }
  if (stixType === 'x-mitre-analytic') {
    buildOptions.parentDetectionStrategyId =
      options.parentDetectionStrategyId || extractParentDetectionStrategyId(data, options);
  }

  return buildAttackExternalReference(attackId, stixType, buildOptions);
}

/**
 * Check if an external reference is an ATT&CK reference
 * @param {object} ref - The external reference object
 * @returns {boolean} True if this is an ATT&CK reference
 */
function isAttackExternalReference(ref) {
  return ref && ref.source_name === 'mitre-attack';
}

/**
 * Find the ATT&CK external reference in an array
 * @param {Array} externalReferences - Array of external reference objects
 * @returns {object|null} The ATT&CK external reference, or null if not found
 */
function findAttackExternalReference(externalReferences) {
  if (!externalReferences || !Array.isArray(externalReferences)) {
    return null;
  }
  return externalReferences.find(isAttackExternalReference) || null;
}

/**
 * Remove all ATT&CK external references from an array
 * @param {Array} externalReferences - Array of external reference objects
 * @returns {Array} New array with ATT&CK references removed
 */
function removeAttackExternalReferences(externalReferences) {
  if (!externalReferences || !Array.isArray(externalReferences)) {
    return [];
  }
  return externalReferences.filter((ref) => !isAttackExternalReference(ref));
}

/**
 * Validate that an ATT&CK external reference matches the expected values
 * @param {object} actualRef - The actual external reference from client
 * @param {object} expectedRef - The expected external reference
 * @returns {object} Validation result with isValid boolean and error message if invalid
 */
function validateAttackExternalReference(actualRef, expectedRef) {
  if (!actualRef || !expectedRef) {
    return { isValid: true };
  }

  // Check external_id matches
  if (actualRef.external_id !== expectedRef.external_id) {
    return {
      isValid: false,
      error: `Cannot modify ATT&CK ID: expected '${expectedRef.external_id}' but received '${actualRef.external_id}'`,
    };
  }

  // Check URL matches if expected URL exists
  if (expectedRef.url && actualRef.url && actualRef.url !== expectedRef.url) {
    return {
      isValid: false,
      error: `Cannot modify ATT&CK reference URL: expected '${expectedRef.url}' but received '${actualRef.url}'`,
    };
  }

  return { isValid: true };
}

module.exports = {
  buildAttackExternalReference,
  createAttackExternalReference,
  extractParentDetectionStrategyId,
  isAttackExternalReference,
  findAttackExternalReference,
  removeAttackExternalReferences,
  validateAttackExternalReference,
};
