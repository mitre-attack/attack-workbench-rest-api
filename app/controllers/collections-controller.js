'use strict';

const collectionsService = require('../services/stix/collections-service');
const logger = require('../lib/logger');
const {
  BadlyFormattedParameterError,
  InvalidQueryStringParameterError,
  DuplicateIdError,
} = require('../exceptions');

exports.retrieveAll = async function (req, res) {
  const options = {
    offset: req.query.offset || 0,
    limit: req.query.limit || 0,
    versions: req.query.versions || 'latest',
    state: req.query.state,
    includeRevoked: req.query.includeRevoked,
    includeDeprecated: req.query.includeDeprecated,
    search: req.query.search,
    lastUpdatedBy: req.query.lastUpdatedBy,
  };
  try {
    const collections = await collectionsService.retrieveAll(options);
    logger.debug(`Success: Retrieved ${collections.length} collection(s)`);
    return res.status(200).send(collections);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get collections. Server error.');
  }
};

exports.retrieveById = async function (req, res) {
  const options = {
    versions: req.query.versions || 'latest',
    retrieveContents: req.query.retrieveContents,
  };

  try {
    const collections = await collectionsService.retrieveById(req.params.stixId, options);
    if (collections.length === 0) {
      return res.status(404).send('Collection not found.');
    } else {
      logger.debug(
        `Success: Retrieved ${collections.length} collection(s) with id ${req.params.stixId}`,
      );
      return res.status(200).send(collections);
    }
  } catch (err) {
    if (err instanceof BadlyFormattedParameterError) {
      logger.warn('Badly formatted stix id: ' + req.params.stixId);
      return res.status(400).send('Stix id is badly formatted.');
    } else if (err instanceof InvalidQueryStringParameterError) {
      logger.warn('Invalid query string: versions=' + req.query.versions);
      return res.status(400).send('Query string parameter versions is invalid.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to get collections. Server error.');
    }
  }
};

/**
 * Stream a collection version with contents
 * Supports both streaming (?stream=true) and regular responses
 */
exports.retrieveVersionById = async function (req, res, next) {
  try {
    const { stixId, modified } = req.params;
    const { retrieveContents, stream } = req.query;

    const options = {
      retrieveContents: retrieveContents === true || retrieveContents === 'true',
    };

    // Use streaming if requested and contents are being retrieved
    // Fix: Check for string 'true' since query params are strings
    if ((stream === true || stream === 'true') && options.retrieveContents) {
      return exports.streamVersionById(req, res, next);
    }

    // Otherwise use regular response
    const collection = await collectionsService.retrieveVersionById(stixId, modified, options);

    if (!collection) {
      return res.status(404).json({
        error: 'Collection version not found',
      });
    }

    res.json(collection);
  } catch (err) {
    next(err);
  }
};

/**
 * Stream collection data using Server-Sent Events (SSE)
 */
exports.streamVersionById = async function (req, res) {
  let heartbeatInterval;

  try {
    const { stixId, modified } = req.params;
    const { retrieveContents } = req.query;

    const options = {
      retrieveContents: retrieveContents === true || retrieveContents === 'true',
    };

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

    // Stream the data
    const stream = collectionsService.streamVersionById(stixId, modified, options);

    for await (const chunk of stream) {
      if (res.destroyed) break; // Check if client disconnected

      const event = `data: ${JSON.stringify(chunk)}\n\n`;
      res.write(event);
    }

    // Send completion event
    if (!res.destroyed) {
      res.write('event: complete\ndata: {}\n\n');
      res.end();
    }
  } catch (err) {
    logger.error('Stream error:', err);

    if (heartbeatInterval) clearInterval(heartbeatInterval);

    if (!res.headersSent) {
      res.status(500).json({ error: 'Stream initialization failed' });
    } else if (!res.destroyed) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
};

exports.create = async function (req, res) {
  // Get the data from the request
  const collectionData = req.body;

  // Create the collection
  const options = {
    addObjectsToCollection: true,
    import: false,
    userAccountId: req.user?.userAccountId,
  };
  try {
    const { savedCollection, insertionErrors } = await collectionsService.create(
      collectionData,
      options,
    );
    logger.debug('Success: Created collection with id ' + savedCollection.stix.id);
    if (insertionErrors.length > 0) {
      logger.info(
        `There were ${insertionErrors.length} errors while marking the objects in the collection.`,
      );
    }
    return res.status(201).send(savedCollection);
  } catch (err) {
    if (err instanceof DuplicateIdError) {
      logger.warn('Duplicate stix.id and stix.modified');
      return res
        .status(409)
        .send('Unable to create collection. Duplicate stix.id and stix.modified properties.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to create collection. Server error.');
    }
  }
};

exports.delete = async function (req, res) {
  try {
    const removedCollections = await collectionsService.delete(
      req.params.stixId,
      req.query.deleteAllContents,
    );
    if (removedCollections.deletedCount === 0) {
      return res.status(404).send('Collection not found.');
    } else {
      logger.debug(`Success: Deleted collection with id ${req.params.stixId}.`);
      return res.status(204).end();
    }
  } catch (error) {
    logger.error('Delete collections failed. ' + error);
    return res.status(500).send('Unable to delete collections. Server error.');
  }
};

exports.deleteVersionById = async function (req, res) {
  try {
    const removedCollection = await collectionsService.deleteVersionById(
      req.params.stixId,
      req.params.modified,
      req.query.deleteAllContents,
    );
    if (!removedCollection) {
      return res.status(404).send('Collection not found.');
    } else {
      logger.debug('Success: Deleted collection with id ' + removedCollection.id);
      return res.status(204).end();
    }
  } catch (error) {
    logger.error('Delete collection failed. ' + error);
    return res.status(500).send('Unable to delete collection. Server error.');
  }
};
