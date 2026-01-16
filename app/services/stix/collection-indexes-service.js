'use strict';

const CollectionIndexesRepository = require('../../repository/collection-indexes-repository');
const { BaseService } = require('../meta-classes');
const { MissingParameterError, DatabaseError } = require('../../exceptions');
const config = require('../../config/config');

class CollectionIndexesService extends BaseService {
  async retrieveAll(options) {
    return await this.repository.retrieveAll(options);
  }

  async retrieveById(id) {
    return await this.repository.retrieveById(id);
  }

  async create(data) {
    if (
      data.workspace.update_policy &&
      data.workspace.update_policy.automatic &&
      !data.workspace.update_policy.interval
    ) {
      data.workspace.update_policy.interval = config.collectionIndex.defaultInterval;
    }

    return await this.repository.save(data);
  }

  async updateFull(id, data) {
    if (!id) {
      throw new MissingParameterError('collection_index.id');
    }

    const collectionIndex = await this.repository.retrieveById(id);

    if (!collectionIndex) return null;

    const newCollectionIndex = await this.repository.updateAndSave(collectionIndex, data);

    if (newCollectionIndex === collectionIndex) {
      return newCollectionIndex;
    } else {
      throw new DatabaseError({
        details: 'Document could not be saved',
        collectionIndex, // Pass along the document that could not be saved
      });
    }
  }

  async delete(id) {
    if (!id) {
      throw new MissingParameterError('collection_index.id');
    }

    return await this.repository.findOneAndDelete(id);
  }
}

module.exports = new CollectionIndexesService(null, CollectionIndexesRepository);
