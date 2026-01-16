'use strict';

const identitiesService = require('../services/stix/identities-service');
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
    state: req.query.state,
    includeRevoked: req.query.includeRevoked,
    includeDeprecated: req.query.includeDeprecated,
    includePagination: req.query.includePagination,
  };

  try {
    const results = await identitiesService.retrieveAll(options);
    if (options.includePagination) {
      logger.debug(
        `Success: Retrieved ${results.data.length} of ${results.pagination.total} total identities`,
      );
    } else {
      logger.debug(`Success: Retrieved ${results.length} identities`);
    }
    return res.status(200).send(results);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get identities. Server error.');
  }
};

exports.retrieveById = async function (req, res) {
  const options = {
    versions: req.query.versions || 'latest',
  };

  try {
    const identities = await identitiesService.retrieveById(req.params.stixId, options);
    if (identities.length === 0) {
      return res.status(404).send('Identity not found.');
    } else {
      logger.debug(
        `Success: Retrieved ${identities.length} identities with id ${req.params.stixId}`,
      );
      return res.status(200).send(identities);
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
      return res.status(500).send('Unable to get identities. Server error.');
    }
  }
};

exports.retrieveVersionById = async function (req, res) {
  try {
    const identity = await identitiesService.retrieveVersionById(
      req.params.stixId,
      req.params.modified,
    );
    if (!identity) {
      return res.status(404).send('Identity not found.');
    } else {
      logger.debug(`Success: Retrieved identity with id ${identity.id}`);
      return res.status(200).send(identity);
    }
  } catch (err) {
    if (err instanceof BadlyFormattedParameterError) {
      logger.warn('Badly formatted stix id: ' + req.params.stixId);
      return res.status(400).send('Stix id is badly formatted.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to get identity. Server error.');
    }
  }
};

exports.create = async function (req, res) {
  // Get the data from the request
  const identityData = req.body;

  // Create the identity
  try {
    const options = {
      import: false,
      userAccountId: req.user?.userAccountId,
    };
    const identity = await identitiesService.create(identityData, options);
    logger.debug('Success: Created identity with id ' + identity.stix.id);
    return res.status(201).send(identity);
  } catch (err) {
    if (err instanceof DuplicateIdError) {
      logger.warn('Duplicate stix.id and stix.modified');
      return res
        .status(409)
        .send('Unable to create identity. Duplicate stix.id and stix.modified properties.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to create identity. Server error.');
    }
  }
};

exports.updateFull = async function (req, res) {
  // Get the data from the request
  const identityData = req.body;

  // Create the identity
  try {
    const identity = await identitiesService.updateFull(
      req.params.stixId,
      req.params.modified,
      identityData,
    );
    if (!identity) {
      return res.status(404).send('Identity not found.');
    } else {
      logger.debug('Success: Updated identity with id ' + identity.stix.id);
      return res.status(200).send(identity);
    }
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to update identity. Server error.');
  }
};

exports.deleteVersionById = async function (req, res) {
  try {
    const identity = await identitiesService.deleteVersionById(
      req.params.stixId,
      req.params.modified,
    );
    if (!identity) {
      return res.status(404).send('Identity not found.');
    } else {
      logger.debug('Success: Deleted identity with id ' + identity.stix.id);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete identity failed. ' + err);
    return res.status(500).send('Unable to delete identity. Server error.');
  }
};

exports.deleteById = async function (req, res) {
  try {
    const identities = await identitiesService.deleteById(req.params.stixId);
    if (identities.deletedCount === 0) {
      return res.status(404).send('Identity not found.');
    } else {
      logger.debug(`Success: Deleted identity with id ${req.params.stixId}`);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete identity failed. ' + err);
    return res.status(500).send('Unable to identity identity. Server error.');
  }
};
