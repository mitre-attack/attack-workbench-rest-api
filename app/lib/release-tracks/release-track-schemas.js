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
};
