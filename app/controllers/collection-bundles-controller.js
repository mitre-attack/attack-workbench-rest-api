'use strict';

const collectionBundlesService = require('../services/stix/collection-bundles-service');
const logger = require('../lib/logger');

const availableForceImportParameters = [
  collectionBundlesService.forceImportParameters.attackSpecVersionViolations,
  collectionBundlesService.forceImportParameters.duplicateCollection,
];

function extractForceImportParameters(req) {
  const params = [];
  if (req.query.forceImport) {
    if (Array.isArray(req.query.forceImport)) {
      params.push(...req.query.forceImport);
    } else {
      params.push(req.query.forceImport);
    }

    if (params.find((param) => param === 'all')) {
      return availableForceImportParameters;
    }
  }

  return params;
}

function createErrorResult() {
  return {
    bundleErrors: {
      noCollection: false,
      moreThanOneCollection: false,
      duplicateCollection: false,
      badlyFormattedCollection: false,
    },
    objectErrors: {
      summary: {
        duplicateObjectInBundleCount: 0,
        invalidAttackSpecVersionCount: 0,
      },
      errors: [],
    },
  };
}

/**
 * Validates the structure of a collection bundle
 * @param {Object} collectionBundleData - The bundle data to validate
 * @returns {Object} Validation result with { errorResult, errorFound, collections }
 */
function validateCollectionBundle(collectionBundleData) {
  const errorResult = createErrorResult();
  let errorFound = false;

  // Find the x-mitre-collection objects
  const collections = collectionBundleData.objects.filter(
    (object) => object.type === 'x-mitre-collection',
  );

  // The bundle must have an x-mitre-collection object
  if (collections.length === 0) {
    logger.warn('Collection bundle is missing x-mitre-collection object.');
    errorResult.bundleErrors.noCollection = true;
    errorFound = true;
  } else if (collections.length > 1) {
    logger.warn('Collection bundle has more than one x-mitre-collection object.');
    errorResult.bundleErrors.moreThanOneCollection = true;
    errorFound = true;
  }

  // The collection must have an id
  if (collections.length > 0 && !collections[0].id) {
    logger.warn('Badly formatted collection in bundle, x-mitre-collection missing id.');
    errorResult.bundleErrors.badlyFormattedCollection = true;
    errorFound = true;
  }

  // Validate bundle content
  const validationResult = collectionBundlesService.validateBundle(collectionBundleData);
  if (validationResult.errors.length > 0) {
    errorFound = true;
    if (validationResult.duplicateObjectInBundleCount > 0) {
      logger.warn(
        `Collection bundle has ${validationResult.duplicateObjectInBundleCount} duplicate objects.`,
      );
      errorResult.objectErrors.summary.duplicateObjectInBundleCount =
        validationResult.duplicateObjectInBundleCount;
    }
    if (validationResult.invalidAttackSpecVersionCount > 0) {
      logger.warn(
        `Collection bundle has ${validationResult.invalidAttackSpecVersionCount} objects with invalid ATT&CK Spec version.`,
      );
      errorResult.objectErrors.summary.invalidAttackSpecVersionCount =
        validationResult.invalidAttackSpecVersionCount;
    }
    errorResult.objectErrors.errors.push(...validationResult.errors);
  }

  return { errorResult, errorFound, collections };
}

/**
 * Checks if validation errors should prevent import
 * @param {Object} errorResult - The error result from validation
 * @param {boolean} errorFound - Whether any errors were found
 * @param {Array} forceImportParameters - Parameters to override validation errors
 * @returns {boolean} True if import should be blocked
 */
function shouldBlockImport(errorResult, errorFound, forceImportParameters) {
  if (!errorFound) {
    return false;
  }

  // These errors do not have forceImport flags yet
  if (
    errorResult.bundleErrors.noCollection ||
    errorResult.bundleErrors.moreThanOneCollection ||
    errorResult.bundleErrors.badlyFormattedCollection ||
    errorResult.objectErrors.summary.duplicateObjectInBundleCount > 0
  ) {
    return true;
  }

  // Check the forceImport flag for overriding ATT&CK Spec version violations
  if (
    errorResult.objectErrors.summary.invalidAttackSpecVersionCount > 0 &&
    !forceImportParameters.find(
      (e) => e === collectionBundlesService.forceImportParameters.attackSpecVersionViolations,
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Stream import progress using Server-Sent Events (SSE)
 */
exports.streamImportBundle = async function (req, res) {
  let heartbeatInterval;

  try {
    const collectionBundleData = req.body;
    const forceImportParameters = extractForceImportParameters(req);

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Heartbeat to prevent connection timeout
    heartbeatInterval = setInterval(() => {
      if (!res.destroyed) {
        res.write(': heartbeat\n\n');
      }
    }, 30000);

    // Handle client disconnect
    req.on('close', () => {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
    });

    // Validate bundle using shared validation logic
    const { errorResult, errorFound, collections } = validateCollectionBundle(collectionBundleData);

    // Check if import should be blocked
    if (shouldBlockImport(errorResult, errorFound, forceImportParameters)) {
      logger.error('Unable to import collection bundle due to an error in the bundle.');
      const event = `event: error\ndata: ${JSON.stringify(errorResult)}\n\n`;
      res.write(event);
      res.end();
      return;
    }

    // Progress callback to send SSE events
    const onProgress = (progress) => {
      if (!res.destroyed) {
        const event = `event: progress\ndata: ${JSON.stringify(progress)}\n\n`;
        res.write(event);
        // Flush immediately to ensure event is sent to client
        if (res.flush && typeof res.flush === 'function') {
          res.flush();
        }
      }
    };

    const options = {
      previewOnly: req.query.previewOnly || req.query.checkOnly,
      forceImportParameters,
      onProgress,
    };

    // Import the collection bundle
    const importedCollection = await collectionBundlesService.importBundle(
      collections[0],
      collectionBundleData,
      options,
    );

    // Send final result
    if (!res.destroyed) {
      const event = `event: complete\ndata: ${JSON.stringify(importedCollection)}\n\n`;
      res.write(event);
      res.end();
    }

    logger.debug('Success: Imported collection with id ' + importedCollection.stix.id);
  } catch (err) {
    logger.error('Import failed with error: ' + err);

    if (heartbeatInterval) clearInterval(heartbeatInterval);

    if (!res.destroyed) {
      const errorData = {
        message: err.message || 'Unknown error',
        error: err.toString(),
      };
      const event = `event: error\ndata: ${JSON.stringify(errorData)}\n\n`;
      res.write(event);
      res.end();
    }
  } finally {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
  }
};

exports.importBundle = async function (req, res) {
  // Get the data from the request
  const collectionBundleData = req.body;
  const forceImportParameters = extractForceImportParameters(req);

  // Validate bundle using shared validation logic
  const { errorResult, errorFound, collections } = validateCollectionBundle(collectionBundleData);

  // Check if import should be blocked
  if (shouldBlockImport(errorResult, errorFound, forceImportParameters)) {
    logger.error('Unable to import collection bundle due to an error in the bundle.');
    return res.status(400).send(errorResult);
  }

  const options = {
    previewOnly: req.query.previewOnly || req.query.checkOnly,
    forceImportParameters,
  };

  // Import the collection bundle
  try {
    const importedCollection = await collectionBundlesService.importBundle(
      collections[0],
      collectionBundleData,
      options,
    );

    if (req.query.checkOnly) {
      logger.debug('Success: Previewed import of collection with id ' + importedCollection.stix.id);
      return res.status(201).send(importedCollection);
    } else {
      logger.debug('Success: Imported collection with id ' + importedCollection.stix.id);
      return res.status(201).send(importedCollection);
    }
  } catch (err) {
    if (err.message === collectionBundlesService.errors.duplicateCollection) {
      errorResult.bundleErrors.duplicateCollection = true;
      logger.error('Unable to import collection, duplicate x-mitre-collection.');
      return res.status(400).send(errorResult);
    } else {
      logger.error(
        'Unable to import collection, create collection index failed with error: ' + err,
      );
      return res
        .status(500)
        .send('Unable to import collection, unable to create collection index. Server error.');
    }
  }
};

exports.exportBundle = async function (req, res) {
  if (req.query.collectionModified && !req.query.collectionId) {
    return res.status(400).send('collectionId is required when providing collectionModified');
  }

  const options = {
    collectionId: req.query.collectionId,
    collectionModified: req.query.collectionModified,
    previewOnly: req.query.previewOnly,
    includeNotes: req.query.includeNotes,
  };

  try {
    const collectionBundle = await collectionBundlesService.exportBundle(options);
    return res.status(200).send(collectionBundle);
  } catch (err) {
    if (err.message === collectionBundlesService.errors.notFound) {
      return res.status(404).send('Collection not found');
    } else {
      logger.error('Unable to export collection: ' + err);
      return res.status(500).send('Unable to export collection.');
    }
  }
};
