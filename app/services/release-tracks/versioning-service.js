'use strict';
const CreationCause = require('../../lib/release-tracks/snapshot-creation-causes');
const creationActor = require('../../lib/release-tracks/snapshot-creation-actor');

// Plans and commits immutable releases from release-track snapshots. Planning
// is side-effect free; persistence, reconciliation, and events occur only in
// the commit path.

const snapshotService = require('./snapshot-service');
const dynamicRepo = require('../../repository/release-tracks/release-track-dynamic.repository');
const versionUtils = require('../../lib/release-tracks/version-utils');
const conflictResolution = require('../../lib/release-tracks/conflict-resolution');
const tierRevisionInvariant = require('../../lib/release-tracks/tier-revision-invariant');
const revisionReference = require('../../lib/release-tracks/revision-reference');
const releaseHistoryService = require('./release-history-service');
const primaryRevisionService = require('./primary-revision-service');
const contentManifestService = require('./content-manifest-service');
const publicationService = require('./publication-service');
const bundleHashService = require('./bundle-hash-service');
const registryRepo = require('../../repository/release-tracks/release-track-registry.repository');
const uuid = require('uuid');
const logger = require('../../lib/logger');
const {
  AlreadyReleasedError,
  ReleaseConflictError,
  TrackNotFoundError,
  VirtualSnapshotNotMaterializedError,
} = require('../../exceptions');

const RELEASE_LOCK_TIMEOUT_MS = 15 * 60 * 1000;

function iso(value) {
  return new Date(value).toISOString();
}

function tierCounts(snapshot) {
  if (snapshot.type === 'virtual') {
    return {
      members_count: (snapshot.members || []).length,
      quarantine_count: (snapshot.quarantine || []).length,
    };
  }

  return {
    members_count: (snapshot.members || []).length,
    staged_count: (snapshot.staged || []).length,
    candidates_count: (snapshot.candidates || []).length,
  };
}

function memberRevisions(snapshot) {
  const revisionsByObject = new Map();
  for (const member of snapshot?.members || []) {
    const revisions = revisionsByObject.get(member.object_ref) || new Set();
    revisions.add(iso(member.object_modified));
    revisionsByObject.set(member.object_ref, revisions);
  }
  return revisionsByObject;
}

function sameRevisions(left, right) {
  if (left.size !== right.size) return false;
  for (const revision of left) {
    if (!right.has(revision)) return false;
  }
  return true;
}

function virtualReleaseChanges(previousSnapshot, draftSnapshot) {
  const previous = memberRevisions(previousSnapshot);
  const draft = memberRevisions(draftSnapshot);
  let newCount = 0;
  let updatedCount = 0;
  let removedCount = 0;

  for (const [objectRef, revisions] of draft) {
    const previousRevisions = previous.get(objectRef);
    if (!previousRevisions) {
      newCount++;
    } else if (!sameRevisions(revisions, previousRevisions)) {
      updatedCount++;
    }
  }

  for (const objectRef of previous.keys()) {
    if (!draft.has(objectRef)) removedCount++;
  }

  return {
    new_count: newCount,
    updated_count: updatedCount,
    removed_count: removedCount,
    quarantined_count: (draftSnapshot.quarantine || []).length,
  };
}

/**
 * Capture the component versions frozen into a materialized virtual draft,
 * using null for draft sources. Track IDs are stable provenance keys;
 * component names are descriptive metadata and may change or collide.
 */
function virtualComponentVersions(snapshot) {
  return Object.fromEntries(
    (snapshot.composition_resolution?.component_snapshots || []).map((component) => [
      component.track_id,
      component.resolved_version ?? null,
    ]),
  );
}

/**
 * Build the complete release plan without reading or writing external state.
 *
 * @param {string} trackId
 * @param {Object} sourceSnapshot
 * @param {Array<Object>} versionHistory
 * @param {Object} options
 * @param {Date} now
 * @param {Object|null} previousTaggedSnapshot
 * @returns {Object}
 */
function planRelease(
  trackId,
  sourceSnapshot,
  versionHistory,
  options = {},
  now = new Date(),
  previousTaggedSnapshot = null,
) {
  if (sourceSnapshot.version != null) {
    throw new AlreadyReleasedError(sourceSnapshot.version);
  }
  if (sourceSnapshot.type === 'virtual' && sourceSnapshot.composition_resolution == null) {
    throw new VirtualSnapshotNotMaterializedError(trackId, {
      details:
        'Create a persisted draft with POST /api/release-tracks/:id/virtual/snapshots/create before previewing or releasing it',
    });
  }
  if (
    sourceSnapshot.type === 'standard' &&
    (sourceSnapshot.staged || []).some((entry) => revisionReference.isLatest(entry.object_modified))
  ) {
    throw new TypeError('Standard release planning requires resolved staged revisions');
  }

  const normalized = tierRevisionInvariant.normalizeSnapshot(sourceSnapshot);
  const snapshot = normalized.snapshot;
  const releaseModified =
    sourceSnapshot.type === 'standard'
      ? new Date(Math.max(now.getTime(), new Date(sourceSnapshot.modified).getTime() + 1))
      : sourceSnapshot.modified;
  const version = versionUtils.calculateNextVersion(
    versionHistory,
    options.increment,
    options.version,
    releaseModified,
  );
  versionUtils.validateVersionProgression(version, versionHistory, releaseModified);
  const versionBounds = versionUtils.findVersionBounds(versionHistory, releaseModified);

  const isVirtual = snapshot.type === 'virtual';
  const before = isVirtual
    ? previousTaggedSnapshot
      ? tierCounts(previousTaggedSnapshot)
      : { members_count: 0, quarantine_count: 0 }
    : tierCounts(snapshot);
  const staged = snapshot.type === 'standard' ? snapshot.staged || [] : [];
  const existingMembers = snapshot.members || [];
  let mergedMembers = existingMembers;
  let blockingError;

  if (staged.length > 0) {
    const incoming = staged.map(({ object_ref, object_modified }) => ({
      object_ref,
      object_modified,
    }));
    const policy = snapshot.config?.promotion_conflicts?.staged_to_members || 'abort';

    try {
      mergedMembers = conflictResolution.applyConflictPolicy(
        existingMembers,
        incoming,
        policy,
      ).merged;
    } catch (err) {
      if (!(err instanceof ReleaseConflictError)) throw err;
      blockingError = err;
    }
  }

  const additionalOps = {};
  for (const tier of normalized.changedTiers) {
    additionalOps[tier] = snapshot[tier];
  }
  if (staged.length > 0 && !blockingError) {
    additionalOps.members = mergedMembers;
    additionalOps.staged = [];
  }
  const updatesSnapshotDescription = options.description !== undefined;
  if (updatesSnapshotDescription && options.description) {
    additionalOps.snapshot_description = options.description;
  }

  const afterSnapshot = {
    ...snapshot,
    modified: releaseModified,
    version,
    ...(sourceSnapshot.type === 'standard'
      ? {
          release_source_modified: sourceSnapshot.modified,
          creation_cause: CreationCause.ReleaseTagged,
          creation_actor: creationActor(options.userAccountId || 'system'),
        }
      : {}),
    members: mergedMembers,
    ...(updatesSnapshotDescription && options.description
      ? { snapshot_description: options.description }
      : {}),
    ...(snapshot.type === 'standard' ? { staged: [] } : {}),
  };
  if (updatesSnapshotDescription && !options.description) {
    delete afterSnapshot.snapshot_description;
  }
  const after = tierCounts(afterSnapshot);
  const changes = isVirtual
    ? virtualReleaseChanges(previousTaggedSnapshot, afterSnapshot)
    : {
        promoted_count: blockingError ? 0 : staged.length,
      };
  const versionHistoryEntry = {
    version,
    tagged_at: now,
    tagged_by: options.userAccountId || 'system',
    snapshot_id: releaseModified,
    summary: {
      ...after,
      promoted_count: blockingError ? 0 : staged.length,
    },
    component_versions: isVirtual ? virtualComponentVersions(snapshot) : undefined,
  };
  const plannedSnapshot = blockingError
    ? null
    : {
        ...afterSnapshot,
        version_history: [...(snapshot.version_history || []), versionHistoryEntry],
      };

  return {
    trackId,
    sourceSnapshot,
    plannedSnapshot,
    version,
    versionHistoryEntry,
    additionalOps,
    clearSnapshotDescription: updatesSnapshotDescription && !options.description,
    normalizedRemoved: normalized.removed,
    blockingError,
    summary: {
      track_id: trackId,
      type: snapshot.type,
      source_snapshot_modified: iso(sourceSnapshot.modified),
      release_snapshot_modified: iso(releaseModified),
      version,
      version_bounds: {
        lower: versionBounds.lower
          ? {
              version: versionBounds.lower.version,
              modified: iso(versionBounds.lower.modified),
            }
          : null,
        upper: versionBounds.upper
          ? {
              version: versionBounds.upper.version,
              modified: iso(versionBounds.upper.modified),
            }
          : null,
      },
      releasable: !blockingError,
      ...(isVirtual
        ? {
            previous_release: previousTaggedSnapshot
              ? {
                  version: previousTaggedSnapshot.version,
                  modified: iso(previousTaggedSnapshot.modified),
                }
              : null,
          }
        : {}),
      before,
      after: blockingError ? before : after,
      changes,
      conflicts: blockingError?.conflicts || [],
    },
  };
}

async function planLoadedSnapshot(trackId, snapshot, options) {
  if (snapshot.type === 'standard') {
    const existingRelease = await dynamicRepo.getReleaseBySourceModified(
      trackId,
      snapshot.modified,
    );
    if (existingRelease) {
      throw new AlreadyReleasedError(existingRelease.version);
    }
  }
  const [versionHistory, previousTaggedSnapshot, resolvedStaged] = await Promise.all([
    releaseHistoryService.getTrackWideVersionHistory(trackId),
    snapshot.type === 'virtual'
      ? dynamicRepo.getLatestTaggedSnapshotBefore(trackId, snapshot.modified)
      : Promise.resolve(null),
    snapshot.type === 'standard'
      ? revisionReference.resolveEntries(snapshot.staged || [])
      : Promise.resolve(snapshot.staged || []),
  ]);
  const releaseInput =
    snapshot.type === 'standard'
      ? {
          ...snapshot,
          staged: resolvedStaged,
        }
      : snapshot;

  await primaryRevisionService.assertStoredEntries([
    ...(releaseInput.members || []),
    ...(releaseInput.staged || []),
  ]);

  const plan = planRelease(
    trackId,
    releaseInput,
    versionHistory,
    options,
    new Date(),
    previousTaggedSnapshot,
  );

  // A standard commit seals a fresh manifest over the planned members, so the
  // preview reports exactly which relationships that seal would add or drop
  // relative to the draft's inherited manifest. Virtual commits publish the
  // materialization manifest unchanged.
  if (!plan.blockingError && snapshot.type === 'standard') {
    plan.summary.relationships = await contentManifestService.previewRelationshipChanges(
      snapshot,
      plan.plannedSnapshot.members,
    );
  }
  return plan;
}

/**
 * Freeze publication metadata, assign a stable bundle ID, and store the
 * SHA-256 hashes of both bundle serializations on a tagged snapshot.
 *
 * @param {Object} tagged - The tagged snapshot (already referencing its manifest)
 * @returns {Promise<Object>} The updated snapshot
 */
async function refreshReleaseArtifacts(tagged) {
  const publication = tagged.publication || (await publicationService.freezePublication(tagged));
  const bundleId = tagged.bundle_id || `bundle--${uuid.v4()}`;
  const withArtifacts = await dynamicRepo.updateSnapshot(tagged.id, tagged.modified, {
    $set: { publication, bundle_id: bundleId },
  });
  const current = withArtifacts?.toObject ? withArtifacts.toObject() : withArtifacts;
  const bundleHashes = await bundleHashService.generateBundleHashes(current);
  const hashed = await dynamicRepo.attachBundleHashes(
    tagged.id,
    tagged.modified,
    current.content_manifest_id,
    bundleHashes,
  );
  if (!hashed) {
    throw new ReleaseConflictError('Snapshot changed while its bundle hashes were generated', {
      track_id: tagged.id,
      snapshot_modified: new Date(tagged.modified).toISOString(),
    });
  }
  return hashed;
}
exports.refreshReleaseArtifacts = refreshReleaseArtifacts;

async function commitPlan(plan) {
  if (plan.blockingError) throw plan.blockingError;

  const source = plan.sourceSnapshot;
  const inheritedManifestId = source.content_manifest_id;
  const unsetOps = {};
  if (plan.clearSnapshotDescription) unsetOps.snapshot_description = '';

  // A standard commit is the moment members are finalized, so it seals a
  // fresh manifest over the planned member set (even when nothing was staged,
  // so relationships added since the last seal are captured). A virtual
  // commit publishes the materialization manifest that was reviewed.
  let sealedManifestId;
  const setOps = { ...plan.additionalOps };
  if (source.type === 'standard') {
    sealedManifestId = await contentManifestService.seal(
      { ...source, members: plan.plannedSnapshot.members },
      { reason: 'release' },
    );
    setOps.content_manifest_id = sealedManifestId;
  }
  setOps.publication = await publicationService.freezePublication(source);
  setOps.bundle_id = `bundle--${uuid.v4()}`;

  let tagged;
  try {
    if (source.type === 'standard') {
      const releaseSnapshot = { ...plan.plannedSnapshot, ...setOps };
      delete releaseSnapshot._id;
      delete releaseSnapshot.__v;
      if (plan.clearSnapshotDescription) delete releaseSnapshot.snapshot_description;
      tagged = await dynamicRepo.saveSnapshot(plan.trackId, releaseSnapshot);
    } else {
      tagged = await dynamicRepo.tagSnapshotInPlace(plan.trackId, source.modified, {
        version: plan.version,
        versionHistoryEntry: plan.versionHistoryEntry,
        additionalOps: setOps,
        unsetOps: Object.keys(unsetOps).length ? unsetOps : undefined,
      });
    }
  } catch (err) {
    await contentManifestService.discard(sealedManifestId);
    throw err;
  }

  if (!tagged) {
    await contentManifestService.discard(sealedManifestId);
    await releaseHistoryService.reconcileTaggedReleases(plan.trackId);
    throw new AlreadyReleasedError('(concurrent release)');
  }

  if (sealedManifestId) {
    await contentManifestService.activate(sealedManifestId);
    await contentManifestService.discardUnreferenced(plan.trackId, [inheritedManifestId]);
  }

  const withArtifacts = await refreshReleaseArtifacts(tagged);

  await releaseHistoryService.reconcileTaggedReleases(plan.trackId);
  if (source.type === 'standard') {
    await snapshotService.syncRegistryCounters(plan.trackId);
  }
  const latest = await dynamicRepo.getLatestSnapshot(plan.trackId);
  await snapshotService.emitContentsChanged(plan.trackId, latest);

  logger.verbose(
    `VersioningService: Released track "${plan.trackId}" as v${plan.version} ` +
      `(promoted ${plan.summary.changes.promoted_count} staged → members)`,
  );
  if (plan.normalizedRemoved.length > 0) {
    logger.warn(
      `VersioningService: Removed ${plan.normalizedRemoved.length} exact cross-tier revision ` +
        `duplicate(s) while releasing track "${plan.trackId}"`,
    );
  }

  return withArtifacts;
}

async function withReleaseLock(trackId, operation) {
  const token = uuid.v4();
  const acquiredAt = new Date();
  const staleBefore = new Date(acquiredAt.getTime() - RELEASE_LOCK_TIMEOUT_MS);
  const lock = await registryRepo.acquireReleaseLock(trackId, token, acquiredAt, staleBefore);
  if (!lock) {
    if (!(await registryRepo.findByTrackId(trackId))) {
      throw new TrackNotFoundError(trackId);
    }
    throw new ReleaseConflictError('Another release operation is already in progress', {
      track_id: trackId,
    });
  }

  try {
    return await operation();
  } finally {
    try {
      await registryRepo.releaseReleaseLock(trackId, token);
    } catch (err) {
      logger.error(
        `VersioningService: Failed to release version lock for "${trackId}": ${err.message}`,
      );
    }
  }
}

exports.planRelease = planRelease;
exports.withReleaseLock = withReleaseLock;
exports._private = {
  memberRevisions,
  sameRevisions,
  virtualComponentVersions,
  virtualReleaseChanges,
};

exports.planLatestRelease = async function planLatestRelease(trackId, options = {}) {
  const snapshot = await snapshotService.getLatestSnapshot(trackId);
  return planLoadedSnapshot(trackId, snapshot, options);
};

exports.planReleaseByModified = async function planReleaseByModified(
  trackId,
  modified,
  options = {},
) {
  const snapshot = await snapshotService.getSnapshotByModified(trackId, modified);
  return planLoadedSnapshot(trackId, snapshot, options);
};

exports.releaseLatest = async function releaseLatest(trackId, options = {}) {
  return withReleaseLock(trackId, async () =>
    commitPlan(await exports.planLatestRelease(trackId, options)),
  );
};

exports.releaseByModified = async function releaseByModified(trackId, modified, options = {}) {
  return withReleaseLock(trackId, async () =>
    commitPlan(await exports.planReleaseByModified(trackId, modified, options)),
  );
};

// The facade holds the release lock across validation, audit capture, and this operation.
exports.retagReleaseLocked = async function retagReleaseLocked(trackId, modified, nextVersion) {
  const snapshot = await snapshotService.getSnapshotByModified(trackId, modified);
  if (snapshot.version == null) {
    throw new ReleaseConflictError('The selected snapshot is not a release', {
      track_id: trackId,
      snapshot_modified: iso(snapshot.modified),
    });
  }
  const currentVersion = snapshot.version;
  const versionHistory = (await releaseHistoryService.getTrackWideVersionHistory(trackId)).filter(
    (entry) => iso(entry.modified) !== iso(snapshot.modified),
  );
  versionUtils.validateVersionProgression(nextVersion, versionHistory, snapshot.modified);

  // Hash the proposed serialization before publishing any change. A failed
  // export leaves the old release intact; version and artifacts change in one
  // document update. Same-version retries deliberately replay all side effects.
  const publication =
    snapshot.publication || (await publicationService.freezePublication(snapshot));
  const bundleId = snapshot.bundle_id || `bundle--${uuid.v4()}`;
  const bundleHashes = await bundleHashService.generateBundleHashes({
    ...snapshot,
    version: nextVersion,
    publication,
    bundle_id: bundleId,
  });
  const retagged = await dynamicRepo.retagSnapshotInPlace(
    trackId,
    snapshot.modified,
    currentVersion,
    nextVersion,
    { publication, bundle_id: bundleId, bundle_hashes: bundleHashes },
  );
  if (!retagged) {
    throw new ReleaseConflictError('The release changed while its version was being updated', {
      track_id: trackId,
      snapshot_modified: iso(snapshot.modified),
      expected_version: currentVersion,
    });
  }

  await dynamicRepo.replaceVersionHistoryVersion(trackId, snapshot.modified, nextVersion);
  await releaseHistoryService.reconcileTaggedReleases(trackId);
  await snapshotService.syncRegistryCounters(trackId);

  logger.verbose(
    `VersioningService: Changed release ${currentVersion} to ${nextVersion} on track "${trackId}"`,
  );
  return retagged;
};
