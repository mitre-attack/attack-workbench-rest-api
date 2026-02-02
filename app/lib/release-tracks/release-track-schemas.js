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
  .regex(/^[a-zA-Z0-9 ]+$/, {
    message: 'Release track name may only contain alphanumeric characters and spaces',
  });

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

const includeQuerySchema = z.enum(['staged', 'candidates', 'all']);

const trackTypeQuerySchema = z.enum(['standard', 'virtual']);

const bumpTypeSchema = z.enum(['major', 'minor']);

const workflowStatusSchema = z.enum(['work-in-progress', 'awaiting-review', 'reviewed']);

const candidacyThresholdSchema = z.enum(['work-in-progress', 'awaiting-review', 'reviewed']);

const deduplicationStrategySchema = z.enum([
  'prioritize_latest_object',
  'prioritize_latest_snapshot',
  'prioritize_higher_priority',
  'quarantine',
]);

const resolutionStrategySchema = z.enum(['latest_tagged', 'specific_version', 'specific_snapshot']);

const conflictPolicySchema = z.enum([
  'prefer_latest',
  'always_overwrite',
  'always_reject',
  'abort',
]);

// =============================================================================
// Request body schemas (used inline by controller handlers)
// =============================================================================

/** POST /release-tracks/new */
const snapshotScheduleSchema = z.object({
  mode: z.enum(['manual', 'cron', 'dates']),
  cron: cronSchema.optional(),
  dates: z.array(z.iso.datetime()).optional(),
});

const componentTrackSchema = z.object({
  track_id: releaseTrackIdSchema,
  resolution_strategy: resolutionStrategySchema,
  priority: z.number().int().min(0).optional(),
  version: xMitreVersionSchema.optional(),
  snapshot: z.iso.datetime().optional(),
  filters: z
    .object({
      object_types: z.array(z.string()).optional(),
      domains: z.array(z.string()).optional(),
    })
    .optional(),
});

const compositionSchema = z.object({
  component_tracks: z.array(componentTrackSchema).min(1),
  deduplication: z
    .object({
      strategy: deduplicationStrategySchema,
    })
    .optional(),
});

const createTrackBodySchema = z.object({
  name: trackNameSchema,
  description: z.string().optional(),
  type: trackTypeQuerySchema.default('standard'),
  object_marking_refs: z.array(stixIdentifierSchema).optional(),
  composition: compositionSchema.optional(),
  snapshot_schedule: snapshotScheduleSchema.optional(),
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
  object_marking_refs: z.array(stixIdentifierSchema).optional(),
});

/** POST /release-tracks/:id/contents */
const updateContentsBodySchema = z.object({
  x_mitre_contents: z
    .array(
      z.object({
        obj_ref: stixIdentifierSchema,
        obj_modified: z.iso.datetime().or(z.literal('latest')),
      }),
    )
    .min(1),
});

/** POST /release-tracks/:id/bump */
const bumpBodySchema = z.object({
  type: bumpTypeSchema.optional(),
  version: xMitreVersionSchema.optional(),
  dry_run: z.boolean().optional(),
});

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
  from: workflowStatusSchema,
  to: workflowStatusSchema,
  object_refs: z
    .array(
      z.union([
        stixIdentifierSchema,
        z.object({
          id: stixIdentifierSchema,
          modified: z.iso.datetime().optional(),
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
        modified: z.iso.datetime(),
      }),
    )
    .min(1),
});

/** POST /release-tracks/:id/candidates/:objectRef/update-version */
const updateCandidateVersionBodySchema = z.object({
  old_modified: z.iso.datetime(),
  new_modified: z.iso.datetime(),
});

/** PUT /release-tracks/:id/config */
const promotionConflictsSchema = z.object({
  candidates_to_staged: conflictPolicySchema.exclude(['abort']).optional(),
  staged_to_members: conflictPolicySchema.optional(),
});

const updateConfigBodySchema = z.object({
  candidacy_threshold: candidacyThresholdSchema.optional(),
  auto_promote: z.boolean().optional(),
  include_candidates_in_snapshots: z.boolean().optional(),
  promotion_conflicts: promotionConflictsSchema.optional(),
});

/** PUT /release-tracks/:id/composition */
const updateCompositionBodySchema = compositionSchema;

/** POST /release-tracks/:id/snapshots/create */
const createVirtualSnapshotBodySchema = z
  .object({
    description: z.string().optional(),
  })
  .optional();

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

  // Re-exports from @mitre-attack/attack-data-model
  stixIdentifierSchema,
  xMitreVersionSchema,
  createStixIdValidator,

  // Query parameter schemas
  domainParamSchema,
  formatQuerySchema,
  includeQuerySchema,
  trackTypeQuerySchema,
  bumpTypeSchema,
  workflowStatusSchema,
  candidacyThresholdSchema,
  deduplicationStrategySchema,
  resolutionStrategySchema,
  conflictPolicySchema,

  // Request body schemas
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

  // Reusable sub-schemas
  componentTrackSchema,
  compositionSchema,
  snapshotScheduleSchema,
  objectRefEntrySchema,
  promotionConflictsSchema,
};
