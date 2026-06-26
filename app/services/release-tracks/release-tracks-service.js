'use strict';

// =============================================================================
// Release Tracks Service Facade
//
// Orchestrator that delegates to domain-specific sub-services. This is the
// single entry point consumed by the controller layer.
//
// Phase 1: Track management, snapshot CRUD, config → snapshot-service
// Phase 2: Candidates, staged, object versions    → standard-track-service
// Phase 3: Auto-promotion, workflow               → workflow-service
// Phase 4: Bump/tag, versioning                   → versioning-service
// Phase 5: Virtual track composition              → virtual-track-service
// Phase 6: Export, ephemeral, bundle import        → export-service, ephemeral-service, bundle-import-service
// =============================================================================

const { NotImplementedError } = require('../../exceptions');
const snapshotService = require('./snapshot-service');
const standardTrackService = require('./standard-track-service');
const versioningService = require('./versioning-service');
const virtualTrackService = require('./virtual-track-service');
const exportService = require('./export-service');
const ephemeralService = require('./ephemeral-service');
const bundleImportService = require('./bundle-import-service');
const memberSyncService = require('./member-sync-service');
const attackObjectsService = require('../stix/attack-objects-service');
const userAccountsService = require('../system/user-accounts-service');

const MODULE = 'release-tracks-service';

function notImplemented(methodName) {
  throw new NotImplementedError(MODULE, methodName);
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

function addObjectInfo(entry, objectsByVersion, usersById) {
  const object = objectsByVersion.get(versionKey(entry.object_ref, entry.object_modified));
  const entryWithObjectInfo = {
    ...entry,
  };

  if (object) {
    entryWithObjectInfo.attack_id = object.workspace?.attack_id;
    entryWithObjectInfo.name = object.stix?.name;
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
  const candidates = snapshot.candidates || [];
  const staged = snapshot.staged || [];
  const tierEntries = [...candidates, ...staged];

  if (tierEntries.length === 0) {
    return snapshot;
  }

  const uniqueEntriesByVersion = new Map();
  for (const entry of tierEntries) {
    uniqueEntriesByVersion.set(versionKey(entry.object_ref, entry.object_modified), entry);
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
  if (snapshot.candidates) {
    snapshotWithObjectInfo.candidates = candidates.map((entry) =>
      addObjectInfo(entry, objectsByVersion, usersById),
    );
  }
  if (snapshot.staged) {
    snapshotWithObjectInfo.staged = staged.map((entry) =>
      addObjectInfo(entry, objectsByVersion, usersById),
    );
  }

  return snapshotWithObjectInfo;
}

// -----------------------------------------------------------------------------
// Track management  (Phase 1 → snapshot-service)
// -----------------------------------------------------------------------------

exports.listTracks = function listTracks(options) {
  return snapshotService.listTracks(options);
};

exports.createTrack = function createTrack(data) {
  return snapshotService.createTrack(data);
};

// Phase 6 → bundle-import-service
exports.createTrackFromBundle = function createTrackFromBundle(bundleData) {
  return bundleImportService.createTrackFromBundle(bundleData);
};

// eslint-disable-next-line no-unused-vars
exports.importTrack = async function importTrack(_data) {
  notImplemented('importTrack');
};

// Phase 6: Format-aware snapshot retrieval
// - 'snapshot' format (or no format): returns raw snapshot as stored
// - 'bundle'/'workbench' formats: hydrates and transforms via export-service
// - 'filesystemstore': blocked at controller level (NotImplementedError)
exports.getLatestSnapshot = async function getLatestSnapshot(trackId, options) {
  const snapshot = await snapshotService.getLatestSnapshot(trackId, options);
  const format = options?.format;
  if (format && format !== 'snapshot') {
    return exportService.exportSnapshot(snapshot, format, options);
  }
  return addObjectInfoToSnapshot(snapshot);
};

exports.getSnapshotByModified = async function getSnapshotByModified(trackId, modified, options) {
  const snapshot = await snapshotService.getSnapshotByModified(trackId, modified, options);
  const format = options?.format;
  if (format && format !== 'snapshot') {
    return exportService.exportSnapshot(snapshot, format, options);
  }
  return snapshot;
};

exports.updateMetadata = function updateMetadata(trackId, updates, userId) {
  return snapshotService.updateMetadata(trackId, updates, userId);
};

exports.updateMetadataByModified = function updateMetadataByModified(
  trackId,
  modified,
  updates,
  userId,
) {
  return snapshotService.updateMetadataByModified(trackId, modified, updates, userId);
};

exports.updateContents = function updateContents(trackId, contents, userId) {
  return snapshotService.updateContents(trackId, contents, userId);
};

exports.updateContentsByModified = function updateContentsByModified(
  trackId,
  modified,
  contents,
  userId,
) {
  return snapshotService.updateContentsByModified(trackId, modified, contents, userId);
};

exports.cloneTrack = function cloneTrack(trackId, options) {
  return snapshotService.cloneTrack(trackId, options);
};

exports.cloneFromSnapshot = function cloneFromSnapshot(trackId, modified, options) {
  return snapshotService.cloneFromSnapshot(trackId, modified, options);
};

exports.deleteTrack = function deleteTrack(trackId) {
  return snapshotService.deleteTrack(trackId);
};

exports.deleteSnapshot = function deleteSnapshot(trackId, modified) {
  return snapshotService.deleteSnapshot(trackId, modified);
};

// -----------------------------------------------------------------------------
// Ephemeral  (Phase 6 → ephemeral-service)
// -----------------------------------------------------------------------------

exports.getEphemeralBundle = function getEphemeralBundle(domain, format) {
  return ephemeralService.getEphemeralBundle(domain, format);
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

exports.removeCandidate = function removeCandidate(trackId, objectRef) {
  return standardTrackService.removeCandidate(trackId, objectRef);
};

exports.reviewCandidates = function reviewCandidates(trackId, reviewData, userId) {
  return standardTrackService.reviewCandidates(trackId, reviewData, userId);
};

exports.promoteCandidates = function promoteCandidates(trackId, objectRefs, userId) {
  return standardTrackService.promoteCandidates(trackId, objectRefs, userId);
};

exports.updateCandidateVersion = function updateCandidateVersion(trackId, objectRef, data) {
  return standardTrackService.updateCandidateVersion(trackId, objectRef, data);
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

exports.bumpLatest = function bumpLatest(trackId, options) {
  return versioningService.bumpLatest(trackId, options);
};

exports.bumpByModified = function bumpByModified(trackId, modified, options) {
  return versioningService.bumpByModified(trackId, modified, options);
};

exports.previewBump = function previewBump(trackId, format) {
  return versioningService.previewBump(trackId, format);
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
  return virtualTrackService.updateComposition(trackId, composition, userId);
};

exports.createVirtualSnapshot = function createVirtualSnapshot(trackId, options) {
  return virtualTrackService.createVirtualSnapshot(trackId, options);
};

exports.previewVirtualSnapshot = function previewVirtualSnapshot(trackId) {
  return virtualTrackService.previewVirtualSnapshot(trackId);
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
