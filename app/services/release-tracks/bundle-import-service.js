'use strict';

// =============================================================================
// Bundle Import Service
//
// Parses a STIX 2.1 bundle and creates a new release track from it.
//
// This is an independent implementation that does NOT depend on the legacy
// collection-bundles infrastructure. It will eventually supplant that system
// once it has been tested, validated, and shipped.
//
// The import process:
//   1. Extract collection metadata (if an x-mitre-collection object is present)
//   2. Sort non-collection objects by dependency order
//   3. Import each object into the database (skip duplicates)
//   4. Build member entries from all imported/existing objects
//   5. Create a new release track with those members
// =============================================================================

const types = require('../../lib/types');
const logger = require('../../lib/logger');
const snapshotService = require('./snapshot-service');
const { BadRequestError, DuplicateIdError } = require('../../exceptions');

// ---------------------------------------------------------------------------
// Service map — lazy-loaded to avoid circular dependency issues at startup.
//
// Maps STIX type prefixes to STIX services so we can call
// `service.create(data, { import: true })` for each object.
// ---------------------------------------------------------------------------

let _serviceMap = null;

function getServiceMap() {
  if (_serviceMap) return _serviceMap;

  _serviceMap = {
    [types.Technique]: require('../stix/techniques-service'),
    [types.Tactic]: require('../stix/tactics-service'),
    [types.Group]: require('../stix/groups-service'),
    [types.Campaign]: require('../stix/campaigns-service'),
    [types.Mitigation]: require('../stix/mitigations-service'),
    [types.Matrix]: require('../stix/matrices-service'),
    [types.Relationship]: require('../stix/relationships-service'),
    [types.MarkingDefinition]: require('../stix/marking-definitions-service'),
    [types.Identity]: require('../stix/identities-service'),
    [types.Note]: require('../../services/system/notes-service'),
    [types.DataSource]: require('../stix/data-sources-service'),
    [types.DataComponent]: require('../stix/data-components-service'),
    [types.Asset]: require('../stix/assets-service'),
    [types.Analytic]: require('../stix/analytics-service'),
    [types.DetectionStrategy]: require('../stix/detection-strategies-service'),
  };

  // Software types share a single service
  const softwareService = require('../stix/software-service');
  _serviceMap[types.Malware] = softwareService;
  _serviceMap[types.Tool] = softwareService;

  return _serviceMap;
}

// ---------------------------------------------------------------------------
// Dependency sort order — ensures referenced objects are created before
// objects that reference them. Same ordering as import-bundle.js.
// ---------------------------------------------------------------------------

const TYPE_SORT_ORDER = {
  [types.MarkingDefinition]: 0,
  [types.Identity]: 1,
  [types.DataSource]: 2,
  [types.DataComponent]: 3,
  [types.Analytic]: 4,
  [types.DetectionStrategy]: 5,
  [types.Technique]: 6,
  [types.Tactic]: 7,
  [types.Mitigation]: 8,
  [types.Group]: 9,
  [types.Campaign]: 10,
  [types.Malware]: 11,
  [types.Tool]: 12,
  [types.Asset]: 13,
  [types.Matrix]: 14,
  [types.Relationship]: 15,
  [types.Note]: 16,
};

function getTypeSortOrder(stixType) {
  return TYPE_SORT_ORDER[stixType] ?? 99;
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Extract the x-mitre-collection object from the bundle (if present).
 * Returns `{ collectionObj, otherObjects }`.
 */
function extractCollectionObject(objects) {
  let collectionObj = null;
  const otherObjects = [];

  for (const obj of objects) {
    if (obj.type === 'x-mitre-collection') {
      // Take the first collection object; ignore duplicates
      if (!collectionObj) {
        collectionObj = obj;
      } else {
        logger.warn('BundleImportService: Multiple x-mitre-collection objects found; using first');
      }
    } else {
      otherObjects.push(obj);
    }
  }

  return { collectionObj, otherObjects };
}

/**
 * Sort objects by dependency order for safe sequential import.
 */
function sortByDependencyOrder(objects) {
  return [...objects].sort((a, b) => getTypeSortOrder(a.type) - getTypeSortOrder(b.type));
}

/**
 * Import a single STIX object into the database, skipping if it already exists.
 *
 * @param {Object} stixObj - A raw STIX object from the bundle
 * @param {Object} serviceMap - Type → service mapping
 * @returns {Promise<{imported: boolean, ref: {object_ref: string, object_modified: string}}>}
 */
async function importObject(stixObj, serviceMap) {
  const service = serviceMap[stixObj.type];
  if (!service) {
    logger.warn(
      `BundleImportService: No service for type "${stixObj.type}", skipping "${stixObj.id}"`,
    );
    return { imported: false, ref: null };
  }

  // Validate required fields
  if (!stixObj.id || !stixObj.modified) {
    logger.warn(
      `BundleImportService: Object missing id or modified, skipping: ${JSON.stringify({ id: stixObj.id, type: stixObj.type })}`,
    );
    return { imported: false, ref: null };
  }

  const ref = {
    object_ref: stixObj.id,
    object_modified: stixObj.modified,
  };

  // Check if this exact version already exists
  try {
    const existing = await service.retrieveVersionById(stixObj.id, stixObj.modified);
    if (existing) {
      logger.verbose(
        `BundleImportService: Object "${stixObj.id}" @ ${stixObj.modified} already exists, skipping`,
      );
      return { imported: false, ref };
    }
  } catch (err) {
    // retrieveVersionById may throw for various reasons; proceed with create attempt
    logger.debug(
      `BundleImportService: Could not check existence of "${stixObj.id}": ${err.message}`,
    );
  }

  // Create the object
  try {
    const data = {
      stix: stixObj,
      workspace: {},
    };

    await service.create(data, { import: true });

    logger.verbose(`BundleImportService: Imported "${stixObj.type}" "${stixObj.id}"`);
    return { imported: true, ref };
  } catch (err) {
    if (err instanceof DuplicateIdError || err.name === 'DuplicateIdError') {
      // Race condition or index-level duplicate — treat as already-existing
      logger.verbose(
        `BundleImportService: Duplicate detected for "${stixObj.id}", treating as existing`,
      );
      return { imported: false, ref };
    }

    // Non-duplicate errors are logged but don't abort the entire import
    logger.error(`BundleImportService: Failed to import "${stixObj.id}":`, err);
    return { imported: false, ref };
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Create a new release track from a STIX bundle.
 *
 * The bundle is parsed, its objects are imported into the database (skipping
 * duplicates), and a new standard release track is created with the imported
 * objects as members.
 *
 * If the bundle contains an `x-mitre-collection` object, its `name` and
 * `description` are used as track metadata, and its `x_mitre_contents` (if
 * present) is used as the authoritative member list.
 *
 * @param {Object} bundleData - Validated bundle: { type: 'bundle', id, objects }
 * @returns {Promise<Object>} The created track's initial snapshot
 */
exports.createTrackFromBundle = async function createTrackFromBundle(bundleData) {
  if (!bundleData || !Array.isArray(bundleData.objects) || bundleData.objects.length === 0) {
    throw new BadRequestError({
      message: 'Invalid bundle: must contain at least one object',
    });
  }

  logger.verbose(
    `BundleImportService: Processing bundle "${bundleData.id}" with ${bundleData.objects.length} object(s)`,
  );

  // ------------------------------------------------------------------
  // Step 1: Extract collection metadata
  // ------------------------------------------------------------------

  const { collectionObj, otherObjects } = extractCollectionObject(bundleData.objects);

  const trackName = collectionObj?.name || 'Imported Track';
  const trackDescription = collectionObj?.description || `Imported from bundle ${bundleData.id}`;

  // ------------------------------------------------------------------
  // Step 2: Sort and import objects
  // ------------------------------------------------------------------

  const sorted = sortByDependencyOrder(otherObjects);
  const serviceMap = getServiceMap();

  const importedRefs = [];
  let importedCount = 0;
  let skippedCount = 0;

  for (const stixObj of sorted) {
    const { imported, ref } = await importObject(stixObj, serviceMap);
    if (ref) {
      importedRefs.push(ref);
    }
    if (imported) importedCount++;
    else if (ref) skippedCount++;
  }

  // ------------------------------------------------------------------
  // Step 3: Determine member entries
  // ------------------------------------------------------------------

  let memberEntries;

  if (
    collectionObj &&
    Array.isArray(collectionObj.x_mitre_contents) &&
    collectionObj.x_mitre_contents.length > 0
  ) {
    // Use the collection's x_mitre_contents as the authoritative member list
    memberEntries = collectionObj.x_mitre_contents.map((entry) => ({
      object_ref: entry.object_ref,
      object_modified: entry.object_modified,
    }));
    logger.verbose(
      `BundleImportService: Using collection x_mitre_contents (${memberEntries.length} entries)`,
    );
  } else {
    // Fall back to using all imported object refs
    memberEntries = importedRefs;
    logger.verbose(
      `BundleImportService: Using imported objects as members (${memberEntries.length} entries)`,
    );
  }

  // ------------------------------------------------------------------
  // Step 4: Create the release track
  // ------------------------------------------------------------------

  const snapshot = await snapshotService.createTrack({
    name: trackName,
    description: trackDescription,
    type: 'standard',
  });

  // Add members by cloning the initial (empty) snapshot with the member entries
  if (memberEntries.length > 0) {
    const finalSnapshot = await snapshotService.cloneSnapshot(snapshot.id, snapshot, {
      members: memberEntries,
    });

    logger.verbose(
      `BundleImportService: Created track "${trackName}" (${snapshot.id}) ` +
        `with ${memberEntries.length} member(s) ` +
        `(${importedCount} imported, ${skippedCount} already existed)`,
    );

    return finalSnapshot;
  }

  logger.verbose(
    `BundleImportService: Created track "${trackName}" (${snapshot.id}) with 0 members`,
  );

  return snapshot;
};
