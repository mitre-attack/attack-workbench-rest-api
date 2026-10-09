'use strict';

const _ = require('lodash');
const objects = require('../../repository/attack-objects-repository');
const relationships = require('../../repository/relationships-repository');
const {
  references,
  addedReferences,
  substitute,
  mergeOutgoing,
} = require('../../lib/domain-references');
const {
  NotFoundError,
  LifecycleConflictError,
  DeprecationBlockedError,
} = require('../../exceptions');

const inactive = (document) =>
  document?.stix?.revoked === true || document?.stix?.x_mitre_deprecated === true;
const repositoryFor = (id) => (id?.startsWith('relationship--') ? relationships : objects);
const latest = (id) => repositoryFor(id).retrieveLatestByStixIdLean(id);
// Internal lifecycle collection phase; ordinary HTTP dry-run options cannot set it.
const VALIDATION_PHASE = Symbol('lifecycle-validation-phase');

async function deprecationCheck(stixId, proposed) {
  const current = await latest(stixId);
  if (!current && !proposed) throw new NotFoundError({ stix_id: stixId });
  const check = { stix_id: stixId, can_deprecate: true, blockers: { sros: [], embedded: [] } };
  if ((current || proposed).stix.type === 'relationship') return check;

  const [sros, graph] = await Promise.all([
    relationships.retrieveAll({ versions: 'latest', sourceOrTargetRef: stixId }),
    objects.retrieveLatestGraphObjects(),
  ]);
  for (const { stix } of sros) {
    // Preserve existing hierarchy and replacement links when retiring an SDO.
    if (stix.relationship_type === 'subtechnique-of' || stix.relationship_type === 'revoked-by')
      continue;
    for (const [key, direction] of [
      ['source_ref', 'outbound'],
      ['target_ref', 'inbound'],
    ]) {
      if (stix[key] === stixId)
        check.blockers.sros.push({
          stix_id: stix.id,
          modified: new Date(stix.modified).toISOString(),
          relationship_type: stix.relationship_type,
          direction,
        });
    }
  }
  const seen = new Set();
  // A new revision may atomically remove its own outbound references.
  const authoritative = proposed
    ? [...graph.filter((document) => document.stix.id !== stixId), proposed]
    : graph;
  for (const document of authoritative) {
    for (const ref of references(document.stix)) {
      for (const [key, direction] of [
        ['source_ref', 'outbound'],
        ['target_ref', 'inbound'],
      ]) {
        if (ref[key] !== stixId) continue;
        const blocker = { ...ref, direction };
        const keyValue = JSON.stringify(blocker);
        if (!seen.has(keyValue)) {
          check.blockers.embedded.push(blocker);
          seen.add(keyValue);
        }
      }
    }
  }
  check.can_deprecate = !check.blockers.sros.length && !check.blockers.embedded.length;
  return check;
}

async function assertAuthoring(data, previous) {
  const { stix } = data;
  if (stix.type === 'relationship') {
    // Retirement is legal even when the endpoints have already become inactive.
    if (inactive(data) || stix.relationship_type === 'revoked-by') return;
    const endpoints = await Promise.all([latest(stix.source_ref), latest(stix.target_ref)]);
    const blocked = endpoints.filter(inactive).map((doc) => doc.stix.id);
    if (blocked.length)
      throw new LifecycleConflictError('Active relationships require active endpoints', {
        code: 'inactive_reference',
        references: blocked,
      });
    return;
  }

  const added = addedReferences(stix, previous?.stix);
  const becomesLatest = !previous || new Date(stix.modified) > new Date(previous.stix.modified);
  if (
    becomesLatest &&
    stix.x_mitre_deprecated === true &&
    (previous?.stix?.x_mitre_deprecated !== true || added.length > 0)
  ) {
    const check = await deprecationCheck(stix.id, data);
    if (!check.can_deprecate) throw new DeprecationBlockedError(check);
  }
  const targets = new Map();
  for (const ref of added) {
    if (!targets.has(ref.target_ref)) targets.set(ref.target_ref, await latest(ref.target_ref));
    const target = targets.get(ref.target_ref);
    if (!target || inactive(target))
      throw new LifecycleConflictError(
        'New embedded references require an existing active target',
        {
          code: 'inactive_reference',
          references: [ref],
        },
      );
  }
}

function revision(document) {
  const data = _.cloneDeep(document.toObject ? document.toObject() : document);
  delete data._id;
  delete data.__v;
  delete data.__t;
  delete data.warnings;
  if (data.workspace) {
    delete data.workspace.release_tracks;
    delete data.workspace.collections;
  }
  data.stix.modified = new Date(
    Math.max(Date.now(), new Date(data.stix.modified).getTime() + 1),
  ).toISOString();
  return data;
}

async function planEmbeddedTransfer(objectA, objectB) {
  objectA = objectA.toObject ? objectA.toObject() : objectA;
  objectB = objectB.toObject ? objectB.toObject() : objectB;
  const a = objectA.stix.id;
  const b = objectB.stix.id;
  const graph = await objects.retrieveLatestGraphObjects();
  const revisions = new Map();
  const bData = revision(objectB);
  bData.stix = mergeOutgoing(bData.stix, objectA.stix, a, b);
  for (const document of graph) {
    if (document.stix.id === a) continue;
    if (!references(document.stix).some((ref) => ref.target_ref === a)) continue;
    if (inactive(document))
      throw new LifecycleConflictError(
        'An inactive referrer cannot receive a replacement revision',
        {
          code: 'inactive_referrer',
          source_ref: document.stix.id,
          target_ref: a,
        },
      );
    const changed = document.stix.id === b ? bData : revision(document);
    changed.stix = substitute(changed.stix, a, b);
    revisions.set(document.stix.id, changed);
  }
  // modified alone does not justify creating a replacement revision.
  const comparable = { ...bData.stix, modified: objectB.stix.modified };
  if (!_.isEqual(comparable, objectB.stix)) revisions.set(b, bData);
  return [...revisions.values()];
}

async function createRevision(data, options) {
  const EventBus = require('../../lib/event-bus');
  try {
    const results = await EventBus.emitRequired(
      `${data.stix.type}::lifecycle-create-requested`,
      { data: _.cloneDeep(data), options },
      { minimumListeners: 1 },
    );
    return results[0];
  } catch (error) {
    if (error.failures?.length === 1) throw error.failures[0];
    throw error;
  }
}

async function reconcileEmbeddedMetadata(changed) {
  const EventBus = require('../../lib/event-bus');
  const graph = await objects.retrieveLatestGraphObjects();
  const byId = new Map(graph.map((document) => [document.stix.id, document]));
  const affected = new Set(changed.map((document) => document.stix.id));
  for (const document of changed) {
    for (const ref of references(document.stix)) affected.add(ref.target_ref);
  }
  const metadata = new Map([...affected].map((id) => [id, new Map()]));
  for (const document of graph) {
    for (const ref of references(document.stix)) {
      if (metadata.has(ref.source_ref))
        metadata.get(ref.source_ref).set(`outbound:${ref.target_ref}`, {
          stix_id: ref.target_ref,
          direction: 'outbound',
          attack_id: byId.get(ref.target_ref)?.workspace?.attack_id,
        });
      if (metadata.has(ref.target_ref))
        metadata.get(ref.target_ref).set(`inbound:${ref.source_ref}`, {
          stix_id: ref.source_ref,
          direction: 'inbound',
          attack_id: document.workspace?.attack_id,
        });
    }
  }
  for (const [stixId, entries] of metadata) {
    const document = byId.get(stixId);
    if (!document) continue;
    await EventBus.emitRequired(
      `${document.stix.type}::lifecycle-cache-requested`,
      {
        stixId,
        embeddedRelationships: [...entries.values()],
      },
      { minimumListeners: 1 },
    );
  }
}

module.exports = {
  VALIDATION_PHASE,
  inactive,
  latest,
  deprecationCheck,
  assertAuthoring,
  revision,
  planEmbeddedTransfer,
  createRevision,
  reconcileEmbeddedMetadata,
};
