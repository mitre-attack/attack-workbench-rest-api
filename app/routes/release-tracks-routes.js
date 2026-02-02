'use strict';

const express = require('express');

const releaseTracksController = require('../controllers/release-tracks-controller');
const authn = require('../lib/authn-middleware');
const authz = require('../lib/authz-middleware');

const router = express.Router();

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

/** Bump preview must be registered before :id/bump to avoid param conflict */
router
  .route('/release-tracks/:id/bump/preview')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    releaseTracksController.previewBump,
  );

router
  .route('/release-tracks/:id/meta')
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.updateMetadataByLatest,
  );

router
  .route('/release-tracks/:id/contents')
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.updateContentsByLatest,
  );

router
  .route('/release-tracks/:id/bump')
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.bumpByLatest,
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
// Virtual track operations (static snapshot sub-paths before :modified param)
// =============================================================================

router
  .route('/release-tracks/:id/snapshots/preview')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    releaseTracksController.previewVirtualSnapshot,
  );

router
  .route('/release-tracks/:id/snapshots/create')
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.createVirtualSnapshot,
  );

// =============================================================================
// Snapshot-specific operations (parameterised by :modified)
// =============================================================================

router
  .route('/release-tracks/:id/snapshots/:modified/meta')
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.updateMetadataByModified,
  );

router
  .route('/release-tracks/:id/snapshots/:modified/contents')
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.updateContentsByModified,
  );

router
  .route('/release-tracks/:id/snapshots/:modified/bump')
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.bumpByModified,
  );

router
  .route('/release-tracks/:id/snapshots/:modified/clone')
  .post(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.cloneByModified,
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
  .route('/release-tracks/:id/composition')
  .put(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.updateComposition,
  );

// =============================================================================
// Retrieve / delete release track (must be last -- :id is a catch-all param)
// =============================================================================

router
  .route('/release-tracks/:id')
  .get(
    authn.authenticate,
    authz.requireRole(authz.visitorOrHigher, authz.readOnlyService),
    releaseTracksController.retrieveLatestSnapshot,
  )
  .delete(
    authn.authenticate,
    authz.requireRole(authz.editorOrHigher),
    releaseTracksController.deleteReleaseTrack,
  );

module.exports = router;
