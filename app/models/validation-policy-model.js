'use strict';

const mongoose = require('mongoose');

// Rules are validated by the rule union at the repository boundary. Mixed storage
// preserves the historical payload (including missing kind) and stable ObjectIds.
const schema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    rules: { type: [mongoose.Schema.Types.Mixed], required: true },
    policy_revision: { type: Number, required: true },
    evaluation_generation: { type: Number, required: true },
    engine_context: { type: mongoose.Schema.Types.Mixed, required: true },
    defaults_seeded: { type: Boolean, required: true },
    publication_sequence: { type: Number, required: true },
    reconciliation: {
      status: { type: String, enum: ['pending', 'running', 'completed', 'failed', 'superseded'] },
      desired_policy_revision: Number,
      desired_generation: Number,
      desired_engine_context: mongoose.Schema.Types.Mixed,
      counts: mongoose.Schema.Types.Mixed,
      total: Number,
      checkpoint: mongoose.Schema.Types.Mixed,
      claim_token: String,
      owner: String,
      lease_expires_at: Date,
      publication_token: Number,
      error: mongoose.Schema.Types.Mixed,
      requested_at: Date,
      started_at: Date,
      completed_at: Date,
    },
  },
  { collection: 'validationPolicies', bufferCommands: false, versionKey: false },
);

module.exports = mongoose.model('ValidationPolicy', schema);
