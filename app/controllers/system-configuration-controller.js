'use strict';

const systemConfigurationService = require('../services/system/system-configuration-service');
const { SystemConfigurationService } = require('../services/system/system-configuration-service');
const logger = require('../lib/logger');

exports.retrieveSystemVersion = function (req, res, next) {
  try {
    const systemVersionInfo = SystemConfigurationService.retrieveSystemVersion();
    logger.debug(
      `Success: Retrieved system version, version: ${systemVersionInfo.version}, attackSpecVersion: ${systemVersionInfo.attackSpecVersion}`,
    );
    return res.status(200).send(systemVersionInfo);
  } catch (err) {
    return next(err);
  }
};

exports.retrieveAllowedValues = async function (req, res, next) {
  try {
    const allowedValues = await systemConfigurationService.retrieveAllowedValues();
    logger.debug('Success: Retrieved allowed values.');
    return res.status(200).send(allowedValues);
  } catch (err) {
    return next(err);
  }
};

exports.retrieveOrganizationIdentity = async function (req, res, next) {
  try {
    const identity = await systemConfigurationService.retrieveOrganizationIdentity();
    logger.debug('Success: Retrieved organization identity.');
    return res.status(200).send(identity);
  } catch (err) {
    return next(err);
  }
};

exports.setOrganizationIdentity = async function (req, res, next) {
  const organizationIdentity = req.body;
  if (!organizationIdentity.id) {
    logger.warn('Missing organization identity id');
    return res.status(400).send('Organization identity id is required');
  }

  try {
    await systemConfigurationService.setOrganizationIdentity(organizationIdentity.id);
    logger.debug(`Success: Set organization identity to: ${organizationIdentity.id}`);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
};

exports.retrieveAuthenticationConfig = function (req, res, next) {
  try {
    const authenticationConfig = SystemConfigurationService.retrieveAuthenticationConfig();
    logger.debug('Success: Retrieved authentication configuration.');
    return res.status(200).send(authenticationConfig);
  } catch (err) {
    return next(err);
  }
};

exports.retrieveDefaultMarkingDefinitions = async function (req, res, next) {
  try {
    const options = { refOnly: req.query.refOnly };
    const defaultMarkingDefinitions =
      await systemConfigurationService.retrieveDefaultMarkingDefinitions(options);
    logger.debug('Success: Retrieved default marking definitions.');
    return res.status(200).send(defaultMarkingDefinitions);
  } catch (err) {
    return next(err);
  }
};

exports.setDefaultMarkingDefinitions = async function (req, res, next) {
  const defaultMarkingDefinitionIds = req.body;
  if (!defaultMarkingDefinitionIds) {
    logger.warn('Missing default marking definition ids');
    return res.status(400).send('Missing default marking definition ids');
  } else if (!Array.isArray(defaultMarkingDefinitionIds)) {
    logger.warn('Default marking definition ids not an array');
    return res.status(400).send('Request must contain an array of marking definition ids');
  }

  try {
    await systemConfigurationService.setDefaultMarkingDefinitions(defaultMarkingDefinitionIds);
    logger.debug(`Success: Set default marking definitions`);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
};

exports.retrieveOrganizationNamespace = async function (req, res, next) {
  try {
    const namespace = await systemConfigurationService.retrieveOrganizationNamespace();
    logger.debug('Success: Retrieved organization namespace.');
    return res.status(200).send(namespace);
  } catch (err) {
    return next(err);
  }
};

exports.setOrganizationNamespace = async function (req, res, next) {
  const organizationNamespace = req.body;

  try {
    await systemConfigurationService.setOrganizationNamespace(organizationNamespace);
    logger.debug(`Success: Set organization namespace to: ${organizationNamespace.prefix}`);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
};

exports.retrieveMitreIdentityWrites = async function (req, res, next) {
  try {
    const mitreIdentityWrites = await systemConfigurationService.retrieveMitreIdentityWrites();
    logger.debug('Success: Retrieved MITRE identity writes configuration.');
    return res.status(200).send(mitreIdentityWrites);
  } catch (err) {
    return next(err);
  }
};

exports.setMitreIdentityWrites = async function (req, res, next) {
  const mitreIdentityWrites = req.body;

  if (typeof mitreIdentityWrites?.enabled !== 'boolean') {
    logger.warn('MITRE identity writes enabled value must be boolean');
    return res.status(400).send('MITRE identity writes enabled value must be boolean');
  }

  try {
    await systemConfigurationService.setMitreIdentityWrites(mitreIdentityWrites.enabled);
    logger.debug(`Success: Set MITRE identity writes to: ${mitreIdentityWrites.enabled}`);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
};
