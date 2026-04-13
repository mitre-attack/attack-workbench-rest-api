'use strict';

/**
 * Strip empty-string values from existing STIX documents.
 *
 * The application now drops empty-string fields at the service layer before
 * persisting (BaseService.stripEmptyStrings). This migration retroactively
 * cleans up any documents that already have empty-string values stored.
 *
 * Because empty strings can appear on any arbitrary field (top-level or nested),
 * we scan each document and build a per-document $unset operation for every
 * path whose value is exactly "".
 */

const collectionNames = ['attackObjects', 'relationships'];

/**
 * Recursively collect dot-notation paths whose value is an empty string.
 *
 * @param {Object} obj    - The (sub-)document to inspect
 * @param {string} prefix - Dot-notation prefix for the current nesting level
 * @returns {string[]}    - Array of dot-notation paths to unset
 */
function findEmptyStringPaths(obj, prefix = '') {
  const paths = [];
  if (!obj || typeof obj !== 'object') return paths;

  for (const [key, val] of Object.entries(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (val === '') {
      paths.push(fullPath);
    } else if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      paths.push(...findEmptyStringPaths(val, fullPath));
    }
  }
  return paths;
}

module.exports = {
  async up(db) {
    let totalDocuments = 0;
    let totalFields = 0;

    for (const collectionName of collectionNames) {
      const collection = db.collection(collectionName);

      // Use a cursor to avoid loading the entire collection into memory.
      const cursor = collection.find({});

      const bulkOps = [];

      while (await cursor.hasNext()) {
        const doc = await cursor.next();
        const paths = findEmptyStringPaths(doc);

        if (paths.length === 0) continue;

        const unsetObj = {};
        for (const p of paths) {
          unsetObj[p] = '';
        }

        bulkOps.push({
          updateOne: {
            filter: { _id: doc._id },
            update: { $unset: unsetObj },
          },
        });

        totalFields += paths.length;

        // Flush in batches of 500 to limit memory usage.
        if (bulkOps.length >= 500) {
          const result = await collection.bulkWrite(bulkOps, { ordered: false });
          totalDocuments += result.modifiedCount;
          bulkOps.length = 0;
        }
      }

      // Flush remaining operations.
      if (bulkOps.length > 0) {
        const result = await collection.bulkWrite(bulkOps, { ordered: false });
        totalDocuments += result.modifiedCount;
      }
    }

    console.log(
      `Stripped empty-string fields from ${totalDocuments} document(s) (${totalFields} field(s) total)`,
    );
  },

  async down() {
    // Cannot restore original empty-string values — they carry no meaningful data.
    console.log('down migration is a no-op: empty-string values cannot be restored');
  },
};
