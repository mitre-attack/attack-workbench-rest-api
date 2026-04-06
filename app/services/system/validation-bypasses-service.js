'use strict';

const { BaseService } = require('../meta-classes');
const validationBypassesRepository = require('../../repository/validation-bypasses-repository');
const logger = require('../../lib/logger');

class ValidationBypassesService {
  constructor(repository) {
    this.repository = repository;
  }

  static initializeEventListeners() {
    const EventBus = require('../../lib/event-bus');
    const Events = require('../../lib/event-constants');

    EventBus.on(
      Events.SYSTEM_CONFIGURATION_NAMESPACE_CHANGED,
      ValidationBypassesService.handleNamespaceChanged.bind(ValidationBypassesService),
    );

    EventBus.on(
      Events.VALIDATION_BYPASS_CHECK_REQUESTED,
      ValidationBypassesService.handleBypassCheckRequested.bind(ValidationBypassesService),
    );

    logger.info('ValidationBypassesService: Event listeners initialized');
  }

  /**
   * Handle namespace configuration changes.
   * Removes previous auto-created rules and creates new ones if a prefix is set.
   * @param {Object} payload - Event payload
   * @param {Object} payload.namespace - The new namespace configuration ({ prefix, range_start })
   */
  static async handleNamespaceChanged(payload) {
    const { namespace } = payload;
    const service = module.exports;

    // Always remove previous auto-created rules
    await service.removeNamespaceRules();

    // If a namespace prefix is being set, create new bypass rules
    if (namespace?.prefix) {
      const { stixTypeToAttackIdMapping } = require('@mitre-attack/attack-data-model');
      const stixTypes = Object.keys(stixTypeToAttackIdMapping);
      await service.createNamespaceRules(stixTypes);
    }
  }

  /**
   * Handle a validation bypass check request from the event bus.
   * Returns an array of non-bypassed errors.
   * @param {Object} payload
   * @param {Array} payload.errors - Validation errors to check
   * @param {string} payload.stixType - The STIX type being validated
   * @returns {Promise<Array>} Non-bypassed errors
   */
  static async handleBypassCheckRequested(payload) {
    const { errors, stixType } = payload;
    const service = module.exports;

    const nonBypassed = [];
    for (const error of errors) {
      const bypassed = await service.isErrorBypassed(error, stixType);
      if (!bypassed) {
        nonBypassed.push(error);
      }
    }
    return nonBypassed;
  }

  async retrieveAll(options) {
    const results = await this.repository.retrieveAll(options);
    return BaseService.paginate(options, results);
  }

  async create(data) {
    return await this.repository.save(data);
  }

  async retrieveById(id) {
    return await this.repository.retrieveById(id);
  }

  async deleteById(id) {
    return await this.repository.deleteById(id);
  }

  /**
   * Check if a validation error should be bypassed based on stored rules.
   * @param {Object} error - The validation error ({ path, code, ... })
   * @param {string} stixType - The STIX type being validated
   * @returns {Promise<boolean>} True if the error should be bypassed
   */
  async isErrorBypassed(error, stixType) {
    const rules = await this.repository.findAll();

    const errorPathStr = JSON.stringify(error.path.map(String));

    for (const rule of rules) {
      if (!rule.suppressError) continue;

      // Check stixType match ('all' matches any type)
      if (rule.stixType !== 'all' && rule.stixType !== stixType) continue;

      // Check errorCode match
      if (rule.errorCode !== error.code) continue;

      // Check fieldPath match (coerce both sides to string for numeric index comparison)
      const rulePathStr = JSON.stringify(rule.fieldPath.map(String));
      if (rulePathStr !== errorPathStr) continue;

      return true;
    }

    return false;
  }

  /**
   * Create bypass rules for namespace-prefixed ATT&CK IDs across all relevant STIX types.
   * @param {string[]} stixTypes - STIX types that support ATT&CK IDs
   */
  async createNamespaceRules(stixTypes) {
    const rules = stixTypes.map((stixType) => ({
      fieldPath: ['external_references', '0', 'external_id'],
      errorCode: 'custom',
      stixType,
      suppressError: true,
      autoCreated: true,
    }));

    for (const rule of rules) {
      try {
        await this.repository.save(rule);
      } catch (err) {
        // Skip duplicates — rule may already exist
        if (err.name === 'DuplicateIdError') continue;
        throw err;
      }
    }

    logger.info(`Created ${rules.length} namespace validation bypass rules`);
  }

  /**
   * Remove all auto-created bypass rules (e.g., when namespace is cleared).
   */
  async removeNamespaceRules() {
    const result = await this.repository.deleteAutoCreated();
    logger.info(`Removed ${result.deletedCount} auto-created validation bypass rules`);
  }
}

const service = new ValidationBypassesService(validationBypassesRepository);
ValidationBypassesService.initializeEventListeners();

module.exports = service;
