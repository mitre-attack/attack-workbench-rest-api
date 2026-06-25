'use strict';

const validationBypassesService = require('../services/system/validation-bypasses-service');
const logger = require('../lib/logger');
const { DuplicateIdError } = require('../exceptions');

exports.retrieveAll = async function (req, res) {
  const options = {
    offset: req.query.offset || 0,
    limit: req.query.limit || 0,
    includePagination: req.query.includePagination,
  };

  try {
    const results = await validationBypassesService.retrieveAll(options);
    if (options.includePagination) {
      logger.debug(
        `Success: Retrieved ${results.data.length} of ${results.pagination.total} total validation bypass rule(s)`,
      );
    } else {
      logger.debug(`Success: Retrieved ${results.length} validation bypass rule(s)`);
    }
    return res.status(200).send(results);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get validation bypass rules. Server error.');
  }
};

exports.create = async function (req, res) {
  const data = req.body;

  if (!data.fieldPath || !data.errorCode || !data.stixType) {
    return res
      .status(400)
      .send(
        'Unable to create validation bypass rule. Missing required properties (fieldPath, errorCode, stixType).',
      );
  }

  try {
    const rule = await validationBypassesService.create(data);
    logger.debug('Success: Created validation bypass rule with id ' + rule._id);
    return res.status(201).send(rule);
  } catch (err) {
    if (err instanceof DuplicateIdError) {
      logger.warn('Duplicate validation bypass rule');
      return res.status(409).send('Unable to create validation bypass rule. Duplicate rule.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to create validation bypass rule. Server error.');
    }
  }
};

exports.retrieveById = async function (req, res) {
  try {
    const rule = await validationBypassesService.retrieveById(req.params.id);
    if (!rule) {
      return res.status(404).send('Validation bypass rule not found.');
    }
    logger.debug('Success: Retrieved validation bypass rule with id ' + req.params.id);
    return res.status(200).send(rule);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get validation bypass rule. Server error.');
  }
};

exports.deleteById = async function (req, res) {
  try {
    const rule = await validationBypassesService.deleteById(req.params.id);
    if (!rule) {
      return res.status(404).send('Validation bypass rule not found.');
    }
    logger.debug('Success: Deleted validation bypass rule with id ' + req.params.id);
    return res.status(204).end();
  } catch (err) {
    logger.error('Delete validation bypass rule failed. ' + err);
    return res.status(500).send('Unable to delete validation bypass rule. Server error.');
  }
};
