'use strict';

// =============================================================================
// Workflow Service
//
// Manages automatic promotion of candidates to staged based on workflow
// status and candidacy threshold configuration.
//
// Core functionality:
//   - Evaluates whether a candidate's workflow status meets the track's
//     candidacy threshold
//   - Automatically promotes qualifying candidates to the staged tier
//   - Handles conflict resolution during auto-promotion
//
// This service is invoked by standard-track-service after:
//   - Candidate status transitions (reviewCandidates)
//   - New candidates are added (addCandidates)
// =============================================================================

const snapshotService = require('./snapshot-service');
const conflictResolution = require('../../lib/release-tracks/conflict-resolution');
const logger = require('../../lib/logger');

// =============================================================================
// Status ranking and threshold evaluation
// =============================================================================

const STATUS_RANK = {
  'work-in-progress': 0,
  'awaiting-review': 1,
  reviewed: 2,
};

/**
 * Check if a candidate's status meets or exceeds the configured threshold.
 *
 * @param {string} candidateStatus - The candidate's current status
 * @param {string} threshold - The configured candidacy threshold
 * @returns {boolean} True if the candidate meets the threshold
 */
exports.meetsThreshold = function meetsThreshold(candidateStatus, threshold) {
  const candidateRank = STATUS_RANK[candidateStatus];
  const thresholdRank = STATUS_RANK[threshold];

  if (candidateRank === undefined || thresholdRank === undefined) {
    return false;
  }

  return candidateRank >= thresholdRank;
};

// =============================================================================
// Auto-promotion evaluation
// =============================================================================

/**
 * Evaluate and execute auto-promotion for qualifying candidates.
 *
 * This is called after candidate status changes (via reviewCandidates) or
 * when new candidates are added (via addCandidates). If auto_promote is
 * enabled and candidates meet the candidacy threshold, they are automatically
 * promoted to the staged tier.
 *
 * @param {string} trackId - The release track ID
 * @param {Object} snapshot - The current snapshot (with updated candidates)
 * @returns {Promise<Object|null>} The new snapshot if promotion occurred, null otherwise
 */
exports.evaluateAutoPromotion = async function evaluateAutoPromotion(trackId, snapshot) {
  // Auto-promotion only applies to standard tracks
  if (snapshot.type !== 'standard') {
    return null;
  }

  // Check if auto-promotion is enabled
  const config = snapshot.config || {};
  if (config.auto_promote !== true) {
    return null;
  }

  // Determine the candidacy threshold (default: 'reviewed')
  const threshold = config.candidacy_threshold || 'reviewed';

  // Find candidates that meet the threshold
  const candidates = snapshot.candidates || [];
  const qualifying = candidates.filter((c) => exports.meetsThreshold(c.object_status, threshold));

  if (qualifying.length === 0) {
    return null;
  }

  logger.verbose(
    `WorkflowService: ${qualifying.length} candidate(s) meet threshold "${threshold}" in track "${trackId}"`,
  );

  // Promote qualifying candidates to staged
  return _promoteToStaged(trackId, snapshot, qualifying);
};

// =============================================================================
// Internal promotion logic
// =============================================================================

/**
 * Internal: Promote qualifying candidates to the staged tier.
 *
 * This performs the actual tier mutation by:
 * 1. Building staged entries from qualifying candidates
 * 2. Applying conflict resolution policy
 * 3. Removing promoted candidates from the candidates tier
 * 4. Cloning the snapshot with updated tiers
 *
 * @param {string} trackId
 * @param {Object} snapshot - The source snapshot
 * @param {Array<Object>} qualifyingCandidates - Candidates to promote
 * @returns {Promise<Object>} The new snapshot
 */
async function _promoteToStaged(trackId, snapshot, qualifyingCandidates) {
  const now = new Date();
  const existingCandidates = snapshot.candidates || [];
  const existingStaged = snapshot.staged || [];

  // Build a set of qualifying object_refs for efficient lookup
  const qualifyingRefs = new Set(qualifyingCandidates.map((c) => c.object_ref));

  // Partition candidates into promoted vs remaining
  const toPromote = [];
  const remainingCandidates = [];

  for (const candidate of existingCandidates) {
    if (qualifyingRefs.has(candidate.object_ref)) {
      toPromote.push(candidate);
    } else {
      remainingCandidates.push(candidate);
    }
  }

  // Build staged entries from promoted candidates
  const newStagedEntries = toPromote.map((c) => ({
    object_ref: c.object_ref,
    object_modified: c.object_modified,
    object_status: c.object_status,
    object_staged_at: now,
    object_staged_by: c.object_added_by, // Preserve original author
  }));

  // Apply conflict resolution policy
  const policy =
    (snapshot.config &&
      snapshot.config.promotion_conflicts &&
      snapshot.config.promotion_conflicts.candidates_to_staged) ||
    'prefer_latest';

  const { merged: mergedStaged, rejected } = conflictResolution.applyConflictPolicy(
    existingStaged,
    newStagedEntries,
    policy,
  );

  // If any were rejected by conflict policy, put them back in candidates
  const rejectedRefs = new Set(rejected.map((r) => r.object_ref));
  const finalCandidates = [
    ...remainingCandidates,
    ...toPromote.filter((c) => rejectedRefs.has(c.object_ref)),
  ];

  // Clone snapshot with updated tiers
  const newSnapshot = await snapshotService.cloneSnapshot(trackId, snapshot, {
    candidates: finalCandidates,
    staged: mergedStaged,
  });

  logger.verbose(
    `WorkflowService: Auto-promoted ${toPromote.length - rejected.length} candidate(s), ` +
      `rejected ${rejected.length} in track "${trackId}"`,
  );

  return newSnapshot;
}
