'use strict';

// =============================================================================
// Content Manifest Service
//
// A content manifest is the sealed bill of materials for one exact member set.
// It records, as exact-revision pointers, every object a member-only bundle
// export emits: member roots, relationships closed over those members,
// supporting identities and marking definitions, and non-emitted LinkById
// render targets. Every snapshot references a manifest from birth; a new one
// is sealed whenever a snapshot's members are written and inherited otherwise.
//
// One graph algorithm (resolveClosedGraph) serves sealing, release previews,
// and draft exports that add live workflow tiers. It never discovers
// secondary SDOs through relationships: an SRO is selected only when both of
// its endpoint IDs are members, and the member revisions become its pins.
//
// =============================================================================

const { isDeepStrictEqual } = require('node:util');
const { v4: uuidv4 } = require('uuid');
const linkById = require('../../lib/linkById');
const logger = require('../../lib/logger');
const bundleRelationships = require('../../lib/stix-bundle-relationships');
const attackObjectsRepository = require('../../repository/attack-objects-repository');
const relationshipsRepository = require('../../repository/relationships-repository');
const dynamicRepo = require('../../repository/release-tracks/release-track-dynamic.repository');
const {
  ReleaseTrackContentManifest,
  ReleaseTrackContentManifestEntry,
} = require('../../models/release-tracks/release-track-content-manifest-model');
const { ReleaseContentIntegrityError } = require('../../exceptions');
const primaryRevisionService = require('./primary-revision-service');
const publicationService = require('./publication-service');

const MANIFEST_SCHEMA_VERSION = 2;
const MANIFEST_ID_PREFIX = 'release-track-content-manifest--';
const STATISTIC_FIELDS_BY_KIND = {
  root: 'primary_count',
  secondary: 'secondary_count',
  relationship: 'relationship_count',
  supporting: 'supporting_count',
  link_target: 'link_target_count',
};
const MUTATION_PROTECTED_ENTRY_FILTER = {
  $or: [
    { kind: { $ne: 'root' } },
    { kind: 'root', tier: { $in: ['members', 'quarantine'] } },
    { kind: 'root', 'discovered_from.0': { $exists: true } },
  ],
};

function revisionKey(objectRef, objectModified) {
  return `${objectRef}::${new Date(objectModified).getTime()}`;
}

function manifestUuid(manifestId) {
  return manifestId?.split('--')[1];
}

function exactMemberMap(entries) {
  const membersByObjectRef = new Map();
  for (const entry of entries) {
    const existing = membersByObjectRef.get(entry.object_ref);
    if (
      existing &&
      revisionKey(existing.object_ref, existing.object_modified) !==
        revisionKey(entry.object_ref, entry.object_modified)
    ) {
      throw new ReleaseContentIntegrityError(
        [
          {
            object_ref: entry.object_ref,
            object_modified: new Date(entry.object_modified).toISOString(),
            dependency: 'unique_member_revision',
          },
        ],
        { details: 'A sealed snapshot cannot select two revisions of one STIX object.' },
      );
    }
    membersByObjectRef.set(entry.object_ref, entry);
  }
  return membersByObjectRef;
}

function memberPin(member) {
  return { object_ref: member.object_ref, object_modified: new Date(member.object_modified) };
}

function authoredPin(relationship, side) {
  const endpoint = relationship.workspace?.relationship_endpoints?.[side];
  if (!endpoint?.object_ref || !endpoint.object_modified) return null;
  return { object_ref: endpoint.object_ref, object_modified: new Date(endpoint.object_modified) };
}

// =============================================================================
// Closed-member graph resolution (the one algorithm)
// =============================================================================

/**
 * Resolve the exact graph emitted for a member set.
 *
 * @param {Array<{object_ref: string, object_modified: Date|string}>} memberEntries
 * @param {Object} [options]
 * @param {Array<string>} [options.extraSupportingRefs] - Identity and marking
 *   definition IDs the collection object itself references, so the bundle
 *   stays self-contained
 * @param {boolean} [options.relationshipsOnly] - Skip supporting objects and
 *   LinkById targets; for callers that only compare relationship selection
 * @returns {Promise<{
 *   roots: { entries: Array<Object>, documents: Array<Object> },
 *   relationships: Array<{ relationship: Object, source: Object, target: Object,
 *     stale_endpoints: Array<string> }>,
 *   supportingDocuments: Array<Object>,
 *   linkTargetDocuments: Array<Object>,
 * }>}
 */
async function resolveClosedGraph(memberEntries, options = {}) {
  const roots = await primaryRevisionService.assertStoredEntries(memberEntries || []);
  const membersByObjectRef = exactMemberMap(roots.entries);

  const candidates = await relationshipsRepository.retrieveLatestBetween([
    ...membersByObjectRef.keys(),
  ]);
  const relationships = [];
  for (const relationship of candidates) {
    const sourceMember = membersByObjectRef.get(relationship.stix.source_ref);
    const targetMember = membersByObjectRef.get(relationship.stix.target_ref);
    if (!sourceMember || !targetMember) continue;
    if (
      !bundleRelationships.relationshipIsActive(relationship) ||
      bundleRelationships.isDeprecatedPattern(relationship.stix)
    ) {
      continue;
    }
    const source = memberPin(sourceMember);
    const target = memberPin(targetMember);
    const staleEndpoints = [];
    for (const [side, pin] of [
      ['source', source],
      ['target', target],
    ]) {
      const authored = authoredPin(relationship, side);
      if (
        authored &&
        authored.object_ref === pin.object_ref &&
        authored.object_modified.getTime() !== pin.object_modified.getTime()
      ) {
        staleEndpoints.push(side);
      }
    }
    relationships.push({ relationship, source, target, stale_endpoints: staleEndpoints });
  }
  relationships.sort((left, right) =>
    left.relationship.stix.id.localeCompare(right.relationship.stix.id),
  );

  if (options.relationshipsOnly) {
    return { roots, relationships, supportingDocuments: [], linkTargetDocuments: [] };
  }

  const emitted = [...roots.documents, ...relationships.map((candidate) => candidate.relationship)];
  const supportingDocuments = await loadSupportingDocuments(
    emitted,
    membersByObjectRef,
    options.extraSupportingRefs || [],
  );
  const linkTargetDocuments = await loadLinkTargets(emitted, roots.documents);

  return { roots, relationships, supportingDocuments, linkTargetDocuments };
}

/**
 * Identity and marking definitions referenced by a snapshot's collection
 * object, which must ship alongside the content they describe.
 */
async function publicationSupportingRefs(snapshot) {
  const publication = await publicationService.publicationForExport(snapshot);
  return [publication.created_by_ref, ...(publication.object_marking_refs || [])].filter(Boolean);
}

async function loadSupportingDocuments(documents, selectedByObjectRef, extraRefs = []) {
  const supportingRefs = new Set(extraRefs);
  for (const document of documents) {
    if (document.stix.created_by_ref) supportingRefs.add(document.stix.created_by_ref);
    for (const markingRef of document.stix.object_marking_refs || []) {
      supportingRefs.add(markingRef);
    }
  }

  const supporting = [];
  for (const objectRef of supportingRefs) {
    if (selectedByObjectRef.has(objectRef)) continue;
    const document = await attackObjectsRepository.retrieveLatestByStixIdLean(objectRef);
    if (document) {
      supporting.push(document);
    } else {
      logger.warn(`ContentManifestService: Referenced supporting object not found: ${objectRef}`);
    }
  }
  return supporting;
}

async function loadLinkTargets(documents, rootDocuments) {
  const selectedByAttackId = new Map();
  for (const document of rootDocuments) {
    const attackId = linkById.getAttackId(document.stix);
    if (attackId) selectedByAttackId.set(attackId, document);
  }
  const linkTargets = new Map();
  for (const document of documents) {
    for (const attackId of linkById.extractLinkByIds(document.stix)) {
      if (selectedByAttackId.has(attackId) || linkTargets.has(attackId)) continue;
      const target = await linkById.getAttackObjectFromDatabase(attackId);
      if (target) linkTargets.set(attackId, target);
    }
  }
  return [...linkTargets.values()];
}

function entriesFromGraph(graph) {
  const entries = graph.roots.documents.map((document) => ({
    revision_key: revisionKey(document.stix.id, document.stix.modified),
    kind: 'root',
    tier: 'members',
    object_ref: document.stix.id,
    object_modified: document.stix.modified,
  }));
  for (const candidate of graph.relationships) {
    entries.push({
      revision_key: revisionKey(
        candidate.relationship.stix.id,
        candidate.relationship.stix.modified,
      ),
      kind: 'relationship',
      object_ref: candidate.relationship.stix.id,
      object_modified: candidate.relationship.stix.modified,
      source: candidate.source,
      target: candidate.target,
    });
  }
  for (const document of graph.supportingDocuments) {
    const isVersioned = Boolean(document.stix.modified);
    entries.push({
      revision_key: isVersioned
        ? revisionKey(document.stix.id, document.stix.modified)
        : `${document.stix.id}::unversioned`,
      kind: 'supporting',
      object_ref: document.stix.id,
      object_modified: document.stix.modified,
      frozen_stix: isVersioned ? undefined : document.stix,
    });
  }
  for (const document of graph.linkTargetDocuments) {
    entries.push({
      revision_key: revisionKey(document.stix.id, document.stix.modified),
      kind: 'link_target',
      object_ref: document.stix.id,
      object_modified: document.stix.modified,
    });
  }
  return entries;
}

/**
 * Bundle-shaped view of a resolved graph, matching replay output.
 */
function graphFromResolution(graph) {
  return {
    documents: [
      ...graph.roots.documents,
      ...graph.relationships.map((candidate) => candidate.relationship),
      ...graph.supportingDocuments,
    ],
    linkTargetDocuments: graph.linkTargetDocuments,
    sourceOmittedDefaults: new Map(),
    manifest: null,
  };
}

// =============================================================================
// Sealing
// =============================================================================

async function persistManifest(snapshot, manifest, entries) {
  const common = {
    manifest_id: manifest.manifest_id,
    track_id: snapshot.id,
    snapshot_modified: snapshot.modified,
  };
  await ReleaseTrackContentManifest.create({ ...common, ...manifest });
  try {
    if (entries.length > 0) {
      await ReleaseTrackContentManifestEntry.insertMany(
        entries.map((entry) => ({ ...common, ...entry })),
      );
    }
    // The pending manifest now protects every pointer from deletion. Verify
    // once inside that window so a revision deleted during resolution cannot
    // leave an attachable dangling manifest.
    await primaryRevisionService.assertStoredEntries(
      entries
        .filter((entry) => entry.object_modified && !entry.frozen_stix)
        .map((entry) => ({ object_ref: entry.object_ref, object_modified: entry.object_modified })),
    );
  } catch (err) {
    await discard(manifest.manifest_id);
    throw err;
  }
  return manifest.manifest_id;
}

/**
 * Seal a content manifest for a snapshot's member set.
 *
 * @param {Object} snapshot - Snapshot document (may be unsaved)
 * @param {Object} options
 * @param {string} options.reason - seal_reason enum value
 * @param {Array<Object>} [options.members] - Member entries when they differ
 *   from snapshot.members (release planning)
 * @returns {Promise<string>} The pending manifest ID
 */
async function seal(snapshot, options = {}) {
  const graph = await resolveClosedGraph(options.members ?? snapshot.members ?? [], {
    extraSupportingRefs: await publicationSupportingRefs(snapshot),
  });
  const entries = entriesFromGraph(graph);
  return persistManifest(
    snapshot,
    {
      manifest_id: `${MANIFEST_ID_PREFIX}${uuidv4()}`,
      state: 'pending',
      schema_version: MANIFEST_SCHEMA_VERSION,
      seal_reason: options.reason,
      created_at: new Date(),
    },
    entries,
  );
}

async function activate(manifestId) {
  await ReleaseTrackContentManifest.updateOne(
    { manifest_id: manifestId, state: 'pending' },
    { $set: { state: 'active' } },
  ).exec();
}

async function discard(manifestId) {
  if (!manifestId) return;
  // Keep the discoverable header until every entry is gone. A failed entry
  // deletion can then be resumed by orphan repair instead of stranding data.
  await ReleaseTrackContentManifestEntry.deleteMany({ manifest_id: manifestId }).exec();
  await ReleaseTrackContentManifest.deleteOne({ manifest_id: manifestId }).exec();
}

/**
 * Discard manifests that no snapshot in the track references any more.
 * Manifests are shared by reference between a sealing snapshot and the
 * clones that inherit it, so callers must never discard by snapshot alone.
 */
async function discardUnreferenced(trackId, manifestIds) {
  const candidates = [...new Set((manifestIds || []).filter(Boolean))];
  if (candidates.length === 0) return [];
  const referenced = new Set(await dynamicRepo.findReferencedManifestIds(trackId, candidates));
  const unreferenced = candidates.filter((manifestId) => !referenced.has(manifestId));
  await Promise.all(unreferenced.map((manifestId) => discard(manifestId)));
  return unreferenced;
}

async function discardTrack(trackId, assertOwned = async () => {}) {
  for (;;) {
    await assertOwned();
    const manifests = await ReleaseTrackContentManifest.find({ track_id: trackId })
      .select({ manifest_id: 1, _id: 0 })
      .limit(100)
      .lean()
      .exec();
    if (!manifests.length) return;
    for (const manifest of manifests) {
      await assertOwned();
      await discard(manifest.manifest_id);
    }
  }
}

/**
 * Remove manifests owned by a track that no surviving snapshot references.
 * Used by deletion recovery paths.
 */
async function discardOrphans(trackId, assertOwned = async () => {}) {
  let cursor;
  for (;;) {
    await assertOwned();
    const manifests = await ReleaseTrackContentManifest.find({
      track_id: trackId,
      ...(cursor ? { _id: { $gt: cursor } } : {}),
    })
      .select({ manifest_id: 1 })
      .sort({ _id: 1 })
      .limit(100)
      .lean()
      .exec();
    if (!manifests.length) return;
    await assertOwned();
    await discardUnreferenced(
      trackId,
      manifests.map((manifest) => manifest.manifest_id),
    );
    cursor = manifests.at(-1)._id;
  }
}

// =============================================================================
// Source-attested reconstruction (administrative)
// =============================================================================

function sourcePlanIntegrityError(details, references = []) {
  return new ReleaseContentIntegrityError(references, { details });
}

async function buildSourceManifestEntries(snapshot, plan) {
  const seenObjectRefs = new Set();
  const planned = [];

  for (const input of plan.entries) {
    if (seenObjectRefs.has(input.object_ref)) {
      throw sourcePlanIntegrityError(
        `Source bundle contains more than one revision for '${input.object_ref}'.`,
        [{ object_ref: input.object_ref, dependency: 'unique_source_revision' }],
      );
    }
    seenObjectRefs.add(input.object_ref);

    const isVersioned = input.object_modified != null;
    if (isVersioned && input.frozen_stix) {
      throw sourcePlanIntegrityError(
        'Versioned source-bundle entries must be exact database pointers, not frozen payloads.',
        [{ object_ref: input.object_ref, dependency: 'pointer_only_manifest' }],
      );
    }
    if (!isVersioned) {
      if (
        input.kind !== 'supporting' ||
        input.frozen_stix?.type !== 'marking-definition' ||
        input.frozen_stix?.id !== input.object_ref ||
        input.frozen_stix?.modified != null
      ) {
        throw sourcePlanIntegrityError(
          'Only unversioned marking definitions may be frozen in a schema-v2 manifest.',
          [{ object_ref: input.object_ref, dependency: 'unversioned_supporting_object' }],
        );
      }
    }
    if (input.kind === 'relationship') {
      if (!input.source || !input.target || !isVersioned) {
        throw sourcePlanIntegrityError(
          'Relationship entries require an exact relationship pointer and exact endpoint pins.',
          [{ object_ref: input.object_ref, dependency: 'relationship_endpoints' }],
        );
      }
    } else if (input.source || input.target) {
      throw sourcePlanIntegrityError(
        'Only relationship entries may declare source and target endpoint pins.',
        [{ object_ref: input.object_ref, dependency: 'relationship_endpoints' }],
      );
    }

    planned.push({
      ...input,
      object_modified: isVersioned ? new Date(input.object_modified) : undefined,
      source: input.source
        ? { ...input.source, object_modified: new Date(input.source.object_modified) }
        : undefined,
      target: input.target
        ? { ...input.target, object_modified: new Date(input.target.object_modified) }
        : undefined,
      revision_key: isVersioned
        ? revisionKey(input.object_ref, input.object_modified)
        : `${input.object_ref}::unversioned`,
    });
  }

  const expectedRoots = new Map(
    (snapshot.members || []).map((entry) => [
      revisionKey(entry.object_ref, entry.object_modified),
      entry,
    ]),
  );
  const suppliedRoots = planned.filter((entry) => entry.kind === 'root');
  const suppliedRootKeys = new Set(suppliedRoots.map((entry) => entry.revision_key));
  if (
    suppliedRoots.length !== expectedRoots.size ||
    [...expectedRoots.keys()].some((key) => !suppliedRootKeys.has(key))
  ) {
    throw sourcePlanIntegrityError(
      'Source bundle root pointers must exactly equal the tagged snapshot members.',
      [{ track_id: snapshot.id, dependency: 'snapshot_members' }],
    );
  }

  const versioned = planned.filter((entry) => entry.object_modified);
  const hydrated = await primaryRevisionService.assertStoredEntries(versioned);
  const documentsByRevision = new Map(
    hydrated.documents.map((document) => [
      revisionKey(document.stix.id, document.stix.modified),
      document,
    ]),
  );
  const selectableKeys = new Set(
    planned
      .filter((entry) => ['root', 'secondary'].includes(entry.kind))
      .map((entry) => entry.revision_key),
  );

  for (const entry of planned) {
    if (!entry.object_modified) continue;
    const document = documentsByRevision.get(entry.revision_key);
    if (entry.kind === 'relationship') {
      if (document.stix.type !== 'relationship') {
        throw sourcePlanIntegrityError(`'${entry.object_ref}' is not a relationship revision.`, [
          { object_ref: entry.object_ref, dependency: 'relationship_type' },
        ]);
      }
      for (const side of ['source', 'target']) {
        const endpoint = entry[side];
        if (document.stix[`${side}_ref`] !== endpoint.object_ref) {
          throw sourcePlanIntegrityError(
            `Relationship '${entry.object_ref}' has a mismatched ${side} pointer.`,
            [{ object_ref: entry.object_ref, dependency: `${side}_ref` }],
          );
        }
        if (!selectableKeys.has(revisionKey(endpoint.object_ref, endpoint.object_modified))) {
          throw sourcePlanIntegrityError(
            `Relationship '${entry.object_ref}' references an endpoint revision absent from the source graph.`,
            [{ ...endpoint, dependency: `${side}_revision` }],
          );
        }
      }
    } else if (document.stix.type === 'relationship') {
      throw sourcePlanIntegrityError(
        `Relationship revision '${entry.object_ref}' must use kind 'relationship'.`,
        [{ object_ref: entry.object_ref, dependency: 'entry_kind' }],
      );
    }
  }

  const includedObjectRefs = new Set(planned.map((entry) => entry.object_ref));
  for (const document of hydrated.documents) {
    const supportingRefs = [
      document.stix.created_by_ref,
      ...(document.stix.object_marking_refs || []),
    ].filter(Boolean);
    const missingRef = supportingRefs.find((objectRef) => !includedObjectRefs.has(objectRef));
    if (missingRef) {
      throw sourcePlanIntegrityError(`Source graph omits supporting object '${missingRef}'.`, [
        { object_ref: missingRef, dependency: 'supporting_object' },
      ]);
    }
  }

  return planned.map((entry) => {
    if (entry.kind !== 'root') return entry;
    return { ...entry, tier: 'members' };
  });
}

async function prepareSourceReconstruction(snapshot, plan) {
  const entries = await buildSourceManifestEntries(snapshot, plan);
  return persistManifest(
    snapshot,
    {
      manifest_id: `${MANIFEST_ID_PREFIX}${uuidv4()}`,
      state: 'pending',
      schema_version: MANIFEST_SCHEMA_VERSION,
      source_attestation: plan.source_attestation,
      seal_reason: 'source_reconstruction',
      created_at: new Date(),
    },
    entries,
  );
}

async function findManifest(manifestId) {
  return ReleaseTrackContentManifest.findOne({
    manifest_id: manifestId,
    state: { $in: ['pending', 'active'] },
  })
    .lean()
    .exec();
}

async function isSameSourceReconstruction(manifestId, sourceAttestation) {
  const manifest = await findManifest(manifestId);
  return Boolean(
    manifest &&
    manifest.seal_reason === 'source_reconstruction' &&
    isDeepStrictEqual(manifest.source_attestation, sourceAttestation),
  );
}

// =============================================================================
// Replay
// =============================================================================

function legacySelectedRevisionKeys(entries) {
  const selected = new Set(
    entries
      .filter((entry) => entry.kind === 'root' && entry.tier === 'members')
      .map((entry) => entry.revision_key),
  );
  // Schema-v1 manifests recorded relationship-discovered secondaries with
  // the revision that discovered them. Replay only follows frozen edges.
  let added;
  do {
    added = false;
    for (const entry of entries) {
      if (!['root', 'secondary'].includes(entry.kind) || selected.has(entry.revision_key)) {
        continue;
      }
      if (
        (entry.discovered_from || []).some((source) =>
          selected.has(revisionKey(source.object_ref, source.object_modified)),
        )
      ) {
        selected.add(entry.revision_key);
        added = true;
      }
    }
  } while (added);
  return selected;
}

async function replayEntries(entries, manifest) {
  const pointerOnly = manifest.schema_version >= MANIFEST_SCHEMA_VERSION;
  const versionedEntries = entries.filter(
    (entry) =>
      entry.object_modified &&
      (entry.kind !== 'relationship' || (pointerOnly && !entry.frozen_stix)),
  );
  const hydrated = await primaryRevisionService.assertStoredEntries(
    versionedEntries.map((entry) => ({
      object_ref: entry.object_ref,
      object_modified: entry.object_modified,
    })),
  );
  const documentsByRevision = new Map(
    hydrated.documents.map((document) => [
      revisionKey(document.stix.id, document.stix.modified),
      document,
    ]),
  );
  for (const entry of entries) {
    if (entry.frozen_stix) {
      documentsByRevision.set(entry.revision_key, { stix: entry.frozen_stix });
    }
  }

  const selectedRevisionKeys = pointerOnly
    ? new Set(
        entries
          .filter((entry) => ['root', 'secondary'].includes(entry.kind))
          .map((entry) => entry.revision_key),
      )
    : legacySelectedRevisionKeys(entries);

  const selectedRelationships = entries.filter(
    (entry) =>
      entry.kind === 'relationship' &&
      selectedRevisionKeys.has(
        revisionKey(entry.source.object_ref, entry.source.object_modified),
      ) &&
      selectedRevisionKeys.has(revisionKey(entry.target.object_ref, entry.target.object_modified)),
  );
  for (const entry of selectedRelationships) {
    selectedRevisionKeys.add(entry.revision_key);
  }

  const selectedDocuments = [...selectedRevisionKeys]
    .map((key) => documentsByRevision.get(key))
    .filter(Boolean);
  const supportingRefs = new Set();
  for (const document of selectedDocuments) {
    if (document.stix.created_by_ref) supportingRefs.add(document.stix.created_by_ref);
    for (const objectRef of document.stix.object_marking_refs || []) {
      supportingRefs.add(objectRef);
    }
  }

  const supportingDocuments = entries
    .filter((entry) => entry.kind === 'supporting' && supportingRefs.has(entry.object_ref))
    .map((entry) =>
      entry.object_modified
        ? documentsByRevision.get(entry.revision_key)
        : { stix: entry.frozen_stix },
    )
    .filter(Boolean);
  const linkTargetDocuments = entries
    .filter((entry) => entry.kind === 'link_target')
    .map((entry) => documentsByRevision.get(entry.revision_key))
    .filter(Boolean);
  const sourceOmittedDefaults = new Map(
    entries
      .filter((entry) => entry.omitted_optional_defaults?.length)
      .map((entry) => [entry.object_ref, entry.omitted_optional_defaults]),
  );

  const emittedByRevision = new Map();
  for (const document of [...selectedDocuments, ...supportingDocuments]) {
    const key = document.stix.modified
      ? revisionKey(document.stix.id, document.stix.modified)
      : `${document.stix.id}::unversioned`;
    emittedByRevision.set(key, document);
  }

  return {
    documents: [...emittedByRevision.values()],
    linkTargetDocuments,
    sourceOmittedDefaults,
    manifest,
  };
}

async function loadEntries(manifestId) {
  return ReleaseTrackContentManifestEntry.find({ manifest_id: manifestId })
    .sort({ _id: 1 })
    .lean()
    .exec();
}

/**
 * Replay a snapshot's sealed manifest.
 */
async function replay(snapshot) {
  if (!snapshot.content_manifest_id) {
    throw new ReleaseContentIntegrityError(
      [
        {
          track_id: snapshot.id,
          snapshot_modified: new Date(snapshot.modified).toISOString(),
          dependency: 'content_manifest',
        },
      ],
      { details: 'Snapshot does not reference a sealed content manifest.' },
    );
  }

  const manifest = await ReleaseTrackContentManifest.findOne({
    manifest_id: snapshot.content_manifest_id,
    track_id: snapshot.id,
    state: { $in: ['pending', 'active'] },
  })
    .lean()
    .exec();
  if (!manifest) {
    throw new ReleaseContentIntegrityError(
      [{ manifest_id: snapshot.content_manifest_id, dependency: 'content_manifest' }],
      { details: 'Snapshot content manifest is missing.' },
    );
  }

  // A snapshot link is the durable commit record. If the process stopped
  // after linking a complete pending manifest but before activation, replay
  // remains deterministic and repairs the visibility marker opportunistically.
  if (manifest.state === 'pending') {
    await activate(manifest.manifest_id);
    manifest.state = 'active';
  }

  return replayEntries(await loadEntries(manifest.manifest_id), manifest);
}

/**
 * Resolve the graph live for a snapshot's member set. Used by release previews
 * of an unsaved planned snapshot, which has nothing sealed yet. Not
 * deterministic by design.
 */
async function resolveLive(snapshot) {
  const graph = await resolveClosedGraph(snapshot.members || [], {
    extraSupportingRefs: await publicationSupportingRefs(snapshot),
  });
  return graphFromResolution(graph);
}

/**
 * Append the identity and marking definitions the collection object
 * references when a replayed manifest predates the current publication rule
 * (for example a virtual materialization sealed before a configuration
 * change). Sealed releases normally already contain them.
 */
async function ensurePublicationSupport(documents, publication) {
  const present = new Set(documents.map((document) => document.stix.id));
  const appended = [];
  for (const objectRef of [
    publication.created_by_ref,
    ...(publication.object_marking_refs || []),
  ].filter(Boolean)) {
    if (present.has(objectRef)) continue;
    const document = await attackObjectsRepository.retrieveLatestByStixIdLean(objectRef);
    if (document) {
      appended.push(document);
      present.add(objectRef);
    } else {
      logger.warn(`ContentManifestService: Publication supporting object not found: ${objectRef}`);
    }
  }
  return appended;
}

// =============================================================================
// Preview: relationship changes between a manifest and a fresh resolution
// =============================================================================

function relationshipSummary(relationship, source, target, extra = {}) {
  return {
    object_ref: relationship.stix.id,
    object_modified: new Date(relationship.stix.modified).toISOString(),
    relationship_type: relationship.stix.relationship_type,
    source_ref: source.object_ref,
    target_ref: target.object_ref,
    ...extra,
  };
}

/**
 * Compare the relationships a fresh seal would select against the manifest a
 * snapshot currently references.
 *
 * @param {Object} snapshot - Snapshot whose manifest is the baseline
 * @param {Array<Object>} members - Member set the release would seal
 */
async function previewRelationshipChanges(snapshot, members) {
  // Only the relationship selection is compared, so the supporting objects
  // and LinkById targets a full seal would load are skipped.
  const graph = await resolveClosedGraph(members, { relationshipsOnly: true });
  const previousEntries = snapshot.content_manifest_id
    ? (await loadEntries(snapshot.content_manifest_id)).filter(
        (entry) => entry.kind === 'relationship',
      )
    : [];
  const previousByKey = new Map(previousEntries.map((entry) => [entry.revision_key, entry]));
  const nextByKey = new Map(
    graph.relationships.map((candidate) => [
      revisionKey(candidate.relationship.stix.id, candidate.relationship.stix.modified),
      candidate,
    ]),
  );

  const added = [];
  const staleEndpoints = [];
  for (const [key, candidate] of nextByKey) {
    if (!previousByKey.has(key)) {
      added.push(relationshipSummary(candidate.relationship, candidate.source, candidate.target));
    }
    if (candidate.stale_endpoints.length > 0) {
      staleEndpoints.push(
        relationshipSummary(candidate.relationship, candidate.source, candidate.target, {
          stale_endpoints: candidate.stale_endpoints,
        }),
      );
    }
  }
  const removed = [];
  for (const [key, entry] of previousByKey) {
    if (nextByKey.has(key)) continue;
    removed.push({
      object_ref: entry.object_ref,
      object_modified: new Date(entry.object_modified).toISOString(),
      source_ref: entry.source?.object_ref,
      target_ref: entry.target?.object_ref,
    });
  }

  return {
    selected_count: nextByKey.size,
    added_count: added.length,
    removed_count: removed.length,
    unchanged_count: nextByKey.size - added.length,
    added,
    removed,
    stale_endpoints: staleEndpoints,
  };
}

// =============================================================================
// Statistics and protection lookups
// =============================================================================

function emptyStatistics() {
  return {
    primary_count: 0,
    secondary_count: 0,
    relationship_count: 0,
    supporting_count: 0,
    link_target_count: 0,
    total_count: 0,
  };
}

/**
 * Count manifest entries by semantic role for a page of snapshot summaries.
 * One aggregate covers every requested manifest to avoid a per-snapshot query.
 */
async function getStatisticsByManifestIds(manifestIds) {
  const uniqueManifestIds = [...new Set(manifestIds.filter(Boolean))];
  const statisticsByManifestId = new Map(
    uniqueManifestIds.map((manifestId) => [manifestId, emptyStatistics()]),
  );
  if (uniqueManifestIds.length === 0) return statisticsByManifestId;

  const counts = await ReleaseTrackContentManifestEntry.aggregate([
    { $match: { manifest_id: { $in: uniqueManifestIds } } },
    {
      $group: {
        _id: { manifest_id: '$manifest_id', kind: '$kind' },
        count: { $sum: 1 },
      },
    },
  ]).exec();

  for (const result of counts) {
    const statistics = statisticsByManifestId.get(result._id.manifest_id);
    const field = STATISTIC_FIELDS_BY_KIND[result._id.kind];
    if (!statistics || !field) continue;
    statistics[field] = result.count;
    statistics.total_count += result.count;
  }
  return statisticsByManifestId;
}

async function protectedEntries(query, projection) {
  const entries = await ReleaseTrackContentManifestEntry.find(query)
    .select({ ...projection, _id: 0 })
    .lean()
    .exec();
  if (entries.length === 0) return [];

  const protectedManifestIds = new Set(
    (
      await ReleaseTrackContentManifest.find({
        manifest_id: { $in: entries.map((entry) => entry.manifest_id) },
        state: { $in: ['pending', 'active'] },
      })
        .select({ manifest_id: 1, _id: 0 })
        .lean()
        .exec()
    ).map((manifest) => manifest.manifest_id),
  );
  return entries.filter((entry) => protectedManifestIds.has(entry.manifest_id));
}

async function findPinsForRevision(objectRef, objectModified) {
  return protectedEntries(
    { object_ref: objectRef, object_modified: objectModified, ...MUTATION_PROTECTED_ENTRY_FILTER },
    { manifest_id: 1, track_id: 1, snapshot_modified: 1, kind: 1, tier: 1 },
  );
}

async function findPinsForObject(objectRef) {
  return protectedEntries(
    { object_ref: objectRef, object_modified: { $ne: null }, ...MUTATION_PROTECTED_ENTRY_FILTER },
    { manifest_id: 1, track_id: 1, snapshot_modified: 1, object_modified: 1, kind: 1, tier: 1 },
  );
}

module.exports = {
  seal,
  activate,
  discard,
  discardUnreferenced,
  discardOrphans,
  discardTrack,
  replay,
  resolveLive,
  resolveClosedGraph,
  ensurePublicationSupport,
  previewRelationshipChanges,
  prepareSourceReconstruction,
  isSameSourceReconstruction,
  findManifest,
  getStatisticsByManifestIds,
  findPinsForRevision,
  findPinsForObject,
  manifestUuid,
  MANIFEST_ID_PREFIX,
  MANIFEST_SCHEMA_VERSION,
};
