'use strict';

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
const objectResolver = require('../../lib/release-tracks/object-resolver');
const conflictResolution = require('../../lib/release-tracks/conflict-resolution');
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
 *   - If `modified` is "latest" or omitted, resolve via the STIX service layer.
 *   - Skip duplicates (same object_ref + object_modified already in candidates).
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

  const now = new Date();
  const existingCandidates = source.candidates || [];
  const newEntries = [];

  for (const raw of objectRefs) {
    const entry = normalizeObjectRef(raw);

    // Resolve modified timestamp
    let modified;
    if (!entry.modified || entry.modified === 'latest') {
      modified = await objectResolver.resolveLatestModified(entry.id);
    } else {
      modified = new Date(entry.modified);
    }

    // Skip if this exact (object_ref + object_modified) already exists in candidates
    const isDuplicate = existingCandidates.some(
      (c) =>
        c.object_ref === entry.id && new Date(c.object_modified).getTime() === modified.getTime(),
    );
    if (isDuplicate) {
      logger.verbose(
        `StandardTrackService: Skipping duplicate candidate ${entry.id} @ ${modified.toISOString()}`,
      );
      continue;
    }

    newEntries.push({
      object_ref: entry.id,
      object_modified: modified,
      object_status: 'work-in-progress',
      object_added_at: now,
      object_added_by: userId,
    });
  }

  const mergedCandidates = [...existingCandidates, ...newEntries];

  let snapshot = await snapshotService.cloneSnapshot(trackId, source, {
    candidates: mergedCandidates,
  });

  logger.verbose(
    `StandardTrackService: Added ${newEntries.length} candidate(s) to track "${trackId}"`,
  );

  // Evaluate auto-promotion for newly added candidates (Phase 3)
  const autoPromotedSnapshot = await getWorkflowService().evaluateAutoPromotion(trackId, snapshot);
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
exports.removeCandidate = async function removeCandidate(trackId, objectRef) {
  const source = await snapshotService.getLatestSnapshot(trackId);
  assertStandardTrack(source);

  const existingCandidates = source.candidates || [];
  const remaining = existingCandidates.filter((c) => c.object_ref !== objectRef);

  if (remaining.length === existingCandidates.length) {
    throw new NotFoundError({
      details: `Candidate with object_ref "${objectRef}" not found in track "${trackId}"`,
    });
  }

  const snapshot = await snapshotService.cloneSnapshot(trackId, source, {
    candidates: remaining,
  });

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
// eslint-disable-next-line no-unused-vars
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

  let snapshot = await snapshotService.cloneSnapshot(trackId, source, {
    candidates: updatedCandidates,
  });

  logger.verbose(
    `StandardTrackService: Reviewed candidates "${from}" → "${to}" in track "${trackId}"`,
  );

  // Evaluate auto-promotion after status transition (Phase 3)
  const autoPromotedSnapshot = await getWorkflowService().evaluateAutoPromotion(trackId, snapshot);
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

  const snapshot = await snapshotService.cloneSnapshot(trackId, source, {
    candidates: finalCandidates,
    staged: mergedStaged,
  });

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
exports.updateCandidateVersion = async function updateCandidateVersion(trackId, objectRef, data) {
  const source = await snapshotService.getLatestSnapshot(trackId);
  assertStandardTrack(source);

  const oldTime = new Date(data.old_modified).getTime();
  const existingCandidates = source.candidates || [];

  let found = false;
  const updatedCandidates = existingCandidates.map((candidate) => {
    if (
      candidate.object_ref === objectRef &&
      new Date(candidate.object_modified).getTime() === oldTime
    ) {
      found = true;
      return {
        ...candidate,
        object_modified: new Date(data.new_modified),
      };
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

  const snapshot = await snapshotService.cloneSnapshot(trackId, source, {
    candidates: updatedCandidates,
  });

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
  const demoteKeys = new Set(objectRefs.map((r) => `${r.id}::${new Date(r.modified).getTime()}`));

  const remainingStaged = [];
  const demotedEntries = [];

  for (const staged of existingStaged) {
    const key = `${staged.object_ref}::${new Date(staged.object_modified).getTime()}`;
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

  const snapshot = await snapshotService.cloneSnapshot(trackId, source, {
    staged: remainingStaged,
    candidates: [...existingCandidates, ...demotedEntries],
  });

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
