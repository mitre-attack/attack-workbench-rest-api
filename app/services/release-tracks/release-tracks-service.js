/* eslint-disable no-unused-vars */
// TODO remove the above eslint rule after all sub-services have been implemented
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
// Phase 6: Export, ephemeral                       → export-service, ephemeral-service (TODO)
// =============================================================================

const { NotImplementedError } = require('../../exceptions');
const snapshotService = require('./snapshot-service');
const standardTrackService = require('./standard-track-service');
const versioningService = require('./versioning-service');
const virtualTrackService = require('./virtual-track-service');

const MODULE = 'release-tracks-service';

function notImplemented(methodName) {
  throw new NotImplementedError(MODULE, methodName);
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

exports.createTrackFromBundle = async function createTrackFromBundle(_bundleData) {
  notImplemented('createTrackFromBundle');
};

exports.importTrack = async function importTrack(_data) {
  notImplemented('importTrack');
};

exports.getLatestSnapshot = function getLatestSnapshot(trackId, options) {
  return snapshotService.getLatestSnapshot(trackId, options);
};

exports.getSnapshotByModified = function getSnapshotByModified(trackId, modified, options) {
  return snapshotService.getSnapshotByModified(trackId, modified, options);
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
// Ephemeral  (Phase 6 → ephemeral-service, TODO)
// -----------------------------------------------------------------------------

exports.getEphemeralBundle = async function getEphemeralBundle(_domain, _format) {
  notImplemented('getEphemeralBundle');
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
