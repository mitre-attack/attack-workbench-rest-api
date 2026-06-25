'use strict';

const mongoose = require('mongoose');
const logger = require('../../lib/logger');
const { releaseTrackSnapshotSchema } = require('./release-track-snapshot-schema');

/**
 * ModelFactory manages dynamic Mongoose model creation and caching for release tracks.
 *
 * Each release track gets its own MongoDB collection (named by track_id, e.g. "release-track--<uuid>").
 * This factory creates Mongoose models on demand and caches them so that repeated access
 * to the same track reuses the same compiled model.
 */
class ModelFactory {
  constructor() {
    /** @type {Map<string, mongoose.Model>} */
    this._cache = new Map();
  }

  /**
   * Get or create a cached Mongoose model for a release track collection.
   *
   * @param {string} trackId - The release track ID (e.g. "release-track--<uuid>"),
   *   which is also used as the MongoDB collection name.
   * @returns {mongoose.Model} The Mongoose model bound to the track's collection.
   */
  getModel(trackId) {
    if (this._cache.has(trackId)) {
      return this._cache.get(trackId);
    }

    // Mongoose model names must be unique per connection. Use the trackId directly
    // since it's already globally unique (release-track--<uuid>).
    const model = mongoose.model(trackId, releaseTrackSnapshotSchema, trackId);
    this._cache.set(trackId, model);

    logger.verbose(`ModelFactory: Created model for collection "${trackId}"`);
    return model;
  }

  /**
   * Remove a cached model. Call this when a release track is deleted
   * so the model doesn't linger in memory.
   *
   * @param {string} trackId - The release track ID to remove from cache.
   */
  removeModel(trackId) {
    if (this._cache.has(trackId)) {
      // Remove from Mongoose's internal model registry
      delete mongoose.connection.models[trackId];
      this._cache.delete(trackId);
      logger.verbose(`ModelFactory: Removed model for collection "${trackId}"`);
    }
  }

  /**
   * Ensure indexes are created on a release track's collection.
   * Call this after creating a new track to build the indexes defined in the schema.
   *
   * @param {string} trackId - The release track ID.
   * @returns {Promise<void>}
   */
  async ensureIndexes(trackId) {
    const model = this.getModel(trackId);
    await model.ensureIndexes();
    logger.verbose(`ModelFactory: Ensured indexes for collection "${trackId}"`);
  }
}

// Singleton instance -- shared across the application
const modelFactory = new ModelFactory();

module.exports = modelFactory;
