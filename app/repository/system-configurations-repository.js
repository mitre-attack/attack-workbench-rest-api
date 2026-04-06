const SystemConfiguration = require('../models/system-configuration-model');
const { DatabaseError } = require('../exceptions');

class SystemConfigurationsRepository {
  constructor(model) {
    this.model = model;
  }

  createNewDocument(data) {
    return new this.model(data);
  }

  static async saveDocument(document) {
    try {
      return await document.save();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  /**
   * Retrieve the latest (most recent) system configuration document.
   * Sorts by created_at descending so the newest document is returned.
   */
  async retrieveOne(options) {
    options = options ?? {};
    if (options.lean) {
      return await this.model.findOne().sort({ created_at: -1 }).lean();
    } else {
      return await this.model.findOne().sort({ created_at: -1 });
    }
  }

  /**
   * Retrieve all distinct organization_identity_ref values across all config documents.
   * Used to determine the full provenance chain of organization identities.
   * @returns {Promise<string[]>} Array of distinct identity ref strings
   */
  async retrieveAllDistinctIdentityRefs() {
    try {
      const refs = await this.model.distinct('organization_identity_ref').exec();
      return refs.filter((ref) => ref != null);
    } catch (err) {
      throw new DatabaseError(err);
    }
  }
}

module.exports = new SystemConfigurationsRepository(SystemConfiguration);
