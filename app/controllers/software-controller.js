'use strict';

const softwareService = require('../services/stix/software-service');
const logger = require('../lib/logger');
const {
  DuplicateIdError,
  BadlyFormattedParameterError,
  InvalidQueryStringParameterError,
  PropertyNotAllowedError,
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
    const results = await softwareService.retrieveAll(options);
    if (options.includePagination) {
      logger.debug(
        `Success: Retrieved ${results.data.length} of ${results.pagination.total} total software`,
      );
    } else {
      logger.debug(`Success: Retrieved ${results.length} software`);
    }
    return res.status(200).send(results);
  } catch (err) {
    console.log('retrieve all error');
    console.log(err);
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get software. Server error.');
  }
};

exports.retrieveById = async function (req, res) {
  const options = {
    versions: req.query.versions || 'latest',
  };
  try {
    const software = await softwareService.retrieveById(req.params.stixId, options);
    if (software.length === 0) {
      return res.status(404).send('Software not found.');
    } else {
      logger.debug(`Success: Retrieved ${software.length} software with id ${req.params.stixId}`);
      return res.status(200).send(software);
    }
  } catch (err) {
    if (err instanceof BadlyFormattedParameterError) {
      logger.warn('Badly formatted stix id: ' + req.params.stixId);
      return res.status(400).send('Stix id is badly formatted.');
    } else if (err instanceof InvalidQueryStringParameterError) {
      logger.warn('Invalid query string: versions=' + req.query.versions);
      return res.status(400).send('Query string parameter versions is invalid.');
    } else {
      console.log('retrieve by id error');
      console.log(err);
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to get software. Server error.');
    }
  }
};

exports.retrieveVersionById = async function (req, res) {
  try {
    const software = await softwareService.retrieveVersionById(
      req.params.stixId,
      req.params.modified,
    );

    if (!software) {
      return res.status(404).send('Software not found.');
    } else {
      logger.debug(`Success: Retrieved software with id ${software.id}`);
      return res.status(200).send(software);
    }
  } catch (err) {
    if (err instanceof BadlyFormattedParameterError) {
      logger.warn('Badly formatted stix id: ' + req.params.stixId);
      return res.status(400).send('Stix id is badly formatted.');
    } else {
      console.log('retrieve version by id error');
      console.log(err);
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to get software. Server error.');
    }
  }
};

exports.create = async function (req, res) {
  // Get the data from the request
  const softwareData = req.body;

  const options = {
    import: false,
    userAccountId: req.user?.userAccountId,
  };

  // Create the software
  try {
    const software = await await softwareService.create(softwareData, options);
    logger.debug('Success: Created software with id ' + software.stix.id);
    return res.status(201).send(software);
  } catch (err) {
    if (err instanceof DuplicateIdError) {
      logger.warn('Duplicate stix.id and stix.modified');
      return res
        .status(409)
        .send('Unable to create software. Duplicate stix.id and stix.modified properties.');
    } else if (err instanceof PropertyNotAllowedError) {
      logger.warn(`Unable to create software, property ${err.propertyName} is not allowed`);
      return res
        .status(400)
        .send(`Unable to create software, property ${err.propertyName} is not allowed`);
    } else {
      console.log('create error');
      console.log(err);
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to create software. Server error.');
    }
  }
};

exports.updateFull = async function (req, res) {
  // Get the data from the request
  const softwareData = req.body;

  try {
    // Create the software
    const software = await softwareService.updateFull(
      req.params.stixId,
      req.params.modified,
      softwareData,
    );

    if (!software) {
      return res.status(404).send('Software not found.');
    } else {
      logger.debug('Success: Updated software with id ' + software.stix.id);
      return res.status(200).send(software);
    }
  } catch (err) {
    console.log('update full error');
    console.log(err);
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to update software. Server error.');
  }
};

exports.deleteVersionById = async function (req, res) {
  try {
    const software = await softwareService.deleteVersionById(
      req.params.stixId,
      req.params.modified,
    );

    if (!software) {
      return res.status(404).send('Software not found.');
    } else {
      logger.debug('Success: Deleted software with id ' + software.stix.id);
      return res.status(204).end();
    }
  } catch (err) {
    console.log('delete version by id error');
    console.log(err);
    logger.error('Delete software failed. ' + err);
    return res.status(500).send('Unable to delete software. Server error.');
  }
};

exports.deleteById = async function (req, res) {
  try {
    const softwares = await softwareService.deleteById(req.params.stixId);

    if (softwares.deletedCount === 0) {
      return res.status(404).send('Software not found.');
    } else {
      logger.debug(`Success: Deleted software with id ${req.params.stixId}`);
      return res.status(204).end();
    }
  } catch (err) {
    console.log('delete by id error');
    console.log(err);
    logger.error('Delete software failed. ' + err);
    return res.status(500).send('Unable to delete software. Server error.');
  }
};
