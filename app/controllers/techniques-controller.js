'use strict';

const techniquesService = require('../services/stix/techniques-service');
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
    domain: req.query.domain,
    platform: req.query.platform,
    state: req.query.state,
    includeRevoked: req.query.includeRevoked,
    includeDeprecated: req.query.includeDeprecated,
    search: req.query.search,
    lastUpdatedBy: req.query.lastUpdatedBy,
    includePagination: req.query.includePagination,
  };

  try {
    const results = await techniquesService.retrieveAll(options);
    if (options.includePagination) {
      logger.debug(
        `Success: Retrieved ${results.data.length} of ${results.pagination.total} total technique(s)`,
      );
    } else {
      logger.debug(`Success: Retrieved ${results.length} technique(s)`);
    }
    return res.status(200).send(results);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get techniques. Server error.');
  }
};

exports.retrieveById = async function (req, res) {
  const options = {
    versions: req.query.versions || 'latest',
  };
  try {
    const techniques = await techniquesService.retrieveById(req.params.stixId, options);
    if (techniques.length === 0) {
      return res.status(404).send('Technique not found.');
    } else {
      logger.debug(
        `Success: Retrieved ${techniques.length} technique(s) with id ${req.params.stixId}`,
      );
      return res.status(200).send(techniques);
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
      return res.status(500).send('Unable to get techniques. Server error.');
    }
  }
};

exports.retrieveVersionById = async function (req, res) {
  try {
    const technique = await techniquesService.retrieveVersionById(
      req.params.stixId,
      req.params.modified,
    );
    if (!technique) {
      return res.status(404).send('Technique not found.');
    } else {
      logger.debug(`Success: Retrieved technique with id ${technique.id}`);
      return res.status(200).send(technique);
    }
  } catch (err) {
    if (err instanceof BadlyFormattedParameterError) {
      logger.warn('Badly formatted stix id: ' + req.params.stixId);
      return res.status(400).send('Stix id is badly formatted.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to get technique. Server error.');
    }
  }
};

exports.create = async function (req, res) {
  // Get the data from the request
  const techniqueData = req.body;
  const options = {
    import: false,
    userAccountId: req.user?.userAccountId,
    parentTechniqueId: req.query.parentTechniqueId, // NOTE this is new!
  };

  // Create the technique
  try {
    const technique = await techniquesService.create(techniqueData, options);

    logger.debug('Success: Created technique with id ' + technique.stix.id);
    return res.status(201).send(technique);
  } catch (err) {
    if (err instanceof DuplicateIdError) {
      logger.warn('Duplicate stix.id and stix.modified');
      return res
        .status(409)
        .send('Unable to create technique. Duplicate stix.id and stix.modified properties.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to create technique. Server error.');
    }
  }
};

exports.updateFull = async function (req, res) {
  // Get the data from the request
  const techniqueData = req.body;

  try {
    // Create the technique
    const technique = await techniquesService.updateFull(
      req.params.stixId,
      req.params.modified,
      techniqueData,
    );
    if (!technique) {
      return res.status(404).send('Technique not found.');
    } else {
      logger.debug('Success: Updated technique with id ' + technique.stix.id);
      return res.status(200).send(technique);
    }
  } catch (err) {
    if (err.name === 'ImmutablePropertyError') {
      logger.warn(`Attempt to modify immutable property: ${err.message}`);
      return res.status(400).send(err.message);
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to update technique. Server error.');
    }
  }
};

exports.deleteVersionById = async function (req, res) {
  try {
    const technique = await techniquesService.deleteVersionById(
      req.params.stixId,
      req.params.modified,
    );
    if (!technique) {
      return res.status(404).send('Technique not found.');
    } else {
      logger.debug('Success: Deleted technique with id ' + technique.stix.id);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete technique failed. ' + err);
    return res.status(500).send('Unable to delete technique. Server error.');
  }
};

exports.deleteById = async function (req, res) {
  try {
    const techniques = await techniquesService.deleteById(req.params.stixId);
    if (techniques.deletedCount === 0) {
      return res.status(404).send('Technique not found.');
    } else {
      logger.debug(`Success: Deleted technique with id ${req.params.stixId}`);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete technique failed. ' + err);
    return res.status(500).send('Unable to delete technique. Server error.');
  }
};

exports.retrieveTacticsForTechnique = async function (req, res) {
  try {
    const options = {
      offset: req.query.offset || 0,
      limit: req.query.limit || 0,
      includePagination: req.query.includePagination,
    };

    const tactics = await techniquesService.retrieveTacticsForTechnique(
      req.params.stixId,
      req.params.modified,
      options,
    );
    if (!tactics) {
      return res.status(404).send('Technique not found.');
    } else {
      logger.debug(`Success: Retrieved tactics for technique with id ${req.params.stixId}`);
      return res.status(200).send(tactics);
    }
  } catch (err) {
    if (err instanceof BadlyFormattedParameterError) {
      logger.warn('Badly formatted stix id: ' + req.params.stixId);
      return res.status(400).send('Stix id is badly formatted.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to get tactics for technique. Server error.');
    }
  }
};
