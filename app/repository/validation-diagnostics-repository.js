'use strict';

const mongoose = require('mongoose');
const { isDeepStrictEqual } = require('util');
const repository = require('./validation-policy-repository');
const { assertEngineContext } = require('../lib/validation-engine-context');
const { marker, diagnostics } = require('../lib/validation-diagnostics');

// Collection order is stable because durable checkpoints store its index.
exports.models = [
  require('../models/attack-object-model'),
  require('../models/relationship-model'),
];
exports.countAll = async () =>
  (await Promise.all(exports.models.map((model) => model.countDocuments({})))).reduce(
    (sum, count) => sum + count,
    0,
  );
exports.hasPendingEvaluations = async () =>
  (
    await Promise.all(
      exports.models.map((model) =>
        model.collection.findOne(
          { 'workspace.evaluation_needed': true },
          { projection: { _id: 1 } },
        ),
      ),
    )
  ).some(Boolean);
exports.findBatch = (model, after, limit) =>
  model.collection
    .find(after ? { _id: { $gt: new mongoose.Types.ObjectId(after) } } : {})
    .sort({ _id: 1 })
    .limit(limit)
    .toArray();
exports.retrieve = (model, id) => model.collection.findOne({ _id: id });
exports.stream = (model) => model.collection.find({});

// Full STIX equality and observed workflow prevent publication against changed
// input. Global ordered tokens fence in-flight batches, including successful clears.
exports.publish = async function ({
  model,
  document,
  result,
  snapshot,
  publicationToken,
  claim,
  workspace,
}) {
  assertEngineContext(snapshot.engine_context);
  const currentFilter = repository.contextFilter(snapshot);
  if (claim) {
    currentFilter['reconciliation.claim_token'] = claim;
    currentFilter['reconciliation.lease_expires_at'] = { $gt: new Date() };
    currentFilter['reconciliation.status'] = 'running';
  }
  if (!(await repository.model.collection.findOne(currentFilter))) return false;
  const filter = {
    _id: document._id,
    stix: document.stix,
    'workspace.workflow': document.workspace?.workflow ?? { $exists: false },
    $or: [
      { 'workspace.evaluation_context.publication_token': { $exists: false } },
      { 'workspace.evaluation_context.publication_token': { $lte: publicationToken } },
    ],
  };
  const target = workspace ? { ...document, workspace } : document;
  const set = {
    'workspace.evaluation_context': marker(target, snapshot, publicationToken, result.outcome),
  };
  // Request metadata and diagnostics are committed together under the same CAS.
  if (workspace)
    for (const [key, value] of Object.entries(workspace)) {
      if (
        !['validation', 'evaluation_context', 'evaluation_needed'].includes(key) &&
        value !== undefined
      )
        set[`workspace.${key}`] = value;
    }
  const validation = diagnostics(result, snapshot);
  const update = { $set: set, $unset: { 'workspace.evaluation_needed': '' } };
  if (validation) {
    if (isDeepStrictEqual(document.workspace?.validation?.errors, validation.errors)) {
      validation.validated_at =
        document.workspace.validation.validated_at || validation.validated_at;
    }
    set['workspace.validation'] = validation;
  } else update.$unset['workspace.validation'] = '';
  const saved = await model.collection.updateOne(filter, update);
  return saved.matchedCount === 1;
};
