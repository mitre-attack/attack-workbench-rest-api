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
  NotFoundError,
} = require('../exceptions');
const {
  domainParamSchema,
  formatQuerySchema,
  releasePreviewFormatSchema,
  includeQuerySchema,
  releaseTrackIdSchema,
  trackAliasSchema,
  stixVersionQuerySchema,
  booleanQuerySchema,
  snapshotTaggedQuerySchema,
  trackTypeQuerySchema,
  releaseOrderQuerySchema,
  releaseLimitQuerySchema,
  releaseOffsetQuerySchema,
  stixIdentifierSchema,
  trackEntryStatusSchema,
  createTrackBodySchema,
  createFromBundleBodySchema,
  updateMetadataBodySchema,
  updateSnapshotDescriptionBodySchema,
  releaseBodySchema,
  retagReleaseBodySchema,
  convertReleaseToDraftBodySchema,
  releaseVersionSelectionSchema,
  cloneBodySchema,
  addCandidatesBodySchema,
  reviewCandidatesBodySchema,
  promoteCandidatesBodySchema,
  demoteStagedBodySchema,
  updateCandidateVersionBodySchema,
  updateConfigBodySchema,
  updateCompositionBodySchema,
  updateScheduleBodySchema,
  draftRetentionSchema,
  createVirtualSnapshotBodySchema,
  promoteQuarantinedObjectBodySchema,
  reconstructSnapshotGraphBodySchema,
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

function parseOptionalQueryStrict(value, schema, defaultValue, parameterName) {
  if (value === undefined || value === null) return defaultValue;
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  throw new InvalidQueryStringParameterError({
    parameterName,
    message: `Invalid ${parameterName} parameter`,
  });
}

function requireDestructiveConfirmation(req) {
  if (req.query.confirm_track_id !== req.params.id) {
    throw new BadRequestError({
      message: 'Destructive release-track confirmation is required',
      details: `Set confirm_track_id to the exact target track ID '${req.params.id}'.`,
      parameter_name: 'confirm_track_id',
      expected_track_id: req.params.id,
    });
  }
}

function destructiveActor(req) {
  return {
    user_account_id: req.user?.userAccountId,
    role: req.user?.role,
    authentication_strategy: req.user?.strategy,
  };
}

function rejectFilesystemStoreFormat(format, methodName) {
  if (format !== 'filesystemstore') return null;

  return new NotImplementedError('release-tracks-controller', methodName, {
    message: 'The filesystemstore format is not yet implemented',
  });
}

/**
 * Route parameter resolver for `:id`. A canonical track ID passes through;
 * any other value is treated as an alias and rewritten to the track ID it
 * names, so handlers and services only ever see canonical IDs. An unknown
 * alias is a 404 here rather than falling through, because the model factory
 * would otherwise bind a collection to the raw value. Resolution runs before
 * authentication (Express param callbacks precede route handlers), so an
 * alias's existence is observable without a session; aliases are public
 * slugs, not secrets.
 */
exports.resolveTrackId = async function resolveTrackId(req, res, next, value) {
  try {
    if (releaseTrackIdSchema.safeParse(value).success) return next();
    const trackId = trackAliasSchema.safeParse(value).success
      ? await releaseTracksService.resolveTrackAlias(value)
      : null;
    if (!trackId) {
      return next(new NotFoundError({ details: `Release track '${value}' not found` }));
    }
    req.params.id = trackId;
    req.releaseTrackAlias = value;
    return next();
  } catch (err) {
    return next(err);
  }
};

/**
 * `include` selects which tier arrays a workbench response returns. A bundle
 * always replays the snapshot's sealed content manifest, so `include` has no
 * meaning there and is rejected rather than silently ignored: a caller who
 * asked for staged or candidate objects must not mistake the members-only
 * bundle for the preview they requested.
 */
function rejectBundleInclude(query) {
  if (query.include === undefined) return;
  throw new InvalidQueryStringParameterError({
    parameterName: 'include',
    message:
      'The include parameter applies to format=workbench only; bundles always replay the sealed content manifest.',
  });
}

/**
 * Parse common query parameters shared across GET snapshot endpoints.
 *
 * `include` (workbench only) is a single tier name ('members' | 'staged' |
 * 'candidates' | 'quarantine' | 'all') controlling which tier arrays are
 * returned. `stixVersion` applies only to format=bundle.
 */
function parseSnapshotQueryParams(query) {
  const format = parseOptionalQueryStrict(query.format, formatQuerySchema, 'workbench', 'format');

  const common = {
    format,
    releases: query.releases === 'only' ? 'only' : undefined,
    version: parseOptionalQuery(query.version, xMitreVersionSchema, undefined),
    versions: query.versions === 'all' ? 'all' : undefined,
    limit: query.limit ? parseInt(query.limit, 10) : undefined,
    offset: query.offset ? parseInt(query.offset, 10) : undefined,
  };

  if (format === 'bundle') {
    rejectBundleInclude(query);
    return {
      ...common,
      stixVersion: parseOptionalQueryStrict(
        query.stixVersion,
        stixVersionQuerySchema,
        '2.1',
        'stixVersion',
      ),
    };
  }

  return {
    ...common,
    include: parseOptionalQueryStrict(query.include, includeQuerySchema, undefined, 'include'),
  };
}

function parseReleasePreviewQueryParams(query) {
  const format = parseOptionalQueryStrict(
    query.format,
    releasePreviewFormatSchema,
    'summary',
    'format',
  );
  const versionSelection = releaseVersionSelectionSchema.safeParse({
    increment: query.increment,
    version: query.version,
  });
  if (!versionSelection.success) {
    throw new InvalidQueryStringParameterError({
      parameterName: 'increment,version',
      message: 'Invalid release version selection',
      details: versionSelection.error.errors,
    });
  }

  const options = { format, ...versionSelection.data };
  if (format === 'bundle') {
    rejectBundleInclude(query);
    return {
      ...options,
      stixVersion: parseOptionalQueryStrict(
        query.stixVersion,
        stixVersionQuerySchema,
        '2.1',
        'stixVersion',
      ),
    };
  }
  if (format === 'workbench') {
    return {
      ...options,
      include: parseOptionalQueryStrict(query.include, includeQuerySchema, undefined, 'include'),
    };
  }
  return options;
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

    const format = parseOptionalQueryStrict(
      req.query.format,
      formatQuerySchema,
      'bundle',
      'format',
    );
    const formatError = rejectFilesystemStoreFormat(format, 'retrieveEphemeralByDomain');
    if (formatError) {
      return next(formatError);
    }

    const options = {
      format,
      stixVersion: parseOptionalQueryStrict(
        req.query.stixVersion,
        stixVersionQuerySchema,
        '2.1',
        'stixVersion',
      ),
      includeToc: parseOptionalQueryStrict(
        req.query.includeToc,
        booleanQuerySchema,
        true,
        'includeToc',
      ),
      includeObjectsWithMissingAttackId: parseOptionalQueryStrict(
        req.query.includeObjectsWithMissingAttackId,
        booleanQuerySchema,
        false,
        'includeObjectsWithMissingAttackId',
      ),
      includeDeprecated: parseOptionalQueryStrict(
        req.query.includeDeprecated,
        booleanQuerySchema,
        false,
        'includeDeprecated',
      ),
      includeRevoked: parseOptionalQueryStrict(
        req.query.includeRevoked,
        booleanQuerySchema,
        false,
        'includeRevoked',
      ),
    };

    const result = await releaseTracksService.getEphemeralBundle(domainResult.data, options);
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

/** GET /api/release-tracks/objects/:objectRef/releases */
exports.getReleasesByObject = async function getReleasesByObject(req, res, next) {
  try {
    const objectRefResult = stixIdentifierSchema.safeParse(req.params.objectRef);
    if (!objectRefResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid STIX object reference',
          details: objectRefResult.error.errors,
        }),
      );
    }

    const options = {
      type: parseOptionalQueryStrict(req.query.type, trackTypeQuerySchema, undefined, 'type'),
      order: parseOptionalQueryStrict(req.query.order, releaseOrderQuerySchema, 'asc', 'order'),
      limit: parseOptionalQueryStrict(req.query.limit, releaseLimitQuerySchema, 50, 'limit'),
      offset: parseOptionalQueryStrict(req.query.offset, releaseOffsetQuerySchema, 0, 'offset'),
    };

    const result = await releaseTracksService.getReleasesByObject(objectRefResult.data, options);
    logger.debug(`Success: Retrieved tagged releases for object ${objectRefResult.data}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to retrieve tagged releases by object: ' + err);
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
      actor: destructiveActor(req),
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

    const result = await releaseTracksService.createTrackFromBundle(
      bodyResult.data,
      req.user?.userAccountId,
    );
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

/** GET /api/release-tracks/:id/snapshots/latest */
exports.retrieveLatestSnapshot = async function retrieveLatestSnapshot(req, res, next) {
  try {
    const queryOptions = parseSnapshotQueryParams(req.query);
    const formatError = rejectFilesystemStoreFormat(queryOptions.format, 'retrieveLatestSnapshot');
    if (formatError) {
      return next(formatError);
    }

    const result = await releaseTracksService.getLatestSnapshot(req.params.id, queryOptions);
    logger.debug(`Success: Retrieved latest snapshot for track ${req.params.id}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to retrieve latest snapshot: ' + err);
    return next(err);
  }
};

/** GET /api/release-tracks/:id/snapshots */
exports.listSnapshots = async function listSnapshots(req, res, next) {
  try {
    const options = {
      tagged: parseOptionalQueryStrict(
        req.query.tagged,
        snapshotTaggedQuerySchema,
        undefined,
        'tagged',
      ),
      limit: parseOptionalQueryStrict(req.query.limit, releaseLimitQuerySchema, 50, 'limit'),
      offset: parseOptionalQueryStrict(req.query.offset, releaseOffsetQuerySchema, 0, 'offset'),
    };

    const result = await releaseTracksService.listSnapshots(req.params.id, options);
    logger.debug(`Success: Retrieved snapshots for track ${req.params.id}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to retrieve snapshots: ' + err);
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

/** PUT /api/release-tracks/:id/snapshots/:modified/description */
exports.updateSnapshotDescription = async function updateSnapshotDescription(req, res, next) {
  try {
    const bodyResult = updateSnapshotDescriptionBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid snapshot description update',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.updateSnapshotDescription(
      req.params.id,
      req.params.modified,
      bodyResult.data.description,
    );
    logger.debug(
      `Success: Updated description for snapshot ${req.params.modified} in track ${req.params.id}`,
    );
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to update snapshot description: ' + err);
    return next(err);
  }
};

/** POST /api/release-tracks/:id/snapshots/latest/release */
exports.releaseLatest = async function releaseLatest(req, res, next) {
  try {
    const bodyResult = releaseBodySchema.safeParse(req.body || {});
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid release request',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.releaseLatest(req.params.id, {
      ...bodyResult.data,
      userAccountId: req.user?.userAccountId,
      actor: destructiveActor(req),
    });
    logger.debug(`Success: Released latest snapshot for track ${req.params.id}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to release latest snapshot: ' + err);
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
    requireDestructiveConfirmation(req);
    await releaseTracksService.deleteTrack(
      req.params.id,
      destructiveActor(req),
      req.query.confirm_track_id,
    );
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
    const formatError = rejectFilesystemStoreFormat(
      queryOptions.format,
      'retrieveSnapshotByModified',
    );
    if (formatError) {
      return next(formatError);
    }

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

/** POST /api/release-tracks/:id/snapshots/:modified/release */
exports.releaseByModified = async function releaseByModified(req, res, next) {
  try {
    const bodyResult = releaseBodySchema.safeParse(req.body || {});
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid release request',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.releaseByModified(
      req.params.id,
      req.params.modified,
      {
        ...bodyResult.data,
        userAccountId: req.user?.userAccountId,
        actor: destructiveActor(req),
      },
    );
    logger.debug(`Success: Released snapshot ${req.params.modified}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to release snapshot: ' + err);
    return next(err);
  }
};

/** PUT /api/release-tracks/:id/snapshots/:modified/release */
exports.retagRelease = async function retagRelease(req, res, next) {
  try {
    const bodyResult = retagReleaseBodySchema.safeParse(req.body || {});
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid release version update',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.retagRelease(
      req.params.id,
      req.params.modified,
      bodyResult.data.version,
      destructiveActor(req),
    );
    logger.debug(`Success: Changed release version for snapshot ${req.params.modified}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to change release version: ' + err);
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

/** POST /api/release-tracks/:id/snapshots/:modified/graph/reconstruct */
exports.reconstructSnapshotManifest = async function reconstructSnapshotManifest(req, res, next) {
  try {
    const bodyResult = reconstructSnapshotGraphBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid source manifest reconstruction request',
          details: bodyResult.error.errors,
        }),
      );
    }
    const result = await releaseTracksService.reconstructSnapshotManifest(
      req.params.id,
      req.params.modified,
      bodyResult.data,
    );
    logger.debug(`Success: Reconstructed content manifest for snapshot ${req.params.modified}`);
    return res.status(result.created ? 201 : 200).send(result.snapshot);
  } catch (err) {
    logger.error('Failed to reconstruct snapshot content manifest: ' + err);
    return next(err);
  }
};

/** POST /api/release-tracks/:id/snapshots/:modified/draft */
exports.convertReleaseToDraft = async function convertReleaseToDraft(req, res, next) {
  try {
    const result = convertReleaseToDraftBodySchema.safeParse(req.body || {});
    if (!result.success) {
      throw new BadRequestError({
        message: 'A valid confirm_version is required to convert a release to a draft',
      });
    }
    const draft = await releaseTracksService.convertReleaseToDraft(
      req.params.id,
      req.params.modified,
      {
        actor: destructiveActor(req),
        confirmation: result.data.confirm_version,
      },
    );
    return res.status(200).send(draft);
  } catch (err) {
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
      status: parseOptionalQuery(req.query.status, trackEntryStatusSchema, undefined),
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
    await releaseTracksService.removeCandidate(
      req.params.id,
      req.params.objectRef,
      req.user?.userAccountId,
    );
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
      req.user?.userAccountId,
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
// Release previews
// =============================================================================

/** GET /api/release-tracks/:id/snapshots/latest/release/preview */
exports.previewLatestRelease = async function previewLatestRelease(req, res, next) {
  try {
    const options = parseReleasePreviewQueryParams(req.query);
    const formatError = rejectFilesystemStoreFormat(options.format, 'previewLatestRelease');
    if (formatError) {
      return next(formatError);
    }

    const result = await releaseTracksService.previewLatestRelease(req.params.id, options);
    logger.debug(`Success: Previewed release for track ${req.params.id}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to preview latest release: ' + err);
    return next(err);
  }
};

/** GET /api/release-tracks/:id/snapshots/:modified/release/preview */
exports.previewReleaseByModified = async function previewReleaseByModified(req, res, next) {
  try {
    const options = parseReleasePreviewQueryParams(req.query);
    const formatError = rejectFilesystemStoreFormat(options.format, 'previewReleaseByModified');
    if (formatError) {
      return next(formatError);
    }

    const result = await releaseTracksService.previewReleaseByModified(
      req.params.id,
      req.params.modified,
      options,
    );
    logger.debug(`Success: Previewed release for snapshot ${req.params.modified}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to preview snapshot release: ' + err);
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

/** PUT /api/release-tracks/:id/virtual/composition */
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

/** PUT /api/release-tracks/:id/virtual/schedule */
exports.updateSchedule = async function updateSchedule(req, res, next) {
  try {
    const bodyResult = updateScheduleBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid snapshot schedule update',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.updateSchedule(req.params.id, bodyResult.data);
    logger.debug(`Success: Updated snapshot schedule for track ${req.params.id}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to update snapshot schedule: ' + err);
    return next(err);
  }
};

exports.updateDraftRetention = async function updateDraftRetention(req, res, next) {
  try {
    const parsed = draftRetentionSchema.safeParse(req.body);
    if (!parsed.success)
      throw new BadRequestError({
        message: 'Invalid draft retention policy',
        details: parsed.error.errors,
      });
    return res
      .status(200)
      .send(
        await releaseTracksService.updateDraftRetention(
          req.params.id,
          parsed.data,
          destructiveActor(req),
        ),
      );
  } catch (error) {
    return next(error);
  }
};

exports.listDraftCleanup = async function listDraftCleanup(req, res, next) {
  try {
    return res.status(200).send(await releaseTracksService.listDraftCleanup(req.params.id));
  } catch (error) {
    return next(error);
  }
};

exports.retryDraftCleanup = async function retryDraftCleanup(req, res, next) {
  try {
    return res
      .status(200)
      .send(
        await releaseTracksService.retryDraftCleanup(
          req.params.id,
          req.params.operationId,
          destructiveActor(req),
        ),
      );
  } catch (error) {
    return next(error);
  }
};

/** POST /api/release-tracks/:id/virtual/snapshots/create */
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

    const { scheduled_materialization: scheduledMaterialization, ...snapshotOptions } =
      bodyResult.data || {};
    const result = await releaseTracksService.createVirtualSnapshot(req.params.id, {
      ...snapshotOptions,
      scheduledMaterialization,
      userAccountId: req.user?.userAccountId,
    });
    logger.debug(`Success: Created virtual snapshot for track ${req.params.id}`);
    return res.status(201).send(result);
  } catch (err) {
    logger.error('Failed to create virtual snapshot: ' + err);
    return next(err);
  }
};

/** POST /api/release-tracks/:id/virtual/quarantine/promote */
exports.promoteQuarantinedObject = async function promoteQuarantinedObject(req, res, next) {
  try {
    const bodyResult = promoteQuarantinedObjectBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return next(
        new BadRequestError({
          message: 'Invalid quarantine promotion request',
          details: bodyResult.error.errors,
        }),
      );
    }

    const result = await releaseTracksService.promoteQuarantinedObject(
      req.params.id,
      bodyResult.data,
      req.user?.userAccountId,
    );
    logger.debug(`Success: Promoted quarantined object for track ${req.params.id}`);
    return res.status(200).send(result);
  } catch (err) {
    logger.error('Failed to promote quarantined object: ' + err);
    return next(err);
  }
};
