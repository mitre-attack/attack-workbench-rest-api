'use strict';

const mongoose = require('mongoose');

// Deliberately no TTL or stale-owner takeover: an expired lease cannot fence
// a paused writer on standalone MongoDB. A crashed owner fails closed until
// an operator stops all API workers and removes this lock document.
const schema = new mongoose.Schema(
  { _id: String, token: String, acquired_at: Date },
  { collection: 'graphWriteLocks', versionKey: false },
);
const GraphWriteLock = mongoose.model('GraphWriteLock', schema);

exports.acquire = (token) =>
  GraphWriteLock.create({ _id: 'stix-graph', token, acquired_at: new Date() });
exports.release = (token) => GraphWriteLock.deleteOne({ _id: 'stix-graph', token }).exec();
