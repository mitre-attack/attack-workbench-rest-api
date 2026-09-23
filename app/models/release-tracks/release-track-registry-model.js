'use strict';

const mongoose = require('mongoose');
const {
  validateTrackId,
  validateTrackAlias,
  validateTrackName,
  validateVersion,
  validateCron,
  validateSnapshotSchedule,
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

const taggedReleaseDefinition = {
  snapshot_modified: { type: Date, required: true },
  version: {
    type: String,
    required: true,
    validate: validateVersion,
  },
  tagged_at: { type: Date, required: true },
  tagged_by: { type: String, required: true },
};
const taggedReleaseSchema = new mongoose.Schema(taggedReleaseDefinition, { _id: false });
const releaseLockSchema = new mongoose.Schema(
  {
    token: { type: String, required: true },
    acquired_at: { type: Date, required: true },
  },
  { _id: false },
);

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
  // Optional URL-safe slug accepted wherever the track ID is. Absent (not
  // null) when unset so the partial unique index ignores the document.
  alias: { type: String, validate: validateTrackAlias },

  // Denormalized for fast listing (updated on each snapshot/tag)
  latest_snapshot_modified: { type: Date },
  latest_tagged_version: {
    type: String,
    default: null,
    validate: validateVersion,
  },
  snapshot_count: { type: Number, default: 0 },
  tagged_release_count: { type: Number, default: 0 },
  tagged_releases: { type: [taggedReleaseSchema], default: [] },
  release_lock: { type: releaseLockSchema, default: undefined },

  // Virtual tracks only
  draft_retention: {
    type: new mongoose.Schema(
      {
        max_drafts: {
          type: Number,
          default: null,
          validate: (value) => value == null || (Number.isSafeInteger(value) && value > 0),
        },
      },
      { _id: false },
    ),
    default: undefined,
  },
  snapshot_schedule: {
    type: snapshotScheduleSchema,
    default: undefined,
    validate: {
      validator: function validateRegistrySnapshotSchedule(value) {
        const trackType = typeof this.getQuery === 'function' ? this.getQuery().type : this.type;
        return (
          value === undefined ||
          (trackType === 'virtual' && validateSnapshotSchedule.validator(value))
        );
      },
      message:
        'Snapshot schedule is only valid for virtual tracks and its fields must match its mode',
    },
  },

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
releaseTrackRegistrySchema.index(
  { alias: 1 },
  { unique: true, partialFilterExpression: { alias: { $type: 'string' } } },
);

// --- Model creation ---

const ReleaseTrackRegistryModel = mongoose.model(
  'ReleaseTrackRegistry',
  releaseTrackRegistrySchema,
);

module.exports = ReleaseTrackRegistryModel;
