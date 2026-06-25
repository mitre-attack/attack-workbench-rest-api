'use strict';

const mongoose = require('mongoose');
const AttackObject = require('./attack-object-model');
const stixCoreDefinitions = require('./subschemas/stix-core');
const { ModelName } = require('../lib/model-names');

const stixDetectionStrategy = {
  modified: { type: Date, required: true },
  name: { type: String, required: true },

  x_mitre_modified_by_ref: String,
  x_mitre_deprecated: { type: Boolean, required: true, default: false },
  x_mitre_version: String,
  x_mitre_attack_spec_version: String,
  x_mitre_domains: { type: [String], default: undefined },
  x_mitre_analytic_refs: { type: [String], default: undefined },
  x_mitre_contributors: { type: [String], default: undefined },
};

// Create the definition
const detectionStrategyDefinition = {
  stix: {
    ...stixCoreDefinitions.commonRequiredSDO,
    ...stixCoreDefinitions.commonOptionalSDO,
    ...stixDetectionStrategy,
  },
};

// Create the schema
const detectionStrategySchema = new mongoose.Schema(detectionStrategyDefinition);

// Create the model
const DetectionStrategyModel = AttackObject.discriminator(
  ModelName.DetectionStrategy,
  detectionStrategySchema,
);

module.exports = DetectionStrategyModel;
