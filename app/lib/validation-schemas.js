'use strict';

const {
  tacticSchema,

  /** techniques */
  techniqueSchema,
  techniquePartialSchema,

  /** groups */
  groupSchema,
  groupPartialSchema,

  /** malware */
  malwareSchema,
  malwarePartialSchema,

  /** tools */
  toolSchema,
  toolPartialSchema,

  /** campaigns */
  campaignSchema,
  campaignPartialSchema,

  /** relationships */
  relationshipSchema,
  relationshipPartialSchema,

  /** simple schemas (no checks/refinements) */
  identitySchema,
  mitigationSchema,
  assetSchema,
  dataSourceSchema,
  dataComponentSchema,
  detectionStrategySchema,
  analyticSchema,
  matrixSchema,
  collectionSchema,
  markingDefinitionSchema,
} = require('@mitre-attack/attack-data-model/dist/index.cjs');

// The ADM package exposes two validation shapes for several STIX types:
// - a full schema for normal validation
// - a prebuilt partial schema for draft/work-in-progress validation
//
// Workbench treats `work-in-progress` objects differently from objects in
// later workflow states. WIP objects are allowed to omit fields that are still
// being authored, while `awaiting-review` and `reviewed` objects should be
// held to the complete schema.
//
// We prefer the ADM-provided `*PartialSchema` exports when they exist rather
// than deriving them ourselves at call time. That keeps this layer aligned
// with however ADM composes partial validation for schemas that may include
// additional checks or refinements.
const STIX_SCHEMAS = {
  'x-mitre-tactic': tacticSchema,
  'attack-pattern': {
    full: techniqueSchema,
    partial: techniquePartialSchema,
  },
  'intrusion-set': {
    full: groupSchema,
    partial: groupPartialSchema,
  },
  malware: {
    full: malwareSchema,
    partial: malwarePartialSchema,
  },
  tool: {
    full: toolSchema,
    partial: toolPartialSchema,
  },
  campaign: {
    full: campaignSchema,
    partial: campaignPartialSchema,
  },
  relationship: {
    full: relationshipSchema,
    partial: relationshipPartialSchema,
  },
  identity: identitySchema,
  'course-of-action': mitigationSchema,
  'marking-definition': markingDefinitionSchema,
  'x-mitre-asset': assetSchema,
  'x-mitre-data-source': dataSourceSchema,
  'x-mitre-data-component': dataComponentSchema,
  'x-mitre-detection-strategy': detectionStrategySchema,
  'x-mitre-analytic': analyticSchema,
  'x-mitre-matrix': matrixSchema,
  'x-mitre-collection': collectionSchema,
};

// Cache for locally-derived partial schemas. ADM does not export prebuilt
// partials for every STIX type; for those types we call `.partial()` ourselves.
// That call is expensive enough to show up in bulk-import profiles, so we
// memoize the result per STIX type.
const derivedPartialCache = new Map();

/**
 * Get the schema to use for validating a STIX object.
 *
 * Some STIX types define both a full schema and a prebuilt partial schema,
 * while others only define a single schema (no partial variant). This helper
 * selects the correct schema based on the STIX type and workflow status.
 *
 * Determination rules:
 * - `work-in-progress` uses partial validation so drafts can omit required fields
 * - every other workflow state uses full validation
 * - if ADM exports a dedicated partial schema, use it directly
 * - otherwise, derive a partial schema locally with `.partial()` (memoized)
 *
 * @param {string} stixType - The STIX `type` being validated (e.g. "attack-pattern")
 * @param {string} status - The workflow state (e.g. "work-in-progress", "awaiting-review", "reviewed")
 * @returns {Object|null} Zod schema, or null if the STIX type is unknown
 */
function getSchema(stixType, status) {
  const admSchemaRef = STIX_SCHEMAS[stixType];
  if (!admSchemaRef) return null;

  // Only draft objects get partial validation. Once an object leaves the
  // work-in-progress state, we validate it against the full schema.
  const isWip = status === 'work-in-progress';

  if (admSchemaRef.full && admSchemaRef.partial) {
    return isWip ? admSchemaRef.partial : admSchemaRef.full;
  }

  if (!isWip) return admSchemaRef;

  let derived = derivedPartialCache.get(stixType);
  if (!derived) {
    derived = admSchemaRef.partial();
    derivedPartialCache.set(stixType, derived);
  }
  return derived;
}

module.exports = {
  STIX_SCHEMAS,
  getSchema,
};
