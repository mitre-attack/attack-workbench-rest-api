'use strict';

// =============================================================================
// Ephemeral Service
//
// Generates stateless, non-persisted STIX bundles for a given ATT&CK domain.
// Unlike regular release tracks (which store snapshots with object refs),
// ephemeral bundles are computed on-the-fly by querying all STIX repositories
// for objects belonging to the requested domain.
//
// This service performs cross-service READS (permitted by the event-driven
// architecture — see docs/CROSS_SERVICE_READS_PATTERN.md) by querying STIX
// repositories directly. It does NOT write to any repository.
//
// The domain query pattern mirrors stix-bundles-service.exportBundle, but
// operates independently of the legacy collection-bundles infrastructure.
// =============================================================================

const uuid = require('uuid');
const logger = require('../../lib/logger');

// ---------------------------------------------------------------------------
// Domain mapping
// ---------------------------------------------------------------------------

const DOMAIN_MAP = {
  enterprise: 'enterprise-attack',
  ics: 'ics-attack',
  mobile: 'mobile-attack',
};

// ---------------------------------------------------------------------------
// Repository references — lazy-loaded to avoid circular dependencies.
//
// Only repos whose models have `stix.x_mitre_domains` are queried directly.
// Relationships, identities, and marking definitions are discovered through
// references in primary objects.
// ---------------------------------------------------------------------------

let _repos = null;

function getRepositories() {
  if (_repos) return _repos;

  _repos = {
    technique: require('../../repository/techniques-repository'),
    tactic: require('../../repository/tactics-repository'),
    mitigation: require('../../repository/mitigations-repository'),
    software: require('../../repository/software-repository'),
    matrix: require('../../repository/matrix-repository'),
    analytic: require('../../repository/analytics-repository'),
    dataComponent: require('../../repository/data-components-repository'),
    dataSource: require('../../repository/data-sources-repository'),
    asset: require('../../repository/assets-repository'),
    relationship: require('../../repository/relationships-repository'),
    identity: require('../../repository/identities-repository'),
    markingDefinition: require('../../repository/marking-definitions-repository'),
  };

  return _repos;
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Collect unique identity and marking-definition STIX IDs referenced by a
 * set of STIX documents so we can fetch them in a single batch.
 */
function collectReferencedIds(documents) {
  const identityIds = new Set();
  const markingIds = new Set();

  for (const doc of documents) {
    const stix = doc.stix;
    if (stix.created_by_ref) identityIds.add(stix.created_by_ref);
    if (Array.isArray(stix.object_marking_refs)) {
      for (const ref of stix.object_marking_refs) markingIds.add(ref);
    }
  }

  return { identityIds, markingIds };
}

/**
 * Fetch identities and marking definitions by their STIX IDs.
 */
async function fetchSupportingObjects(identityIds, markingIds) {
  const repos = getRepositories();
  const results = [];

  // Fetch identities
  await Promise.all(
    [...identityIds].map(async (id) => {
      try {
        const doc = await repos.identity.retrieveLatestByStixId(id);
        if (doc) results.push(doc);
      } catch (err) {
        logger.warn(`EphemeralService: Could not fetch identity "${id}": ${err.message}`);
      }
    }),
  );

  // Fetch marking definitions
  await Promise.all(
    [...markingIds].map(async (id) => {
      try {
        const doc = await repos.markingDefinition.retrieveLatestByStixId(id);
        if (doc) results.push(doc);
      } catch (err) {
        logger.warn(`EphemeralService: Could not fetch marking definition "${id}": ${err.message}`);
      }
    }),
  );

  return results;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Generate an ephemeral STIX bundle for a domain.
 *
 * Queries all domain-aware repositories in parallel for the latest version
 * of each object in the given domain, then discovers and includes
 * relationships that connect those objects, along with referenced identities
 * and marking definitions.
 *
 * @param {string} domain - One of: 'enterprise', 'ics', 'mobile'
 * @param {string} [format='bundle'] - Output format (currently only 'bundle')
 * @returns {Promise<Object>} A STIX bundle (or formatted output)
 */
exports.getEphemeralBundle = async function getEphemeralBundle(domain, format) {
  const attackDomain = DOMAIN_MAP[domain];
  if (!attackDomain) {
    const { BadRequestError } = require('../../exceptions');
    throw new BadRequestError({
      message: `Unknown domain: "${domain}"`,
      details: `Valid domains are: ${Object.keys(DOMAIN_MAP).join(', ')}`,
    });
  }

  const repos = getRepositories();
  const queryOptions = {
    includeRevoked: false,
    includeDeprecated: false,
  };

  logger.verbose(`EphemeralService: Generating ephemeral bundle for domain "${attackDomain}"`);

  // ------------------------------------------------------------------
  // Step 1: Query all domain-aware repositories in parallel
  // ------------------------------------------------------------------

  const [
    techniques,
    tactics,
    mitigations,
    software,
    matrices,
    analytics,
    dataComponents,
    dataSources,
    assets,
  ] = await Promise.all([
    repos.technique.retrieveAllByDomain(attackDomain, queryOptions),
    repos.tactic.retrieveAllByDomain(attackDomain, queryOptions),
    repos.mitigation.retrieveAllByDomain(attackDomain, queryOptions),
    repos.software.retrieveAllByDomain(attackDomain, queryOptions),
    repos.matrix.retrieveAllByDomain(attackDomain, queryOptions),
    repos.analytic.retrieveAllByDomain(attackDomain, queryOptions),
    repos.dataComponent.retrieveAllByDomain(attackDomain, queryOptions),
    repos.dataSource.retrieveAllByDomain(attackDomain, queryOptions),
    repos.asset.retrieveAllByDomain(attackDomain, queryOptions),
  ]);

  const primaryObjects = [
    ...techniques,
    ...tactics,
    ...mitigations,
    ...software,
    ...matrices,
    ...analytics,
    ...dataComponents,
    ...dataSources,
    ...assets,
  ];

  // ------------------------------------------------------------------
  // Step 2: Build a lookup of primary object IDs for relationship filtering
  // ------------------------------------------------------------------

  const primaryIdSet = new Set(primaryObjects.map((doc) => doc.stix.id));

  // ------------------------------------------------------------------
  // Step 3: Fetch relationships that connect primary objects
  // ------------------------------------------------------------------

  const allRelationships = await repos.relationship.retrieveAll({
    versions: 'latest',
    includeRevoked: false,
    includeDeprecated: false,
  });

  const relevantRelationships = (allRelationships.data || allRelationships).filter(
    (rel) => primaryIdSet.has(rel.stix.source_ref) || primaryIdSet.has(rel.stix.target_ref),
  );

  // ------------------------------------------------------------------
  // Step 4: Fetch supporting objects (identities, marking definitions)
  // ------------------------------------------------------------------

  const allDocs = [...primaryObjects, ...relevantRelationships];
  const { identityIds, markingIds } = collectReferencedIds(allDocs);
  const supportingObjects = await fetchSupportingObjects(identityIds, markingIds);

  // ------------------------------------------------------------------
  // Step 5: Assemble the STIX bundle
  // ------------------------------------------------------------------

  // Deduplicate by stix.id (in case of overlapping supporting objects)
  const seen = new Set();
  const bundleObjects = [];

  for (const doc of [...primaryObjects, ...relevantRelationships, ...supportingObjects]) {
    const key = `${doc.stix.id}::${doc.stix.modified}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bundleObjects.push(doc.stix);
  }

  const bundle = {
    type: 'bundle',
    id: `bundle--${uuid.v4()}`,
    objects: bundleObjects,
  };

  logger.verbose(
    `EphemeralService: Built ephemeral bundle for "${attackDomain}" ` +
      `(${primaryObjects.length} primary, ${relevantRelationships.length} relationships, ` +
      `${supportingObjects.length} supporting → ${bundleObjects.length} total objects)`,
  );

  // Format conversion (if not plain bundle)
  if (format === 'workbench' || format === 'filesystemstore') {
    // Re-use export-service formatters with a synthetic snapshot envelope
    const exportService = require('./export-service');
    const syntheticDocs = [...primaryObjects, ...relevantRelationships, ...supportingObjects];
    const deduped = [];
    const dedupSeen = new Set();
    for (const doc of syntheticDocs) {
      const key = `${doc.stix.id}::${doc.stix.modified}`;
      if (dedupSeen.has(key)) continue;
      dedupSeen.add(key);
      deduped.push(doc);
    }

    const syntheticSnapshot = {
      id: `ephemeral-${domain}`,
      version: null,
      name: `${domain} (ephemeral)`,
      modified: new Date(),
      members: deduped.map((doc) => ({
        object_ref: doc.stix.id,
        object_modified: doc.stix.modified,
      })),
    };

    if (format === 'workbench') {
      return exportService.formatAsWorkbench(syntheticSnapshot, deduped);
    }
    if (format === 'filesystemstore') {
      return exportService.formatAsFilesystemStore(syntheticSnapshot, deduped);
    }
  }

  return bundle;
};
