'use strict';

const CreationCause = require('../../lib/release-tracks/snapshot-creation-causes');

// =============================================================================
// Standard Track Service
//
// Manages the three-tier workflow for standard release tracks:
//   candidates → staged → members
//
// Operations: add/list/remove/review candidates, promote candidates to staged,
// update candidate version pins, list/demote staged, list object versions.
//
// All mutations produce a new snapshot clone (immutable snapshot model).
// =============================================================================

const snapshotService = require('./snapshot-service');
const primaryRevisionService = require('./primary-revision-service');
const revisionReference = require('../../lib/release-tracks/revision-reference');
const conflictResolution = require('../../lib/release-tracks/conflict-resolution');
const tierRevisionInvariant = require('../../lib/release-tracks/tier-revision-invariant');
const logger = require('../../lib/logger');
const { NotFoundError, BadRequestError } = require('../../exceptions');

// Lazy-load workflowService to avoid circular dependency
// (workflow-service imports snapshot-service, which is also imported here)
let workflowService;
function getWorkflowService() {
  if (!workflowService) {
    workflowService = require('./workflow-service');
  }
  return workflowService;
}

// =============================================================================
// Internal helpers
// =============================================================================

const STATUS_RANK = {
  'work-in-progress': 0,
  'awaiting-review': 1,
  reviewed: 2,
};

/**
 * Validate that the snapshot belongs to a standard track.
 * @param {Object} snapshot
 * @throws {BadRequestError}
 */
function assertStandardTrack(snapshot) {
  if (snapshot.type === 'virtual') {
    throw new BadRequestError({
      message: 'This operation is only available for standard release tracks',
      details: `Track ${snapshot.id} is a virtual track`,
    });
  }
}

/**
 * Normalize a raw object_ref entry from the request body into a consistent
 * shape: `{ id: string, modified: string|undefined }`.
 *
 * The controller's Zod schema allows either a bare string or an object.
 */
function normalizeObjectRef(entry) {
  if (typeof entry === 'string') {
    return { id: entry, modified: undefined };
  }
  return { id: entry.id, modified: entry.modified };
}

// =============================================================================
// Candidates
// =============================================================================

/**
 * Add one or more objects as candidates on the latest snapshot.
 *
 * For each entry:
 *   - If `modified` is "latest" or omitted, validate the object exists and
 *     preserve a dynamic selector through the candidate/staged workflow.
 *   - Skip duplicates (same object_ref + object_modified already in any tier).
 *   - New candidates start as "work-in-progress".
 *
 * @param {string} trackId
 * @param {Array<string|{id:string, modified?:string}>} objectRefs
 * @param {string} [userId]
 * @returns {Promise<Object>} The new snapshot
 */
exports.addCandidates = async function addCandidates(trackId, objectRefs, userId) {
  const source = await snapshotService.getLatestSnapshot(trackId);
  assertStandardTrack(source);
  const normalizedSource = tierRevisionInvariant.normalizeSnapshot(source);
  const workingSource = normalizedSource.snapshot;

  const now = new Date();
  const existingCandidates = workingSource.candidates || [];
  const existingRevisionKeys = new Set(
    tierRevisionInvariant.TIER_PRECEDENCE.flatMap((tier) => workingSource[tier] || []).map(
      tierRevisionInvariant.revisionKey,
    ),
  );
  const newEntries = [];

  for (const raw of objectRefs) {
    const entry = normalizeObjectRef(raw);

    // `latest` remains dynamic through the candidate/staged workflow. The
    // shared primary-revision boundary resolves it only for existence
    // validation and does not mutate the persisted selector.
    const modified =
      !entry.modified || entry.modified === 'latest'
        ? revisionReference.LATEST
        : new Date(entry.modified);

    const revision = { object_ref: entry.id, object_modified: modified };
    const revisionKey = tierRevisionInvariant.revisionKey(revision);
    const isDuplicate = existingRevisionKeys.has(revisionKey);
    if (isDuplicate) {
      logger.verbose(
        `StandardTrackService: Skipping already-pinned candidate ${entry.id} @ ` +
          `${revisionReference.isLatest(modified) ? modified : modified.toISOString()}`,
      );
      continue;
    }

    newEntries.push({
      ...revision,
      object_status: 'work-in-progress',
      object_added_at: now,
      object_added_by: userId,
    });
    existingRevisionKeys.add(revisionKey);
  }

  if (newEntries.length === 0) {
    return normalizedSource.removed.length > 0
      ? snapshotService.cloneSnapshot(trackId, source, undefined, {
          creationCause: CreationCause.CandidatesAdded,
          userAccountId: userId,
        })
      : source;
  }

  await primaryRevisionService.assertRequestEntries(newEntries);

  // Same-object conflicts (the object_ref is already pinned in candidates at
  // a different revision) are resolved by the into_candidates policy.
  const conflictPolicy = source.config?.promotion_conflicts?.into_candidates || 'prefer_latest';
  const { merged: mergedCandidates, rejected } = conflictResolution.applyConflictPolicy(
    existingCandidates,
    newEntries,
    conflictPolicy,
  );
  if (rejected.length > 0) {
    logger.verbose(
      `StandardTrackService: into_candidates policy "${conflictPolicy}" rejected ` +
        `${rejected.length} candidate(s) for track "${trackId}"`,
    );
  }

  let snapshot = await snapshotService.cloneSnapshot(
    trackId,
    source,
    {
      candidates: mergedCandidates,
    },
    { creationCause: CreationCause.CandidatesAdded, userAccountId: userId },
  );

  logger.verbose(
    `StandardTrackService: Added ${newEntries.length} candidate(s) to track "${trackId}"`,
  );

  // Evaluate auto-promotion for newly added candidates (Phase 3)
  const autoPromotedSnapshot = await getWorkflowService().evaluateAutoPromotion(
    trackId,
    snapshot,
    userId,
  );
  if (autoPromotedSnapshot) {
    snapshot = autoPromotedSnapshot;
  }

  return snapshot;
};

/**
 * List candidates from the latest snapshot, optionally filtered by status.
 *
 * @param {string} trackId
 * @param {Object} [options] - { status? }
 * @returns {Promise<{ candidates: Array<Object> }>}
 */
exports.listCandidates = async function listCandidates(trackId, options = {}) {
  const snapshot = await snapshotService.getLatestSnapshot(trackId);
  assertStandardTrack(snapshot);

  let candidates = snapshot.candidates || [];

  if (options.status) {
    candidates = candidates.filter((c) => c.object_status === options.status);
  }

  return { candidates };
};

/**
 * Remove all candidate entries for a given object ref from the latest snapshot.
 *
 * @param {string} trackId
 * @param {string} objectRef - The STIX ID of the object to remove
 * @returns {Promise<Object>} The new snapshot
 * @throws {NotFoundError} If no candidate with that object_ref exists
 */
exports.removeCandidate = async function removeCandidate(trackId, objectRef, userId) {
  const source = await snapshotService.getLatestSnapshot(trackId);
  assertStandardTrack(source);

  const existingCandidates = source.candidates || [];
  const remaining = existingCandidates.filter((c) => c.object_ref !== objectRef);

  if (remaining.length === existingCandidates.length) {
    throw new NotFoundError({
      details: `Candidate with object_ref "${objectRef}" not found in track "${trackId}"`,
    });
  }

  const snapshot = await snapshotService.cloneSnapshot(
    trackId,
    source,
    {
      candidates: remaining,
    },
    { creationCause: CreationCause.CandidateRemoved, userAccountId: userId },
  );

  logger.verbose(`StandardTrackService: Removed candidate "${objectRef}" from track "${trackId}"`);
  return snapshot;
};

/**
 * Transition the workflow status of matching candidates.
 *
 * Status transitions are forward-only:
 *   work-in-progress → awaiting-review → reviewed
 *
 * If `reviewData.object_refs` is provided, only those candidates are affected.
 * Otherwise all candidates matching `from` status are transitioned.
 *
 * @param {string} trackId
 * @param {Object} reviewData - { from, to, object_refs? }
 * @param {string} [userId]
 * @returns {Promise<Object>} The new snapshot
 */

exports.reviewCandidates = async function reviewCandidates(trackId, reviewData, userId) {
  const { from, to, object_refs: filterRefs } = reviewData;

  // Validate forward-only transition
  if (STATUS_RANK[to] <= STATUS_RANK[from]) {
    throw new BadRequestError({
      message: `Invalid status transition: cannot move from "${from}" to "${to}"`,
      details:
        'Status transitions must be forward-only: work-in-progress → awaiting-review → reviewed',
    });
  }

  const source = await snapshotService.getLatestSnapshot(trackId);
  assertStandardTrack(source);

  // Build a set of object_refs to target (if specified)
  let targetRefs = null;
  if (filterRefs && filterRefs.length > 0) {
    targetRefs = new Set(filterRefs.map((r) => (typeof r === 'string' ? r : r.id)));
  }

  const updatedCandidates = (source.candidates || []).map((candidate) => {
    // Only transition candidates matching the `from` status
    if (candidate.object_status !== from) return candidate;

    // If specific refs requested, skip non-matching
    if (targetRefs && !targetRefs.has(candidate.object_ref)) return candidate;

    return {
      ...candidate,
      object_status: to,
    };
  });

  let snapshot = await snapshotService.cloneSnapshot(
    trackId,
    source,
    {
      candidates: updatedCandidates,
    },
    { creationCause: CreationCause.CandidatesReviewed, userAccountId: userId },
  );

  logger.verbose(
    `StandardTrackService: Reviewed candidates "${from}" → "${to}" in track "${trackId}"`,
  );

  // Evaluate auto-promotion after status transition (Phase 3)
  const autoPromotedSnapshot = await getWorkflowService().evaluateAutoPromotion(
    trackId,
    snapshot,
    userId,
  );
  if (autoPromotedSnapshot) {
    snapshot = autoPromotedSnapshot;
  }

  return snapshot;
};

/**
 * Manually promote candidates to the staged tier.
 *
 * Applies the `config.promotion_conflicts.candidates_to_staged` policy to
 * handle the case where a different version of the same object already
 * exists in staged.
 *
 * @param {string} trackId
 * @param {Array<string>} objectRefs - STIX IDs of candidates to promote
 * @param {string} [userId]
 * @returns {Promise<Object>} The new snapshot
 */
exports.promoteCandidates = async function promoteCandidates(trackId, objectRefs, userId) {
  const source = await snapshotService.getLatestSnapshot(trackId);
  assertStandardTrack(source);

  const now = new Date();
  const refSet = new Set(objectRefs);
  const existingCandidates = source.candidates || [];
  const existingStaged = source.staged || [];

  // Partition candidates into promoted vs remaining
  const toPromote = [];
  const remainingCandidates = [];
  for (const candidate of existingCandidates) {
    if (refSet.has(candidate.object_ref)) {
      toPromote.push(candidate);
    } else {
      remainingCandidates.push(candidate);
    }
  }

  if (toPromote.length === 0) {
    throw new NotFoundError({
      details: 'None of the specified object_refs were found in the candidates tier',
    });
  }

  // Build staged entries from promoted candidates
  const newStagedEntries = toPromote.map((c) => ({
    object_ref: c.object_ref,
    object_modified: c.object_modified,
    object_status: c.object_status,
    object_staged_at: now,
    object_staged_by: userId,
  }));

  // Apply conflict resolution policy
  const policy =
    (source.config &&
      source.config.promotion_conflicts &&
      source.config.promotion_conflicts.candidates_to_staged) ||
    'prefer_latest';

  const { merged: mergedStaged, rejected } = conflictResolution.applyConflictPolicy(
    existingStaged,
    newStagedEntries,
    policy,
  );

  // If any were rejected, put them back in candidates
  const rejectedRefs = new Set(rejected.map((r) => r.object_ref));
  const finalCandidates = [
    ...remainingCandidates,
    ...toPromote.filter((c) => rejectedRefs.has(c.object_ref)),
  ];

  const snapshot = await snapshotService.cloneSnapshot(
    trackId,
    source,
    {
      candidates: finalCandidates,
      staged: mergedStaged,
    },
    { creationCause: CreationCause.CandidatesPromoted, userAccountId: userId },
  );

  logger.verbose(
    `StandardTrackService: Promoted ${toPromote.length - rejected.length} candidate(s), ` +
      `rejected ${rejected.length} in track "${trackId}"`,
  );
  return snapshot;
};

/**
 * Update the version pin (object_modified) of a specific candidate.
 *
 * @param {string} trackId
 * @param {string} objectRef - The STIX ID
 * @param {Object} data - { old_modified, new_modified }
 * @returns {Promise<Object>} The new snapshot
 * @throws {NotFoundError} If no matching candidate is found
 */
exports.updateCandidateVersion = async function updateCandidateVersion(
  trackId,
  objectRef,
  data,
  userId,
) {
  const source = await snapshotService.getLatestSnapshot(trackId);
  assertStandardTrack(source);

  const existingCandidates = source.candidates || [];

  let found = false;
  let updatedEntry;
  const updatedCandidates = existingCandidates.map((candidate) => {
    if (
      candidate.object_ref === objectRef &&
      revisionReference.sameModified(candidate.object_modified, data.old_modified)
    ) {
      found = true;
      updatedEntry = {
        ...candidate,
        object_modified: revisionReference.normalize(data.new_modified),
      };
      return updatedEntry;
    }
    return candidate;
  });

  if (!found) {
    throw new NotFoundError({
      details:
        `Candidate "${objectRef}" with modified "${data.old_modified}" ` +
        `not found in track "${trackId}"`,
    });
  }

  await primaryRevisionService.assertRequestEntries([updatedEntry]);

  const snapshot = await snapshotService.cloneSnapshot(
    trackId,
    source,
    {
      candidates: updatedCandidates,
    },
    { creationCause: CreationCause.CandidateVersionUpdated, userAccountId: userId },
  );

  logger.verbose(
    `StandardTrackService: Updated version pin for "${objectRef}" in track "${trackId}"`,
  );
  return snapshot;
};

// =============================================================================
// Staged
// =============================================================================

/**
 * List all staged entries from the latest snapshot.
 *
 * @param {string} trackId
 * @returns {Promise<{ staged: Array<Object> }>}
 */
exports.listStaged = async function listStaged(trackId) {
  const snapshot = await snapshotService.getLatestSnapshot(trackId);
  assertStandardTrack(snapshot);

  return { staged: snapshot.staged || [] };
};

/**
 * Demote staged entries back to the candidates tier.
 *
 * Each ref in `objectRefs` is `{ id, modified }` to uniquely identify the
 * staged entry. Demoted entries preserve their workflow status.
 *
 * @param {string} trackId
 * @param {Array<{id:string, modified:string}>} objectRefs
 * @param {string} [userId]
 * @returns {Promise<Object>} The new snapshot
 */
exports.demoteStaged = async function demoteStaged(trackId, objectRefs, userId) {
  const source = await snapshotService.getLatestSnapshot(trackId);
  assertStandardTrack(source);

  const now = new Date();
  const existingStaged = source.staged || [];
  const existingCandidates = source.candidates || [];

  // Build a lookup key for the refs to demote
  const demoteKeys = new Set(
    objectRefs.map((r) => `${r.id}::${revisionReference.modifiedKey(r.modified)}`),
  );

  const remainingStaged = [];
  const demotedEntries = [];

  for (const staged of existingStaged) {
    const key = `${staged.object_ref}::` + revisionReference.modifiedKey(staged.object_modified);
    if (demoteKeys.has(key)) {
      // Convert back to a candidate entry, preserving workflow status
      demotedEntries.push({
        object_ref: staged.object_ref,
        object_modified: staged.object_modified,
        object_status: staged.object_status || 'work-in-progress',
        object_added_at: now,
        object_added_by: userId,
      });
    } else {
      remainingStaged.push(staged);
    }
  }

  if (demotedEntries.length === 0) {
    throw new NotFoundError({
      details: 'None of the specified object_refs were found in the staged tier',
    });
  }

  // Demoted entries re-enter candidates through the same conflict policy as
  // manual adds.
  const conflictPolicy = source.config?.promotion_conflicts?.into_candidates || 'prefer_latest';
  const { merged: mergedCandidates, rejected } = conflictResolution.applyConflictPolicy(
    existingCandidates,
    demotedEntries,
    conflictPolicy,
  );
  if (rejected.length > 0) {
    logger.verbose(
      `StandardTrackService: into_candidates policy "${conflictPolicy}" rejected ` +
        `${rejected.length} demoted entry/entries for track "${trackId}"`,
    );
  }

  const snapshot = await snapshotService.cloneSnapshot(
    trackId,
    source,
    {
      staged: remainingStaged,
      candidates: mergedCandidates,
    },
    { creationCause: CreationCause.StagedDemoted, userAccountId: userId },
  );

  logger.verbose(
    `StandardTrackService: Demoted ${demotedEntries.length} staged entry/entries in track "${trackId}"`,
  );
  return snapshot;
};

// =============================================================================
// Object versions
// =============================================================================

/**
 * List all tier occurrences of a given object across members, staged, and
 * candidates in the latest snapshot.
 *
 * @param {string} trackId
 * @param {string} objectRef - The STIX ID to search for
 * @returns {Promise<{ versions: Array<Object> }>}
 */
exports.listObjectVersions = async function listObjectVersions(trackId, objectRef) {
  const snapshot = await snapshotService.getLatestSnapshot(trackId);
  assertStandardTrack(snapshot);

  const versions = [];

  // Search members
  for (const entry of snapshot.members || []) {
    if (entry.object_ref === objectRef) {
      versions.push({
        tier: 'members',
        object_ref: entry.object_ref,
        object_modified: entry.object_modified,
      });
    }
  }

  // Search staged
  for (const entry of snapshot.staged || []) {
    if (entry.object_ref === objectRef) {
      versions.push({
        tier: 'staged',
        object_ref: entry.object_ref,
        object_modified: entry.object_modified,
        object_status: entry.object_status,
      });
    }
  }

  // Search candidates
  for (const entry of snapshot.candidates || []) {
    if (entry.object_ref === objectRef) {
      versions.push({
        tier: 'candidates',
        object_ref: entry.object_ref,
        object_modified: entry.object_modified,
        object_status: entry.object_status,
      });
    }
  }

  return { versions };
};

require('../system/validation-operation-service').wrapExports(module.exports);
