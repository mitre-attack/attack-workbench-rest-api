/* eslint-disable no-unused-vars */
// TODO remove the above eslint rule after all functions have been implemented
'use strict';

// =============================================================================
// Release Tracks Service Facade
//
// Orchestrator that delegates to domain-specific sub-services. This is the
// single entry point consumed by the controller layer.
//
// All methods currently throw NotImplementedError. Sub-services (WS3-WS7)
// will provide real implementations progressively.
// =============================================================================

const { NotImplementedError } = require('../../exceptions');

const MODULE = 'release-tracks-service';

function notImplemented(methodName) {
  throw new NotImplementedError(MODULE, methodName);
}

// -----------------------------------------------------------------------------
// Track management
// -----------------------------------------------------------------------------

exports.listTracks = async function listTracks(_options) {
  notImplemented('listTracks');
};

exports.createTrack = async function createTrack(_data) {
  notImplemented('createTrack');
};

exports.createTrackFromBundle = async function createTrackFromBundle(_bundleData) {
  notImplemented('createTrackFromBundle');
};

exports.importTrack = async function importTrack(_data) {
  notImplemented('importTrack');
};

exports.getLatestSnapshot = async function getLatestSnapshot(_trackId, _options) {
  notImplemented('getLatestSnapshot');
};

exports.getSnapshotByModified = async function getSnapshotByModified(
  _trackId,
  _modified,
  _options,
) {
  notImplemented('getSnapshotByModified');
};

exports.updateMetadata = async function updateMetadata(_trackId, _updates, _userId) {
  notImplemented('updateMetadata');
};

exports.updateMetadataByModified = async function updateMetadataByModified(
  _trackId,
  _modified,
  _updates,
  _userId,
) {
  notImplemented('updateMetadataByModified');
};

exports.updateContents = async function updateContents(_trackId, _contents, _userId) {
  notImplemented('updateContents');
};

exports.updateContentsByModified = async function updateContentsByModified(
  _trackId,
  _modified,
  _contents,
  _userId,
) {
  notImplemented('updateContentsByModified');
};

exports.cloneTrack = async function cloneTrack(_trackId, _options) {
  notImplemented('cloneTrack');
};

exports.cloneFromSnapshot = async function cloneFromSnapshot(_trackId, _modified, _options) {
  notImplemented('cloneFromSnapshot');
};

exports.deleteTrack = async function deleteTrack(_trackId) {
  notImplemented('deleteTrack');
};

exports.deleteSnapshot = async function deleteSnapshot(_trackId, _modified) {
  notImplemented('deleteSnapshot');
};

// -----------------------------------------------------------------------------
// Ephemeral
// -----------------------------------------------------------------------------

exports.getEphemeralBundle = async function getEphemeralBundle(_domain, _format) {
  notImplemented('getEphemeralBundle');
};

// -----------------------------------------------------------------------------
// Candidates
// -----------------------------------------------------------------------------

exports.addCandidates = async function addCandidates(_trackId, _objectRefs, _userId) {
  notImplemented('addCandidates');
};

exports.listCandidates = async function listCandidates(_trackId, _options) {
  notImplemented('listCandidates');
};

exports.removeCandidate = async function removeCandidate(_trackId, _objectRef) {
  notImplemented('removeCandidate');
};

exports.reviewCandidates = async function reviewCandidates(_trackId, _reviewData, _userId) {
  notImplemented('reviewCandidates');
};

exports.promoteCandidates = async function promoteCandidates(_trackId, _objectRefs, _userId) {
  notImplemented('promoteCandidates');
};

exports.updateCandidateVersion = async function updateCandidateVersion(
  _trackId,
  _objectRef,
  _data,
) {
  notImplemented('updateCandidateVersion');
};

// -----------------------------------------------------------------------------
// Staged
// -----------------------------------------------------------------------------

exports.listStaged = async function listStaged(_trackId) {
  notImplemented('listStaged');
};

exports.demoteStaged = async function demoteStaged(_trackId, _objectRefs, _userId) {
  notImplemented('demoteStaged');
};

// -----------------------------------------------------------------------------
// Versioning
// -----------------------------------------------------------------------------

exports.bumpLatest = async function bumpLatest(_trackId, _options) {
  notImplemented('bumpLatest');
};

exports.bumpByModified = async function bumpByModified(_trackId, _modified, _options) {
  notImplemented('bumpByModified');
};

exports.previewBump = async function previewBump(_trackId, _format) {
  notImplemented('previewBump');
};

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

exports.getConfig = async function getConfig(_trackId) {
  notImplemented('getConfig');
};

exports.updateConfig = async function updateConfig(_trackId, _config, _userId) {
  notImplemented('updateConfig');
};

// -----------------------------------------------------------------------------
// Virtual tracks
// -----------------------------------------------------------------------------

exports.updateComposition = async function updateComposition(_trackId, _composition, _userId) {
  notImplemented('updateComposition');
};

exports.createVirtualSnapshot = async function createVirtualSnapshot(_trackId, _options) {
  notImplemented('createVirtualSnapshot');
};

exports.previewVirtualSnapshot = async function previewVirtualSnapshot(_trackId) {
  notImplemented('previewVirtualSnapshot');
};

// -----------------------------------------------------------------------------
// Object versions
// -----------------------------------------------------------------------------

exports.listObjectVersions = async function listObjectVersions(_trackId, _objectRef) {
  notImplemented('listObjectVersions');
};
