'use strict';

// =============================================================================
// Conflict Resolution
//
// Applies conflict resolution policies when promoting objects between tiers.
// A "conflict" occurs when the incoming entry has the same object_ref as an
// existing entry in the target tier but a different object_modified timestamp.
//
// Policies:
//   always_overwrite  – Replace the incumbent with the incoming entry
//   always_reject     – Keep the incumbent; incoming is rejected
//   prefer_latest     – Keep whichever has the newer object_modified
//   abort             – Throw ReleaseConflictError on any conflict
// =============================================================================

const { ReleaseConflictError } = require('../../exceptions');

/**
 * Merge incoming entries into an existing tier, applying a conflict policy.
 *
 * @param {Array<Object>} existingTier - Current entries in the target tier
 * @param {Array<Object>} incomingEntries - Entries being promoted into the tier
 * @param {string} policy - One of: 'always_overwrite' | 'always_reject' | 'prefer_latest' | 'abort'
 * @returns {{ merged: Array<Object>, rejected: Array<Object> }}
 * @throws {ReleaseConflictError} If policy is 'abort' and any conflicts are detected
 */
exports.applyConflictPolicy = function applyConflictPolicy(existingTier, incomingEntries, policy) {
  const merged = [...existingTier];
  const rejected = [];
  const conflicts = []; // Collect all conflicts for 'abort' policy

  for (const incoming of incomingEntries) {
    const conflictIdx = merged.findIndex((e) => e.object_ref === incoming.object_ref);

    if (conflictIdx === -1) {
      // No conflict — simply add the incoming entry
      merged.push(incoming);
      continue;
    }

    const incumbent = merged[conflictIdx];

    switch (policy) {
      case 'always_overwrite':
        merged[conflictIdx] = incoming;
        break;

      case 'always_reject':
        rejected.push(incoming);
        break;

      case 'prefer_latest': {
        const incomingTime = new Date(incoming.object_modified).getTime();
        const incumbentTime = new Date(incumbent.object_modified).getTime();
        if (incomingTime > incumbentTime) {
          merged[conflictIdx] = incoming;
        } else {
          rejected.push(incoming);
        }
        break;
      }

      case 'abort':
        // Collect all conflicts instead of throwing immediately
        conflicts.push({
          object_ref: incoming.object_ref,
          incumbent_version: incumbent.object_modified,
          incoming_version: incoming.object_modified,
        });
        break;

      default:
        throw new Error(`Unknown conflict resolution policy: ${policy}`);
    }
  }

  // If we're using 'abort' policy and found any conflicts, throw with all of them
  if (policy === 'abort' && conflicts.length > 0) {
    const conflictCount = conflicts.length;
    const message =
      conflictCount === 1
        ? `Conflict on ${conflicts[0].object_ref}: abort policy prevents promotion`
        : `Cannot complete release: ${conflictCount} conflict(s) detected`;

    throw new ReleaseConflictError(message, { conflicts });
  }

  return { merged, rejected };
};
