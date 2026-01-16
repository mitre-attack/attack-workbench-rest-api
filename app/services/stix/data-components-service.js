'use strict';

const dataComponentsRepository = require('../../repository/data-components-repository');
const dataSourcesRepository = require('../../repository/data-sources-repository');
const { BaseService } = require('../meta-classes');
const { DataComponent: DataComponentType } = require('../../lib/types');
const EventBus = require('../../lib/event-bus');
const logger = require('../../lib/logger');
const Exceptions = require('../../exceptions');

/**
 * Service for managing data components
 *
 * Lifecycle hooks:
 * - beforeCreate: Builds outbound embedded_relationship for x_mitre_data_source_ref and validates it exists
 * - afterCreate: Emits domain event to notify DataSourcesService
 * - beforeUpdate: Rebuilds outbound embedded_relationship, validates data source reference, and detects changes
 * - afterUpdate: Emits domain events for added/removed data source references
 *
 * Event listeners:
 * - x-mitre-analytic::data-components-referenced - Add inbound relationships when analytic references data components
 * - x-mitre-analytic::data-components-removed - Remove inbound relationships when analytic removes data components
 *
 * Events emitted (listened to by DataSourcesService):
 * - x-mitre-data-component::data-source-referenced
 * - x-mitre-data-component::data-source-removed
 */
class DataComponentsService extends BaseService {
  /**
   * Initialize event listeners
   * Called once on app startup
   */
  static initializeEventListeners() {
    EventBus.on(
      'x-mitre-analytic::data-components-referenced',
      this.handleDataComponentsReferenced.bind(this),
    );

    EventBus.on(
      'x-mitre-analytic::data-components-removed',
      this.handleDataComponentsRemoved.bind(this),
    );

    logger.info('DataComponentsService: Event listeners initialized');
  }

  /**
   * Handle data components being referenced by an analytic
   * Add inbound embedded_relationship
   */
  static async handleDataComponentsReferenced(payload) {
    const { analytic, dataComponentIds } = payload;

    logger.info(
      `DataComponentsService heard event: 'x-mitre-analytic::data-components-referenced' for ${analytic.stix.id}`,
    );

    for (const dataComponentId of dataComponentIds) {
      try {
        const dataComponent =
          await dataComponentsRepository.retrieveLatestByStixId(dataComponentId);

        if (!dataComponent) {
          logger.warn(
            `DataComponentsService: Could not find data component ${dataComponentId} to add inbound relationship`,
          );
          continue;
        }

        // Initialize embedded_relationships if needed
        if (!dataComponent.workspace) {
          dataComponent.workspace = {};
        }
        if (!dataComponent.workspace.embedded_relationships) {
          dataComponent.workspace.embedded_relationships = [];
        }

        // Check if relationship already exists
        const exists = dataComponent.workspace.embedded_relationships.some(
          (rel) => rel.stix_id === analytic.stix.id && rel.direction === 'inbound',
        );

        if (!exists) {
          // Add inbound embedded_relationship
          dataComponent.workspace.embedded_relationships.push({
            stix_id: analytic.stix.id,
            attack_id: analytic.workspace?.attack_id || null,
            direction: 'inbound',
          });

          logger.info(
            `DataComponentsService: Added inbound relationship from analytic ${analytic.stix.id} to data component ${dataComponentId}`,
          );
        }

        await dataComponentsRepository.saveDocument(dataComponent);
      } catch (error) {
        logger.error(
          `DataComponentsService: Error handling data-components-referenced for ${dataComponentId}:`,
          error,
        );
        // Continue processing other data components
      }
    }
  }

  /**
   * Handle data components being removed from an analytic
   * Remove inbound embedded_relationship
   */
  static async handleDataComponentsRemoved(payload) {
    const { analyticId, dataComponentIds } = payload;

    logger.info(
      `DataComponentsService heard event: 'x-mitre-analytic::data-components-removed' for ${analyticId}`,
    );

    for (const dataComponentId of dataComponentIds) {
      try {
        const dataComponent =
          await dataComponentsRepository.retrieveLatestByStixId(dataComponentId);

        if (!dataComponent) {
          logger.warn(
            `DataComponentsService: Could not find data component ${dataComponentId} to remove inbound relationship`,
          );
          continue;
        }

        if (dataComponent.workspace?.embedded_relationships) {
          // Remove inbound embedded_relationship
          const initialLength = dataComponent.workspace.embedded_relationships.length;
          dataComponent.workspace.embedded_relationships =
            dataComponent.workspace.embedded_relationships.filter(
              (rel) => !(rel.stix_id === analyticId && rel.direction === 'inbound'),
            );

          const removed = dataComponent.workspace.embedded_relationships.length < initialLength;
          if (removed) {
            logger.info(
              `DataComponentsService: Removed inbound relationship from analytic ${analyticId} to data component ${dataComponentId}`,
            );
          }
        }

        await dataComponentsRepository.saveDocument(dataComponent);
      } catch (error) {
        logger.error(
          `DataComponentsService: Error handling data-components-removed for ${dataComponentId}:`,
          error,
        );
        // Continue processing other data components
      }
    }
  }

  /**
   * Lifecycle hook: Prepare data component data before database persistence
   * - Builds outbound embedded_relationship for data source reference
   * - Validates that the referenced data source exists
   * - Detects if this is a new version and tracks removed relationships
   *
   * @param {Object} data - The data component data to be created
   * @param {Object} data.stix - STIX properties
   * @param {string} data.stix.x_mitre_data_source_ref - Data source STIX ID reference
   * @param {Object} data.workspace - Workbench metadata
   * @param {Object} options - Creation options
   * @throws {Exceptions.NotFoundError} If the referenced data source does not exist
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async beforeCreate(data, options) {
    // Initialize embedded_relationships if not present
    if (!data.workspace) {
      data.workspace = {};
    }
    if (!data.workspace.embedded_relationships) {
      data.workspace.embedded_relationships = [];
    }

    // Check if this is a new version of an existing data component
    // (same stix.id, but creating a new version with different modified date)
    let previousVersion = null;
    if (data.stix?.id) {
      try {
        previousVersion = await dataComponentsRepository.retrieveLatestByStixId(data.stix.id);
      } catch {
        // It's okay if there's no previous version - this might be the first version
        logger.debug(`No previous version found for data component ${data.stix.id}`);
      }
    }

    // Build outbound embedded_relationship for data source reference
    // Cross-repository READS are allowed for denormalization (see EVENT_BUS_ARCHITECTURE.md)
    const newDataSourceRef = data.stix?.x_mitre_data_source_ref;
    const oldDataSourceRef = previousVersion?.stix?.x_mitre_data_source_ref;

    // Detect changes for event emission
    if (previousVersion) {
      if (oldDataSourceRef && !newDataSourceRef) {
        // Data source reference was removed in this version
        this._removedDataSourceRef = oldDataSourceRef;
      } else if (!oldDataSourceRef && newDataSourceRef) {
        // Data source reference was added in this version
        this._addedDataSourceRef = newDataSourceRef;
      } else if (oldDataSourceRef && newDataSourceRef && oldDataSourceRef !== newDataSourceRef) {
        // Data source reference changed
        this._removedDataSourceRef = oldDataSourceRef;
        this._addedDataSourceRef = newDataSourceRef;
      }
    }

    if (newDataSourceRef) {
      const dataSource = await dataSourcesRepository.retrieveLatestByStixId(newDataSourceRef);
      if (!dataSource) {
        throw new Exceptions.NotFoundError({
          objectType: 'x-mitre-data-source',
          objectId: newDataSourceRef,
          message: `Cannot create data component: Referenced data source ${newDataSourceRef} does not exist`,
        });
      }

      // Add outbound embedded_relationship
      data.workspace.embedded_relationships.push({
        stix_id: newDataSourceRef,
        attack_id: dataSource.workspace?.attack_id || null,
        direction: 'outbound',
      });

      logger.debug(
        `Built outbound embedded relationship for data component to data source ${newDataSourceRef}`,
      );
    }
  }

  /**
   * Lifecycle hook: Handle post-creation side effects
   * Emits domain events to notify DataSourcesService about referenced/removed data sources
   * This handles both first-time creation and new version creation (versioning)
   *
   * @param {Object} createdDocument - The created data component document
   * @param {Object} _options - Creation options (unused)
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async afterCreate(createdDocument, _options) {
    const addedRef = this._addedDataSourceRef;
    const removedRef = this._removedDataSourceRef;

    // Emit event for newly referenced data source
    if (addedRef) {
      logger.info(
        `DataComponentsService: Emitting data-source-referenced event for data source ${addedRef}`,
        { stixId: createdDocument.stix.id, dataSourceId: addedRef },
      );

      await EventBus.emit('x-mitre-data-component::data-source-referenced', {
        dataComponentId: createdDocument.stix.id,
        dataComponent: createdDocument.toObject ? createdDocument.toObject() : createdDocument,
        dataSourceId: addedRef,
      });
    }

    // Emit event for removed data source (when creating a new version without the reference)
    if (removedRef) {
      logger.info(
        `DataComponentsService: Emitting data-source-removed event for data source ${removedRef}`,
        { stixId: createdDocument.stix.id, dataSourceId: removedRef },
      );

      await EventBus.emit('x-mitre-data-component::data-source-removed', {
        dataComponentId: createdDocument.stix.id,
        dataSourceId: removedRef,
      });
    }

    // If no changes detected but there is a current reference, emit referenced event
    // (this handles the case where this is the first version being created)
    const currentDataSourceRef = createdDocument.stix?.x_mitre_data_source_ref;
    if (!addedRef && !removedRef && currentDataSourceRef) {
      logger.info(
        `DataComponentsService: Emitting data-source-referenced event for data source ${currentDataSourceRef}`,
        { stixId: createdDocument.stix.id, dataSourceId: currentDataSourceRef },
      );

      await EventBus.emit('x-mitre-data-component::data-source-referenced', {
        dataComponentId: createdDocument.stix.id,
        dataComponent: createdDocument.toObject ? createdDocument.toObject() : createdDocument,
        dataSourceId: currentDataSourceRef,
      });
    }

    // Clean up instance variables
    delete this._addedDataSourceRef;
    delete this._removedDataSourceRef;
  }

  /**
   * Lifecycle hook: Prepare data component data before update persistence
   * - Rebuilds outbound embedded_relationship for data source
   * - Preserves inbound relationships from analytics
   * - Validates that the referenced data source exists
   * - Detects changes in data source reference for event emission
   *
   * @param {string} stixId - STIX ID of the data component being updated
   * @param {string} stixModified - Modified timestamp of the version being updated
   * @param {Object} data - Updated data component data
   * @param {Object} existingDocument - The existing data component document
   * @throws {Exceptions.NotFoundError} If the referenced data source does not exist
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

    // Validate that the referenced data source exists and build outbound relationship
    const newDataSourceRef = data.stix?.x_mitre_data_source_ref;

    // Preserve existing non-data-source embedded relationships (e.g., inbound from analytics)
    const existingNonDataSourceRels = (data.workspace.embedded_relationships || []).filter(
      (rel) => !rel.stix_id?.startsWith('x-mitre-data-source--'),
    );

    // Build new outbound embedded relationship for data source
    const dataSourceEmbeddedRel = [];
    if (newDataSourceRef) {
      const dataSource = await dataSourcesRepository.retrieveLatestByStixId(newDataSourceRef);
      if (!dataSource) {
        throw new Exceptions.NotFoundError({
          objectType: 'x-mitre-data-source',
          objectId: newDataSourceRef,
          message: `Cannot update data component: Referenced data source ${newDataSourceRef} does not exist`,
        });
      }

      // Add outbound embedded_relationship
      dataSourceEmbeddedRel.push({
        stix_id: newDataSourceRef,
        attack_id: dataSource.workspace?.attack_id || null,
        direction: 'outbound',
      });
    }

    // Rebuild embedded_relationships: preserve inbound relationships, rebuild outbound data source relationship
    data.workspace.embedded_relationships = [
      ...existingNonDataSourceRels,
      ...dataSourceEmbeddedRel,
    ];

    // Detect changes in data source reference for event emission
    const oldDataSourceRef = existingDocument.stix?.x_mitre_data_source_ref;

    // Determine what changed
    if (oldDataSourceRef && !newDataSourceRef) {
      // Data source removed (set to null/undefined)
      this._removedDataSourceRef = oldDataSourceRef;
    } else if (!oldDataSourceRef && newDataSourceRef) {
      // Data source added
      this._addedDataSourceRef = newDataSourceRef;
    } else if (oldDataSourceRef && newDataSourceRef && oldDataSourceRef !== newDataSourceRef) {
      // Data source changed
      this._removedDataSourceRef = oldDataSourceRef;
      this._addedDataSourceRef = newDataSourceRef;
    }
  }

  /**
   * Lifecycle hook: Handle post-update side effects
   * Emits domain events for added/removed data source references
   *
   * @param {Object} updatedDocument - The updated data component document
   * @param {Object} _previousDocument - The previous version of the data component (unused)
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async afterUpdate(updatedDocument, _previousDocument) {
    const addedRef = this._addedDataSourceRef;
    const removedRef = this._removedDataSourceRef;

    // Emit event for newly referenced data source
    if (addedRef) {
      logger.info(
        `DataComponentsService: Emitting data-source-referenced event for data source ${addedRef}`,
        { stixId: updatedDocument.stix.id, dataSourceId: addedRef },
      );

      await EventBus.emit('x-mitre-data-component::data-source-referenced', {
        dataComponentId: updatedDocument.stix.id,
        dataComponent: updatedDocument.toObject ? updatedDocument.toObject() : updatedDocument,
        dataSourceId: addedRef,
      });
    }

    // Emit event for removed data source
    if (removedRef) {
      logger.info(
        `DataComponentsService: Emitting data-source-removed event for data source ${removedRef}`,
        { stixId: updatedDocument.stix.id, dataSourceId: removedRef },
      );

      await EventBus.emit('x-mitre-data-component::data-source-removed', {
        dataComponentId: updatedDocument.stix.id,
        dataSourceId: removedRef,
      });
    }

    // Clean up instance variables
    delete this._addedDataSourceRef;
    delete this._removedDataSourceRef;
  }
}

DataComponentsService.initializeEventListeners();

module.exports = new DataComponentsService(DataComponentType, dataComponentsRepository);
