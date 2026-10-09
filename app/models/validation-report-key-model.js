'use strict';

const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  { _id: String, secret: { type: String, required: true } },
  { collection: 'validationReportKeys', versionKey: false, bufferCommands: false },
);
module.exports = mongoose.model('ValidationReportKey', schema);
