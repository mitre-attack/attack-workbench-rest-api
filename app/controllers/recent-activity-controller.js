'use strict';

const recentActivityService = require('../services/system/recent-activity-service');
const logger = require('../lib/logger');

exports.retrieveAll = async function (req, res) {
  const options = {
    offset: req.query.offset || 0,
    limit: req.query.limit || 0,
    includeRevoked: req.query.includeRevoked,
    includeDeprecated: req.query.includeDeprecated,
    lastUpdatedBy: req.query.lastUpdatedBy,
    includePagination: req.query.includePagination,
  };

  try {
    const results = await recentActivityService.retrieveAll(options);

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
