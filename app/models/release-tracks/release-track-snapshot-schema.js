'use strict';

const mongoose = require('mongoose');
const {
  validateTrackId,
  validateTrackName,
  validateStixId,
  validateIdentityRef,
  validateMarkingDefRefs,
  validateVersion,
} = require('../../lib/release-tracks/release-track-validators');

// =============================================================================
// Sub-schemas (all use _id: false to match codebase conventions)
// =============================================================================

// --- Tier entry sub-schemas ---

const memberEntryDefinition = {
  object_ref: {
    type: String,
    required: true,
    validate: validateStixId,
  },
  object_modified: { type: Date, required: true },
};
const memberEntrySchema = new mongoose.Schema(memberEntryDefinition, { _id: false });

const stagedEntryDefinition = {
  object_ref: {
    type: String,
    required: true,
    validate: validateStixId,
  },
  object_modified: { type: Date, required: true },
  object_status: {
    type: String,
    enum: ['work-in-progress', 'awaiting-review', 'reviewed'],
    required: true,
  },
  object_staged_at: { type: Date, required: true },
  object_staged_by: { type: String, required: true },
};
const stagedEntrySchema = new mongoose.Schema(stagedEntryDefinition, { _id: false });

const candidateEntryDefinition = {
  object_ref: {
    type: String,
    required: true,
    validate: validateStixId,
  },
  object_modified: { type: Date, required: true },
  object_status: {
    type: String,
    enum: ['work-in-progress', 'awaiting-review', 'reviewed'],
    required: true,
  },
  object_added_at: { type: Date, required: true },
  object_added_by: { type: String, required: true },
};
const candidateEntrySchema = new mongoose.Schema(candidateEntryDefinition, { _id: false });

const quarantineEntryDefinition = {
  object_ref: {
    type: String,
    required: true,
    validate: validateStixId,
  },
  object_modified: { type: Date, required: true },
  source_track_id: {
    type: String,
    required: true,
    validate: validateTrackId,
  },
  source_track_name: { type: String, required: true },
  source_snapshot_version: {
    type: String,
    validate: validateVersion,
  },
  conflict_reason: { type: String, required: true },
};
const quarantineEntrySchema = new mongoose.Schema(quarantineEntryDefinition, { _id: false });

// --- Composition sub-schemas (virtual tracks) ---

const componentTrackFiltersDefinition = {
  object_types: { type: [String], default: undefined },
  domains: { type: [String], default: undefined },
};
const componentTrackFiltersSchema = new mongoose.Schema(componentTrackFiltersDefinition, {
  _id: false,
});

const componentTrackDefinition = {
  track_id: {
    type: String,
    required: true,
    validate: validateTrackId,
  },
  resolution_strategy: {
    type: String,
    enum: ['latest_tagged', 'specific_version', 'specific_snapshot'],
    required: true,
  },
  priority: { type: Number, required: true },
  version: {
    type: String,
    validate: validateVersion,
  },
  snapshot: { type: Date },
  filters: { type: componentTrackFiltersSchema, default: undefined },
};
const componentTrackSchema = new mongoose.Schema(componentTrackDefinition, { _id: false });

const compositionDefinition = {
  component_tracks: { type: [componentTrackSchema], default: undefined },
  deduplication: {
    strategy: {
      type: String,
      enum: [
        'prioritize_latest_object',
        'prioritize_latest_snapshot',
        'prioritize_higher_priority',
        'quarantine',
      ],
    },
  },
};
const compositionSchema = new mongoose.Schema(compositionDefinition, { _id: false });

// --- Composition resolution sub-schemas (virtual tracks) ---

const componentSnapshotResolutionDefinition = {
  track_id: {
    type: String,
    required: true,
    validate: validateTrackId,
  },
  track_name: { type: String, required: true },
  track_type: { type: String, required: true },
  resolved_snapshot_id: { type: Date, required: true },
  resolved_version: {
    type: String,
    validate: validateVersion,
  },
  strategy_used: { type: String, required: true },
  filters_applied: { type: componentTrackFiltersSchema, default: undefined },
  total_objects_in_source: { type: Number, required: true },
  objects_after_filter: { type: Number, required: true },
  objects_contributed: { type: Number, required: true },
};
const componentSnapshotResolutionSchema = new mongoose.Schema(
  componentSnapshotResolutionDefinition,
  { _id: false },
);

const deduplicationReportDefinition = {
  total_objects_before: { type: Number },
  total_objects_after: { type: Number },
  duplicates_found: { type: Number },
  conflicts_resolved: { type: [mongoose.Schema.Types.Mixed], default: undefined },
};
const deduplicationReportSchema = new mongoose.Schema(deduplicationReportDefinition, {
  _id: false,
});

const compositionResolutionDefinition = {
  resolved_at: { type: Date },
  component_snapshots: { type: [componentSnapshotResolutionSchema], default: undefined },
  deduplication: { type: deduplicationReportSchema, default: undefined },
  summary: { type: mongoose.Schema.Types.Mixed, default: undefined },
};
const compositionResolutionSchema = new mongoose.Schema(compositionResolutionDefinition, {
  _id: false,
});

// --- Config sub-schemas ---

const promotionConflictsDefinition = {
  candidates_to_staged: {
    type: String,
    enum: ['always_overwrite', 'always_reject', 'prefer_latest'],
    default: 'prefer_latest',
  },
  staged_to_members: {
    type: String,
    enum: ['always_overwrite', 'always_reject', 'prefer_latest', 'abort'],
    default: 'abort',
  },
};
const promotionConflictsSchema = new mongoose.Schema(promotionConflictsDefinition, { _id: false });

const includeSecondaryObjectsDefinition = {
  enabled: { type: Boolean, default: true },
  status_threshold: {
    type: String,
    enum: ['work-in-progress', 'awaiting-review', 'reviewed'],
    default: 'reviewed',
  },
};
const includeSecondaryObjectsSchema = new mongoose.Schema(includeSecondaryObjectsDefinition, {
  _id: false,
});

// --- Member sync sub-schemas ---

const memberSyncSupplantDefinition = {
  behavior: {
    type: String,
    enum: ['replace', 'queue', 'ignore'],
    default: 'replace',
  },
  status_policy: {
    type: String,
    enum: ['reset', 'preserve'],
    default: 'reset',
  },
};
const memberSyncSupplantSchema = new mongoose.Schema(memberSyncSupplantDefinition, { _id: false });

const memberSyncDefinition = {
  strategy: {
    type: String,
    enum: ['track_latest', 'manual'],
    default: 'track_latest',
  },
  supplant: {
    type: memberSyncSupplantSchema,
    default: () => ({}),
  },
};
const memberSyncSchema = new mongoose.Schema(memberSyncDefinition, { _id: false });

const configDefinition = {
  candidacy_threshold: {
    type: String,
    enum: ['work-in-progress', 'awaiting-review', 'reviewed'],
    default: 'reviewed',
  },
  auto_promote: { type: Boolean, default: true },
  include_candidates_in_snapshots: { type: Boolean, default: false },
  include_secondary_objects: { type: includeSecondaryObjectsSchema, default: undefined },
  promotion_conflicts: {
    type: promotionConflictsSchema,
    default: () => ({}),
  },
  member_sync: {
    type: memberSyncSchema,
    default: () => ({}),
  },
};
const configSchema = new mongoose.Schema(configDefinition, { _id: false });

// --- Version history sub-schema ---

const versionHistoryEntryDefinition = {
  version: {
    type: String,
    required: true,
    validate: validateVersion,
  },
  tagged_at: { type: Date, required: true },
  tagged_by: { type: String, required: true },
  snapshot_id: { type: Date, required: true },
  summary: {
    members_count: { type: Number },
    promoted_count: { type: Number },
    staged_count: { type: Number },
    candidate_count: { type: Number },
  },
  // Virtual tracks only: records which component versions were included
  component_versions: { type: mongoose.Schema.Types.Mixed, default: undefined },
};
const versionHistoryEntrySchema = new mongoose.Schema(versionHistoryEntryDefinition, {
  _id: false,
});

// =============================================================================
// Main snapshot schema
// =============================================================================

const releaseTrackSnapshotDefinition = {
  // Identity
  id: {
    type: String,
    required: [true, 'Release track ID is required'],
    validate: validateTrackId,
  },
  type: {
    type: String,
    enum: ['standard', 'virtual'],
    required: true,
  },

  // Snapshot metadata
  modified: { type: Date, required: true },
  version: {
    type: String,
    default: null,
    validate: validateVersion,
  },

  // Release track metadata
  name: {
    type: String,
    required: [true, 'Release track name is required'],
    validate: validateTrackName,
  },
  description: { type: String },
  created: { type: Date, required: true },
  created_by_ref: {
    type: String,
    validate: validateIdentityRef,
  },
  object_marking_refs: {
    type: [String],
    default: undefined,
    validate: validateMarkingDefRefs,
  },

  // --- Standard track tiers ---
  members: { type: [memberEntrySchema], default: [] },
  staged: { type: [stagedEntrySchema], default: undefined },
  candidates: { type: [candidateEntrySchema], default: undefined },

  // --- Virtual track tiers ---
  quarantine: { type: [quarantineEntrySchema], default: undefined },

  // --- Virtual track composition ---
  composition: { type: compositionSchema, default: undefined },
  composition_resolution: { type: compositionResolutionSchema, default: undefined },

  // --- Shared ---
  config: { type: configSchema, default: () => ({}) },
  version_history: { type: [versionHistoryEntrySchema], default: [] },
};

const releaseTrackSnapshotSchema = new mongoose.Schema(releaseTrackSnapshotDefinition, {
  bufferCommands: false,
});

// --- Indexes ---

// Primary lookup: find snapshot by track id + modified timestamp
releaseTrackSnapshotSchema.index({ id: 1, modified: -1 }, { unique: true });

// Find the latest tagged version
releaseTrackSnapshotSchema.index({ id: 1, version: 1 });

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  releaseTrackSnapshotSchema,
  // Export sub-schemas for use in tests or other contexts
  memberEntrySchema,
  stagedEntrySchema,
  candidateEntrySchema,
  quarantineEntrySchema,
  compositionSchema,
  compositionResolutionSchema,
  configSchema,
  versionHistoryEntrySchema,
};
