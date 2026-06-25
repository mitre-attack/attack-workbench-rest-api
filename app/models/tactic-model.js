'use strict';

const mongoose = require('mongoose');
const AttackObject = require('./attack-object-model');
const stixCoreDefinitions = require('./subschemas/stix-core');
const { ModelName } = require('../lib/model-names');

const stixTactic = {
  // STIX x-mitre-tactic specific properties
  modified: { type: Date, required: true },
  name: { type: String, required: true },
  description: String,

  // ATT&CK custom stix properties
  x_mitre_modified_by_ref: String,
  x_mitre_deprecated: { type: Boolean, required: true, default: false },
  x_mitre_domains: { type: [String], default: undefined },
  x_mitre_version: String,
  x_mitre_attack_spec_version: String,
  x_mitre_contributors: { type: [String], default: undefined },
  x_mitre_shortname: String,
};

// Create the definition
const tacticDefinition = {
  stix: {
    ...stixCoreDefinitions.commonRequiredSDO,
    ...stixCoreDefinitions.commonOptionalSDO,
    ...stixTactic,
  },
};

// Create the schema
const tacticSchema = new mongoose.Schema(tacticDefinition);

// Create the model
const TacticModel = AttackObject.discriminator(ModelName.Tactic, tacticSchema);

module.exports = TacticModel;
