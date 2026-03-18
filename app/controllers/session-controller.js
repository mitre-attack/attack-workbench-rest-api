'use strict';

const logger = require('../lib/logger');

exports.retrieveCurrentSession = function (req, res) {
  if (req.user) {
    logger.debug('Success: Retrieved current user session.');
    return res.status(200).send(req.user);
  } else {
    logger.warn('Unable to retrieve current user session, failed with error: req.user not found');
    return res.status(401).send('Not authorized');
  }
};
