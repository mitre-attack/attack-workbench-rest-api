'use strict';

const analyticsService = require('../services/stix/analytics-service');
const logger = require('../lib/logger');
const { BadlyFormattedParameterError, InvalidQueryStringParameterError } = require('../exceptions');

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
    includeEmbeddedRelationships:
      req.query.includeRefs === 'true' || req.query.includeRefs === true,
  };

  try {
    const results = await analyticsService.retrieveAll(options);
    if (options.includePagination) {
      logger.debug(
        `Success: Retrieved ${results.data.length} of ${results.pagination.total} total analytic(s)`,
      );
    } else {
      logger.debug(`Success: Retrieved ${results.length} analytic(s)`);
    }
    return res.status(200).send(results);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get analytics. Server error.');
  }
};

exports.retrieveById = async function (req, res) {
  const options = {
    versions: req.query.versions || 'latest',
    includeEmbeddedRelationships:
      req.query.includeRefs === 'true' || req.query.includeRefs === true,
  };

  try {
    const analytics = await analyticsService.retrieveById(req.params.stixId, options);
    if (analytics.length === 0) {
      return res.status(404).send('Analytic not found.');
    } else {
      logger.debug(
        `Success: Retrieved ${analytics.length} analytic(s) with id ${req.params.stixId}`,
      );
      return res.status(200).send(analytics);
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
      return res.status(500).send('Unable to get analytics. Server error.');
    }
  }
};

exports.retrieveVersionById = async function (req, res) {
  try {
    const analytic = await analyticsService.retrieveVersionById(
      req.params.stixId,
      req.params.modified,
    );
    if (!analytic) {
      return res.status(404).send('Analytic not found.');
    } else {
      logger.debug(`Success: Retrieved analytic with id ${analytic.id}`);
      return res.status(200).send(analytic);
    }
  } catch (err) {
    if (err instanceof BadlyFormattedParameterError) {
      logger.warn('Badly formatted stix id: ' + req.params.stixId);
      return res.status(400).send('Stix id is badly formatted.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to get analytic. Server error.');
    }
  }
};

exports.create = async function (req, res, next) {
  // Get the data from the request
  const analyticData = req.body;
  const options = {
    import: false,
    userAccountId: req.user?.userAccountId,
  };

  try {
    // Create the analytic
    const analytic = await analyticsService.create(analyticData, options);
    logger.debug('Success: Created analytic with id ' + analytic.stix.id);
    return res.status(201).send(analytic);
  } catch (err) {
    // Pass the error to the service exception middleware
    return next(err);
  }
};

exports.updateFull = async function (req, res, next) {
  // Get the data from the request
  const analyticData = req.body;

  try {
    const analytic = await analyticsService.updateFull(
      req.params.stixId,
      req.params.modified,
      analyticData,
    );
    if (!analytic) {
      return res.status(404).send('Analytic not found.');
    }
    logger.debug('Success: Updated analytic with id ' + analytic.stix.id);
    return res.status(200).send(analytic);
  } catch (err) {
    // Pass the error to the service exception middleware
    return next(err);
  }
};

exports.deleteVersionById = async function (req, res) {
  try {
    const analytic = await analyticsService.deleteVersionById(
      req.params.stixId,
      req.params.modified,
    );
    if (!analytic) {
      return res.status(404).send('Analytic not found.');
    } else {
      logger.debug('Success: Deleted analytic with id ' + analytic.stix.id);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete analytic failed. ' + err);
    return res.status(500).send('Unable to delete analytic. Server error.');
  }
};

exports.deleteById = async function (req, res) {
  try {
    const analytics = await analyticsService.deleteById(req.params.stixId);
    if (analytics.deletedCount === 0) {
      return res.status(404).send('Analytics not found.');
    } else {
      logger.debug(`Success: Deleted analytic with id ${req.params.stixId}`);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete analytic failed. ' + err);
    return res.status(500).send('Unable to delete analytic. Server error.');
  }
};
