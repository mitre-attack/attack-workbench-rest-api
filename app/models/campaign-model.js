'use strict';

const mongoose = require('mongoose');
const AttackObject = require('./attack-object-model');
const stixCoreDefinitions = require('./subschemas/stix-core');
const { ModelName } = require('../lib/model-names');

const stixCampaign = {
  // STIX campaign specific properties
  modified: { type: Date, required: true },
  name: { type: String, required: true },
  description: String,
  aliases: { type: [String], default: undefined },
  first_seen: Date,
  last_seen: Date,

  // ATT&CK custom stix properties
  x_mitre_first_seen_citation: String,
  x_mitre_last_seen_citation: String,
  x_mitre_modified_by_ref: String,
  x_mitre_deprecated: { type: Boolean, required: true, default: false },
  x_mitre_version: String,
  x_mitre_attack_spec_version: String,
  x_mitre_contributors: { type: [String], default: undefined },
};

// Create the definition
const campaignDefinition = {
  stix: {
    ...stixCoreDefinitions.commonRequiredSDO,
    ...stixCoreDefinitions.commonOptionalSDO,
    ...stixCampaign,
  },
};

// Create the schema
const campaignSchema = new mongoose.Schema(campaignDefinition);

// Create the model
const CampaignModel = AttackObject.discriminator(ModelName.Campaign, campaignSchema);

module.exports = CampaignModel;
