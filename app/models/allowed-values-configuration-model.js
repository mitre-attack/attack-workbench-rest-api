'use strict';

const mongoose = require('mongoose');

const entrySchema = new mongoose.Schema({
  objectType: { type: String, required: true },
  propertyName: { type: String, required: true },
  domainName: { type: String, required: true },
  value: { type: String, required: true },
  enabled: { type: Boolean, required: true },
});

// A singleton makes first-time seeding and each administrator mutation atomic,
// including on standalone MongoDB deployments without transaction support.
const configurationSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    values: { type: [entrySchema], required: true },
    rules: {
      type: [
        new mongoose.Schema(
          {
            propertyName: { type: String, required: true },
            domainName: { type: String, required: true },
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
  },
  { bufferCommands: false, versionKey: false },
);

module.exports = mongoose.model('AllowedValuesConfiguration', configurationSchema);
