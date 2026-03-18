'use strict';

const recentActivityRepository = require('../../repository/recent-activity-repository');
const identitiesService = require('../stix/identities-service');

class RecentActivityService {
  constructor(repository) {
    this.repository = repository;
  }

  async retrieveAll(options) {
    const documents = await this.repository.retrieveAll(options);

    // Move latest source and target objects to a non-array property, then remove array of source and target objects
    for (const document of documents) {
      if (Array.isArray(document.source_objects)) {
        if (document.source_objects.length === 0) {
          document.source_objects = undefined;
        } else {
          document.source_object = document.source_objects[0];
          document.source_objects = undefined;
        }
      }

      if (Array.isArray(document.target_objects)) {
        if (document.target_objects.length === 0) {
          document.target_objects = undefined;
        } else {
          document.target_object = document.target_objects[0];
          document.target_objects = undefined;
        }
      }
    }

    // Apply pagination
    const offset = options.offset ?? 0;
    let paginatedDocuments;
    if (options.limit > 0) {
      paginatedDocuments = documents.slice(offset, offset + options.limit);
    } else {
      paginatedDocuments = documents.slice(offset);
    }

    // Add identities
    await identitiesService.addCreatedByAndModifiedByIdentitiesToAll(paginatedDocuments);

    // Prepare the return value
    if (options.includePagination) {
      const returnValue = {
        pagination: {
          total: documents.length,
          offset: options.offset,
          limit: options.limit,
        },
        data: paginatedDocuments,
      };
      return returnValue;
    } else {
      return paginatedDocuments;
    }
  }
}

module.exports = new RecentActivityService(recentActivityRepository);
