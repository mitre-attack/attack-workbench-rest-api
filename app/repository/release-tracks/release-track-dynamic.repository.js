'use strict';

const modelFactory = require('../../models/release-tracks/model-factory');
const {
  DatabaseError,
  DuplicateIdError,
  BadlyFormattedParameterError,
} = require('../../exceptions');
const logger = require('../../lib/logger');

class ReleaseTrackDynamicRepository {
  constructor(factory) {
    this.modelFactory = factory;
  }

  /**
   * Resolve the Mongoose model for a given track.
   * @param {string} trackId
   * @returns {import('mongoose').Model}
   */
  _getModel(trackId) {
    return this.modelFactory.getModel(trackId);
  }

  async getLatestSnapshot(trackId) {
    try {
      const Model = this._getModel(trackId);
      return await Model.findOne({ id: trackId }).sort({ modified: -1 }).lean().exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async getSnapshotByModified(trackId, modified) {
    try {
      const Model = this._getModel(trackId);
      return await Model.findOne({ id: trackId, modified }).lean().exec();
    } catch (err) {
      if (err.name === 'CastError') {
        throw new BadlyFormattedParameterError({ parameterName: 'modified' });
      }
      throw new DatabaseError(err);
    }
  }

  async getLatestTaggedSnapshot(trackId) {
    try {
      const Model = this._getModel(trackId);
      return await Model.findOne({
        id: trackId,
        version: { $ne: null },
      })
        .sort({ modified: -1 })
        .lean()
        .exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async getSnapshotByVersion(trackId, version) {
    try {
      const Model = this._getModel(trackId);
      return await Model.findOne({ id: trackId, version }).lean().exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async getAllSnapshots(trackId, options = {}) {
    try {
      const Model = this._getModel(trackId);
      const query = { id: trackId };

      if (options.taggedOnly) {
        query.version = { $ne: null };
      }

      let findQuery = Model.find(query);

      if (options.projection) {
        findQuery = findQuery.select(options.projection);
      }

      findQuery = findQuery.sort({ modified: -1 });

      const totalCount = await Model.countDocuments(query).exec();

      findQuery = findQuery.skip(options.offset || 0);
      if (options.limit) {
        findQuery = findQuery.limit(options.limit);
      }

      const documents = await findQuery.lean().exec();

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

  async saveSnapshot(trackId, snapshotData) {
    try {
      const Model = this._getModel(trackId);
      const document = new Model(snapshotData);
      const saved = await document.save();
      return saved.toObject();
    } catch (err) {
      if (err.name === 'MongoServerError' && err.code === 11000) {
        throw new DuplicateIdError({
          details: `Snapshot with modified '${snapshotData.modified}' already exists for track '${trackId}'.`,
        });
      }
      throw new DatabaseError(err);
    }
  }

  async tagSnapshotInPlace(trackId, modified, versionData) {
    try {
      const Model = this._getModel(trackId);

      const setOps = { version: versionData.version };

      // Merge additional atomic operations (e.g., staged → members promotion)
      if (versionData.additionalOps) {
        Object.assign(setOps, versionData.additionalOps);
      }

      const result = await Model.findOneAndUpdate(
        {
          id: trackId,
          modified: modified,
          version: null, // Guard: only tag untagged snapshots
        },
        {
          $set: setOps,
          $push: { version_history: versionData.versionHistoryEntry },
        },
        {
          new: true,
          runValidators: true,
          lean: true,
        },
      ).exec();

      return result;
    } catch (err) {
      if (err.name === 'MongoServerError' && err.code === 11000) {
        throw new DuplicateIdError({
          details: `Version conflict while tagging snapshot for track '${trackId}'.`,
        });
      }
      throw new DatabaseError(err);
    }
  }

  async updateSnapshot(trackId, modified, updateOps) {
    try {
      const Model = this._getModel(trackId);
      const result = await Model.findOneAndUpdate({ id: trackId, modified }, updateOps, {
        new: true,
        runValidators: true,
      }).exec();

      return result;
    } catch (err) {
      if (err.name === 'MongoServerError' && err.code === 11000) {
        throw new DuplicateIdError({
          details: `Duplicate key conflict while updating snapshot for track '${trackId}'.`,
        });
      }
      throw new DatabaseError(err);
    }
  }

  async deleteSnapshot(trackId, modified) {
    try {
      const Model = this._getModel(trackId);
      return await Model.findOneAndDelete({ id: trackId, modified }).lean().exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async deleteAllSnapshots(trackId) {
    try {
      const Model = this._getModel(trackId);
      const result = await Model.deleteMany({ id: trackId }).exec();
      logger.verbose(
        `DynamicRepository: Deleted ${result.deletedCount} snapshots for track "${trackId}"`,
      );
      return result;
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async dropCollection(trackId) {
    try {
      const Model = this._getModel(trackId);
      await Model.collection.drop();
      logger.verbose(`DynamicRepository: Dropped collection for track "${trackId}"`);
    } catch (err) {
      // MongoDB throws "ns not found" if the collection doesn't exist -- safe to ignore
      if (err.message && err.message.includes('ns not found')) {
        logger.verbose(
          `DynamicRepository: Collection for track "${trackId}" did not exist, skipping drop`,
        );
      } else {
        throw new DatabaseError(err);
      }
    } finally {
      // Always clean up the cached model, even if drop failed or collection didn't exist
      this.modelFactory.removeModel(trackId);
    }
  }
}

module.exports = new ReleaseTrackDynamicRepository(modelFactory);
