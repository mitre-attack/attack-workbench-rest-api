'use strict';

const schedule = require('node-schedule');
const logger = require('../lib/logger');
const config = require('../config/config');
const policy = require('../services/system/validation-policy-service');
const repository = require('../repository/validation-policy-repository');
const diagnostics = require('../services/system/validation-diagnostic-service');
const revisions = require('../repository/validation-diagnostics-repository');
const models = revisions.models;

async function validateObjects() {
  const snapshot = await policy.loadSnapshot();
  const publicationToken = await repository.allocatePublicationToken(snapshot);
  if (publicationToken === null) return { superseded: true };
  const results = {
    timestamp: new Date().toISOString(),
    totalValidated: 0,
    totalErrored: 0,
    totalCleared: 0,
    admVersion: snapshot.engine_context.adm_version,
    attackSpecVersion: snapshot.engine_context.attack_spec_version,
  };
  for (const model of models) {
    for await (const document of revisions.stream(model)) {
      const result = policy.evaluateObject(document, snapshot, { enabled: true });
      const saved = await diagnostics.publish({
        model,
        document,
        result,
        snapshot,
        publicationToken,
      });
      results.totalValidated++;
      if (saved && result.errors.length) results.totalErrored++;
      if (saved && !result.errors.length && document.workspace?.validation?.errors?.length)
        results.totalCleared++;
    }
  }
  return results;
}

/**
 * Initialize and schedule this task
 */
let job;
function initializeTask() {
  if (job) return job;
  const cronPattern = config.scheduler.validateObjectsCron;

  logger.info(`[validate-objects] Scheduling task with cron pattern: ${cronPattern}`);

  job = schedule.scheduleJob(cronPattern, async () => {
    try {
      await validateObjects();
    } catch (err) {
      logger.error(`[validate-objects] Task execution failed: ${err.message}`);
      logger.error(err.stack);
    }
  });

  logger.info('[validate-objects] Task scheduled successfully');
}

// Scheduling is explicit so importing the evaluator in tests starts no jobs.
module.exports = {
  validateObjects,
  initializeTask,
  stop: () => {
    if (job) job.cancel();
    job = null;
  },
};
