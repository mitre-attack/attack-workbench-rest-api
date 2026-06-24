'use strict';

const { xMitreIdentity } = require('@mitre-attack/attack-data-model');
const config = require('../../config/config');
const attackObjectsRepository = require('../../repository/attack-objects-repository');
const identitiesRepository = require('../../repository/identities-repository');
const systemConfigurationsRepository = require('../../repository/system-configurations-repository');
const { BaseService } = require('../meta-classes');
const {
  ActiveOrganizationIdentityDeleteError,
  MitreIdentityWriteError,
} = require('../../exceptions');
const { Identity: IdentityType } = require('../../lib/types');

class IdentitiesService extends BaseService {
  shouldSetOrganizationIdentityRefs() {
    return false;
  }

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

  stripIdentityAttributionRefs(data, options = {}) {
    if (options.import || !data?.stix) {
      return;
    }

    delete data.stix.created_by_ref;
    delete data.stix.x_mitre_modified_by_ref;
  }

  async beforeCreate(data, options = {}) {
    await this.assertMitreIdentityWritable(data?.stix?.id, options);
    this.stripIdentityAttributionRefs(data, options);
  }

  async beforeUpdate(stixId, _stixModified, data, _existingDocument, options = {}) {
    await this.assertMitreIdentityWritable(stixId, options);
    this.stripIdentityAttributionRefs(data, options);
  }

  async beforeDeleteVersionById(stixId) {
    await this.assertMitreIdentityWritable(stixId);
    await this.assertIdentityCanBeDeleted(stixId);
  }

  async beforeDeleteById(stixId) {
    await this.assertMitreIdentityWritable(stixId);
    await this.assertIdentityCanBeDeleted(stixId);
  }
}

//Default export
module.exports.IdentitiesService = IdentitiesService;

// Export an instance of the service
module.exports = new IdentitiesService(IdentityType, identitiesRepository);
