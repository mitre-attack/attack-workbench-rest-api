'use strict';

const CreationCause = require('../../lib/release-tracks/snapshot-creation-causes');
const creationActor = require('../../lib/release-tracks/snapshot-creation-actor');

// =============================================================================
// Snapshot Service
//
// Core snapshot lifecycle operations: track creation, retrieval, cloning,
// metadata updates, configuration, and deletion.
//
// Every snapshot references a sealed content manifest from birth. Writes that
// change the members tier seal a new manifest; every other clone inherits
// its predecessor's manifest by reference (see
// docs/developer/release-tracks/sealed-content-manifests.md).
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
const tierRevisionInvariant = require('../../lib/release-tracks/tier-revision-invariant');
const primaryRevisionService = require('./primary-revision-service');
const reconciliationService = require('./reconciliation-service');
const contentManifestService = require('./content-manifest-service');
const publicationService = require('./publication-service');
const {
  DuplicateIdError,
  HistoricalSnapshotDeletionError,
  NotFoundError,
  ReleaseConflictError,
  TaggedSnapshotDeletionError,
  TrackNotFoundError,
} = require('../../exceptions');

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

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

/**
 * Recompute and persist denormalized registry counters from actual snapshot data.
 *
 * @param {string} trackId
 */
async function syncRegistryCounters(trackId) {
  const counters = await dynamicRepo.getSnapshotCounters(trackId);
  await registryRepo.updateByTrackId(trackId, { ...counters, updated_at: new Date() });
}
exports.syncRegistryCounters = syncRegistryCounters;

/**
 * Notify listeners that a track's current (latest) snapshot changed so they
 * can reconcile workspace.release_tracks backrefs on their own documents.
 *
 * Emissions are awaited (request/response blocking): backrefs are consistent
 * by the time the triggering API call returns.
 *
 * @param {string} trackId
 * @param {Object|null} snapshot - The track's latest snapshot, or null when the
 *   track (or its only snapshot) was deleted
 */
async function emitContentsChanged(trackId, snapshot) {
  await reconciliationService.reconcileContentsChanged(trackId, snapshot);
}
exports.emitContentsChanged = emitContentsChanged;

async function findVirtualSnapshotDependents(componentTrackId, componentSnapshotModified) {
  const virtualTracks = (await registryRepo.findAll({ type: 'virtual' })).data;
  const matches = await mapWithConcurrency(virtualTracks, 12, async (track) =>
    dynamicRepo.findSnapshotsResolvingComponent(
      track.track_id,
      componentTrackId,
      componentSnapshotModified,
    ),
  );
  return matches.flat().map((snapshot) => ({
    track_id: snapshot.id,
    track_name: snapshot.name,
    snapshot_modified: snapshot.modified,
    version: snapshot.version ?? null,
  }));
}
exports.findVirtualSnapshotDependents = findVirtualSnapshotDependents;

/**
 * Seal a manifest for a snapshot that is about to be saved, then persist the
 * snapshot referencing it. The manifest is discarded if the save fails, so a
 * snapshot is never observable without its content manifest.
 *
 * @param {string} trackId
 * @param {Object} snapshotData - Snapshot to save (members already final)
 * @param {string} reason - seal_reason enum value
 * @returns {Promise<Object>} The saved snapshot
 */
async function saveSealedSnapshot(trackId, snapshotData, reason, lease) {
  const manifestId = await contentManifestService.seal(snapshotData, { reason });
  let saved;
  try {
    if (lease) await lease.assertOwned();
    saved = await dynamicRepo.saveSnapshot(trackId, {
      ...snapshotData,
      content_manifest_id: manifestId,
    });
  } catch (err) {
    await contentManifestService.discard(manifestId);
    throw err;
  }
  await contentManifestService.activate(manifestId);
  return saved;
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
        scheduled_materialization: summary?.scheduled_materialization,
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
 * @param {Object} data - { name, description?, snapshot_description?, type, userAccountId?, composition?, snapshot_schedule?, scheduled_materialization?, config? }
 * @returns {Promise<Object>} The initial snapshot document
 */
exports.createTrack = async function createTrack(data, options = {}) {
  const trackId = `release-track--${uuidv4()}`;
  const now = new Date();
  const trackType = data.type || 'standard';
  if (data.draft_retention !== undefined) {
    require('./draft-cleanup-service').validatePolicy(data.draft_retention, data.actor, trackType);
  }
  if (data.alias) await assertAliasAvailable(data.alias);

  const initialSnapshot = {
    id: trackId,
    creation_cause: options.creationCause || CreationCause.TrackCreated,
    creation_actor: creationActor(data.userAccountId),
    type: trackType,
    modified: now,
    version: null,
    name: data.name,
    description: data.description || '',
    snapshot_description: data.snapshot_description || undefined,
    created: now,
    created_by_ref: data.userAccountId || undefined,
    members: [],
    staged: trackType === 'standard' ? [] : undefined,
    candidates: trackType === 'standard' ? [] : undefined,
    quarantine: trackType === 'virtual' ? [] : undefined,
    composition: trackType === 'virtual' ? data.composition : undefined,
    scheduled_materialization: trackType === 'virtual' ? data.scheduled_materialization : undefined,
    config: data.config || {},
    version_history: [],
  };

  await modelFactory.ensureIndexes(trackId);
  let snapshot;
  if (trackType !== 'virtual') {
    snapshot = await saveSealedSnapshot(trackId, initialSnapshot, 'track_creation');
  }

  await registryRepo.create({
    track_id: trackId,
    type: trackType,
    name: data.name,
    alias: data.alias || undefined,
    description: data.description,
    latest_snapshot_modified: now,
    snapshot_count: snapshot ? 1 : 0,
    tagged_release_count: 0,
    created_at: now,
    updated_at: now,
    snapshot_schedule: trackType === 'virtual' ? data.snapshot_schedule : undefined,
    draft_retention:
      trackType === 'virtual' ? data.draft_retention || { max_drafts: null } : undefined,
  });
  if (trackType === 'virtual') {
    const { withReleaseLock } = require('./versioning-service');
    snapshot = await withReleaseLock(trackId, async (lease) => {
      await require('./draft-cleanup-service').findScheduledResult(
        trackId,
        data.scheduled_materialization,
      );
      await lease.assertOwned();
      const created = await saveSealedSnapshot(trackId, initialSnapshot, 'track_creation', lease);
      await require('./draft-cleanup-service').recordScheduledResult(created);
      await syncRegistryCounters(trackId);
      return created;
    });
  }

  logger.verbose(`SnapshotService: Created ${trackType} track "${data.name}" (${trackId})`);
  return trackType === 'virtual'
    ? { ...snapshot, draft_retention: data.draft_retention || { max_drafts: null } }
    : snapshot;
};

/**
 * An alias must name at most one track. The partial unique index is the
 * backstop; this check turns the common case into a descriptive 409.
 */
async function assertAliasAvailable(alias, trackId) {
  const existing = await registryRepo.findByAlias(alias);
  if (existing && existing.track_id !== trackId) {
    throw new DuplicateIdError(`Release track alias '${alias}' is already in use`, {
      details: { alias, track_id: existing.track_id },
    });
  }
}

/**
 * Resolve an alias to the track ID it names, or null.
 */
exports.resolveTrackAlias = async function resolveTrackAlias(alias) {
  const entry = await registryRepo.findByAlias(alias);
  return entry?.track_id ?? null;
};

/**
 * The alias registered for a track, or null.
 */
exports.getTrackMetadata = async function getTrackMetadata(trackId) {
  const entry = await registryRepo.findByTrackId(trackId);
  return {
    alias: entry?.alias ?? null,
    snapshot_schedule: entry?.snapshot_schedule,
    draft_retention:
      entry?.type === 'virtual' ? entry.draft_retention || { max_drafts: null } : undefined,
    snapshot_count: entry?.snapshot_count,
    tagged_release_count: entry?.tagged_release_count,
  };
};

// =============================================================================
// Snapshot retrieval
// =============================================================================

/**
 * List lightweight summaries of a track's snapshots.
 *
 * Standard summaries expose members/staged/candidates counts. Virtual
 * summaries expose members/quarantine counts plus their immutable composition
 * resolution. Every summary exposes its content manifest ID and counts by
 * manifest entry role.
 *
 * @param {string} trackId
 * @param {Object} options - { tagged?, limit, offset }
 * @returns {Promise<{data: Object[], pagination: Object}>}
 * @throws {TrackNotFoundError} If the release track does not exist
 */
exports.listSnapshots = async function listSnapshots(trackId, options) {
  const track = await registryRepo.findByTrackId(trackId);
  if (!track) {
    throw new TrackNotFoundError(trackId);
  }

  const result = await dynamicRepo.getSnapshotSummaries(trackId, options);
  const statisticsByManifestId = await contentManifestService.getStatisticsByManifestIds(
    result.data.map((snapshot) => snapshot.content_manifest_id),
  );
  return {
    ...result,
    data: result.data.map((snapshot) => {
      const common = {
        id: snapshot.id,
        type: snapshot.type,
        modified: snapshot.modified,
        version: snapshot.version,
        content_manifest_id: snapshot.content_manifest_id,
        bundle_id: snapshot.bundle_id,
        bundle_hashes: snapshot.bundle_hashes,
        release_source_modified: snapshot.release_source_modified,
        snapshot_description: snapshot.snapshot_description,
        creation_cause: snapshot.creation_cause || CreationCause.Unknown,
        creation_actor: snapshot.creation_actor || { kind: 'unknown' },
        content_statistics: snapshot.content_manifest_id
          ? statisticsByManifestId.get(snapshot.content_manifest_id)
          : undefined,
        name: snapshot.name,
        description: snapshot.description,
        members_count: snapshot.members_count,
      };

      if (snapshot.type === 'virtual') {
        const compositionResolution = snapshot.composition_resolution;
        return {
          ...common,
          scheduled_materialization: snapshot.scheduled_materialization,
          composition_resolution:
            compositionResolution == null
              ? compositionResolution
              : {
                  resolved_at: compositionResolution.resolved_at,
                  component_snapshots: compositionResolution.component_snapshots,
                },
          quarantine_count: snapshot.quarantine_count,
        };
      }

      return {
        ...common,
        staged_count: snapshot.staged_count,
        candidates_count: snapshot.candidates_count,
      };
    }),
  };
};

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
 * A clone that rewrites `members` seals a new content manifest; any other
 * clone inherits the source snapshot's manifest by reference.
 *
 * @param {string} trackId - The track to save the clone into
 * @param {Object} sourceSnapshot - The snapshot to clone
 * @param {Object} [overrides] - Fields to merge into the clone
 * @param {Object} [options]
 * @param {string} [options.sealReason] - seal_reason when members are rewritten
 * @returns {Promise<Object>} The saved clone
 */
exports.cloneSnapshot = async function cloneSnapshot(
  trackId,
  sourceSnapshot,
  overrides,
  options = {},
) {
  if (options.lease) return cloneSnapshotUnlocked(trackId, sourceSnapshot, overrides, options);
  const { withReleaseLock } = require('./versioning-service');
  return withReleaseLock(trackId, (lease) =>
    cloneSnapshotUnlocked(trackId, sourceSnapshot, overrides, { ...options, lease }),
  );
};

async function cloneSnapshotUnlocked(trackId, sourceSnapshot, overrides, options) {
  await options.lease.assertOwned();
  if (sourceSnapshot.type === 'virtual') {
    const existing = await require('./draft-cleanup-service').findScheduledResult(
      trackId,
      overrides?.scheduled_materialization,
    );
    if (existing) return existing;
    // Direct callers must not resurrect a source removed while acquiring the lock.
    await exports.getSnapshotByModified(trackId, sourceSnapshot.modified);
  }
  const clone = deepClone(sourceSnapshot);
  const hasSnapshotDescriptionOverride = Object.prototype.hasOwnProperty.call(
    overrides || {},
    'snapshot_description',
  );
  const rewritesMembers = overrides?.members !== undefined;
  delete clone.publication;
  delete clone.bundle_id;
  delete clone.bundle_hashes;
  delete clone.release_event_id;
  delete clone.draft_retention;
  delete clone.draft_cleanup;
  clone.modified = new Date(Math.max(Date.now(), new Date(sourceSnapshot.modified).getTime() + 1));
  clone.version = null; // clones are always drafts
  delete clone.scheduled_materialization;

  // A rolling draft keeps its note as content changes replace that draft. A
  // new release cycle cloned from a tagged snapshot starts without the prior
  // release's note unless the caller explicitly supplies one.
  if (sourceSnapshot.version != null && !hasSnapshotDescriptionOverride) {
    delete clone.snapshot_description;
  }

  // Apply overrides
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (key === 'snapshot_description' && (value === undefined || value === '')) {
        delete clone.snapshot_description;
        continue;
      }
      if (value !== undefined) {
        clone[key] = value;
      }
    }
  }

  // Never inherit provenance or accept it from snapshot overrides.
  clone.creation_cause = options.creationCause || CreationCause.Unknown;
  clone.creation_actor = creationActor(options.userAccountId);
  const normalized = tierRevisionInvariant.normalizeSnapshot(clone);
  await options.lease.assertOwned();
  const cleanupIntent =
    normalized.snapshot.type === 'virtual'
      ? await require('./draft-cleanup-service').prepareRetention(
          normalized.snapshot,
          options.lease,
        )
      : null;
  let saved;
  try {
    if (rewritesMembers || !normalized.snapshot.content_manifest_id) {
      saved = await saveSealedSnapshot(
        trackId,
        normalized.snapshot,
        options.sealReason || 'members_written',
        options.lease,
      );
    } else {
      saved = await dynamicRepo.saveSnapshot(trackId, normalized.snapshot);
    }

    if (saved.type === 'standard') {
      // Materialization holds this same track's release lock until provenance
      // is persisted, so this scan cannot miss a concurrently created dependent.
      const virtualTracks = (await registryRepo.findAll({ type: 'virtual' })).data;
      const referencedDrafts = await mapWithConcurrency(virtualTracks, 12, (track) =>
        dynamicRepo.findResolvedComponentSnapshotIds(track.track_id, trackId),
      );
      const prunedDrafts = await dynamicRepo.deleteOlderDrafts(
        trackId,
        saved.modified,
        referencedDrafts.flat(),
      );
      await contentManifestService.discardUnreferenced(
        trackId,
        prunedDrafts.map((snapshot) => snapshot.content_manifest_id),
      );
    }
    await syncRegistryCounters(trackId);

    // The clone (modified = now) is the track's new latest snapshot
    await emitContentsChanged(trackId, saved);
    if (saved.type === 'virtual') {
      await require('./draft-cleanup-service').recordScheduledResult(saved);
      saved = await require('./draft-cleanup-service').afterDraft(
        saved,
        options.lease,
        cleanupIntent,
      );
    }
  } catch (error) {
    if (!cleanupIntent) throw error;
    const persisted = saved || (await dynamicRepo.getSnapshotByModified(trackId, clone.modified));
    if (!persisted) throw error;
    return require('./draft-cleanup-service').failDraft(persisted, cleanupIntent, error);
  }

  if (normalized.removed.length > 0) {
    logger.warn(
      `SnapshotService: Removed ${normalized.removed.length} exact cross-tier revision ` +
        `duplicate(s) while cloning track "${trackId}"`,
    );
  }
  logger.verbose(`SnapshotService: Cloned snapshot for track "${trackId}"`);
  return saved;
}

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
  return require('./versioning-service').withReleaseLock(trackId, async (lease) => {
    const source = await exports.getLatestSnapshot(trackId);
    await lease.assertOwned();
    return _cloneToNewTrack(source, { ...options, lease });
  });
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
  return require('./versioning-service').withReleaseLock(trackId, async (lease) => {
    const source = await exports.getSnapshotByModified(trackId, modified);
    await lease.assertOwned();
    return _cloneToNewTrack(source, { ...options, lease });
  });
};

/**
 * Internal: create a new track from a source snapshot.
 */
async function _cloneToNewTrack(sourceSnapshot, options = {}) {
  const newTrackId = `release-track--${uuidv4()}`;
  const now = new Date();

  const clone = deepClone(sourceSnapshot);
  delete clone.content_manifest_id;
  delete clone.publication;
  delete clone.bundle_id;
  delete clone.bundle_hashes;
  delete clone.release_event_id;
  delete clone.draft_retention;
  delete clone.draft_cleanup;
  clone.id = newTrackId;
  clone.creation_cause = CreationCause.TrackCloned;
  clone.creation_actor = creationActor(options.userAccountId);
  clone.modified = now;
  clone.version = null;
  clone.name = options.name || `${sourceSnapshot.name} (copy)`;
  clone.created = now;
  clone.created_by_ref = options.userAccountId || sourceSnapshot.created_by_ref;
  clone.version_history = [];
  delete clone.scheduled_materialization;
  delete clone.snapshot_description;
  // Collection identity belongs to the source lineage; the copy derives its
  // own and inherits the remaining publication rules.
  if (clone.config?.publication) {
    delete clone.config.publication.collection_id;
    delete clone.config.publication.created;
  }

  const normalized = tierRevisionInvariant.normalizeSnapshot(clone);
  await primaryRevisionService.assertStoredEntries(
    tierRevisionInvariant.TIER_PRECEDENCE.flatMap((tier) => normalized.snapshot[tier] || []),
  );

  await modelFactory.ensureIndexes(newTrackId);
  const saved = await saveSealedSnapshot(
    newTrackId,
    normalized.snapshot,
    'track_clone',
    options.lease,
  );

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
    draft_retention: sourceSnapshot.type === 'virtual' ? { max_drafts: null } : undefined,
  });

  // The new track's initial snapshot carries the source track's contents
  await emitContentsChanged(newTrackId, saved);

  if (normalized.removed.length > 0) {
    logger.warn(
      `SnapshotService: Removed ${normalized.removed.length} exact cross-tier revision ` +
        `duplicate(s) while cloning new track "${newTrackId}"`,
    );
  }
  logger.verbose(`SnapshotService: Cloned track to new track "${clone.name}" (${newTrackId})`);
  return saved;
}

// =============================================================================
// Metadata updates
// =============================================================================

/**
 * Update metadata on the latest snapshot (creates a new snapshot clone).
 *
 * Name and description live on the snapshot and in the registry, so changing
 * either clones a new draft. The alias is registry-only routing metadata: an
 * alias-only update leaves the snapshot history untouched and returns the
 * latest snapshot unchanged.
 *
 * @param {string} trackId
 * @param {Object} updates - { name?, description?, alias? } (alias null clears)
 * @param {string} [userId] - Invoking snapshot creator
 * @returns {Promise<Object>} The new (or, for alias-only updates, latest) snapshot
 */

exports.updateMetadata = async function updateMetadata(trackId, updates, userId) {
  return require('./versioning-service').withReleaseLock(trackId, async (lease) => {
    const source = await exports.getLatestSnapshot(trackId);
    const overrides = {};
    if (updates.name !== undefined) overrides.name = updates.name;
    if (updates.description !== undefined) overrides.description = updates.description;

    if (updates.alias !== undefined) {
      if (updates.alias) await assertAliasAvailable(updates.alias, trackId);
      await registryRepo.setAlias(trackId, updates.alias);
    }

    // Also update the registry name/description if changed
    const registryUpdates = {};
    if (updates.name !== undefined) registryUpdates.name = updates.name;
    if (updates.description !== undefined) registryUpdates.description = updates.description;
    if (Object.keys(registryUpdates).length > 0) {
      registryUpdates.updated_at = new Date();
      await registryRepo.updateByTrackId(trackId, registryUpdates);
    }

    if (Object.keys(overrides).length === 0) return source;
    return exports.cloneSnapshot(trackId, source, overrides, {
      creationCause: CreationCause.MetadataUpdated,
      userAccountId: userId,
      lease,
    });
  });
};

/**
 * Set or clear a draft snapshot's description without changing its identity
 * or contents.
 *
 * Snapshot descriptions become the emitted collection object's description.
 * A tagged snapshot is immutable, notes included, so its description can only
 * be set while releasing.
 *
 * @param {string} trackId
 * @param {string|Date} modified
 * @param {string} description
 * @returns {Promise<Object>}
 */
exports.updateSnapshotDescription = async function updateSnapshotDescription(
  trackId,
  modified,
  description,
) {
  const snapshot = await exports.getSnapshotByModified(trackId, modified);
  if (snapshot.version != null) {
    throw new ReleaseConflictError('Snapshot notes are immutable once the snapshot is released.', {
      track_id: trackId,
      snapshot_modified: new Date(snapshot.modified).toISOString(),
      version: snapshot.version,
    });
  }
  const sourceRelease = await dynamicRepo.getReleaseBySourceModified(trackId, snapshot.modified);
  if (sourceRelease) {
    throw new ReleaseConflictError(
      'Snapshot notes cannot change while the draft is retained as a release rollback point.',
      {
        track_id: trackId,
        snapshot_modified: new Date(snapshot.modified).toISOString(),
        release_version: sourceRelease.version,
        release_snapshot_modified: new Date(sourceRelease.modified).toISOString(),
      },
    );
  }

  const update = description
    ? { $set: { snapshot_description: description } }
    : { $unset: { snapshot_description: '' } };
  const updated = await dynamicRepo.updateSnapshot(trackId, modified, update);

  if (!updated) {
    throw new NotFoundError({
      details: `Snapshot with modified '${modified}' not found for track '${trackId}'`,
    });
  }
  return updated.toObject ? updated.toObject() : updated;
};

// =============================================================================
// Configuration
// =============================================================================

/**
 * Get the configuration from the latest snapshot, including the currently
 * resolved publication values and where each one comes from.
 *
 * @param {string} trackId
 * @returns {Promise<Object>} The config sub-document plus publication_resolved
 */
exports.getConfig = async function getConfig(trackId) {
  const snapshot = await exports.getLatestSnapshot(trackId);
  const metadata = await exports.getTrackMetadata(trackId);
  const config = JSON.parse(JSON.stringify(snapshot.config || {}));
  const resolved = await publicationService.resolvePublication(snapshot);
  return {
    ...config,
    publication_resolved: resolved,
    ...(snapshot.type === 'virtual' ? { draft_retention: metadata.draft_retention } : {}),
  };
};

/**
 * Update configuration on the latest snapshot (creates a new snapshot clone).
 *
 * Performs a shallow merge at the top level, and a nested merge for
 * the `promotion_conflicts`, `member_sync`, and `publication` sub-objects.
 *
 * @param {string} trackId
 * @param {Object} config - Partial config to merge
 * @param {string} [userId] - Invoking snapshot creator
 * @returns {Promise<Object>} The new snapshot
 */

exports.updateConfig = async function updateConfig(trackId, config, userId) {
  return require('./versioning-service').withReleaseLock(trackId, async (lease) => {
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
    if (config.publication !== undefined) {
      const hasReleases = (source.version_history || []).length > 0;
      mergedConfig.publication = publicationService.mergePublicationConfig(
        existing.publication,
        config.publication,
        hasReleases,
      );
    }

    return exports.cloneSnapshot(
      trackId,
      source,
      { config: mergedConfig },
      { creationCause: CreationCause.ConfigurationUpdated, userAccountId: userId, lease },
    );
  });
};

// =============================================================================
// Source-attested manifest reconstruction (administrative)
// =============================================================================

/**
 * Replace a tagged snapshot's content manifest with one reconstructed from an
 * externally verified source bundle.
 *
 * Repeating the same attestation is idempotent. Any other manifest is
 * replaced only when the caller names it in `replace_manifest_id`, so a
 * concurrent change is never silently overwritten.
 *
 * @param {string} trackId
 * @param {string|Date} modified
 * @param {Object} plan - Validated reconstruction request
 * @returns {Promise<{ snapshot: Object, created: boolean }>}
 */
exports.reconstructManifest = async function reconstructManifest(trackId, modified, plan) {
  const snapshot = await dynamicRepo.getSnapshotByModified(trackId, modified);
  if (!snapshot) {
    throw new NotFoundError({
      details: `Snapshot with modified '${modified}' not found for track '${trackId}'`,
    });
  }
  if (snapshot.version == null) {
    throw new ReleaseConflictError('Only tagged snapshots can be reconstructed from a source', {
      track_id: trackId,
      snapshot_modified: new Date(snapshot.modified).toISOString(),
    });
  }

  const currentManifestId = snapshot.content_manifest_id;
  if (
    await contentManifestService.isSameSourceReconstruction(
      currentManifestId,
      plan.source_attestation,
    )
  ) {
    return { snapshot, created: false };
  }
  if (plan.replace_manifest_id !== currentManifestId) {
    throw new ReleaseConflictError(
      'Snapshot already has a content manifest that was not reconstructed from this source. ' +
        'Name it in replace_manifest_id to replace it.',
      {
        track_id: trackId,
        snapshot_modified: new Date(snapshot.modified).toISOString(),
        content_manifest_id: currentManifestId,
      },
    );
  }

  const manifestId = await contentManifestService.prepareSourceReconstruction(snapshot, plan);
  const replaced = await dynamicRepo.replaceContentManifest(
    trackId,
    snapshot.modified,
    currentManifestId,
    manifestId,
  );
  if (!replaced) {
    await contentManifestService.discard(manifestId);
    throw new ReleaseConflictError('Snapshot changed while its manifest was being reconstructed', {
      track_id: trackId,
      snapshot_modified: new Date(snapshot.modified).toISOString(),
    });
  }
  await contentManifestService.activate(manifestId);
  await contentManifestService.discardUnreferenced(trackId, [currentManifestId]);

  const versioningService = require('./versioning-service');
  const hashed = await versioningService.refreshReleaseArtifacts(replaced);
  return { snapshot: hashed, created: true };
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
exports.deleteTrack = async function deleteTrack(trackId, lease) {
  if (!lease) {
    return require('./versioning-service').withReleaseLock(trackId, (heldLease) =>
      exports.deleteTrack(trackId, heldLease),
    );
  }
  const registry = await registryRepo.findByTrackId(trackId);
  if (!registry) {
    // A previous delete may have removed the registry only after dropping the
    // dynamic snapshot collection but stopped before manifest cleanup.
    await contentManifestService.discardTrack(trackId);
    throw new TrackNotFoundError(trackId);
  }

  if (registry.type === 'virtual') {
    let cursor;
    for (;;) {
      await lease.assertOwned();
      const scheduled = await dynamicRepo.getScheduledSnapshotBatch(trackId, cursor);
      if (!scheduled.length) break;
      for (const snapshot of scheduled) {
        await require('./draft-cleanup-service').recordScheduledResult(snapshot);
      }
      cursor = scheduled.at(-1).modified;
    }
  }
  await lease.assertOwned();
  await dynamicRepo.dropCollection(trackId);
  await contentManifestService.discardTrack(trackId, () => lease.assertOwned());
  await registryRepo.deleteByTrackId(trackId);

  // Remove all backrefs to the deleted track
  await emitContentsChanged(trackId, null);

  logger.verbose(`SnapshotService: Deleted track "${trackId}"`);
};

/**
 * Convert the track's most recent release back to a draft.
 *
 * Only the newest tagged snapshot may be converted, so the version order of the
 * remaining releases and the provenance of any later release are never
 * disturbed. The release's ledger entry is retracted from every remaining
 * snapshot (the ledger is copied forward into clones), its manifest is
 * discarded when nothing else references it, and the registry catalogue is
 * reconciled. Later drafts survive.
 *
 * @param {string} trackId
 * @param {string|Date} modified
 * @returns {Promise<Object>} The restored draft snapshot
 */
exports.convertReleaseToDraft = async function convertReleaseToDraft(trackId, modified) {
  const snapshot = await exports.getSnapshotByModified(trackId, modified);
  if (snapshot.version == null) {
    throw new ReleaseConflictError('The selected snapshot is not a release', {
      track_id: trackId,
      snapshot_modified: new Date(snapshot.modified).toISOString(),
    });
  }
  const latestTagged = await dynamicRepo.getLatestTaggedSnapshot(trackId);
  if (
    !latestTagged ||
    new Date(latestTagged.modified).getTime() !== new Date(snapshot.modified).getTime()
  ) {
    throw new ReleaseConflictError(
      'Only the most recent release of a track can be converted to a draft; convert later releases first.',
      {
        track_id: trackId,
        snapshot_modified: new Date(snapshot.modified).toISOString(),
        version: snapshot.version,
        latest_version: latestTagged?.version ?? null,
      },
    );
  }

  let draft;
  if (snapshot.type === 'standard') {
    if (!snapshot.release_source_modified) {
      throw new ReleaseConflictError(
        'This release predates preserved source drafts and cannot be rolled back.',
        {
          track_id: trackId,
          snapshot_modified: new Date(snapshot.modified).toISOString(),
          version: snapshot.version,
        },
      );
    }
    draft = await dynamicRepo.getSnapshotByModified(trackId, snapshot.release_source_modified);
    if (!draft || draft.version != null) {
      throw new ReleaseConflictError('The preserved source draft is missing or no longer a draft', {
        track_id: trackId,
        snapshot_modified: new Date(snapshot.modified).toISOString(),
      });
    }
  }
  await assertNoVirtualDependents(trackId, snapshot.modified);

  if (snapshot.type === 'standard') {
    // The tagged clone is retired; the exact source draft remains untouched.
    await dynamicRepo.deleteSnapshot(trackId, snapshot.modified);
  } else {
    // Virtual tagging was in-place, so conversion keeps identity, manifest,
    // composition resolution, notes, and immutable creation provenance.
    await dynamicRepo.updateSnapshot(trackId, snapshot.modified, {
      $set: { version: null },
      $unset: { publication: '', bundle_id: '', bundle_hashes: '', release_event_id: '' },
    });
    draft = snapshot;
  }
  await dynamicRepo.pullVersionHistory(trackId, snapshot.version);
  await contentManifestService.discardUnreferenced(trackId, [snapshot.content_manifest_id]);
  const releaseHistoryService = require('./release-history-service');
  await releaseHistoryService.reconcileTaggedReleases(trackId);
  await syncRegistryCounters(trackId);

  const latest = await dynamicRepo.getLatestSnapshot(trackId);
  await emitContentsChanged(trackId, latest);

  logger.verbose(
    `SnapshotService: Converted release v${snapshot.version} (${modified}) to draft in track "${trackId}"`,
  );
  return dynamicRepo.getSnapshotByModified(trackId, draft.modified);
};

async function assertNoVirtualDependents(trackId, modified) {
  const dependents = await findVirtualSnapshotDependents(trackId, modified);
  if (dependents.length) {
    throw new ReleaseConflictError('Virtual track snapshots depend on this snapshot', {
      track_id: trackId,
      snapshot_modified: new Date(modified).toISOString(),
      dependent_snapshots: dependents,
    });
  }
}

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
    // Make a retry after an interrupted delete clean any orphaned manifests
    // even though the snapshot document is already gone.
    await contentManifestService.discardOrphans(trackId);
    throw new NotFoundError({
      details: `Snapshot with modified '${modified}' not found for track '${trackId}'`,
    });
  }

  if (snapshot.version != null) {
    throw new TaggedSnapshotDeletionError(snapshot.version);
  }

  if (await dynamicRepo.getReleaseBySourceModified(trackId, snapshot.modified)) {
    throw new ReleaseConflictError('This draft is the preserved source of a tagged release', {
      track_id: trackId,
      snapshot_modified: new Date(snapshot.modified).toISOString(),
    });
  }
  await assertNoVirtualDependents(trackId, snapshot.modified);

  const latest = await dynamicRepo.getLatestSnapshot(trackId);
  if (!latest || new Date(latest.modified).getTime() !== new Date(snapshot.modified).getTime()) {
    throw new HistoricalSnapshotDeletionError(snapshot.modified, latest?.modified);
  }

  const predecessor = await dynamicRepo.getLatestSnapshotBefore(trackId, snapshot.modified);
  if (!predecessor) {
    throw new ReleaseConflictError('The only snapshot in a release track cannot be deleted', {
      track_id: trackId,
      snapshot_modified: new Date(snapshot.modified).toISOString(),
    });
  }
  await require('./draft-cleanup-service').recordScheduledResult(snapshot);

  await dynamicRepo.deleteSnapshot(trackId, modified);
  await contentManifestService.discardUnreferenced(trackId, [snapshot.content_manifest_id]);
  await syncRegistryCounters(trackId);

  // Deleting the latest snapshot reverts membership to the previous snapshot
  // (or clears it if no snapshots remain)
  const revertedLatest = await dynamicRepo.getLatestSnapshot(trackId);
  await emitContentsChanged(trackId, revertedLatest);

  logger.verbose(`SnapshotService: Deleted snapshot '${modified}' from track "${trackId}"`);
};
