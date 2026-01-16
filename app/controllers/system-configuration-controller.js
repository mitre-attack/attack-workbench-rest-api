'use strict';

const systemConfigurationService = require('../services/system/system-configuration-service');
const { SystemConfigurationService } = require('../services/system/system-configuration-service');
const logger = require('../lib/logger');

exports.retrieveSystemVersion = function (req, res) {
  try {
    const systemVersionInfo = SystemConfigurationService.retrieveSystemVersion();
    logger.debug(
      `Success: Retrieved system version, version: ${systemVersionInfo.version}, attackSpecVersion: ${systemVersionInfo.attackSpecVersion}`,
    );
    return res.status(200).send(systemVersionInfo);
  } catch (err) {
    logger.error('Unable to retrieve system version, failed with error: ' + err);
    return res.status(500).send('Unable to retrieve system version. Server error.');
  }
};

exports.retrieveAllowedValues = async function (req, res) {
  try {
    const allowedValues = await systemConfigurationService.retrieveAllowedValues();
    logger.debug('Success: Retrieved allowed values.');
    return res.status(200).send(allowedValues);
  } catch (err) {
    logger.error('Unable to retrieve allowed values, failed with error: ' + err);
    return res.status(500).send('Unable to retrieve allowed values. Server error.');
  }
};

exports.retrieveOrganizationIdentity = async function (req, res) {
  try {
    const identity = await systemConfigurationService.retrieveOrganizationIdentity();
    logger.debug('Success: Retrieved organization identity.');
    return res.status(200).send(identity);
  } catch (err) {
    logger.error('Unable to retrieve organization identity, failed with error: ' + err);
    return res.status(500).send('Unable to retrieve organization identity. Server error.');
  }
};

exports.setOrganizationIdentity = async function (req, res) {
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
    logger.error('Unable to set organization identity, failed with error: ' + err);
    return res.status(500).send('Unable to set organization identity. Server error.');
  }
};

exports.retrieveAuthenticationConfig = function (req, res) {
  try {
    const authenticationConfig = SystemConfigurationService.retrieveAuthenticationConfig();
    logger.debug('Success: Retrieved authentication configuration.');
    return res.status(200).send(authenticationConfig);
  } catch (err) {
    logger.error('Unable to retrieve authentication configuration, failed with error: ' + err);
    return res.status(500).send('Unable to retrieve authentication configuration. Server error.');
  }
};

exports.retrieveDefaultMarkingDefinitions = async function (req, res) {
  try {
    const options = { refOnly: req.query.refOnly };
    const defaultMarkingDefinitions =
      await systemConfigurationService.retrieveDefaultMarkingDefinitions(options);
    logger.debug('Success: Retrieved default marking definitions.');
    return res.status(200).send(defaultMarkingDefinitions);
  } catch (err) {
    logger.error(
      `Unable to retrieve default marking definitions, failed with error: ${err} (${err.markingDefinitionRef})`,
    );
    return res.status(500).send('Unable to retrieve default marking definitions. Server error.');
  }
};

exports.setDefaultMarkingDefinitions = async function (req, res) {
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
    logger.error('Unable to set default marking definitions, failed with error: ' + err);
    return res.status(500).send('Unable to default marking definitions. Server error.');
  }
};

exports.retrieveOrganizationNamespace = async function (req, res) {
  try {
    const namespace = await systemConfigurationService.retrieveOrganizationNamespace();
    logger.debug('Success: Retrieved organization namespace.');
    return res.status(200).send(namespace);
  } catch (err) {
    logger.error('Unable to retrieve organization namespace, failed with error: ' + err);
    return res.status(500).send('Unable to retrieve organization namespace. Server error.');
  }
};

exports.setOrganizationNamespace = async function (req, res) {
  const organizationNamespace = req.body;

  try {
    await systemConfigurationService.setOrganizationNamespace(organizationNamespace);
    logger.debug(`Success: Set organization namespace to: ${organizationNamespace.prefix}`);
    return res.status(204).send();
  } catch (err) {
    logger.error('Unable to set organization namespace, failed with error: ' + err);
    return res.status(500).send('Unable to set organization namespace. Server error.');
  }
};
