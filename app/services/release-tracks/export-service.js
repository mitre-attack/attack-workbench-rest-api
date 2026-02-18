'use strict';

// =============================================================================
// Export Service
//
// Hydrates STIX object refs (from snapshot members/staged/candidates tiers)
// into full STIX documents, then formats the output as one of:
//   - bundle:          Standard STIX 2.1 bundle
//   - workbench:       Custom format with workflow metadata
//   - filesystemstore: Directory structure organized by STIX type
//
// This service performs cross-service READS (permitted by the event-driven
// architecture — see docs/CROSS_SERVICE_READS_PATTERN.md) by querying STIX
// repositories directly. It does NOT write to any external repository.
// =============================================================================

const uuid = require('uuid');
const types = require('../../lib/types');
const logger = require('../../lib/logger');

// ---------------------------------------------------------------------------
// Repository map — lazy-loaded to avoid circular dependency issues at startup.
//
// Maps STIX type prefixes to their corresponding repositories so we can
// batch-query each repository's `findManyByIdAndModified` in parallel.
// ---------------------------------------------------------------------------

let _repoMap = null;

function getRepositoryMap() {
  if (_repoMap) return _repoMap;

  _repoMap = {
    [types.Technique]: require('../../repository/techniques-repository'),
    [types.Tactic]: require('../../repository/tactics-repository'),
    [types.Group]: require('../../repository/groups-repository'),
    [types.Campaign]: require('../../repository/campaigns-repository'),
    [types.Mitigation]: require('../../repository/mitigations-repository'),
    [types.Matrix]: require('../../repository/matrix-repository'),
    [types.Relationship]: require('../../repository/relationships-repository'),
    [types.MarkingDefinition]: require('../../repository/marking-definitions-repository'),
    [types.Identity]: require('../../repository/identities-repository'),
    [types.Note]: require('../../repository/notes-repository'),
    [types.DataSource]: require('../../repository/data-sources-repository'),
    [types.DataComponent]: require('../../repository/data-components-repository'),
    [types.Asset]: require('../../repository/assets-repository'),
    [types.Analytic]: require('../../repository/analytics-repository'),
    [types.DetectionStrategy]: require('../../repository/detection-strategies-repository'),
  };

  // Software types share a single repository
  const softwareRepo = require('../../repository/software-repository');
  _repoMap[types.Malware] = softwareRepo;
  _repoMap[types.Tool] = softwareRepo;

  return _repoMap;
}

// =============================================================================
// Hydration
// =============================================================================

/**
 * Hydrate an array of tier entries into full STIX documents.
 *
 * Groups entries by STIX type (extracted from the `object_ref` prefix) and
 * batch-queries each repository in parallel via `findManyByIdAndModified`.
 *
 * @param {Array<{object_ref: string, object_modified: string|Date}>} entries
 * @returns {Promise<Array<Object>>} Full Mongoose lean documents ({ stix, workspace, ... })
 */
exports.hydrateMembers = async function hydrateMembers(entries) {
  if (!entries || entries.length === 0) return [];

  // Group entries by STIX type prefix
  const byType = {};
  for (const entry of entries) {
    const type = entry.object_ref.split('--')[0];
    if (!byType[type]) byType[type] = [];
    byType[type].push(entry);
  }

  const repoMap = getRepositoryMap();
  const hydrated = [];

  await Promise.all(
    Object.entries(byType).map(async ([type, refs]) => {
      const repo = repoMap[type];
      if (!repo) {
        logger.warn(
          `ExportService: No repository for type "${type}", skipping ${refs.length} object(s)`,
        );
        return;
      }
      try {
        const docs = await repo.findManyByIdAndModified(refs);
        hydrated.push(...docs);
      } catch (err) {
        logger.error(`ExportService: Failed to hydrate ${refs.length} "${type}" object(s):`, err);
      }
    }),
  );

  return hydrated;
};

// =============================================================================
// Format helpers
// =============================================================================

/**
 * Build a lookup from (object_ref::object_modified_ms) → tier name.
 * Used by the workbench formatter to annotate each object with its tier.
 */
function buildTierLookup(snapshot) {
  const lookup = {};
  for (const m of snapshot.members || []) {
    lookup[`${m.object_ref}::${new Date(m.object_modified).getTime()}`] = 'released';
  }
  for (const s of snapshot.staged || []) {
    lookup[`${s.object_ref}::${new Date(s.object_modified).getTime()}`] = 'staged';
  }
  for (const c of snapshot.candidates || []) {
    lookup[`${c.object_ref}::${new Date(c.object_modified).getTime()}`] = 'candidate';
  }
  return lookup;
}

/**
 * Format as a standard STIX 2.1 bundle.
 *
 * Only includes `stix` properties — no workspace data or workflow metadata.
 */
exports.formatAsBundle = function formatAsBundle(snapshot, hydratedObjects) {
  return {
    type: 'bundle',
    id: `bundle--${uuid.v4()}`,
    objects: hydratedObjects.map((doc) => doc.stix),
  };
};

/**
 * Format as a workbench-optimized response with full metadata.
 *
 * Includes `stix` + `workspace` properties and tier annotations.
 * The `include` option controls whether staged/candidates are included.
 */
exports.formatAsWorkbench = function formatAsWorkbench(snapshot, hydratedObjects) {
  const tierLookup = buildTierLookup(snapshot);

  const objects = hydratedObjects.map((doc) => {
    const key = `${doc.stix.id}::${new Date(doc.stix.modified).getTime()}`;
    return {
      stix: doc.stix,
      workspace: doc.workspace || {},
      metadata: {
        collection_tier: tierLookup[key] || 'released',
        object_type: doc.stix.type,
        object_name: doc.stix.name || doc.stix.id,
      },
    };
  });

  return {
    collection: {
      id: snapshot.id,
      version: snapshot.version,
      name: snapshot.name,
      modified: snapshot.modified,
    },
    objects,
    summary: {
      released_count: (snapshot.members || []).length,
      staged_count: (snapshot.staged || []).length,
      candidate_count: (snapshot.candidates || []).length,
    },
  };
};

/**
 * Format as a FileSystemStore-compatible directory structure.
 *
 * Objects are grouped by STIX type, each with a filename and content property.
 * See docs/COLLECTIONS_V2/07_OUTPUT_FORMATS.md for specification.
 */
exports.formatAsFilesystemStore = function formatAsFilesystemStore(snapshot, hydratedObjects) {
  const structure = {};

  for (const doc of hydratedObjects) {
    const type = doc.stix.type;
    if (!structure[type]) structure[type] = [];
    structure[type].push({
      filename: `${doc.stix.id}.json`,
      content: doc.stix,
    });
  }

  return {
    format: 'filesystemstore',
    track_id: snapshot.id,
    version: snapshot.version,
    structure,
  };
};

// =============================================================================
// Main export entry point
// =============================================================================

/**
 * Export a snapshot in the specified format.
 *
 * This is the primary entry point called by the facade when a `format`
 * query parameter is provided on snapshot retrieval endpoints.
 *
 * @param {Object} snapshot - The raw snapshot document from the dynamic repo
 * @param {string} format - One of: 'bundle', 'workbench', 'filesystemstore'
 * @param {Object} [options] - Additional options
 * @param {string} [options.include] - For workbench format: 'staged', 'candidates', or 'all'
 * @returns {Promise<Object>} The formatted export
 */
exports.exportSnapshot = async function exportSnapshot(snapshot, format, options = {}) {
  const members = snapshot.members || [];

  if (format === 'bundle') {
    if (members.length === 0) {
      return { type: 'bundle', id: `bundle--${uuid.v4()}`, objects: [] };
    }
    const hydratedMembers = await exports.hydrateMembers(members);
    return exports.formatAsBundle(snapshot, hydratedMembers);
  }

  if (format === 'workbench') {
    // Workbench format optionally includes staged and/or candidate objects
    const allRefs = [...members];
    if (options.include === 'staged' || options.include === 'all') {
      allRefs.push(...(snapshot.staged || []));
    }
    if (options.include === 'candidates' || options.include === 'all') {
      allRefs.push(...(snapshot.candidates || []));
    }

    if (allRefs.length === 0) {
      return exports.formatAsWorkbench(snapshot, []);
    }
    const hydratedAll = await exports.hydrateMembers(allRefs);
    return exports.formatAsWorkbench(snapshot, hydratedAll);
  }

  if (format === 'filesystemstore') {
    if (members.length === 0) {
      return {
        format: 'filesystemstore',
        track_id: snapshot.id,
        version: snapshot.version,
        structure: {},
      };
    }
    const hydratedMembers = await exports.hydrateMembers(members);
    return exports.formatAsFilesystemStore(snapshot, hydratedMembers);
  }

  // Unknown format — return raw snapshot unchanged
  logger.warn(`ExportService: Unknown format "${format}", returning raw snapshot`);
  return snapshot;
};
