'use strict';

const modelFactory = require('../../models/release-tracks/model-factory');
const {
  DatabaseError,
  DuplicateIdError,
  DuplicateReleaseVersionError,
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

  async getLatestSnapshotBefore(trackId, modified) {
    try {
      const Model = this._getModel(trackId);
      return await Model.findOne({ id: trackId, modified: { $lt: modified } })
        .sort({ modified: -1 })
        .lean()
        .exec();
    } catch (err) {
      if (err.name === 'CastError') {
        throw new BadlyFormattedParameterError({ parameterName: 'modified' });
      }
      throw new DatabaseError(err);
    }
  }

  async getLatestSnapshotTierSummary(trackId) {
    try {
      const Model = this._getModel(trackId);
      const [summary] = await Model.aggregate([
        { $match: { id: trackId } },
        { $sort: { modified: -1 } },
        { $limit: 1 },
        {
          $project: {
            _id: 0,
            scheduled_materialization: 1,
            members_count: { $size: { $ifNull: ['$members', []] } },
            staged_count: { $size: { $ifNull: ['$staged', []] } },
            candidates_count: { $size: { $ifNull: ['$candidates', []] } },
          },
        },
      ]).exec();

      return summary || null;
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

  async getLatestTaggedSnapshotBefore(trackId, modified) {
    try {
      const Model = this._getModel(trackId);
      return await Model.findOne({
        id: trackId,
        version: { $type: 'string' },
        modified: { $lt: modified },
      })
        .sort({ modified: -1 })
        .lean()
        .exec();
    } catch (err) {
      if (err.name === 'CastError') {
        throw new BadlyFormattedParameterError({ parameterName: 'modified' });
      }
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

  async getReleaseBySourceModified(trackId, sourceModified) {
    try {
      const Model = this._getModel(trackId);
      return await Model.findOne({
        id: trackId,
        version: { $type: 'string' },
        release_source_modified: sourceModified,
      })
        .lean()
        .exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async getSnapshotByScheduledMaterialization(trackId, scheduledFor) {
    try {
      const Model = this._getModel(trackId);
      return await Model.findOne({
        id: trackId,
        'scheduled_materialization.scheduled_for': scheduledFor,
      })
        .lean()
        .exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async getTaggedSnapshotMetadata(trackId) {
    try {
      const Model = this._getModel(trackId);
      return await Model.find({ id: trackId, version: { $type: 'string' } })
        .select('modified version version_history')
        .sort({ modified: 1 })
        .lean()
        .exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async findTaggedSnapshotsContainingObject(trackId, snapshotModifiedValues, objectRef) {
    if (!snapshotModifiedValues || snapshotModifiedValues.length === 0) {
      return [];
    }

    try {
      const Model = this._getModel(trackId);
      return await Model.find(
        {
          id: trackId,
          modified: { $in: snapshotModifiedValues },
          version: { $type: 'string' },
          'members.object_ref': objectRef,
        },
        {
          id: 1,
          type: 1,
          name: 1,
          modified: 1,
          version: 1,
          members: { $elemMatch: { object_ref: objectRef } },
        },
      )
        .lean()
        .exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  /**
   * Find tagged snapshots whose members tier contains an object revision.
   * Omitting objectModified matches every released revision for the STIX ID.
   * This query reads the tagged snapshots themselves rather than relying on
   * denormalized object backrefs or registry release metadata.
   */
  async findTaggedSnapshotsContainingRevision(trackId, objectRef, objectModified) {
    try {
      const Model = this._getModel(trackId);
      const memberMatch = { object_ref: objectRef };
      if (objectModified !== undefined) {
        memberMatch.object_modified = new Date(objectModified);
      }

      return await Model.find(
        {
          id: trackId,
          version: { $type: 'string' },
          members: { $elemMatch: memberMatch },
        },
        {
          id: 1,
          type: 1,
          name: 1,
          modified: 1,
          version: 1,
          members: { $elemMatch: memberMatch },
        },
      )
        .sort({ modified: 1 })
        .lean()
        .exec();
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

  async getSnapshotSummaries(trackId, options = {}) {
    try {
      const Model = this._getModel(trackId);
      const query = { id: trackId };

      if (options.tagged === true) {
        query.version = { $type: 'string' };
      } else if (options.tagged === false) {
        query.version = null;
      }

      const totalCount = await Model.countDocuments(query).exec();
      const aggregation = [
        { $match: query },
        { $sort: { modified: -1 } },
        { $skip: options.offset || 0 },
      ];

      if (options.limit) {
        aggregation.push({ $limit: options.limit });
      }

      aggregation.push({
        $project: {
          _id: 0,
          id: 1,
          type: 1,
          modified: 1,
          version: 1,
          content_manifest_id: 1,
          bundle_id: 1,
          bundle_hashes: 1,
          release_source_modified: 1,
          snapshot_description: 1,
          creation_cause: { $ifNull: ['$creation_cause', 'unknown'] },
          creation_actor: { $ifNull: ['$creation_actor', { kind: 'unknown' }] },
          name: 1,
          description: 1,
          scheduled_materialization: 1,
          composition_resolution: 1,
          members_count: { $size: { $ifNull: ['$members', []] } },
          staged_count: { $size: { $ifNull: ['$staged', []] } },
          candidates_count: { $size: { $ifNull: ['$candidates', []] } },
          quarantine_count: { $size: { $ifNull: ['$quarantine', []] } },
        },
      });

      const documents = await Model.aggregate(aggregation).exec();

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
        if (err.keyPattern?.version && typeof snapshotData.version === 'string') {
          throw new DuplicateReleaseVersionError(trackId, snapshotData.version, { cause: err });
        }
        throw new DuplicateIdError({
          details:
            `Snapshot uniqueness conflict for track '${trackId}' at modified ` +
            `'${new Date(snapshotData.modified).toISOString()}': ${JSON.stringify(err.keyValue)}`,
          cause: err,
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

      const update = {
        $set: setOps,
        $push: { version_history: versionData.versionHistoryEntry },
      };
      if (versionData.unsetOps) {
        update.$unset = versionData.unsetOps;
      }

      const result = await Model.findOneAndUpdate(
        {
          id: trackId,
          modified: modified,
          version: null, // Guard: only tag untagged snapshots
        },
        update,
        {
          new: true,
          runValidators: true,
          lean: true,
        },
      ).exec();

      return result;
    } catch (err) {
      if (err.name === 'MongoServerError' && err.code === 11000) {
        throw new DuplicateReleaseVersionError(trackId, versionData.version, { cause: err });
      }
      throw new DatabaseError(err);
    }
  }

  async retagSnapshotInPlace(trackId, modified, currentVersion, nextVersion, artifacts) {
    try {
      const Model = this._getModel(trackId);
      return await Model.findOneAndUpdate(
        {
          id: trackId,
          modified,
          version: currentVersion,
          content_manifest_id: artifacts.bundle_hashes.manifest_id,
        },
        {
          $set: {
            version: nextVersion,
            'version_history.$[entry].version': nextVersion,
            ...artifacts,
          },
        },
        {
          arrayFilters: [
            {
              'entry.version': currentVersion,
              'entry.snapshot_id': new Date(modified),
            },
          ],
          new: true,
          runValidators: true,
          lean: true,
        },
      ).exec();
    } catch (err) {
      if (err.name === 'MongoServerError' && err.code === 11000) {
        throw new DuplicateReleaseVersionError(trackId, nextVersion, { cause: err });
      }
      throw new DatabaseError(err);
    }
  }

  async replaceVersionHistoryVersion(trackId, snapshotModified, nextVersion) {
    try {
      const Model = this._getModel(trackId);
      const result = await Model.updateMany(
        {
          id: trackId,
          modified: { $ne: snapshotModified },
          version_history: {
            $elemMatch: { snapshot_id: snapshotModified },
          },
        },
        { $set: { 'version_history.$[entry].version': nextVersion } },
        {
          arrayFilters: [
            {
              'entry.snapshot_id': new Date(snapshotModified),
            },
          ],
          runValidators: true,
        },
      ).exec();
      return result.modifiedCount;
    } catch (err) {
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

  /**
   * Replace a tagged snapshot's content manifest. Used by administrative
   * source-attested reconstruction, which must name the manifest it expects
   * to replace so a concurrent change is detected.
   */
  async replaceContentManifest(trackId, modified, expectedManifestId, manifestId) {
    try {
      const Model = this._getModel(trackId);
      return await Model.findOneAndUpdate(
        {
          id: trackId,
          modified,
          version: { $type: 'string' },
          content_manifest_id: expectedManifestId,
        },
        { $set: { content_manifest_id: manifestId }, $unset: { bundle_hashes: '' } },
        { new: true, runValidators: true, lean: true },
      ).exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async attachBundleHashes(trackId, modified, manifestId, bundleHashes) {
    try {
      const Model = this._getModel(trackId);
      return await Model.findOneAndUpdate(
        {
          id: trackId,
          modified,
          version: { $type: 'string' },
          content_manifest_id: manifestId,
        },
        { $set: { bundle_hashes: bundleHashes } },
        { new: true, runValidators: true, lean: true },
      ).exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  /**
   * Return the subset of manifest IDs still referenced by any snapshot in the
   * track. Manifests are shared by reference between a sealing snapshot and
   * the clones that inherit it.
   */
  async findReferencedManifestIds(trackId, manifestIds) {
    if (!Array.isArray(manifestIds) || manifestIds.length === 0) return [];
    try {
      const Model = this._getModel(trackId);
      return await Model.distinct('content_manifest_id', {
        id: trackId,
        content_manifest_id: { $in: manifestIds },
      }).exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  /**
   * Remove one release's ledger entry from every snapshot of the track. The
   * ledger is copied forward into each clone, so deleting a release must
   * retract it everywhere or the version would stay reserved.
   */
  async pullVersionHistory(trackId, version) {
    try {
      const Model = this._getModel(trackId);
      const result = await Model.updateMany(
        { id: trackId, 'version_history.version': version },
        { $pull: { version_history: { version } } },
      ).exec();
      return result.modifiedCount;
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async deleteOlderDrafts(trackId, modified, referencedDrafts = []) {
    try {
      const Model = this._getModel(trackId);
      const retainedDrafts = await Model.distinct('release_source_modified', {
        id: trackId,
        version: { $type: 'string' },
        release_source_modified: { $type: 'date' },
      }).exec();
      retainedDrafts.push(...referencedDrafts);
      const query = {
        id: trackId,
        version: null,
        modified: { $lt: modified, ...(retainedDrafts.length ? { $nin: retainedDrafts } : {}) },
      };
      const snapshots = await Model.find(query)
        .select('modified content_manifest_id')
        .lean()
        .exec();
      if (snapshots.length > 0) {
        await Model.deleteMany({ _id: { $in: snapshots.map((snapshot) => snapshot._id) } }).exec();
      }
      return snapshots;
    } catch (err) {
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

  async findSnapshotsResolvingComponent(trackId, componentTrackId, componentSnapshotModified) {
    try {
      const Model = this._getModel(trackId);
      return await Model.find(
        {
          id: trackId,
          'composition_resolution.component_snapshots': {
            $elemMatch: {
              track_id: componentTrackId,
              resolved_snapshot_id: new Date(componentSnapshotModified),
            },
          },
        },
        { id: 1, name: 1, modified: 1, version: 1 },
      )
        .sort({ modified: 1 })
        .lean()
        .exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async findResolvedComponentSnapshotIds(trackId, componentTrackId) {
    try {
      const Model = this._getModel(trackId);
      const snapshots = await Model.aggregate([
        {
          $match: {
            id: trackId,
            'composition_resolution.component_snapshots.track_id': componentTrackId,
          },
        },
        { $unwind: '$composition_resolution.component_snapshots' },
        { $match: { 'composition_resolution.component_snapshots.track_id': componentTrackId } },
        { $group: { _id: '$composition_resolution.component_snapshots.resolved_snapshot_id' } },
      ]).exec();
      return snapshots.map((snapshot) => snapshot._id);
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
