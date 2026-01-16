'use strict';

/**
 * Central enumeration of all events supported on the EventBus
 * Use these constants instead of string literals to ensure consistency and enable IDE autocomplete
 *
 * Event Naming Convention: <subject>::<action>[.<detail>]
 * - subject: Entity type (lowercase, singular or hyphenated)
 * - action: Operation performed (past tense verb)
 * - detail: Optional qualifier for specialized events
 */

module.exports = Object.freeze({
  // ============================================================================
  // Core CRUD Events
  // Emitted by BaseService after lifecycle hooks complete
  // ============================================================================

  // Attack Patterns (Techniques & Sub-techniques)
  ATTACK_PATTERN_CREATED: 'attack-pattern::created',
  ATTACK_PATTERN_UPDATED: 'attack-pattern::updated',
  ATTACK_PATTERN_DELETED: 'attack-pattern::deleted',

  // Tactics
  TACTIC_CREATED: 'x-mitre-tactic::created',
  TACTIC_UPDATED: 'x-mitre-tactic::updated',
  TACTIC_DELETED: 'x-mitre-tactic::deleted',

  // Mitigations
  COURSE_OF_ACTION_CREATED: 'course-of-action::created',
  COURSE_OF_ACTION_UPDATED: 'course-of-action::updated',
  COURSE_OF_ACTION_DELETED: 'course-of-action::deleted',

  // Groups
  INTRUSION_SET_CREATED: 'intrusion-set::created',
  INTRUSION_SET_UPDATED: 'intrusion-set::updated',
  INTRUSION_SET_DELETED: 'intrusion-set::deleted',

  // Software
  MALWARE_CREATED: 'malware::created',
  MALWARE_UPDATED: 'malware::updated',
  MALWARE_DELETED: 'malware::deleted',

  TOOL_CREATED: 'tool::created',
  TOOL_UPDATED: 'tool::updated',
  TOOL_DELETED: 'tool::deleted',

  // Campaigns
  CAMPAIGN_CREATED: 'campaign::created',
  CAMPAIGN_UPDATED: 'campaign::updated',
  CAMPAIGN_DELETED: 'campaign::deleted',

  // Data Sources
  DATA_SOURCE_CREATED: 'x-mitre-data-source::created',
  DATA_SOURCE_UPDATED: 'x-mitre-data-source::updated',
  DATA_SOURCE_DELETED: 'x-mitre-data-source::deleted',

  // Data Components
  DATA_COMPONENT_CREATED: 'x-mitre-data-component::created',
  DATA_COMPONENT_UPDATED: 'x-mitre-data-component::updated',
  DATA_COMPONENT_DELETED: 'x-mitre-data-component::deleted',

  // Matrices
  MATRIX_CREATED: 'x-mitre-matrix::created',
  MATRIX_UPDATED: 'x-mitre-matrix::updated',
  MATRIX_DELETED: 'x-mitre-matrix::deleted',

  // Collections
  COLLECTION_CREATED: 'x-mitre-collection::created',
  COLLECTION_UPDATED: 'x-mitre-collection::updated',
  COLLECTION_DELETED: 'x-mitre-collection::deleted',

  // Detection Strategies
  DETECTION_STRATEGY_CREATED: 'x-mitre-detection-strategy::created',
  DETECTION_STRATEGY_UPDATED: 'x-mitre-detection-strategy::updated',
  DETECTION_STRATEGY_DELETED: 'x-mitre-detection-strategy::deleted',

  // Analytics
  ANALYTIC_CREATED: 'x-mitre-analytic::created',
  ANALYTIC_UPDATED: 'x-mitre-analytic::updated',
  ANALYTIC_DELETED: 'x-mitre-analytic::deleted',

  // Assets
  ASSET_CREATED: 'x-mitre-asset::created',
  ASSET_UPDATED: 'x-mitre-asset::updated',
  ASSET_DELETED: 'x-mitre-asset::deleted',

  // ============================================================================
  // Cross-Document Events
  // Emitted by Manager classes when changes affect multiple documents
  // ============================================================================

  // Embedded Relationships
  EMBEDDED_RELATIONSHIP_ADDED: 'embedded-relationship::added',
  EMBEDDED_RELATIONSHIP_REMOVED: 'embedded-relationship::removed',
  EMBEDDED_RELATIONSHIP_UPDATED: 'embedded-relationship::updated',

  // ATT&CK IDs
  ATTACK_ID_ASSIGNED: 'attack-id::assigned',
  ATTACK_ID_CHANGED: 'attack-id::changed',
  ATTACK_ID_REMOVED: 'attack-id::removed',

  // External References
  EXTERNAL_REFERENCE_ADDED: 'external-reference::added',
  EXTERNAL_REFERENCE_REMOVED: 'external-reference::removed',
  EXTERNAL_REFERENCE_UPDATED: 'external-reference::updated',

  // ============================================================================
  // Specialized Domain Events
  // Emitted by SDO services for significant domain-specific changes
  // ============================================================================

  // Detection Strategy - Analytics relationship
  DETECTION_STRATEGY_ANALYTICS_CHANGED: 'detection-strategy::analytics-changed',
  DETECTION_STRATEGY_ANALYTICS_REFERENCED: 'x-mitre-detection-strategy::analytics-referenced',
  DETECTION_STRATEGY_ANALYTICS_REMOVED: 'x-mitre-detection-strategy::analytics-removed',

  // Analytic - Data Components relationship
  ANALYTIC_DATA_COMPONENTS_REFERENCED: 'x-mitre-analytic::data-components-referenced',
  ANALYTIC_DATA_COMPONENTS_REMOVED: 'x-mitre-analytic::data-components-removed',

  // Data Component - Data Source relationship
  DATA_COMPONENT_DATA_SOURCE_REFERENCED: 'x-mitre-data-component::data-source-referenced',
  DATA_COMPONENT_DATA_SOURCE_REMOVED: 'x-mitre-data-component::data-source-removed',

  // Technique - Sub-technique conversion
  TECHNIQUE_CONVERTED_TO_SUBTECHNIQUE: 'attack-pattern::converted-to-subtechnique',
  SUBTECHNIQUE_CONVERTED_TO_TECHNIQUE: 'attack-pattern::converted-to-technique',

  // Data Source - Data Component relationship
  DATA_SOURCE_COMPONENTS_CHANGED: 'x-mitre-data-source::components-changed',

  // Matrix - Tactics relationship
  MATRIX_TACTICS_CHANGED: 'x-mitre-matrix::tactics-changed',

  // Collection - Objects relationship
  COLLECTION_OBJECTS_CHANGED: 'x-mitre-collection::objects-changed',
});
