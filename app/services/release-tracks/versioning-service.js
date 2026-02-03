'use strict';

// =============================================================================
// Versioning Service
//
// Manages the bump/tag lifecycle for release track snapshots:
//   - Calculate and assign version numbers (MAJOR.MINOR)
//   - Promote staged entries to members atomically with tagging
//   - Preview upcoming bumps without persisting
//
// Tagging is the ONLY in-place mutation on a snapshot. All other changes
// produce new snapshot clones via snapshot-service.
//
// See docs/COLLECTIONS_V2/03_VERSIONING.md for versioning rules.
// =============================================================================

const snapshotService = require('./snapshot-service');
const dynamicRepo = require('../../repository/release-tracks/release-track-dynamic.repository');
const registryRepo = require('../../repository/release-tracks/release-track-registry.repository');
const versionUtils = require('../../lib/release-tracks/version-utils');
const conflictResolution = require('../../lib/release-tracks/conflict-resolution');
const logger = require('../../lib/logger');
const { AlreadyReleasedError } = require('../../exceptions');

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Core bump logic shared by bumpLatest and bumpByModified.
 *
 * @param {string} trackId
 * @param {Object} snapshot - The snapshot to tag
 * @param {Object} options - { type?, version?, dry_run?, userAccountId }
 * @returns {Promise<Object>} The tagged snapshot (or preview if dry_run)
 */
async function _doBump(trackId, snapshot, options) {
  // Guard: cannot re-tag an already-tagged snapshot
  if (snapshot.version != null) {
    throw new AlreadyReleasedError(snapshot.version);
  }

  const versionHistory = snapshot.version_history || [];

  // Calculate version
  const version = versionUtils.calculateNextVersion(versionHistory, options.type, options.version);

  // Validate monotonic progression
  versionUtils.validateVersionProgression(version, versionHistory);

  // Promote staged → members (standard tracks only)
  const staged = snapshot.staged || [];
  const existingMembers = snapshot.members || [];
  let mergedMembers = existingMembers;
  let promotedCount = 0;

  if (staged.length > 0) {
    // Convert staged entries to member entries (strip staged-specific fields)
    const stagedAsMembers = staged.map((s) => ({
      object_ref: s.object_ref,
      object_modified: s.object_modified,
    }));

    const policy =
      (snapshot.config &&
        snapshot.config.promotion_conflicts &&
        snapshot.config.promotion_conflicts.staged_to_members) ||
      'abort';

    const { merged } = conflictResolution.applyConflictPolicy(
      existingMembers,
      stagedAsMembers,
      policy,
    );

    mergedMembers = merged;
    promotedCount = staged.length;
  }

  const now = new Date();

  // Build version history entry
  const versionHistoryEntry = {
    version,
    tagged_at: now,
    tagged_by: options.userAccountId || 'system',
    snapshot_id: snapshot.modified,
    summary: {
      members_count: mergedMembers.length,
      promoted_count: promotedCount,
      staged_count: staged.length,
      candidate_count: (snapshot.candidates || []).length,
    },
  };

  // Dry-run: return preview without persisting
  if (options.dry_run) {
    return {
      dry_run: true,
      track_id: trackId,
      snapshot_modified: snapshot.modified,
      version,
      staged_to_promote: staged.length,
      members_after: mergedMembers.length,
      version_history_entry: versionHistoryEntry,
    };
  }

  // Build additional atomic ops for the tag update
  const additionalOps = {};
  if (staged.length > 0) {
    additionalOps.members = mergedMembers;
    additionalOps.staged = [];
  }

  // Atomic tag + promotion
  const tagged = await dynamicRepo.tagSnapshotInPlace(trackId, snapshot.modified, {
    version,
    versionHistoryEntry,
    additionalOps: Object.keys(additionalOps).length > 0 ? additionalOps : undefined,
  });

  if (!tagged) {
    // Race condition: snapshot was already tagged between our read and update
    throw new AlreadyReleasedError('(concurrent tag)');
  }

  // Update registry counters
  await registryRepo.updateByTrackId(trackId, {
    latest_tagged_version: version,
    tagged_release_count: versionHistory.length + 1,
    updated_at: now,
  });

  logger.verbose(
    `VersioningService: Tagged track "${trackId}" as v${version} ` +
      `(promoted ${promotedCount} staged → members)`,
  );

  return tagged;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Tag the latest snapshot of a track as a versioned release.
 *
 * - Calculates the next version (or uses explicit version from options)
 * - Promotes all staged entries to members atomically
 * - Records the version in version_history
 * - Updates registry counters
 *
 * @param {string} trackId
 * @param {Object} options - { type?: 'major'|'minor', version?: string, dry_run?: boolean, userAccountId?: string }
 * @returns {Promise<Object>} The tagged snapshot (or preview object if dry_run)
 */
exports.bumpLatest = async function bumpLatest(trackId, options = {}) {
  const snapshot = await snapshotService.getLatestSnapshot(trackId);
  return _doBump(trackId, snapshot, options);
};

/**
 * Tag a specific snapshot (by modified timestamp) as a versioned release.
 *
 * Same semantics as bumpLatest but targets a specific snapshot.
 *
 * @param {string} trackId
 * @param {string|Date} modified - The snapshot's modified timestamp
 * @param {Object} options - { type?: 'major'|'minor', version?: string, dry_run?: boolean, userAccountId?: string }
 * @returns {Promise<Object>} The tagged snapshot (or preview object if dry_run)
 */
exports.bumpByModified = async function bumpByModified(trackId, modified, options = {}) {
  const snapshot = await snapshotService.getSnapshotByModified(trackId, modified);
  return _doBump(trackId, snapshot, options);
};

/**
 * Preview what a bump on the latest snapshot would produce without persisting.
 *
 * Returns the calculated version, staged-to-members diff, and summary stats.
 *
 * @param {string} trackId
 * @param {string} [_format] - Reserved for future export format support
 * @returns {Promise<Object>} Preview object
 */
// eslint-disable-next-line no-unused-vars
exports.previewBump = async function previewBump(trackId, _format) {
  const snapshot = await snapshotService.getLatestSnapshot(trackId);

  const versionHistory = snapshot.version_history || [];
  const staged = snapshot.staged || [];
  const existingMembers = snapshot.members || [];

  // Calculate what the next version would be (default minor bump)
  const isAlreadyTagged = snapshot.version != null;
  const nextMinor = isAlreadyTagged
    ? null
    : versionUtils.calculateNextVersion(versionHistory, 'minor');
  const nextMajor = isAlreadyTagged
    ? null
    : versionUtils.calculateNextVersion(versionHistory, 'major');

  // Preview staged → members merge
  let mergedMembersCount = existingMembers.length;
  if (staged.length > 0 && !isAlreadyTagged) {
    const stagedAsMembers = staged.map((s) => ({
      object_ref: s.object_ref,
      object_modified: s.object_modified,
    }));

    const policy =
      (snapshot.config &&
        snapshot.config.promotion_conflicts &&
        snapshot.config.promotion_conflicts.staged_to_members) ||
      'abort';

    try {
      const { merged } = conflictResolution.applyConflictPolicy(
        existingMembers,
        stagedAsMembers,
        policy,
      );
      mergedMembersCount = merged.length;
    } catch (err) {
      // If policy is 'abort' and conflicts exist, report it in the preview
      return {
        track_id: trackId,
        snapshot_modified: snapshot.modified,
        is_already_tagged: isAlreadyTagged,
        current_version: snapshot.version,
        next_version_minor: nextMinor,
        next_version_major: nextMajor,
        staged_count: staged.length,
        members_count: existingMembers.length,
        candidates_count: (snapshot.candidates || []).length,
        conflict_error: err.message,
      };
    }
  }

  return {
    track_id: trackId,
    snapshot_modified: snapshot.modified,
    is_already_tagged: isAlreadyTagged,
    current_version: snapshot.version,
    next_version_minor: nextMinor,
    next_version_major: nextMajor,
    staged_count: staged.length,
    staged_to_promote: isAlreadyTagged ? 0 : staged.length,
    members_count: existingMembers.length,
    members_after_promotion: isAlreadyTagged ? existingMembers.length : mergedMembersCount,
    candidates_count: (snapshot.candidates || []).length,
    version_history: versionHistory,
  };
};
