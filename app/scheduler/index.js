'use strict';

const schedule = require('node-schedule');
const logger = require('../lib/logger');
const config = require('../config/config');
const fs = require('fs');
const path = require('path');

/**
 * Initialize the scheduler by loading all task modules
 * Task modules self-initialize when required
 */
function initializeScheduler() {
  if (!config.scheduler.enableScheduler) {
    logger.info('Scheduler is disabled by configuration');
    return;
  }

  logger.info('Loading scheduled tasks');

  // Find all *-task.js files in the scheduler directory
  const schedulerDir = __dirname;
  const taskFiles = fs.readdirSync(schedulerDir).filter((file) => file.endsWith('-task.js'));

  logger.info(`Found ${taskFiles.length} task file(s) to load`);

  // Require each task file (they self-initialize)
  for (const taskFile of taskFiles) {
    const taskPath = path.join(schedulerDir, taskFile);
    try {
      // Loading the module will trigger its `initializeTask` method which schedules the task
      require(taskPath);
      logger.info(`Loaded task from ${taskFile}`);
    } catch (err) {
      logger.error(`Failed to load task from ${taskFile}: ${err.message}`);
      logger.error(err.stack);
    }
  }

  logger.info('Scheduler initialization complete');
}

/**
 * Gracefully shutdown all scheduled jobs
 * @returns {Promise<void>} Promise that resolves when all jobs are terminated
 */
async function gracefulShutdown() {
  logger.info('Gracefully shutting down scheduled tasks');
  await schedule.gracefulShutdown();
  logger.info('All scheduled tasks have been shut down');
}

module.exports = {
  initializeScheduler,
  gracefulShutdown,
};
