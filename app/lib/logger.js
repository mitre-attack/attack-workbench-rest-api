'use strict';

const winston = require('winston');
const config = require('../config/config');

const logLevels = {
  error: 0,
  warn: 1,
  http: 2,
  info: 3,
  verbose: 4,
  debug: 5,
};

// Use detailed format for debug/verbose levels, cleaner one-liner format otherwise
const consoleFormat =
  config.logging.logLevel === 'debug' || config.logging.logLevel === 'verbose'
    ? winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.prettyPrint(),
      )
    : winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.printf(
          (info) => `${info.timestamp} [${info.level.toUpperCase()}] ${info.message}`,
        ),
      );

const logger = winston.createLogger({
  format: consoleFormat,
  transports: [new winston.transports.Console({ level: config.logging.logLevel })],
  levels: logLevels,
});

logger.stream = {
  // eslint-disable-next-line no-unused-vars
  write: function (message, encoding) {
    // TODO determine if 'encoding' argument can be omitted
    // Write to the log. Remove the last character to avoid double 'new line' characters.
    logger.http(message.slice(0, -1));
  },
};

module.exports = logger;
