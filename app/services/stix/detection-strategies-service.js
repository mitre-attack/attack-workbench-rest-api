'use strict';

const detectionStrategiesRepository = require('../../repository/detection-strategies-repository');
const analyticsRepository = require('../../repository/analytics-repository');
const { BaseService } = require('../meta-classes');
const { DetectionStrategy: DetectionStrategyType } = require('../../lib/types');
const logger = require('../../lib/logger');
const EventBus = require('../../lib/event-bus');
const { NotFoundError } = require('../../exceptions');
const assertions = require('../../lib/assertions');

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
   * Assertion: Verify x_mitre_analytic_refs contains only unique values
   * (This should never actually throw in practice. We have (or will have) validation middleware
   *  that checks the request body before the service layer runs. That middleware is powered by
   *  the `@mitre-attack/attack-data-model` library which checks for this condition implicitly.
   *  This assertion thus serves as a fail-safe in case the middleware is ever somehow bypassed.
   *  It will throw, causing a 500 exception, but it will block "bad data" from entering the
   *  database.)
   */
  async _assertAnalyticRefsAreUnique(data) {
    assertions.assertUnique(data.stix?.x_mitre_analytic_refs, 'x_mitre_analytic_refs', {
      stixId: data.stix?.id || 'unknown',
    });
  }

  /**
   * Prepare detection strategy data before creation
   * Build outbound embedded_relationships for x_mitre_analytic_refs
   * Detects if this is a new version and tracks removed relationships
   */
  async beforeCreate(data) {
    this._assertAnalyticRefsAreUnique(data);

    // Initialize workspace if not present
    if (!data.workspace) {
      data.workspace = {};
    }

    // Check if this is a new version of an existing detection strategy
    // (same stix.id, but creating a new version with different modified date)
    let previousVersion = null;
    if (data.stix?.id) {
      try {
        previousVersion = await detectionStrategiesRepository.retrieveLatestByStixId(data.stix.id);
      } catch {
        // It's okay if there's no previous version - this might be the first version
        logger.debug(`No previous version found for detection strategy ${data.stix.id}`);
      }
    }

    // Build outbound embedded_relationships for x_mitre_analytic_refs
    // Cross-repository READS are allowed for denormalization (see CROSS_SERVICE_READS_PATTERN.md)
    // We emit events in afterCreate/afterUpdate for cross-service WRITES
    const newAnalyticRefs = data.stix?.x_mitre_analytic_refs || [];
    const oldAnalyticRefs = previousVersion?.stix?.x_mitre_analytic_refs || [];

    // Detect changes for event emission
    if (previousVersion) {
      this._addedAnalyticRefs = newAnalyticRefs.filter((ref) => !oldAnalyticRefs.includes(ref));
      this._removedAnalyticRefs = oldAnalyticRefs.filter((ref) => !newAnalyticRefs.includes(ref));
    }

    // Preserve non-analytic embedded_relationships and rebuild only analytic refs
    // This ensures stale analytic relationships from previous versions are not carried over
    // while preserving any other embedded relationships that may exist
    const existingNonAnalyticRels = (data.workspace.embedded_relationships || []).filter(
      (rel) => !rel.stix_id?.startsWith('x-mitre-analytic--'),
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
   */
  async afterCreate(document) {
    const addedRefs = this._addedAnalyticRefs || [];
    const removedRefs = this._removedAnalyticRefs || [];

    // Emit event for newly referenced analytics
    if (addedRefs.length > 0) {
      logger.info(
        `DetectionStrategiesService: Emitting analytics-referenced event for ${addedRefs.length} added analytic(s)`,
        { stixId: document.stix.id, analyticIds: addedRefs },
      );

      await EventBus.emit('x-mitre-detection-strategy::analytics-referenced', {
        detectionStrategyId: document.stix.id,
        detectionStrategy: document.toObject ? document.toObject() : document,
        analyticIds: addedRefs,
      });
    }

    // Emit event for removed analytics (when creating a new version without the analytics)
    if (removedRefs.length > 0) {
      logger.info(
        `DetectionStrategiesService: Emitting analytics-removed event for ${removedRefs.length} removed analytic(s)`,
        { stixId: document.stix.id, analyticIds: removedRefs },
      );

      await EventBus.emit('x-mitre-detection-strategy::analytics-removed', {
        detectionStrategyId: document.stix.id,
        analyticIds: removedRefs,
      });
    }

    // If no changes detected but there are current analytics, emit referenced event
    // (this handles the case where this is the first version being created)
    const currentAnalyticRefs = document.stix?.x_mitre_analytic_refs || [];
    if (!addedRefs.length && !removedRefs.length && currentAnalyticRefs.length > 0) {
      logger.info(
        `DetectionStrategiesService: Emitting analytics-referenced event for ${currentAnalyticRefs.length} analytic(s)`,
        { stixId: document.stix.id, analyticIds: currentAnalyticRefs },
      );

      await EventBus.emit('x-mitre-detection-strategy::analytics-referenced', {
        detectionStrategyId: document.stix.id,
        detectionStrategy: document.toObject ? document.toObject() : document,
        analyticIds: currentAnalyticRefs,
      });
    }

    // Clean up instance variables
    delete this._addedAnalyticRefs;
    delete this._removedAnalyticRefs;
  }

  /**
   * Prepare detection strategy data before update
   * Detect changes in x_mitre_analytic_refs and update outbound embedded_relationships
   */
  async beforeUpdate(stixId, stixModified, data, existingDocument) {
    this._assertAnalyticRefsAreUnique(data);

    const oldAnalyticRefs = existingDocument.stix?.x_mitre_analytic_refs || [];
    const newAnalyticRefs = data.stix?.x_mitre_analytic_refs || [];

    // Store change detection for afterUpdate
    this._addedAnalyticRefs = newAnalyticRefs.filter((ref) => !oldAnalyticRefs.includes(ref));
    this._removedAnalyticRefs = oldAnalyticRefs.filter((ref) => !newAnalyticRefs.includes(ref));

    // Update embedded_relationships in the data being saved
    if (!data.workspace) {
      data.workspace = {};
    }
    if (!data.workspace.embedded_relationships) {
      data.workspace.embedded_relationships = [];
    }

    // Rebuild the analytic portion of embedded_relationships
    const existingNonAnalyticRels = (data.workspace.embedded_relationships || []).filter(
      (rel) => !rel.stix_id?.startsWith('x-mitre-analytic--'),
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
  async afterUpdate(updatedDocument) {
    const addedRefs = this._addedAnalyticRefs || [];
    const removedRefs = this._removedAnalyticRefs || [];

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

    // Clean up instance variables
    delete this._addedAnalyticRefs;
    delete this._removedAnalyticRefs;
  }
}

module.exports = new DetectionStrategiesService(
  DetectionStrategyType,
  detectionStrategiesRepository,
);
