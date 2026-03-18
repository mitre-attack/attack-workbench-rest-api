'use strict';

const attackObjectsService = require('../services/stix/attack-objects-service');
const logger = require('../lib/logger');

exports.retrieveAll = async function (req, res) {
  const options = {
    attackId: req.query.attackId,
    offset: req.query.offset || 0,
    limit: req.query.limit || 0,
    state: req.query.state,
    includeRevoked: req.query.includeRevoked,
    includeDeprecated: req.query.includeDeprecated,
    search: req.query.search,
    lastUpdatedBy: req.query.lastUpdatedBy,
    includePagination: req.query.includePagination,
    versions: req.query.versions,
  };

  try {
    const results = await attackObjectsService.retrieveAll(options);

    if (options.includePagination) {
      logger.debug(
        `Success: Retrieved ${results.data.length} of ${results.pagination.total} total ATT&CK object(s)`,
      );
    } else {
      logger.debug(`Success: Retrieved ${results.length} ATT&CK object(s)`);
    }

    return res.status(200).send(results);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get ATT&CK objects. Server error.');
  }
};

exports.getNextAttackId = async function (req, res) {
  // Validate required query parameter
  if (!req.query.type) {
    return res.status(400).send('Missing required query parameter: type');
  }

  const stixType = req.query.type;
  const parentRef = req.query.parentRef;

  // Validate parentRef for subtechniques
  if (parentRef && stixType !== 'attack-pattern') {
    return res.status(400).send('parentRef parameter is only valid for attack-pattern type');
  }

  try {
    const nextAttackId = await attackObjectsService.getNextAttackId(stixType, parentRef);

    if (!nextAttackId) {
      return res.status(400).send(`STIX type '${stixType}' does not support ATT&CK IDs`);
    }

    logger.debug(`Success: Generated next ATT&CK ID ${nextAttackId} for type ${stixType}`);
    return res.status(200).send({ attack_id: nextAttackId });
  } catch (err) {
    logger.error('Failed to generate next ATT&CK ID with error: ' + err);
    return res.status(500).send('Unable to generate next ATT&CK ID. Server error.');
  }
};
