'use strict';

const mongoose = require('mongoose');
const AttackObject = require('./attack-object-model');
const stixCoreDefinitions = require('./subschemas/stix-core');
const { ModelName } = require('../lib/model-names');

const stixDataSource = {
  // STIX x-mitre-data-source specific properties
  modified: { type: Date, required: true },
  name: { type: String, required: true },
  description: String,

  // ATT&CK custom stix properties
  x_mitre_modified_by_ref: String,
  x_mitre_platforms: { type: [String], default: undefined },
  x_mitre_deprecated: { type: Boolean, required: true, default: false },
  x_mitre_domains: { type: [String], default: undefined },
  x_mitre_version: String,
  x_mitre_attack_spec_version: String,
  x_mitre_contributors: { type: [String], default: undefined },
  x_mitre_collection_layers: { type: [String], default: undefined },
};

// Create the definition
const dataSourceDefinition = {
  stix: {
    ...stixCoreDefinitions.commonRequiredSDO,
    ...stixCoreDefinitions.commonOptionalSDO,
    ...stixDataSource,
  },
};

// Create the schema
const dataSourceSchema = new mongoose.Schema(dataSourceDefinition);

// Create the model
const DataSourceModel = AttackObject.discriminator(ModelName.DataSource, dataSourceSchema);

module.exports = DataSourceModel;
