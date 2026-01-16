'use strict';

const groupsService = require('../services/stix/groups-service');
const logger = require('../lib/logger');
const {
  DuplicateIdError,
  BadlyFormattedParameterError,
  InvalidTypeError,
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
    const results = await groupsService.retrieveAll(options);

    if (options.includePagination) {
      logger.debug(
        `Success: Retrieved ${results.data.length} of ${results.pagination.total} total group(s)`,
      );
    } else {
      logger.debug(`Success: Retrieved ${results.length} group(s)`);
    }
    return res.status(200).send(results);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get groups. Server error.');
  }
};

exports.retrieveById = async function (req, res) {
  const options = {
    versions: req.query.versions || 'latest',
  };
  try {
    const groups = await groupsService.retrieveById(req.params.stixId, options);

    if (groups.length === 0) {
      return res.status(404).send('Group not found.');
    } else {
      logger.debug(`Success: Retrieved ${groups.length} group(s) with id ${req.params.stixId}`);
      return res.status(200).send(groups);
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
      return res.status(500).send('Unable to get groups. Server error.');
    }
  }
};

exports.retrieveVersionById = async function (req, res) {
  try {
    const group = await groupsService.retrieveVersionById(req.params.stixId, req.params.modified);
    if (!group) {
      return res.status(404).send('Group not found.');
    } else {
      logger.debug(`Success: Retrieved group with id ${group.id}`);
      return res.status(200).send(group);
    }
  } catch (err) {
    if (err instanceof BadlyFormattedParameterError) {
      logger.warn('Badly formatted stix id: ' + req.params.stixId);
      return res.status(400).send('Stix id is badly formatted.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to get group. Server error.');
    }
  }
};

exports.create = async function (req, res) {
  // Get the data from the request
  const groupData = req.body;
  const options = {
    import: false,
    userAccountId: req.user?.userAccountId,
  };

  // Create the group
  try {
    const group = await groupsService.create(groupData, options);
    logger.debug('Success: Created group with id ' + group.stix.id);
    return res.status(201).send(group);
  } catch (err) {
    if (err instanceof DuplicateIdError) {
      logger.warn('Duplicate stix.id and stix.modified');
      return res
        .status(409)
        .send('Unable to create group. Duplicate stix.id and stix.modified properties.');
    } else if (err instanceof InvalidTypeError) {
      logger.warn('Invalid stix.type');
      return res.status(400).send('Unable to create group. stix.type must be intrusion-set');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to create group. Server error.');
    }
  }
};

exports.updateFull = async function (req, res) {
  // Get the data from the request
  const groupData = req.body;

  try {
    // Create the group
    const group = await groupsService.updateFull(req.params.stixId, req.params.modified, groupData);
    if (!group) {
      return res.status(404).send('Group not found.');
    } else {
      logger.debug('Success: Updated group with id ' + group.stix.id);
      return res.status(200).send(group);
    }
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to update group. Server error.');
  }
};

exports.deleteVersionById = async function (req, res) {
  try {
    const group = await groupsService.deleteVersionById(req.params.stixId, req.params.modified);
    if (!group) {
      return res.status(404).send('Group not found.');
    } else {
      logger.debug('Success: Deleted group with id ' + group.stix.id);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete group failed. ' + err);
    return res.status(500).send('Unable to delete group. Server error.');
  }
};

exports.deleteById = async function (req, res) {
  try {
    const groups = await groupsService.deleteById(req.params.stixId);
    if (groups.deletedCount === 0) {
      return res.status(404).send('Group not found.');
    } else {
      logger.debug(`Success: Deleted group with id ${req.params.stixId}`);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete group failed. ' + err);
    return res.status(500).send('Unable to delete group. Server error.');
  }
};
