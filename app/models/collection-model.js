'use strict';

const mongoose = require('mongoose');
const AttackObject = require('./attack-object-model');
const workspaceDefinitions = require('./subschemas/workspace');
const stixCoreDefinitions = require('./subschemas/stix-core');
const { ModelName } = require('../lib/model-names');

const xMitreContent = {
  object_ref: { type: String, required: true },
  object_modified: { type: Date, required: true },
};
const xMitreContentSchema = new mongoose.Schema(xMitreContent, { _id: false });

const xMitreCollection = {
  modified: { type: Date, required: true },
  name: { type: String, required: true },
  description: String,

  x_mitre_modified_by_ref: String,
  x_mitre_contents: { type: [xMitreContentSchema], default: undefined },
  x_mitre_deprecated: { type: Boolean, required: true, default: false },
  x_mitre_domains: { type: [String], default: undefined },
  x_mitre_version: String,
  x_mitre_attack_spec_version: String,
};

// Create the definition
const collectionDefinition = {
  workspace: {
    ...workspaceDefinitions.collection,
  },
  stix: {
    ...stixCoreDefinitions.commonRequiredSDO,
    ...stixCoreDefinitions.commonOptionalSDO,
    ...xMitreCollection,
  },
};

// Create the schema
const collectionSchema = new mongoose.Schema(collectionDefinition);

// Create the model
const CollectionModel = AttackObject.discriminator(ModelName.Collection, collectionSchema);

module.exports = CollectionModel;
