'use strict';

const userAccountsService = require('../services/system/user-accounts-service');
const logger = require('../lib/logger');
const config = require('../config/config');

exports.retrieveAll = async function (req, res, next) {
  const options = {
    offset: req.query.offset || 0,
    limit: req.query.limit || 0,
    status: req.query.status,
    role: req.query.role,
    search: req.query.search,
    includePagination: req.query.includePagination,
    includeStixIdentity: req.query.includeStixIdentity,
  };

  try {
    const results = await userAccountsService.retrieveAll(options);

    if (options.includePagination) {
      logger.debug(
        `Success: Retrieved ${results.data.length} of ${results.pagination.total} total user account(s)`,
      );
    } else {
      logger.debug(`Success: Retrieved ${results.length} user account(s)`);
    }
    return res.status(200).send(results);
  } catch (err) {
    next(err);
  }
};

exports.retrieveById = async function (req, res, next) {
  const options = {
    includeStixIdentity: req.query.includeStixIdentity,
  };

  try {
    const userAccount = await userAccountsService.retrieveById(req.params.id, options);
    if (!userAccount) {
      return res.status(404).send('User account not found.');
    } else {
      logger.debug(`Success: Retrieved user account with id ${req.params.id}`);
      return res.status(200).send(userAccount);
    }
  } catch (err) {
    next(err);
  }
};

exports.create = async function (req, res, next) {
  // Get the data from the request
  const userAccountData = req.body;

  if (userAccountData.status !== 'active' && userAccountData.role) {
    logger.warn('Unable to create user account, role not allowed when status is not active');
    return res.status(400).send('role not allowed when status is not active');
  }

  // Create the user account
  try {
    const userAccount = await userAccountsService.create(userAccountData);

    logger.debug(`Success: Created user account with id ${userAccount.id}`);
    return res.status(201).send(userAccount);
  } catch (err) {
    next(err);
  }
};

exports.updateFullAsync = async function (req, res, next) {
  try {
    // Create the technique
    const userAccount = await userAccountsService.updateFull(req.params.id, req.body);
    if (!userAccount) {
      return res.status(404).send('User account not found.');
    } else {
      logger.debug('Success: Updated user account with id ' + userAccount.id);
      return res.status(200).send(userAccount);
    }
  } catch (err) {
    next(err);
  }
};

exports.updateFull = async function (req, res, next) {
  // Create the technique
  try {
    const userAccount = await userAccountsService.updateFull(req.params.id, req.body);
    if (!userAccount) {
      return res.status(404).send('User account not found.');
    } else {
      logger.debug('Success: Updated user account with id ' + userAccount.id);
      return res.status(200).send(userAccount);
    }
  } catch (err) {
    next(err);
  }
};

exports.deleteAsync = async function (req, res, next) {
  try {
    const userAccount = await userAccountsService.delete(req.params.id);
    if (!userAccount) {
      return res.status(404).send('User account not found.');
    } else {
      logger.debug('Success: Deleted user account with id ' + userAccount.id);
      return res.status(204).end();
    }
  } catch (err) {
    next(err);
  }
};

exports.delete = async function (req, res, next) {
  try {
    const userAccount = await userAccountsService.delete(req.params.id);
    if (!userAccount) {
      return res.status(404).send('User account not found.');
    } else {
      logger.debug('Success: Deleted user account with id ' + userAccount.id);
      return res.status(204).end();
    }
  } catch (err) {
    next(err);
  }
};

exports.register = async function (req, res, next) {
  // The function supports self-registration of a logged in user

  if (config.userAuthn.mechanism === 'anonymous') {
    logger.warn('Unable to register user account, app configured to use anonymous authentication');
    return res
      .status(400)
      .send('Cannot register user accounts when anonymous authentication is enabled');
  } else if (!req.user) {
    logger.warn('Unable to register user account, not logged in');
    return res.status(400).send('Must login before registering');
  } else if (req.user.registered) {
    logger.warn('Unable to register user account, already registered');
    return res.status(400).send('Already registered');
  } else if (req.user.service) {
    logger.warn('Unable to register service account');
    return res.status(400).send('Cannot register service account');
  }

  const userAccountData = {
    email: req.user.email,
    username: req.user.name,
    displayName: req.user.displayName,
    status: 'pending',
  };

  // Register (create) the user account
  try {
    const userAccount = await userAccountsService.create(userAccountData);

    logger.debug(`Success: Registed user account with id ${userAccount.id}`);
    return res.status(201).send(userAccount);
  } catch (err) {
    next(err);
  }
};

exports.retrieveTeamsByUserId = async function (req, res, next) {
  const options = {
    offset: req.query.offset || 0,
    limit: req.query.limit || 0,
    status: req.query.status,
    includePagination: req.query.includePagination,
  };

  const userId = req.params.id;
  try {
    const results = await userAccountsService.constructor.retrieveTeamsByUserId(userId, options);
    if (options.includePagination) {
      logger.debug(
        `Success: Retrieved ${results.data.length} of ${results.pagination.total} total team(s)`,
      );
    } else {
      logger.debug(`Success: Retrieved ${results.length} team(s)`);
    }
    return res.status(200).send(results);
  } catch (err) {
    next(err);
  }
};
