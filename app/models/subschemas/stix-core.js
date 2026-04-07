'use strict';

const mongoose = require('mongoose');

const externalReference = {
  source_name: { type: String, required: true },
  description: { type: String },
  url: { type: String },
  external_id: { type: String },
};
const externalReferenceSchema = new mongoose.Schema(externalReference, { _id: false });

const killChainPhase = {
  kill_chain_name: { type: String, required: true },
  phase_name: { type: String, required: true },
};
module.exports.killChainPhaseSchema = new mongoose.Schema(killChainPhase, { _id: false });

module.exports.commonRequiredSDO = {
  type: {
    type: String,
    enum: [
      'attack-pattern',
      'campaign',
      'course-of-action',
      'identity',
      'intrusion-set',
      'malware',
      'marking-definition',
      'note',
      'relationship',
      'tool',
      'x-mitre-analytic',
      'x-mitre-asset',
      'x-mitre-collection',
      'x-mitre-data-source',
      'x-mitre-data-component',
      'x-mitre-matrix',
      'x-mitre-tactic',
      'x-mitre-detection-strategy',
    ],
  },
  spec_version: { type: String, required: true },
  id: { type: String, required: true },
  created: { type: Date, required: true },
};

module.exports.commonOptionalSDO = {
  created_by_ref: { type: String },
  revoked: { type: Boolean },
  external_references: { type: [externalReferenceSchema], default: undefined },
  object_marking_refs: { type: [String], default: undefined },
};
