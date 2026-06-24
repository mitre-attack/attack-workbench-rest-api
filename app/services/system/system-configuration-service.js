'use strict';

const fs = require('fs');
const config = require('../../config/config');
const systemConfigurationRepository = require('../../repository/system-configurations-repository');
const userAccountsService = require('./user-accounts-service');
const identitiesService = require('../stix/identities-service');
const markingDefinitionsService = require('../stix/marking-definitions-service');
const { BaseService } = require('../meta-classes');
const EventBus = require('../../lib/event-bus');
const Events = require('../../lib/event-constants');
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
   * Sets the organization identity.
   * Validates that the identity exists, creates a new config document (preserving history),
   * and emits an event to trigger downstream propagation.
   */
  async setOrganizationIdentity(stixId) {
    // Validate that the identity exists
    const identities = await identitiesService.retrieveById(stixId, { versions: 'latest' });
    if (identities.length === 0) {
      throw new OrganizationIdentityNotFoundError(stixId);
    }

    const currentConfig = await this.repository.retrieveOne({ lean: true });

    if (currentConfig) {
      // No-op if already set to this identity
      if (currentConfig.organization_identity_ref === stixId) return;

      const previousIdentityRef = currentConfig.organization_identity_ref;

      // Create a new config document with updated identity ref
      await this._createNewConfigVersion(currentConfig, {
        organization_identity_ref: stixId,
      });

      // Determine the full provenance chain
      const organizationIdentityHistory = await this.repository.retrieveAllDistinctIdentityRefs();

      // Emit event for downstream propagation
      await EventBus.emit(Events.SYSTEM_CONFIGURATION_IDENTITY_CHANGED, {
        previousIdentityRef,
        newIdentityRef: stixId,
        organizationIdentityHistory,
      });
    } else {
      // First-time setup: create initial config document
      const newConfig = this.repository.createNewDocument({
        organization_identity_ref: stixId,
        mitre_identity_writes_enabled: config.app.allowMitreIdentityWrites,
      });
      await this.repository.constructor.saveDocument(newConfig);

      // Emit event so validation bypass rules are created at startup
      await EventBus.emit(Events.SYSTEM_CONFIGURATION_IDENTITY_CHANGED, {
        previousIdentityRef: null,
        newIdentityRef: stixId,
        organizationIdentityHistory: [stixId],
      });
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
    const currentConfig = await this.repository.retrieveOne({ lean: true });

    if (currentConfig) {
      await this._createNewConfigVersion(currentConfig, {
        default_marking_definitions: stixIds,
      });
    } else {
      const newConfig = this.repository.createNewDocument({
        default_marking_definitions: stixIds,
      });
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
    const currentConfig = await this.repository.retrieveOne({ lean: true });

    if (!currentConfig) {
      throw new SystemConfigurationNotFound();
    }

    await this._createNewConfigVersion(currentConfig, {
      anonymous_user_account_id: userAccountId,
    });
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
    const currentConfig = await this.repository.retrieveOne({ lean: true });

    if (!currentConfig) {
      throw new SystemConfigurationNotFound();
    }

    await this._createNewConfigVersion(currentConfig, {
      organization_namespace: namespace,
    });

    // Emit event so ValidationBypassesService can manage its own bypass rules
    await EventBus.emit(Events.SYSTEM_CONFIGURATION_NAMESPACE_CHANGED, {
      namespace,
    });
  }

  /**
   * @public
   * CRUD Operation: Read
   * Returns whether protected MITRE identity writes are enabled.
   */
  async retrieveMitreIdentityWrites() {
    const systemConfig = await this.repository.retrieveOne({ lean: true });

    if (!systemConfig) {
      throw new SystemConfigurationNotFound();
    }

    return {
      enabled: systemConfig.mitre_identity_writes_enabled ?? config.app.allowMitreIdentityWrites,
    };
  }

  /**
   * @public
   * CRUD Operation: Update
   * Sets whether protected MITRE identity writes are enabled.
   */
  async setMitreIdentityWrites(enabled) {
    const currentConfig = await this.repository.retrieveOne({ lean: true });

    if (!currentConfig) {
      throw new SystemConfigurationNotFound();
    }

    await this._createNewConfigVersion(currentConfig, {
      mitre_identity_writes_enabled: enabled,
    });
  }

  /**
   * @public
   * CRUD Operation: Read
   * Returns all distinct organization identity refs from all config documents.
   * This represents the full provenance chain of organization identities.
   * @returns {Promise<string[]>}
   */
  async retrieveOrganizationIdentityHistory() {
    return await this.repository.retrieveAllDistinctIdentityRefs();
  }

  /**
   * @private
   * Creates a new system configuration document by copying the latest config
   * and applying the given field overrides. This preserves history by leaving
   * the previous document intact.
   * @param {Object} currentConfig - The current config document (lean)
   * @param {Object} overrides - Fields to update in the new document
   * @returns {Promise<Object>} The saved new config document
   */
  async _createNewConfigVersion(currentConfig, overrides) {
    const configData = {
      organization_identity_ref: currentConfig.organization_identity_ref,
      anonymous_user_account_id: currentConfig.anonymous_user_account_id,
      default_marking_definitions: currentConfig.default_marking_definitions,
      organization_namespace: currentConfig.organization_namespace,
      mitre_identity_writes_enabled:
        currentConfig.mitre_identity_writes_enabled ?? config.app.allowMitreIdentityWrites,
      ...overrides,
    };
    const newConfig = this.repository.createNewDocument(configData);
    return await this.repository.constructor.saveDocument(newConfig);
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
