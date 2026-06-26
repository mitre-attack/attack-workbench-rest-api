'use strict';

// =============================================================================
// Snapshot Service
//
// Core snapshot lifecycle operations: track creation, retrieval, cloning,
// metadata/contents updates, configuration, and deletion.
//
// This is the foundational sub-service consumed by the facade and by other
// sub-services (standard-track, versioning, virtual-track) that need to
// clone or read snapshots.
// =============================================================================

const { v4: uuidv4 } = require('uuid');

const registryRepo = require('../../repository/release-tracks/release-track-registry.repository');
const dynamicRepo = require('../../repository/release-tracks/release-track-dynamic.repository');
const modelFactory = require('../../models/release-tracks/model-factory');
const logger = require('../../lib/logger');
const { TrackNotFoundError, NotFoundError } = require('../../exceptions');

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Deep-clone a snapshot document, stripping Mongoose metadata.
 *
 * @param {Object} snapshot - The source snapshot (lean Mongoose document)
 * @returns {Object} Plain object copy safe for mutation
 */
function deepClone(snapshot) {
  const clone = JSON.parse(JSON.stringify(snapshot));
  delete clone._id;
  delete clone.__v;
  return clone;
}

function normalizeTierSummary(summary) {
  return {
    members_count: summary?.members_count ?? 0,
    staged_count: summary?.staged_count ?? 0,
    candidates_count: summary?.candidates_count ?? 0,
  };
}

/**
 * Recompute and persist denormalized registry counters from actual snapshot data.
 *
 * @param {string} trackId
 */
async function syncRegistryCounters(trackId) {
  const { data: snapshots } = await dynamicRepo.getAllSnapshots(trackId, {
    projection: 'modified version',
  });

  const snapshotCount = snapshots.length;
  const tagged = snapshots.filter((s) => s.version != null);
  const taggedReleaseCount = tagged.length;

  // Latest snapshot is first (sorted desc by modified)
  const latestSnapshotModified = snapshots.length > 0 ? snapshots[0].modified : null;

  // Latest tagged version: find the tagged snapshot with the highest modified
  const latestTaggedVersion = tagged.length > 0 ? tagged[0].version : null;

  await registryRepo.updateByTrackId(trackId, {
    snapshot_count: snapshotCount,
    tagged_release_count: taggedReleaseCount,
    latest_snapshot_modified: latestSnapshotModified,
    latest_tagged_version: latestTaggedVersion,
    updated_at: new Date(),
  });
}

// =============================================================================
// Track management
// =============================================================================

/**
 * List all release tracks from the registry.
 *
 * @param {Object} options - { type?, search?, limit?, offset? }
 * @returns {Promise<{ data: Object[], pagination: Object }>}
 */
exports.listTracks = async function listTracks(options) {
  const result = await registryRepo.findAll(options);
  const data = await Promise.all(
    result.data.map(async (track) => {
      const summary = await dynamicRepo.getLatestSnapshotTierSummary(track.track_id);
      return {
        ...track,
        summary: normalizeTierSummary(summary),
      };
    }),
  );

  return {
    ...result,
    data,
  };
};

/**
 * Create a new release track with an initial empty draft snapshot.
 *
 * @param {Object} data - { name, description?, type, userAccountId?, object_marking_refs?, composition?, snapshot_schedule? }
 * @returns {Promise<Object>} The initial snapshot document
 */
exports.createTrack = async function createTrack(data) {
  const trackId = `release-track--${uuidv4()}`;
  const now = new Date();
  const trackType = data.type || 'standard';

  const initialSnapshot = {
    id: trackId,
    type: trackType,
    modified: now,
    version: null,
    name: data.name,
    description: data.description || '',
    created: now,
    created_by_ref: data.userAccountId || undefined,
    object_marking_refs: data.object_marking_refs,
    members: [],
    staged: trackType === 'standard' ? [] : undefined,
    candidates: trackType === 'standard' ? [] : undefined,
    quarantine: trackType === 'virtual' ? [] : undefined,
    composition: trackType === 'virtual' ? data.composition : undefined,
    config: {},
    version_history: [],
  };

  // Create collection + indexes, then persist the initial snapshot
  await modelFactory.ensureIndexes(trackId);
  const snapshot = await dynamicRepo.saveSnapshot(trackId, initialSnapshot);

  // Register in the central registry
  await registryRepo.create({
    track_id: trackId,
    type: trackType,
    name: data.name,
    description: data.description,
    latest_snapshot_modified: now,
    snapshot_count: 1,
    tagged_release_count: 0,
    created_at: now,
    updated_at: now,
    snapshot_schedule: trackType === 'virtual' ? data.snapshot_schedule : undefined,
  });

  logger.verbose(`SnapshotService: Created ${trackType} track "${data.name}" (${trackId})`);
  return snapshot;
};

// =============================================================================
// Snapshot retrieval
// =============================================================================

/**
 * Retrieve the most recent snapshot for a track.
 *
 * @param {string} trackId
 * @param {Object} [_options] - Reserved for future format/include options
 * @returns {Promise<Object>} The latest snapshot document
 * @throws {TrackNotFoundError} If no snapshots exist for the track
 */
// eslint-disable-next-line no-unused-vars
exports.getLatestSnapshot = async function getLatestSnapshot(trackId, _options) {
  const snapshot = await dynamicRepo.getLatestSnapshot(trackId);
  if (!snapshot) {
    throw new TrackNotFoundError(trackId);
  }
  return snapshot;
};

/**
 * Retrieve a specific snapshot by its modified timestamp.
 *
 * @param {string} trackId
 * @param {string|Date} modified
 * @param {Object} [_options] - Reserved for future format/include options
 * @returns {Promise<Object>} The snapshot document
 * @throws {NotFoundError} If the snapshot does not exist
 */
// eslint-disable-next-line no-unused-vars
exports.getSnapshotByModified = async function getSnapshotByModified(trackId, modified, _options) {
  const snapshot = await dynamicRepo.getSnapshotByModified(trackId, modified);
  if (!snapshot) {
    throw new NotFoundError({
      details: `Snapshot with modified '${modified}' not found for track '${trackId}'`,
    });
  }
  return snapshot;
};

// =============================================================================
// Snapshot cloning (internal helper, also used by other sub-services)
// =============================================================================

/**
 * Clone a snapshot with overrides, persisting the result as a new draft.
 *
 * Every mutation (metadata update, contents update, tier change) produces a
 * new snapshot via this method. Clones are always drafts (version = null).
 *
 * @param {string} trackId - The track to save the clone into
 * @param {Object} sourceSnapshot - The snapshot to clone
 * @param {Object} [overrides] - Fields to merge into the clone
 * @returns {Promise<Object>} The saved clone
 */
exports.cloneSnapshot = async function cloneSnapshot(trackId, sourceSnapshot, overrides) {
  const clone = deepClone(sourceSnapshot);
  clone.modified = new Date();
  clone.version = null; // clones are always drafts

  // Apply overrides
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) {
        clone[key] = value;
      }
    }
  }

  const saved = await dynamicRepo.saveSnapshot(trackId, clone);
  await syncRegistryCounters(trackId);

  logger.verbose(`SnapshotService: Cloned snapshot for track "${trackId}"`);
  return saved;
};

// =============================================================================
// Track cloning
// =============================================================================

/**
 * Clone a track by duplicating its latest snapshot into a new track.
 *
 * @param {string} trackId - Source track ID
 * @param {Object} options - { name?, userAccountId? }
 * @returns {Promise<Object>} The initial snapshot of the new track
 */
exports.cloneTrack = async function cloneTrack(trackId, options) {
  const source = await exports.getLatestSnapshot(trackId);
  return _cloneToNewTrack(source, options);
};

/**
 * Clone a track from a specific snapshot into a new track.
 *
 * @param {string} trackId - Source track ID
 * @param {string|Date} modified - Source snapshot timestamp
 * @param {Object} options - { name?, userAccountId? }
 * @returns {Promise<Object>} The initial snapshot of the new track
 */
exports.cloneFromSnapshot = async function cloneFromSnapshot(trackId, modified, options) {
  const source = await exports.getSnapshotByModified(trackId, modified);
  return _cloneToNewTrack(source, options);
};

/**
 * Internal: create a new track from a source snapshot.
 */
async function _cloneToNewTrack(sourceSnapshot, options = {}) {
  const newTrackId = `release-track--${uuidv4()}`;
  const now = new Date();

  const clone = deepClone(sourceSnapshot);
  clone.id = newTrackId;
  clone.modified = now;
  clone.version = null;
  clone.name = options.name || `${sourceSnapshot.name} (copy)`;
  clone.created = now;
  clone.created_by_ref = options.userAccountId || sourceSnapshot.created_by_ref;
  clone.version_history = [];

  await modelFactory.ensureIndexes(newTrackId);
  const saved = await dynamicRepo.saveSnapshot(newTrackId, clone);

  await registryRepo.create({
    track_id: newTrackId,
    type: sourceSnapshot.type,
    name: clone.name,
    description: sourceSnapshot.description,
    latest_snapshot_modified: now,
    snapshot_count: 1,
    tagged_release_count: 0,
    created_at: now,
    updated_at: now,
  });

  logger.verbose(`SnapshotService: Cloned track to new track "${clone.name}" (${newTrackId})`);
  return saved;
}

// =============================================================================
// Metadata updates
// =============================================================================

/**
 * Update metadata on the latest snapshot (creates a new snapshot clone).
 *
 * @param {string} trackId
 * @param {Object} updates - { name?, description?, object_marking_refs? }
 * @param {string} [_userId]
 * @returns {Promise<Object>} The new snapshot
 */
// eslint-disable-next-line no-unused-vars
exports.updateMetadata = async function updateMetadata(trackId, updates, _userId) {
  const source = await exports.getLatestSnapshot(trackId);
  const overrides = {};
  if (updates.name !== undefined) overrides.name = updates.name;
  if (updates.description !== undefined) overrides.description = updates.description;
  if (updates.object_marking_refs !== undefined)
    overrides.object_marking_refs = updates.object_marking_refs;

  // Also update the registry name/description if changed
  const registryUpdates = {};
  if (updates.name !== undefined) registryUpdates.name = updates.name;
  if (updates.description !== undefined) registryUpdates.description = updates.description;
  if (Object.keys(registryUpdates).length > 0) {
    registryUpdates.updated_at = new Date();
    await registryRepo.updateByTrackId(trackId, registryUpdates);
  }

  return exports.cloneSnapshot(trackId, source, overrides);
};

/**
 * Update metadata on a specific snapshot (creates a new snapshot clone).
 *
 * @param {string} trackId
 * @param {string|Date} modified
 * @param {Object} updates - { name?, description?, object_marking_refs? }
 * @param {string} [_userId]
 * @returns {Promise<Object>} The new snapshot
 */
exports.updateMetadataByModified = async function updateMetadataByModified(
  trackId,
  modified,
  updates,
  // eslint-disable-next-line no-unused-vars
  _userId,
) {
  const source = await exports.getSnapshotByModified(trackId, modified);
  const overrides = {};
  if (updates.name !== undefined) overrides.name = updates.name;
  if (updates.description !== undefined) overrides.description = updates.description;
  if (updates.object_marking_refs !== undefined)
    overrides.object_marking_refs = updates.object_marking_refs;

  const registryUpdates = {};
  if (updates.name !== undefined) registryUpdates.name = updates.name;
  if (updates.description !== undefined) registryUpdates.description = updates.description;
  if (Object.keys(registryUpdates).length > 0) {
    registryUpdates.updated_at = new Date();
    await registryRepo.updateByTrackId(trackId, registryUpdates);
  }

  return exports.cloneSnapshot(trackId, source, overrides);
};

// =============================================================================
// Contents updates
// =============================================================================

/**
 * Replace member contents on the latest snapshot (creates a new snapshot clone).
 *
 * @param {string} trackId
 * @param {Object} contents - { x_mitre_contents: [{ obj_ref, obj_modified }] }
 * @param {string} [_userId]
 * @returns {Promise<Object>} The new snapshot
 */
// eslint-disable-next-line no-unused-vars
exports.updateContents = async function updateContents(trackId, contents, _userId) {
  const source = await exports.getLatestSnapshot(trackId);
  const members = contents.x_mitre_contents.map((c) => ({
    object_ref: c.obj_ref,
    object_modified: c.obj_modified === 'latest' ? new Date() : new Date(c.obj_modified),
  }));
  return exports.cloneSnapshot(trackId, source, { members });
};

/**
 * Replace member contents on a specific snapshot (creates a new snapshot clone).
 *
 * @param {string} trackId
 * @param {string|Date} modified
 * @param {Object} contents - { x_mitre_contents: [{ obj_ref, obj_modified }] }
 * @param {string} [_userId]
 * @returns {Promise<Object>} The new snapshot
 */
exports.updateContentsByModified = async function updateContentsByModified(
  trackId,
  modified,
  contents,
  // eslint-disable-next-line no-unused-vars
  _userId,
) {
  const source = await exports.getSnapshotByModified(trackId, modified);
  const members = contents.x_mitre_contents.map((c) => ({
    object_ref: c.obj_ref,
    object_modified: c.obj_modified === 'latest' ? new Date() : new Date(c.obj_modified),
  }));
  return exports.cloneSnapshot(trackId, source, { members });
};

// =============================================================================
// Configuration
// =============================================================================

/**
 * Get the configuration from the latest snapshot.
 *
 * @param {string} trackId
 * @returns {Promise<Object>} The config sub-document
 */
exports.getConfig = async function getConfig(trackId) {
  const snapshot = await exports.getLatestSnapshot(trackId);
  return snapshot.config || {};
};

/**
 * Update configuration on the latest snapshot (creates a new snapshot clone).
 *
 * Performs a shallow merge at the top level, and a nested merge for
 * the `promotion_conflicts` sub-object.
 *
 * @param {string} trackId
 * @param {Object} config - Partial config to merge
 * @param {string} [_userId]
 * @returns {Promise<Object>} The new snapshot
 */
// eslint-disable-next-line no-unused-vars
exports.updateConfig = async function updateConfig(trackId, config, _userId) {
  const source = await exports.getLatestSnapshot(trackId);
  const existing = source.config || {};

  const mergedConfig = { ...existing };

  if (config.candidacy_threshold !== undefined)
    mergedConfig.candidacy_threshold = config.candidacy_threshold;
  if (config.auto_promote !== undefined) mergedConfig.auto_promote = config.auto_promote;
  if (config.promotion_conflicts !== undefined) {
    mergedConfig.promotion_conflicts = {
      ...(existing.promotion_conflicts || {}),
      ...config.promotion_conflicts,
    };
  }
  if (config.member_sync !== undefined) {
    const existingMemberSync = existing.member_sync || {};
    mergedConfig.member_sync = {
      ...existingMemberSync,
      ...config.member_sync,
    };
    // Nested merge for supplant sub-object
    if (config.member_sync.supplant !== undefined) {
      mergedConfig.member_sync.supplant = {
        ...(existingMemberSync.supplant || {}),
        ...config.member_sync.supplant,
      };
    }
  }

  return exports.cloneSnapshot(trackId, source, { config: mergedConfig });
};

// =============================================================================
// Deletion
// =============================================================================

/**
 * Delete an entire release track (registry entry + all snapshots + collection).
 *
 * @param {string} trackId
 * @throws {TrackNotFoundError} If the track does not exist in the registry
 */
exports.deleteTrack = async function deleteTrack(trackId) {
  const registry = await registryRepo.findByTrackId(trackId);
  if (!registry) {
    throw new TrackNotFoundError(trackId);
  }

  await dynamicRepo.dropCollection(trackId);
  await registryRepo.deleteByTrackId(trackId);

  logger.verbose(`SnapshotService: Deleted track "${trackId}"`);
};

/**
 * Delete a specific snapshot from a track.
 *
 * @param {string} trackId
 * @param {string|Date} modified
 * @throws {NotFoundError} If the snapshot does not exist
 */
exports.deleteSnapshot = async function deleteSnapshot(trackId, modified) {
  const snapshot = await dynamicRepo.getSnapshotByModified(trackId, modified);
  if (!snapshot) {
    throw new NotFoundError({
      details: `Snapshot with modified '${modified}' not found for track '${trackId}'`,
    });
  }

  await dynamicRepo.deleteSnapshot(trackId, modified);
  await syncRegistryCounters(trackId);

  logger.verbose(`SnapshotService: Deleted snapshot '${modified}' from track "${trackId}"`);
};
