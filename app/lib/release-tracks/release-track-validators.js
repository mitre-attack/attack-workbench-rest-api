'use strict';

// =============================================================================
// Mongoose custom validators for release track model schemas.
//
// Each export is a { validator, message } object compatible with Mongoose's
// custom validator interface. Internally they delegate to the Zod schemas
// defined in ./release-track-schemas.js.
//
// See: https://mongoosejs.com/docs/validation.html#custom-validators
// =============================================================================

const {
  releaseTrackIdSchema,
  trackNameSchema,
  cronSchema,
  stixIdentifierSchema,
  xMitreVersionSchema,
  createStixIdValidator,
} = require('./release-track-schemas');

// -----------------------------------------------------------------------------
// Mongoose validators
// -----------------------------------------------------------------------------

const validateTrackId = {
  validator: (v) => releaseTrackIdSchema.safeParse(v).success,
  message: (props) =>
    `"${props.value}" is not a valid release track ID (expected "release-track--<uuid>")`,
};

const validateTrackName = {
  validator: (v) => trackNameSchema.safeParse(v).success,
  message: (props) =>
    `"${props.value}" is not a valid release track name (only alphanumeric characters and spaces allowed)`,
};

const validateStixId = {
  validator: (v) => stixIdentifierSchema.safeParse(v).success,
  message: (props) => `"${props.value}" is not a valid STIX ID (expected "<type>--<uuid>")`,
};

const validateIdentityRef = {
  validator: (v) => createStixIdValidator('identity').safeParse(v).success,
  message: (props) =>
    `"${props.value}" is not a valid identity reference (expected "identity--<uuid>")`,
};

const validateMarkingDefRefs = {
  validator: (v) =>
    v.every((ref) => createStixIdValidator('marking-definition').safeParse(ref).success),
  message: () =>
    'Each marking reference must be a valid marking-definition ID (expected "marking-definition--<uuid>")',
};

const validateVersion = {
  validator: (v) => v === null || xMitreVersionSchema.safeParse(v).success,
  message: (props) =>
    `"${props.value}" is not a valid version (expected MAJOR.MINOR format, e.g. "1.0")`,
};

const validateCron = {
  validator: (v) => cronSchema.safeParse(v).success,
  message: (props) => `"${props.value}" is not a valid cron expression (expected 5 fields)`,
};

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  validateTrackId,
  validateTrackName,
  validateStixId,
  validateIdentityRef,
  validateMarkingDefRefs,
  validateVersion,
  validateCron,
};
