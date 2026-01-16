'use strict';

const campaignsService = require('../services/stix/campaigns-service');
const logger = require('../lib/logger');
const {
  DuplicateIdError,
  BadlyFormattedParameterError,
  InvalidQueryStringParameterError,
  InvalidTypeError,
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
    const results = await campaignsService.retrieveAll(options);
    if (options.includePagination) {
      logger.debug(
        `Success: Retrieved ${results.data.length} of ${results.pagination.total} total campaign(s)`,
      );
    } else {
      logger.debug(`Success: Retrieved ${results.length} campaign(s)`);
    }
    return res.status(200).send(results);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get campaigns. Server error.');
  }
};

exports.retrieveById = async function (req, res) {
  const options = {
    versions: req.query.versions || 'latest',
  };
  try {
    const campaigns = await campaignsService.retrieveById(req.params.stixId, options);
    if (campaigns.length === 0) {
      return res.status(404).send('Campaign not found.');
    } else {
      logger.debug(
        `Success: Retrieved ${campaigns.length} campaign(s) with id ${req.params.stixId}`,
      );
      return res.status(200).send(campaigns);
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
      return res.status(500).send('Unable to get campaigns. Server error.');
    }
  }
};

exports.retrieveVersionById = async function (req, res) {
  try {
    const campaign = await campaignsService.retrieveVersionById(
      req.params.stixId,
      req.params.modified,
    );
    if (!campaign) {
      return res.status(404).send('Campaign not found.');
    } else {
      logger.debug(`Success: Retrieved campaign with id ${campaign.id}`);
      return res.status(200).send(campaign);
    }
  } catch (err) {
    if (err instanceof BadlyFormattedParameterError) {
      logger.warn('Badly formatted stix id: ' + req.params.stixId);
      return res.status(400).send('Stix id is badly formatted.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to get campaign. Server error.');
    }
  }
};

exports.create = async function (req, res) {
  // Get the data from the request
  const campaignData = req.body;

  // Create the campaign
  try {
    const options = {
      import: false,
      userAccountId: req.user?.userAccountId,
    };

    const campaign = await campaignsService.create(campaignData, options);
    logger.debug('Success: Created campaign with id ' + campaign.stix.id);
    return res.status(201).send(campaign);
  } catch (err) {
    if (err instanceof DuplicateIdError) {
      logger.warn('Duplicate stix.id and stix.modified');
      return res
        .status(409)
        .send('Unable to create campaign. Duplicate stix.id and stix.modified properties.');
    } else if (err instanceof InvalidTypeError) {
      logger.warn('Invalid stix.type');
      return res.status(400).send('Unable to create campaign. stix.type must be campaign');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to create campaign. Server error.');
    }
  }
};

exports.updateFull = async function (req, res) {
  // Get the data from the request
  const campaignData = req.body;
  try {
    const campaign = await campaignsService.updateFull(
      req.params.stixId,
      req.params.modified,
      campaignData,
    );
    if (!campaign) {
      return res.status(404).send('Campaign not found.');
    } else {
      logger.debug('Success: Updated campaign with id ' + campaign.stix.id);
      return res.status(200).send(campaign);
    }
  } catch (err) {
    // Create the campaign
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to update campaign. Server error.');
  }
};

exports.deleteVersionById = async function (req, res) {
  try {
    const campaign = await campaignsService.deleteVersionById(
      req.params.stixId,
      req.params.modified,
    );
    if (!campaign) {
      return res.status(404).send('Campaign not found.');
    } else {
      logger.debug('Success: Deleted campaign with id ' + campaign.stix.id);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete campaign failed. ' + err);
    return res.status(500).send('Unable to delete campaign. Server error.');
  }
};

exports.deleteById = async function (req, res) {
  try {
    const campaigns = await campaignsService.deleteById(req.params.stixId);
    if (campaigns.deletedCount === 0) {
      return res.status(404).send('Campaign not found.');
    } else {
      logger.debug(`Success: Deleted campaigns with id ${req.params.stixId}`);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete campaign failed. ' + err);
    return res.status(500).send('Unable to delete campaign. Server error.');
  }
};
