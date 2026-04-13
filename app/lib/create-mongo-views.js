'use strict';

const logger = require('./logger');
const mongoose = require('mongoose');

/**
 * Create or update a single MongoDB view.
 * Uses `collMod` if the view already exists, `create` otherwise — making the operation idempotent.
 */
async function createOrUpdateView(db, viewName, viewOn, pipeline) {
  const collections = await db.listCollections({ name: viewName }, { nameOnly: true }).toArray();
  const command = collections.length ? 'collMod' : 'create';
  const label = command === 'create' ? 'Creating' : 'Modifying';
  logger.info(`${label} view ${viewName}`);
  await db.command({ [command]: viewName, viewOn, pipeline });
}

// ---------------------------------------------------------------------------
// Pipeline fragments
// ---------------------------------------------------------------------------
const SORT_DOCUMENTS = [{ $sort: { 'stix.id': 1, 'stix.modified': -1 } }];

const LATEST_DOCUMENTS = [
  { $sort: { 'stix.id': 1, 'stix.modified': -1 } },
  { $group: { _id: '$stix.id', document: { $first: '$$ROOT' } } },
  { $replaceRoot: { newRoot: '$document' } },
];

const ACTIVE_FILTER = [
  { $match: { 'stix.x_mitre_deprecated': { $in: [null, false] } } },
  { $match: { 'stix.revoked': { $in: [null, false] } } },
];

const DEPRECATED_FILTER = [{ $match: { 'stix.x_mitre_deprecated': true } }];
const REVOKED_FILTER = [{ $match: { 'stix.revoked': true } }];

// ---------------------------------------------------------------------------
// View generators
// ---------------------------------------------------------------------------

/**
 * Create the base set of views for a given collection (no type filter).
 *  - view.<collection>.{all,latest}
 *  - view.<collection>.{all,latest}.{active,deprecated,revoked}
 *  - view.<collection>.{all,latest}.{active.deprecated,active.revoked,deprecated.revoked}
 */
async function createBaseViews(db, viewType) {
  const variants = [
    { suffix: 'all', pipeline: SORT_DOCUMENTS },
    { suffix: 'all.active', pipeline: [...SORT_DOCUMENTS, ...ACTIVE_FILTER] },
    { suffix: 'all.deprecated', pipeline: [...SORT_DOCUMENTS, ...DEPRECATED_FILTER] },
    { suffix: 'all.revoked', pipeline: [...SORT_DOCUMENTS, ...REVOKED_FILTER] },
    { suffix: 'latest', pipeline: LATEST_DOCUMENTS },
    { suffix: 'latest.active', pipeline: [...LATEST_DOCUMENTS, ...ACTIVE_FILTER] },
    { suffix: 'latest.deprecated', pipeline: [...LATEST_DOCUMENTS, ...DEPRECATED_FILTER] },
    { suffix: 'latest.revoked', pipeline: [...LATEST_DOCUMENTS, ...REVOKED_FILTER] },
  ];

  for (const { suffix, pipeline } of variants) {
    await createOrUpdateView(db, `view.${viewType}.${suffix}`, viewType, pipeline);
  }

  // Union views
  const unionCombinations = [
    { base: 'active', extra: 'deprecated' },
    { base: 'active', extra: 'revoked' },
    { base: 'deprecated', extra: 'revoked' },
  ];
  for (const scope of ['all', 'latest']) {
    for (const { base, extra } of unionCombinations) {
      await createOrUpdateView(
        db,
        `view.${viewType}.${scope}.${base}.${extra}`,
        `view.${viewType}.${scope}.${base}`,
        [{ $unionWith: { coll: `view.${viewType}.${scope}.${extra}` } }],
      );
    }
  }
}

/**
 * Create filtered views for specific STIX types / relationship types.
 */
async function createFilteredViews(db, viewType, typeToFilter) {
  for (const [itemType, mongoFilter] of Object.entries(typeToFilter)) {
    const sourceCollection = ['sdo', 'smo'].includes(viewType) ? 'attackObjects' : 'relationships';
    const matchField = ['sdo', 'smo'].includes(viewType) ? 'stix.type' : 'stix.relationship_type';
    const matchStage = { $match: { [matchField]: mongoFilter } };

    const keys = [
      { key: 'all', pipeline: [matchStage, ...SORT_DOCUMENTS] },
      { key: 'all.active', pipeline: [matchStage, ...SORT_DOCUMENTS, ...ACTIVE_FILTER] },
      { key: 'all.deprecated', pipeline: [matchStage, ...SORT_DOCUMENTS, ...DEPRECATED_FILTER] },
      { key: 'all.revoked', pipeline: [matchStage, ...SORT_DOCUMENTS, ...REVOKED_FILTER] },
      { key: 'latest', pipeline: [matchStage, ...LATEST_DOCUMENTS] },
      { key: 'latest.active', pipeline: [matchStage, ...LATEST_DOCUMENTS, ...ACTIVE_FILTER] },
      {
        key: 'latest.deprecated',
        pipeline: [matchStage, ...LATEST_DOCUMENTS, ...DEPRECATED_FILTER],
      },
      { key: 'latest.revoked', pipeline: [matchStage, ...LATEST_DOCUMENTS, ...REVOKED_FILTER] },
    ];

    const viewNames = {};
    for (const { key, pipeline } of keys) {
      const viewName = `view.${viewType}.${key}.${itemType}`;
      viewNames[key] = viewName;
      await createOrUpdateView(db, viewName, sourceCollection, pipeline);
    }

    // Union views
    const unionCombinations = [
      { base: 'active', extra: 'deprecated' },
      { base: 'active', extra: 'revoked' },
      { base: 'deprecated', extra: 'revoked' },
    ];
    for (const scope of ['all', 'latest']) {
      for (const { base, extra } of unionCombinations) {
        await createOrUpdateView(
          db,
          `view.${viewType}.${scope}.${itemType}.${base}.${extra}`,
          viewNames[`${scope}.${base}`],
          [{ $unionWith: { coll: viewNames[`${scope}.${extra}`] } }],
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

const ATTACK_TYPE_TO_MONGO_FILTER = {
  assets: 'asset',
  campaigns: 'campaign',
  datacomponents: 'x-mitre-data-component',
  datasources: 'x-mitre-data-source',
  identities: 'identity',
  groups: 'intrusion-set',
  matrices: 'x-mitre-matrix',
  mitigations: 'course-of-action',
  software: { $in: ['malware', 'tool'] },
  tactics: 'x-mitre-tactic',
  techniques: 'attack-pattern',
  collections: 'x-mitre-collection',
  analytics: 'x-mitre-analytic',
  detectionstrategies: 'x-mitre-detection-strategy',
};

const RELATIONSHIP_TYPES = [
  'uses',
  'mitigates',
  'detects',
  'revoked-by',
  'subtechnique-of',
  'attributed-to',
  'targets',
];

/**
 * Ensure all MongoDB views exist (creates or updates as needed).
 * Safe to call on every startup — fully idempotent.
 */
exports.createMongoViews = async function createMongoViews() {
  const db = mongoose.connection.getClient().db();

  logger.info('Ensuring MongoDB views are up to date...');

  // Base collection views
  await createBaseViews(db, 'attackObjects');
  await createBaseViews(db, 'relationships');

  // Filtered SDO views
  await createFilteredViews(db, 'sdo', ATTACK_TYPE_TO_MONGO_FILTER);

  // Filtered SRO views
  const sroFilter = {};
  for (const t of RELATIONSHIP_TYPES) {
    sroFilter[t] = t;
  }
  await createFilteredViews(db, 'sro', sroFilter);

  // Filtered SMO views
  await createFilteredViews(db, 'smo', { 'marking-definitions': 'marking-definition' });

  logger.info('MongoDB views are up to date');
};
