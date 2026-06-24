'use strict';

const mongoose = require('mongoose');

// Create the definition
const systemConfigurationDefinition = {
  organization_identity_ref: { type: String, required: true },
  anonymous_user_account_id: String,
  default_marking_definitions: [String],
  organization_namespace: {
    range_start: { type: Number, default: null },
    prefix: { type: String, default: null },
  },
  mitre_identity_writes_enabled: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
};

// Create the schema
const systemConfigurationSchema = new mongoose.Schema(systemConfigurationDefinition, {
  bufferCommands: false,
});

// Create the model
const SystemConfigurationModel = mongoose.model('SystemConfiguration', systemConfigurationSchema);

module.exports = SystemConfigurationModel;
