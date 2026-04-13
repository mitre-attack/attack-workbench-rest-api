'use strict';

/**
 * Backfill `workspace.validation` on all STIX documents.
 *
 * Runs ADM (Attack Data Model) validation against every document in the
 * `attackObjects` and `relationships` collections. Documents that fail
 * validation get `workspace.validation` set with the error details, ADM/spec
 * versions, and a timestamp. Documents that pass have any stale
 * `workspace.validation` removed so only invalid documents carry the field.
 *
 * This ensures pre-existing and manually-created objects receive the same
 * validation metadata that the import pipeline writes via
 * `BaseService._createFromImport`.
 */

const { getSchema } = require('../app/lib/validation-schemas');

/**
 * Recursively convert Date instances to ISO strings.
 * MongoDB stores timestamps as BSON Date objects, but the ADM Zod schemas
 * expect RFC3339 strings (z.iso.datetime). Without this conversion,
 * `created` and `modified` fields always fail with `invalid_type`.
 */
function serializeDates(obj) {
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(serializeDates);
  if (obj !== null && typeof obj === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(obj)) {
      out[key] = serializeDates(val);
    }
    return out;
  }
  return obj;
}

module.exports = {
  async up(db) {
    const { ATTACK_SPEC_VERSION } = require('@mitre-attack/attack-data-model');
    const admPkg = require('@mitre-attack/attack-data-model/package.json');

    const BATCH_SIZE = 500;

    // EventBus + bypass listener may not be wired up during migrations,
    // so we load the bypass rules directly for filtering.
    let bypassRules = [];
    try {
      const bypassDocs = await db.collection('validationbypassrules').find({}).toArray(); // Mongoose pluralizes "ValidationBypassRule"
      bypassRules = bypassDocs || [];
    } catch {
      // Collection may not exist yet — proceed without bypass rules
    }

    const collections = ['attackObjects', 'relationships'];
    let totalValidated = 0;
    let totalErrored = 0;
    let totalCleared = 0;

    for (const collectionName of collections) {
      const collection = db.collection(collectionName);
      const totalDocs = await collection.countDocuments({});
      let collectionValidated = 0;

      console.log(`[${collectionName}] Starting validation of ${totalDocs} documents...`);

      // Target ALL objects (including non-latest, revoked, and deprecated)
      const cursor = collection.find({}).batchSize(BATCH_SIZE);
      let ops = [];

      while (await cursor.hasNext()) {
        const doc = await cursor.next();
        totalValidated++;
        collectionValidated++;

        const stixType = doc.stix?.type;
        if (!stixType) continue;

        const status = doc.workspace?.workflow?.state || 'reviewed';
        const schema = getSchema(stixType, status);
        if (!schema) continue;

        const result = schema.safeParse(serializeDates(doc.stix));

        if (result.success) {
          // Valid — remove any stale validation errors
          if (doc.workspace?.validation) {
            ops.push({
              updateOne: {
                filter: { _id: doc._id },
                update: { $unset: { 'workspace.validation': '' } },
              },
            });
            totalCleared++;
          }
          continue;
        }

        // Convert Zod issues to error objects
        let errors = result.error.issues.map((issue) => ({
          message: `${issue.path.join('.')} is ${issue.message}`,
          path: issue.path,
          code: issue.code,
        }));

        // Apply bypass rules (mirrors ValidationBypassesService.checkBypassRule logic)
        if (bypassRules.length > 0) {
          errors = errors.filter((error) => {
            const errorPathStr = JSON.stringify(error.path.map(String));
            return !bypassRules.some((rule) => {
              if (!rule.suppressError && !rule.warningMessage) return false;
              if (rule.stixType !== 'all' && rule.stixType !== stixType) return false;
              if (rule.errorCode !== error.code) return false;
              const rulePathStr = JSON.stringify(rule.fieldPath.map(String));
              return rulePathStr === errorPathStr;
            });
          });
        }

        if (errors.length === 0) {
          // All errors were bypassed — clear stale validation
          if (doc.workspace?.validation) {
            ops.push({
              updateOne: {
                filter: { _id: doc._id },
                update: { $unset: { 'workspace.validation': '' } },
              },
            });
            totalCleared++;
          }
          continue;
        }

        // Set validation errors on the document
        ops.push({
          updateOne: {
            filter: { _id: doc._id },
            update: {
              $set: {
                'workspace.validation': {
                  errors: errors.map((e) => ({
                    message: e.message,
                    path: e.path,
                    code: e.code,
                  })),
                  attack_spec_version: ATTACK_SPEC_VERSION,
                  adm_version: admPkg.version,
                  validated_at: new Date(),
                },
              },
            },
          },
        });
        totalErrored++;

        // Flush batch when it reaches BATCH_SIZE
        if (ops.length >= BATCH_SIZE) {
          await collection.bulkWrite(ops, { ordered: false });
          ops = [];
        }

        // Progress reporting
        if (collectionValidated % 10000 === 0) {
          console.log(
            `  [${collectionName}] ${collectionValidated} / ${totalDocs} processed ` +
              `(${totalErrored} errors, ${totalCleared} cleared)`,
          );
        }
      }

      // Flush remaining ops
      if (ops.length > 0) {
        await collection.bulkWrite(ops, { ordered: false });
      }

      console.log(`[${collectionName}] Done — ${collectionValidated} documents processed.`);
    }

    console.log(
      `Validation backfill complete: ${totalValidated} documents validated, ` +
        `${totalErrored} with errors, ${totalCleared} stale validations cleared`,
    );
  },

  async down(db) {
    // Remove all workspace.validation fields set by this migration
    const collections = ['attackObjects', 'relationships'];
    for (const collectionName of collections) {
      const result = await db
        .collection(collectionName)
        .updateMany(
          { 'workspace.validation': { $exists: true } },
          { $unset: { 'workspace.validation': '' } },
        );
      console.log(
        `Removed workspace.validation from ${result.modifiedCount} document(s) in ${collectionName}`,
      );
    }
  },
};
