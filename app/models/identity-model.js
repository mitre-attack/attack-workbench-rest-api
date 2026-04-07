'use strict';

const mongoose = require('mongoose');
const AttackObject = require('./attack-object-model');
const stixCoreDefinitions = require('./subschemas/stix-core');
const { ModelName } = require('../lib/model-names');

const identityProperties = {
  // identity specific properties
  modified: { type: Date, required: true },
  name: { type: String, required: true },
  description: String,
  roles: { type: [String], default: undefined },
  identity_class: String,
  sectors: { type: [String], default: undefined },
  contact_information: String,

  // ATT&CK custom stix properties
  x_mitre_attack_spec_version: String,
};

// Create the definition
const identityDefinition = {
  stix: {
    ...stixCoreDefinitions.commonRequiredSDO,
    ...stixCoreDefinitions.commonOptionalSDO,
    ...identityProperties,
  },
};

// Create the schema
const identitySchema = new mongoose.Schema(identityDefinition);

// Create the model
const IdentityModel = AttackObject.discriminator(ModelName.Identity, identitySchema);

module.exports = IdentityModel;
