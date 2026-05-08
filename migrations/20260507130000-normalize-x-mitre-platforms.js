'use strict';

/**
 * Normalize legacy x_mitre_platforms values onto the current ATT&CK Data Model
 * platform vocabulary by creating new versions of affected active latest
 * objects through the normal service-layer create() workflow.
 *
 * Why create new versions instead of updating in place?
 * - The application treats POST/create as the preferred versioned update path.
 * - create() reuses the normal lifecycle hooks, validation, external reference
 *   rebuilding, and event emission behavior used by the API.
 *
 * Scope:
 * - Only latest versions are considered (`stix.id` grouped by newest `stix.modified`)
 * - Only active versions are considered (not revoked, not deprecated)
 * - Only objects whose latest active version still contains legacy platform
 *   values are reposted
 *
 * Platform normalization rules:
 * - Network -> Network Devices
 * - Cloud -> IaaS, SaaS
 * - Office 365 -> Office Suite
 * - Google Workspace -> Office Suite
 * - AWS -> IaaS
 * - Azure -> IaaS
 * - GCP -> IaaS
 * - Azure AD -> Identity Provider
 * - Device Configuration/Parameters -> removed
 *
 * Newly-added canonical values such as Identity Provider and Office Suite are not
 * inferred automatically; the migration only rewrites existing values.
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

const MIGRATION_NAME = '20260507130000-normalize-x-mitre-platforms';

const LEGACY_PLATFORM_MAPPINGS = {
  Network: ['Network Devices'],
  Cloud: ['IaaS', 'SaaS'],
  'Office 365': ['Office Suite'],
  'Google Workspace': ['Office Suite'],
  AWS: ['IaaS'],
  Azure: ['IaaS'],
  GCP: ['IaaS'],
  'Azure AD': ['Identity Provider'],
  'Device Configuration/Parameters': [],
};

const LEGACY_PLATFORMS = Object.keys(LEGACY_PLATFORM_MAPPINGS);

const TARGET_TYPES = [
  'attack-pattern',
  'malware',
  'tool',
  'x-mitre-data-source',
  'x-mitre-asset',
  'x-mitre-analytic',
];

function arraysEqual(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function normalizePlatforms(platforms) {
  if (!Array.isArray(platforms)) {
    return { changed: false, normalizedPlatforms: platforms };
  }

  const normalizedPlatforms = [];

  for (const platform of platforms) {
    const replacements = Object.prototype.hasOwnProperty.call(LEGACY_PLATFORM_MAPPINGS, platform)
      ? LEGACY_PLATFORM_MAPPINGS[platform]
      : [platform];

    for (const replacement of replacements) {
      if (!normalizedPlatforms.includes(replacement)) {
        normalizedPlatforms.push(replacement);
      }
    }
  }

  return {
    changed: !arraysEqual(platforms, normalizedPlatforms),
    normalizedPlatforms,
  };
}

function nextModifiedTimestamp(existingModified) {
  const now = Date.now();
  const existing = new Date(existingModified).getTime();
  const next = Number.isFinite(existing) ? Math.max(now, existing + 1) : now;
  return new Date(next).toISOString();
}

function latestActiveDocumentsWithLegacyPlatformsPipeline() {
  return [
    { $match: { 'stix.type': { $in: TARGET_TYPES } } },
    { $sort: { 'stix.id': 1, 'stix.modified': -1 } },
    { $group: { _id: '$stix.id', document: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$document' } },
    { $match: { 'stix.x_mitre_deprecated': { $in: [null, false] } } },
    { $match: { 'stix.revoked': { $in: [null, false] } } },
    { $match: { 'stix.x_mitre_platforms': { $in: LEGACY_PLATFORMS } } },
    { $project: { _id: 0, __v: 0, __t: 0 } },
  ];
}

async function countRemainingLatestActiveDocumentsWithLegacyPlatforms(db) {
  const [result] = await db
    .collection('attackObjects')
    .aggregate([...latestActiveDocumentsWithLegacyPlatformsPipeline(), { $count: 'remaining' }])
    .toArray();

  return result?.remaining || 0;
}

function ensureMongooseUsesClient(client) {
  if (mongoose.connection.readyState === 0) {
    mongoose.connection.setClient(client);
  }
}

function getServiceMap() {
  const techniquesService = require('../app/services/stix/techniques-service');
  const softwareService = require('../app/services/stix/software-service');
  const dataSourcesService = require('../app/services/stix/data-sources-service');
  const assetsService = require('../app/services/stix/assets-service');
  const analyticsService = require('../app/services/stix/analytics-service');

  return {
    'attack-pattern': techniquesService,
    malware: softwareService,
    tool: softwareService,
    'x-mitre-data-source': dataSourcesService,
    'x-mitre-asset': assetsService,
    'x-mitre-analytic': analyticsService,
  };
}

async function prepareServiceLayer(client) {
  ensureMongooseUsesClient(client);

  await validationBypassesService.loadStaticRules(config.configurationFiles.staticBypassRulesPath);

  const systemConfig = await systemConfigurationRepository.retrieveOne({ lean: true });
  if (!systemConfig?.organization_identity_ref) {
    throw new Error(
      'System configuration is missing organization_identity_ref; cannot create new versions in platform normalization migration.',
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
        target_types: TARGET_TYPES,
      },
      metadata: {
        legacy_platform_mappings: LEGACY_PLATFORM_MAPPINGS,
      },
    });

    const counts = {
      scanned_candidates: 0,
      attempted_reposts: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
      removed_platform_field: 0,
    };
    const warnings = {
      existing_validation_issues: 0,
    };
    const failures = [];
    let verification = {};

    recorder.log('info', 'Starting migration', {
      targetTypes: TARGET_TYPES,
      legacyPlatforms: LEGACY_PLATFORMS,
    });

    try {
      await prepareServiceLayer(client);

      const serviceMap = getServiceMap();
      const cursor = db
        .collection('attackObjects')
        .aggregate(latestActiveDocumentsWithLegacyPlatformsPipeline());

      while (await cursor.hasNext()) {
        const document = await cursor.next();
        counts.scanned_candidates++;

        const previousPlatforms = Array.isArray(document.stix?.x_mitre_platforms)
          ? document.stix.x_mitre_platforms
          : [];
        const { changed, normalizedPlatforms } = normalizePlatforms(previousPlatforms);

        if (!changed) {
          counts.unchanged++;
          await recorder.recordItem({
            status: 'unchanged',
            action: 'normalize_x_mitre_platforms',
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
                  field: 'stix.x_mitre_platforms',
                  before: previousPlatforms,
                  after: normalizedPlatforms,
                },
              ],
            },
          });
          continue;
        }

        const service = serviceMap[document.stix?.type];
        if (!service) {
          const errorMessage = `Unsupported STIX type for platform migration: ${document.stix?.type}`;
          counts.failed++;
          failures.push({
            stixId: document.stix?.id,
            error: errorMessage,
          });

          await recorder.recordItem({
            status: 'failed',
            action: 'normalize_x_mitre_platforms',
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
                  field: 'stix.x_mitre_platforms',
                  before: previousPlatforms,
                  after: normalizedPlatforms.length > 0 ? normalizedPlatforms : null,
                },
              ],
            },
            error: { message: errorMessage },
          });
          recorder.log('error', 'Unsupported STIX type encountered', {
            stixId: document.stix?.id,
            stixType: document.stix?.type,
          });
          continue;
        }

        const existingValidationErrorCount = document.workspace?.validation?.errors?.length || 0;
        const itemWarnings = [];
        if (existingValidationErrorCount > 0) {
          warnings.existing_validation_issues++;
          itemWarnings.push('existing_validation_issues');
          recorder.log('warn', 'Reposting object with existing validation issues', {
            stixId: document.stix?.id,
            validationErrorCount: existingValidationErrorCount,
          });
        }

        const repost = JSON.parse(JSON.stringify(document));
        repost.stix.modified = nextModifiedTimestamp(document.stix?.modified);
        counts.attempted_reposts++;
        const removesPlatformField = normalizedPlatforms.length === 0;

        if (!removesPlatformField) {
          repost.stix.x_mitre_platforms = normalizedPlatforms;
        } else {
          delete repost.stix.x_mitre_platforms;
        }

        try {
          const createdDocument = await service.create(repost, {
            import: false,
            automationContext: {
              automationName: MIGRATION_NAME,
              runId: recorder.runId,
            },
          });

          counts.updated++;
          if (removesPlatformField) {
            counts.removed_platform_field++;
          }

          await recorder.recordItem({
            status: 'changed',
            action: removesPlatformField ? 'remove_x_mitre_platforms' : 'normalize_x_mitre_platforms',
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
              ...(existingValidationErrorCount > 0 && {
                existing_validation_error_count: existingValidationErrorCount,
              }),
              changes: [
                {
                  field: 'stix.x_mitre_platforms',
                  before: previousPlatforms,
                  after: normalizedPlatforms.length > 0 ? normalizedPlatforms : null,
                },
              ],
            },
          });

          recorder.log('info', 'Created normalized object version', {
            stixId: document.stix?.id,
            stixType: document.stix?.type,
            previousModified: document.stix?.modified,
            newModified: createdDocument.stix?.modified || repost.stix.modified,
            before: previousPlatforms,
            after: normalizedPlatforms.length > 0 ? normalizedPlatforms : null,
          });
        } catch (error) {
          counts.failed++;
          failures.push({
            stixId: document.stix?.id,
            error: error.message,
          });

          await recorder.recordItem({
            status: 'failed',
            action: removesPlatformField ? 'remove_x_mitre_platforms' : 'normalize_x_mitre_platforms',
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
              ...(existingValidationErrorCount > 0 && {
                existing_validation_error_count: existingValidationErrorCount,
              }),
              changes: [
                {
                  field: 'stix.x_mitre_platforms',
                  before: previousPlatforms,
                  after: normalizedPlatforms.length > 0 ? normalizedPlatforms : null,
                },
              ],
            },
            error: serializeError(error),
          });

          recorder.log('error', 'Failed to create normalized object version', {
            stixId: document.stix?.id,
            stixType: document.stix?.type,
            previousModified: document.stix?.modified,
            attemptedModified: repost.stix.modified,
            error: error.message,
          });
        }
      }

      verification = {
        remaining_latest_active_objects_with_legacy_platforms:
          await countRemainingLatestActiveDocumentsWithLegacyPlatforms(db),
      };

      if (failures.length > 0) {
        throw new Error(
          `Platform normalization migration failed for ${failures.length} object(s); ` +
            `see automationRuns/automationRunItems for details.`,
        );
      }

      const summary = {
        message:
          `Normalized x_mitre_platforms on ${counts.updated} active latest object(s) ` +
          `after scanning ${counts.scanned_candidates} candidate(s); removed the field entirely on ` +
          `${counts.removed_platform_field} object(s).`,
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
        remaining_latest_active_objects_with_legacy_platforms:
          verification.remaining_latest_active_objects_with_legacy_platforms ??
          (await countRemainingLatestActiveDocumentsWithLegacyPlatforms(db).catch(() => null)),
      };

      const status = counts.updated > 0 ? 'partial' : 'failed';

      await recorder.finish({
        status,
        counts,
        warnings,
        verification,
        summary: {
          message: 'Platform normalization migration did not complete successfully.',
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
