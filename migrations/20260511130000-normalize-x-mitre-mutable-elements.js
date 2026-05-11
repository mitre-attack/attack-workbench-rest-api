'use strict';

/**
 * Normalize x_mitre_mutable_elements on analytics by removing duplicate
 * entries, where uniqueness is defined by the composite (field, description)
 * tuple. ADM v4.11.5 introduced a Zod refinement that rejects analytics with
 * duplicate mutable elements; this migration brings existing data into
 * compliance with that rule.
 *
 * Why create new versions instead of updating in place?
 * - The application treats POST/create as the preferred versioned update path.
 * - create() reuses the normal lifecycle hooks, validation, external reference
 *   rebuilding, and event emission behavior used by the API.
 *
 * Scope:
 * - Only x-mitre-analytic objects are considered
 * - Only latest versions are considered (`stix.id` grouped by newest `stix.modified`)
 * - Only active versions are considered (not revoked, not deprecated)
 * - Only objects whose latest active version contains duplicate mutable
 *   elements are reposted
 *
 * Normalization rule:
 * - For each analytic, walk x_mitre_mutable_elements in order and keep only
 *   the first occurrence of each (field, description) tuple. Later duplicates
 *   are dropped. Order of first occurrences is preserved.
 */

const mongoose = require('mongoose');
const config = require('../app/config/config');
const {
  createAutomationRunRecorder,
  serializeError,
} = require('../app/lib/automation-run-recorder');
const logger = require('../app/lib/logger');
const systemConfigurationRepository = require('../app/repository/system-configurations-repository');
const validationBypassesService = require('../app/services/system/validation-bypasses-service');

const MIGRATION_NAME = '20260511130000-normalize-x-mitre-mutable-elements';

const TARGET_TYPE = 'x-mitre-analytic';

function dedupeKey(element) {
  return JSON.stringify([element?.field ?? null, element?.description ?? null]);
}

function deduplicateMutableElements(mutableElements) {
  if (!Array.isArray(mutableElements)) {
    return { changed: false, deduplicated: mutableElements, removedCount: 0 };
  }

  const seen = new Set();
  const deduplicated = [];

  for (const element of mutableElements) {
    const key = dedupeKey(element);
    if (seen.has(key)) continue;
    seen.add(key);
    deduplicated.push(element);
  }

  return {
    changed: deduplicated.length !== mutableElements.length,
    deduplicated,
    removedCount: mutableElements.length - deduplicated.length,
  };
}

function nextModifiedTimestamp(existingModified) {
  const now = Date.now();
  const existing = new Date(existingModified).getTime();
  const next = Number.isFinite(existing) ? Math.max(now, existing + 1) : now;
  return new Date(next).toISOString();
}

function latestActiveAnalyticsWithDuplicateMutableElementsPipeline() {
  return [
    { $match: { 'stix.type': TARGET_TYPE } },
    { $sort: { 'stix.id': 1, 'stix.modified': -1 } },
    { $group: { _id: '$stix.id', document: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$document' } },
    { $match: { 'stix.x_mitre_deprecated': { $in: [null, false] } } },
    { $match: { 'stix.revoked': { $in: [null, false] } } },
    {
      $match: {
        'stix.x_mitre_mutable_elements': { $type: 'array', $not: { $size: 0 } },
      },
    },
    {
      $addFields: {
        __mutable_element_count: { $size: '$stix.x_mitre_mutable_elements' },
        __unique_mutable_element_count: {
          $size: {
            $setUnion: [
              {
                $map: {
                  input: '$stix.x_mitre_mutable_elements',
                  as: 'el',
                  in: { field: '$$el.field', description: '$$el.description' },
                },
              },
              [],
            ],
          },
        },
      },
    },
    {
      $match: {
        $expr: { $ne: ['$__mutable_element_count', '$__unique_mutable_element_count'] },
      },
    },
    {
      $project: {
        _id: 0,
        __v: 0,
        __t: 0,
        __mutable_element_count: 0,
        __unique_mutable_element_count: 0,
      },
    },
  ];
}

async function countRemainingLatestActiveAnalyticsWithDuplicateMutableElements(db) {
  const [result] = await db
    .collection('attackObjects')
    .aggregate([
      ...latestActiveAnalyticsWithDuplicateMutableElementsPipeline(),
      { $count: 'remaining' },
    ])
    .toArray();

  return result?.remaining || 0;
}

function ensureMongooseUsesClient(client) {
  if (mongoose.connection.readyState === 0) {
    mongoose.connection.setClient(client);
  }
}

async function prepareServiceLayer(client) {
  ensureMongooseUsesClient(client);

  await validationBypassesService.loadStaticRules(config.configurationFiles.staticBypassRulesPath);

  const systemConfig = await systemConfigurationRepository.retrieveOne({ lean: true });
  if (!systemConfig?.organization_identity_ref) {
    throw new Error(
      'System configuration is missing organization_identity_ref; cannot create new versions in mutable-elements normalization migration.',
    );
  }
}

module.exports = {
  async up(db, client) {
    const recorder = await createAutomationRunRecorder(db, {
      automationType: 'migration',
      name: MIGRATION_NAME,
      trigger: {
        source: 'startup',
        runner: 'migrate-mongo',
      },
      scope: {
        collections: ['attackObjects'],
        object_kinds: ['stix-object'],
        target_types: [TARGET_TYPE],
      },
      metadata: {
        dedup_composite_key: ['field', 'description'],
      },
    });

    const counts = {
      scanned_candidates: 0,
      attempted_reposts: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
      duplicates_removed: 0,
    };
    const warnings = {
      existing_validation_issues: 0,
    };
    const failures = [];
    let verification = {};

    recorder.log('info', 'Starting migration', {
      targetType: TARGET_TYPE,
    });

    try {
      await prepareServiceLayer(client);

      const analyticsService = require('../app/services/stix/analytics-service');

      const cursor = db
        .collection('attackObjects')
        .aggregate(latestActiveAnalyticsWithDuplicateMutableElementsPipeline());

      while (await cursor.hasNext()) {
        const document = await cursor.next();
        counts.scanned_candidates++;

        const previousMutableElements = Array.isArray(document.stix?.x_mitre_mutable_elements)
          ? document.stix.x_mitre_mutable_elements
          : [];
        const { changed, deduplicated, removedCount } =
          deduplicateMutableElements(previousMutableElements);

        if (!changed) {
          counts.unchanged++;
          await recorder.recordItem({
            status: 'unchanged',
            action: 'normalize_x_mitre_mutable_elements',
            target: {
              kind: 'stix-object',
              collection: 'attackObjects',
              stix_id: document.stix?.id,
              stix_type: document.stix?.type,
            },
            details: {
              previous_modified: document.stix?.modified,
              changes: [
                {
                  field: 'stix.x_mitre_mutable_elements',
                  before: previousMutableElements,
                  after: deduplicated,
                },
              ],
            },
          });
          continue;
        }

        const existingValidationErrorCount = document.workspace?.validation?.errors?.length || 0;
        const itemWarnings = [];
        if (existingValidationErrorCount > 0) {
          warnings.existing_validation_issues++;
          itemWarnings.push('existing_validation_issues');
          recorder.log('warn', 'Reposting analytic with existing validation issues', {
            stixId: document.stix?.id,
            validationErrorCount: existingValidationErrorCount,
          });
        }

        const repost = JSON.parse(JSON.stringify(document));
        repost.stix.modified = nextModifiedTimestamp(document.stix?.modified);
        repost.stix.x_mitre_mutable_elements = deduplicated;
        counts.attempted_reposts++;

        try {
          const createdDocument = await analyticsService.create(repost, {
            import: false,
            automationContext: {
              automationName: MIGRATION_NAME,
              runId: recorder.runId,
            },
          });

          counts.updated++;
          counts.duplicates_removed += removedCount;

          await recorder.recordItem({
            status: 'changed',
            action: 'normalize_x_mitre_mutable_elements',
            target: {
              kind: 'stix-object',
              collection: 'attackObjects',
              stix_id: document.stix?.id,
              stix_type: document.stix?.type,
            },
            warnings: itemWarnings,
            details: {
              previous_modified: document.stix?.modified,
              new_modified: createdDocument.stix?.modified || repost.stix.modified,
              duplicates_removed: removedCount,
              ...(existingValidationErrorCount > 0 && {
                existing_validation_error_count: existingValidationErrorCount,
              }),
              changes: [
                {
                  field: 'stix.x_mitre_mutable_elements',
                  before: previousMutableElements,
                  after: deduplicated,
                },
              ],
            },
          });

          recorder.log('info', 'Created normalized analytic version', {
            stixId: document.stix?.id,
            previousModified: document.stix?.modified,
            newModified: createdDocument.stix?.modified || repost.stix.modified,
            duplicatesRemoved: removedCount,
          });
        } catch (error) {
          counts.failed++;
          failures.push({
            stixId: document.stix?.id,
            error: error.message,
          });

          await recorder.recordItem({
            status: 'failed',
            action: 'normalize_x_mitre_mutable_elements',
            target: {
              kind: 'stix-object',
              collection: 'attackObjects',
              stix_id: document.stix?.id,
              stix_type: document.stix?.type,
            },
            warnings: itemWarnings,
            details: {
              previous_modified: document.stix?.modified,
              attempted_modified: repost.stix.modified,
              duplicates_removed: removedCount,
              ...(existingValidationErrorCount > 0 && {
                existing_validation_error_count: existingValidationErrorCount,
              }),
              changes: [
                {
                  field: 'stix.x_mitre_mutable_elements',
                  before: previousMutableElements,
                  after: deduplicated,
                },
              ],
            },
            error: serializeError(error),
          });

          recorder.log('error', 'Failed to create normalized analytic version', {
            stixId: document.stix?.id,
            previousModified: document.stix?.modified,
            attemptedModified: repost.stix.modified,
            error: error.message,
          });
        }
      }

      verification = {
        remaining_latest_active_analytics_with_duplicate_mutable_elements:
          await countRemainingLatestActiveAnalyticsWithDuplicateMutableElements(db),
      };

      if (failures.length > 0) {
        throw new Error(
          `Mutable-elements normalization migration failed for ${failures.length} analytic(s); ` +
            `see automationRuns/automationRunItems for details.`,
        );
      }

      const summary = {
        message:
          `Deduplicated x_mitre_mutable_elements on ${counts.updated} active latest analytic(s) ` +
          `after scanning ${counts.scanned_candidates} candidate(s); removed ${counts.duplicates_removed} duplicate entry/entries in total.`,
      };

      await recorder.finish({
        status: 'completed',
        counts,
        warnings,
        verification,
        summary,
        errorSummary: null,
      });

      recorder.log('info', summary.message, {
        counts,
        warnings,
        verification,
      });
    } catch (error) {
      verification = {
        ...verification,
        remaining_latest_active_analytics_with_duplicate_mutable_elements:
          verification.remaining_latest_active_analytics_with_duplicate_mutable_elements ??
          (await countRemainingLatestActiveAnalyticsWithDuplicateMutableElements(db).catch(
            () => null,
          )),
      };

      const status = counts.updated > 0 ? 'partial' : 'failed';

      await recorder.finish({
        status,
        counts,
        warnings,
        verification,
        summary: {
          message: 'Mutable-elements normalization migration did not complete successfully.',
        },
        errorSummary: serializeError(error),
      });

      recorder.log('error', 'Migration failed', {
        counts,
        warnings,
        verification,
        error: error.message,
      });

      throw error;
    }
  },

  async down() {
    // No safe automatic rollback: the up migration creates new historical
    // versions via the normal application workflow.
    logger.info(
      `[${MIGRATION_NAME}] down migration is a no-op: created replacement versions are retained as part of object history`,
    );
  },
};
