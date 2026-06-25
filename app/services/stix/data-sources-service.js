'use strict';

const dataSourcesRepository = require('../../repository/data-sources-repository');
const dataComponentsRepository = require('../../repository/data-components-repository');
const { BaseService } = require('../meta-classes');
const { DataSource: DataSourceType } = require('../../lib/types');
const EventBus = require('../../lib/event-bus');
const logger = require('../../lib/logger');

/**
 * Service for managing data sources
 *
 * Event listeners:
 * - x-mitre-data-component::data-source-referenced - Add inbound relationships when data component references data source
 * - x-mitre-data-component::data-source-removed - Remove inbound relationships when data component removes data source reference
 *
 * The retrieveDataComponents query parameter is handled by building the relationship
 * from workspace.embedded_relationships which are maintained via the event-driven architecture.
 */
class DataSourcesService extends BaseService {
  /**
   * Initialize event listeners
   * Called once on app startup
   */
  static initializeEventListeners() {
    EventBus.on(
      'x-mitre-data-component::data-source-referenced',
      this.handleDataSourceReferenced.bind(this),
    );

    EventBus.on(
      'x-mitre-data-component::data-source-removed',
      this.handleDataSourceRemoved.bind(this),
    );

    logger.info('DataSourcesService: Event listeners initialized');
  }

  /**
   * Handle data source being referenced by a data component
   * Add inbound embedded_relationship
   *
   * @param {Object} payload - Event payload
   * @param {Object} payload.dataComponent - The data component document that references the data source
   * @param {string} payload.dataSourceId - Data source STIX ID being referenced
   * @returns {Promise<void>}
   */
  static async handleDataSourceReferenced(payload) {
    const { dataComponent, dataSourceId } = payload;

    logger.info(
      `DataSourcesService heard event: 'x-mitre-data-component::data-source-referenced' for ${dataComponent.stix.id}`,
    );

    try {
      const dataSource = await dataSourcesRepository.retrieveLatestByStixId(dataSourceId);

      if (!dataSource) {
        logger.warn(
          `DataSourcesService: Could not find data source ${dataSourceId} to add inbound relationship`,
        );
        return;
      }

      // Initialize embedded_relationships if needed
      if (!dataSource.workspace) {
        dataSource.workspace = {};
      }
      if (!dataSource.workspace.embedded_relationships) {
        dataSource.workspace.embedded_relationships = [];
      }

      // Check if relationship already exists
      const exists = dataSource.workspace.embedded_relationships.some(
        (rel) => rel.stix_id === dataComponent.stix.id && rel.direction === 'inbound',
      );

      if (!exists) {
        // Add inbound embedded_relationship
        dataSource.workspace.embedded_relationships.push({
          stix_id: dataComponent.stix.id,
          attack_id: dataComponent.workspace?.attack_id || null,
          direction: 'inbound',
        });

        logger.info(
          `DataSourcesService: Added inbound relationship from data component ${dataComponent.stix.id} to data source ${dataSourceId}`,
        );
      }

      await dataSourcesRepository.saveDocument(dataSource);
    } catch (error) {
      logger.error(
        `DataSourcesService: Error handling data-source-referenced for ${dataSourceId}:`,
        error,
      );
    }
  }

  /**
   * Handle data source being removed from a data component
   * Remove inbound embedded_relationship
   *
   * @param {Object} payload - Event payload
   * @param {string} payload.dataComponentId - STIX ID of the data component
   * @param {string} payload.dataSourceId - Data source STIX ID being removed
   * @returns {Promise<void>}
   */
  static async handleDataSourceRemoved(payload) {
    const { dataComponentId, dataSourceId } = payload;

    logger.info(
      `DataSourcesService heard event: 'x-mitre-data-component::data-source-removed' for data component ${dataComponentId}`,
    );

    try {
      const dataSource = await dataSourcesRepository.retrieveLatestByStixId(dataSourceId);

      if (!dataSource) {
        logger.warn(
          `DataSourcesService: Could not find data source ${dataSourceId} to remove inbound relationship`,
        );
        return;
      }

      if (dataSource.workspace?.embedded_relationships) {
        // Remove inbound embedded_relationship
        const initialLength = dataSource.workspace.embedded_relationships.length;
        dataSource.workspace.embedded_relationships =
          dataSource.workspace.embedded_relationships.filter(
            (rel) => !(rel.stix_id === dataComponentId && rel.direction === 'inbound'),
          );

        const removed = dataSource.workspace.embedded_relationships.length < initialLength;
        if (removed) {
          logger.info(
            `DataSourcesService: Removed inbound relationship from data component ${dataComponentId} to data source ${dataSourceId}`,
          );
        }
      }

      await dataSourcesRepository.saveDocument(dataSource);
    } catch (error) {
      logger.error(
        `DataSourcesService: Error handling data-source-removed for ${dataSourceId}:`,
        error,
      );
    }
  }

  /**
   * Retrieve data sources by STIX ID
   * If retrieveDataComponents is true, populate dataComponents array from embedded_relationships
   *
   * @param {string} stixId - The STIX ID of the data source
   * @param {Object} options - Query options
   * @param {string} [options.versions='latest'] - Which versions to retrieve
   * @param {boolean} [options.retrieveDataComponents=false] - Include related data components
   * @returns {Promise<Array>} Array of data source versions
   */
  async retrieveById(stixId, options) {
    const dataSources = await super.retrieveById(stixId, options);

    // If retrieveDataComponents is requested, build the dataComponents array from embedded_relationships
    if (options.retrieveDataComponents && dataSources.length > 0) {
      for (const dataSource of dataSources) {
        await this.populateDataComponents(dataSource);
      }
    }

    return dataSources;
  }

  /**
   * Retrieve a specific version of a data source
   * If retrieveDataComponents is true, populate dataComponents array from embedded_relationships
   *
   * @param {string} stixId - The STIX ID of the data source
   * @param {string} modified - The modified timestamp of the version
   * @param {Object} options - Query options
   * @param {boolean} [options.retrieveDataComponents=false] - Include related data components
   * @returns {Promise<Object|null>} The data source document or null
   */
  async retrieveVersionById(stixId, modified, options) {
    const dataSource = await super.retrieveVersionById(stixId, modified);

    // If retrieveDataComponents is requested, build the dataComponents array from embedded_relationships
    if (options.retrieveDataComponents && dataSource) {
      await this.populateDataComponents(dataSource);
    }

    return dataSource;
  }

  /**
   * Populate the dataComponents array on a data source from its embedded_relationships
   * This retrieves the full data component documents for each inbound relationship
   *
   * @param {Object} dataSource - The data source document
   * @returns {Promise<void>}
   */
  async populateDataComponents(dataSource) {
    // Get inbound data component relationships from embedded_relationships
    const dataComponentRels =
      dataSource.workspace?.embedded_relationships?.filter(
        (rel) => rel.direction === 'inbound' && rel.stix_id?.startsWith('x-mitre-data-component--'),
      ) || [];

    // Fetch the full data component documents
    const dataComponents = [];
    for (const rel of dataComponentRels) {
      try {
        const dataComponent = await dataComponentsRepository.retrieveLatestByStixId(rel.stix_id);
        if (dataComponent) {
          // Add identity information to data component
          await this.addCreatedByAndModifiedByIdentities(dataComponent);
          dataComponents.push(dataComponent.toObject ? dataComponent.toObject() : dataComponent);
        } else {
          logger.warn(
            `DataSourcesService: Could not find data component ${rel.stix_id} referenced in embedded_relationships`,
          );
        }
      } catch (error) {
        logger.error(`DataSourcesService: Error fetching data component ${rel.stix_id}:`, error);
      }
    }

    // Attach the populated dataComponents array to the data source
    // This is a transient property, not persisted to the database
    if (dataSource.toObject) {
      // For Mongoose documents
      const obj = dataSource.toObject();
      obj.dataComponents = dataComponents;
      Object.assign(dataSource, obj);
    } else {
      // For plain objects
      dataSource.dataComponents = dataComponents;
    }

    logger.debug(
      `Populated ${dataComponents.length} data component(s) for data source ${dataSource.stix.id}`,
    );
  }
}

DataSourcesService.initializeEventListeners();

module.exports = new DataSourcesService(DataSourceType, dataSourcesRepository);
