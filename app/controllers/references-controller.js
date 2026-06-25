'use strict';

const referencesService = require('../services/system/references-service');
const logger = require('../lib/logger');
const { DuplicateIdError } = require('../exceptions');

exports.retrieveAll = async function (req, res) {
  const options = {
    sourceName: req.query.sourceName,
    offset: req.query.offset || 0,
    limit: req.query.limit || 0,
    search: req.query.search,
    includePagination: req.query.includePagination,
  };

  try {
    const results = await referencesService.retrieveAll(options);
    if (options.includePagination) {
      logger.debug(
        `Success: Retrieved ${results.data.length} of ${results.pagination.total} total reference(s)`,
      );
    } else {
      logger.debug(`Success: Retrieved ${results.length} reference(s)`);
    }
    return res.status(200).send(results);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get references. Server error.');
  }
};

exports.create = async function (req, res) {
  // Get the data from the request
  const referenceData = req.body;

  // The open api validator should catch missing properties, but it isn't working for this one endpoint
  if (!referenceData.source_name || !referenceData.description) {
    return res.status(400).send('Unable to create reference. Missing required properties.');
  }

  // Create the reference
  try {
    const reference = await referencesService.create(referenceData);
    logger.debug('Success: Created reference with source_name ' + reference.source_name);
    return res.status(201).send(reference);
  } catch (err) {
    if (err instanceof DuplicateIdError) {
      logger.warn('Duplicate source_name');
      return res.status(409).send('Unable to create reference. Duplicate source_name.');
    } else {
      logger.error('***** Failed with error: ' + err);
      return res.status(500).send('Unable to create reference. Server error.');
    }
  }
};

exports.update = async function (req, res) {
  // Get the data from the request
  const referenceData = req.body;

  // Create the reference
  try {
    const reference = await referencesService.update(referenceData);
    if (!reference) {
      return res.status(404).send('Reference not found.');
    } else {
      logger.debug('Success: Updated reference with source_name ' + reference.source_name);
      return res.status(200).send(reference);
    }
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to update reference. Server error.');
  }
};

exports.deleteBySourceName = async function (req, res) {
  try {
    const reference = await referencesService.deleteBySourceName(req.query.sourceName);
    if (!reference) {
      return res.status(404).send('Reference not found.');
    } else {
      logger.debug(`Success: Deleted reference with source_name ${reference.source_name}`);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete reference failed. ' + err);
    return res.status(500).send('Unable to delete reference. Server error.');
  }
};
