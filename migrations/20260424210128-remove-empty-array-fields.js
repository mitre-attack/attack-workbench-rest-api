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

// Every array field that should be omitted rather than stored as [].
const fields = [
  'stix.external_references',
  'stix.object_marking_refs',
  'stix.aliases',
  'stix.roles',
  'stix.sectors',
  'stix.tactic_refs',
  'stix.x_mitre_aliases',
  'stix.x_mitre_analytic_refs',
  'stix.x_mitre_collection_layers',
  'stix.x_mitre_log_source_references',
  'stix.x_mitre_mutable_elements',
  'stix.x_mitre_contributors',
  'stix.x_mitre_domains',
  'stix.x_mitre_platforms',
  'workspace.embedded_relationships',
  'workspace.collections',
];

const collectionNames = ['attackObjects', 'relationships'];

module.exports = {
  async up(db) {
    let totalModified = 0;

    // Unset each field individually so we only remove fields that are actually
    // empty arrays — not populated fields on the same document.
    for (const collectionName of collectionNames) {
      const collection = db.collection(collectionName);
      for (const field of fields) {
        const result = await collection.updateMany(
          { [field]: { $eq: [] } },
          { $unset: { [field]: '' } },
        );
        if (result.modifiedCount > 0) {
          console.log(
            `Removed empty ${field} from ${result.modifiedCount} ${collectionName} document(s)`,
          );
          totalModified += result.modifiedCount;
        }
      }
    }

    console.log(`Total documents updated: ${totalModified}`);
  },

  async down(db) {
    // Restore empty arrays on documents that are missing these fields.
    // This is a best-effort reverse — it cannot distinguish between fields that
    // were never set vs fields that were unset by the up() migration.
    for (const collectionName of collectionNames) {
      const collection = db.collection(collectionName);
      for (const field of fields) {
        await collection.updateMany({ [field]: { $exists: false } }, { $set: { [field]: [] } });
      }
    }
  },
};
