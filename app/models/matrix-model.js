'use strict';

const mongoose = require('mongoose');
const AttackObject = require('./attack-object-model');
const stixCoreDefinitions = require('./subschemas/stix-core');
const { ModelName } = require('../lib/model-names');

const matrixProperties = {
  // x-mitre-matrix specific properties
  modified: { type: Date, required: true },
  name: { type: String, required: true },
  description: String,

  // ATT&CK custom stix properties
  tactic_refs: { type: [String], default: undefined },
  x_mitre_modified_by_ref: String,
  x_mitre_deprecated: { type: Boolean, required: true, default: false },
  x_mitre_domains: { type: [String], default: undefined }, // TBD drop this property
  x_mitre_version: String,
  x_mitre_attack_spec_version: String,
};

// Create the definition
const matrixDefinition = {
  stix: {
    ...stixCoreDefinitions.commonRequiredSDO,
    ...stixCoreDefinitions.commonOptionalSDO,
    ...matrixProperties,
  },
};

// Create the schema
const matrixSchema = new mongoose.Schema(matrixDefinition);

// Create the model
const MatrixModel = AttackObject.discriminator(ModelName.Matrix, matrixSchema);

module.exports = MatrixModel;
