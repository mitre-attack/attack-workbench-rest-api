'use strict';

// =============================================================================
// Zod transform schemas for export format transformations.
//
// These schemas encapsulate the DTO transformation logic for each export format.
// Each schema takes a common input shape (snapshot + hydratedObjects) and
// transforms it to the appropriate output format.
//
// Usage:
//   const { bundleTransformSchema } = require('./export-schemas');
//   const output = bundleTransformSchema.parse({ snapshot, hydratedObjects });
//
// See docs/COLLECTIONS_V2/07_OUTPUT_FORMATS.md for format specifications.
// =============================================================================

const { z } = require('zod');
const uuid = require('uuid');

// -----------------------------------------------------------------------------
// Shared sub-schemas
//
// These schemas use z.looseObject() to allow additional properties from Mongoose
// documents (e.g., _id, __v) to pass through without validation errors.
// -----------------------------------------------------------------------------

const tierEntrySchema = z.looseObject({
  object_ref: z.string(),
  object_modified: z.date().or(z.string()),
});

const snapshotSchema = z.looseObject({
  id: z.string(),
  version: z.string().nullable().optional(),
  name: z.string(),
  modified: z.date().or(z.string()),
  members: z.array(tierEntrySchema).default([]),
  staged: z.array(tierEntrySchema).optional(),
  candidates: z.array(tierEntrySchema).optional(),
});

const hydratedObjectSchema = z.looseObject({
  stix: z.looseObject({}),
  workspace: z.looseObject({}).optional(),
});

const exportOptionsSchema = z
  .object({
    include: z.enum(['staged', 'candidates', 'all']).optional(),
  })
  .optional()
  .default({});

// -----------------------------------------------------------------------------
// Base input schema (shared by all transforms)
// -----------------------------------------------------------------------------

const exportInputSchema = z.object({
  snapshot: snapshotSchema,
  hydratedObjects: z.array(hydratedObjectSchema),
  options: exportOptionsSchema,
});

// -----------------------------------------------------------------------------
// Helper: Build tier lookup for workbench format
// -----------------------------------------------------------------------------

function buildTierLookup(snapshot) {
  const lookup = {};
  for (const m of snapshot.members || []) {
    lookup[`${m.object_ref}::${new Date(m.object_modified).getTime()}`] = 'released';
  }
  for (const s of snapshot.staged || []) {
    lookup[`${s.object_ref}::${new Date(s.object_modified).getTime()}`] = 'staged';
  }
  for (const c of snapshot.candidates || []) {
    lookup[`${c.object_ref}::${new Date(c.object_modified).getTime()}`] = 'candidate';
  }
  return lookup;
}

// -----------------------------------------------------------------------------
// Bundle Transform Schema
//
// Standard STIX 2.1 bundle format. Only includes `stix` properties - no
// workspace data or workflow metadata. Suitable for external publication.
// -----------------------------------------------------------------------------

const bundleTransformSchema = exportInputSchema.transform((input) => ({
  type: 'bundle',
  id: `bundle--${uuid.v4()}`,
  objects: input.hydratedObjects.map((doc) => doc.stix),
}));

// -----------------------------------------------------------------------------
// Workbench Transform Schema
//
// Workbench-optimized format with full metadata. Includes `stix` + `workspace`
// properties and tier annotations. Optimized for Workbench UI consumption.
// -----------------------------------------------------------------------------

const workbenchTransformSchema = exportInputSchema.transform((input) => {
  const tierLookup = buildTierLookup(input.snapshot);

  const objects = input.hydratedObjects.map((doc) => {
    const key = `${doc.stix.id}::${new Date(doc.stix.modified).getTime()}`;
    return {
      stix: doc.stix,
      workspace: doc.workspace || {},
      metadata: {
        collection_tier: tierLookup[key] || 'released',
        object_type: doc.stix.type,
        object_name: doc.stix.name || doc.stix.id,
      },
    };
  });

  return {
    collection: {
      id: input.snapshot.id,
      version: input.snapshot.version,
      name: input.snapshot.name,
      modified: input.snapshot.modified,
    },
    objects,
    summary: {
      released_count: (input.snapshot.members || []).length,
      staged_count: (input.snapshot.staged || []).length,
      candidate_count: (input.snapshot.candidates || []).length,
    },
  };
});

// -----------------------------------------------------------------------------
// FilesystemStore Transform Schema
//
// STIX FileSystemStore-compatible directory structure. Objects are grouped by
// STIX type, each with a filename and content property.
// -----------------------------------------------------------------------------

const filesystemStoreTransformSchema = exportInputSchema.transform((input) => {
  const structure = {};

  for (const doc of input.hydratedObjects) {
    const type = doc.stix.type;
    if (!structure[type]) structure[type] = [];
    structure[type].push({
      filename: `${doc.stix.id}.json`,
      content: doc.stix,
    });
  }

  return {
    format: 'filesystemstore',
    track_id: input.snapshot.id,
    version: input.snapshot.version,
    structure,
  };
});

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  // Input schemas (for validation/testing)
  exportInputSchema,
  snapshotSchema,
  hydratedObjectSchema,
  exportOptionsSchema,

  // Transform schemas
  bundleTransformSchema,
  workbenchTransformSchema,
  filesystemStoreTransformSchema,

  // Helper (exported for testing)
  buildTierLookup,
};
