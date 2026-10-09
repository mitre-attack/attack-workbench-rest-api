'use strict';

const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    reportId: { type: String, required: true },
    object_ref: { type: String, required: true },
    object_modified: String,
    ruleId: { type: String, required: true },
    ruleName: { type: String, required: true },
    retirementStatus: { type: String, enum: ['revoked', 'deprecated'], required: true },
    phase: { type: String, enum: ['preflight', 'evaluation'], required: true },
    ordinal: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'validationReportApplications', versionKey: false, bufferCommands: false },
);
schema.index({ reportId: 1, ordinal: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('ValidationReportApplication', schema);
