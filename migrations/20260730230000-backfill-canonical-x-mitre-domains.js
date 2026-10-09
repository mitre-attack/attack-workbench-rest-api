'use strict';

/**
 * Backfill canonical x_mitre_domains values where exact collection TOC
 * provenance exists, then retire the historical validation bypasses only when
 * no domainless objects remain.
 *
 * Domain membership is inferred from exact object pins in canonical ATT&CK
 * collection TOCs. `workspace.collections` is deliberately not authoritative:
 * legacy imports attached it to secondary graph objects as well as primary
 * collection members. This keeps the migration release-agnostic while
 * preserving real multi-domain unions. Objects without mappable TOC
 * provenance are left unchanged: absence of evidence is not evidence of
 * Enterprise membership.
 *
 * Active latest revisions use the ordinary POST/create service pipeline so
 * validation, lifecycle hooks, events, release-track member sync, and audit
 * behavior match an operator-created revision.
 *
 * Revoked or deprecated latest revisions cannot reliably traverse that
 * workflow's lifecycle guardrails. They are copied directly as a new
 * immutable revision with a bumped modified timestamp. Only release-track
 * member sync is invoked for this exceptional path: emitting a generic
 * created event would falsely imply that every normal lifecycle hook ran and
 * could trigger unrelated active-content side effects. The prior revision is
 * never mutated.
 */

const mongoose = require('mongoose');
const config = require('../app/config/config');
const {
  createAutomationRunRecorder,
  serializeError,
} = require('../app/lib/automation-run-recorder');
const logger = require('../app/lib/logger');
const systemConfigurationRepository = require('../app/repository/system-configurations-repository');
const validationBypassesService = require('../app/services/system/validation-bypasses-service');

const MIGRATION_NAME = '20260730230000-backfill-canonical-x-mitre-domains';
const TARGET_TYPES = [
  'attack-pattern',
  'campaign',
  'course-of-action',
  'intrusion-set',
  'malware',
  'tool',
  'x-mitre-analytic',
  'x-mitre-asset',
  'x-mitre-data-component',
  'x-mitre-data-source',
  'x-mitre-detection-strategy',
  'x-mitre-matrix',
  'x-mitre-tactic',
];
const TARGET_TYPE_SET = new Set(TARGET_TYPES);
const BATCH_SIZE = 50;
const ACTIVE_CONCURRENCY = 4;
const SERIAL_ACTIVE_TYPES = new Set([
  'x-mitre-analytic',
  'x-mitre-data-component',
  'x-mitre-detection-strategy',
]);

const CANONICAL_COLLECTION_DOMAINS = new Map([
  ['x-mitre-collection--1f5f1533-f617-4ca8-9ab4-6a02367fa019', 'enterprise-attack'],
  ['x-mitre-collection--90c00720-636b-4485-b342-8751d232bf09', 'ics-attack'],
  ['x-mitre-collection--dac0d2d7-8653-445c-9bff-82f934c1e858', 'mobile-attack'],
]);

const SERVICE_MODULE_BY_TYPE = {
  'attack-pattern': '../app/services/stix/techniques-service',
  campaign: '../app/services/stix/campaigns-service',
  'course-of-action': '../app/services/stix/mitigations-service',
  'intrusion-set': '../app/services/stix/groups-service',
  malware: '../app/services/stix/software-service',
  tool: '../app/services/stix/software-service',
  'x-mitre-analytic': '../app/services/stix/analytics-service',
  'x-mitre-asset': '../app/services/stix/assets-service',
  'x-mitre-data-component': '../app/services/stix/data-components-service',
  'x-mitre-data-source': '../app/services/stix/data-sources-service',
  'x-mitre-detection-strategy': '../app/services/stix/detection-strategies-service',
  'x-mitre-matrix': '../app/services/stix/matrices-service',
  'x-mitre-tactic': '../app/services/stix/tactics-service',
};

let memberSyncService;

function chunkItems(items, size = BATCH_SIZE) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function hasCanonicalDomains(document) {
  return Array.isArray(document?.stix?.x_mitre_domains) && document.stix.x_mitre_domains.length > 0;
}

function canonicalRevisionKey(stixId, modified) {
  return `${stixId}\0${new Date(modified).toISOString()}`;
}

async function buildCanonicalTocDomainIndex(db) {
  const collectionDocuments = await db
    .collection('attackObjects')
    .find({
      'stix.id': { $in: [...CANONICAL_COLLECTION_DOMAINS.keys()] },
      'stix.type': 'x-mitre-collection',
    })
    .project({ 'stix.id': 1, 'stix.x_mitre_contents': 1 })
    .toArray();
  const domainsByRevision = new Map();

  for (const collection of collectionDocuments) {
    const domain = CANONICAL_COLLECTION_DOMAINS.get(collection.stix.id);
    for (const entry of collection.stix.x_mitre_contents || []) {
      if (!entry?.object_ref || !entry?.object_modified) continue;
      const key = canonicalRevisionKey(entry.object_ref, entry.object_modified);
      const domains = domainsByRevision.get(key) || new Set();
      domains.add(domain);
      domainsByRevision.set(key, domains);
    }
  }

  return new Map([...domainsByRevision].map(([key, domains]) => [key, [...domains].sort()]));
}

function domainsFromCanonicalToc(document, domainsByRevision) {
  return (
    domainsByRevision.get(canonicalRevisionKey(document.stix.id, document.stix.modified)) || []
  );
}

function isInactive(document) {
  return document?.stix?.revoked === true || document?.stix?.x_mitre_deprecated === true;
}

function nextModifiedTimestamp(existingModified) {
  const now = Date.now();
  const existing = new Date(existingModified).getTime();
  const next = Number.isFinite(existing) ? Math.max(now, existing + 1) : now;
  return new Date(next);
}

function latestTargetDocumentsPipeline() {
  return [
    { $match: { 'stix.type': { $in: TARGET_TYPES } } },
    { $sort: { 'stix.id': 1, 'stix.modified': -1 } },
    { $group: { _id: '$stix.id', document: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$document' } },
  ];
}

async function latestDomainlessTargetDocuments(db) {
  const documents = await db
    .collection('attackObjects')
    .aggregate(latestTargetDocumentsPipeline())
    .toArray();
  return documents.filter((document) => !hasCanonicalDomains(document));
}

function resolveCandidates(documents, domainsByRevision = new Map()) {
  const candidates = [];

  for (const document of documents) {
    const stixType = document?.stix?.type;

    if (!TARGET_TYPE_SET.has(stixType)) {
      throw new Error(`Unsupported canonical-domain migration type: ${stixType}`);
    }

    const provenanceDomains = domainsFromCanonicalToc(document, domainsByRevision);
    if (provenanceDomains.length === 0) continue;
    candidates.push({
      document,
      domains: provenanceDomains,
      domainSource: 'canonical-collection-toc',
      lifecycle: isInactive(document) ? 'inactive' : 'active',
    });
  }

  return candidates;
}

function ensureMongooseUsesClient(client) {
  if (client && mongoose.connection.readyState === 0) {
    mongoose.connection.setClient(client);
  }
}

async function prepareServiceLayer(client) {
  ensureMongooseUsesClient(client);

  // These listeners are ordinarily registered while Express routes load,
  // after migrate-mongo has finished. Load them explicitly so active reposts
  // have the same relationship, analytic, and release-track side effects as
  // a normal API create.
  require('../app/services/stix/attack-objects-service');
  require('../app/services/stix/analytics-service');
  memberSyncService = require('../app/services/release-tracks/member-sync-service');

  await validationBypassesService.loadStaticRules(config.configurationFiles.staticBypassRulesPath);
}

async function assertOrganizationIdentityConfigured() {
  const systemConfig = await systemConfigurationRepository.retrieveOne({ lean: true });
  if (!systemConfig?.organization_identity_ref) {
    throw new Error(
      'System configuration is missing organization_identity_ref; cannot repost active ' +
        'domainless objects through the normal create workflow.',
    );
  }
}

function serviceFor(stixType) {
  const modulePath = SERVICE_MODULE_BY_TYPE[stixType];
  if (!modulePath) {
    throw new Error(`No canonical-domain migration service is configured for ${stixType}`);
  }
  return require(modulePath);
}

function cloneForCreate(document, domains, modified) {
  const repost = JSON.parse(JSON.stringify(document));
  delete repost._id;
  delete repost.__v;
  delete repost.__t;
  repost.stix.modified = modified.toISOString();
  repost.stix.x_mitre_domains = domains;
  return repost;
}

function removeResolvedDomainValidation(workspace) {
  const replacement = { ...(workspace || {}) };
  delete replacement.release_tracks;

  const validation = replacement.validation;
  if (!validation || !Array.isArray(validation.errors)) {
    return replacement;
  }

  const remainingErrors = validation.errors.filter(
    (error) =>
      !(
        error?.code === 'invalid_type' &&
        Array.isArray(error.path) &&
        error.path.map(String).join('.') === 'x_mitre_domains'
      ),
  );

  if (remainingErrors.length === 0) {
    delete replacement.validation;
  } else {
    replacement.validation = {
      ...validation,
      errors: remainingErrors,
    };
  }

  return replacement;
}

async function repostActive(candidate, recorder) {
  const { document, domains } = candidate;
  const service = serviceFor(document.stix.type);
  const modified = nextModifiedTimestamp(document.stix.modified);
  const repost = cloneForCreate(document, domains, modified);
  const created = await service.create(repost, {
    import: false,
    automationContext: {
      automationName: MIGRATION_NAME,
      runId: recorder.runId,
    },
  });

  return {
    method: 'service-create',
    modified: new Date(created.stix.modified),
    document: created,
  };
}

function prepareInactiveClone(candidate) {
  const { document, domains } = candidate;
  const modified = nextModifiedTimestamp(document.stix.modified);
  const replacement = {
    ...document,
    workspace: removeResolvedDomainValidation(document.workspace),
    stix: {
      ...document.stix,
      modified,
      x_mitre_domains: domains,
    },
  };
  delete replacement._id;
  delete replacement.__v;

  return {
    method: 'inactive-clone',
    modified,
    document: replacement,
  };
}

async function syncInactiveClone(candidate, result, recorder) {
  const { document } = candidate;
  // The direct clone is intentionally not presented as a generic create. It
  // still advances any standard track that references this object, matching
  // the part of the ordinary revision workflow that release tracks own.
  await memberSyncService.handleObjectModified({
    objectRef: document.stix.id,
    newModified: result.modified,
    modifiedBy: 'system',
    trigger: document.stix.revoked === true ? 'revocation' : 'new-revision',
    automationContext: {
      automationName: MIGRATION_NAME,
      runId: recorder.runId,
    },
  });
}

async function processActiveBatch(candidates, recorder, concurrency) {
  return mapWithConcurrency(candidates, concurrency, async (candidate) => {
    try {
      return {
        candidate,
        result: await repostActive(candidate, recorder),
      };
    } catch (error) {
      return { candidate, error };
    }
  });
}

async function processInactiveBatch(db, candidates, recorder) {
  return mapWithConcurrency(candidates, ACTIVE_CONCURRENCY, async (candidate) => {
    try {
      const result = prepareInactiveClone(candidate);
      // Do not construct _id with Mongoose here. migrate-mongo uses the root
      // MongoDB driver, which may carry a different BSON major version. Let
      // the native driver performing the insert create its own ObjectId.
      const insertResult = await db.collection('attackObjects').insertOne(result.document);
      result.document._id = insertResult.insertedId;
      await syncInactiveClone(candidate, result, recorder);
      return { candidate, result };
    } catch (error) {
      return { candidate, error };
    }
  });
}

function revisionKey(stixId, modified) {
  return `${stixId}\0${new Date(modified).toISOString()}`;
}

function assertReplacement(candidate, result, originalsById, replacementsByRevision) {
  const { document, domains } = candidate;
  const replacement = replacementsByRevision.get(revisionKey(document.stix.id, result.modified));

  if (!replacement) {
    throw new Error(`Replacement revision was not persisted for ${document.stix.id}`);
  }
  if (new Date(replacement.stix.modified).getTime() <= new Date(document.stix.modified).getTime()) {
    throw new Error(`Replacement revision did not advance modified for ${document.stix.id}`);
  }
  if (JSON.stringify(replacement.stix.x_mitre_domains) !== JSON.stringify(domains)) {
    throw new Error(`Replacement revision has unexpected domains for ${document.stix.id}`);
  }
  if ((replacement.stix.revoked === true) !== (document.stix.revoked === true)) {
    throw new Error(`Replacement revision changed revoked status for ${document.stix.id}`);
  }
  if (
    (replacement.stix.x_mitre_deprecated === true) !==
    (document.stix.x_mitre_deprecated === true)
  ) {
    throw new Error(`Replacement revision changed deprecated status for ${document.stix.id}`);
  }

  const original = originalsById.get(String(document._id));
  if (!original) {
    throw new Error(`Original revision was not retained for ${document.stix.id}`);
  }

  return replacement;
}

async function verifyReplacementBatch(db, entries) {
  if (entries.length === 0) return [];

  const originalIds = entries.map(({ candidate }) => candidate.document._id);
  const replacementSelectors = entries.map(({ candidate, result }) => ({
    'stix.id': candidate.document.stix.id,
    'stix.modified': result.modified,
  }));
  const persisted = await db
    .collection('attackObjects')
    .find({
      $or: [{ _id: { $in: originalIds } }, ...replacementSelectors],
    })
    .toArray();
  const originalIdSet = new Set(originalIds.map(String));
  const originalsById = new Map(
    persisted
      .filter((document) => originalIdSet.has(String(document._id)))
      .map((document) => [String(document._id), document]),
  );
  const replacementsByRevision = new Map(
    persisted.map((document) => [revisionKey(document.stix.id, document.stix.modified), document]),
  );

  return entries.map((entry) => {
    try {
      return {
        ...entry,
        replacement: assertReplacement(
          entry.candidate,
          entry.result,
          originalsById,
          replacementsByRevision,
        ),
      };
    } catch (error) {
      return { candidate: entry.candidate, error };
    }
  });
}

function actionFor(candidate) {
  return candidate.lifecycle === 'active'
    ? 'repost_with_canonical_domains'
    : 'clone_inactive_with_domains';
}

function changedAuditItem(entry) {
  const { candidate, result, replacement } = entry;
  const { document, domains, domainSource, lifecycle } = candidate;
  return {
    status: 'changed',
    action: actionFor(candidate),
    target: {
      kind: 'stix-object',
      collection: 'attackObjects',
      stix_id: document.stix.id,
      stix_type: document.stix.type,
    },
    details: {
      lifecycle,
      domain_source: domainSource,
      persistence_method: result.method,
      previous_modified: document.stix.modified,
      new_modified: replacement.stix.modified,
      revoked: document.stix.revoked === true,
      deprecated: document.stix.x_mitre_deprecated === true,
      changes: [
        {
          field: 'stix.x_mitre_domains',
          before: document.stix.x_mitre_domains,
          after: domains,
        },
      ],
    },
  };
}

function failedAuditItem(candidate, error) {
  const { document, domains, domainSource, lifecycle } = candidate;
  return {
    status: 'failed',
    action: actionFor(candidate),
    target: {
      kind: 'stix-object',
      collection: 'attackObjects',
      stix_id: document.stix.id,
      stix_type: document.stix.type,
    },
    details: {
      lifecycle,
      domain_source: domainSource,
      previous_modified: document.stix.modified,
      attempted_domains: domains,
    },
    error: serializeError(error),
  };
}

async function finalizeBatch(db, processed, recorder, counts, failures) {
  const processingFailures = processed.filter((entry) => entry.error);
  const verified = await verifyReplacementBatch(
    db,
    processed.filter((entry) => !entry.error),
  );
  const finalized = [...verified, ...processingFailures];
  const auditItems = [];

  for (const entry of finalized) {
    const { candidate, error } = entry;
    const { document, domainSource, lifecycle } = candidate;
    if (error) {
      counts.failed++;
      failures.push({ stix_id: document.stix.id, error: error.message });
      auditItems.push(failedAuditItem(candidate, error));
      continue;
    }

    counts.updated++;
    if (lifecycle === 'active') counts.active_reposts++;
    else counts.inactive_clones++;
    if (document.stix.revoked === true) counts.revoked++;
    if (document.stix.x_mitre_deprecated === true) counts.deprecated++;
    auditItems.push(changedAuditItem(entry));
  }

  await recorder.recordItems(auditItems);
}

async function countRemainingDomainlessTargets(db) {
  return (await latestDomainlessTargetDocuments(db)).length;
}

async function countStaleDomainBypasses(db) {
  return db.collection('validationbypassrules').countDocuments({
    fieldPath: ['x_mitre_domains'],
    errorCode: 'invalid_type',
    stixType: { $in: TARGET_TYPES },
  });
}

async function removeStaleDomainBypasses(db) {
  return db.collection('validationbypassrules').deleteMany({
    fieldPath: ['x_mitre_domains'],
    errorCode: 'invalid_type',
    stixType: { $in: TARGET_TYPES },
  });
}

async function run(db, client) {
  const domainsByRevision = await buildCanonicalTocDomainIndex(db);
  const domainlessDocuments = await latestDomainlessTargetDocuments(db);
  const unresolvedDomainless = domainlessDocuments.filter(
    (document) => domainsFromCanonicalToc(document, domainsByRevision).length === 0,
  );
  const candidates = resolveCandidates(domainlessDocuments, domainsByRevision);

  const recorder = await createAutomationRunRecorder(db, {
    automationType: 'migration',
    name: MIGRATION_NAME,
    trigger: { source: 'startup', runner: 'migrate-mongo' },
    scope: {
      collections: ['attackObjects', 'validationbypassrules'],
      object_kinds: ['stix-object', 'validation-bypass-rule'],
      target_types: TARGET_TYPES,
    },
    metadata: {
      domain_source: 'exact-canonical-collection-toc-membership',
      canonical_collection_domains: Object.fromEntries(CANONICAL_COLLECTION_DOMAINS),
      unmapped_policy: 'leave-unchanged-and-retain-validation-bypasses',
      active_method: 'service-create',
      inactive_method: 'immutable-direct-clone',
      batch_size: BATCH_SIZE,
      active_concurrency: ACTIVE_CONCURRENCY,
      serialized_active_types: [...SERIAL_ACTIVE_TYPES],
      candidates_discovered: candidates.length,
    },
  });

  const counts = {
    scanned_candidates: candidates.length,
    active_reposts: 0,
    inactive_clones: 0,
    active_batches: 0,
    inactive_batches: 0,
    unmapped_skipped: unresolvedDomainless.length,
    revoked: 0,
    deprecated: 0,
    bypasses_removed: 0,
    updated: 0,
    failed: 0,
  };
  const failures = [];
  let verification = {};

  try {
    // Resolve the complete plan before deleting bypasses or creating object
    // revisions. Exact canonical collection TOC membership is authoritative;
    // broad legacy collection-appearance backrefs are intentionally ignored.
    if (candidates.some((candidate) => candidate.lifecycle === 'active')) {
      ensureMongooseUsesClient(client);
      await assertOrganizationIdentityConfigured();
    }
    await prepareServiceLayer(client);

    const activeCandidates = candidates.filter((candidate) => candidate.lifecycle === 'active');
    const parallelActiveCandidates = activeCandidates.filter(
      (candidate) => !SERIAL_ACTIVE_TYPES.has(candidate.document.stix.type),
    );
    const serialActiveCandidates = activeCandidates.filter((candidate) =>
      SERIAL_ACTIVE_TYPES.has(candidate.document.stix.type),
    );
    const inactiveCandidates = candidates.filter((candidate) => candidate.lifecycle === 'inactive');

    for (const batch of chunkItems(parallelActiveCandidates)) {
      counts.active_batches++;
      recorder.log('info', 'Processing active canonical-domain batch', {
        batch: counts.active_batches,
        size: batch.length,
        concurrency: ACTIVE_CONCURRENCY,
      });
      const processed = await processActiveBatch(batch, recorder, ACTIVE_CONCURRENCY);
      await finalizeBatch(db, processed, recorder, counts, failures);
    }

    // Analytics, data components, and detection strategies update referenced
    // objects through read-modify-write hooks. Keep them serial while allowing
    // independent active types to benefit from bounded concurrency.
    for (const batch of chunkItems(serialActiveCandidates)) {
      counts.active_batches++;
      recorder.log('info', 'Processing serialized active canonical-domain batch', {
        batch: counts.active_batches,
        size: batch.length,
        concurrency: 1,
        stix_types: [...new Set(batch.map((candidate) => candidate.document.stix.type))],
      });
      const processed = await processActiveBatch(batch, recorder, 1);
      await finalizeBatch(db, processed, recorder, counts, failures);
    }

    for (const batch of chunkItems(inactiveCandidates)) {
      counts.inactive_batches++;
      recorder.log('info', 'Processing inactive canonical-domain batch', {
        batch: counts.inactive_batches,
        size: batch.length,
        concurrency: ACTIVE_CONCURRENCY,
      });
      const processed = await processInactiveBatch(db, batch, recorder);
      await finalizeBatch(db, processed, recorder, counts, failures);
    }

    const remainingDomainless = await countRemainingDomainlessTargets(db);
    if (failures.length > 0) {
      const failureSample = failures
        .slice(0, 5)
        .map((failure) => `${failure.stix_id}: ${failure.error}`)
        .join('; ');
      throw new Error(
        `Canonical-domain object repair is incomplete: ${failures.length} failed item(s), ` +
          `validation bypasses were retained.${failureSample ? ` Failures: ${failureSample}` : ''}`,
      );
    }

    // Enforcement is the final step. Leaving persisted bypasses in place until
    // every object is repaired prevents a partial run from activating a
    // stricter contract against data the same migration has not yet fixed.
    if (remainingDomainless === 0) {
      const bypassResult = await removeStaleDomainBypasses(db);
      counts.bypasses_removed = bypassResult.deletedCount;
    }

    verification = {
      remaining_latest_domainless_target_objects: remainingDomainless,
      remaining_domain_validation_bypasses: await countStaleDomainBypasses(db),
    };

    if (remainingDomainless === 0 && verification.remaining_domain_validation_bypasses > 0) {
      throw new Error(
        `Canonical-domain enforcement is incomplete: ` +
          `${verification.remaining_domain_validation_bypasses} stale bypass(es).`,
      );
    }

    const warnings =
      unresolvedDomainless.length === 0
        ? {}
        : {
            unmapped_domainless_objects: {
              count: unresolvedDomainless.length,
              sample: unresolvedDomainless.slice(0, 20).map((document) => document.stix.id),
              message:
                'No exact canonical collection TOC membership was found; objects were left unchanged and domain validation bypasses were retained.',
            },
          };

    await recorder.finish({
      status: 'completed',
      counts,
      warnings,
      verification,
      summary: {
        message:
          `Assigned canonical ATT&CK domains to ${counts.updated} latest revision(s): ` +
          `${counts.active_reposts} active repost(s) and ${counts.inactive_clones} inactive clone(s).`,
      },
      errorSummary: null,
    });

    return { counts, warnings, verification };
  } catch (error) {
    verification = {
      ...verification,
      remaining_latest_domainless_target_objects:
        verification.remaining_latest_domainless_target_objects ??
        (await countRemainingDomainlessTargets(db).catch(() => null)),
      remaining_domain_validation_bypasses:
        verification.remaining_domain_validation_bypasses ??
        (await countStaleDomainBypasses(db).catch(() => null)),
    };
    await recorder.finish({
      status: counts.updated > 0 ? 'partial' : 'failed',
      counts,
      warnings: {},
      verification,
      summary: { message: 'Canonical-domain migration did not complete successfully.' },
      errorSummary: serializeError(error),
    });
    throw error;
  }
}

module.exports = {
  async up(db, client) {
    const report = await require('../app/services/system/validation-operation-service').runLegacyMigration(
      () => run(db, client),
    );
    logger.info(`[${MIGRATION_NAME}] ${JSON.stringify(report)}`);
  },

  async down() {
    logger.info(
      `[${MIGRATION_NAME}] down migration is a no-op: replacement revisions and stricter ` +
        `domain validation are retained`,
    );
  },

  _private: {
    ACTIVE_CONCURRENCY,
    BATCH_SIZE,
    CANONICAL_COLLECTION_DOMAINS,
    SERIAL_ACTIVE_TYPES,
    TARGET_TYPES,
    chunkItems,
    countRemainingDomainlessTargets,
    countStaleDomainBypasses,
    buildCanonicalTocDomainIndex,
    domainsFromCanonicalToc,
    hasCanonicalDomains,
    isInactive,
    latestDomainlessTargetDocuments,
    mapWithConcurrency,
    nextModifiedTimestamp,
    prepareInactiveClone,
    processInactiveBatch,
    removeResolvedDomainValidation,
    removeStaleDomainBypasses,
    resolveCandidates,
    run: (...args) =>
      require('../app/services/system/validation-operation-service').runLegacyMigration(() => run(...args)),
  },
};
