'use strict';

/**
 * Repost active, latest x-mitre-asset objects whose x_mitre_related_assets
 * entries violate ADM v4.11.2's new required-field rules on `description` and
 * `related_asset_sectors`. The new revision is identical to the prior version
 * except that its workflow state is demoted to 'work-in-progress'.
 *
 * Why create a new revision instead of updating in place?
 * - In Workbench, object revisions are first-class. POST/create is the
 *   canonical versioned update path: each revision is a new MongoDB document,
 *   uniquely identified by (stix.id, stix.modified). Updating workspace fields
 *   in place would silently mutate historical state.
 * - create() reuses the normal lifecycle hooks, validation, external reference
 *   rebuilding, and event emission behavior used by the API.
 *
 * Why demote to 'work-in-progress'?
 * - Validation in the service layer is workflow-state-aware: 'work-in-progress'
 *   maps to ADM's partial schema, which permits the now-required fields to be
 *   omitted while authors fill them in. That makes the demoted revision the
 *   documented escape valve for this kind of schema tightening, and it is the
 *   reason create() succeeds on objects that would otherwise fail validation.
 *
 * Scope:
 * - Only x-mitre-asset objects are considered
 * - Only latest versions are considered (`stix.id` grouped by newest `stix.modified`)
 * - Only active versions are considered (not revoked, not deprecated)
 * - Only versions currently in 'reviewed' or 'awaiting-review' are considered
 * - Only versions whose x_mitre_related_assets contains at least one entry
 *   missing/unset `description` or `related_asset_sectors`
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

const MIGRATION_NAME = '20260511140000-demote-noncompliant-asset-related-assets';

const TARGET_TYPE = 'x-mitre-asset';
const REVIEW_STATES = ['reviewed', 'awaiting-review'];
const DEMOTED_STATE = 'work-in-progress';

function isMissingDescription(relatedAsset) {
  const value = relatedAsset?.description;
  return (
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
  );
}

function isMissingRelatedAssetSectors(relatedAsset) {
  const value = relatedAsset?.related_asset_sectors;
  return value === undefined || value === null || (Array.isArray(value) && value.length === 0);
}

function findOffendingRelatedAssets(relatedAssets) {
  if (!Array.isArray(relatedAssets)) return [];

  const offenders = [];
  relatedAssets.forEach((relatedAsset, index) => {
    const missingDescription = isMissingDescription(relatedAsset);
    const missingSectors = isMissingRelatedAssetSectors(relatedAsset);
    if (missingDescription || missingSectors) {
      offenders.push({
        index,
        name: relatedAsset?.name,
        missing_fields: [
          ...(missingDescription ? ['description'] : []),
          ...(missingSectors ? ['related_asset_sectors'] : []),
        ],
      });
    }
  });

  return offenders;
}

function nextModifiedTimestamp(existingModified) {
  const now = Date.now();
  const existing = new Date(existingModified).getTime();
  const next = Number.isFinite(existing) ? Math.max(now, existing + 1) : now;
  return new Date(next).toISOString();
}

function latestActiveAssetsInReviewStatesPipeline() {
  return [
    { $match: { 'stix.type': TARGET_TYPE } },
    { $sort: { 'stix.id': 1, 'stix.modified': -1 } },
    { $group: { _id: '$stix.id', document: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$document' } },
    { $match: { 'stix.x_mitre_deprecated': { $in: [null, false] } } },
    { $match: { 'stix.revoked': { $in: [null, false] } } },
    { $match: { 'workspace.workflow.state': { $in: REVIEW_STATES } } },
    {
      $match: {
        'stix.x_mitre_related_assets': { $type: 'array', $not: { $size: 0 } },
      },
    },
    {
      $match: {
        $expr: {
          $anyElementTrue: {
            $map: {
              input: { $ifNull: ['$stix.x_mitre_related_assets', []] },
              as: 'ra',
              in: {
                $or: [
                  { $eq: [{ $ifNull: ['$$ra.description', null] }, null] },
                  { $eq: [{ $ifNull: ['$$ra.description', ''] }, ''] },
                  {
                    $eq: [{ $size: { $ifNull: ['$$ra.related_asset_sectors', []] } }, 0],
                  },
                ],
              },
            },
          },
        },
      },
    },
    { $project: { _id: 0, __v: 0, __t: 0 } },
  ];
}

async function countRemainingNoncompliantReviewedAssets(db) {
  const [result] = await db
    .collection('attackObjects')
    .aggregate([...latestActiveAssetsInReviewStatesPipeline(), { $count: 'remaining' }])
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
      'System configuration is missing organization_identity_ref; cannot create new versions in asset related-assets demotion migration.',
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
        review_states: REVIEW_STATES,
      },
      metadata: {
        required_related_asset_fields: ['description', 'related_asset_sectors'],
        demoted_state: DEMOTED_STATE,
      },
    });

    const counts = {
      scanned_candidates: 0,
      attempted_reposts: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
    };
    const warnings = {
      existing_validation_issues: 0,
    };
    const failures = [];
    let verification = {};

    recorder.log('info', 'Starting migration', {
      targetType: TARGET_TYPE,
      reviewStates: REVIEW_STATES,
      demotedState: DEMOTED_STATE,
    });

    try {
      await prepareServiceLayer(client);

      const assetsService = require('../app/services/stix/assets-service');

      const cursor = db
        .collection('attackObjects')
        .aggregate(latestActiveAssetsInReviewStatesPipeline());

      while (await cursor.hasNext()) {
        const document = await cursor.next();
        counts.scanned_candidates++;

        const previousState = document.workspace?.workflow?.state;
        const offenders = findOffendingRelatedAssets(document.stix?.x_mitre_related_assets);

        if (offenders.length === 0) {
          // Pipeline matched but no offenders identified in application code —
          // record as unchanged for observability rather than silently skipping.
          counts.unchanged++;
          await recorder.recordItem({
            status: 'unchanged',
            action: 'demote_workflow_state',
            target: {
              kind: 'stix-object',
              collection: 'attackObjects',
              stix_id: document.stix?.id,
              stix_type: document.stix?.type,
            },
            details: {
              previous_modified: document.stix?.modified,
              previous_state: previousState,
              reason: 'no_offending_related_assets_after_application_recheck',
            },
          });
          continue;
        }

        const existingValidationErrorCount = document.workspace?.validation?.errors?.length || 0;
        const itemWarnings = [];
        if (existingValidationErrorCount > 0) {
          warnings.existing_validation_issues++;
          itemWarnings.push('existing_validation_issues');
          recorder.log('warn', 'Reposting asset with existing validation issues', {
            stixId: document.stix?.id,
            validationErrorCount: existingValidationErrorCount,
          });
        }

        const repost = JSON.parse(JSON.stringify(document));
        repost.stix.modified = nextModifiedTimestamp(document.stix?.modified);
        repost.workspace = repost.workspace || {};
        repost.workspace.workflow = repost.workspace.workflow || {};
        repost.workspace.workflow.state = DEMOTED_STATE;
        counts.attempted_reposts++;

        try {
          const createdDocument = await assetsService.create(repost, {
            import: false,
            automationContext: {
              automationName: MIGRATION_NAME,
              runId: recorder.runId,
            },
          });

          counts.updated++;

          await recorder.recordItem({
            status: 'changed',
            action: 'demote_workflow_state',
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
              offending_related_assets: offenders,
              ...(existingValidationErrorCount > 0 && {
                existing_validation_error_count: existingValidationErrorCount,
              }),
              changes: [
                {
                  field: 'workspace.workflow.state',
                  before: previousState,
                  after: DEMOTED_STATE,
                },
              ],
            },
          });

          recorder.log('info', 'Created demoted asset revision', {
            stixId: document.stix?.id,
            previousModified: document.stix?.modified,
            newModified: createdDocument.stix?.modified || repost.stix.modified,
            previousState,
            newState: DEMOTED_STATE,
            offenderCount: offenders.length,
          });
        } catch (error) {
          counts.failed++;
          failures.push({
            stixId: document.stix?.id,
            error: error.message,
          });

          await recorder.recordItem({
            status: 'failed',
            action: 'demote_workflow_state',
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
              previous_state: previousState,
              offending_related_assets: offenders,
              ...(existingValidationErrorCount > 0 && {
                existing_validation_error_count: existingValidationErrorCount,
              }),
            },
            error: serializeError(error),
          });

          recorder.log('error', 'Failed to create demoted asset revision', {
            stixId: document.stix?.id,
            previousModified: document.stix?.modified,
            attemptedModified: repost.stix.modified,
            error: error.message,
          });
        }
      }

      verification = {
        remaining_latest_active_reviewed_assets_with_noncompliant_related_assets:
          await countRemainingNoncompliantReviewedAssets(db),
      };

      if (failures.length > 0) {
        throw new Error(
          `Asset related-assets demotion migration failed for ${failures.length} object(s); ` +
            `see automationRuns/automationRunItems for details.`,
        );
      }

      const summary = {
        message:
          `Demoted ${counts.updated} active latest asset(s) to '${DEMOTED_STATE}' ` +
          `after scanning ${counts.scanned_candidates} candidate(s).`,
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
        remaining_latest_active_reviewed_assets_with_noncompliant_related_assets:
          verification.remaining_latest_active_reviewed_assets_with_noncompliant_related_assets ??
          (await countRemainingNoncompliantReviewedAssets(db).catch(() => null)),
      };

      const status = counts.updated > 0 ? 'partial' : 'failed';

      await recorder.finish({
        status,
        counts,
        warnings,
        verification,
        summary: {
          message: 'Asset related-assets demotion migration did not complete successfully.',
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
    // revisions via the normal application workflow.
    logger.info(
      `[${MIGRATION_NAME}] down migration is a no-op: created replacement revisions are retained as part of object history`,
    );
  },
};
