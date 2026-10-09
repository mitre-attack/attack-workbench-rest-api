'use strict';

const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    _id: String,
    owner: { type: mongoose.Schema.Types.Mixed, required: true },
    authorization: { type: mongoose.Schema.Types.Mixed, required: true },
    operation: { type: mongoose.Schema.Types.Mixed, required: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    state: { type: String, enum: ['completed', 'partial', 'building'], required: true },
    evaluatedScope: { type: mongoose.Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'validationReports', versionKey: false, bufferCommands: false },
);
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('ValidationReport', schema);
