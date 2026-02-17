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

module.exports = {
  STIX_SCHEMAS,
};
