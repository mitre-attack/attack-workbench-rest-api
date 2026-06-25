'use strict';

const mongoose = require('mongoose');
const AttackObject = require('./attack-object-model');
const stixCoreDefinitions = require('./subschemas/stix-core');
const { ModelName } = require('../lib/model-names');

const logSourceReference = {
  x_mitre_data_component_ref: { type: String, required: true },
  name: { type: String, required: true },
  channel: { type: String, required: true },
};

const logSourceReferenceSchema = new mongoose.Schema(logSourceReference, { _id: false });

const mutableElement = {
  field: { type: String, required: true },
  description: { type: String, required: true },
};

const mutableElementSchema = new mongoose.Schema(mutableElement, { _id: false });

const stixAnalytic = {
  modified: { type: Date, required: true },
  name: { type: String, required: true },
  description: String,

  x_mitre_modified_by_ref: String,
  x_mitre_deprecated: { type: Boolean, required: true, default: false },
  x_mitre_version: String,
  x_mitre_attack_spec_version: String,
  x_mitre_domains: { type: [String], default: undefined },
  x_mitre_platforms: { type: [String], default: undefined },
  x_mitre_log_source_references: { type: [logSourceReferenceSchema], default: undefined },
  x_mitre_mutable_elements: { type: [mutableElementSchema], default: undefined },
};

// Create the definition
const analyticDefinition = {
  stix: {
    ...stixCoreDefinitions.commonRequiredSDO,
    ...stixCoreDefinitions.commonOptionalSDO,
    ...stixAnalytic,
  },
};

// Create the schema
const analyticSchema = new mongoose.Schema(analyticDefinition);

// Create the model
const AnalyticModel = AttackObject.discriminator(ModelName.Analytic, analyticSchema);

module.exports = AnalyticModel;
