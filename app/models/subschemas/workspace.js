'use strict';

const mongoose = require('mongoose');

const collectionVersion = {
  collection_ref: { type: String, required: true },
  collection_modified: { type: Date, required: true },
};
const collectionVersionSchema = new mongoose.Schema(collectionVersion, { _id: false });

const embedddedRelationship = {
  stix_id: { type: String, required: true },
  attack_id: String, // Immutable, server-generated identifier - safe to denormalize
  // Note: 'name' field removed - names are mutable and should be fetched on read
  // Services that need names should fetch the full document using stix_id
  direction: {
    type: String,
    // inbound: The embedded relationship points TO this document (I am referenced)
    // outbound: The embedded relationship points FROM this document (I reference another)
    enum: ['inbound', 'outbound'],
    required: true,
  },
};
const embeddedRelationshipSchema = new mongoose.Schema(embedddedRelationship, { _id: false });

const validationIssue = {
  message: { type: String, required: true },
  path: [String],
  code: { type: String, required: true },
};
const validationIssueSchema = new mongoose.Schema(validationIssue, { _id: false });

const releaseTrackRef = {
  id: { type: String, required: true },
  // The type of the referencing release track. Optional in the schema to
  // tolerate entries written before the field existed (the reconciler
  // backfills on the track's next contents change) but always set on write.
  type: {
    type: String,
    enum: ['standard', 'virtual'],
  },
  // Which tier of the track references this revision; values match the
  // snapshot tier array names.
  tier: {
    type: String,
    enum: ['members', 'staged', 'candidates', 'quarantine'],
    required: true,
  },
  // Track-scoped workflow status. Members are inherently 'reviewed';
  // quarantined entries (virtual tracks) carry no status;
  // 'modified-in-place' is retained for legacy persisted entries. Generic
  // STIX-changing PUTs are no longer permitted and do not create new markers.
  status: {
    type: String,
    enum: ['modified-in-place', 'work-in-progress', 'awaiting-review', 'reviewed'],
  },
};
const releaseTrackRefSchema = new mongoose.Schema(releaseTrackRef, { _id: false });

/**
 * Workspace property definition for most object types
 */
module.exports.common = {
  workflow: {
    state: {
      type: String,
      enum: ['work-in-progress', 'awaiting-review', 'reviewed', 'static', 'draft'],
    },
    created_by_user_account: String,
  },
  attack_id: String,
  collections: [collectionVersionSchema],
  release_tracks: { type: [releaseTrackRefSchema], default: undefined },
  embedded_relationships: { type: [embeddedRelationshipSchema], default: undefined },
  evaluation_needed: { type: Boolean, default: undefined },
  evaluation_context: { type: mongoose.Schema.Types.Mixed, default: undefined },
  validation: {
    errors: { type: [validationIssueSchema], default: undefined },
    attack_spec_version: String,
    adm_version: String,
    validated_at: Date,
  },
};

// x-mitre-collection workspace structure

const exportData = {
  export_timestamp: Date,
  bundle_id: String,
};
const exportDataSchema = new mongoose.Schema(exportData, { _id: false });

const importError = {
  object_ref: { type: String, required: true },
  object_modified: { type: Date },
  error_type: { type: String, required: true },
  error_message: { type: String },
};
const importErrorSchema = new mongoose.Schema(importError, { _id: false });

/**
 * Workspace property definition for collection objects
 */
const importCategories = {
  additions: [String],
  changes: [String],
  minor_changes: [String],
  revocations: [String],
  deprecations: [String],
  supersedes_user_edits: [String],
  supersedes_collection_changes: [String],
  duplicates: [String],
  out_of_date: [String],
  errors: [importErrorSchema],
};

const importReferences = {
  additions: [String],
  changes: [String],
};

const reimportData = {
  imported: Date,
  import_categories: importCategories,
  import_references: importReferences,
};

module.exports.collection = {
  imported: Date,
  exported: [exportDataSchema],
  import_categories: importCategories,
  import_references: importReferences,
  reimports: [reimportData],
  workflow: {
    state: {
      type: String,
      enum: ['work-in-progress', 'awaiting-review', 'reviewed'],
    },
    created_by_user_account: String,
    release: Boolean,
  },
};
