'use strict';

const mitigationsService = require('../services/stix/mitigations-service');
const logger = require('../lib/logger');
const {
  DuplicateIdError,
  BadlyFormattedParameterError,
  InvalidQueryStringParameterError,
} = require('../exceptions');

exports.retrieveAll = async function (req, res) {
  const options = {
    offset: req.query.offset || 0,
    limit: req.query.limit || 0,
    domain: req.query.domain,
    state: req.query.state,
    includeRevoked: req.query.includeRevoked,
    includeDeprecated: req.query.includeDeprecated,
    search: req.query.search,
    lastUpdatedBy: req.query.lastUpdatedBy,
    includePagination: req.query.includePagination,
  };

  try {
    const results = await mitigationsService.retrieveAll(options);
    if (options.includePagination) {
      logger.debug(
        `Success: Retrieved ${results.data.length} of ${results.pagination.total} total mitigation(s)`,
      );
    } else {
      logger.debug(`Success: Retrieved ${results.length} mitigation(s)`);
    }
    return res.status(200).send(results);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get mitigations. Server error.');
  }
};

exports.retrieveById = async function (req, res) {
  const options = {
    versions: req.query.versions || 'latest',
  };

  try {
    const mitigations = await mitigationsService.retrieveById(req.params.stixId, options);
    if (mitigations.length === 0) {
      return res.status(404).send('Mitigation not found.');
    } else {
      logger.debug(
        `Success: Retrieved ${mitigations.length} mitigation(s) with id ${req.params.stixId}`,
      );
      return res.status(200).send(mitigations);
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
      return res.status(500).send('Unable to get mitigations. Server error.');
    }
  }
};

exports.retrieveVersionById = async function (req, res) {
  try {
    const mitigation = await mitigationsService.retrieveVersionById(
      req.params.stixId,
      req.params.modified,
    );
    if (!mitigation) {
      return res.status(404).send('Mitigation not found.');
    } else {
      logger.debug(`Success: Retrieved mitigation with id ${mitigation.id}`);
      return res.status(200).send(mitigation);
    }
  } catch (err) {
    if (err instanceof BadlyFormattedParameterError) {
      logger.warn('Badly formatted stix id: ' + req.params.stixId);
      return res.status(400).send('Stix id is badly formatted.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to get mitigation. Server error.');
    }
  }
};

exports.create = async function (req, res) {
  // Get the data from the request
  const mitigationData = req.body;
  const options = {
    import: false,
    userAccountId: req.user?.userAccountId,
  };

  // Create the mitigation
  try {
    const mitigation = await mitigationsService.create(mitigationData, options);
    logger.debug('Success: Created mitigation with id ' + mitigation.stix.id);
    return res.status(201).send(mitigation);
  } catch (err) {
    if (err instanceof DuplicateIdError) {
      logger.warn('Duplicate stix.id and stix.modified');
      return res
        .status(409)
        .send('Unable to create mitigation. Duplicate stix.id and stix.modified properties.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to create mitigation. Server error.');
    }
  }
};

exports.updateFull = async function (req, res) {
  // Get the data from the request
  const mitigationData = req.body;

  // Create the mitigation

  try {
    const mitigation = await mitigationsService.updateFull(
      req.params.stixId,
      req.params.modified,
      mitigationData,
    );
    if (!mitigation) {
      return res.status(404).send('Mitigation not found.');
    } else {
      logger.debug('Success: Updated mitigation with id ' + mitigation.stix.id);
      return res.status(200).send(mitigation);
    }
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to update mitigation. Server error.');
  }
};

exports.deleteVersionById = async function (req, res) {
  try {
    const mitigation = await mitigationsService.deleteVersionById(
      req.params.stixId,
      req.params.modified,
    );
    if (!mitigation) {
      return res.status(404).send('Mitigation not found.');
    } else {
      logger.debug('Success: Deleted mitigation with id ' + mitigation.stix.id);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete mitigation failed. ' + err);
    return res.status(500).send('Unable to delete mitigation. Server error.');
  }
};

exports.deleteById = async function (req, res) {
  try {
    const mitigations = await mitigationsService.deleteById(req.params.stixId);
    if (mitigations.deletedCount === 0) {
      return res.status(404).send('Mitigation not found.');
    } else {
      logger.debug(`Success: Deleted mitigation with id ${req.params.stixId}`);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete mitigation failed. ' + err);
    return res.status(500).send('Unable to delete mitigation. Server error.');
  }
};
