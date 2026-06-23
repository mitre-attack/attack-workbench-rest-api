'use strict';

const validationBypassesService = require('../services/system/validation-bypasses-service');
const logger = require('../lib/logger');

function validateRuleData(data) {
  if (!data || !Array.isArray(data.fieldPath) || !data.errorCode || !data.stixType) {
    return 'Unable to save validation bypass rule. Missing required properties (fieldPath, errorCode, stixType).';
  }
  return null;
}

exports.retrieveAll = async function (req, res, next) {
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
    return next(err);
  }
};

exports.create = async function (req, res, next) {
  const data = req.body;
  const validationError = validateRuleData(data);

  if (validationError) {
    return res.status(400).send(validationError);
  }

  try {
    const rule = await validationBypassesService.create(data);
    logger.debug('Success: Created validation bypass rule with id ' + rule._id);
    return res.status(201).send(rule);
  } catch (err) {
    return next(err);
  }
};

exports.retrieveById = async function (req, res, next) {
  try {
    const rule = await validationBypassesService.retrieveById(req.params.id);
    if (!rule) {
      return res.status(404).send('Validation bypass rule not found.');
    }
    logger.debug('Success: Retrieved validation bypass rule with id ' + req.params.id);
    return res.status(200).send(rule);
  } catch (err) {
    return next(err);
  }
};

exports.updateById = async function (req, res, next) {
  const data = req.body;
  const validationError = validateRuleData(data);

  if (validationError) {
    return res.status(400).send(validationError);
  }

  try {
    const rule = await validationBypassesService.updateById(req.params.id, data);
    if (!rule) {
      return res.status(404).send('Validation bypass rule not found.');
    }
    logger.debug('Success: Updated validation bypass rule with id ' + req.params.id);
    return res.status(200).send(rule);
  } catch (err) {
    return next(err);
  }
};

exports.deleteById = async function (req, res, next) {
  try {
    const rule = await validationBypassesService.deleteById(req.params.id);
    if (!rule) {
      return res.status(404).send('Validation bypass rule not found.');
    }
    logger.debug('Success: Deleted validation bypass rule with id ' + req.params.id);
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
};
