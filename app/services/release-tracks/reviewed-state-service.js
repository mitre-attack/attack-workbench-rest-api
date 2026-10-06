'use strict';

const config = require('../../config/config');
const EventBus = require('../../lib/event-bus');
const Events = require('../../lib/event-constants');
const { ValidationError } = require('../../exceptions');
const primaryRevisionService = require('./primary-revision-service');
const revisionReference = require('../../lib/release-tracks/revision-reference');

// This is deliberately revision-global legacy state, not a per-track review policy.
async function ensureReviewed(entries) {
  if (!entries.length) return [];
  const { documents } = await primaryRevisionService.assertStoredEntries(entries);
  const attackObjectsService = require('../stix/attack-objects-service');
  require('../stix/relationships-service');
  require('../system/validation-bypasses-service');
  const bypassRules = config.validateRequests.withAttackDataModel
    ? await require('../../repository/validation-bypasses-repository').findAll()
    : undefined;
  const errors = [];
  const warnings = [];
  const reviewedEntries = [];

  for (const document of documents) {
    // Static system objects must retain their protected workflow state.
    if (document.workspace?.workflow?.state === 'static') continue;
    const reference = {
      object_ref: document.stix.id,
      object_modified: new Date(document.stix.modified).toISOString(),
    };
    const result = await attackObjectsService.validateComposedObject(
      {
        // MongoDB dates, including type-specific dates, must reach ADM as strings.
        // Validate a copy; never replace stored STIX with the parsed schema output.
        stix: JSON.parse(JSON.stringify(document.stix)),
        workspace: { workflow: { state: 'reviewed' } },
      },
      { bypassRules },
    );
    errors.push(...result.errors.map((issue) => ({ ...issue, ...reference })));
    warnings.push(...result.warnings.map((issue) => ({ ...issue, ...reference })));
    reviewedEntries.push(reference);
  }

  // Reject the complete admission before changing any object's workflow metadata.
  if (errors.length) {
    throw new ValidationError('ADM validation failed', { details: errors, warnings });
  }
  if (reviewedEntries.length) {
    const results = await EventBus.emitRequired(
      Events.RELEASE_TRACK_OBJECTS_REVIEWED,
      { entries: reviewedEntries },
      { minimumListeners: 2 },
    );
    if (
      results.reduce((count, result) => count + result.matchedCount, 0) !== reviewedEntries.length
    ) {
      throw new Error('Not all admitted object revisions could be marked reviewed');
    }
  }
  return warnings;
}

async function reviewSnapshotChanges(before, after, { membersWritten = false } = {}) {
  const entries = [];
  for (const tier of ['staged', 'members']) {
    const previous = new Set(
      (before?.[tier] || []).map(
        (entry) => `${entry.object_ref}::${revisionReference.modifiedKey(entry.object_modified)}`,
      ),
    );
    for (const entry of after[tier] || []) {
      const key = `${entry.object_ref}::${revisionReference.modifiedKey(entry.object_modified)}`;
      if ((tier === 'members' && membersWritten) || !previous.has(key)) entries.push(entry);
    }
  }
  return ensureReviewed(entries);
}

module.exports = { ensureReviewed, reviewSnapshotChanges };
