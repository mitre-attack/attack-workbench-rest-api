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
  embedded_relationships: { type: [embeddedRelationshipSchema] },
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
