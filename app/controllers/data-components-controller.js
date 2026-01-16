'use strict';

const dataComponentsService = require('../services/stix/data-components-service');
const logger = require('../lib/logger');

exports.retrieveAll = async function (req, res, next) {
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
    const results = await dataComponentsService.retrieveAll(options);
    if (options.includePagination) {
      logger.debug(
        `Success: Retrieved ${results.data.length} of ${results.pagination.total} total data component(s)`,
      );
    } else {
      logger.debug(`Success: Retrieved ${results.length} data component(s)`);
    }
    return res.status(200).send(results);
  } catch (err) {
    next(err);
  }
};

exports.retrieveById = async function (req, res, next) {
  const options = {
    versions: req.query.versions || 'latest',
  };

  try {
    const dataComponents = await dataComponentsService.retrieveById(req.params.stixId, options);
    if (dataComponents.length === 0) {
      return res.status(404).send('Data component not found.');
    } else {
      logger.debug(
        `Success: Retrieved ${dataComponents.length} data component(s) with id ${req.params.stixId}`,
      );
      return res.status(200).send(dataComponents);
    }
  } catch (err) {
    next(err);
  }
};

exports.retrieveChannelsById = async function (req, res, next) {
  try {
    const dataComponents = await dataComponentsService.retrieveById(req.params.stixId, {
      versions: 'latest',
    });
    if (dataComponents.length === 0) {
      return res.status(404).send('Data Component not found.');
    } else {
      logger.debug(`Success: Retrieved data component with id ${req.params.stixId}`);
      const channels = dataComponents[0].stix.x_mitre_log_sources.map((perm) => {
        return perm.channel;
      });
      return res.status(200).send(channels);
    }
  } catch (err) {
    next(err);
  }
};

exports.retrieveLogSourcesById = async function (req, res, next) {
  try {
    const dataComponents = await dataComponentsService.retrieveById(req.params.stixId, {
      versions: 'latest',
    });
    if (dataComponents.length === 0) {
      return res.status(404).send('Data Component not found.');
    } else {
      logger.debug(`Success: Retrieved data component with id ${req.params.stixId}`);
      return res.status(200).send(dataComponents[0].stix.x_mitre_log_sources);
    }
  } catch (err) {
    next(err);
  }
};

exports.retrieveVersionById = async function (req, res, next) {
  try {
    const dataComponent = await dataComponentsService.retrieveVersionById(
      req.params.stixId,
      req.params.modified,
    );
    if (!dataComponent) {
      return res.status(404).send('Data component not found.');
    } else {
      logger.debug(`Success: Retrieved data component with id ${dataComponent.id}`);
      return res.status(200).send(dataComponent);
    }
  } catch (err) {
    next(err);
  }
};

exports.create = async function (req, res, next) {
  // Get the data from the request
  const dataComponentData = req.body;
  const options = {
    import: false,
    userAccountId: req.user?.userAccountId,
  };

  // Create the data component
  try {
    const dataComponent = await dataComponentsService.create(dataComponentData, options);
    logger.debug('Success: Created data component with id ' + dataComponent.stix.id);
    return res.status(201).send(dataComponent);
  } catch (err) {
    next(err);
  }
};

exports.updateFull = async function (req, res, next) {
  // Get the data from the request
  const dataComponentData = req.body;

  // Create the data component

  try {
    const dataComponent = await dataComponentsService.updateFull(
      req.params.stixId,
      req.params.modified,
      dataComponentData,
    );
    if (!dataComponent) {
      return res.status(404).send('Data component not found.');
    } else {
      logger.debug('Success: Updated data component with id ' + dataComponent.stix.id);
      return res.status(200).send(dataComponent);
    }
  } catch (err) {
    next(err);
  }
};

exports.deleteVersionById = async function (req, res, next) {
  try {
    const dataComponent = await dataComponentsService.deleteVersionById(
      req.params.stixId,
      req.params.modified,
    );
    if (!dataComponent) {
      return res.status(404).send('Data component not found.');
    } else {
      logger.debug('Success: Deleted data component with id ' + dataComponent.stix.id);
      return res.status(204).end();
    }
  } catch (err) {
    next(err);
  }
};

exports.deleteById = async function (req, res, next) {
  try {
    const dataComponents = await dataComponentsService.deleteById(req.params.stixId);
    if (dataComponents.deletedCount === 0) {
      return res.status(404).send('Data Component not found.');
    } else {
      logger.debug(`Success: Deleted data component with id ${req.params.stixId}`);
      return res.status(204).end();
    }
  } catch (err) {
    next(err);
  }
};
