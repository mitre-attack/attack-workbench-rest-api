'use strict';

const mongoose = require('mongoose');
const workspaceDefinitions = require('./subschemas/workspace');
const stixCoreDefinitions = require('./subschemas/stix-core');
const { ModelName } = require('../lib/model-names');

const relationshipProperties = {
  // relationship specific properties
  modified: { type: Date, required: true },
  name: String,
  description: String,
  relationship_type: { type: String, required: true },
  source_ref: { type: String, required: true },
  target_ref: { type: String, required: true },
  start_time: Date,
  stop_time: Date,

  // ATT&CK custom stix properties
  x_mitre_modified_by_ref: String,
  x_mitre_deprecated: Boolean,
  x_mitre_attack_spec_version: String,
  x_mitre_log_source_channel: String,
};

const exactObjectRevision = {
  object_ref: { type: String, required: true },
  object_modified: { type: Date, required: true },
};
const exactObjectRevisionSchema = new mongoose.Schema(exactObjectRevision, {
  _id: false,
});

// Create the definition
const relationshipDefinition = {
  workspace: {
    ...workspaceDefinitions.common,
    relationship_endpoints: {
      source: { type: exactObjectRevisionSchema, required: true },
      target: { type: exactObjectRevisionSchema, required: true },
    },
  },
  stix: {
    ...stixCoreDefinitions.commonRequiredSDO,
    ...stixCoreDefinitions.commonOptionalSDO,
    ...relationshipProperties,
  },
};

// Create the schema
const relationshipSchema = new mongoose.Schema(relationshipDefinition);

relationshipSchema.index({ 'stix.id': 1, 'stix.modified': -1 }, { unique: true });

// Multikey index supporting reverse lookups from release tracks
// (release-track backref reconciliation queries by workspace.release_tracks.id)
relationshipSchema.index({ 'workspace.release_tracks.id': 1 }, { sparse: true });
relationshipSchema.index({ 'stix.source_ref': 1 });
relationshipSchema.index({ 'stix.target_ref': 1 });
relationshipSchema.index({
  'workspace.relationship_endpoints.source.object_ref': 1,
  'workspace.relationship_endpoints.source.object_modified': 1,
});
relationshipSchema.index({
  'workspace.relationship_endpoints.target.object_ref': 1,
  'workspace.relationship_endpoints.target.object_modified': 1,
});

// Durable insert recovery is independent of scan checkpoints and scheduler enablement.
relationshipSchema.index(
  { 'workspace.evaluation_needed': 1 },
  { partialFilterExpression: { 'workspace.evaluation_needed': true } },
);

// Create the model
const RelationshipModel = mongoose.model(ModelName.Relationship, relationshipSchema);

module.exports = RelationshipModel;
