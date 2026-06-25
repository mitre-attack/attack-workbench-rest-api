'use strict';

const collectionIndexService = require('../services/stix/collection-indexes-service');
const logger = require('../lib/logger');
const { DuplicateIdError, BadlyFormattedParameterError } = require('../exceptions');

exports.retrieveAll = async function (req, res) {
  const options = {
    offset: req.query.offset || 0,
    limit: req.query.limit || 0,
  };

  try {
    const results = await collectionIndexService.retrieveAll(options);
    logger.debug(`Success: Retrieved ${results.length} collectionIndex(es)`);
    return res.status(200).send(results);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get collection indexes. Server error.');
  }
};

exports.retrieveById = async function (req, res) {
  // Get the id from the request
  const id = req.params.id;

  try {
    const collectionIndex = await collectionIndexService.retrieveById(id);
    if (collectionIndex) {
      return res.status(200).send(collectionIndex);
    } else {
      return res.status(404).send('Collection Index not found.');
    }
  } catch (err) {
    if (err instanceof BadlyFormattedParameterError) {
      logger.warn('Badly formatted id: ' + id);
      return res.status(400).send('Id is badly formatted.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to get collection index. Server error.');
    }
  }
};

exports.create = async function (req, res) {
  // Get the data from the request
  const collectionIndexData = req.body;

  // The collection index must have an id.
  if (!collectionIndexData.collection_index.id) {
    logger.warn('Create collection index failed: Missing id');
    return res.status(400).send('Unable to create collection index. Missing id.');
  }

  // Create the collection index
  try {
    const collectionIndex = await collectionIndexService.create(collectionIndexData);
    logger.debug(
      'Success: Created collection index with id ' + collectionIndex.collection_index.id,
    );
    return res.status(201).send(collectionIndex);
  } catch (err) {
    if (err instanceof DuplicateIdError) {
      logger.warn('Create collection index failed: Duplicate id');
      return res.status(409).send('Unable to create collection index. Duplicate id.');
    } else {
      logger.error('Create collection index failed with error: ' + err);
      return res.status(500).send('Unable to create collection index. Server error.');
    }
  }
};

exports.updateFull = async function (req, res) {
  // Get the data and id from the request
  const collectionIndexData = req.body;
  const id = req.params.id;

  if (!id) {
    logger.error('Update collection index failed with error: Missing id');
    return res.status(400).send('Unable to update collection index. Missing id.');
  }

  try {
    const collectionIndex = await collectionIndexService.updateFull(id, collectionIndexData);
    if (collectionIndex) {
      logger.debug('Success: Updated collection index.');
      return res.status(200).send(collectionIndex);
    } else {
      return res.status(404).send('Collection index not found.');
    }
  } catch (err) {
    logger.error('Update collection index failed with error: ' + err);
    return res.status(500).send('Unable to update collection index. Server error.');
  }
};

exports.delete = async function (req, res) {
  // Get the id from the request
  const id = req.params.id;

  if (!id) {
    logger.error('Delete collection index failed with error: Missing id');
    return res.status(400).send('Unable to delete collection index. Missing id.');
  }

  // Delete the collection index
  try {
    const collectionIndex = await collectionIndexService.delete(id);
    if (collectionIndex) {
      logger.debug('Success: Deleted collection index.');
      return res.status(204).end();
    } else {
      return res.status(404).send('Collection index not found.');
    }
  } catch (err) {
    logger.error('Delete collection index failed with error: ' + err);
    return res.status(500).send('Unable to delete collection index. Server error.');
  }
};

exports.refresh = async function (req, res) {
  const id = req.params.id;

  if (!id) {
    logger.warn('Refresh collection index failed with error: Missing id');
    return res.status(400).send('Unable to refresh collection index. Missing id.');
  }

  try {
    const collectionIndex = await collectionIndexService.refresh(id);
    logger.debug('Success: Refreshed collection index');
    return res.status(200).send(collectionIndex);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to refresh collection index. Server error.');
  }
};
