'use strict';

const schedule = require('node-schedule');
const logger = require('../lib/logger');
const config = require('../config/config');
const { getSchema } = require('../lib/validation-schemas');

/**
 * Recursively convert Date instances to ISO strings.
 * MongoDB/.lean() returns BSON Date objects, but ADM Zod schemas
 * expect RFC3339 strings (z.iso.datetime).
 */
function serializeDates(obj) {
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(serializeDates);
  if (obj !== null && typeof obj === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(obj)) {
      out[key] = serializeDates(val);
    }
    return out;
  }
  return obj;
}

// Repositories for all collections that hold STIX objects
const attackObjectModel = require('../models/attack-object-model');
const RelationshipModel = require('../models/relationship-model');
const validationBypassesRepository = require('../repository/validation-bypasses-repository');

/**
 * Re-validate all STIX documents and refresh `workspace.validation`.
 *
 * This combats "concept drift": when the ADM library or ATTACK_SPEC_VERSION
 * changes, previously recorded validation results may become stale. Running
 * this on a schedule keeps every document's validation metadata current.
 *
 * Logic mirrors BaseService._createFromImport and the backfill migration:
 *  - Revoked/deprecated objects skip validation (stale validation is cleared).
 *  - Errors that match a bypass rule are filtered out.
 *  - Documents that pass have workspace.validation removed.
 *  - Documents that fail get workspace.validation set/updated.
 *
 * @returns {Promise<object>} Summary of validation results
 */
async function validateObjects() {
  logger.info('[validate-objects] Starting scheduled validation of all STIX objects');

  const { ATTACK_SPEC_VERSION } = require('@mitre-attack/attack-data-model');
  const admPkg = require('@mitre-attack/attack-data-model/package.json');

  // Load bypass rules once for the entire run
  let bypassRules = [];
  try {
    bypassRules = await validationBypassesRepository.findAll();
  } catch (err) {
    logger.warn(`[validate-objects] Could not load bypass rules: ${err.message}`);
  }

  const results = {
    timestamp: new Date().toISOString(),
    totalValidated: 0,
    totalErrored: 0,
    totalCleared: 0,
    admVersion: admPkg.version,
    attackSpecVersion: ATTACK_SPEC_VERSION,
  };

  // Process both collections: attackObjects (SDOs) and relationships (SROs)
  const models = [
    { model: attackObjectModel, name: 'attackObjects' },
    { model: RelationshipModel, name: 'relationships' },
  ];

  for (const { model, name } of models) {
    logger.debug(`[validate-objects] Processing ${name} collection`);

    // Target ALL objects (including non-latest, revoked, and deprecated)
    const cursor = model.find({}).lean().cursor();

    for await (const doc of cursor) {
      results.totalValidated++;

      const stixType = doc.stix?.type;
      if (!stixType) continue;

      const status = doc.workspace?.workflow?.state || 'reviewed';
      const schema = getSchema(stixType, status);
      if (!schema) continue;

      const parseResult = schema.safeParse(serializeDates(doc.stix));

      if (parseResult.success) {
        // Valid — clear any stale validation errors
        if (doc.workspace?.validation) {
          await model.updateOne({ _id: doc._id }, { $unset: { 'workspace.validation': '' } });
          results.totalCleared++;
        }
        continue;
      }

      // Convert Zod issues to error objects
      let errors = parseResult.error.issues.map((issue) => ({
        message: `${issue.path.join('.')} is ${issue.message}`,
        path: issue.path,
        code: issue.code,
      }));

      // Apply bypass rules (mirrors ValidationBypassesService.checkBypassRule)
      if (bypassRules.length > 0) {
        errors = errors.filter((error) => {
          const errorPathStr = JSON.stringify(error.path.map(String));
          return !bypassRules.some((rule) => {
            if (!rule.suppressError && !rule.warningMessage) return false;
            if (rule.stixType !== 'all' && rule.stixType !== stixType) return false;
            if (rule.errorCode !== error.code) return false;
            const rulePathStr = JSON.stringify(rule.fieldPath.map(String));
            return rulePathStr === errorPathStr;
          });
        });
      }

      if (errors.length === 0) {
        if (doc.workspace?.validation) {
          await model.updateOne({ _id: doc._id }, { $unset: { 'workspace.validation': '' } });
          results.totalCleared++;
        }
        continue;
      }

      // Determine if validation data has actually changed to avoid unnecessary writes
      const existingValidation = doc.workspace?.validation;
      const errorsChanged =
        !existingValidation ||
        existingValidation.adm_version !== admPkg.version ||
        existingValidation.attack_spec_version !== ATTACK_SPEC_VERSION ||
        existingValidation.errors?.length !== errors.length;

      if (errorsChanged) {
        await model.updateOne(
          { _id: doc._id },
          {
            $set: {
              'workspace.validation': {
                errors: errors.map((e) => ({ message: e.message, path: e.path, code: e.code })),
                attack_spec_version: ATTACK_SPEC_VERSION,
                adm_version: admPkg.version,
                validated_at: new Date(),
              },
            },
          },
        );
      }
      results.totalErrored++;
    }
  }

  logger.info(
    `[validate-objects] Validation complete: ${results.totalValidated} documents validated, ` +
      `${results.totalErrored} with errors, ${results.totalCleared} stale validations cleared ` +
      `(ADM v${results.admVersion}, spec v${results.attackSpecVersion})`,
  );

  return results;
}

/**
 * Initialize and schedule this task
 */
function initializeTask() {
  const cronPattern = config.scheduler.validateObjectsCron;

  logger.info(`[validate-objects] Scheduling task with cron pattern: ${cronPattern}`);

  schedule.scheduleJob(cronPattern, async () => {
    try {
      await validateObjects();
    } catch (err) {
      logger.error(`[validate-objects] Task execution failed: ${err.message}`);
      logger.error(err.stack);
    }
  });

  logger.info('[validate-objects] Task scheduled successfully');
}

// Initialize the task when this module is loaded
if (config.scheduler.enableScheduler) {
  initializeTask();
}

// Export for testing
module.exports = {
  validateObjects,
};
