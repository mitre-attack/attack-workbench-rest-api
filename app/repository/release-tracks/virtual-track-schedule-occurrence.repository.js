'use strict';

const { randomUUID } = require('node:crypto');
const VirtualTrackScheduleOccurrence = require('../../models/release-tracks/virtual-track-schedule-occurrence-model');
const { DatabaseError, ReleaseConflictError } = require('../../exceptions');

class VirtualTrackScheduleOccurrenceRepository {
  async register(trackId, scheduleMode, scheduledFor) {
    try {
      return await VirtualTrackScheduleOccurrence.findOneAndUpdate(
        { track_id: trackId, scheduled_for: scheduledFor },
        {
          $setOnInsert: {
            track_id: trackId,
            schedule_mode: scheduleMode,
            scheduled_for: scheduledFor,
            status: 'pending',
            attempt_count: 0,
          },
        },
        { upsert: true, new: true, lean: true },
      ).exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async getMaterializationReceipt(trackId, scheduledFor) {
    try {
      return await VirtualTrackScheduleOccurrence.findOne({
        track_id: trackId,
        scheduled_for: scheduledFor,
      })
        .lean()
        .exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async recordMaterialization(trackId, scheduledMaterialization, snapshotModified) {
    const { schedule_mode: scheduleMode, scheduled_for: scheduledFor } = scheduledMaterialization;
    await this.register(trackId, scheduleMode, scheduledFor);
    let receipt;
    try {
      receipt = await VirtualTrackScheduleOccurrence.findOneAndUpdate(
        {
          track_id: trackId,
          scheduled_for: scheduledFor,
          $or: [{ snapshot_modified: null }, { snapshot_modified: snapshotModified }],
        },
        { $set: { snapshot_modified: snapshotModified } },
        { new: true, lean: true },
      ).exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
    if (receipt) return receipt;

    const existing = await this.getMaterializationReceipt(trackId, scheduledFor);
    throw new ReleaseConflictError('Scheduled occurrence already has a different materialization', {
      details: {
        track_id: trackId,
        scheduled_for: scheduledFor,
        snapshot_modified: existing?.snapshot_modified,
        requested_snapshot_modified: snapshotModified,
      },
    });
  }

  async findDue(now) {
    try {
      return await VirtualTrackScheduleOccurrence.find({
        $or: [
          { status: 'pending' },
          { status: 'failed', next_retry_at: { $lte: now } },
          { status: 'running', claim_expires_at: { $lte: now } },
        ],
      })
        .sort({ scheduled_for: 1, track_id: 1 })
        .lean()
        .exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async claim(trackId, scheduledFor, now, claimExpiresAt) {
    try {
      return await VirtualTrackScheduleOccurrence.findOneAndUpdate(
        {
          track_id: trackId,
          scheduled_for: scheduledFor,
          $or: [
            { status: 'pending' },
            { status: 'failed', next_retry_at: { $lte: now } },
            { status: 'running', claim_expires_at: { $lte: now } },
          ],
        },
        {
          $set: {
            status: 'running',
            claimed_at: now,
            claim_token: randomUUID(),
            claim_expires_at: claimExpiresAt,
            next_retry_at: null,
            finished_at: null,
            last_error: null,
          },
          $inc: { attempt_count: 1 },
        },
        { new: true, lean: true },
      ).exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async complete(claimed) {
    return this._finish(
      claimed,
      { snapshot_modified: { $ne: null } },
      {
        status: 'completed',
        finished_at: new Date(),
        claim_expires_at: null,
        next_retry_at: null,
        last_error: null,
      },
    );
  }

  async fail(claimed, error, nextRetryAt) {
    // A saved result remains a receipt even when its audit needs retrying.
    return this._finish(
      claimed,
      {},
      {
        status: 'failed',
        finished_at: new Date(),
        claim_expires_at: null,
        next_retry_at: nextRetryAt,
        last_error: error,
      },
    );
  }

  async skip(claimed, reason) {
    return this._finish(
      claimed,
      { snapshot_modified: null },
      {
        status: 'skipped',
        finished_at: new Date(),
        claim_expires_at: null,
        next_retry_at: null,
        last_error: { message: reason },
      },
    );
  }

  async _finish(claimed, conditions, updates) {
    if (!claimed?.claim_token) return null;
    try {
      return await VirtualTrackScheduleOccurrence.findOneAndUpdate(
        {
          track_id: claimed.track_id,
          scheduled_for: claimed.scheduled_for,
          status: 'running',
          claim_token: claimed.claim_token,
          ...conditions,
        },
        { $set: { ...updates, claim_token: null } },
        { new: true, lean: true },
      ).exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }
}

module.exports = new VirtualTrackScheduleOccurrenceRepository();
