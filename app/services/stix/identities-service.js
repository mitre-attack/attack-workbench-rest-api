'use strict';

const uuid = require('uuid');
const { xMitreIdentity } = require('@mitre-attack/attack-data-model');
const config = require('../../config/config');
const attackObjectsRepository = require('../../repository/attack-objects-repository');
const identitiesRepository = require('../../repository/identities-repository');
const systemConfigurationsRepository = require('../../repository/system-configurations-repository');
const { BaseService } = require('../meta-classes');
const {
  ActiveOrganizationIdentityDeleteError,
  InvalidTypeError,
  MitreIdentityWriteError,
} = require('../../exceptions');
const { Identity: IdentityType } = require('../../lib/types');

class IdentitiesService extends BaseService {
  async assertMitreIdentityWritable(stixId, options = {}) {
    if (options.import || stixId !== xMitreIdentity) {
      return;
    }

    const systemConfig = await systemConfigurationsRepository.retrieveOne({ lean: true });
    const mitreIdentityWritesEnabled =
      systemConfig?.mitre_identity_writes_enabled ?? config.app.allowMitreIdentityWrites;

    if (mitreIdentityWritesEnabled) {
      return;
    }

    throw new MitreIdentityWriteError(stixId);
  }

  async assertIdentityCanBeDeleted(stixId) {
    const systemConfig = await systemConfigurationsRepository.retrieveOne({ lean: true });
    if (systemConfig?.organization_identity_ref !== stixId) {
      return;
    }

    const referencedObjects =
      await attackObjectsRepository.retrieveAllLatestActiveByIdentityRef(stixId);
    throw new ActiveOrganizationIdentityDeleteError(stixId, {
      referencedObjectCount: referencedObjects.length,
      referencedObjectIds: referencedObjects.map((object) => object.stix.id),
    });
  }

  /**
   * @public
   * CRUD Operation: Create
   *
   * Creates a new identity object
   *
   * Override of base class create() because:
   * 1. Does not set created_by_ref or x_mitre_modified_by_ref
   * 2. Does not check for existing identity object
   */
  async create(data, options) {
    if (data?.stix?.type !== IdentityType) {
      throw new InvalidTypeError();
    }

    options = options || {};
    await this.assertMitreIdentityWritable(data.stix.id, options);

    if (!options.import) {
      // Set the ATT&CK Spec Version
      data.stix.x_mitre_attack_spec_version =
        data.stix.x_mitre_attack_spec_version ?? config.app.attackSpecVersion;

      // Record the user account that created the object
      if (options.userAccountId) {
        data.workspace.workflow.created_by_user_account = options.userAccountId;
      }

      // Set the default marking definitions
      await this.setDefaultMarkingDefinitionsForObject(data);

      // Assign a new STIX id if not already provided
      data.stix.id = data.stix.id || `identity--${uuid.v4()}`;
    }

    // Save the document in the database
    return await this.repository.save(data);
  }

  async updateFull(stixId, stixModified, data, options) {
    options = options || {};
    await this.assertMitreIdentityWritable(stixId, options);

    return await super.updateFull(stixId, stixModified, data, options);
  }

  async deleteVersionById(stixId, stixModified) {
    await this.assertIdentityCanBeDeleted(stixId);
    return await super.deleteVersionById(stixId, stixModified);
  }

  async deleteById(stixId) {
    await this.assertIdentityCanBeDeleted(stixId);
    return await super.deleteById(stixId);
  }
}

//Default export
module.exports.IdentitiesService = IdentitiesService;

// Export an instance of the service
module.exports = new IdentitiesService(IdentityType, identitiesRepository);
