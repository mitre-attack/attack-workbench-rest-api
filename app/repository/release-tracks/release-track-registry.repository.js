'use strict';

const ReleaseTrackRegistryModel = require('../../models/release-tracks/release-track-registry-model');
const regexValidator = require('../../lib/regex');
const {
  DatabaseError,
  DuplicateIdError,
  BadlyFormattedParameterError,
} = require('../../exceptions');

class ReleaseTrackRegistryRepository {
  constructor(model) {
    this.model = model;
  }

  async create(data) {
    try {
      const document = new this.model(data);
      const saved = await document.save();
      return saved.toObject();
    } catch (err) {
      if (err.name === 'MongoServerError' && err.code === 11000) {
        if (err.keyPattern?.alias) {
          throw new DuplicateIdError(`Release track alias '${data.alias}' is already in use`, {
            details: { alias: data.alias },
          });
        }
        throw new DuplicateIdError({
          details: `Release track with id '${data.track_id}' already exists.`,
        });
      }
      throw new DatabaseError(err);
    }
  }

  async findByAlias(alias) {
    try {
      return await this.model.findOne({ alias }).lean().exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  /**
   * Set (string) or clear (null) a track's alias. Clearing unsets the field so
   * the partial unique index ignores the document.
   */
  async setAlias(trackId, alias) {
    const updated_at = new Date();
    const update = alias
      ? { $set: { alias, updated_at } }
      : { $set: { updated_at }, $unset: { alias: '' } };
    try {
      return await this.model
        .findOneAndUpdate({ track_id: trackId }, update, {
          new: true,
          runValidators: true,
          lean: true,
        })
        .exec();
    } catch (err) {
      if (err.name === 'MongoServerError' && err.code === 11000) {
        throw new DuplicateIdError(`Release track alias '${alias}' is already in use`, {
          details: { alias },
        });
      }
      throw new DatabaseError(err);
    }
  }

  async findByTrackId(trackId, projection) {
    try {
      return await this.model.findOne({ track_id: trackId }).select(projection).lean().exec();
    } catch (err) {
      if (err.name === 'CastError') {
        throw new BadlyFormattedParameterError({ parameterName: 'trackId' });
      }
      throw new DatabaseError(err);
    }
  }

  async findAll(options = {}) {
    try {
      const query = {};

      if (options.type) {
        query.type = options.type;
      }

      const aggregation = [{ $sort: { name: 1 } }, { $match: query }];

      if (options.search) {
        const sanitized = regexValidator.sanitizeRegex(options.search);
        aggregation.push({
          $match: {
            $or: [
              { name: { $regex: sanitized, $options: 'i' } },
              { description: { $regex: sanitized, $options: 'i' } },
            ],
          },
        });
      }

      aggregation.push({ $project: { release_lock: 0, draft_retention: 0 } });

      // Total count before pagination
      const totalCountResult = await this.model.aggregate(aggregation).count('totalCount').exec();
      const totalCount = totalCountResult[0]?.totalCount || 0;

      // Pagination
      aggregation.push({ $skip: options.offset || 0 });
      if (options.limit) {
        aggregation.push({ $limit: options.limit });
      }

      const documents = await this.model.aggregate(aggregation).exec();

      return {
        data: documents,
        pagination: {
          total: totalCount,
          offset: options.offset || 0,
          limit: options.limit || 0,
        },
      };
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async findVirtualTrackBatch(afterTrackId) {
    return this.model
      .find({
        type: 'virtual',
        ...(afterTrackId ? { track_id: { $gt: afterTrackId } } : {}),
      })
      .select('track_id')
      .sort({ track_id: 1 })
      .limit(100)
      .lean()
      .exec();
  }

  async findWithTaggedReleases(options = {}) {
    try {
      const query = { 'tagged_releases.0': { $exists: true } };
      if (options.type) {
        query.type = options.type;
      }

      return await this.model
        .find(query)
        .select('track_id type name tagged_releases')
        .sort({ track_id: 1 })
        .lean()
        .exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async findScheduledVirtualTracks() {
    try {
      return await this.model
        .find({
          type: 'virtual',
          'snapshot_schedule.mode': { $in: ['cron', 'dates'] },
        })
        .select('track_id name snapshot_schedule')
        .sort({ track_id: 1 })
        .lean()
        .exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async setSnapshotSchedule(trackId, snapshotSchedule) {
    try {
      return await this.model
        .findOneAndUpdate(
          { track_id: trackId, type: 'virtual' },
          {
            $set: {
              snapshot_schedule: snapshotSchedule,
              updated_at: new Date(),
            },
          },
          { new: true, runValidators: true, lean: true },
        )
        .exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async replaceTaggedReleases(trackId, taggedReleases, latestTaggedVersion) {
    try {
      return await this.model
        .findOneAndUpdate(
          { track_id: trackId },
          {
            $set: {
              tagged_releases: taggedReleases,
              tagged_release_count: taggedReleases.length,
              latest_tagged_version: latestTaggedVersion,
              updated_at: new Date(),
            },
          },
          { new: true, runValidators: true, lean: true },
        )
        .exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async acquireReleaseLock(trackId, token, acquiredAt, staleBefore) {
    try {
      return await this.model
        .findOneAndUpdate(
          {
            track_id: trackId,
            $or: [
              { release_lock: { $exists: false } },
              { 'release_lock.acquired_at': { $lt: staleBefore } },
            ],
          },
          { $set: { release_lock: { token, acquired_at: acquiredAt } } },
          { new: true, runValidators: true, lean: true },
        )
        .exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async renewReleaseLock(trackId, token, staleBefore) {
    try {
      return await this.model
        .findOneAndUpdate(
          {
            track_id: trackId,
            'release_lock.token': token,
            'release_lock.acquired_at': { $gte: staleBefore },
          },
          { $set: { 'release_lock.acquired_at': new Date() } },
          { new: true, lean: true, projection: { _id: 1 } },
        )
        .exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async releaseReleaseLock(trackId, token) {
    try {
      return await this.model
        .updateOne(
          { track_id: trackId, 'release_lock.token': token },
          { $unset: { release_lock: '' } },
        )
        .exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async updateByTrackId(trackId, updates) {
    try {
      const result = await this.model
        .findOneAndUpdate(
          { track_id: trackId },
          { $set: updates },
          { new: true, runValidators: true, lean: true },
        )
        .exec();

      return result;
    } catch (err) {
      if (err.name === 'MongoServerError' && err.code === 11000) {
        throw new DuplicateIdError({
          details: `Duplicate key conflict while updating track '${trackId}'.`,
        });
      }
      throw new DatabaseError(err);
    }
  }

  async deleteByTrackId(trackId) {
    try {
      return await this.model.findOneAndDelete({ track_id: trackId }).lean().exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }
}

module.exports = new ReleaseTrackRegistryRepository(ReleaseTrackRegistryModel);
