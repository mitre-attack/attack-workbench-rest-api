'use strict';

const detectionStrategiesService = require('../services/stix/detection-strategies-service');
const logger = require('../lib/logger');

exports.retrieveAll = async function (req, res, next) {
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
    const results = await detectionStrategiesService.retrieveAll(options);
    if (options.includePagination) {
      logger.debug(
        `Success: Retrieved ${results.data.length} of ${results.pagination.total} total detection strategies`,
      );
    } else {
      logger.debug(`Success: Retrieved ${results.length} detection strategies`);
    }
    return res.status(200).send(results);
  } catch (err) {
    next(err);
  }
};

exports.retrieveById = async function (req, res, next) {
  const options = {
    versions: req.query.versions || 'latest',
  };

  try {
    const detectionStrategies = await detectionStrategiesService.retrieveById(
      req.params.stixId,
      options,
    );
    if (detectionStrategies.length === 0) {
      return res.status(404).send('Detection strategy not found.');
    } else {
      logger.debug(
        `Success: Retrieved ${detectionStrategies.length} detection strategies with id ${req.params.stixId}`,
      );
      return res.status(200).send(detectionStrategies);
    }
  } catch (err) {
    next(err);
  }
};

exports.retrieveVersionById = async function (req, res, next) {
  try {
    const detectionStrategy = await detectionStrategiesService.retrieveVersionById(
      req.params.stixId,
      req.params.modified,
    );
    if (!detectionStrategy) {
      return res.status(404).send('Detection strategy not found.');
    } else {
      logger.debug(`Success: Retrieved detection strategy with id ${detectionStrategy.id}`);
      return res.status(200).send(detectionStrategy);
    }
  } catch (err) {
    next(err);
  }
};

exports.create = async function (req, res, next) {
  // Get the data from the request
  const detectionStrategyData = req.body;
  const options = {
    import: false,
    userAccountId: req.user?.userAccountId,
  };

  // Create the detection strategy
  try {
    const detectionStrategy = await detectionStrategiesService.create(
      detectionStrategyData,
      options,
    );
    logger.debug('Success: Created detection strategy with id ' + detectionStrategy.stix.id);
    return res.status(201).send(detectionStrategy);
  } catch (err) {
    next(err);
  }
};

exports.updateFull = async function (req, res, next) {
  // Get the data from the request
  const detectionStrategyData = req.body;

  // Create the detection strategy
  try {
    const detectionStrategy = await detectionStrategiesService.updateFull(
      req.params.stixId,
      req.params.modified,
      detectionStrategyData,
    );
    if (!detectionStrategy) {
      return res.status(404).send('Detection strategy not found.');
    } else {
      logger.debug('Success: Updated detection strategy with id ' + detectionStrategy.stix.id);
      return res.status(200).send(detectionStrategy);
    }
  } catch (err) {
    next(err);
  }
};

exports.deleteVersionById = async function (req, res, next) {
  try {
    const detectionStrategy = await detectionStrategiesService.deleteVersionById(
      req.params.stixId,
      req.params.modified,
    );
    if (!detectionStrategy) {
      return res.status(404).send('Detection strategy not found.');
    } else {
      logger.debug('Success: Deleted detection strategy with id ' + detectionStrategy.stix.id);
      return res.status(204).end();
    }
  } catch (err) {
    next(err);
  }
};

exports.deleteById = async function (req, res, next) {
  try {
    const detectionStrategies = await detectionStrategiesService.deleteById(req.params.stixId);
    if (detectionStrategies.deletedCount === 0) {
      return res.status(404).send('Detection strategies not found.');
    } else {
      logger.debug(`Success: Deleted detection strategy with id ${req.params.stixId}`);
      return res.status(204).end();
    }
  } catch (err) {
    next(err);
  }
};
