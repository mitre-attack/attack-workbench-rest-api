'use strict';

const relationshipsService = require('../services/stix/relationships-service');
const logger = require('../lib/logger');
const {
  BadlyFormattedParameterError,
  InvalidQueryStringParameterError,
  DuplicateIdError,
} = require('../exceptions');

exports.retrieveAll = async function (req, res) {
  const options = {
    offset: req.query.offset || 0,
    limit: req.query.limit || 0,
    state: req.query.state,
    includeRevoked: req.query.includeRevoked,
    includeDeprecated: req.query.includeDeprecated,
    sourceRef: req.query.sourceRef,
    targetRef: req.query.targetRef,
    sourceOrTargetRef: req.query.sourceOrTargetRef,
    relationshipType: req.query.relationshipType,
    sourceType: req.query.sourceType,
    targetType: req.query.targetType,
    versions: req.query.versions || 'latest',
    includePagination: req.query.includePagination,
    lookupRefs: req.query.lookupRefs,
    includeIdentities: req.query.includeIdentities,
    lastUpdatedBy: req.query.lastUpdatedBy,
  };

  try {
    const results = await relationshipsService.retrieveAll(options);
    if (options.includePagination) {
      logger.debug(
        `Success: Retrieved ${results.data.length} of ${results.pagination.total} total relationship(s)`,
      );
    } else {
      logger.debug(`Success: Retrieved ${results.length} relationship(s)`);
    }
    return res.status(200).send(results);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get relationships. Server error.');
  }
};

exports.retrieveById = async function (req, res) {
  const options = {
    versions: req.query.versions || 'latest',
  };
  try {
    const relationships = await relationshipsService.retrieveById(req.params.stixId, options);

    if (relationships.length === 0) {
      return res.status(404).send('Relationship not found.');
    } else {
      logger.debug(
        `Success: Retrieved ${relationships.length} relationship(s) with id ${req.params.stixId}`,
      );
      return res.status(200).send(relationships);
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
      return res.status(500).send('Unable to get relationships. Server error.');
    }
  }
};

exports.retrieveVersionById = async function (req, res) {
  try {
    const relationship = await relationshipsService.retrieveVersionById(
      req.params.stixId,
      req.params.modified,
    );
    if (!relationship) {
      return res.status(404).send('Relationship not found.');
    } else {
      logger.debug(`Success: Retrieved relationship with id ${relationship.id}`);
      return res.status(200).send(relationship);
    }
  } catch (err) {
    if (err instanceof BadlyFormattedParameterError) {
      logger.warn('Badly formatted stix id: ' + req.params.stixId);
      return res.status(400).send('Stix id is badly formatted.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to get relationship. Server error.');
    }
  }
};

exports.create = async function (req, res) {
  // Get the data from the request
  const relationshipData = req.body;

  // Create the relationship
  try {
    const options = {
      import: false,
      userAccountId: req.user?.userAccountId,
    };
    const relationship = await relationshipsService.create(relationshipData, options);
    logger.debug('Success: Created relationship with id ' + relationship.stix.id);
    return res.status(201).send(relationship);
  } catch (err) {
    if (err instanceof DuplicateIdError) {
      logger.warn('Duplicate stix.id and stix.modified');
      return res
        .status(409)
        .send('Unable to create relationship. Duplicate stix.id and stix.modified properties.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to create relationship. Server error.');
    }
  }
};

exports.updateFull = async function (req, res) {
  // Get the data from the request
  const relationshipData = req.body;

  // Create the relationship
  try {
    const relationship = await relationshipsService.updateFull(
      req.params.stixId,
      req.params.modified,
      relationshipData,
    );
    if (!relationship) {
      return res.status(404).send('Relationship not found.');
    } else {
      logger.debug('Success: Updated relationship with id ' + relationship.stix.id);
      return res.status(200).send(relationship);
    }
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to update relationship. Server error.');
  }
};

exports.deleteVersionById = async function (req, res) {
  try {
    const relationship = await relationshipsService.deleteVersionById(
      req.params.stixId,
      req.params.modified,
    );
    if (!relationship) {
      return res.status(404).send('Relationship not found.');
    } else {
      logger.debug('Success: Deleted relationship with id ' + relationship.stix.id);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete relationship failed. ' + err);
    return res.status(500).send('Unable to delete relationship. Server error.');
  }
};

exports.deleteById = async function (req, res) {
  try {
    const relationships = await relationshipsService.deleteById(req.params.stixId);
    if (relationships.deletedCount === 0) {
      return res.status(404).send('Relationship not found.');
    } else {
      logger.debug(`Success: Deleted relationship with id ${req.params.stixId}`);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete relationship failed. ' + err);
    return res.status(500).send('Unable to delete relationship. Server error.');
  }
};
