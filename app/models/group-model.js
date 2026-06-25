'use strict';

const mongoose = require('mongoose');
const AttackObject = require('./attack-object-model');
const stixCoreDefinitions = require('./subschemas/stix-core');
const { ModelName } = require('../lib/model-names');

const stixIntrusionSet = {
  // STIX intrusion-set specific properties
  modified: { type: Date, required: true },
  name: { type: String, required: true },
  description: String,

  // ATT&CK custom stix properties
  aliases: { type: [String], default: undefined },
  x_mitre_modified_by_ref: String,
  x_mitre_deprecated: { type: Boolean, required: true, default: false },
  x_mitre_domains: { type: [String], default: undefined }, // TBD drop this property
  x_mitre_version: String,
  x_mitre_attack_spec_version: String,
  x_mitre_contributors: { type: [String], default: undefined },
};

// Create the definition
const groupDefinition = {
  stix: {
    ...stixCoreDefinitions.commonRequiredSDO,
    ...stixCoreDefinitions.commonOptionalSDO,
    ...stixIntrusionSet,
  },
};

// Create the schema
const groupSchema = new mongoose.Schema(groupDefinition);

// Create the model
const GroupModel = AttackObject.discriminator(ModelName.Group, groupSchema);

module.exports = GroupModel;
