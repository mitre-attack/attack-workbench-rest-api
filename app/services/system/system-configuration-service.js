'use strict';

const fs = require('fs');
const config = require('../../config/config');
const systemConfigurationRepository = require('../../repository/system-configurations-repository');
const userAccountsService = require('./user-accounts-service');
const identitiesService = require('../stix/identities-service');
const markingDefinitionsService = require('../stix/marking-definitions-service');
const { BaseService } = require('../meta-classes');
const {
  SystemConfigurationNotFound,
  OrganizationIdentityNotSetError,
  OrganizationIdentityNotFoundError,
  DefaultMarkingDefinitionsNotFoundError,
  AnonymousUserAccountNotSetError,
  AnonymousUserAccountNotFoundError,
  NotImplementedError,
} = require('../../exceptions');

class SystemConfigurationService extends BaseService {
  constructor() {
    super(null, systemConfigurationRepository);
    this._allowedValues = null;
  }

  /**
   * @public
   * (CRUD Operation: Read)
   * Returns the system version information
   */
  static retrieveSystemVersion() {
    return {
      version: config.app.version,
      attackSpecVersion: config.app.attackSpecVersion,
    };
  }

  /**
   * @public
   * CRUD Operation: Read
   * Returns allowed values for system configuration
   */
  async retrieveAllowedValues() {
    if (this._allowedValues) {
      return this._allowedValues;
    }
    const data = await fs.promises.readFile(config.configurationFiles.allowedValues);
    this._allowedValues = JSON.parse(data);
    return this._allowedValues;
  }

  /**
   * @internal
   * Helper method for retrieving allowed values for a specific type
   */
  async retrieveAllowedValuesForType(objectType) {
    const values = await this.retrieveAllowedValues();
    return values.find((element) => element.objectType === objectType);
  }

  /**
   * @internal
   * Helper method for retrieving allowed values for a specific type and property
   */
  async retrieveAllowedValuesForTypeAndProperty(type, propertyName) {
    const values = await this.retrieveAllowedValuesForType(type);
    return values?.properties.find((element) => element.propertyName === propertyName);
  }

  /**
   * @internal
   * Helper method for retrieving allowed values for a specific domain
   */
  async retrieveAllowedValuesForTypePropertyDomain(objectType, propertyName, domainName) {
    const values = await this.retrieveAllowedValuesForTypeAndProperty(objectType, propertyName);
    return values?.domains.find((element) => element.domainName === domainName);
  }

  /**
   * @public
   * CRUD Operation: Read
   * Returns the organization identity
   */
  async retrieveOrganizationIdentity() {
    // if (!identitiesService) {
    //   identitiesService = require('./identities-service');
    // }

    const systemConfig = await this.repository.retrieveOne({ lean: true });
    if (!systemConfig?.organization_identity_ref) {
      throw new OrganizationIdentityNotSetError();
    }

    const identities = await identitiesService.retrieveById(
      systemConfig.organization_identity_ref,
      { versions: 'latest' },
    );

    if (identities.length === 1) {
      return identities[0];
    }
    throw new OrganizationIdentityNotFoundError(systemConfig.organization_identity_ref);
  }

  /**
   * @public
   * CRUD Operation: Update
   * Sets the organization identity
   */
  async setOrganizationIdentity(stixId) {
    const systemConfig = await this.repository.retrieveOne();

    if (systemConfig) {
      systemConfig.organization_identity_ref = stixId;
      await this.repository.constructor.saveDocument(systemConfig);
    } else {
      const systemConfigData = { organization_identity_ref: stixId };
      const newConfig = this.repository.createNewDocument(systemConfigData);
      await this.repository.constructor.saveDocument(newConfig);
    }
  }

  /**
   * @public
   * CRUD Operation: Read
   * Returns the default marking definitions
   */
  async retrieveDefaultMarkingDefinitions(options = {}) {
    // if (!markingDefinitionsService) {
    //   markingDefinitionsService = require('./marking-definitions-service');
    // }

    const systemConfig = await this.repository.retrieveOne({ lean: true });
    if (!systemConfig) return [];

    if (!systemConfig.default_marking_definitions) return [];

    if (options.refOnly) {
      return systemConfig.default_marking_definitions;
    }

    const defaultMarkingDefinitions = [];
    for (const stixId of systemConfig.default_marking_definitions) {
      const markingDefinition = await markingDefinitionsService.retrieveById(stixId);
      if (markingDefinition.length === 1) {
        defaultMarkingDefinitions.push(markingDefinition[0]);
      } else {
        throw new DefaultMarkingDefinitionsNotFoundError();
      }
    }
    return defaultMarkingDefinitions;
  }

  /**
   * @public
   * CRUD Operation: Update
   * Sets the default marking definitions
   */
  async setDefaultMarkingDefinitions(stixIds) {
    const systemConfig = await this.repository.retrieveOne();

    if (systemConfig) {
      systemConfig.default_marking_definitions = stixIds;
      await this.repository.constructor.saveDocument(systemConfig);
    } else {
      const systemConfigData = { default_marking_definitions: stixIds };
      const newConfig = this.repository.createNewDocument(systemConfigData);
      await this.repository.constructor.saveDocument(newConfig);
    }
  }

  /**
   * @internal
   * Internal method for user account management
   */
  async retrieveAnonymousUserAccount() {
    const systemConfig = await this.repository.retrieveOne({ lean: true });

    if (!systemConfig?.anonymous_user_account_id) {
      throw new AnonymousUserAccountNotSetError();
    }

    const userAccount = await userAccountsService.retrieveById(
      systemConfig.anonymous_user_account_id,
      {},
    );

    if (userAccount) {
      return userAccount;
    }
    throw new AnonymousUserAccountNotFoundError(systemConfig.anonymous_user_account_id);
  }

  /**
   * @internal
   * Internal method for user account management
   */
  async setAnonymousUserAccountId(userAccountId) {
    const systemConfig = await this.repository.retrieveOne();

    if (!systemConfig) {
      throw new SystemConfigurationNotFound();
    }

    systemConfig.anonymous_user_account_id = userAccountId;
    await this.repository.constructor.saveDocument(systemConfig);
  }

  /**
   * @public
   * CRUD Operation: Read
   * Returns the authentication configuration
   */
  static retrieveAuthenticationConfig() {
    return {
      mechanisms: [{ authnType: config.userAuthn.mechanism }],
    };
  }

  /**
   * @public
   * CRUD Operation: Read
   * Returns the organization namespace
   */
  async retrieveOrganizationNamespace() {
    const systemConfig = await this.repository.retrieveOne({ lean: true });

    if (!systemConfig) {
      throw new SystemConfigurationNotFound();
    }

    return systemConfig.organization_namespace;
  }

  /**
   * @public
   * CRUD Operation: Update
   * Sets the organization namespace
   */
  async setOrganizationNamespace(namespace) {
    const systemConfig = await this.repository.retrieveOne();

    if (!systemConfig) {
      throw new SystemConfigurationNotFound();
    }

    systemConfig.organization_namespace = namespace;
    await this.repository.constructor.saveDocument(systemConfig);
  }

  /**
   * Override of base class create() because:
   * 1. create() requires a STIX `type` -- this service does not define a type
   */
  // eslint-disable-next-line no-unused-vars
  create(data, options) {
    throw new NotImplementedError(this.constructor.name, 'create');
  }
}

// Export an instance of the service
// Pass null for type since SystemConfiguration isn't a STIX type
module.exports = new SystemConfigurationService(null, systemConfigurationRepository);

module.exports.SystemConfigurationService = SystemConfigurationService;
