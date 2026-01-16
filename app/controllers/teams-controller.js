'use strict';

const teamsService = require('../services/system/teams-service');
const logger = require('../lib/logger');
const { NotFoundError, BadlyFormattedParameterError, DuplicateIdError } = require('../exceptions');

exports.retrieveAll = async function (req, res) {
  const options = {
    offset: req.query.offset || 0,
    limit: req.query.limit || 0,
    search: req.query.search,
    includePagination: req.query.includePagination,
  };

  try {
    const results = await teamsService.retrieveAll(options);
    if (options.includePagination) {
      logger.debug(
        `Success: Retrieved ${results.data.length} of ${results.pagination.total} total team(s)`,
      );
    } else {
      logger.debug(`Success: Retrieved ${results.length} team(s)`);
    }
    return res.status(200).send(results);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get teams. Server error.');
  }
};

exports.retrieveById = async function (req, res) {
  try {
    const team = await teamsService.retrieveById(req.params.id);
    if (!team) {
      return res.status(404).send('TEam not found.');
    } else {
      logger.debug(`Success: Retrieved team with id ${req.params.id}`);
      return res.status(200).send(team);
    }
  } catch (err) {
    if (err instanceof BadlyFormattedParameterError) {
      logger.warn('Badly formatted teams id: ' + req.params.id);
      return res.status(400).send('Team id is badly formatted.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to get team. Server error.');
    }
  }
};

exports.create = async function (req, res) {
  // Get the data from the request
  const teamData = req.body;

  // Create the user account
  try {
    const team = await teamsService.create(teamData);
    logger.debug(`Success: Created team with id ${team.id}`);
    return res.status(201).send(team);
  } catch (err) {
    if (err instanceof DuplicateIdError) {
      logger.error('Duplicated team name');
      return res.status(409).send('Team name must be unique.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to create team. Server error.');
    }
  }
};

exports.updateFull = async function (req, res) {
  // Get the data from the request
  const teamData = req.body;

  try {
    // Create the technique
    const team = await teamsService.updateFull(req.params.id, teamData);
    if (!team) {
      return res.status(404).send('Team not found.');
    } else {
      logger.debug('Success: Updated team with id ' + team.id);
      return res.status(200).send(team);
    }
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to update team. Server error.');
  }
};

exports.delete = async function (req, res) {
  try {
    const team = await teamsService.delete(req.params.id);
    if (!team) {
      return res.status(404).send('Team not found.');
    } else {
      logger.debug('Success: Deleted team with id ' + team.id);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete team failed. ' + err);
    return res.status(500).send('Unable to delete team. Server error.');
  }
};

exports.retrieveAllUsers = async function (req, res) {
  const options = {
    offset: req.query.offset || 0,
    limit: req.query.limit || 0,
    status: req.query.status,
    role: req.query.role,
    search: req.query.search,
    includePagination: req.query.includePagination,
    includeStixIdentity: req.query.includeStixIdentity,
  };

  const teamId = req.params.id;

  try {
    const results = await teamsService.retrieveAllUsers(teamId, options);
    if (options.includePagination) {
      logger.debug(
        `Success: Retrieved ${results.data.length} of ${results.pagination.total} total user account(s)`,
      );
    } else {
      logger.debug(`Success: Retrieved ${results.length} user account(s)`);
    }
    return res.status(200).send(results);
  } catch (err) {
    if (err instanceof NotFoundError) {
      logger.error(`Could not find team with with id ${teamId}. `);
      return res.status(404).send('Team not found');
    } else {
      logger.error('Retrieve users from teamId failed. ' + err);
      return res.status(500).send('Unable to retrieve users. Server error.');
    }
  }
};
