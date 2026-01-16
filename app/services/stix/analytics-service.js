'use strict';

const analyticsRepository = require('../../repository/analytics-repository');
const dataComponentsRepository = require('../../repository/data-components-repository');
const { BaseService } = require('../meta-classes');
const { Analytic: AnalyticType } = require('../../lib/types');
const {
  createAttackExternalReference,
  removeAttackExternalReferences,
} = require('../../lib/external-reference-builder');
const EventBus = require('../../lib/event-bus');
const logger = require('../../lib/logger');
const Exceptions = require('../../exceptions');

/**
 * Service for managing analytics
 *
 * Lifecycle hooks:
 * - beforeCreate: Builds outbound embedded_relationships for data components and validates they exist
 * - afterCreate: Emits domain event to notify DataComponentsService
 * - beforeUpdate: Rebuilds outbound embedded_relationships, validates data component references, and detects changes
 * - afterUpdate: Emits domain events for added/removed data components
 *
 * Event listeners:
 * - x-mitre-detection-strategy::analytics-referenced - Add inbound relationships when detection strategy references analytics
 * - x-mitre-detection-strategy::analytics-removed - Remove inbound relationships when detection strategy removes analytics
 *
 * Events emitted (listened to by DataComponentsService):
 * - x-mitre-analytic::data-components-referenced
 * - x-mitre-analytic::data-components-removed
 */
class AnalyticsService extends BaseService {
  /**
   * Initialize event listeners
   * Called once on app startup
   */
  static initializeEventListeners() {
    EventBus.on(
      'x-mitre-detection-strategy::analytics-referenced',
      this.handleAnalyticsReferenced.bind(this),
    );

    EventBus.on(
      'x-mitre-detection-strategy::analytics-removed',
      this.handleAnalyticsRemoved.bind(this),
    );

    logger.info('AnalyticsService: Event listeners initialized');
  }

  /**
   * Handle analytics being referenced by a detection strategy
   * Add inbound embedded_relationship and update external_references
   *
   * @param {Object} payload - Event payload
   * @param {Object} payload.detectionStrategy - The detection strategy document that references the analytics
   * @param {string[]} payload.analyticIds - Array of analytic STIX IDs being referenced
   * @returns {Promise<void>}
   */
  static async handleAnalyticsReferenced(payload) {
    const { detectionStrategy, analyticIds } = payload;

    logger.info(
      `Analytics Service heard event: 'x-mitre-detection-strategy::analytics-referenced' for ${detectionStrategy.stix.id}`,
    );

    for (const analyticId of analyticIds) {
      try {
        const analytic = await analyticsRepository.retrieveLatestByStixId(analyticId);

        if (!analytic) {
          logger.warn(
            `AnalyticsService: Could not find analytic ${analyticId} to add inbound relationship`,
          );
          continue;
        }

        // Initialize embedded_relationships if needed
        if (!analytic.workspace) {
          analytic.workspace = {};
        }
        if (!analytic.workspace.embedded_relationships) {
          analytic.workspace.embedded_relationships = [];
        }

        // Check if relationship already exists
        const exists = analytic.workspace.embedded_relationships.some(
          (rel) => rel.stix_id === detectionStrategy.stix.id && rel.direction === 'inbound',
        );

        if (!exists) {
          // Add inbound embedded_relationship
          analytic.workspace.embedded_relationships.push({
            stix_id: detectionStrategy.stix.id,
            attack_id: detectionStrategy.workspace?.attack_id || null,
            name: detectionStrategy.stix.name,
            direction: 'inbound',
          });

          logger.info(
            `AnalyticsService: Added inbound relationship from detection strategy ${detectionStrategy.stix.id} to analytic ${analyticId}`,
          );
        }

        // Update external_references with URL to parent detection strategy
        if (!analytic.stix.external_references) {
          analytic.stix.external_references = [];
        }

        // Remove existing ATT&CK external references
        analytic.stix.external_references = removeAttackExternalReferences(
          analytic.stix.external_references,
        );

        // Create new ATT&CK external reference with URL
        const attackRef = createAttackExternalReference(analytic.toObject());
        if (attackRef) {
          analytic.stix.external_references.unshift(attackRef);
          logger.info(
            `AnalyticsService: Updated external_references URL for analytic ${analyticId}`,
          );
        }

        await analyticsRepository.saveDocument(analytic);
      } catch (error) {
        logger.error(
          `AnalyticsService: Error handling analytics-referenced for ${analyticId}:`,
          error,
        );
        // Continue processing other analytics
      }
    }
  }

  /**
   * Handle analytics being removed from a detection strategy
   * Remove inbound embedded_relationship and update external_references
   *
   * @param {Object} payload - Event payload
   * @param {string} payload.detectionStrategyId - STIX ID of the detection strategy
   * @param {string[]} payload.analyticIds - Array of analytic STIX IDs being removed
   * @returns {Promise<void>}
   */
  static async handleAnalyticsRemoved(payload) {
    const { detectionStrategyId, analyticIds } = payload;

    for (const analyticId of analyticIds) {
      try {
        const analytic = await analyticsRepository.retrieveLatestByStixId(analyticId);

        if (!analytic) {
          logger.warn(
            `AnalyticsService: Could not find analytic ${analyticId} to remove inbound relationship`,
          );
          continue;
        }

        if (analytic.workspace?.embedded_relationships) {
          // Remove inbound embedded_relationship
          const initialLength = analytic.workspace.embedded_relationships.length;
          analytic.workspace.embedded_relationships =
            analytic.workspace.embedded_relationships.filter(
              (rel) => !(rel.stix_id === detectionStrategyId && rel.direction === 'inbound'),
            );

          const removed = analytic.workspace.embedded_relationships.length < initialLength;
          if (removed) {
            logger.info(
              `AnalyticsService: Removed inbound relationship from detection strategy ${detectionStrategyId} to analytic ${analyticId}`,
            );
          }
        }

        // Update external_references (remove URL since no parent)
        if (analytic.stix?.external_references) {
          // Remove existing ATT&CK external references
          analytic.stix.external_references = removeAttackExternalReferences(
            analytic.stix.external_references,
          );

          // Rebuild ATT&CK external reference without URL (no parent detection strategy)
          const attackRef = {
            source_name: 'mitre-attack',
            external_id: analytic.workspace.attack_id,
          };

          analytic.stix.external_references.unshift(attackRef);

          logger.info(
            `AnalyticsService: Removed external_references URL for analytic ${analyticId}`,
          );
        }

        await analyticsRepository.saveDocument(analytic);
      } catch (error) {
        logger.error(
          `AnalyticsService: Error handling analytics-removed for ${analyticId}:`,
          error,
        );
        // Continue processing other analytics
      }
    }
  }

  /**
   * Lifecycle hook: Prepare analytic data before database persistence
   * - Sets analytic name to match ATT&CK ID
   * - Builds outbound embedded_relationships for data component references
   * - Validates that all referenced data components exist
   *
   * @param {Object} data - The analytic data to be created
   * @param {Object} data.stix - STIX properties
   * @param {Object} data.workspace - Workbench metadata
   * @param {Object} options - Creation options
   * @throws {Exceptions.NotFoundError} If a referenced data component does not exist
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async beforeCreate(data, options) {
    // Analytic name matches its ATT&CK ID
    data.stix.name = data.workspace.attack_id;
    logger.debug(`Setting name to match ATT&CK ID: ${data.stix.name}`);

    // Initialize embedded_relationships if not present
    if (!data.workspace) {
      data.workspace = {};
    }
    if (!data.workspace.embedded_relationships) {
      data.workspace.embedded_relationships = [];
    }

    // Build outbound embedded_relationships for data component references
    // Cross-repository READS are allowed for denormalization (see CROSS_SERVICE_READS_PATTERN.md)
    const dataComponentRefs =
      data.stix?.x_mitre_log_source_references?.map((ref) => ref.x_mitre_data_component_ref) || [];

    if (dataComponentRefs.length > 0) {
      for (const dataComponentId of dataComponentRefs) {
        const dataComponent =
          await dataComponentsRepository.retrieveLatestByStixId(dataComponentId);
        if (!dataComponent) {
          throw new Exceptions.NotFoundError({
            objectType: 'x-mitre-data-component',
            objectId: dataComponentId,
            message: `Cannot create analytic: Referenced data component ${dataComponentId} does not exist`,
          });
        }

        // Add outbound embedded_relationship
        data.workspace.embedded_relationships.push({
          stix_id: dataComponentId,
          attack_id: dataComponent.workspace?.attack_id || null,
          direction: 'outbound',
        });
      }

      logger.debug(
        `Built ${dataComponentRefs.length} outbound embedded relationship(s) for analytic ${data.workspace.attack_id}`,
      );
    }
  }

  /**
   * Lifecycle hook: Handle post-creation side effects
   * Emits domain event to notify DataComponentsService that data components were referenced
   *
   * @param {Object} createdDocument - The created analytic document
   * @param {Object} _options - Creation options (unused)
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async afterCreate(createdDocument, _options) {
    // Extract data component IDs from x_mitre_log_source_references
    const dataComponentRefs =
      createdDocument.stix?.x_mitre_log_source_references?.map(
        (ref) => ref.x_mitre_data_component_ref,
      ) || [];

    if (dataComponentRefs.length > 0) {
      logger.info(
        `AnalyticsService: Emitting data-components-referenced event for ${dataComponentRefs.length} data component(s)`,
        { stixId: createdDocument.stix.id, dataComponentIds: dataComponentRefs },
      );

      await EventBus.emit('x-mitre-analytic::data-components-referenced', {
        analyticId: createdDocument.stix.id,
        analytic: createdDocument.toObject ? createdDocument.toObject() : createdDocument,
        dataComponentIds: dataComponentRefs,
      });
    }
  }

  /**
   * Lifecycle hook: Prepare analytic data before update persistence
   * - Rebuilds outbound embedded_relationships for data components
   * - Preserves inbound relationships from detection strategies
   * - Validates that all referenced data components exist
   * - Detects changes in data component references for event emission
   * - Updates external_references if parent detection strategy changes
   *
   * @param {string} stixId - STIX ID of the analytic being updated
   * @param {string} stixModified - Modified timestamp of the version being updated
   * @param {Object} data - Updated analytic data
   * @param {Object} existingDocument - The existing analytic document
   * @throws {Exceptions.NotFoundError} If a referenced data component does not exist
   * @returns {Promise<void>}
   */
  async beforeUpdate(stixId, stixModified, data, existingDocument) {
    // Initialize embedded_relationships if not present
    if (!data.workspace) {
      data.workspace = {};
    }
    if (!data.workspace.embedded_relationships) {
      data.workspace.embedded_relationships = [];
    }

    // Validate that all referenced data components exist and build outbound relationships
    const newDataComponentRefs =
      data.stix?.x_mitre_log_source_references?.map((ref) => ref.x_mitre_data_component_ref) || [];

    // Preserve existing non-data-component embedded relationships (e.g., inbound from detection strategies)
    const existingNonDataComponentRels = (data.workspace.embedded_relationships || []).filter(
      (rel) => !rel.stix_id?.startsWith('x-mitre-data-component--'),
    );

    // Build new outbound embedded relationships for data components
    const dataComponentEmbeddedRels = [];
    if (newDataComponentRefs.length > 0) {
      for (const dataComponentId of newDataComponentRefs) {
        const dataComponent =
          await dataComponentsRepository.retrieveLatestByStixId(dataComponentId);
        if (!dataComponent) {
          throw new Exceptions.NotFoundError({
            objectType: 'x-mitre-data-component',
            objectId: dataComponentId,
            message: `Cannot update analytic: Referenced data component ${dataComponentId} does not exist`,
          });
        }

        // Add outbound embedded_relationship
        dataComponentEmbeddedRels.push({
          stix_id: dataComponentId,
          attack_id: dataComponent.workspace?.attack_id || null,
          direction: 'outbound',
        });
      }
    }

    // Rebuild embedded_relationships: preserve inbound relationships, rebuild outbound data component relationships
    data.workspace.embedded_relationships = [
      ...existingNonDataComponentRels,
      ...dataComponentEmbeddedRels,
    ];

    // Detect changes in data component references for event emission
    const oldDataComponentRefs =
      existingDocument.stix?.x_mitre_log_source_references?.map(
        (ref) => ref.x_mitre_data_component_ref,
      ) || [];

    this._addedDataComponentRefs = newDataComponentRefs.filter(
      (ref) => !oldDataComponentRefs.includes(ref),
    );
    this._removedDataComponentRefs = oldDataComponentRefs.filter(
      (ref) => !newDataComponentRefs.includes(ref),
    );

    // Check if embedded_relationships changed (specifically inbound detection strategy relationships)
    const oldEmbeddedRels = existingDocument.workspace?.embedded_relationships || [];
    const newEmbeddedRels = data.workspace?.embedded_relationships || [];

    const oldParentStrategy = oldEmbeddedRels.find(
      (rel) =>
        rel.direction === 'inbound' && rel.stix_id?.startsWith('x-mitre-detection-strategy--'),
    );
    const newParentStrategy = newEmbeddedRels.find(
      (rel) =>
        rel.direction === 'inbound' && rel.stix_id?.startsWith('x-mitre-detection-strategy--'),
    );

    const parentStrategyChanged =
      oldParentStrategy?.stix_id !== newParentStrategy?.stix_id ||
      oldParentStrategy?.attack_id !== newParentStrategy?.attack_id;

    // If parent detection strategy changed, rebuild the ATT&CK external reference
    if (parentStrategyChanged && data.stix?.external_references) {
      // Remove existing ATT&CK external references
      data.stix.external_references = removeAttackExternalReferences(data.stix.external_references);

      // Create new ATT&CK external reference with updated URL
      const attackRef = createAttackExternalReference({
        workspace: data.workspace,
        stix: data.stix,
      });

      if (attackRef) {
        data.stix.external_references.unshift(attackRef);
      }
    }
  }

  /**
   * Lifecycle hook: Handle post-update side effects
   * Emits domain events for added/removed data component references
   *
   * @param {Object} updatedDocument - The updated analytic document
   * @param {Object} _previousDocument - The previous version of the analytic (unused)
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async afterUpdate(updatedDocument, _previousDocument) {
    const addedRefs = this._addedDataComponentRefs || [];
    const removedRefs = this._removedDataComponentRefs || [];

    // Emit event for newly referenced data components
    if (addedRefs.length > 0) {
      logger.info(
        `AnalyticsService: Emitting data-components-referenced event for ${addedRefs.length} added data component(s)`,
        { stixId: updatedDocument.stix.id, dataComponentIds: addedRefs },
      );

      await EventBus.emit('x-mitre-analytic::data-components-referenced', {
        analyticId: updatedDocument.stix.id,
        analytic: updatedDocument.toObject ? updatedDocument.toObject() : updatedDocument,
        dataComponentIds: addedRefs,
      });
    }

    // Emit event for removed data components
    if (removedRefs.length > 0) {
      logger.info(
        `AnalyticsService: Emitting data-components-removed event for ${removedRefs.length} removed data component(s)`,
        { stixId: updatedDocument.stix.id, dataComponentIds: removedRefs },
      );

      await EventBus.emit('x-mitre-analytic::data-components-removed', {
        analyticId: updatedDocument.stix.id,
        dataComponentIds: removedRefs,
      });
    }

    // Clean up instance variables
    delete this._addedDataComponentRefs;
    delete this._removedDataComponentRefs;
  }

  /**
   * Retrieve all analytics with optional filtering and pagination
   * Strips embedded_relationships from response unless explicitly requested
   * When embedded_relationships are included, populates names for detection strategies
   *
   * @param {Object} options - Query options
   * @param {boolean} [options.includeEmbeddedRelationships=false] - Include embedded relationships in response
   * @param {boolean} [options.includePagination=false] - Include pagination metadata
   * @returns {Promise<Array|Object>} Array of analytics or paginated result object
   */
  async retrieveAll(options) {
    const results = await super.retrieveAll(options);

    if (options.includeEmbeddedRelationships) {
      // Populate names for embedded relationships
      const analytics = options.includePagination ? results.data : results;
      await this.populateEmbeddedRelationshipNames(analytics);
    } else {
      // Strip embedded_relationships from response
      if (options.includePagination) {
        await this.stripEmbeddedRelationships(results.data);
      } else {
        await this.stripEmbeddedRelationships(results);
      }
    }

    return results;
  }

  /**
   * Retrieve analytics by STIX ID
   * Strips embedded_relationships from response unless explicitly requested
   * When embedded_relationships are included, populates names for detection strategies
   *
   * @param {string} stixId - The STIX ID of the analytic
   * @param {Object} options - Query options
   * @param {boolean} [options.includeEmbeddedRelationships=false] - Include embedded relationships in response
   * @returns {Promise<Array>} Array of analytic versions
   */
  async retrieveById(stixId, options) {
    const results = await super.retrieveById(stixId, options);

    if (options.includeEmbeddedRelationships) {
      // Populate names for embedded relationships
      await this.populateEmbeddedRelationshipNames(results);
    } else {
      // Strip embedded_relationships from response
      await this.stripEmbeddedRelationships(results);
    }

    return results;
  }

  /**
   * Populate names for embedded relationships by fetching referenced documents
   * This is needed because names are no longer stored in embedded_relationships (only stix_id + attack_id)
   * Handles both inbound detection strategy relationships and outbound data component relationships
   *
   * @param {Array} analytics - Array of analytic documents
   * @returns {Promise<void>}
   */
  async populateEmbeddedRelationshipNames(analytics) {
    const detectionStrategiesRepository = require('../../repository/detection-strategies-repository');
    const dataComponentsRepository = require('../../repository/data-components-repository');

    for (const analytic of analytics) {
      if (!analytic.workspace?.embedded_relationships) {
        continue;
      }

      for (const rel of analytic.workspace.embedded_relationships) {
        // Handle inbound relationships from detection strategies
        if (
          rel.direction === 'inbound' &&
          rel.stix_id?.startsWith('x-mitre-detection-strategy--')
        ) {
          try {
            const detectionStrategy = await detectionStrategiesRepository.retrieveLatestByStixId(
              rel.stix_id,
            );
            if (detectionStrategy) {
              // Add name as a transient property (not persisted to DB)
              rel.name = detectionStrategy.stix.name;
            } else {
              logger.warn(
                `AnalyticsService: Could not find detection strategy ${rel.stix_id} to populate name`,
              );
              rel.name = null;
            }
          } catch (error) {
            logger.error(
              `AnalyticsService: Error fetching detection strategy ${rel.stix_id} for name:`,
              error,
            );
            rel.name = null;
          }
        }

        // Handle outbound relationships to data components
        if (rel.direction === 'outbound' && rel.stix_id?.startsWith('x-mitre-data-component--')) {
          try {
            const dataComponent = await dataComponentsRepository.retrieveLatestByStixId(
              rel.stix_id,
            );
            if (dataComponent) {
              // Add name as a transient property (not persisted to DB)
              rel.name = dataComponent.stix.name;
            } else {
              logger.warn(
                `AnalyticsService: Could not find data component ${rel.stix_id} to populate name`,
              );
              rel.name = null;
            }
          } catch (error) {
            logger.error(
              `AnalyticsService: Error fetching data component ${rel.stix_id} for name:`,
              error,
            );
            rel.name = null;
          }
        }
      }
    }
  }

  /**
   * Remove embedded_relationships from analytics response
   * Used to hide internal relationship metadata from API consumers
   *
   * @param {Array} analytics - Array of analytic documents
   * @returns {Promise<void>}
   */
  async stripEmbeddedRelationships(analytics) {
    for (const analytic of analytics) {
      if (analytic.workspace) {
        // For Mongoose documents, we need to set to undefined to trigger proper deletion
        analytic.workspace.embedded_relationships = undefined;
      }
    }
  }
}

AnalyticsService.initializeEventListeners();

module.exports = new AnalyticsService(AnalyticType, analyticsRepository);
