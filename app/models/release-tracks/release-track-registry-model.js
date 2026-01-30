'use strict';

const mongoose = require('mongoose');

// --- Validation patterns ---

const TRACK_ID_RE = /^release-track--[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TRACK_NAME_RE = /^[a-zA-Z0-9 ]+$/;
const VERSION_RE = /^\d+\.\d+$/;
const CRON_RE = /^(\S+\s+){4}\S+$/;

// --- Sub-schemas ---

const snapshotScheduleDefinition = {
  mode: {
    type: String,
    enum: ['manual', 'cron', 'dates'],
    default: 'manual',
  },
  cron: {
    type: String,
    validate: {
      validator: (v) => CRON_RE.test(v),
      message: (props) => `"${props.value}" is not a valid cron expression (expected 5 fields)`,
    },
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
    validate: {
      validator: (v) => TRACK_ID_RE.test(v),
      message: (props) =>
        `"${props.value}" is not a valid release track ID (expected "release-track--<uuid>")`,
    },
  },
  type: {
    type: String,
    enum: ['standard', 'virtual'],
    required: true,
  },
  name: {
    type: String,
    required: [true, 'Release track name is required'],
    validate: {
      validator: (v) => TRACK_NAME_RE.test(v),
      message: (props) =>
        `"${props.value}" is not a valid release track name (only alphanumeric characters and spaces allowed)`,
    },
  },
  description: { type: String },

  // Denormalized for fast listing (updated on each snapshot/tag)
  latest_snapshot_modified: { type: Date },
  latest_tagged_version: {
    type: String,
    default: null,
    validate: {
      validator: (v) => v === null || VERSION_RE.test(v),
      message: (props) =>
        `"${props.value}" is not a valid version (expected MAJOR.MINOR format, e.g. "1.0")`,
    },
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
