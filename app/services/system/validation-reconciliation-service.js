'use strict';

const { randomUUID } = require('crypto');
const policy = require('./validation-policy-service');
const repository = require('../../repository/validation-policy-repository');
const diagnostics = require('./validation-diagnostic-service');
const revisions = require('../../repository/validation-diagnostics-repository');
const models = revisions.models;
const logger = require('../../lib/logger');
const LEASE_MS = 30000;
let timer;
let active;
let stopped = true;

exports.claim = async function ({ owner = randomUUID(), leaseMs = LEASE_MS } = {}) {
  const snapshot = await policy.loadSnapshot();
  let current = await repository.readPolicy();
  // An insert and its recovery flag are one write. Poll the flag even after a
  // scan completes: an old operation can insert behind any saved checkpoint.
  // Reopening is idempotent; a crash before/after it leaves either the flag or
  // the pending intent durable. Concurrent publishers may cause one harmless scan.
  if (current.reconciliation.status === 'completed') {
    if (await revisions.hasPendingEvaluations()) {
      await repository.reopenReconciliation(snapshot);
      current = await repository.readPolicy();
    }
  }
  const intent = current.reconciliation;
  if (
    intent.status !== 'pending' &&
    !(intent.status === 'running' && intent.lease_expires_at <= new Date())
  )
    return null;
  const publicationToken = await repository.allocatePublicationToken(snapshot);
  if (publicationToken === null) return null;
  const claimToken = randomUUID();
  const claimedIntent = await repository.claimReconciliation(snapshot, {
    owner,
    claimToken,
    publicationToken,
    leaseMs,
  });
  return claimedIntent
    ? { snapshot, publicationToken, claimToken, intent: claimedIntent, leaseMs }
    : null;
};

exports.processClaim = async function (
  claim,
  { batchSize = 100, maxBatches = Infinity, shouldStop = () => false } = {},
) {
  const { snapshot, publicationToken, claimToken, leaseMs } = claim;
  let checkpoint = claim.intent.checkpoint || { collection: 0, after: null };
  const counts = { ...claim.intent.counts };
  let total = claim.intent.total;
  let renewal, renewalError;
  let owned = true;
  // Keep ownership during awaited counting, reads and publication. Share each
  // renewal with the scan so slow Mongo responses cannot overlap heartbeats.
  const renewLease = async () => {
    if (renewalError) throw renewalError;
    if (!owned) return false;
    if (!renewal) {
      renewal = repository
        .renewReconciliation(snapshot, claimToken, leaseMs, total)
        .then((renewed) => (owned = renewed))
        .catch((error) => {
          renewalError = error;
          return false;
        })
        .finally(() => {
          renewal = null;
        });
    }
    const renewed = await renewal;
    if (renewalError) throw renewalError;
    return renewed;
  };
  const heartbeat = setInterval(
    () => {
      // The scan observes renewalError and records it through its failure path.
      renewLease().catch(() => {});
    },
    Math.max(1, Math.floor(leaseMs / 3)),
  );
  heartbeat.unref();
  try {
    if (!(await renewLease())) return { status: 'superseded' };
    if (total === undefined) total = await revisions.countAll();
    let batches = 0;
    while (checkpoint.collection < models.length && batches++ < maxBatches && !shouldStop()) {
      const renewed = await renewLease();
      if (!renewed) return { status: 'superseded' };
      const model = models[checkpoint.collection];
      const documents = await revisions.findBatch(model, checkpoint.after, batchSize);
      for (const document of documents) {
        let observed = document;
        let result;
        for (let attempt = 0; observed && attempt < 5; attempt++) {
          if (renewalError) throw renewalError;
          if (!owned) return { status: 'superseded' };
          result = policy.evaluateObject(observed, snapshot, { enabled: true });
          const saved = await diagnostics.publish({
            model,
            document: observed,
            result,
            snapshot,
            publicationToken,
            claim: claimToken,
          });
          if (saved) break;
          if (!(await repository.ownsReconciliation(snapshot, claimToken)))
            return { status: 'superseded' };
          observed = await revisions.retrieve(model, document._id);
          if (
            !observed ||
            observed.workspace?.evaluation_context?.publication_token > publicationToken
          )
            break;
          if (attempt === 4)
            throw new Error('Revision remained busy during validation; retry reconciliation');
        }
        counts.scanned++;
        if (result) counts[result.outcome]++;
        checkpoint = { collection: checkpoint.collection, after: String(document._id) };
      }

      if (documents.length < batchSize)
        checkpoint = { collection: checkpoint.collection + 1, after: null };
      const completed = checkpoint.collection === models.length;
      total = completed ? counts.scanned : Math.max(total, counts.scanned);
      if (!(await renewLease())) return { status: 'superseded' };
      const written = await repository.checkpointReconciliation(snapshot, claimToken, {
        checkpoint,
        counts,
        total,
        completed,
      });
      if (!written) return { status: 'superseded' };
      if (completed) return { status: 'completed', counts };
    }
    return { status: 'running', counts, checkpoint };
  } catch (error) {
    await repository.failReconciliation(snapshot, claimToken, error);
    throw error;
  } finally {
    clearInterval(heartbeat);
    if (renewal) await renewal;
  }
};

exports.runOnce = async function (options = {}) {
  const claim = await exports.claim(options);
  return claim ? exports.processClaim(claim, options) : null;
};
exports.status = async function () {
  const snapshot = await policy.loadSnapshot();
  const document = await repository.readPolicy();
  // Return the latest intent, even when an edit raced the verified snapshot.
  const intent = document.reconciliation;
  return {
    status: intent.status,
    policy_revision: intent.desired_policy_revision,
    generation: intent.desired_generation,
    counts: intent.counts,
    checkpoint: intent.checkpoint,
    last_error: intent.error,
    progress: { processed: intent.counts.scanned, total: intent.total ?? null },
    engine_context: snapshot.engine_context,
  };
};
exports.retry = async function () {
  const snapshot = await policy.loadSnapshot();
  await repository.retryReconciliation(snapshot);
  return exports.status();
};
exports.start = async function ({ pollMs = 1000 } = {}) {
  await policy.loadSnapshot(); // Startup verifies; it never activates a different engine.
  if (!stopped) return;
  stopped = false;
  const tick = () => {
    active = exports
      .runOnce({ shouldStop: () => stopped })
      .catch((error) => logger.error(`[validation-reconciliation] ${error.message}`))
      .finally(() => {
        active = null;
        if (!stopped) {
          timer = setTimeout(tick, pollMs);
          timer.unref();
        }
      });
  };
  tick();
};
exports.stop = async function () {
  stopped = true;
  clearTimeout(timer);
  if (active) await active;
};
