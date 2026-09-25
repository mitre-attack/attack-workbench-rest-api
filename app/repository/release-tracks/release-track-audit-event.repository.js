'use strict';

const { v4: uuidv4 } = require('uuid');
const ReleaseTrackAuditEvent = require('../../models/release-tracks/release-track-audit-event-model');
const { DatabaseError } = require('../../exceptions');

class ReleaseTrackAuditEventRepository {
  async create({ action, trackId, actor, confirmation, request }) {
    try {
      const event = await ReleaseTrackAuditEvent.create({
        event_id: uuidv4(),
        action,
        track_id: trackId,
        status: 'pending',
        actor,
        confirmation,
        request,
        started_at: new Date(),
      });
      return event.toObject();
    } catch (error) {
      throw new DatabaseError(error);
    }
  }

  async complete(eventId, result) {
    try {
      const event = await ReleaseTrackAuditEvent.findOneAndUpdate(
        { event_id: eventId },
        {
          $set: {
            status: 'completed',
            result: result || null,
            error: null,
            finished_at: new Date(),
          },
        },
        { new: true, lean: true },
      ).exec();
      if (!event) {
        throw new Error(`Release-track audit event ${eventId} no longer exists`);
      }
      return event;
    } catch (error) {
      throw new DatabaseError(error);
    }
  }

  async fail(eventId, error) {
    try {
      const event = await ReleaseTrackAuditEvent.findOneAndUpdate(
        { event_id: eventId },
        {
          $set: {
            status: 'failed',
            error: {
              name: error?.name || 'Error',
              message: error?.message || String(error),
            },
            finished_at: new Date(),
          },
        },
        { new: true, lean: true },
      ).exec();
      if (!event) {
        throw new Error(`Release-track audit event ${eventId} no longer exists`);
      }
      return event;
    } catch (repositoryError) {
      throw new DatabaseError(repositoryError);
    }
  }
  async getCleanup(trackId, eventId) {
    return ReleaseTrackAuditEvent.findOne({
      track_id: trackId,
      event_id: eventId,
      action: { $in: ['draft_retention', 'draft_squash'] },
    })
      .lean()
      .exec();
  }

  async listCleanup(trackId) {
    return ReleaseTrackAuditEvent.find({
      track_id: trackId,
      action: { $in: ['draft_retention', 'draft_squash'] },
      status: { $in: ['pending', 'failed'] },
    })
      .sort({ started_at: -1 })
      .limit(25)
      .lean()
      .exec();
  }

  async saveCleanup(eventId, cleanup, status = 'pending', error = null) {
    const event = await ReleaseTrackAuditEvent.findOneAndUpdate(
      { event_id: eventId, action: { $in: ['draft_retention', 'draft_squash'] } },
      {
        $set: {
          cleanup,
          status,
          error: error
            ? { name: error.name || 'Error', message: error.message || String(error) }
            : null,
          finished_at: status === 'pending' ? null : new Date(),
        },
      },
      { new: true, lean: true },
    ).exec();
    if (!event) throw new Error(`Cleanup intent ${eventId} no longer exists`);
    return event;
  }
}

module.exports = new ReleaseTrackAuditEventRepository();
