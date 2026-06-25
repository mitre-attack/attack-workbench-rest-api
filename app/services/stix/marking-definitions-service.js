'use strict';

const uuid = require('uuid');
const { BaseService } = require('../meta-classes');
const markingDefinitionsRepository = require('../../repository/marking-definitions-repository');
const { MarkingDefinition: MarkingDefinitionType } = require('../../lib/types');

const {
  MissingParameterError,
  BadlyFormattedParameterError,
  CannotUpdateStaticObjectError,
  DuplicateIdError,
} = require('../../exceptions');

// NOTE: A marking definition does not support the modified or revoked properties!!

class MarkingDefinitionsService extends BaseService {
  async create(data, options) {
    // This function handles two use cases:
    //   1. This is a completely new object. Create a new object and generate the stix.id if not already
    //      provided. Set stix.created_by_ref to the organization identity.
    //   2. stix.id is defined and options.import is set. Create a new object
    //      using the specified stix.id and stix.created_by_ref.
    // TBD: Overwrite existing object when importing??

    const markingDefinition = this.repository.createNewDocument(data);

    options = options || {};
    if (!options.import) {
      // Record the user account that created the object
      if (options.userAccountId) {
        markingDefinition.workspace.workflow.created_by_user_account = options.userAccountId;
      }

      // Get the organization identity
      const organizationIdentityRef = await this.retrieveOrganizationIdentityRef();

      // Check for an existing object
      let existingObject;
      if (markingDefinition.stix.id) {
        existingObject = await this.repository.retrieveOneById(markingDefinition.stix.id);
      }

      if (existingObject) {
        // Cannot create a new version of an existing object
        throw new BadlyFormattedParameterError();
      } else {
        // New object
        // Assign a new STIX id if not already provided
        markingDefinition.stix.id = markingDefinition.stix.id || `marking-definition--${uuid.v4()}`;

        // Set the created_by_ref property
        markingDefinition.stix.created_by_ref = organizationIdentityRef;
      }
    }

    // Save the document in the database
    try {
      return await this.repository.saveDocument(markingDefinition);
    } catch (err) {
      if (err.name === 'MongoServerError' && err.code === 11000) {
        throw new DuplicateIdError();
      } else {
        throw err;
      }
    }
  }

  async updateFull(stixId, data) {
    if (data?.workspace?.workflow?.state === 'static') {
      throw new CannotUpdateStaticObjectError();
    }

    // Marking definitions don't support versioning (no modified property)
    // So we retrieve by stixId only and update directly
    const document = await this.repository.retrieveOneById(stixId);
    if (!document) {
      return null;
    }

    const newDoc = await this.repository.updateAndSave(document, data);
    return newDoc;
  }

  // eslint-disable-next-line no-unused-vars
  async retrieveById(stixId, options) {
    try {
      if (!stixId) {
        throw new MissingParameterError('stixId');
      }

      const markingDefinition = await this.repository.retrieveOneById(stixId);

      // Note: document is null if not found
      if (markingDefinition) {
        await this.addCreatedByAndModifiedByIdentities(markingDefinition);
        return [markingDefinition];
      } else {
        return [];
      }
    } catch (err) {
      if (err.name === 'CastError') {
        throw new BadlyFormattedParameterError();
      } else {
        throw err;
      }
    }
  }

  async delete(stixId) {
    if (!stixId) {
      throw new MissingParameterError('stixId');
    }

    //Note: markingDefinition is null if not found
    return await this.repository.deleteOneById(stixId);
  }
}

module.exports = new MarkingDefinitionsService(MarkingDefinitionType, markingDefinitionsRepository);
