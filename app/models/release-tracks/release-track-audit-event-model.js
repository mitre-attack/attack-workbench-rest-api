'use strict';

const mongoose = require('mongoose');
const { validateTrackId } = require('../../lib/release-tracks/release-track-validators');

const releaseTrackAuditEventSchema = new mongoose.Schema(
  {
    event_id: { type: String, required: true, unique: true },
    action: {
      type: String,
      required: true,
      enum: [
        'delete_track',
        'delete_release',
        'retag_release',
        'convert_release_to_draft',
        'draft_retention',
        'draft_squash',
      ],
    },
    track_id: { type: String, required: true, validate: validateTrackId },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'completed', 'failed'],
      default: 'pending',
    },
    actor: { type: mongoose.Schema.Types.Mixed, required: true },
    confirmation: { type: String, required: true },
    request: { type: mongoose.Schema.Types.Mixed, default: {} },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    cleanup: { type: mongoose.Schema.Types.Mixed, default: undefined },
    error: {
      name: String,
      message: String,
    },
    started_at: { type: Date, required: true },
    finished_at: { type: Date, default: null },
  },
  {
    collection: 'releaseTrackAuditEvents',
    bufferCommands: false,
  },
);

releaseTrackAuditEventSchema.index({ track_id: 1, started_at: -1 });
releaseTrackAuditEventSchema.index({ action: 1, started_at: -1 });
releaseTrackAuditEventSchema.index({ 'actor.user_account_id': 1, started_at: -1 });

module.exports = mongoose.model('ReleaseTrackAuditEvent', releaseTrackAuditEventSchema);
