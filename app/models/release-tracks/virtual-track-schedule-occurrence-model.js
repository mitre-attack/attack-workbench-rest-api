'use strict';

const mongoose = require('mongoose');
const { validateTrackId } = require('../../lib/release-tracks/release-track-validators');

const virtualTrackScheduleOccurrenceSchema = new mongoose.Schema(
  {
    track_id: {
      type: String,
      required: true,
      validate: validateTrackId,
    },
    schedule_mode: {
      type: String,
      enum: ['cron', 'dates'],
      required: true,
    },
    scheduled_for: { type: Date, required: true },
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed', 'skipped'],
      required: true,
      default: 'pending',
    },
    attempt_count: { type: Number, required: true, default: 0 },
    claimed_at: { type: Date, default: null },
    claim_token: { type: String, default: null },
    claim_expires_at: { type: Date, default: null },
    next_retry_at: { type: Date, default: null },
    finished_at: { type: Date, default: null },
    // Durable, write-once receipt: retained even when the snapshot is removed.
    snapshot_modified: { type: Date, default: null },
    last_error: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  {
    collection: 'virtualTrackScheduleOccurrences',
    bufferCommands: false,
  },
);

virtualTrackScheduleOccurrenceSchema.index({ track_id: 1, scheduled_for: 1 }, { unique: true });
virtualTrackScheduleOccurrenceSchema.index({ status: 1, next_retry_at: 1 });
virtualTrackScheduleOccurrenceSchema.index({ status: 1, claim_expires_at: 1 });

module.exports = mongoose.model(
  'VirtualTrackScheduleOccurrence',
  virtualTrackScheduleOccurrenceSchema,
);
