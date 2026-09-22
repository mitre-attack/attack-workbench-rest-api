'use strict';

// =============================================================================
// Zod schemas for release track data validation.
//
// These schemas are the canonical source of truth for release track field
// formats. They are pure Zod schemas with no framework coupling, so they can
// be reused in any context: Mongoose model validators, controller request
// validation, test assertions, etc.
//
// For Mongoose-specific validator wrappers see ./release-track-validators.js.
// =============================================================================

const { z } = require('zod');
const {
  stixIdentifierSchema,
  xMitreVersionSchema,
  createStixIdValidator,
} = require('@mitre-attack/attack-data-model');
const types = require('../types');

// -----------------------------------------------------------------------------
// Custom STIX identifier
// -----------------------------------------------------------------------------
// Fork of ADM's stixIdentifierSchema that accepts non-official STIX type
// prefixes. The ADM schema only accepts official STIX types (e.g.,
// 'attack-pattern', 'identity'). This schema accepts any valid type prefix
// (e.g., 'release-track', 'x-custom-type').

const customStixIdentifierSchema = z
  .string()
  .refine((val) => val.includes('--') && val.split('--').length === 2, {
    message: "Invalid identifier: must comply with format 'type--UUIDv4'",
  })
  .refine(
    (val) => {
      const [type] = val.split('--');
      return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(type);
    },
    {
      error: (issue) => ({
        message: `Invalid identifier: '${issue.input.split('--')[0]}' is not a valid type prefix`,
      }),
    },
  )
  .refine(
    (val) => {
      const [, uuid] = val.split('--');
      return z.uuid().safeParse(uuid).success;
    },
    {
      message: 'Invalid identifier: contains invalid UUIDv4 format',
    },
  );

function createCustomStixIdValidator(expectedType) {
  return customStixIdentifierSchema.refine((val) => val.startsWith(`${expectedType}--`), {
    message: `Invalid identifier: must start with '${expectedType}--'`,
  });
}

// Prebuilt schema for release track IDs
const releaseTrackIdSchema = createCustomStixIdValidator('release-track');

// -----------------------------------------------------------------------------
// Track name
// -----------------------------------------------------------------------------

const trackNameSchema = z
  .string()
  .min(1, { message: 'Release track name must not be empty' })
  .regex(/^[a-zA-Z0-9 &]+$/, {
    message: 'Release track name may only contain alphanumeric characters, spaces, and ampersands',
  });

const snapshotDescriptionSchema = z.string().trim().max(4000);

// -----------------------------------------------------------------------------
// Track alias: an optional URL-safe slug accepted wherever a track ID is
// -----------------------------------------------------------------------------

// Static path segments under /api/release-tracks that an alias must never
// shadow, plus the canonical ID prefix.
const RESERVED_TRACK_ALIASES = Object.freeze([
  'new',
  'new-from-bundle',
  'import',
  'objects',
  'ephemeral',
  'latest',
]);

const trackAliasSchema = z
  .string()
  .min(2, { message: 'Release track alias must be at least 2 characters' })
  .max(64, { message: 'Release track alias must be at most 64 characters' })
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/, {
    message:
      'Release track alias may only contain lowercase letters, digits, and hyphens, and must start and end with a letter or digit',
  })
  .refine(
    (alias) => !RESERVED_TRACK_ALIASES.includes(alias) && !alias.startsWith('release-track'),
    { message: 'Release track alias is reserved' },
  );

// -----------------------------------------------------------------------------
// Cron expression
// See: https://github.com/colinhacks/zod/issues/4239#issuecomment-3161393771
// -----------------------------------------------------------------------------

const wildcardSchema = z.literal('*');

const stepValueSchema = z.enum(Array.from({ length: 9_999 }, (_, i) => String(i + 1)));

function createCronFieldSchema(min, max) {
  const integerSchema = z
    .enum(Array.from({ length: max - min + 1 }, (_, i) => String(min + i)))
    .transform(Number);

  const rangeSchema = z.templateLiteral([z.int(), z.literal('-'), z.int()]).refine((value) => {
    const [start, end] = value.split('-');
    const startResult = integerSchema.safeParse(start);
    const endResult = integerSchema.safeParse(end);
    return startResult.success && endResult.success && startResult.data <= endResult.data;
  });

  const wildcardOrRangeSchema = wildcardSchema.or(rangeSchema);

  const stepSchema = z
    .templateLiteral([wildcardOrRangeSchema, z.literal('/'), z.int()])
    .refine((value) => {
      const [base, step] = value.split('/');
      return (
        wildcardOrRangeSchema.safeParse(base).success && stepValueSchema.safeParse(step).success
      );
    });

  const fieldSchema = z.string().refine((value) => {
    return value
      .split(',')
      .every(
        (part) => wildcardOrRangeSchema.or(integerSchema).or(stepSchema).safeParse(part).success,
      );
  });

  return fieldSchema;
}

const minuteSchema = createCronFieldSchema(0, 59);
const hourSchema = createCronFieldSchema(0, 23);
const dayOfMonthSchema = createCronFieldSchema(1, 31);
const monthSchema = createCronFieldSchema(1, 12);
const dayOfWeekSchema = createCronFieldSchema(0, 6);

const cronSchema = z
  .string()
  .transform((value) => value.trim().split(/\s+/))
  .refine((fields) => fields.length === 5, {
    message: 'Invalid cron expression: expected 5 fields',
  })
  .refine((fields) => minuteSchema.safeParse(fields[0]).success, {
    message: 'Invalid cron expression: invalid minute field',
  })
  .refine((fields) => hourSchema.safeParse(fields[1]).success, {
    message: 'Invalid cron expression: invalid hour field',
  })
  .refine((fields) => dayOfMonthSchema.safeParse(fields[2]).success, {
    message: 'Invalid cron expression: invalid day of month field',
  })
  .refine((fields) => monthSchema.safeParse(fields[3]).success, {
    message: 'Invalid cron expression: invalid month field',
  })
  .refine((fields) => dayOfWeekSchema.safeParse(fields[4]).success, {
    message: 'Invalid cron expression: invalid day of week field',
  })
  .transform((fields) => fields.join(' '));

// =============================================================================
// Query parameter schemas (used inline by controller handlers)
// =============================================================================

const domainParamSchema = z.enum(['enterprise', 'ics', 'mobile']);

const formatQuerySchema = z.enum(['bundle', 'filesystemstore', 'workbench']);
const releasePreviewFormatSchema = z.enum(['summary', 'bundle', 'filesystemstore', 'workbench']);

const includeQuerySchema = z.enum(['members', 'staged', 'candidates', 'quarantine', 'all']);

const stixVersionQuerySchema = z.enum(['2.0', '2.1']);

// Boolean query parameters arrive as strings ('true'/'false') unless the
// OpenAPI validator has already coerced them to booleans.
const booleanQuerySchema = z.union([z.boolean(), z.stringbool()]);

const snapshotTaggedQuerySchema = z.union([
  z.boolean(),
  z.enum(['true', 'false']).transform((value) => value === 'true'),
]);

const trackTypeQuerySchema = z.enum(['standard', 'virtual']);

const releaseOrderQuerySchema = z.enum(['asc', 'desc']);

const releaseLimitQuerySchema = z.coerce.number().int().min(1).max(200);

const releaseOffsetQuerySchema = z.coerce.number().int().min(0);

const releaseIncrementSchema = z.enum(['major', 'minor']);

const workflowStatusSchema = z.enum(['work-in-progress', 'awaiting-review', 'reviewed']);

// Track-entry statuses include the server-assigned 'modified-in-place'
// marker (set by the workflow gate when a pinned revision is edited via an
// in-place PUT). Valid wherever an existing entry's status is read or
// matched (review `from`, status filters) — but not settable as a review
// target, and not a valid candidacy threshold.
const trackEntryStatusSchema = z.enum([
  'modified-in-place',
  'work-in-progress',
  'awaiting-review',
  'reviewed',
]);

const candidacyThresholdSchema = z.enum(['work-in-progress', 'awaiting-review', 'reviewed']);

const deduplicationStrategySchema = z.enum([
  'prioritize_latest_object',
  'prioritize_latest_snapshot',
  'prioritize_higher_priority',
  'quarantine',
]);

const resolutionStrategySchema = z.enum([
  'latest_tagged',
  'latest_draft',
  'specific_version',
  'specific_snapshot',
]);

const conflictPolicySchema = z.enum([
  'prefer_latest',
  'always_overwrite',
  'always_reject',
  'abort',
]);

// Member sync schemas
const memberSyncStrategySchema = z.enum(['track_latest', 'manual']);
const memberSyncSupplantBehaviorSchema = z.enum(['replace', 'queue', 'ignore']);
const memberSyncStatusPolicySchema = z.enum(['reset', 'preserve']);

const memberSyncSupplantSchema = z.object({
  behavior: memberSyncSupplantBehaviorSchema.optional(),
  status_policy: memberSyncStatusPolicySchema.optional(),
});

const memberSyncConfigSchema = z.object({
  strategy: memberSyncStrategySchema.optional(),
  supplant: memberSyncSupplantSchema.optional(),
});

const promotionConflictsSchema = z.object({
  into_candidates: conflictPolicySchema.optional(),
  candidates_to_staged: conflictPolicySchema.exclude(['abort']).optional(),
  staged_to_members: conflictPolicySchema.optional(),
});

// Publication metadata inheritance. Each attribute either inherits the global
// system-configuration value or carries an explicit track-scoped override.
const inheritedIdentitySchema = z.discriminatedUnion('inherit', [
  z.object({ inherit: z.literal(true) }).strict(),
  z
    .object({
      inherit: z.literal(false),
      value: createStixIdValidator('identity'),
    })
    .strict(),
]);

const inheritedMarkingRefsSchema = z.discriminatedUnion('inherit', [
  z.object({ inherit: z.literal(true) }).strict(),
  z
    .object({
      inherit: z.literal(false),
      value: z.array(createStixIdValidator('marking-definition')),
    })
    .strict(),
]);

const publicationConfigSchema = z
  .object({
    collection_id: createStixIdValidator('x-mitre-collection').nullable().optional(),
    created: z.iso.datetime().nullable().optional(),
    created_by_ref: inheritedIdentitySchema.optional(),
    object_marking_refs: inheritedMarkingRefsSchema.optional(),
  })
  .strict();

const updateConfigBodySchema = z.object({
  candidacy_threshold: candidacyThresholdSchema.optional(),
  auto_promote: z.boolean().optional(),
  promotion_conflicts: promotionConflictsSchema.optional(),
  member_sync: memberSyncConfigSchema.optional(),
  publication: publicationConfigSchema.optional(),
});

// =============================================================================
// Request body schemas (used inline by controller handlers)
// =============================================================================

/** POST /release-tracks/new */
const snapshotScheduleSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('manual'),
    })
    .strict(),
  z
    .object({
      mode: z.literal('cron'),
      cron: cronSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal('dates'),
      dates: z.array(z.iso.datetime()).min(1),
    })
    .strict(),
]);

const scheduledMaterializationSchema = z
  .object({
    schedule_mode: z.enum(['cron', 'dates']),
    scheduled_for: z.iso.datetime(),
  })
  .strict();

const releaseTrackObjectTypes = Object.freeze(Object.values(types));
const releaseTrackObjectTypeSchema = z.enum(releaseTrackObjectTypes);
const objectTypesFilterSchema = z
  .array(releaseTrackObjectTypeSchema)
  .min(1)
  .superRefine((objectTypes, context) => {
    if (new Set(objectTypes).size !== objectTypes.length) {
      context.addIssue({
        code: 'custom',
        message: 'Object type filters must not contain duplicate values',
      });
    }
  });

const componentTrackFiltersSchema = z
  .object({
    object_types: objectTypesFilterSchema.optional(),
    domains: z.array(z.string()).optional(),
  })
  .strict();

const componentTrackBaseShape = {
  track_id: releaseTrackIdSchema,
  priority: z.number().int().min(0),
  filters: componentTrackFiltersSchema.optional(),
};

const componentTrackSchema = z.discriminatedUnion('resolution_strategy', [
  z
    .object({
      ...componentTrackBaseShape,
      resolution_strategy: z.literal('latest_tagged'),
    })
    .strict(),
  z
    .object({
      ...componentTrackBaseShape,
      resolution_strategy: z.literal('latest_draft'),
    })
    .strict(),
  z
    .object({
      ...componentTrackBaseShape,
      resolution_strategy: z.literal('specific_version'),
      version: xMitreVersionSchema,
    })
    .strict(),
  z
    .object({
      ...componentTrackBaseShape,
      resolution_strategy: z.literal('specific_snapshot'),
      snapshot: z.iso.datetime(),
    })
    .strict(),
]);

const compositionShape = {
  component_tracks: z.array(componentTrackSchema).min(1),
  deduplication: z
    .object({
      strategy: deduplicationStrategySchema,
    })
    .strict()
    .optional(),
};

function validateCompositionUniqueness(composition, context) {
  const trackIds = new Set();
  const priorities = new Set();

  composition.component_tracks.forEach((component, index) => {
    if (trackIds.has(component.track_id)) {
      context.addIssue({
        code: 'custom',
        path: ['component_tracks', index, 'track_id'],
        message: 'Each component track must reference a unique track',
      });
    }
    trackIds.add(component.track_id);

    if (priorities.has(component.priority)) {
      context.addIssue({
        code: 'custom',
        path: ['component_tracks', index, 'priority'],
        message: 'Each component track must have a unique priority value',
      });
    }
    priorities.add(component.priority);
  });
}

const compositionSchema = z
  .object(compositionShape)
  .strict()
  .superRefine(validateCompositionUniqueness);

const createTrackBodySchema = z
  .object({
    name: trackNameSchema,
    alias: trackAliasSchema.optional(),
    description: z.string().optional(),
    snapshot_description: snapshotDescriptionSchema.optional(),
    type: trackTypeQuerySchema.default('standard'),
    composition: compositionSchema.optional(),
    snapshot_schedule: snapshotScheduleSchema.optional(),
    scheduled_materialization: scheduledMaterializationSchema.optional(),
    config: updateConfigBodySchema.optional(),
  })
  .strict()
  .superRefine((track, context) => {
    if (track.type !== 'virtual' && track.snapshot_schedule !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot_schedule'],
        message: 'Snapshot schedules are only available for virtual tracks',
      });
    }
    if (track.type !== 'virtual' && track.scheduled_materialization !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['scheduled_materialization'],
        message: 'Scheduled materialization is only available for virtual tracks',
      });
    }
  });

/** POST /release-tracks/new-from-bundle */
const createFromBundleBodySchema = z.object({
  type: z.literal('bundle'),
  id: stixIdentifierSchema,
  objects: z.array(z.looseObject({})).min(1),
});

/** POST /release-tracks/:id/meta */
const updateMetadataBodySchema = z.object({
  name: trackNameSchema.optional(),
  description: z.string().optional(),
  // A string sets the alias; null clears it.
  alias: trackAliasSchema.nullable().optional(),
});

/** PUT /release-tracks/:id/snapshots/:modified/description */
const updateSnapshotDescriptionBodySchema = z
  .object({
    description: snapshotDescriptionSchema,
  })
  .strict();

const releaseVersionSelectionSchema = z
  .object({
    increment: releaseIncrementSchema.optional(),
    version: xMitreVersionSchema.optional(),
  })
  .strict()
  .refine((value) => !(value.increment && value.version), {
    message: 'increment and version are mutually exclusive',
  });

/** POST /release-tracks/:id/snapshots/{target}/release */
const releaseBodySchema = z
  .object({
    increment: releaseIncrementSchema.optional(),
    version: xMitreVersionSchema.optional(),
    description: snapshotDescriptionSchema.optional(),
  })
  .strict()
  .refine((value) => !(value.increment && value.version), {
    message: 'increment and version are mutually exclusive',
  });

/** PUT /release-tracks/:id/snapshots/:modified/release */
const retagReleaseBodySchema = z.object({ version: xMitreVersionSchema }).strict();
const convertReleaseToDraftBodySchema = z.object({ confirm_version: xMitreVersionSchema }).strict();

/** POST /release-tracks/:id/clone */
const cloneBodySchema = z
  .object({
    name: trackNameSchema.optional(),
  })
  .optional();

/** POST /release-tracks/:id/candidates */
const objectRefEntrySchema = z.union([
  stixIdentifierSchema,
  z.object({
    id: stixIdentifierSchema,
    modified: z.iso.datetime().or(z.literal('latest')).optional(),
  }),
]);

const addCandidatesBodySchema = z.object({
  object_refs: z.array(objectRefEntrySchema).min(1),
});

/** POST /release-tracks/:id/candidates/review */
const reviewCandidatesBodySchema = z.object({
  from: trackEntryStatusSchema,
  to: workflowStatusSchema,
  object_refs: z
    .array(
      z.union([
        stixIdentifierSchema,
        z.object({
          id: stixIdentifierSchema,
          modified: z.iso.datetime().or(z.literal('latest')).optional(),
        }),
      ]),
    )
    .optional(),
});

/** POST /release-tracks/:id/candidates/promote */
const promoteCandidatesBodySchema = z.object({
  object_refs: z.array(stixIdentifierSchema).min(1),
});

/** POST /release-tracks/:id/staged/demote */
const demoteStagedBodySchema = z.object({
  object_refs: z
    .array(
      z.object({
        id: stixIdentifierSchema,
        modified: z.iso.datetime().or(z.literal('latest')),
      }),
    )
    .min(1),
});

/** POST /release-tracks/:id/candidates/:objectRef/update-version */
const updateCandidateVersionBodySchema = z.object({
  old_modified: z.iso.datetime().or(z.literal('latest')),
  new_modified: z.iso.datetime().or(z.literal('latest')),
});

/** PUT /release-tracks/:id/virtual/composition */
const updateCompositionBodySchema = z
  .object({
    ...compositionShape,
    scheduled_materialization: scheduledMaterializationSchema.optional(),
  })
  .strict()
  .superRefine(validateCompositionUniqueness);

/** POST /release-tracks/:id/virtual/snapshots/create */
const createVirtualSnapshotBodySchema = z
  .object({
    description: snapshotDescriptionSchema.optional(),
    scheduled_materialization: scheduledMaterializationSchema.optional(),
  })
  .strict()
  .optional();

/** POST /release-tracks/:id/virtual/quarantine/promote */
const promoteQuarantinedObjectBodySchema = z
  .object({
    object_ref: stixIdentifierSchema,
    object_modified: z.iso.datetime(),
  })
  .strict();

const exactGraphRevisionSchema = z
  .object({
    object_ref: stixIdentifierSchema,
    object_modified: z.iso.datetime(),
  })
  .strict();

const sourceGraphEntrySchema = z
  .object({
    kind: z.enum(['root', 'relationship', 'secondary', 'supporting', 'link_target']),
    object_ref: stixIdentifierSchema,
    object_modified: z.iso.datetime().nullable(),
    source: exactGraphRevisionSchema.optional(),
    target: exactGraphRevisionSchema.optional(),
    omitted_optional_defaults: z
      .array(z.enum(['revoked', 'x_mitre_remote_support']))
      .max(2)
      .optional(),
    frozen_stix: z.object({}).passthrough().optional(),
  })
  .strict();

/** Administrative recovery of a historical graph from an external source bundle. */
const reconstructSnapshotGraphBodySchema = z
  .object({
    source_attestation: z
      .object({
        kind: z.literal('source-bundle'),
        bundle_sha256: z.string().regex(/^[a-f0-9]{64}$/),
        collection_id: createStixIdValidator('x-mitre-collection'),
        release: xMitreVersionSchema,
        domain: z.enum(['enterprise-attack', 'ics-attack', 'mobile-attack']),
      })
      .strict(),
    entries: z.array(sourceGraphEntrySchema).min(1),
    // The content manifest the caller expects to replace. Required when the
    // snapshot's current manifest was not produced from the same attestation.
    replace_manifest_id: z.string().optional(),
  })
  .strict();

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  // Custom STIX identifiers (extends ADM for non-official type prefixes)
  customStixIdentifierSchema,
  createCustomStixIdValidator,
  releaseTrackIdSchema,

  // Domain schemas
  trackNameSchema,
  cronSchema,
  releaseTrackObjectTypes,
  releaseTrackObjectTypeSchema,
  objectTypesFilterSchema,

  // Re-exports from @mitre-attack/attack-data-model
  stixIdentifierSchema,
  xMitreVersionSchema,
  createStixIdValidator,

  // Query parameter schemas
  domainParamSchema,
  formatQuerySchema,
  releasePreviewFormatSchema,
  includeQuerySchema,
  stixVersionQuerySchema,
  booleanQuerySchema,
  snapshotTaggedQuerySchema,
  trackTypeQuerySchema,
  releaseOrderQuerySchema,
  releaseLimitQuerySchema,
  releaseOffsetQuerySchema,
  releaseIncrementSchema,
  releaseVersionSelectionSchema,
  workflowStatusSchema,
  trackEntryStatusSchema,
  candidacyThresholdSchema,
  deduplicationStrategySchema,
  resolutionStrategySchema,
  conflictPolicySchema,
  memberSyncStrategySchema,
  memberSyncSupplantBehaviorSchema,
  memberSyncStatusPolicySchema,

  // Request body schemas
  createTrackBodySchema,
  trackAliasSchema,
  RESERVED_TRACK_ALIASES,
  createFromBundleBodySchema,
  updateMetadataBodySchema,
  updateSnapshotDescriptionBodySchema,
  releaseBodySchema,
  retagReleaseBodySchema,
  convertReleaseToDraftBodySchema,
  publicationConfigSchema,
  cloneBodySchema,
  addCandidatesBodySchema,
  reviewCandidatesBodySchema,
  promoteCandidatesBodySchema,
  demoteStagedBodySchema,
  updateCandidateVersionBodySchema,
  updateConfigBodySchema,
  updateCompositionBodySchema,
  updateScheduleBodySchema: snapshotScheduleSchema,
  createVirtualSnapshotBodySchema,
  promoteQuarantinedObjectBodySchema,
  reconstructSnapshotGraphBodySchema,

  // Reusable sub-schemas
  componentTrackSchema,
  compositionSchema,
  snapshotScheduleSchema,
  scheduledMaterializationSchema,
  objectRefEntrySchema,
  promotionConflictsSchema,
  memberSyncConfigSchema,
  memberSyncSupplantSchema,
};
