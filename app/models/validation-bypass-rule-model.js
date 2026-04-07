'use strict';

const mongoose = require('mongoose');

const BypassRuleReasons = require('../lib/bypass-rule-constants');

const validationBypassRuleDefinition = {
  fieldPath: { type: [String], required: true },
  errorCode: { type: String, required: true },
  stixType: { type: String, required: true },
  suppressError: { type: Boolean, default: true },
  autoCreated: { type: Boolean, default: false },
  autoCreatedReason: {
    type: String,
    enum: [...Object.values(BypassRuleReasons), null],
    default: null,
  },
  triggerEvent: { type: String, default: null },
  warningMessage: { type: String, default: null },
};

const validationBypassRuleSchema = new mongoose.Schema(validationBypassRuleDefinition, {
  bufferCommands: false,
});

// Prevent duplicate rules for the same field/code/type combination
validationBypassRuleSchema.index({ fieldPath: 1, errorCode: 1, stixType: 1 }, { unique: true });

const ValidationBypassRuleModel = mongoose.model(
  'ValidationBypassRule',
  validationBypassRuleSchema,
);

module.exports = ValidationBypassRuleModel;
