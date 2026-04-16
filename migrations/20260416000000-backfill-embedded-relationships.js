'use strict';

/**
 * Backfill `workspace.embedded_relationships` on latest documents.
 *
 * Legacy databases created before the embedded-relationships feature have no
 * `workspace.embedded_relationships` on any document.  This migration rebuilds
 * them from the authoritative `_ref` / `_refs` STIX fields so that the
 * Workbench UI and API consumers can resolve cross-document links without
 * performing expensive joins.
 *
 * **Scope (Phase 1):**
 *   Detection Strategies  →  Analytics  →  Data Components  →  Data Sources
 *
 * Only the *latest* version of each STIX object (highest `stix.modified` per
 * `stix.id`) is processed.  Embedded relationships reference the full lineage
 * of an object via `stix.id`; pinning to a specific version would require
 * tracking `stix.modified` as well and is deferred for now.
 *
 * The migration is idempotent — running it multiple times produces the same
 * result because it always rebuilds from the source-of-truth STIX fields.
 */

const TARGETED_TYPES = [
  'x-mitre-detection-strategy',
  'x-mitre-analytic',
  'x-mitre-data-component',
  'x-mitre-data-source',
];

const BATCH_SIZE = 500;

/**
 * Aggregation pipeline that returns one document per `stix.id` — the version
 * with the most recent `stix.modified` — filtered to the STIX types we care
 * about.
 */
function latestDocsPipeline(types) {
  return [
    { $match: { 'stix.type': { $in: types } } },
    { $sort: { 'stix.id': 1, 'stix.modified': -1 } },
    {
      $group: {
        _id: '$stix.id',
        doc: { $first: '$$ROOT' },
      },
    },
    { $replaceRoot: { newRoot: '$doc' } },
  ];
}

// ─── Relationship extractors ────────────────────────────────────────────────
// Each function returns an array of { stix_id, direction } objects describing
// the *outbound* refs that a document declares via its STIX fields.

function extractDetectionStrategyOutbound(doc) {
  return (doc.stix?.x_mitre_analytic_refs || []).map((ref) => ({
    stix_id: ref,
    direction: 'outbound',
  }));
}

function extractAnalyticOutbound(doc) {
  return (doc.stix?.x_mitre_log_source_references || [])
    .filter((ref) => ref.x_mitre_data_component_ref)
    .map((ref) => ({
      stix_id: ref.x_mitre_data_component_ref,
      direction: 'outbound',
    }));
}

function extractDataComponentOutbound(doc) {
  const ref = doc.stix?.x_mitre_data_source_ref;
  if (!ref) return [];
  return [{ stix_id: ref, direction: 'outbound' }];
}

// ─── Reverse-index builders ─────────────────────────────────────────────────
// Build maps of  targetStixId → [{ stix_id, attack_id }]  so that we can
// efficiently attach *inbound* relationships to the target documents.

function buildReverseIndex(latestDocs, sourceType, refExtractor) {
  const index = new Map();
  for (const doc of latestDocs) {
    if (doc.stix?.type !== sourceType) continue;
    for (const outbound of refExtractor(doc)) {
      if (!index.has(outbound.stix_id)) index.set(outbound.stix_id, []);
      index.get(outbound.stix_id).push({
        stix_id: doc.stix.id,
        attack_id: doc.workspace?.attack_id || null,
      });
    }
  }
  return index;
}

module.exports = {
  async up(db) {
    const collection = db.collection('attackObjects');

    // ── 1. Load latest documents for all targeted types ───────────────────
    const latestDocs = await collection.aggregate(latestDocsPipeline(TARGETED_TYPES)).toArray();

    console.log(`Loaded ${latestDocs.length} latest document(s) across targeted types`);

    // ── 2. Build lookup:  stix.id → attack_id  ───────────────────────────
    const attackIdLookup = new Map();
    for (const doc of latestDocs) {
      attackIdLookup.set(doc.stix.id, doc.workspace?.attack_id || null);
    }

    // ── 3. Build reverse indexes for inbound relationships ───────────────
    //
    //   Detection Strategy  → Analytics           (analytics receive inbound)
    //   Analytics            → Data Components     (data components receive inbound)
    //   Data Components      → Data Sources        (data sources receive inbound)
    const analyticsInbound = buildReverseIndex(
      latestDocs,
      'x-mitre-detection-strategy',
      extractDetectionStrategyOutbound,
    );
    const dataComponentsInbound = buildReverseIndex(
      latestDocs,
      'x-mitre-analytic',
      extractAnalyticOutbound,
    );
    const dataSourcesInbound = buildReverseIndex(
      latestDocs,
      'x-mitre-data-component',
      extractDataComponentOutbound,
    );

    // ── 4. Build embedded_relationships per document ─────────────────────
    let ops = [];
    const counts = { set: 0, unset: 0 };

    for (const doc of latestDocs) {
      const type = doc.stix?.type;
      const relationships = [];

      // ─ Outbound ─
      let outbound = [];
      if (type === 'x-mitre-detection-strategy') {
        outbound = extractDetectionStrategyOutbound(doc);
      } else if (type === 'x-mitre-analytic') {
        outbound = extractAnalyticOutbound(doc);
      } else if (type === 'x-mitre-data-component') {
        outbound = extractDataComponentOutbound(doc);
      }
      // Data sources have no outbound refs in this scope

      for (const rel of outbound) {
        relationships.push({
          stix_id: rel.stix_id,
          attack_id: attackIdLookup.get(rel.stix_id) || null,
          direction: 'outbound',
        });
      }

      // ─ Inbound ─
      let inbound = [];
      if (type === 'x-mitre-analytic') {
        inbound = analyticsInbound.get(doc.stix.id) || [];
      } else if (type === 'x-mitre-data-component') {
        inbound = dataComponentsInbound.get(doc.stix.id) || [];
      } else if (type === 'x-mitre-data-source') {
        inbound = dataSourcesInbound.get(doc.stix.id) || [];
      }

      for (const rel of inbound) {
        relationships.push({
          stix_id: rel.stix_id,
          attack_id: rel.attack_id,
          direction: 'inbound',
        });
      }

      // ─ Write ─
      if (relationships.length > 0) {
        ops.push({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: { 'workspace.embedded_relationships': relationships } },
          },
        });
        counts.set++;
      } else {
        // No relationships — ensure stale data is cleared (idempotency)
        ops.push({
          updateOne: {
            filter: { _id: doc._id, 'workspace.embedded_relationships': { $exists: true } },
            update: { $unset: { 'workspace.embedded_relationships': '' } },
          },
        });
        counts.unset++;
      }

      // Flush batch
      if (ops.length >= BATCH_SIZE) {
        await collection.bulkWrite(ops, { ordered: false });
        ops = [];
      }
    }

    // Flush remaining ops
    if (ops.length > 0) {
      await collection.bulkWrite(ops, { ordered: false });
    }

    console.log(
      `Backfill complete: set embedded_relationships on ${counts.set} document(s), ` +
        `cleared stale data on up to ${counts.unset} document(s)`,
    );
  },

  async down(db) {
    // Remove all embedded_relationships set by this migration for the targeted types
    const collection = db.collection('attackObjects');

    for (const type of TARGETED_TYPES) {
      const result = await collection.updateMany(
        {
          'stix.type': type,
          'workspace.embedded_relationships': { $exists: true },
        },
        { $unset: { 'workspace.embedded_relationships': '' } },
      );
      console.log(
        `Removed workspace.embedded_relationships from ${result.modifiedCount} ${type} document(s)`,
      );
    }
  },
};
