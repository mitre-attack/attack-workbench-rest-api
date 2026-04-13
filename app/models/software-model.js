'use strict';

const mongoose = require('mongoose');
const AttackObject = require('./attack-object-model');
const stixCoreDefinitions = require('./subschemas/stix-core');
const { ModelName } = require('../lib/model-names');

const stixMalware = {
  // STIX malware and tool specific properties
  modified: { type: Date, required: true },
  name: { type: String, required: true },
  description: String,
  is_family: Boolean,

  // ATT&CK custom stix properties
  x_mitre_modified_by_ref: String,
  x_mitre_platforms: { type: [String], default: undefined },
  x_mitre_deprecated: { type: Boolean, required: true, default: false },
  x_mitre_domains: { type: [String], default: undefined },
  x_mitre_version: String,
  x_mitre_attack_spec_version: String,
  x_mitre_contributors: { type: [String], default: undefined },
  x_mitre_aliases: { type: [String], default: undefined },
};

// Create the definition
const softwareDefinition = {
  stix: {
    ...stixCoreDefinitions.commonRequiredSDO,
    ...stixCoreDefinitions.commonOptionalSDO,
    ...stixMalware,
  },
};

// Create the schema
const softwareSchema = new mongoose.Schema(softwareDefinition);

// Create the model
const SoftwareModel = AttackObject.discriminator(ModelName.Software, softwareSchema);

module.exports = SoftwareModel;
