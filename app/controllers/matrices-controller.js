'use strict';

const matricesService = require('../services/stix/matrices-service');
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
    search: req.query.search,
    lastUpdatedBy: req.query.lastUpdatedBy,
    includePagination: req.query.includePagination,
  };
  try {
    const results = await matricesService.retrieveAll(options);

    if (options.includePagination) {
      logger.debug(
        `Success: Retrieved ${results.data.length} of ${results.pagination.total} total matrices`,
      );
    } else {
      logger.debug(`Success: Retrieved ${results.length} matrices`);
    }
    return res.status(200).send(results);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get matrices. Server error.');
  }
};

exports.retrieveById = async function (req, res) {
  const options = {
    versions: req.query.versions || 'latest',
  };

  try {
    const matrices = await matricesService.retrieveById(req.params.stixId, options);

    if (matrices.length === 0) {
      return res.status(404).send('Matrix not found.');
    } else {
      logger.debug(`Success: Retrieved ${matrices.length} matrices with id ${req.params.stixId}`);
      return res.status(200).send(matrices);
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
      return res.status(500).send('Unable to get matrices. Server error.');
    }
  }
};

exports.retrieveVersionById = async function (req, res) {
  try {
    const matrix = await matricesService.retrieveVersionById(
      req.params.stixId,
      req.params.modified,
    );

    if (!matrix) {
      return res.status(404).send('Matrix not found.');
    } else {
      logger.debug(`Success: Retrieved matrix with id ${matrix.id}`);
      return res.status(200).send(matrix);
    }
  } catch (err) {
    if (err instanceof BadlyFormattedParameterError) {
      logger.warn('Badly formatted stix id: ' + req.params.stixId);
      return res.status(400).send('Stix id is badly formatted.');
    }
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get matrix. Server error.');
  }
};

exports.create = async function (req, res) {
  // Get the data from the request
  const matrixData = req.body;

  // Create the matrix
  try {
    const options = {
      import: false,
      userAccountId: req.user?.userAccountId,
    };
    const matrix = await matricesService.create(matrixData, options);
    logger.debug('Success: Created matrix with id ' + matrix.stix.id);
    return res.status(201).send(matrix);
  } catch (err) {
    if (err instanceof DuplicateIdError) {
      logger.warn('Duplicate stix.id and stix.modified');
      return res
        .status(409)
        .send('Unable to create matrix. Duplicate stix.id and stix.modified properties.');
    }
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to create matrix. Server error.');
  }
};

exports.updateFull = async function (req, res) {
  try {
    // Get the data from the request
    const matrixData = req.body;

    // Update the matrix
    const matrix = await matricesService.updateFull(
      req.params.stixId,
      req.params.modified,
      matrixData,
    );

    if (!matrix) {
      return res.status(404).send('Matrix not found.');
    }

    logger.debug('Success: Updated matrix with id ' + matrix.stix.id);
    return res.status(200).send(matrix);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to update matrix. Server error.');
  }
};

exports.deleteVersionById = async function (req, res) {
  try {
    const matrix = await matricesService.deleteVersionById(req.params.stixId, req.params.modified);
    if (!matrix) {
      return res.status(404).send('Matrix not found.');
    } else {
      logger.debug('Success: Deleted matrix with id ' + matrix.stix.id);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete matrix failed. ' + err);
    return res.status(500).send('Unable to delete matrix. Server error.');
  }
};

exports.deleteById = async function (req, res) {
  try {
    const matrices = await matricesService.deleteById(req.params.stixId);

    if (matrices.deletedCount === 0) {
      return res.status(404).send('Matrix not found.');
    } else {
      logger.debug(`Success: Deleted matrix with id ${req.params.stixId}`);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete matrix failed. ' + err);
    return res.status(500).send('Unable to delete matrix. Server error.');
  }
};

exports.retrieveTechniquesForMatrix = async function (req, res) {
  try {
    const techniquesByTactic = await matricesService.retrieveTechniquesForMatrix(
      req.params.stixId,
      req.params.modified,
    );
    if (!techniquesByTactic) {
      return res.status(404).send('Matrix not found.');
    } else {
      logger.debug(`Success: Retrieved techniques for matrix with id ${req.params.stixId}`);
      return res.status(200).send(techniquesByTactic);
    }
  } catch (err) {
    if (err instanceof BadlyFormattedParameterError) {
      logger.warn('Badly formatted stix id: ' + req.params.stixId);
      return res.status(400).send('Stix id is badly formatted.');
    }
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get techniques for matrix. Server error.');
  }
};
