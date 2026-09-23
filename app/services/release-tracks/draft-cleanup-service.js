'use strict';

const { createHash } = require('crypto');
const authz = require('../../lib/authz-middleware');
const { draftRetentionSchema } = require('../../lib/release-tracks/release-track-schemas');
const registryRepo = require('../../repository/release-tracks/release-track-registry.repository');
const dynamicRepo = require('../../repository/release-tracks/release-track-dynamic.repository');
const auditRepo = require('../../repository/release-tracks/release-track-audit-event.repository');
const occurrenceRepo = require('../../repository/release-tracks/virtual-track-schedule-occurrence.repository');
const manifests = require('./content-manifest-service');
const {
  BadRequestError,
  InsufficientRoleError,
  NotFoundError,
  ReleaseConflictError,
  ReleasePublicationError,
  TrackNotFoundError,
} = require('../../exceptions');

const BATCH_SIZE = 100;
const MAX_BATCHES = 10;
const iso = (value) => new Date(value).toISOString();
const IDENTITY_FIELDS =
  'id modified version content_manifest_id scheduled_materialization release_event_id';

function assertAdmin(actor) {
  if (actor?.role !== authz.userRoles.admin) {
    throw new InsufficientRoleError('administrator', {
      details:
        'Configuring draft retention, squashing drafts, and retrying cleanup require an administrator.',
    });
  }
}
exports.assertAdmin = assertAdmin;

function validatePolicy(policy, actor, type) {
  assertAdmin(actor);
  if (type !== 'virtual')
    throw new BadRequestError({ message: 'Draft retention is only available for virtual tracks' });
  const parsed = draftRetentionSchema.safeParse(policy);
  if (!parsed.success)
    throw new BadRequestError({
      message: 'Invalid draft retention policy',
      details: parsed.error.errors,
    });
  return parsed.data;
}
exports.validatePolicy = validatePolicy;

async function virtualRegistry(trackId) {
  const registry = await registryRepo.findByTrackId(trackId, 'track_id type draft_retention');
  if (!registry) throw new TrackNotFoundError(trackId);
  if (registry.type !== 'virtual')
    throw new BadRequestError({ message: 'Draft cleanup is only available for virtual tracks' });
  return registry;
}

exports.updatePolicy = async function updatePolicy(trackId, policy, actor) {
  assertAdmin(actor);
  const { withReleaseLock } = require('./versioning-service');
  return withReleaseLock(trackId, async () => {
    const registry = await virtualRegistry(trackId);
    const draftRetention = validatePolicy(policy, actor, registry.type);
    await registryRepo.updateByTrackId(trackId, {
      draft_retention: draftRetention,
      updated_at: new Date(),
    });
    return { draft_retention: draftRetention };
  });
};

// Called under the target lock before any write carrying scheduled metadata.
// A durable receipt outlives its snapshot; its absence is never permission to replay.
exports.findScheduledResult = async function findScheduledResult(trackId, scheduled) {
  if (!scheduled) return null;
  const receipt = await occurrenceRepo.getMaterializationReceipt(trackId, scheduled.scheduled_for);
  const existing = receipt?.snapshot_modified
    ? await dynamicRepo.getSnapshotByModified(trackId, receipt.snapshot_modified)
    : await dynamicRepo.getSnapshotByScheduledMaterialization(trackId, scheduled.scheduled_for);
  if (receipt?.snapshot_modified && !existing) {
    throw new ReleaseConflictError(
      'This scheduled occurrence was already materialized and its snapshot was removed',
      {
        track_id: trackId,
        scheduled_for: iso(scheduled.scheduled_for),
        snapshot_modified: iso(receipt.snapshot_modified),
        already_materialized: true,
        snapshot_removed: true,
      },
    );
  }
  if (existing) await occurrenceRepo.recordMaterialization(trackId, scheduled, existing.modified);
  return existing;
};

exports.recordScheduledResult = async function recordScheduledResult(snapshot) {
  if (snapshot.scheduled_materialization) {
    await occurrenceRepo.recordMaterialization(
      snapshot.id,
      snapshot.scheduled_materialization,
      snapshot.modified,
    );
  }
};

async function protection(trackId, snapshot, latest) {
  if (iso(snapshot.modified) === iso(latest.modified)) return 'latest';
  if (await dynamicRepo.getReleaseBySourceModified(trackId, snapshot.modified, '_id'))
    return 'release_source';
  let afterTrackId;
  for (;;) {
    const tracks = await registryRepo.findVirtualTrackBatch(afterTrackId);
    if (!tracks.length) break;
    for (const track of tracks) {
      if (
        await dynamicRepo.hasSnapshotResolvingComponent(track.track_id, trackId, snapshot.modified)
      )
        return 'dependency';
    }
    afterTrackId = tracks.at(-1).track_id;
  }
  const scheduled = snapshot.scheduled_materialization;
  if (scheduled) {
    const receipt = await occurrenceRepo.getMaterializationReceipt(
      trackId,
      scheduled.scheduled_for,
    );
    if (receipt?.snapshot_modified && iso(receipt.snapshot_modified) !== iso(snapshot.modified))
      return 'scheduled_receipt_conflict';
  }
  return null;
}

exports.previewSquash = async function previewSquash(trackId, target) {
  const previous = await dynamicRepo.getLatestTaggedSnapshotBefore(trackId, target.modified);
  const bounds = {
    lower_bound: previous ? iso(previous.modified) : null,
    upper_bound: iso(target.modified),
  };
  const latest = await dynamicRepo.getLatestSnapshot(trackId, 'modified');
  const hash = createHash('sha256');
  hash.update(
    JSON.stringify([
      trackId,
      bounds,
      target.content_manifest_id,
      previous?.release_event_id || null,
    ]),
  );
  let eligible = 0;
  let protectedCount = 0;
  let cursor;
  for (;;) {
    const batch = await dynamicRepo.getHistoricalDraftBatch(
      trackId,
      { ...bounds, cursor },
      BATCH_SIZE,
    );
    if (!batch.length) break;
    for (const snapshot of batch) {
      const reason = await protection(trackId, snapshot, latest);
      if (reason) protectedCount += 1;
      else eligible += 1;
      hash.update(
        JSON.stringify([
          iso(snapshot.modified),
          snapshot.content_manifest_id,
          reason,
          snapshot.scheduled_materialization || null,
        ]),
      );
    }
    cursor = iso(batch.at(-1).modified);
  }
  return {
    ...bounds,
    eligible_count: eligible,
    protected_count: protectedCount,
    fingerprint: hash.digest('hex'),
  };
};

function stateFor(event) {
  return (
    event.cleanup || {
      kind: event.request.kind,
      eligible_count: event.request.eligible_count || 0,
      deleted_count: 0,
      protected_count: 0,
      cursor: null,
      pending_batch: [],
      release_committed: false,
      publication_complete: false,
    }
  );
}

function resultFor(
  event,
  state = stateFor(event),
  status = event.status,
  error = event.error?.message,
) {
  return {
    operation_id: event.event_id,
    status,
    kind: state.kind,
    eligible_count: state.eligible_count,
    deleted_count: state.deleted_count,
    protected_count: state.protected_count,
    ...(event.request.target_modified ? { target_modified: event.request.target_modified } : {}),
    ...(state.kind === 'squash' ? { release_committed: state.release_committed } : {}),
    ...(error ? { error } : {}),
  };
}
exports.resultFor = resultFor;

async function createIntent(trackId, actor, request) {
  return auditRepo.create({
    action: request.kind === 'squash' ? 'draft_squash' : 'draft_retention',
    trackId,
    actor,
    confirmation: request.fingerprint || trackId,
    request,
  });
}

exports.beginSquash = async function beginSquash(plan, options, lease) {
  assertAdmin(options.actor);
  if (plan.sourceSnapshot.type !== 'virtual')
    throw new BadRequestError({ message: 'Draft squash is only available for virtual tracks' });
  const preview = await exports.previewSquash(plan.trackId, plan.sourceSnapshot);
  if (!options.squash_fingerprint || options.squash_fingerprint !== preview.fingerprint) {
    throw new ReleaseConflictError(
      'The draft squash preview changed; review a fresh preview before releasing',
      { draft_squash: preview },
    );
  }
  await lease.assertOwned();
  return createIntent(plan.trackId, options.actor, {
    ...preview,
    kind: 'squash',
    target_modified: iso(plan.sourceSnapshot.modified),
    version: plan.version,
  });
};

exports.failDraft = async function failDraft(snapshot, event, error) {
  const state = stateFor(event);
  try {
    await auditRepo.saveCleanup(event.event_id, state, 'failed', error);
  } catch {
    /* The pending intent remains discoverable. */
  }
  return { ...snapshot, draft_cleanup: resultFor(event, state, 'failed', error.message) };
};

exports.failRelease = async function failRelease(event, error) {
  const state = stateFor(event);
  try {
    const snapshot = await dynamicRepo.getSnapshotByModified(
      event.track_id,
      event.request.target_modified,
      IDENTITY_FIELDS,
    );
    state.release_committed =
      snapshot?.version != null && snapshot.release_event_id === event.event_id;
  } catch {
    // An unavailable store cannot establish whether an unacknowledged tag
    // persisted. Omit the outcome rather than reporting an uncommitted release.
    state.release_committed = undefined;
  }
  try {
    await auditRepo.saveCleanup(event.event_id, state, 'failed', error);
  } catch {
    /* The pending intent remains discoverable. */
  }
  return new ReleasePublicationError({
    cause: error,
    details: error.message,
    operation_id: event.event_id,
    release_committed: state.release_committed,
    draft_cleanup: resultFor(event, state, 'failed', error.message),
  });
};

async function boundsFor(event, registry) {
  const original = event.request;
  if (original.kind === 'retention') {
    const maximum = registry.draft_retention?.max_drafts;
    if (maximum == null) return null;
    const boundary = await dynamicRepo.getDraftRetentionBoundary(event.track_id, maximum);
    if (!boundary) return null;
    return {
      lower_bound: original.lower_bound,
      upper_bound: iso(
        Math.min(new Date(original.upper_bound).getTime(), new Date(boundary.modified).getTime()),
      ),
    };
  }
  // A newly inserted tag narrows the original interval. Rollback never widens it.
  const previous = await dynamicRepo.getLatestTaggedSnapshotBefore(
    event.track_id,
    original.upper_bound,
  );
  const lower = [original.lower_bound, previous?.modified]
    .filter(Boolean)
    .map((value) => new Date(value).getTime());
  return {
    lower_bound: lower.length ? iso(Math.max(...lower)) : null,
    upper_bound: original.upper_bound,
  };
}

function inBounds(snapshot, bounds) {
  return (
    bounds &&
    new Date(snapshot.modified) < new Date(bounds.upper_bound) &&
    (!bounds.lower_bound || new Date(snapshot.modified) > new Date(bounds.lower_bound))
  );
}

// One bounded, durable page is the write-ahead log. A crash after a snapshot
// delete but before manifest/count updates replays that page, not a fresh selector.
async function runCleanup(event, lease) {
  const state = stateFor(event);
  try {
    await lease.assertOwned();
    let registry = await virtualRegistry(event.track_id);
    // Repair already removed storage even after rollback or policy disabling.
    await manifests.discardOrphans(event.track_id, () => lease.assertOwned());
    await require('./snapshot-service').syncRegistryCounters(event.track_id);
    if (state.kind === 'retention') {
      const created = await dynamicRepo.getSnapshotByModified(
        event.track_id,
        event.request.target_modified,
        IDENTITY_FIELDS,
      );
      if (!created && !state.creation_complete)
        throw new ReleaseConflictError(
          'The draft creation associated with this cleanup did not persist or no longer exists',
        );
      if (created) await exports.recordScheduledResult(created);
      if (created) await manifests.activate(created.content_manifest_id);
      if (!state.creation_complete) {
        const latest = await dynamicRepo.getLatestSnapshot(event.track_id);
        await require('./snapshot-service').emitContentsChanged(event.track_id, latest);
        state.creation_complete = true;
      }
    }
    if (state.kind === 'squash') {
      const release = await dynamicRepo.getSnapshotByModified(
        event.track_id,
        event.request.target_modified,
      );
      if (!release?.version || release.release_event_id !== event.event_id) {
        state.release_committed = false;
        throw new ReleaseConflictError(
          'The original release event is no longer present; cleanup cannot resume',
          {
            operation_id: event.event_id,
            release_committed: false,
          },
        );
      }
      state.release_committed = true;
      if (!state.publication_complete) {
        const versioning = require('./versioning-service');
        await lease.assertOwned();
        await versioning.refreshReleaseArtifacts(release);
        await require('./release-history-service').reconcileTaggedReleases(event.track_id);
        const latest = await dynamicRepo.getLatestSnapshot(event.track_id);
        await require('./snapshot-service').emitContentsChanged(event.track_id, latest);
        state.publication_complete = true;
        await auditRepo.saveCleanup(event.event_id, state);
      }
    }

    for (let page = 0; page < MAX_BATCHES; page += 1) {
      await lease.assertOwned();
      registry = await virtualRegistry(event.track_id);
      const bounds = await boundsFor(event, registry);
      if (!state.pending_batch.length && bounds) {
        state.pending_batch = await dynamicRepo.getHistoricalDraftBatch(
          event.track_id,
          { ...bounds, cursor: state.cursor },
          BATCH_SIZE,
        );
        if (state.kind === 'retention') state.eligible_count += state.pending_batch.length;
        await auditRepo.saveCleanup(event.event_id, state);
      }
      if (!state.pending_batch.length) {
        // Also repair manifests from an interrupted older cleanup. No additional
        // drafts are chosen if a retention policy has since been disabled.
        await manifests.discardOrphans(event.track_id, () => lease.assertOwned());
        await require('./snapshot-service').syncRegistryCounters(event.track_id);
        const completed = await auditRepo.saveCleanup(event.event_id, state, 'completed');
        return resultFor(completed);
      }

      while (state.pending_batch.length) {
        const candidate = state.pending_batch[0];
        await lease.assertOwned();
        const snapshot = await dynamicRepo.getSnapshotByModified(
          event.track_id,
          candidate.modified,
          IDENTITY_FIELDS,
        );
        if (!snapshot) {
          await manifests.discardUnreferenced(event.track_id, [candidate.content_manifest_id]);
          state.deleted_count += 1;
        } else {
          const latest = await dynamicRepo.getLatestSnapshot(event.track_id, 'modified');
          let reason =
            snapshot.version != null || !inBounds(snapshot, bounds)
              ? 'outside_current_policy'
              : await protection(event.track_id, snapshot, latest);
          if (!reason && snapshot.scheduled_materialization) {
            try {
              await exports.recordScheduledResult(snapshot);
            } catch {
              reason = 'scheduled_receipt_unavailable';
            }
          }
          if (reason) state.protected_count += 1;
          else {
            await lease.assertOwned();
            const deleted = await dynamicRepo.deleteHistoricalDraft(
              event.track_id,
              candidate,
              bounds,
              latest.modified,
            );
            if (deleted) {
              await manifests.discardUnreferenced(event.track_id, [candidate.content_manifest_id]);
              state.deleted_count += 1;
            } else state.protected_count += 1;
          }
        }
        state.cursor = iso(candidate.modified);
        state.pending_batch.shift();
        await auditRepo.saveCleanup(event.event_id, state);
      }
      await require('./snapshot-service').syncRegistryCounters(event.track_id);
    }
    return resultFor(await auditRepo.saveCleanup(event.event_id, state));
  } catch (error) {
    // Failure to record completion must still be visible, while the persisted
    // intent/page makes repair possible even if this response is lost.
    try {
      await auditRepo.saveCleanup(event.event_id, state, 'failed', error);
    } catch {
      /* Preserve the last durable page. */
    }
    return resultFor(event, state, 'failed', error.message);
  }
}
exports.runCleanup = runCleanup;

exports.prepareRetention = async function prepareRetention(snapshot, lease) {
  const registry = await virtualRegistry(snapshot.id);
  if (registry.draft_retention?.max_drafts == null) return null;
  await lease.assertOwned();
  // Insert before saving the new draft: an audit outage cannot produce a
  // successful creation with an undiscoverable/fabricated cleanup operation.
  return createIntent(
    snapshot.id,
    { kind: 'system' },
    {
      kind: 'retention',
      lower_bound: null,
      upper_bound: iso(snapshot.modified),
      target_modified: iso(snapshot.modified),
    },
  );
};

exports.afterDraft = async function afterDraft(snapshot, lease, event) {
  if (!event) return snapshot;
  event.cleanup = { ...stateFor(event), creation_complete: true };
  return { ...snapshot, draft_cleanup: await runCleanup(event, lease) };
};

exports.list = async function list(trackId) {
  await virtualRegistry(trackId);
  const events = await auditRepo.listCleanup(trackId);
  const data = await Promise.all(
    events.map(async (event) => {
      const state = { ...stateFor(event) };
      if (state.kind === 'squash') {
        const release = await dynamicRepo.getSnapshotByModified(
          trackId,
          event.request.target_modified,
          IDENTITY_FIELDS,
        );
        state.release_committed =
          release?.version != null && release.release_event_id === event.event_id;
      }
      return resultFor(event, state);
    }),
  );
  return { data };
};

exports.retry = async function retry(trackId, operationId, actor) {
  assertAdmin(actor);
  return require('./versioning-service').withReleaseLock(trackId, async (lease) => {
    await virtualRegistry(trackId);
    const event = await auditRepo.getCleanup(trackId, operationId);
    if (!event)
      throw new NotFoundError({ details: 'No cleanup intent exists for this track and operation' });
    if (event.status === 'completed') return resultFor(event);
    return runCleanup(event, lease);
  });
};
