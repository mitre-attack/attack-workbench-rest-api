'use strict';

const express = require('express');

const releaseTracksController = require('../controllers/release-tracks-controller');
const authn = require('../lib/authn-middleware');
const authz = require('../lib/authz-middleware');

const router = express.Router();

// Every `:id` route accepts either a canonical track ID or a track alias.
router.param('id', releaseTracksController.resolveTrackId);

// =============================================================================
// Ephemeral (stateless) bundles
// =============================================================================

router
  .route('/release-tracks/ephemeral/:domain')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    releaseTracksController.retrieveEphemeralByDomain,
  );

// =============================================================================
// Track management (static paths before :id param)
// =============================================================================

router
  .route('/release-tracks')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    releaseTracksController.listReleaseTracks,
  );

router
  .route('/release-tracks/objects/:objectRef/releases')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    releaseTracksController.getReleasesByObject,
  );

router
  .route('/release-tracks/new')
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.createReleaseTrack,
  );

router
  .route('/release-tracks/new-from-bundle')
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.createReleaseTrackFromBundle,
  );

router
  .route('/release-tracks/import')
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.importReleaseTrack,
  );

// =============================================================================
// Latest snapshot operations (parameterised by :id)
// =============================================================================

router
  .route('/release-tracks/:id/meta')
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.updateMetadataByLatest,
  );

router
  .route('/release-tracks/:id/clone')
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.cloneByLatest,
  );

// =============================================================================
// Candidate management (static sub-paths before :objectRef param)
// =============================================================================

router
  .route('/release-tracks/:id/candidates/review')
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.reviewCandidates,
  );

router
  .route('/release-tracks/:id/candidates/promote')
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.promoteCandidates,
  );

router
  .route('/release-tracks/:id/candidates/:objectRef/update-version')
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.updateCandidateVersion,
  );

router
  .route('/release-tracks/:id/candidates/:objectRef')
  .delete(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.removeCandidate,
  );

router
  .route('/release-tracks/:id/candidates')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    releaseTracksController.listCandidates,
  )
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.addCandidates,
  );

// =============================================================================
// Staged objects
// =============================================================================

router
  .route('/release-tracks/:id/staged/demote')
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.demoteStaged,
  );

router
  .route('/release-tracks/:id/staged')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    releaseTracksController.listStaged,
  );

// =============================================================================
// Configuration
// =============================================================================

router
  .route('/release-tracks/:id/config')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    releaseTracksController.getConfig,
  )
  .put(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.updateConfig,
  );

// =============================================================================
// Object version history
// =============================================================================

router
  .route('/release-tracks/:id/objects/:objectRef/versions')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    releaseTracksController.listObjectVersions,
  );

// =============================================================================
// Snapshot collection and static sub-paths (before :modified param)
// =============================================================================

router
  .route('/release-tracks/:id/snapshots')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    releaseTracksController.listSnapshots,
  );

router
  .route('/release-tracks/:id/snapshots/latest')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, [
      authz.serviceRoles.readOnly,
      authz.serviceRoles.stixExport,
    ]),
    releaseTracksController.retrieveLatestSnapshot,
  );

router
  .route('/release-tracks/:id/snapshots/latest/release/preview')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    releaseTracksController.previewLatestRelease,
  );

router
  .route('/release-tracks/:id/snapshots/latest/release')
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.releaseLatest,
  );

router
  .route('/release-tracks/:id/virtual/snapshots/create')
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.createVirtualSnapshot,
  );

router
  .route('/release-tracks/:id/virtual/quarantine/promote')
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.promoteQuarantinedObject,
  );

// =============================================================================
// Snapshot-specific read, release, clone, and deletion operations
// =============================================================================

router
  .route('/release-tracks/:id/snapshots/:modified/description')
  .put(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.updateSnapshotDescription,
  );

router
  .route('/release-tracks/:id/snapshots/:modified/release/preview')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    releaseTracksController.previewReleaseByModified,
  );

router
  .route('/release-tracks/:id/snapshots/:modified/release')
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.releaseByModified,
  )
  .put(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.retagRelease,
  );

router
  .route('/release-tracks/:id/snapshots/:modified/draft')
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.convertReleaseToDraft,
  );

router
  .route('/release-tracks/:id/snapshots/:modified/clone')
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.cloneByModified,
  );

router
  .route('/release-tracks/:id/snapshots/:modified/graph/reconstruct')
  .post(
    authn.authenticate,
    authz.requireRole(authz.admin),
    releaseTracksController.reconstructSnapshotManifest,
  );

router
  .route('/release-tracks/:id/snapshots/:modified')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    releaseTracksController.retrieveSnapshotByModified,
  )
  .delete(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.deleteSnapshotByModified,
  );

// =============================================================================
// Virtual track composition
// =============================================================================

router
  .route('/release-tracks/:id/virtual/composition')
  .put(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.updateComposition,
  );

router
  .route('/release-tracks/:id/virtual/schedule')
  .put(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.updateSchedule,
  );

router
  .route('/release-tracks/:id/virtual/draft-retention')
  .put(
    authn.authenticate,
    authz.requireRole(authz.admin),
    releaseTracksController.updateDraftRetention,
  );

router
  .route('/release-tracks/:id/virtual/draft-cleanup')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    releaseTracksController.listDraftCleanup,
  );

router
  .route('/release-tracks/:id/virtual/draft-cleanup/:operationId/retry')
  .post(
    authn.authenticate,
    authz.requireRole(authz.admin),
    releaseTracksController.retryDraftCleanup,
  );

// =============================================================================
// Delete release track (must be last -- :id is a catch-all param)
// =============================================================================

router
  .route('/release-tracks/:id')
  .delete(
    authn.authenticate,
    authz.requireRole(authz.admin),
    releaseTracksController.deleteReleaseTrack,
  );

module.exports = router;
