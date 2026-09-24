'use strict';

const mongoose = require('mongoose');
const CreationCause = require('../../lib/release-tracks/snapshot-creation-causes');
const revisionReference = require('../../lib/release-tracks/revision-reference');
const {
  validateTrackId,
  validateTrackName,
  validateStixId,
  validateIdentityRef,
  validateMarkingDefRefs,
  validateCollectionId,
  validateVersion,
  validateObjectTypesFilter,
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

const workflowRevisionDefinition = {
  type: mongoose.Schema.Types.Mixed,
  required: true,
  validate: {
    validator(value) {
      return (
        revisionReference.isLatest(value) ||
        (value instanceof Date && !Number.isNaN(value.getTime())) ||
        (typeof value === 'string' && !Number.isNaN(new Date(value).getTime()))
      );
    },
    message: 'object_modified must be an exact Date or "latest"',
  },
};

const stagedEntryDefinition = {
  object_ref: {
    type: String,
    required: true,
    validate: validateStixId,
  },
  object_modified: workflowRevisionDefinition,
  object_status: {
    type: String,
    enum: ['modified-in-place', 'work-in-progress', 'awaiting-review', 'reviewed'],
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
  object_modified: workflowRevisionDefinition,
  object_status: {
    type: String,
    enum: ['modified-in-place', 'work-in-progress', 'awaiting-review', 'reviewed'],
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
  object_types: {
    type: [String],
    default: undefined,
    validate: validateObjectTypesFilter,
  },
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
    enum: ['latest_tagged', 'latest_preview', 'specific_version', 'specific_snapshot'],
    required: true,
  },
  priority: {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: Number.isInteger,
      message: 'Component priority must be an integer',
    },
  },
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
    required: function () {
      return !['latest_preview', 'latest_draft'].includes(this.strategy_used);
    },
    default: null,
    validate: validateVersion,
  },
  strategy_used: {
    type: String,
    // Historical members-only draft resolutions retain their original strategy.
    enum: [
      'latest_tagged',
      'latest_preview',
      'latest_draft',
      'specific_version',
      'specific_snapshot',
    ],
    required: true,
  },
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

const scheduledMaterializationDefinition = {
  schedule_mode: {
    type: String,
    enum: ['cron', 'dates'],
    required: true,
  },
  scheduled_for: { type: Date, required: true },
};
const scheduledMaterializationSchema = new mongoose.Schema(scheduledMaterializationDefinition, {
  _id: false,
});

// --- Config sub-schemas ---

const promotionConflictsDefinition = {
  // Applies when an entry enters the candidates tier (manual add, demote)
  // and the object_ref is already pinned at a different revision.
  into_candidates: {
    type: String,
    enum: ['always_overwrite', 'always_reject', 'prefer_latest', 'abort'],
    default: 'prefer_latest',
  },
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

// --- Publication sub-schemas ---
//
// Publication metadata follows an inheritance rule: each attribute either
// inherits the global (system configuration) value or carries an explicit
// track-scoped override. Collection identity and creation time default to
// track-derived values and become immutable once the track has a release.

const inheritedIdentityDefinition = {
  inherit: { type: Boolean, required: true, default: true },
  value: {
    type: String,
    validate: validateIdentityRef,
  },
};
const inheritedIdentitySchema = new mongoose.Schema(inheritedIdentityDefinition, { _id: false });

const inheritedMarkingRefsDefinition = {
  inherit: { type: Boolean, required: true, default: true },
  value: {
    type: [String],
    default: undefined,
    validate: validateMarkingDefRefs,
  },
};
const inheritedMarkingRefsSchema = new mongoose.Schema(inheritedMarkingRefsDefinition, {
  _id: false,
});

const publicationConfigDefinition = {
  collection_id: {
    type: String,
    validate: validateCollectionId,
  },
  created: { type: Date },
  created_by_ref: { type: inheritedIdentitySchema, default: () => ({ inherit: true }) },
  object_marking_refs: { type: inheritedMarkingRefsSchema, default: () => ({ inherit: true }) },
};
const publicationConfigSchema = new mongoose.Schema(publicationConfigDefinition, { _id: false });

// Values frozen onto a tagged snapshot at release commit. They are the exact
// inputs used to render the x-mitre-collection object for that release.
const frozenPublicationDefinition = {
  collection_id: { type: String, required: true, validate: validateCollectionId },
  created: { type: Date, required: true },
  created_by_ref: { type: String, required: true, validate: validateIdentityRef },
  object_marking_refs: { type: [String], required: true, validate: validateMarkingDefRefs },
  attack_spec_version: { type: String, required: true },
};
const frozenPublicationSchema = new mongoose.Schema(frozenPublicationDefinition, { _id: false });

const configDefinition = {
  candidacy_threshold: {
    type: String,
    enum: ['work-in-progress', 'awaiting-review', 'reviewed'],
    default: 'reviewed',
  },
  auto_promote: { type: Boolean, default: true },
  promotion_conflicts: {
    type: promotionConflictsSchema,
    default: () => ({}),
  },
  member_sync: {
    type: memberSyncSchema,
    default: () => ({}),
  },
  publication: {
    type: publicationConfigSchema,
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
    candidates_count: { type: Number },
    quarantine_count: { type: Number },
  },
  // Virtual tracks only: immutable component track ID → version (null for drafts).
  component_versions: {
    type: Map,
    of: {
      type: String,
      validate: validateVersion,
    },
    default: undefined,
    validate: {
      validator: (value) => {
        if (value == null) return true;
        const keys = value instanceof Map ? value.keys() : Object.keys(value);
        return Array.from(keys).every((key) => validateTrackId.validator(key));
      },
      message: 'Component version keys must be valid release track IDs',
    },
  },
};
const versionHistoryEntrySchema = new mongoose.Schema(versionHistoryEntryDefinition, {
  _id: false,
});

const bundleHashesSchema = new mongoose.Schema(
  {
    manifest_id: { type: String, required: true },
    stix_2_0: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    stix_2_1: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  },
  { _id: false },
);

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
  // Standard releases are new snapshots. This pointer keeps the exact draft
  // that was released reachable so deleting the release rolls back to that
  // preserved state instead of attempting to reconstruct it.
  release_source_modified: { type: Date, default: undefined },
  // Every snapshot references the sealed content manifest that describes its
  // exact member graph. Member-changing writes seal a new manifest; other
  // clones inherit their predecessor's manifest by reference.
  content_manifest_id: { type: String, required: true },
  // Release-only fields frozen at commit.
  publication: { type: frozenPublicationSchema },
  bundle_id: { type: String },
  bundle_hashes: { type: bundleHashesSchema },
  creation_actor: {
    type: new mongoose.Schema(
      {
        kind: { type: String, enum: ['user', 'system', 'unknown'], required: true },
        user_account_id: {
          type: String,
          required: function () {
            return this.kind === 'user';
          },
        },
      },
      { _id: false },
    ),
    default: () => ({ kind: 'unknown' }),
    immutable: true,
  },
  creation_cause: {
    type: String,
    enum: Object.values(CreationCause),
    default: CreationCause.Unknown,
    immutable: true,
  },
  snapshot_description: {
    type: String,
    maxlength: [4000, 'Snapshot description cannot exceed 4000 characters'],
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

  // --- Standard track tiers ---
  members: { type: [memberEntrySchema], default: [] },
  staged: { type: [stagedEntrySchema], default: undefined },
  candidates: { type: [candidateEntrySchema], default: undefined },

  // --- Virtual track tiers ---
  quarantine: { type: [quarantineEntrySchema], default: undefined },

  // --- Virtual track composition ---
  composition: { type: compositionSchema, default: undefined },
  composition_resolution: { type: compositionResolutionSchema, default: undefined },
  scheduled_materialization: {
    type: scheduledMaterializationSchema,
    default: undefined,
    validate: {
      validator: function validateScheduledMaterialization(value) {
        return value === undefined || this.type === 'virtual';
      },
      message: 'Scheduled materialization is only valid for virtual tracks',
    },
  },

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

// A tagged version identifies exactly one snapshot within a release track.
// Drafts are excluded so any number of snapshots may retain version: null.
releaseTrackSnapshotSchema.index(
  { id: 1, version: 1 },
  {
    name: 'unique_tagged_version',
    unique: true,
    partialFilterExpression: { version: { $type: 'string' } },
  },
);

releaseTrackSnapshotSchema.index(
  { id: 1, release_source_modified: 1 },
  {
    name: 'unique_standard_release_source',
    unique: true,
    partialFilterExpression: {
      version: { $type: 'string' },
      release_source_modified: { $type: 'date' },
    },
  },
);

releaseTrackSnapshotSchema.index({
  'composition_resolution.component_snapshots.track_id': 1,
  'composition_resolution.component_snapshots.resolved_snapshot_id': 1,
});

// A scheduled occurrence may materialize at most one snapshot, including
// after restart recovery or duplicate delivery by multiple scheduler nodes.
releaseTrackSnapshotSchema.index(
  { 'scheduled_materialization.scheduled_for': 1 },
  {
    unique: true,
    partialFilterExpression: {
      'scheduled_materialization.scheduled_for': { $type: 'date' },
    },
  },
);

// Historical releases-by-object lookup. Draft snapshots are deliberately
// excluded because they are numerous, mutable through cloning, and never
// eligible for the endpoint.
releaseTrackSnapshotSchema.index(
  { 'members.object_ref': 1, modified: -1 },
  {
    name: 'tagged_members_object_ref',
    partialFilterExpression: { version: { $type: 'string' } },
  },
);

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
  scheduledMaterializationSchema,
  configSchema,
  publicationConfigSchema,
  frozenPublicationSchema,
  versionHistoryEntrySchema,
};
