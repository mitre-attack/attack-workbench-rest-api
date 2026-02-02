'use strict';

const mongoose = require('mongoose');
const {
  validateTrackId,
  validateTrackName,
  validateVersion,
  validateCron,
} = require('../../lib/release-tracks/release-track-validators');

// --- Sub-schemas ---

const snapshotScheduleDefinition = {
  mode: {
    type: String,
    enum: ['manual', 'cron', 'dates'],
    default: 'manual',
  },
  cron: {
    type: String,
    validate: validateCron,
  },
  dates: { type: [Date], default: undefined },
};
const snapshotScheduleSchema = new mongoose.Schema(snapshotScheduleDefinition, { _id: false });

// --- Registry document definition ---

const releaseTrackRegistryDefinition = {
  track_id: {
    type: String,
    required: [true, 'Release track ID is required'],
    index: { unique: true },
    validate: validateTrackId,
  },
  type: {
    type: String,
    enum: ['standard', 'virtual'],
    required: true,
  },
  name: {
    type: String,
    required: [true, 'Release track name is required'],
    validate: validateTrackName,
  },
  description: { type: String },

  // Denormalized for fast listing (updated on each snapshot/tag)
  latest_snapshot_modified: { type: Date },
  latest_tagged_version: {
    type: String,
    default: null,
    validate: validateVersion,
  },
  snapshot_count: { type: Number, default: 0 },
  tagged_release_count: { type: Number, default: 0 },

  // Virtual tracks only
  snapshot_schedule: { type: snapshotScheduleSchema, default: undefined },

  created_at: { type: Date, required: true },
  updated_at: { type: Date, required: true },
};

// --- Schema creation ---

const releaseTrackRegistrySchema = new mongoose.Schema(releaseTrackRegistryDefinition, {
  collection: 'releaseTrackRegistry',
  bufferCommands: false,
});

// --- Indexes ---

releaseTrackRegistrySchema.index({ type: 1 });

// --- Model creation ---

const ReleaseTrackRegistryModel = mongoose.model(
  'ReleaseTrackRegistry',
  releaseTrackRegistrySchema,
);

module.exports = ReleaseTrackRegistryModel;
