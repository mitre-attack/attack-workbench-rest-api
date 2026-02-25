'use strict';

// =============================================================================
// Release Tracks Controller
//
// Request parsing, Zod validation, and delegation to the service facade.
// Each handler follows the pattern established in collections-controller-v2.js:
//   1. Validate path params / query params / body with Zod safeParse
//   2. On failure, forward a typed error via next()
//   3. Build options, delegate to service facade
//   4. Return appropriate HTTP status
//   5. Forward unexpected errors to centralized error handler via next()
// =============================================================================

const releaseTracksService = require('../services/release-tracks/release-tracks-service');
const logger = require('../lib/logger');
const {
  InvalidQueryStringParameterError,
  BadRequestError,
  NotImplementedError,
} = require('../exceptions');
const {
  domainParamSchema,
  formatQuerySchema,
  includeQuerySchema,
  trackTypeQuerySchema,
  workflowStatusSchema,
  createTrackBodySchema,
  createFromBundleBodySchema,
  updateMetadataBodySchema,
  updateContentsBodySchema,
  bumpBodySchema,
  cloneBodySchema,
  addCandidatesBodySchema,
  reviewCandidatesBodySchema,
  promoteCandidatesBodySchema,
  demoteStagedBodySchema,
  updateCandidateVersionBodySchema,
  updateConfigBodySchema,
  updateCompositionBodySchema,
  createVirtualSnapshotBodySchema,
  xMitreVersionSchema,
} = require('../lib/release-tracks/release-track-schemas');

// =============================================================================
// Helpers
// =============================================================================

/**
 * Parse an optional query parameter with a Zod schema, returning the parsed
 * value on success or a default value on failure/absence.
 */
function parseOptionalQuery(value, schema, defaultValue) {
  if (value === undefined || value === null) return defaultValue;
  const result = schema.safeParse(value);
  return result.success ? result.data : defaultValue;
}

/**
 * Parse common query parameters shared across GET snapshot endpoints.
 */
function parseSnapshotQueryParams(query) {
  return {
    format: parseOptionalQuery(query.format, formatQuerySchema, 'snapshot'),
    include: parseOptionalQuery(query.include, includeQuerySchema, undefined),
    releases: query.releases === 'only' ? 'only' : undefined,
    version: parseOptionalQuery(query.version, xMitreVersionSchema, undefined),
    versions: query.versions === 'all' ? 'all' : undefined,
    limit: query.limit ? parseInt(query.limit, 10) : undefined,
    offset: query.offset ? parseInt(query.offset, 10) : undefined,
  };
}

// =============================================================================
// Ephemeral
// =============================================================================

/** GET /api/release-tracks/ephemeral/:domain */
exports.retrieveEphemeralByDomain = async function retrieveEphemeralByDomain(req, res, next) {
  try {
    const domainResult = domainParamSchema.safeParse(req.params.domain);
    if (!domainResult.success) {
      return next(
        new InvalidQueryStringParameterError({
          parameterName: 'domain',
          message: 'Invalid domain parameter. Must be one of: enterprise, ics, mobile',
        }),
      );
    }

    const format = parseOptionalQuery(req.query.format, formatQuerySchema, 'bundle');
    const result = await releaseTracksService.getEphemeralBundle(domainResult.data, format);
    logger.debug(`Success: Retrieved ephemeral ${domainResult.data} bundle`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to retrieve ephemeral bundle: ' + err);
    return next(err);
  }
};

// =============================================================================
// Track management
// =============================================================================

/** GET /api/release-tracks */
exports.listReleaseTracks = async function listReleaseTracks(req, res, next) {
  try {
    const options = {
      type: parseOptionalQuery(req.query.type, trackTypeQuerySchema, undefined),
      releases: req.query.releases === 'only' ? 'only' : undefined,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset, 10) : undefined,
      search: req.query.search || undefined,
    };

    const result = await releaseTracksService.listTracks(options);
    logger.debug('Success: Retrieved release tracks list');
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to list release tracks: ' + err);
    return next(err);
  }
};

/** POST /api/release-tracks/new */
exports.createReleaseTrack = async function createReleaseTrack(req, res, next) {
  try {
    const bodyResult = createTrackBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid request body',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.createTrack({
      ...bodyResult.data,
      userAccountId: req.user?.userAccountId,
    });
    logger.debug(`Success: Created release track "${bodyResult.data.name}"`);
    return res.status(201).send(result);
  } catch (err) {
    logger.error('Failed to create release track: ' + err);
    return next(err);
  }
};

/** POST /api/release-tracks/new-from-bundle */
exports.createReleaseTrackFromBundle = async function createReleaseTrackFromBundle(req, res, next) {
  try {
    const bodyResult = createFromBundleBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid STIX bundle',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.createTrackFromBundle(bodyResult.data);
    logger.debug('Success: Created release track from bundle');
    return res.status(201).send(result);
  } catch (err) {
    logger.error('Failed to create release track from bundle: ' + err);
    return next(err);
  }
};

/** POST /api/release-tracks/import */
exports.importReleaseTrack = async function importReleaseTrack(_req, _res, next) {
  return next(
    new NotImplementedError('release-tracks-controller', 'importReleaseTrack', {
      message: 'Release track import is not yet implemented',
    }),
  );
};

/** GET /api/release-tracks/:id */
exports.retrieveLatestSnapshot = async function retrieveLatestSnapshot(req, res, next) {
  try {
    const queryOptions = parseSnapshotQueryParams(req.query);

    // filesystemstore format is not yet implemented
    if (queryOptions.format === 'filesystemstore') {
      return next(
        new NotImplementedError('release-tracks-controller', 'retrieveLatestSnapshot', {
          message: 'The filesystemstore format is not yet implemented',
        }),
      );
    }

    const result = await releaseTracksService.getLatestSnapshot(req.params.id, queryOptions);
    logger.debug(`Success: Retrieved latest snapshot for track ${req.params.id}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to retrieve latest snapshot: ' + err);
    return next(err);
  }
};

/** POST /api/release-tracks/:id/meta */
exports.updateMetadataByLatest = async function updateMetadataByLatest(req, res, next) {
  try {
    const bodyResult = updateMetadataBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid metadata update',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.updateMetadata(
      req.params.id,
      bodyResult.data,
      req.user?.userAccountId,
    );
    logger.debug(`Success: Updated metadata for track ${req.params.id}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to update track metadata: ' + err);
    return next(err);
  }
};

/** POST /api/release-tracks/:id/contents */
exports.updateContentsByLatest = async function updateContentsByLatest(req, res, next) {
  try {
    const bodyResult = updateContentsBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid contents update',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.updateContents(
      req.params.id,
      bodyResult.data,
      req.user?.userAccountId,
    );
    logger.debug(`Success: Updated contents for track ${req.params.id}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to update track contents: ' + err);
    return next(err);
  }
};

/** POST /api/release-tracks/:id/bump */
exports.bumpByLatest = async function bumpByLatest(req, res, next) {
  try {
    const bodyResult = bumpBodySchema.safeParse(req.body || {});
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid bump request',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.bumpLatest(req.params.id, {
      ...bodyResult.data,
      userAccountId: req.user?.userAccountId,
    });
    logger.debug(`Success: Bumped version for track ${req.params.id}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to bump track version: ' + err);
    return next(err);
  }
};

/** POST /api/release-tracks/:id/clone */
exports.cloneByLatest = async function cloneByLatest(req, res, next) {
  try {
    const bodyResult = cloneBodySchema.safeParse(req.body || {});
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid clone request',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.cloneTrack(req.params.id, {
      ...(bodyResult.data || {}),
      userAccountId: req.user?.userAccountId,
    });
    logger.debug(`Success: Cloned track ${req.params.id}`);
    return res.status(201).send(result);
  } catch (err) {
    logger.error('Failed to clone track: ' + err);
    return next(err);
  }
};

/** DELETE /api/release-tracks/:id */
exports.deleteReleaseTrack = async function deleteReleaseTrack(req, res, next) {
  try {
    await releaseTracksService.deleteTrack(req.params.id);
    logger.debug(`Success: Deleted track ${req.params.id}`);
    return res.status(204).end();
  } catch (err) {
    logger.error('Failed to delete track: ' + err);
    return next(err);
  }
};

// =============================================================================
// Snapshot-specific operations
// =============================================================================

/** GET /api/release-tracks/:id/snapshots/:modified */
exports.retrieveSnapshotByModified = async function retrieveSnapshotByModified(req, res, next) {
  try {
    const queryOptions = parseSnapshotQueryParams(req.query);

    const result = await releaseTracksService.getSnapshotByModified(
      req.params.id,
      req.params.modified,
      queryOptions,
    );
    logger.debug(`Success: Retrieved snapshot ${req.params.modified} for track ${req.params.id}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to retrieve snapshot by modified: ' + err);
    return next(err);
  }
};

/** POST /api/release-tracks/:id/snapshots/:modified/meta */
exports.updateMetadataByModified = async function updateMetadataByModified(req, res, next) {
  try {
    const bodyResult = updateMetadataBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid metadata update',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.updateMetadataByModified(
      req.params.id,
      req.params.modified,
      bodyResult.data,
      req.user?.userAccountId,
    );
    logger.debug(`Success: Updated metadata for snapshot ${req.params.modified}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to update snapshot metadata: ' + err);
    return next(err);
  }
};

/** POST /api/release-tracks/:id/snapshots/:modified/contents */
exports.updateContentsByModified = async function updateContentsByModified(req, res, next) {
  try {
    const bodyResult = updateContentsBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid contents update',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.updateContentsByModified(
      req.params.id,
      req.params.modified,
      bodyResult.data,
      req.user?.userAccountId,
    );
    logger.debug(`Success: Updated contents for snapshot ${req.params.modified}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to update snapshot contents: ' + err);
    return next(err);
  }
};

/** POST /api/release-tracks/:id/snapshots/:modified/bump */
exports.bumpByModified = async function bumpByModified(req, res, next) {
  try {
    const bodyResult = bumpBodySchema.safeParse(req.body || {});
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid bump request',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.bumpByModified(req.params.id, req.params.modified, {
      ...bodyResult.data,
      userAccountId: req.user?.userAccountId,
    });
    logger.debug(`Success: Bumped version for snapshot ${req.params.modified}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to bump snapshot version: ' + err);
    return next(err);
  }
};

/** POST /api/release-tracks/:id/snapshots/:modified/clone */
exports.cloneByModified = async function cloneByModified(req, res, next) {
  try {
    const bodyResult = cloneBodySchema.safeParse(req.body || {});
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid clone request',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.cloneFromSnapshot(
      req.params.id,
      req.params.modified,
      {
        ...(bodyResult.data || {}),
        userAccountId: req.user?.userAccountId,
      },
    );
    logger.debug(`Success: Cloned from snapshot ${req.params.modified}`);
    return res.status(201).send(result);
  } catch (err) {
    logger.error('Failed to clone from snapshot: ' + err);
    return next(err);
  }
};

/** DELETE /api/release-tracks/:id/snapshots/:modified */
exports.deleteSnapshotByModified = async function deleteSnapshotByModified(req, res, next) {
  try {
    await releaseTracksService.deleteSnapshot(req.params.id, req.params.modified);
    logger.debug(`Success: Deleted snapshot ${req.params.modified} from track ${req.params.id}`);
    return res.status(204).end();
  } catch (err) {
    logger.error('Failed to delete snapshot: ' + err);
    return next(err);
  }
};

// =============================================================================
// Candidate management
// =============================================================================

/** POST /api/release-tracks/:id/candidates */
exports.addCandidates = async function addCandidates(req, res, next) {
  try {
    const bodyResult = addCandidatesBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid candidates request',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.addCandidates(
      req.params.id,
      bodyResult.data.object_refs,
      req.user?.userAccountId,
    );
    logger.debug(`Success: Added candidates to track ${req.params.id}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to add candidates: ' + err);
    return next(err);
  }
};

/** GET /api/release-tracks/:id/candidates */
exports.listCandidates = async function listCandidates(req, res, next) {
  try {
    const options = {
      status: parseOptionalQuery(req.query.status, workflowStatusSchema, undefined),
      limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset, 10) : undefined,
    };

    const result = await releaseTracksService.listCandidates(req.params.id, options);
    logger.debug(`Success: Listed candidates for track ${req.params.id}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to list candidates: ' + err);
    return next(err);
  }
};

/** DELETE /api/release-tracks/:id/candidates/:objectRef */
exports.removeCandidate = async function removeCandidate(req, res, next) {
  try {
    await releaseTracksService.removeCandidate(req.params.id, req.params.objectRef);
    logger.debug(`Success: Removed candidate ${req.params.objectRef} from track ${req.params.id}`);
    return res.status(204).end();
  } catch (err) {
    logger.error('Failed to remove candidate: ' + err);
    return next(err);
  }
};

/** POST /api/release-tracks/:id/candidates/review */
exports.reviewCandidates = async function reviewCandidates(req, res, next) {
  try {
    const bodyResult = reviewCandidatesBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid review request',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.reviewCandidates(
      req.params.id,
      bodyResult.data,
      req.user?.userAccountId,
    );
    logger.debug(`Success: Reviewed candidates for track ${req.params.id}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to review candidates: ' + err);
    return next(err);
  }
};

/** POST /api/release-tracks/:id/candidates/promote */
exports.promoteCandidates = async function promoteCandidates(req, res, next) {
  try {
    const bodyResult = promoteCandidatesBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid promote request',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.promoteCandidates(
      req.params.id,
      bodyResult.data.object_refs,
      req.user?.userAccountId,
    );
    logger.debug(`Success: Promoted candidates for track ${req.params.id}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to promote candidates: ' + err);
    return next(err);
  }
};

/** POST /api/release-tracks/:id/candidates/:objectRef/update-version */
exports.updateCandidateVersion = async function updateCandidateVersion(req, res, next) {
  try {
    const bodyResult = updateCandidateVersionBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid version update request',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.updateCandidateVersion(
      req.params.id,
      req.params.objectRef,
      bodyResult.data,
    );
    logger.debug(`Success: Updated version for candidate ${req.params.objectRef}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to update candidate version: ' + err);
    return next(err);
  }
};

// =============================================================================
// Staged objects
// =============================================================================

/** GET /api/release-tracks/:id/staged */
exports.listStaged = async function listStaged(req, res, next) {
  try {
    const result = await releaseTracksService.listStaged(req.params.id);
    logger.debug(`Success: Listed staged objects for track ${req.params.id}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to list staged objects: ' + err);
    return next(err);
  }
};

/** POST /api/release-tracks/:id/staged/demote */
exports.demoteStaged = async function demoteStaged(req, res, next) {
  try {
    const bodyResult = demoteStagedBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid demote request',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.demoteStaged(
      req.params.id,
      bodyResult.data.object_refs,
      req.user?.userAccountId,
    );
    logger.debug(`Success: Demoted staged objects for track ${req.params.id}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to demote staged objects: ' + err);
    return next(err);
  }
};

// =============================================================================
// Configuration
// =============================================================================

/** GET /api/release-tracks/:id/config */
exports.getConfig = async function getConfig(req, res, next) {
  try {
    const result = await releaseTracksService.getConfig(req.params.id);
    logger.debug(`Success: Retrieved config for track ${req.params.id}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to get track config: ' + err);
    return next(err);
  }
};

/** PUT /api/release-tracks/:id/config */
exports.updateConfig = async function updateConfig(req, res, next) {
  try {
    const bodyResult = updateConfigBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid config update',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.updateConfig(
      req.params.id,
      bodyResult.data,
      req.user?.userAccountId,
    );
    logger.debug(`Success: Updated config for track ${req.params.id}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to update track config: ' + err);
    return next(err);
  }
};

// =============================================================================
// Preview & dry run
// =============================================================================

/** GET /api/release-tracks/:id/bump/preview */
exports.previewBump = async function previewBump(req, res, next) {
  try {
    const format = parseOptionalQuery(req.query.format, formatQuerySchema, 'workbench');

    const result = await releaseTracksService.previewBump(req.params.id, format);
    logger.debug(`Success: Generated bump preview for track ${req.params.id}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to preview bump: ' + err);
    return next(err);
  }
};

// =============================================================================
// Object versions
// =============================================================================

/** GET /api/release-tracks/:id/objects/:objectRef/versions */
exports.listObjectVersions = async function listObjectVersions(req, res, next) {
  try {
    const result = await releaseTracksService.listObjectVersions(
      req.params.id,
      req.params.objectRef,
    );
    logger.debug(`Success: Listed versions for object ${req.params.objectRef}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to list object versions: ' + err);
    return next(err);
  }
};

// =============================================================================
// Virtual track operations
// =============================================================================

/** PUT /api/release-tracks/:id/composition */
exports.updateComposition = async function updateComposition(req, res, next) {
  try {
    const bodyResult = updateCompositionBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid composition update',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.updateComposition(
      req.params.id,
      bodyResult.data,
      req.user?.userAccountId,
    );
    logger.debug(`Success: Updated composition for track ${req.params.id}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to update composition: ' + err);
    return next(err);
  }
};

/** POST /api/release-tracks/:id/snapshots/create */
exports.createVirtualSnapshot = async function createVirtualSnapshot(req, res, next) {
  try {
    const bodyResult = createVirtualSnapshotBodySchema.safeParse(req.body || {});
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid virtual snapshot request',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.createVirtualSnapshot(req.params.id, {
      ...(bodyResult.data || {}),
      userAccountId: req.user?.userAccountId,
    });
    logger.debug(`Success: Created virtual snapshot for track ${req.params.id}`);
    return res.status(201).send(result);
  } catch (err) {
    logger.error('Failed to create virtual snapshot: ' + err);
    return next(err);
  }
};

/** GET /api/release-tracks/:id/snapshots/preview */
exports.previewVirtualSnapshot = async function previewVirtualSnapshot(req, res, next) {
  try {
    const result = await releaseTracksService.previewVirtualSnapshot(req.params.id);
    logger.debug(`Success: Generated virtual snapshot preview for track ${req.params.id}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to preview virtual snapshot: ' + err);
    return next(err);
  }
};
