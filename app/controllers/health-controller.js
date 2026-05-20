'use strict';

// const mongoose = require('mongoose');
const logger = require('../lib/logger');

exports.getPing = function (req, res) {
  return res.status(204).send();
};

exports.getStatus = function (req, res) {
  try {
    const status = {
      // TBD: check database connection without waiting 30 seconds for timeout when not connected
      // dbState: mongoose.STATES[mongoose.connection.readyState],
      uptime: process.uptime(),
    };
    return res.status(200).send(status);
  } catch (err) {
    logger.error('Unable to retrieve system status, failed with error: ' + err);
    return res.status(500).send('Unable to retrieve system status. Server error.');
  }
};
