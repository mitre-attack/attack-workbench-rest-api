'use strict';

const mongoose = require('mongoose');
const { isDeepStrictEqual } = require('util');
const model = require('../models/validation-policy-model');
const { BadRequestError, DatabaseError } = require('../exceptions');
const { normalizeRule, assertUniqueRules } = require('../lib/validation-policy-rules');
const {
  readEngineContext,
  sameEngineContext,
  assertEngineContext,
} = require('../lib/validation-engine-context');

const POLICY_ID = 'validation-policy';
const COLLECTION = 'validationPolicies';
const MAX_POLICY_BYTES = 8 * 1024 * 1024;
const MAX_RULES = 10000;

function pendingIntent(policy_revision, evaluation_generation, engine_context) {
  return {
    status: 'pending',
    desired_policy_revision: policy_revision,
    desired_generation: evaluation_generation,
    desired_engine_context: engine_context,
    counts: { scanned: 0, valid: 0, invalid: 0, exempt: 0, disabled: 0, unsupported: 0 },
    checkpoint: null,
    claim_token: null,
    owner: null,
    lease_expires_at: null,
    publication_token: null,
    error: null,
    requested_at: new Date(),
    started_at: null,
    completed_at: null,
  };
}

function assertPolicySize(policy) {
  // Normalize foreign-driver ObjectIds for this driver's BSON serializer.
  const serializable = {
    ...policy,
    rules: policy.rules.map((rule) => ({
      ...rule,
      _id: new mongoose.Types.ObjectId(String(rule._id)),
    })),
  };
  if (
    policy.rules.length > MAX_RULES ||
    mongoose.mongo.BSON.calculateObjectSize(serializable) > MAX_POLICY_BYTES
  ) {
    throw new BadRequestError({
      details: `Validation policy exceeds the ${MAX_RULES} rule or 8 MiB limit.`,
    });
  }
}

function contextFilter(snapshot) {
  return {
    _id: POLICY_ID,
    policy_revision: snapshot.policy_revision,
    evaluation_generation: snapshot.evaluation_generation,
    'engine_context.adm_version': snapshot.engine_context.adm_version,
    'engine_context.attack_spec_version': snapshot.engine_context.attack_spec_version,
    'engine_context.evaluator_version': snapshot.engine_context.evaluator_version,
  };
}

async function readPolicy() {
  return model.collection.findOne({ _id: POLICY_ID });
}

/** Final migration/explicit initialization only. Older legacy writers must be stopped. */
async function initialize({
  db = mongoose.connection.db,
  ObjectId = mongoose.Types.ObjectId,
  activateEngine = false,
} = {}) {
  const collection = db.collection(COLLECTION);
  let policy = await collection.findOne({ _id: POLICY_ID });
  if (!policy) {
    const legacy = await db.collection('validationbypassrules').find({}).toArray();
    const rules = legacy.map((rule) => ({
      ...normalizeRule(rule),
      _id: new ObjectId(String(rule._id)),
    }));
    for (const retirementStatus of ['revoked', 'deprecated']) {
      rules.push({
        ...normalizeRule({
          kind: 'object-exemption',
          name: `${retirementStatus === 'revoked' ? 'Revoked' : 'Deprecated'} ATT&CK objects`,
          enabled: true,
          retirementStatus,
          stixTypes: 'all',
        }),
        _id: new ObjectId(),
      });
    }
    assertUniqueRules(rules);
    const engine_context = readEngineContext();
    policy = {
      _id: POLICY_ID,
      rules,
      policy_revision: 1,
      evaluation_generation: 1,
      engine_context,
      defaults_seeded: true,
      publication_sequence: 0,
      reconciliation: pendingIntent(1, 1, engine_context),
    };
    assertPolicySize(policy);
    try {
      await collection.insertOne(policy);
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    policy = await collection.findOne({ _id: POLICY_ID });
  }
  if (!sameEngineContext(policy.engine_context, readEngineContext())) {
    if (!activateEngine) assertEngineContext(policy.engine_context);
    // Only an explicit upgrade invocation can activate a new engine.
    while (!sameEngineContext(policy.engine_context, readEngineContext())) {
      const engine_context = readEngineContext();
      const generation = policy.evaluation_generation + 1;
      const updated = await collection.updateOne(contextFilter(policy), {
        $set: {
          engine_context,
          evaluation_generation: generation,
          reconciliation: pendingIntent(policy.policy_revision, generation, engine_context),
        },
      });
      if (updated.modifiedCount) break;
      policy = await collection.findOne({ _id: POLICY_ID });
    }
    policy = await collection.findOne({ _id: POLICY_ID });
  }
  return policy;
}

/** Callback is synchronous and may be retried; return {rules, value}. No side effects. */
async function mutateRules(mutate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const policy = await readPolicy();
    if (!policy) return null;
    assertEngineContext(policy.engine_context);
    const { rules, value } = mutate(policy.rules);
    const normalized = rules.map((rule) => ({
      ...normalizeRule(rule),
      _id: new mongoose.Types.ObjectId(String(rule._id)),
    }));
    assertUniqueRules(normalized);
    if (isDeepStrictEqual(policy.rules, normalized)) return { value, policy };
    const revision = policy.policy_revision + 1;
    const generation = policy.evaluation_generation + 1;
    const next = {
      ...policy,
      rules: normalized,
      policy_revision: revision,
      evaluation_generation: generation,
      reconciliation: pendingIntent(revision, generation, policy.engine_context),
    };
    assertPolicySize(next);
    const updated = await model.collection.updateOne(contextFilter(policy), {
      $set: {
        rules: normalized,
        policy_revision: revision,
        evaluation_generation: generation,
        reconciliation: next.reconciliation,
      },
    });
    if (updated.modifiedCount) return { value, policy: next };
  }
  throw new DatabaseError({
    details:
      'Validation policy remained busy after 100 compare-and-set retries. Retry the operation.',
  });
}

/** Allocates an ordered token only if the supplied evaluation context is current. */
async function allocatePublicationToken(snapshot) {
  assertEngineContext(snapshot.engine_context);
  const result = await model.collection.findOneAndUpdate(
    contextFilter(snapshot),
    {
      $inc: { publication_sequence: 1 },
    },
    { returnDocument: 'after' },
  );
  return result?.publication_sequence ?? null;
}

function ownedReconciliation(snapshot, claimToken, now = new Date()) {
  return {
    ...contextFilter(snapshot),
    'reconciliation.status': 'running',
    'reconciliation.claim_token': claimToken,
    'reconciliation.lease_expires_at': { $gt: now },
  };
}

async function reopenReconciliation(snapshot) {
  return model.collection.updateOne(
    { ...contextFilter(snapshot), 'reconciliation.status': 'completed' },
    {
      $set: {
        reconciliation: pendingIntent(
          snapshot.policy_revision,
          snapshot.evaluation_generation,
          snapshot.engine_context,
        ),
      },
    },
  );
}

async function claimReconciliation(snapshot, { owner, claimToken, publicationToken, leaseMs }) {
  const now = new Date();
  const document = await model.collection.findOneAndUpdate(
    {
      ...contextFilter(snapshot),
      $or: [
        { 'reconciliation.status': 'pending' },
        { 'reconciliation.status': 'running', 'reconciliation.lease_expires_at': { $lte: now } },
      ],
    },
    {
      $set: {
        'reconciliation.status': 'running',
        'reconciliation.owner': owner,
        'reconciliation.claim_token': claimToken,
        'reconciliation.publication_token': publicationToken,
        'reconciliation.lease_expires_at': new Date(now.getTime() + leaseMs),
        'reconciliation.started_at': now,
        'reconciliation.error': null,
      },
    },
    { returnDocument: 'after' },
  );
  return document?.reconciliation ?? null;
}

async function ownsReconciliation(snapshot, claimToken) {
  return Boolean(await model.collection.findOne(ownedReconciliation(snapshot, claimToken)));
}

async function renewReconciliation(snapshot, claimToken, leaseMs, total) {
  const result = await model.collection.updateOne(ownedReconciliation(snapshot, claimToken), {
    $set: {
      'reconciliation.lease_expires_at': new Date(Date.now() + leaseMs),
      ...(total === undefined ? {} : { 'reconciliation.total': total }),
    },
  });
  return result.matchedCount === 1;
}

async function checkpointReconciliation(
  snapshot,
  claimToken,
  { checkpoint, counts, total, completed },
) {
  const update = {
    'reconciliation.checkpoint': checkpoint,
    'reconciliation.counts': counts,
    'reconciliation.total': total,
  };
  if (completed)
    Object.assign(update, {
      'reconciliation.status': 'completed',
      'reconciliation.completed_at': new Date(),
      'reconciliation.claim_token': null,
      'reconciliation.owner': null,
      'reconciliation.lease_expires_at': null,
    });
  const result = await model.collection.updateOne(ownedReconciliation(snapshot, claimToken), {
    $set: update,
  });
  return result.matchedCount === 1;
}

async function failReconciliation(snapshot, claimToken, error) {
  return model.collection.updateOne(ownedReconciliation(snapshot, claimToken), {
    $set: {
      'reconciliation.status': 'failed',
      'reconciliation.error': { message: String(error.message).slice(0, 2000), at: new Date() },
      'reconciliation.lease_expires_at': null,
    },
  });
}

async function retryReconciliation(snapshot) {
  return model.collection.updateOne(
    { ...contextFilter(snapshot), 'reconciliation.status': 'failed' },
    {
      $set: {
        'reconciliation.status': 'pending',
        'reconciliation.error': null,
        'reconciliation.claim_token': null,
        'reconciliation.owner': null,
        'reconciliation.lease_expires_at': null,
      },
    },
  );
}

module.exports = {
  reopenReconciliation,
  claimReconciliation,
  ownsReconciliation,
  renewReconciliation,
  checkpointReconciliation,
  failReconciliation,
  retryReconciliation,
  model,
  POLICY_ID,
  COLLECTION,
  MAX_POLICY_BYTES,
  MAX_RULES,
  pendingIntent,
  assertPolicySize,
  contextFilter,
  readPolicy,
  initialize,
  mutateRules,
  allocatePublicationToken,
};
