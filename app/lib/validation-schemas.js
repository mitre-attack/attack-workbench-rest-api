'use strict';

const {
  tacticSchema,

  /** techniques */
  techniqueBaseSchema,

  /** groups */
  groupBaseSchema,

  /** malware */
  malwareBaseSchema,

  /** tools */
  toolBaseSchema,

  /** campaigns */
  campaignBaseSchema,

  /** relationships */
  relationshipBaseSchema,

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
} = require('@mitre-attack/attack-data-model/dist');

// The ADM exports bundles of refinements (checks) for any schemas which support partial schema derivatives.
// e.g., The technique.schema module exports: (1) techniqueBaseSchema, (2) techniquePartialSchema, (3) techniqueChecks
//
// This enables users to easily compose custom schemas w/o running into the Zod restriction introduced in v4.3.6 where
// `.omit`, `.pick`, and `.partial` throw when `.check` is chained on.
// (Details: https://github.com/mitre-attack/attack-data-model/pull/65)
//
// In Workbench, this is specifically necessary because the ADM validation middleware needs to omit checking fields
// which only the backend sets, e.g., `x_mitre_attack_spec_version` is set by the backend, therefore it's never passed/set in
// the req.body of POST/create requests, therefore we need to avoid scrutinizing that field in the ADM validation middleware.
//
// Composition order (for schemas with checks):
//   base schema → .omit() → .partial() (if WIP) → .check(checks)
// This ensures .omit() and .partial() are called BEFORE .check(), avoiding the Zod restriction.

const {
  techniqueChecks,
} = require('@mitre-attack/attack-data-model/dist/schemas/sdo/technique.schema');
const { groupChecks } = require('@mitre-attack/attack-data-model/dist/schemas/sdo/group.schema');
const {
  campaignChecks,
} = require('@mitre-attack/attack-data-model/dist/schemas/sdo/campaign.schema');
const {
  relationshipChecks,
} = require('@mitre-attack/attack-data-model/dist/schemas/sro/relationship.schema');
const {
  malwareChecks,
} = require('@mitre-attack/attack-data-model/dist/schemas/sdo/malware.schema');
const { toolChecks } = require('@mitre-attack/attack-data-model/dist/schemas/sdo/tool.schema');

const STIX_SCHEMAS = {
  'x-mitre-tactic': tacticSchema,
  'attack-pattern': {
    base: techniqueBaseSchema,
    checks: techniqueChecks,
  },
  'intrusion-set': {
    base: groupBaseSchema,
    checks: groupChecks,
  },
  malware: {
    base: malwareBaseSchema,
    checks: malwareChecks,
  },
  tool: {
    base: toolBaseSchema,
    checks: toolChecks,
  },
  campaign: {
    base: campaignBaseSchema,
    checks: campaignChecks,
  },
  relationship: {
    base: relationshipBaseSchema,
    checks: relationshipChecks,
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

/**
 * Configuration for transforming validation errors (to warnings or suppression).
 * These rules handle errors produced by ADM schemas for server-controlled fields that
 * clients cannot or should not set. They are used by both the validate endpoint and the
 * service layer's post-composition validation.
 *
 * On a fully-composed object (service layer), suppression rules naturally don't fire
 * because server-controlled fields are already populated — no missing-field errors occur.
 * On a pre-composed object (validate endpoint), suppression rules fire for fields
 * the server will generate, preventing false negatives.
 *
 * Rule schema:
 *   fieldPath     - Zod error path to match (e.g., ['stix', 'x_mitre_attack_spec_version'])
 *   errorCode     - Zod error code to match (e.g., 'invalid_type', 'invalid_value')
 *   stixType      - Which STIX types: a string, an array, or 'all'
 *   suppressError - If true, the error is silently dropped
 *   warningMessage - If set (and suppressError is falsy), convert to warning with this message
 *   status        - (Optional, future use) Which workflow states the rule applies to
 */
const ERROR_TRANSFORMATION_RULES = [
  // Server always sets x_mitre_attack_spec_version
  {
    fieldPath: ['x_mitre_attack_spec_version'],
    errorCode: 'invalid_type',
    stixType: 'all',
    suppressError: true,
  },
  // Server sets x_mitre_modified_by_ref based on authenticated user - user does not need to supply it
  {
    fieldPath: ['x_mitre_modified_by_ref'],
    errorCode: 'invalid_value',
    stixType: 'all',
    suppressError: true,
  },
  // Warn about non-standard tactic shortnames
  {
    fieldPath: ['x_mitre_shortname'],
    errorCode: 'invalid_value',
    stixType: 'x-mitre-tactic',
    warningMessage:
      'Tactic shortname does not match predefined ATT&CK tactics. This may prevent compatibility with official ATT&CK data but can be used for custom taxonomies.',
  },
  // Server sets x_mitre_domains for certain types (assigned during bundle export)
  {
    fieldPath: ['x_mitre_domains'],
    errorCode: 'invalid_type',
    stixType: ['intrusion-set', 'campaign', 'x-mitre-matrix', 'x-mitre-detection-strategy'],
    suppressError: true,
  },
  // Server sets object_marking_refs for certain types
  {
    fieldPath: ['object_marking_refs'],
    errorCode: 'invalid_type',
    stixType: ['campaign', 'identity'],
    suppressError: true,
  },
  // Server sets created_by_ref for certain types
  {
    fieldPath: ['created_by_ref'],
    errorCode: 'invalid_type',
    stixType: ['campaign', 'x-mitre-matrix', 'x-mitre-asset', 'course-of-action'],
    suppressError: true,
  },
];

module.exports = {
  STIX_SCHEMAS,
  ERROR_TRANSFORMATION_RULES,
};
