'use strict';

const markingDefinitionsService = require('../services/stix/marking-definitions-service');
const logger = require('../lib/logger');
const {
  BadlyFormattedParameterError,
  CannotUpdateStaticObjectError,
  InvalidQueryStringParameterError,
} = require('../exceptions');

// NOTE: A marking definition does not support the modified or revoked properties!!

exports.retrieveAll = async function (req, res) {
  const options = {
    offset: req.query.offset || 0,
    limit: req.query.limit || 0,
    state: req.query.state,
    includeDeprecated: req.query.includeDeprecated,
    includePagination: req.query.includePagination,
  };
  try {
    const markingDefinitions = await markingDefinitionsService.retrieveAll(options);
    if (options.includePagination) {
      logger.debug(
        `Success: Retrieved ${markingDefinitions.data.length} of ${markingDefinitions.pagination.total} total marking definition(s)`,
      );
    } else {
      logger.debug(`Success: Retrieved ${markingDefinitions.length} marking definition(s)`);
    }
    return res.status(200).send(markingDefinitions);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get marking definitions. Server error.');
  }
};

exports.retrieveById = async function (req, res) {
  const options = {};
  try {
    const markingDefinitions = await markingDefinitionsService.retrieveById(
      req.params.stixId,
      options,
    );
    if (markingDefinitions.length === 0) {
      return res.status(404).send('Marking definitions not found.');
    } else {
      logger.debug(
        `Success: Retrieved ${markingDefinitions.length} marking definition with id ${req.params.stixId}`,
      );
      return res.status(200).send(markingDefinitions);
    }
  } catch (err) {
    if (err instanceof BadlyFormattedParameterError) {
      logger.warn('Badly formatted stix id: ' + req.params.stixId);
      return res.status(400).send('Stix id is badly formatted.');
    } else if (err.message === InvalidQueryStringParameterError) {
      logger.warn('Invalid query string: versions=' + req.query.versions);
      return res.status(400).send('Query string parameter versions is invalid.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to get marking definitions. Server error.');
    }
  }
};

exports.create = async function (req, res) {
  // Get the data from the request
  const markingDefinitionData = req.body;

  // Create the marking definition
  try {
    const options = {
      import: false,
      userAccountId: req.user?.userAccountId,
    };
    const markingDefinition = await markingDefinitionsService.create(
      markingDefinitionData,
      options,
    );
    logger.debug('Success: Created marking definition with id ' + markingDefinition.stix.id);
    return res.status(201).send(markingDefinition);
  } catch (err) {
    if (err instanceof BadlyFormattedParameterError) {
      logger.warn('Unable to create marking definition: Stix id not allowed');
      return res.status(400).send('Stix id not allowed.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to create marking definition. Server error.');
    }
  }
};

exports.updateFull = async function (req, res) {
  // Get the data from the request
  const markingDefinitionData = req.body;

  // Create the marking definition
  try {
    const markingDefinition = await markingDefinitionsService.updateFull(
      req.params.stixId,
      markingDefinitionData,
    );
    if (!markingDefinition) {
      return res.status(404).send('Marking definition not found.');
    } else {
      logger.debug('Success: Updated marking definition with id ' + markingDefinition.stix.id);
      return res.status(200).send(markingDefinition);
    }
  } catch (err) {
    if (err instanceof CannotUpdateStaticObjectError) {
      logger.warn('Unable to update marking definition, cannot update static object');
      return res.status(400).send('Cannot update static object');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to update marking definition. Server error.');
    }
  }
};

exports.delete = async function (req, res) {
  try {
    const markingDefinition = await markingDefinitionsService.delete(req.params.stixId);
    if (!markingDefinition) {
      return res.status(404).send('Marking definition not found.');
    } else {
      logger.debug('Success: Deleted marking definition with id ' + markingDefinition.stix.id);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete marking definition failed. ' + err);
    return res.status(500).send('Unable to delete marking definition. Server error.');
  }
};
