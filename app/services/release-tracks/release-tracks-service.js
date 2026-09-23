'use strict';

// =============================================================================
// Release Tracks Service Facade
//
// Orchestrator that delegates to domain-specific sub-services. This is the
// single entry point consumed by the controller layer.
//
// Phase 1: Track management, snapshot lifecycle, config → snapshot-service
// Phase 2: Candidates, staged, object versions    → standard-track-service
// Phase 3: Auto-promotion, workflow               → workflow-service
// Phase 4: Release planning and versioning        → versioning-service
// Phase 5: Virtual track composition              → virtual-track-service
// Phase 6: Export, ephemeral, bundle import        → export-service, ephemeral-service, bundle-import-service
// =============================================================================

const {
  BadRequestError,
  InsufficientRoleError,
  NotImplementedError,
  ReleaseConflictError,
} = require('../../exceptions');
const authz = require('../../lib/authz-middleware');
const {
  compositionSchema,
  snapshotScheduleSchema,
  scheduledMaterializationSchema,
} = require('../../lib/release-tracks/release-track-schemas');
const snapshotService = require('./snapshot-service');
const standardTrackService = require('./standard-track-service');
const versioningService = require('./versioning-service');
const virtualTrackService = require('./virtual-track-service');
const exportService = require('./export-service');
const primaryRevisionService = require('./primary-revision-service');
const ephemeralService = require('./ephemeral-service');
const bundleImportService = require('./bundle-import-service');
const memberSyncService = require('./member-sync-service');
const releaseHistoryService = require('./release-history-service');
const destructiveAuditService = require('./destructive-audit-service');
const draftCleanupService = require('./draft-cleanup-service');
const attackObjectsService = require('../stix/attack-objects-service');
const userAccountsService = require('../system/user-accounts-service');
const revisionReference = require('../../lib/release-tracks/revision-reference');

const MODULE = 'release-tracks-service';
const TIER_NAMES = ['members', 'staged', 'candidates', 'quarantine'];

function notImplemented(methodName) {
  throw new NotImplementedError(MODULE, methodName);
}

function validateScheduledMaterialization(value) {
  const scheduledFor = value?.scheduled_for;
  const normalizedValue =
    scheduledFor instanceof Date && !Number.isNaN(scheduledFor.getTime())
      ? { ...value, scheduled_for: scheduledFor.toISOString() }
      : value;
  const result = scheduledMaterializationSchema.safeParse(normalizedValue);
  if (!result.success) {
    throw new BadRequestError({
      message: 'Invalid scheduled materialization',
      details: result.error.errors,
    });
  }
  return result.data;
}

function destructiveIdentity(trackId, actor, confirmation) {
  return {
    actor: actor || {
      kind: 'system',
      name: 'internal-service',
    },
    confirmation: confirmation || trackId,
  };
}

function rejectFilesystemStoreFormat(format, methodName) {
  if (format !== 'filesystemstore') return;

  throw new NotImplementedError(MODULE, methodName, {
    message: 'The filesystemstore format is not yet implemented',
  });
}

function versionKey(objectRef, objectModified) {
  return `${objectRef}:${new Date(objectModified).toISOString()}`;
}

function getTierUserId(entry) {
  return entry.object_added_by || entry.object_staged_by;
}

function formatUser(user) {
  if (!user) return undefined;

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    name: user.displayName || user.username,
  };
}

async function getUsersById(userIds) {
  const usersById = new Map();

  await Promise.all(
    userIds.map(async (userId) => {
      if (userId === 'system') {
        usersById.set(userId, { id: userId, username: userId });
        return;
      }

      const user = await userAccountsService.getLatest(userId);
      if (user) {
        usersById.set(userId, user);
      }
    }),
  );

  return usersById;
}

// Resolve each distinct creator once per response, including paginated history.
// Keep a missing/deleted user's ID without exposing account security metadata.
async function addCreationActors(snapshots) {
  const ids = [
    ...new Set(
      snapshots
        .filter((snapshot) => snapshot.creation_actor?.kind === 'user')
        .map((snapshot) => snapshot.creation_actor.user_account_id)
        .filter(Boolean),
    ),
  ];
  const users = await getUsersById(ids);
  return snapshots.map((snapshot) => {
    const actor = snapshot.creation_actor || { kind: 'unknown' };
    snapshot.creation_actor =
      actor.kind === 'user'
        ? {
            kind: actor.kind,
            user_account_id: actor.user_account_id,
            user: formatUser(users.get(actor.user_account_id)),
          }
        : { kind: actor.kind };
    return snapshot;
  });
}

function selectorKey(entry) {
  return `${entry.object_ref}:${revisionReference.modifiedKey(entry.object_modified)}`;
}

function addObjectInfo(entry, resolvedModifiedBySelector, objectsByVersion, usersById) {
  const resolvedModified = resolvedModifiedBySelector.get(selectorKey(entry));
  const object = resolvedModified
    ? objectsByVersion.get(versionKey(entry.object_ref, resolvedModified))
    : undefined;
  const entryWithObjectInfo = {
    ...entry,
  };

  if (object) {
    entryWithObjectInfo.attack_id = object.workspace?.attack_id;
    entryWithObjectInfo.name = object.stix?.name;
    entryWithObjectInfo.type = object.stix?.type;
    entryWithObjectInfo.x_mitre_version = object.stix?.x_mitre_version;
  }

  if (object?.stix?.description !== undefined) {
    entryWithObjectInfo.description = object.stix.description;
  }

  const user = object?.created_by_user_account || usersById.get(getTierUserId(entry));
  if (user) {
    entryWithObjectInfo.modified_by_user = formatUser(user);
  }

  return entryWithObjectInfo;
}

async function addObjectInfoToSnapshot(snapshot) {
  const tierEntries = TIER_NAMES.flatMap((tierName) => snapshot[tierName] || []);

  if (tierEntries.length === 0) {
    return snapshot;
  }

  const resolvedEntries = await revisionReference.resolveEntries(tierEntries);
  const resolvedModifiedBySelector = new Map();
  const uniqueEntriesByVersion = new Map();
  for (let index = 0; index < tierEntries.length; index++) {
    const entry = tierEntries[index];
    const resolvedEntry = resolvedEntries[index];
    resolvedModifiedBySelector.set(selectorKey(entry), resolvedEntry.object_modified);
    uniqueEntriesByVersion.set(
      versionKey(resolvedEntry.object_ref, resolvedEntry.object_modified),
      resolvedEntry,
    );
  }

  const objects = await attackObjectsService.getBulkByIdAndModified([
    ...uniqueEntriesByVersion.values(),
  ]);
  const objectsByVersion = new Map(
    objects.map((object) => [versionKey(object.stix.id, object.stix.modified), object]),
  );
  const userIds = [...new Set(tierEntries.map(getTierUserId).filter(Boolean))];
  const usersById = await getUsersById(userIds);

  const snapshotWithObjectInfo = { ...snapshot };
  for (const tierName of TIER_NAMES) {
    if (snapshot[tierName]) {
      snapshotWithObjectInfo[tierName] = snapshot[tierName].map((entry) =>
        addObjectInfo(entry, resolvedModifiedBySelector, objectsByVersion, usersById),
      );
    }
  }

  return snapshotWithObjectInfo;
}

function filterSnapshotTiers(snapshot, include) {
  if (!include || include === 'all') return snapshot;

  const includedTiers = new Set(['members', include]);
  const filtered = { ...snapshot };

  for (const tierName of TIER_NAMES) {
    if (!includedTiers.has(tierName)) {
      delete filtered[tierName];
    }
  }

  return filtered;
}

async function formatWorkbenchSnapshot(snapshot, options) {
  const include = options?.include;
  const selectedTiers =
    !include || include === 'all' ? TIER_NAMES : [...new Set(['members', include])];
  await primaryRevisionService.assertStoredEntries(
    selectedTiers.flatMap((tierName) => snapshot[tierName] || []),
  );
  const enriched = await addObjectInfoToSnapshot(snapshot);
  const [attributed] = await addCreationActors([enriched]);
  // Registry-derived, read-only metadata used alongside snapshot content.
  const metadata = await snapshotService.getTrackMetadata(snapshot.id);
  attributed.alias = metadata.alias;
  attributed.creation_cause = snapshot.creation_cause || 'unknown';
  if (snapshot.type === 'virtual') {
    attributed.snapshot_schedule = metadata.snapshot_schedule || { mode: 'manual' };
    attributed.draft_retention = metadata.draft_retention;
    attributed.snapshot_count = metadata.snapshot_count;
    attributed.tagged_release_count = metadata.tagged_release_count;
  }
  return filterSnapshotTiers(attributed, options?.include);
}

exports.resolveTrackAlias = function resolveTrackAlias(alias) {
  return snapshotService.resolveTrackAlias(alias);
};

// -----------------------------------------------------------------------------
// Track management  (Phase 1 → snapshot-service)
// -----------------------------------------------------------------------------

exports.listTracks = function listTracks(options) {
  return snapshotService.listTracks(options);
};

exports.getReleasesByObject = function getReleasesByObject(objectRef, options) {
  return releaseHistoryService.getReleasesByObject(objectRef, options);
};

exports.createTrack = async function createTrack(data) {
  let validatedData = data;
  if (data.draft_retention !== undefined) {
    validatedData = {
      ...validatedData,
      draft_retention: draftCleanupService.validatePolicy(
        data.draft_retention,
        data.actor,
        data.type,
      ),
    };
  }

  if (data.scheduled_materialization !== undefined) {
    if (data.type !== 'virtual') {
      throw new BadRequestError({
        message: 'Scheduled materialization is only available for virtual release tracks',
      });
    }

    const materializationResult = scheduledMaterializationSchema.safeParse(
      data.scheduled_materialization,
    );
    if (!materializationResult.success) {
      throw new BadRequestError({
        message: 'Invalid scheduled materialization',
        details: materializationResult.error.errors,
      });
    }
    validatedData = {
      ...validatedData,
      scheduled_materialization: materializationResult.data,
    };
  }

  if (data.snapshot_schedule !== undefined) {
    if (data.type !== 'virtual') {
      throw new BadRequestError({
        message: 'Snapshot schedules are only available for virtual release tracks',
      });
    }

    const scheduleResult = snapshotScheduleSchema.safeParse(data.snapshot_schedule);
    if (!scheduleResult.success) {
      throw new BadRequestError({
        message: 'Invalid snapshot schedule',
        details: scheduleResult.error.errors,
      });
    }
    validatedData = { ...validatedData, snapshot_schedule: scheduleResult.data };
  }

  if (validatedData.composition !== undefined) {
    const compositionResult = compositionSchema.safeParse(validatedData.composition);
    if (!compositionResult.success) {
      throw new BadRequestError({
        message: 'Invalid virtual track composition',
        details: compositionResult.error.errors,
      });
    }
    validatedData = { ...validatedData, composition: compositionResult.data };
  }

  if (validatedData.type === 'virtual' && validatedData.composition) {
    await virtualTrackService.validateComposition(validatedData.composition);
  }

  return snapshotService.createTrack(validatedData);
};

// Phase 6 → bundle-import-service
exports.createTrackFromBundle = function createTrackFromBundle(bundleData, userId) {
  return bundleImportService.createTrackFromBundle(bundleData, userId);
};

exports.listSnapshots = async function listSnapshots(trackId, options) {
  const result = await snapshotService.listSnapshots(trackId, options);
  return { ...result, data: await addCreationActors(result.data) };
};

// eslint-disable-next-line no-unused-vars
exports.importTrack = async function importTrack(_data) {
  notImplemented('importTrack');
};

// Phase 6: Format-aware snapshot retrieval
// - 'workbench' format (or no format): returns enriched release-track snapshot
// - 'bundle' format: hydrates members and transforms via export-service
// - 'filesystemstore': blocked before delegation (NotImplementedError)
exports.getLatestSnapshot = async function getLatestSnapshot(trackId, options) {
  const snapshot = await snapshotService.getLatestSnapshot(trackId, options);
  const format = options?.format;
  rejectFilesystemStoreFormat(format, 'getLatestSnapshot');

  if (format === 'bundle') {
    return exportService.exportSnapshot(snapshot, format, options);
  }
  return formatWorkbenchSnapshot(snapshot, options);
};

exports.getSnapshotByModified = async function getSnapshotByModified(trackId, modified, options) {
  const snapshot = await snapshotService.getSnapshotByModified(trackId, modified, options);
  const format = options?.format;
  rejectFilesystemStoreFormat(format, 'getSnapshotByModified');

  if (format === 'bundle') {
    return exportService.exportSnapshot(snapshot, format, options);
  }
  return formatWorkbenchSnapshot(snapshot, options);
};

exports.updateMetadata = function updateMetadata(trackId, updates, userId) {
  return snapshotService.updateMetadata(trackId, updates, userId);
};

exports.updateSnapshotDescription = function updateSnapshotDescription(
  trackId,
  modified,
  description,
) {
  return snapshotService.updateSnapshotDescription(trackId, modified, description);
};

exports.cloneTrack = function cloneTrack(trackId, options) {
  return snapshotService.cloneTrack(trackId, options);
};

exports.cloneFromSnapshot = function cloneFromSnapshot(trackId, modified, options) {
  return snapshotService.cloneFromSnapshot(trackId, modified, options);
};

exports.deleteTrack = function deleteTrack(trackId, actor, confirmation) {
  return versioningService.withReleaseLock(trackId, (lease) =>
    destructiveAuditService.execute(
      {
        action: 'delete_track',
        trackId,
        ...destructiveIdentity(trackId, actor, confirmation),
        request: {},
        result: () => ({ deleted: true }),
      },
      () => snapshotService.deleteTrack(trackId, lease),
    ),
  );
};

/**
 * Delete drafts only. Share the release lock with tagging and materialization
 * so a draft cannot become released between validation and deletion.
 */
exports.deleteSnapshot = function deleteSnapshot(trackId, modified) {
  return versioningService.withReleaseLock(trackId, () =>
    snapshotService.deleteSnapshot(trackId, modified),
  );
};

/** Convert the latest tagged release back to a draft, with admin confirmation. */
exports.convertReleaseToDraft = async function convertReleaseToDraft(
  trackId,
  modified,
  options = {},
) {
  return versioningService.withReleaseLock(trackId, async () => {
    const snapshot = await snapshotService.getSnapshotByModified(trackId, modified);
    if (options.actor?.role !== authz.userRoles.admin) {
      throw new InsufficientRoleError('administrator', {
        details: 'Converting a release to a draft requires an administrator.',
        track_id: trackId,
        version: snapshot.version,
      });
    }
    if (snapshot.version == null) {
      throw new ReleaseConflictError('The selected snapshot is already a draft', {
        track_id: trackId,
      });
    }
    if (options.confirmation !== snapshot.version) {
      throw new BadRequestError({
        message: 'Release conversion confirmation is required',
        details: `Set confirm_version to the exact release version '${snapshot.version}'.`,
        parameter_name: 'confirm_version',
        expected_version: snapshot.version,
      });
    }

    return destructiveAuditService.execute(
      {
        action: 'convert_release_to_draft',
        trackId,
        ...destructiveIdentity(trackId, options.actor, options.confirmation),
        request: { snapshot_modified: new Date(snapshot.modified).toISOString() },
      },
      () => snapshotService.convertReleaseToDraft(trackId, modified),
    );
  });
};

exports.reconstructSnapshotManifest = function reconstructSnapshotManifest(
  trackId,
  modified,
  plan,
) {
  return snapshotService.reconstructManifest(trackId, modified, plan);
};

// -----------------------------------------------------------------------------
// Ephemeral  (Phase 6 → ephemeral-service)
// -----------------------------------------------------------------------------

exports.getEphemeralBundle = function getEphemeralBundle(domain, options) {
  rejectFilesystemStoreFormat(options?.format, 'getEphemeralBundle');
  return ephemeralService.getEphemeralBundle(domain, options);
};

// -----------------------------------------------------------------------------
// Candidates  (Phase 2 → standard-track-service)
// -----------------------------------------------------------------------------

exports.addCandidates = function addCandidates(trackId, objectRefs, userId) {
  return standardTrackService.addCandidates(trackId, objectRefs, userId);
};

exports.listCandidates = function listCandidates(trackId, options) {
  return standardTrackService.listCandidates(trackId, options);
};

exports.removeCandidate = function removeCandidate(trackId, objectRef, userId) {
  return standardTrackService.removeCandidate(trackId, objectRef, userId);
};

exports.reviewCandidates = function reviewCandidates(trackId, reviewData, userId) {
  return standardTrackService.reviewCandidates(trackId, reviewData, userId);
};

exports.promoteCandidates = function promoteCandidates(trackId, objectRefs, userId) {
  return standardTrackService.promoteCandidates(trackId, objectRefs, userId);
};

exports.updateCandidateVersion = function updateCandidateVersion(trackId, objectRef, data, userId) {
  return standardTrackService.updateCandidateVersion(trackId, objectRef, data, userId);
};

// -----------------------------------------------------------------------------
// Staged  (Phase 2 → standard-track-service)
// -----------------------------------------------------------------------------

exports.listStaged = function listStaged(trackId) {
  return standardTrackService.listStaged(trackId);
};

exports.demoteStaged = function demoteStaged(trackId, objectRefs, userId) {
  return standardTrackService.demoteStaged(trackId, objectRefs, userId);
};

// -----------------------------------------------------------------------------
// Versioning  (Phase 4 → versioning-service)
// -----------------------------------------------------------------------------

exports.releaseLatest = function releaseLatest(trackId, options) {
  return versioningService.releaseLatest(trackId, options);
};

exports.releaseByModified = function releaseByModified(trackId, modified, options) {
  return versioningService.releaseByModified(trackId, modified, options);
};

exports.retagRelease = async function retagRelease(trackId, modified, nextVersion, actor) {
  return versioningService.withReleaseLock(trackId, async () => {
    const snapshot = await snapshotService.getSnapshotByModified(trackId, modified);
    if (actor?.role !== authz.userRoles.admin) {
      throw new InsufficientRoleError('administrator', {
        details: 'Changing a release version requires an administrator.',
        track_id: trackId,
        version: snapshot.version,
      });
    }

    return destructiveAuditService.execute(
      {
        action: 'retag_release',
        trackId,
        ...destructiveIdentity(trackId, actor, snapshot.version),
        request: {
          snapshot_modified: new Date(snapshot.modified).toISOString(),
          previous_version: snapshot.version,
          next_version: nextVersion,
        },
      },
      () => versioningService.retagReleaseLocked(trackId, modified, nextVersion),
    );
  });
};

async function renderReleasePlan(plan, options) {
  const format = options.format || 'summary';
  rejectFilesystemStoreFormat(format, 'previewRelease');

  if (format === 'summary') return plan.summary;
  if (plan.blockingError) throw plan.blockingError;
  if (format === 'bundle') {
    return exportService.exportSnapshot(plan.plannedSnapshot, format, {
      ...options,
      // The planned snapshot is unsaved and has no sealed manifest yet, so a
      // preview resolves the same closed-member graph the commit would seal.
      resolveLive: true,
    });
  }
  return formatWorkbenchSnapshot(plan.plannedSnapshot, options);
}

exports.previewLatestRelease = async function previewLatestRelease(trackId, options) {
  const plan = await versioningService.planLatestRelease(trackId, options);
  return renderReleasePlan(plan, options);
};

exports.previewReleaseByModified = async function previewReleaseByModified(
  trackId,
  modified,
  options,
) {
  const plan = await versioningService.planReleaseByModified(trackId, modified, options);
  return renderReleasePlan(plan, options);
};

// -----------------------------------------------------------------------------
// Configuration  (Phase 1 → snapshot-service)
// -----------------------------------------------------------------------------

exports.getConfig = function getConfig(trackId) {
  return snapshotService.getConfig(trackId);
};

exports.updateConfig = function updateConfig(trackId, config, userId) {
  return snapshotService.updateConfig(trackId, config, userId);
};

// -----------------------------------------------------------------------------
// Virtual tracks  (Phase 5 → virtual-track-service)
// -----------------------------------------------------------------------------

exports.updateComposition = function updateComposition(trackId, composition, userId) {
  const { scheduled_materialization: scheduledMaterialization, ...compositionData } =
    composition || {};
  let validatedScheduledMaterialization = scheduledMaterialization;
  const compositionResult = compositionSchema.safeParse(compositionData);
  if (!compositionResult.success) {
    throw new BadRequestError({
      message: 'Invalid virtual track composition',
      details: compositionResult.error.errors,
    });
  }
  if (scheduledMaterialization !== undefined) {
    validatedScheduledMaterialization = validateScheduledMaterialization(scheduledMaterialization);
  }
  return virtualTrackService.updateComposition(trackId, compositionResult.data, userId, {
    scheduledMaterialization: validatedScheduledMaterialization,
  });
};

exports.updateSchedule = function updateSchedule(trackId, schedule) {
  const scheduleResult = snapshotScheduleSchema.safeParse(schedule);
  if (!scheduleResult.success) {
    throw new BadRequestError({
      message: 'Invalid snapshot schedule',
      details: scheduleResult.error.errors,
    });
  }
  return virtualTrackService.updateSchedule(trackId, scheduleResult.data);
};

exports.updateDraftRetention = draftCleanupService.updatePolicy;
exports.listDraftCleanup = draftCleanupService.list;
exports.retryDraftCleanup = draftCleanupService.retry;

exports.createVirtualSnapshot = function createVirtualSnapshot(trackId, options) {
  let validatedOptions = options;
  if (options?.scheduledMaterialization !== undefined) {
    validatedOptions = {
      ...options,
      scheduledMaterialization: validateScheduledMaterialization(options.scheduledMaterialization),
    };
  }
  return virtualTrackService.createVirtualSnapshot(trackId, validatedOptions);
};

exports.promoteQuarantinedObject = function promoteQuarantinedObject(trackId, selection, userId) {
  return virtualTrackService.promoteQuarantinedObject(trackId, selection, userId);
};

// -----------------------------------------------------------------------------
// Object versions  (Phase 2 → standard-track-service)
// -----------------------------------------------------------------------------

exports.listObjectVersions = function listObjectVersions(trackId, objectRef) {
  return standardTrackService.listObjectVersions(trackId, objectRef);
};

// -----------------------------------------------------------------------------
// Member sync  (Phase 7 → member-sync-service)
//
// Member sync auto-initializes when this module is loaded via the
// memberSyncService import. It subscribes to all STIX object created/updated
// events on the EventBus and automatically enrolls new object revisions
// as candidates when the object is a member of a release track.
// -----------------------------------------------------------------------------

/**
 * Manually trigger member sync for a STIX object modification.
 * Typically not needed since member-sync-service subscribes to EventBus events
 * automatically. Useful for testing or manual re-processing.
 */
exports.handleObjectModified = function handleObjectModified(event) {
  return memberSyncService.handleObjectModified(event);
};
