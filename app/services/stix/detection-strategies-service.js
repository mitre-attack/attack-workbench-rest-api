'use strict';

const detectionStrategiesRepository = require('../../repository/detection-strategies-repository');
const analyticsRepository = require('../../repository/analytics-repository');
const { BaseService } = require('../meta-classes');
const { DetectionStrategy: DetectionStrategyType } = require('../../lib/types');
const logger = require('../../lib/logger');
const EventBus = require('../../lib/event-bus');
const { NotFoundError } = require('../../exceptions');

/**
 * Service for managing detection strategies
 *
 * Lifecycle hooks:
 * - beforeCreate: Builds outbound embedded_relationships for x_mitre_analytic_refs
 * - afterCreate: Emits domain event to notify AnalyticsService
 * - beforeUpdate: Updates outbound embedded_relationships when refs change
 * - afterUpdate: Emits domain events for added/removed analytics
 *
 * Events emitted (listened to by AnalyticsService):
 * - x-mitre-detection-strategy::analytics-referenced
 * - x-mitre-detection-strategy::analytics-removed
 */
class DetectionStrategiesService extends BaseService {
  /**
   * Prepare detection strategy data before creation
   * Build outbound embedded_relationships for x_mitre_analytic_refs
   * Detects if this is a new version and tracks removed relationships
   */
  async beforeCreate(data, options) {
    // Initialize workspace if not present
    if (!data.workspace) {
      data.workspace = {};
    }

    // Check if this is a new version of an existing detection strategy
    // (same stix.id, but creating a new version with different modified date)
    let previousVersion = null;
    if (data.stix?.id) {
      try {
        previousVersion = await this.repository.retrieveLatestByStixId(data.stix.id);
      } catch {
        // It's okay if there's no previous version - this might be the first version
        logger.debug(`No previous version found for detection strategy ${data.stix.id}`);
      }
    }

    // Build outbound embedded_relationships for x_mitre_analytic_refs
    // Cross-repository READS are allowed for denormalization (see CROSS_SERVICE_READS_PATTERN.md)
    // We emit events in afterCreate/afterUpdate for cross-service WRITES
    const newAnalyticRefs = [...new Set(data.stix?.x_mitre_analytic_refs || [])];
    const oldAnalyticRefs = previousVersion?.stix?.x_mitre_analytic_refs || [];

    options._removedAnalyticRefs ??= new Map();
    options._removedAnalyticRefs.set(
      `${data.stix.id}:${new Date(data.stix.modified).getTime()}`,
      [...new Set(oldAnalyticRefs)].filter((ref) => !newAnalyticRefs.includes(ref)),
    );

    // Preserve non-analytic embedded_relationships from the previous version when POST is
    // creating a new version. Client payloads often omit server-managed workspace metadata,
    // so using the request body here would drop unrelated relationships on version creation.
    const baselineEmbeddedRelationships =
      previousVersion?.workspace?.embedded_relationships ||
      data.workspace.embedded_relationships ||
      [];

    // Rebuild only the analytic outbound relationships for the new version.
    const existingNonAnalyticRels = baselineEmbeddedRelationships.filter(
      (rel) => !(rel.direction === 'outbound' && rel.stix_id?.startsWith('x-mitre-analytic--')),
    );

    const analyticEmbeddedRels = [];
    for (const analyticId of newAnalyticRefs) {
      const analytic = await analyticsRepository.retrieveLatestByStixId(analyticId);

      if (!analytic) {
        logger.warn(`DetectionStrategiesService: Analytic ${analyticId} does not exist`);
        throw new NotFoundError({
          analyticId: analyticId,
          message: 'The detection strategy cannot reference an analytic that does not exist',
        });
      }

      analyticEmbeddedRels.push({
        stix_id: analyticId,
        attack_id: analytic?.workspace?.attack_id || null,
        direction: 'outbound',
      });
    }

    data.workspace.embedded_relationships = [...existingNonAnalyticRels, ...analyticEmbeddedRels];
  }

  /**
   * Handle post-creation logic
   * Emit domain events to notify AnalyticsService about referenced/removed analytics
   * This handles both first-time creation and new version creation (versioning)
   *
   * @param {Object} document - The persisted detection strategy
   * @param {Object} [options] - Create options forwarded from BaseService.
   *   Threaded into the event payload so listeners can honor the
   *   import-fidelity contract (no stix mutations when `options.import`).
   *   See app/lib/import-safety.js for the contract.
   */
  async afterCreate(document, options) {
    const key = `${document.stix.id}:${new Date(document.stix.modified).getTime()}`;
    const removedRefs = options._removedAnalyticRefs?.get(key) || [];
    options._removedAnalyticRefs?.delete(key);
    const latest = await this.repository.retrieveLatestByStixId(document.stix.id);
    if (new Date(latest.stix.modified).getTime() !== new Date(document.stix.modified).getTime()) {
      return;
    }
    const addedRefs = [...new Set(document.stix?.x_mitre_analytic_refs || [])];

    // Emit event for newly referenced analytics
    if (addedRefs.length > 0) {
      logger.info(
        `DetectionStrategiesService: Emitting analytics-referenced event for ${addedRefs.length} added analytic(s)`,
        { stixId: document.stix.id, analyticIds: addedRefs },
      );

      await EventBus[options.requireReferences ? 'emitRequired' : 'emit'](
        'x-mitre-detection-strategy::analytics-referenced',
        {
          detectionStrategyId: document.stix.id,
          detectionStrategy: document.toObject ? document.toObject() : document,
          analyticIds: addedRefs,
          options,
        },
      );
    }

    // Emit event for removed analytics (when creating a new version without the analytics)
    if (removedRefs.length > 0) {
      logger.info(
        `DetectionStrategiesService: Emitting analytics-removed event for ${removedRefs.length} removed analytic(s)`,
        { stixId: document.stix.id, analyticIds: removedRefs },
      );

      await EventBus[options.requireReferences ? 'emitRequired' : 'emit'](
        'x-mitre-detection-strategy::analytics-removed',
        {
          detectionStrategyId: document.stix.id,
          analyticIds: removedRefs,
          options,
        },
      );
    }
  }

  /**
   * Prepare detection strategy data before update
   * Detect changes in x_mitre_analytic_refs and update outbound embedded_relationships
   */
  // eslint-disable-next-line no-unused-vars
  async beforeUpdate(stixId, stixModified, data, existingDocument, options) {
    const newAnalyticRefs = [...new Set(data.stix?.x_mitre_analytic_refs || [])];

    // Update embedded_relationships in the data being saved
    if (!data.workspace) {
      data.workspace = {};
    }
    if (!data.workspace.embedded_relationships) {
      data.workspace.embedded_relationships = [];
    }

    // Rebuild the analytic portion of embedded_relationships
    const existingNonAnalyticRels = (data.workspace.embedded_relationships || []).filter(
      (rel) => !(rel.direction === 'outbound' && rel.stix_id?.startsWith('x-mitre-analytic--')),
    );

    const analyticEmbeddedRels = [];
    for (const analyticId of newAnalyticRefs) {
      try {
        const analytic = await analyticsRepository.retrieveLatestByStixId(analyticId);
        analyticEmbeddedRels.push({
          stix_id: analyticId,
          attack_id: analytic?.workspace?.attack_id || null,
          direction: 'outbound',
        });
      } catch (error) {
        logger.warn(
          `DetectionStrategiesService: Could not fetch analytic ${analyticId} for outbound relationship`,
          error,
        );
        analyticEmbeddedRels.push({
          stix_id: analyticId,
          attack_id: null,
          direction: 'outbound',
        });
      }
    }

    data.workspace.embedded_relationships = [...existingNonAnalyticRels, ...analyticEmbeddedRels];
  }

  /**
   * Handle post-update logic
   * Emit domain events for analytics that were added or removed
   */
  async afterUpdate(updatedDocument, previousDocument) {
    const oldRefs = new Set(previousDocument.stix?.x_mitre_analytic_refs || []);
    const newRefs = new Set(updatedDocument.stix?.x_mitre_analytic_refs || []);
    const addedRefs = [...newRefs].filter((ref) => !oldRefs.has(ref));
    const removedRefs = [...oldRefs].filter((ref) => !newRefs.has(ref));

    // Emit event for newly referenced analytics
    if (addedRefs.length > 0) {
      logger.info(
        `DetectionStrategiesService: Emitting analytics-referenced event for ${addedRefs.length} added analytic(s)`,
        { stixId: updatedDocument.stix.id, analyticIds: addedRefs },
      );

      await EventBus.emit('x-mitre-detection-strategy::analytics-referenced', {
        detectionStrategyId: updatedDocument.stix.id,
        detectionStrategy: updatedDocument.toObject ? updatedDocument.toObject() : updatedDocument,
        analyticIds: addedRefs,
      });
    }

    // Emit event for removed analytics
    if (removedRefs.length > 0) {
      logger.info(
        `DetectionStrategiesService: Emitting analytics-removed event for ${removedRefs.length} removed analytic(s)`,
        { stixId: updatedDocument.stix.id, analyticIds: removedRefs },
      );

      await EventBus.emit('x-mitre-detection-strategy::analytics-removed', {
        detectionStrategyId: updatedDocument.stix.id,
        analyticIds: removedRefs,
      });
    }
  }
}

module.exports = new DetectionStrategiesService(
  DetectionStrategyType,
  detectionStrategiesRepository,
);
