'use strict';

const uuid = require('uuid');

const systemConfigurationService = require('../../system/system-configuration-service');
const collectionsService = require('../collections-service');
const notesService = require('../../system/notes-service');
const linkById = require('../../../lib/linkById');
const logger = require('../../../lib/logger');

const { errors } = require('./bundle-helpers');

/**
 * Creates a bundle containing the collection and its contents
 * @param {Object} collection - The collection to export
 * @param {Object} options - Export options
 * @returns {Promise<Object>} The created bundle
 */
async function createBundle(collection, options) {
  // Create the bundle to hold the exported objects
  const bundle = {
    type: 'bundle',
    id: `bundle--${uuid.v4()}`,
    objects: [],
  };

  // Put the collection object in the bundle
  bundle.objects.push(collection.stix);

  // The attackObjectMap maps attack IDs to attack objects for efficient LinkById conversion
  const attackObjectMap = new Map();

  // Put the contents in the bundle
  for (const attackObject of collection.contents) {
    // Add the object to the attack map
    const attackId = linkById.getAttackId(attackObject.stix);
    if (attackId) {
      attackObjectMap.set(attackId, attackObject);
    }

    // Add it to the bundle
    bundle.objects.push(attackObject.stix);
  }

  await addDerivedDataSources(bundle.objects);
  if (options.includeNotes) {
    await notesService.addNotes(bundle.objects);
  }
  await convertLinkedById(bundle.objects, attackObjectMap);

  if (!options.previewOnly) {
    const exportData = {
      export_timestamp: new Date(),
      bundle_id: bundle.id,
    };
    // Mark all objects as belonging to the bundle
    await collectionsService.insertExport(collection.stix.id, collection.stix.modified, exportData);
  }

  return bundle;
}

/**
 * Adds derived data sources to techniques in the bundle
 * @param {Array<Object>} bundleObjects - Objects in the bundle
 * @returns {Promise<void>}
 */
async function addDerivedDataSources(bundleObjects) {
  // Get the data components, data sources, and techniques detected by data components
  const dataComponents = new Map();
  const dataSources = new Map();
  const techniqueDetectedBy = new Map();

  // Build maps of objects and relationships
  for (const bundleObject of bundleObjects) {
    if (bundleObject.type === 'x-mitre-data-component') {
      dataComponents.set(bundleObject.id, bundleObject);
    } else if (bundleObject.type === 'x-mitre-data-source') {
      dataSources.set(bundleObject.id, bundleObject);
    } else if (
      bundleObject.type === 'relationship' &&
      bundleObject.relationship_type === 'detects'
    ) {
      // technique (target_ref) detected by array of data-component (source_ref)
      const techniqueDataComponents = techniqueDetectedBy.get(bundleObject.target_ref) || [];
      techniqueDataComponents.push(bundleObject.source_ref);
      techniqueDetectedBy.set(bundleObject.target_ref, techniqueDataComponents);
    }
  }

  // Get allowed ICS data source values
  const icsDataSourceValues =
    await systemConfigurationService.retrieveAllowedValuesForTypePropertyDomain(
      'technique',
      'x_mitre_data_sources',
      'ics-attack',
    );

  // Process techniques
  for (const bundleObject of bundleObjects) {
    if (bundleObject.type === 'attack-pattern') {
      const enterpriseDomain = bundleObject.x_mitre_domains?.includes('enterprise-attack');
      const icsDomain = bundleObject.x_mitre_domains?.includes('ics-attack');

      processTechniqueDataSources(
        bundleObject,
        enterpriseDomain,
        icsDomain,
        techniqueDetectedBy,
        dataComponents,
        dataSources,
        icsDataSourceValues,
      );
    }
  }
}

/**
 * Processes data sources for a technique based on its domains
 * @param {Object} technique - The technique to process
 * @param {boolean} enterpriseDomain - Whether technique is in enterprise domain
 * @param {boolean} icsDomain - Whether technique is in ICS domain
 * @param {Map} techniqueDetectedBy - Map of techniques to detecting components
 * @param {Map} dataComponents - Map of data components
 * @param {Map} dataSources - Map of data sources
 * @param {Object} icsDataSourceValues - Allowed ICS data source values
 */
function processTechniqueDataSources(
  technique,
  enterpriseDomain,
  icsDomain,
  techniqueDetectedBy,
  dataComponents,
  dataSources,
  icsDataSourceValues,
) {
  if (enterpriseDomain && !icsDomain) {
    // Enterprise-only: Use derived data sources
    technique.x_mitre_data_sources = [];
    addDerivedEnterpriseSources(technique, techniqueDetectedBy, dataComponents, dataSources);
  } else if (icsDomain && !enterpriseDomain) {
    // ICS-only: Filter to valid ICS sources
    filterToValidIcsSources(technique, icsDataSourceValues);
  } else if (enterpriseDomain && icsDomain) {
    // Both domains: Filter ICS and add enterprise
    filterToValidIcsSources(technique, icsDataSourceValues);
    addDerivedEnterpriseSources(technique, techniqueDetectedBy, dataComponents, dataSources);
  } else {
    // Neither domain: Clear sources
    technique.x_mitre_data_sources = [];
  }
}

/**
 * Adds derived enterprise data sources to a technique
 * @param {Object} technique - The technique to update
 * @param {Map} techniqueDetectedBy - Map of techniques to detecting components
 * @param {Map} dataComponents - Map of data components
 * @param {Map} dataSources - Map of data sources
 */
function addDerivedEnterpriseSources(technique, techniqueDetectedBy, dataComponents, dataSources) {
  const dataComponentIds = techniqueDetectedBy.get(technique.id) || [];
  for (const dataComponentId of dataComponentIds) {
    const dataComponent = dataComponents.get(dataComponentId);
    if (!dataComponent) {
      logger.warn(`Referenced data component not found: ${dataComponentId}`);
      continue;
    }

    const dataSource = dataSources.get(dataComponent.x_mitre_data_source_ref);
    if (!dataSource) {
      logger.warn(`Referenced data source not found: ${dataComponent.x_mitre_data_source_ref}`);
      continue;
    }

    const derivedDataSource = `${dataSource.name}: ${dataComponent.name}`;
    technique.x_mitre_data_sources.push(derivedDataSource);
  }
}

/**
 * Filters a technique's data sources to only valid ICS sources
 * @param {Object} technique - The technique to filter
 * @param {Object} icsDataSourceValues - Allowed ICS data source values
 */
function filterToValidIcsSources(technique, icsDataSourceValues) {
  if (Array.isArray(technique.x_mitre_data_sources)) {
    technique.x_mitre_data_sources = technique.x_mitre_data_sources.filter((source) =>
      icsDataSourceValues.allowedValues.includes(source),
    );
  } else {
    technique.x_mitre_data_sources = [];
  }
}

/**
 * Converts LinkById tags to markdown citations
 * @param {Array<Object>} bundleObjects - Objects in the bundle
 * @param {Map} attackObjectMap - Map of attack objects
 */
async function convertLinkedById(bundleObjects, attackObjectMap) {
  const getAttackObjectFromMap = async function (attackId) {
    return attackObjectMap.get(attackId) || (await linkById.getAttackObjectFromDatabase(attackId));
  };

  for (const bundleObject of bundleObjects) {
    await linkById.convertLinkByIdTags(bundleObject, getAttackObjectFromMap);
  }
}

/**
 * Exports a collection as a STIX bundle
 * @param {Object} options - Export options including:
 *   - collectionId: ID of collection to export
 *   - collectionModified: Modified timestamp for specific version
 *   - includeNotes: Whether to include related notes
 *   - previewOnly: Whether to only preview without saving
 * @returns {Promise<Object>} The exported bundle
 * @throws {Error} If collection not found or other error occurs
 */
module.exports = async function exportBundle(options) {
  if (options.collectionModified) {
    // Retrieve specific version of collection
    const retrievalOptions = { retrieveContents: true };
    const collection = await collectionsService.retrieveVersionById(
      options.collectionId,
      options.collectionModified,
      retrievalOptions,
    );

    if (!collection) {
      throw new Error(errors.notFound);
    }

    return await createBundle(collection, options);
  } else {
    // Retrieve latest version of collection
    const retrievalOptions = {
      versions: 'latest',
      retrieveContents: true,
    };
    const collections = await collectionsService.retrieveById(
      options.collectionId,
      retrievalOptions,
    );

    if (collections.length === 1) {
      return await createBundle(collections[0], options);
    } else if (collections.length === 0) {
      throw new Error(errors.notFound);
    } else {
      throw new Error('Unknown error occurred');
    }
  }
};
