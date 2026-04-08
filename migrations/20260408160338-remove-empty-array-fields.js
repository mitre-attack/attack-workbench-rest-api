'use strict';

/**
 * Remove empty array values from STIX fields that previously defaulted to [].
 *
 * Mongoose's default behavior for `[String]` schema fields is to initialize
 * them as empty arrays. The STIX 2.1 specification states that list properties
 * MUST NOT be empty — they should be absent rather than present as `[]`.
 *
 * The corresponding model schemas have been updated to `{ type: [String], default: undefined }`
 * so new documents will omit these fields when not populated. This migration
 * cleans up existing documents that already have empty arrays stored.
 */

// Fields from stix-core.js (commonOptionalSDO) — shared across all STIX types.
const coreFields = [
  'stix.external_references',
  'stix.object_marking_refs',
  'workspace.embedded_relationships',
  'workspace.collections',
];

// Type-specific fields grouped by the STIX types they apply to.
// Every field lives in the `attackObjects` collection (discriminator pattern).
const fieldsByType = {
  'attack-pattern': ['stix.x_mitre_contributors'],
  campaign: ['stix.aliases', 'stix.x_mitre_contributors'],
  'data-source': [
    'stix.x_mitre_platforms',
    'stix.x_mitre_contributors',
    'stix.x_mitre_collection_layers',
  ],
  'x-mitre-detection-strategy': ['stix.x_mitre_domains', 'stix.x_mitre_analytic_refs'],
  'intrusion-set': ['stix.aliases', 'stix.x_mitre_contributors'],
  identity: ['stix.roles', 'stix.sectors'],
  'x-mitre-matrix': ['stix.tactic_refs'],
  malware: ['stix.x_mitre_platforms', 'stix.x_mitre_contributors', 'stix.x_mitre_aliases'],
  tool: ['stix.x_mitre_platforms', 'stix.x_mitre_contributors', 'stix.x_mitre_aliases'],
  'x-mitre-tactic': ['stix.x_mitre_contributors'],
};

module.exports = {
  async up(db) {
    const collection = db.collection('attackObjects');
    let totalModified = 0;

    // 1. Core fields (apply to all STIX types)
    const coreOrConditions = coreFields.map((field) => ({ [field]: { $eq: [] } }));
    const coreUnset = {};
    for (const field of coreFields) {
      coreUnset[field] = '';
    }

    const coreResult = await collection.updateMany(
      { $or: coreOrConditions },
      { $unset: coreUnset },
    );
    if (coreResult.modifiedCount > 0) {
      console.log(
        `Removed empty arrays from ${coreResult.modifiedCount} document(s): ${coreFields.join(', ')}`,
      );
      totalModified += coreResult.modifiedCount;
    }

    // 2. Type-specific fields
    for (const [stixType, fields] of Object.entries(fieldsByType)) {
      const orConditions = fields.map((field) => ({ [field]: { $eq: [] } }));
      const filter = {
        'stix.type': stixType,
        $or: orConditions,
      };

      const unsetFields = {};
      for (const field of fields) {
        unsetFields[field] = '';
      }

      const result = await collection.updateMany(filter, { $unset: unsetFields });
      if (result.modifiedCount > 0) {
        console.log(
          `Removed empty arrays from ${result.modifiedCount} ${stixType} document(s): ${fields.join(', ')}`,
        );
        totalModified += result.modifiedCount;
      }
    }

    console.log(`Total documents updated: ${totalModified}`);
  },

  async down(db) {
    // Restore empty arrays on documents that are missing these fields.
    // This is a best-effort reverse — it cannot distinguish between fields that
    // were never set vs fields that were unset by the up() migration.
    const collection = db.collection('attackObjects');

    // 1. Core fields
    const coreSet = {};
    const coreOrConditions = [];
    for (const field of coreFields) {
      coreSet[field] = [];
      coreOrConditions.push({ [field]: { $exists: false } });
    }
    await collection.updateMany({ $or: coreOrConditions }, { $set: coreSet });

    // 2. Type-specific fields
    for (const [stixType, fields] of Object.entries(fieldsByType)) {
      const setFields = {};
      const orConditions = [];
      for (const field of fields) {
        setFields[field] = [];
        orConditions.push({ [field]: { $exists: false } });
      }

      await collection.updateMany(
        { 'stix.type': stixType, $or: orConditions },
        { $set: setFields },
      );
    }
  },
};
