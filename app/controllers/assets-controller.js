'use strict';

const assetsService = require('../services/stix/assets-service');
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
    platform: req.query.platform,
    state: req.query.state,
    includeRevoked: req.query.includeRevoked,
    includeDeprecated: req.query.includeDeprecated,
    search: req.query.search,
    lastUpdatedBy: req.query.lastUpdatedBy,
    includePagination: req.query.includePagination,
  };

  try {
    const assets = await assetsService.retrieveAll(options);
    if (options.includePagination) {
      logger.debug(
        `Success: Retrieved ${assets.data.length} of ${assets.pagination.total} total asset(s)`,
      );
    } else {
      logger.debug(`Success: Retrieved ${assets.length} asset(s)`);
    }
    return res.status(200).send(assets);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get assets. Server error.');
  }
};

exports.retrieveById = async function (req, res) {
  const options = {
    versions: req.query.versions || 'latest',
    retrieveDataComponents: req.query.retrieveDataComponents,
  };

  try {
    const assets = await assetsService.retrieveById(req.params.stixId, options);
    if (assets.length === 0) {
      return res.status(404).send('Asset not found.');
    } else {
      logger.debug(`Success: Retrieved ${assets.length} asset(s) with id ${req.params.stixId}`);
      return res.status(200).send(assets);
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
      return res.status(500).send('Unable to get assets. Server error.');
    }
  }
};

exports.retrieveVersionById = async function (req, res) {
  // TODO Remove after confirming these are not being used by assetsService.retrieveVersionById
  // const options = {
  //     retrieveDataComponents: req.query.retrieveDataComponents
  // }

  try {
    // const asset = await assetsService.retrieveVersionById(req.params.stixId, req.params.modified, options);
    const asset = await assetsService.retrieveVersionById(req.params.stixId, req.params.modified);
    if (!asset) {
      return res.status(404).send('Asset not found.');
    } else {
      logger.debug(`Success: Retrieved asset with id ${asset.id}`);
      return res.status(200).send(asset);
    }
  } catch (err) {
    if (err instanceof BadlyFormattedParameterError) {
      logger.warn('Badly formatted stix id: ' + req.params.stixId);
      return res.status(400).send('Stix id is badly formatted.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to get asset. Server error.');
    }
  }
};

exports.create = async function (req, res) {
  // Get the data from the request
  const assetData = req.body;

  try {
    const options = {
      import: false,
      userAccountId: req.user?.userAccountId,
    };
    const asset = await assetsService.create(assetData, options);
    logger.debug('Success: Created asset with id ' + asset.stix.id);
    return res.status(201).send(asset);
  } catch (err) {
    if (err instanceof DuplicateIdError) {
      logger.warn('Duplicate stix.id and stix.modified');
      return res
        .status(409)
        .send('Unable to create asset. Duplicate stix.id and stix.modified properties.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to create asset. Server error.');
    }
  }
};

exports.updateFull = async function (req, res) {
  // Get the data from the request
  const assetData = req.body;

  try {
    const asset = await assetsService.updateFull(req.params.stixId, req.params.modified, assetData);
    if (!asset) {
      return res.status(404).send('Asset not found.');
    } else {
      logger.debug('Success: Updated asset with id ' + asset.stix.id);
      return res.status(200).send(asset);
    }
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to update asset. Server error.');
  }
};

exports.deleteById = async function (req, res) {
  try {
    const assets = await assetsService.deleteById(req.params.stixId);

    if (assets.deletedCount === 0) {
      return res.status(404).send('Assets not found.');
    } else {
      logger.debug(`Success: Deleted asset with id ${req.params.stixId}`);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete asset failed. ' + err);
    return res.status(500).send('Unable to delete asset. Server error.');
  }
};

exports.deleteVersionById = async function (req, res) {
  try {
    const asset = await assetsService.deleteVersionById(req.params.stixId, req.params.modified);
    if (!asset) {
      return res.status(404).send('Asset not found.');
    } else {
      logger.debug('Success: Deleted asset with id ' + asset.stix.id);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete asset failed. ' + err);
    return res.status(500).send('Unable to delete asset. Server error.');
  }
};
