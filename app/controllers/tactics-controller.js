'use strict';

const tacticsService = require('../services/stix/tactics-service');
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
    const results = await tacticsService.retrieveAll(options);

    if (options.includePagination) {
      logger.debug(
        `Success: Retrieved ${results.data.length} of ${results.pagination.total} total tactic(s)`,
      );
    } else {
      logger.debug(`Success: Retrieved ${results.length} tactic(s)`);
    }
    return res.status(200).send(results);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get tactics. Server error.');
  }
};

exports.retrieveById = async function (req, res) {
  const options = {
    versions: req.query.versions || 'latest',
  };

  try {
    const tactics = await tacticsService.retrieveById(req.params.stixId, options);

    if (tactics.length === 0) {
      return res.status(404).send('Tactic not found.');
    } else {
      logger.debug(`Success: Retrieved ${tactics.length} tactic(s) with id ${req.params.stixId}`);
      return res.status(200).send(tactics);
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
      return res.status(500).send('Unable to get tactics. Server error.');
    }
  }
};

exports.retrieveVersionById = async function (req, res) {
  try {
    const tactic = await tacticsService.retrieveVersionById(req.params.stixId, req.params.modified);

    if (!tactic) {
      return res.status(404).send('tactic not found.');
    } else {
      logger.debug(`Success: Retrieved tactic with id ${tactic.id}`);
      return res.status(200).send(tactic);
    }
  } catch (err) {
    if (err instanceof BadlyFormattedParameterError) {
      logger.warn('Badly formatted stix id: ' + req.params.stixId);
      return res.status(400).send('Stix id is badly formatted.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to get tactic. Server error.');
    }
  }
};

exports.create = async function (req, res) {
  // Get the data from the request
  const tacticData = req.body;

  const options = {
    import: false,
    userAccountId: req.user?.userAccountId,
  };

  // Create the tactic
  try {
    const tactic = await tacticsService.create(tacticData, options);

    logger.debug('Success: Created tactic with id ' + tactic.stix.id);
    return res.status(201).send(tactic);
  } catch (err) {
    if (err instanceof DuplicateIdError) {
      logger.warn('Duplicate stix.id and stix.modified');
      return res
        .status(409)
        .send('Unable to create tactic. Duplicate stix.id and stix.modified properties.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to create tactic. Server error.');
    }
  }
};

exports.updateFull = async function (req, res) {
  // Get the data from the request
  const tacticData = req.body;

  try {
    const tactic = await tacticsService.updateFull(
      req.params.stixId,
      req.params.modified,
      tacticData,
    );

    if (!tactic) {
      return res.status(404).send('tactic not found.');
    } else {
      logger.debug('Success: Updated tactic with id ' + tactic.stix.id);
      return res.status(200).send(tactic);
    }
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to update tactic. Server error.');
  }
};

exports.deleteVersionById = async function (req, res) {
  try {
    const tactic = await tacticsService.deleteVersionById(req.params.stixId, req.params.modified);

    if (!tactic) {
      return res.status(404).send('tactic not found.');
    } else {
      logger.debug('Success: Deleted tactic with id ' + tactic.stix.id);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete tactic failed. ' + err);
    return res.status(500).send('Unable to delete tactic. Server error.');
  }
};

exports.deleteById = async function (req, res) {
  try {
    const tactics = await tacticsService.deleteById(req.params.stixId);

    if (tactics.deletedCount === 0) {
      return res.status(404).send('Tactic not found.');
    } else {
      logger.debug(`Success: Deleted tactic with id ${req.params.stixId}`);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete tactic failed. ' + err);
    return res.status(500).send('Unable to delete tactic. Server error.');
  }
};

exports.retrieveTechniquesForTactic = async function (req, res) {
  try {
    const options = {
      offset: req.query.offset || 0,
      limit: req.query.limit || 0,
      includePagination: req.query.includePagination,
    };

    const techniques = await tacticsService.retrieveTechniquesForTactic(
      req.params.stixId,
      req.params.modified,
      options,
    );
    if (!techniques) {
      return res.status(404).send('tactic not found.');
    } else {
      logger.debug(`Success: Retrieved techniques for tactic with id ${req.params.stixId}`);
      return res.status(200).send(techniques);
    }
  } catch (err) {
    if (err instanceof BadlyFormattedParameterError) {
      logger.warn('Badly formatted stix id: ' + req.params.stixId);
      return res.status(400).send('Stix id is badly formatted.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to get techniques for tactic. Server error.');
    }
  }
};
