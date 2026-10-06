'use strict';

const crypto = require('node:crypto');
const mongoose = require('mongoose');
const request = require('supertest');
const { expect } = require('expect');

const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const pinMigration = require('../../../../migrations/20260730180000-backfill-deterministic-snapshot-graphs');
const sealMigration = require('../../../../migrations/20260902120000-seal-release-track-content-manifests');
const Relationship = require('../../../models/relationship-model');
const {
  ReleaseTrackContentManifest,
  ReleaseTrackContentManifestEntry,
} = require('../../../models/release-tracks/release-track-content-manifest-model');
const { releaseExactMembers } = require('./release-track-test-helpers');

const markingDefinitionId = 'marking-definition--613f2e26-407d-48c7-9eca-b8e91df99dc9';

function sha256(payload) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload, null, 4), 'utf8')
    .digest('hex');
}

describe('Release-track manifest migrations', function () {
  let app;
  let passportCookie;
  let technique;
  let group;
  let relationship;
  let legacyTrackId;
  let sealedTrackId;
  let sealedManifestId;
  let orphanTrackId;
  const deprecatedDanglingRelationshipId = 'relationship--f7a41277-6599-49df-9567-82c9227fb8b5';
  const activeDanglingRelationshipId = 'relationship--932fabf0-2868-46ed-9453-41e33dab7f39';
  const missingEndpointId = 'campaign--5f4e747c-11d7-49ae-a947-a0f436879d62';

  before(async function () {
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();
    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;
    app = await require('../../../index').initializeApp();
    passportCookie = await login.loginAnonymous(app);
  });

  async function post(path, body, status = 201) {
    const response = await request(app)
      .post(path)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(status);
    return response.body;
  }

  async function get(path, status = 200) {
    const response = await request(app)
      .get(path)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(status);
    return response.body;
  }

  function trackCollection(trackId) {
    return mongoose.connection.db.collection(trackId);
  }

  async function removeModernReleaseSource(trackId, release) {
    await trackCollection(trackId).deleteOne({
      modified: new Date(release.release_source_modified),
      version: null,
    });
    await trackCollection(trackId).updateOne(
      { modified: new Date(release.modified) },
      { $unset: { release_source_modified: '' } },
    );
  }

  before('create and then downgrade representative legacy data', async function () {
    const timestamp = new Date().toISOString();
    technique = await post('/api/techniques', {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        type: 'attack-pattern',
        spec_version: '2.1',
        created: timestamp,
        modified: timestamp,
        name: 'Migration graph technique',
        description: 'A primary migration fixture.',
        kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'execution' }],
        x_mitre_is_subtechnique: false,
        x_mitre_domains: ['enterprise-attack'],
        x_mitre_platforms: ['Windows'],
        x_mitre_version: '1.0',
        object_marking_refs: [markingDefinitionId],
      },
    });
    group = await post('/api/groups', {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        type: 'intrusion-set',
        spec_version: '2.1',
        created: timestamp,
        modified: timestamp,
        name: 'Migration graph group',
        description: 'A group migration fixture.',
        object_marking_refs: [markingDefinitionId],
        x_mitre_version: '1.0',
        x_mitre_domains: ['enterprise-attack'],
      },
    });
    relationship = await post('/api/relationships', {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        type: 'relationship',
        spec_version: '2.1',
        created: timestamp,
        modified: timestamp,
        relationship_type: 'uses',
        source_ref: group.stix.id,
        target_ref: technique.stix.id,
        object_marking_refs: [markingDefinitionId],
      },
    });

    // Track 1: a fully legacy track — graphless release, a rolling draft with
    // the same members, and the retired top-level object_marking_refs field.
    const legacyTrack = await post(
      '/api/release-tracks/new',
      { name: 'Legacy graphless track', type: 'standard' },
      201,
    );
    legacyTrackId = legacyTrack.id;
    const legacyRelease = await releaseExactMembers(app, passportCookie, legacyTrackId, [
      technique,
      group,
    ]);
    await post(`/api/release-tracks/${legacyTrackId}/meta`, { description: 'draft' }, 200);
    await removeModernReleaseSource(legacyTrackId, legacyRelease);
    await trackCollection(legacyTrackId).updateMany(
      {},
      {
        $unset: { content_manifest_id: '', publication: '', bundle_id: '', bundle_hashes: '' },
        $set: { object_marking_refs: [markingDefinitionId] },
      },
    );
    await Promise.all([
      ReleaseTrackContentManifest.deleteMany({ track_id: legacyTrackId }),
      ReleaseTrackContentManifestEntry.deleteMany({ track_id: legacyTrackId }),
    ]);

    // Track 2: a release that already had an opt-in graph under the old
    // field name, with a frozen collection entry and no publication record.
    const sealedTrack = await post(
      '/api/release-tracks/new',
      { name: 'Legacy cached track', type: 'standard' },
      201,
    );
    sealedTrackId = sealedTrack.id;
    const sealedRelease = await releaseExactMembers(app, passportCookie, sealedTrackId, [
      technique,
    ]);
    await removeModernReleaseSource(sealedTrackId, sealedRelease);
    sealedManifestId = sealedRelease.content_manifest_id.replace(
      'release-track-content-manifest--',
      'release-track-graph-manifest--',
    );
    await trackCollection(sealedTrackId).updateMany(
      { version: { $type: 'string' } },
      {
        $set: { graph_manifest_id: sealedManifestId },
        $unset: { content_manifest_id: '', publication: '', bundle_id: '' },
      },
    );
    // Move the sealed manifest into the legacy collections with the legacy
    // header shape so the migration exercises the rename and normalization.
    const legacyManifests = mongoose.connection.db.collection('releaseTrackGraphManifests');
    const legacyEntries = mongoose.connection.db.collection('releaseTrackGraphManifestEntries');
    const modernManifest = await ReleaseTrackContentManifest.findOne({
      manifest_id: sealedRelease.content_manifest_id,
    })
      .lean()
      .exec();
    const modernEntries = await ReleaseTrackContentManifestEntry.find({
      manifest_id: sealedRelease.content_manifest_id,
    })
      .lean()
      .exec();
    delete modernManifest._id;
    delete modernManifest.seal_reason;
    await legacyManifests.insertOne({
      ...modernManifest,
      manifest_id: sealedManifestId,
      resolver_version: 'closed-member-graph-v3',
      baseline_reconstruction: false,
    });
    await legacyEntries.insertMany([
      ...modernEntries.map((entry) => {
        const legacyEntry = { ...entry, manifest_id: sealedManifestId };
        delete legacyEntry._id;
        return legacyEntry;
      }),
      {
        manifest_id: sealedManifestId,
        track_id: sealedTrackId,
        snapshot_modified: new Date(sealedRelease.modified),
        revision_key: `x-mitre-collection--${sealedTrackId.split('--')[1]}::collection`,
        kind: 'collection',
        object_ref: `x-mitre-collection--${sealedTrackId.split('--')[1]}`,
        frozen_stix: { type: 'x-mitre-collection' },
      },
    ]);
    await Promise.all([
      ReleaseTrackContentManifest.deleteMany({ manifest_id: sealedRelease.content_manifest_id }),
      ReleaseTrackContentManifestEntry.deleteMany({
        manifest_id: sealedRelease.content_manifest_id,
      }),
    ]);
    await trackCollection(sealedTrackId).updateMany(
      {},
      { $set: { 'config.include_secondary_objects': { enabled: true } } },
    );

    // Track 3: an orphan collection left behind by an interrupted deletion.
    // Its members reference a revision that no longer exists, exactly the
    // production shape that must never block startup.
    const orphanTrack = await post(
      '/api/release-tracks/new',
      { name: 'Orphan collection', type: 'standard' },
      201,
    );
    orphanTrackId = orphanTrack.id;
    const orphanRelease = await releaseExactMembers(app, passportCookie, orphanTrackId, [
      technique,
    ]);
    await removeModernReleaseSource(orphanTrackId, orphanRelease);
    await mongoose.connection.db
      .collection('releaseTrackRegistry')
      .deleteOne({ track_id: orphanTrackId });
    await trackCollection(orphanTrackId).updateMany(
      {},
      {
        $unset: { content_manifest_id: '', publication: '', bundle_id: '', bundle_hashes: '' },
        $set: {
          'members.0.object_modified': new Date('2000-01-01T00:00:00.000Z'),
        },
      },
    );
    await Promise.all([
      ReleaseTrackContentManifest.deleteMany({ track_id: orphanTrackId }),
      ReleaseTrackContentManifestEntry.deleteMany({ track_id: orphanTrackId }),
    ]);
    await ReleaseTrackContentManifest.create({
      manifest_id: 'release-track-content-manifest--orphan-crashed-run',
      track_id: orphanTrackId,
      snapshot_modified: new Date(),
      state: 'active',
      schema_version: 2,
      seal_reason: 'migration',
    });

    await Relationship.updateOne(
      { 'stix.id': relationship.stix.id, 'stix.modified': relationship.stix.modified },
      { $unset: { 'workspace.relationship_endpoints': '' } },
    );
    await mongoose.connection.db.collection('relationships').insertOne({
      workspace: {},
      stix: {
        type: 'relationship',
        spec_version: '2.1',
        id: deprecatedDanglingRelationshipId,
        created: new Date(timestamp),
        modified: new Date(timestamp),
        relationship_type: 'uses',
        source_ref: missingEndpointId,
        target_ref: technique.stix.id,
        revoked: false,
        x_mitre_deprecated: true,
        object_marking_refs: [markingDefinitionId],
      },
    });
  });

  it('fails the pin backfill closed when an active latest relationship has a dangling endpoint', async function () {
    const timestamp = new Date();
    await mongoose.connection.db.collection('relationships').insertOne({
      workspace: {},
      stix: {
        type: 'relationship',
        spec_version: '2.1',
        id: activeDanglingRelationshipId,
        created: timestamp,
        modified: timestamp,
        relationship_type: 'uses',
        source_ref: missingEndpointId,
        target_ref: technique.stix.id,
        revoked: false,
        object_marking_refs: [markingDefinitionId],
      },
    });

    try {
      await expect(pinMigration.up(mongoose.connection.db)).rejects.toThrow(
        /Cannot pin 1 active latest relationship/,
      );
    } finally {
      await mongoose.connection.db
        .collection('relationships')
        .deleteOne({ 'stix.id': activeDanglingRelationshipId });
    }
  });

  it('pins latest relationships without creating manifests (superseded backfill)', async function () {
    const dryRun = await pinMigration._private.run(mongoose.connection.db, { dryRun: true });
    expect(dryRun.dry_run).toBe(true);
    expect(dryRun.relationship_pins_written).toBeGreaterThan(0);
    expect(dryRun.manifests_created).toBe(0);
    expect(dryRun.superseded_by).toBe('20260902120000-seal-release-track-content-manifests');

    await pinMigration.up(mongoose.connection.db);
    const storedRelationship = await Relationship.findOne({ 'stix.id': relationship.stix.id })
      .lean()
      .exec();
    expect(storedRelationship.workspace.relationship_endpoints.source).toEqual({
      object_ref: group.stix.id,
      object_modified: new Date(group.stix.modified),
    });
    expect(await ReleaseTrackContentManifest.countDocuments({ track_id: legacyTrackId })).toBe(0);
  });

  it('previews the content-manifest migration without writing', async function () {
    const report = await sealMigration._private.run(mongoose.connection.db, { dryRun: true });

    expect(report.dry_run).toBe(true);
    // Exactly the graphless release is sealed and its draft shares it; the
    // legacy-prefixed manifest of the cached track is recognised in place.
    expect(report.manifests_sealed).toBe(1);
    expect(report.manifests_shared).toBe(1);
    expect(report.renamed_manifest_fields).toBe(1);
    expect(report.marking_refs_migrated).toBeGreaterThanOrEqual(2);
    expect(report.collection_entries_removed).toBe(1);
    expect(report.legacy_manifest_documents_moved).toBeGreaterThanOrEqual(2);
    expect(report.manifest_headers_normalized).toBeGreaterThanOrEqual(1);
    expect(report.tracks).toBeGreaterThanOrEqual(2);
    // Other spec files may leave unregistered collections behind in the shared
    // test database, so assert on this spec's orphan rather than the full list.
    expect(report.orphan_track_collections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ collection: orphanTrackId, snapshots: 1, manifests: 1 }),
      ]),
    );
    expect(report.orphan_manifests_discarded).toBeGreaterThanOrEqual(1);
    expect(await ReleaseTrackContentManifest.countDocuments({ track_id: orphanTrackId })).toBe(1);
    expect(await ReleaseTrackContentManifest.countDocuments({ track_id: legacyTrackId })).toBe(0);
    const untouched = await trackCollection(sealedTrackId).findOne({ version: '1.0' });
    expect(untouched.graph_manifest_id).toBe(sealedManifestId);
    expect(
      await mongoose.connection.db.collection('releaseTrackGraphManifests').countDocuments({}),
    ).toBe(1);
  });

  it('seals every snapshot, freezes publication, and is rerunnable', async function () {
    await sealMigration.up(mongoose.connection.db);

    const legacySnapshots = await trackCollection(legacyTrackId)
      .find({})
      .sort({ modified: 1 })
      .toArray();
    const [legacyRelease, legacyDraft] = legacySnapshots;
    expect(legacyRelease.version).toBe('1.0');
    expect(legacyRelease.content_manifest_id).toMatch(/^release-track-content-manifest--/);
    expect(legacyRelease).not.toHaveProperty('graph_manifest_id');
    expect(legacyRelease).not.toHaveProperty('object_marking_refs');
    expect(legacyRelease.config.publication.object_marking_refs).toEqual({
      inherit: false,
      value: [markingDefinitionId],
    });
    expect(legacyRelease.publication).toMatchObject({
      object_marking_refs: [markingDefinitionId],
      collection_id: `x-mitre-collection--${legacyTrackId.split('--')[1]}`,
    });
    expect(legacyRelease.bundle_id).toBe(
      legacyRelease.content_manifest_id.replace('release-track-content-manifest--', 'bundle--'),
    );
    expect(legacyRelease.bundle_hashes.manifest_id).toBe(legacyRelease.content_manifest_id);
    // The draft has the same members, so it shares the release manifest.
    expect(legacyDraft.version).toBeNull();
    expect(legacyDraft.content_manifest_id).toBe(legacyRelease.content_manifest_id);
    expect(legacyDraft).not.toHaveProperty('publication');

    const sealedManifest = await ReleaseTrackContentManifest.findOne({
      manifest_id: legacyRelease.content_manifest_id,
    })
      .lean()
      .exec();
    expect(sealedManifest).toMatchObject({ state: 'active', seal_reason: 'migration' });
    expect(sealedManifest).not.toHaveProperty('baseline_reconstruction');
    const entries = await ReleaseTrackContentManifestEntry.find({
      manifest_id: legacyRelease.content_manifest_id,
    })
      .lean()
      .exec();
    expect(entries.filter((entry) => entry.kind === 'root')).toHaveLength(2);
    expect(entries.some((entry) => entry.object_ref === relationship.stix.id)).toBe(true);

    const cached = await trackCollection(sealedTrackId).findOne({ version: '1.0' });
    const normalizedId = sealedManifestId.replace(
      'release-track-graph-manifest--',
      'release-track-content-manifest--',
    );
    expect(cached.content_manifest_id).toBe(normalizedId);
    expect(cached).not.toHaveProperty('graph_manifest_id');
    expect(cached.config).not.toHaveProperty('include_secondary_objects');
    expect(cached.bundle_id).toBe(
      sealedManifestId.replace('release-track-graph-manifest--', 'bundle--'),
    );
    expect(cached.bundle_hashes.manifest_id).toBe(normalizedId);
    expect(cached.publication).toBeDefined();
    const normalized = await ReleaseTrackContentManifest.findOne({ manifest_id: normalizedId })
      .lean()
      .exec();
    expect(normalized).toMatchObject({ seal_reason: 'legacy_graph', schema_version: 2 });
    expect(normalized).not.toHaveProperty('resolver_version');
    expect(normalized).not.toHaveProperty('baseline_reconstruction');
    expect(
      await ReleaseTrackContentManifestEntry.countDocuments({ manifest_id: normalizedId }),
    ).toBeGreaterThan(0);
    const legacyCollections = (
      await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()
    ).map((collection) => collection.name);
    expect(legacyCollections).not.toContain('releaseTrackGraphManifests');
    expect(legacyCollections).not.toContain('releaseTrackGraphManifestEntries');
    expect(
      await ReleaseTrackContentManifestEntry.countDocuments({
        track_id: sealedTrackId,
        kind: 'collection',
      }),
    ).toBe(0);

    const bundle = await get(
      `/api/release-tracks/${legacyTrackId}/snapshots/${encodeURIComponent(
        new Date(legacyRelease.modified).toISOString(),
      )}?format=bundle`,
    );
    expect(sha256(bundle)).toBe(legacyRelease.bundle_hashes.stix_2_1);
    expect(bundle.id).toBe(legacyRelease.bundle_id);
    const objectIds = bundle.objects.map((object) => object.id);
    expect(objectIds).toContain(technique.stix.id);
    expect(objectIds).toContain(group.stix.id);
    expect(objectIds).toContain(relationship.stix.id);
    expect(bundle.objects[0]).toMatchObject({
      type: 'x-mitre-collection',
      x_mitre_version: '1.0',
      object_marking_refs: [markingDefinitionId],
    });

    // The orphan collection is skipped, its stale manifest is discarded, and
    // its dangling member never blocks the migration.
    const orphanSnapshot = await trackCollection(orphanTrackId).findOne({});
    expect(orphanSnapshot).not.toHaveProperty('content_manifest_id');
    expect(await ReleaseTrackContentManifest.countDocuments({ track_id: orphanTrackId })).toBe(0);

    const manifestCount = await ReleaseTrackContentManifest.countDocuments({});
    await sealMigration.up(mongoose.connection.db);
    expect(await ReleaseTrackContentManifest.countDocuments({})).toBe(manifestCount);
    const rerun = await trackCollection(legacyTrackId).findOne({ version: '1.0' });
    expect(rerun.content_manifest_id).toBe(legacyRelease.content_manifest_id);
    expect(rerun.bundle_hashes).toEqual(legacyRelease.bundle_hashes);
  });

  it('replays and activates a complete linked pending manifest after interruption', async function () {
    const snapshot = await trackCollection(legacyTrackId).findOne({}, { sort: { modified: -1 } });
    await ReleaseTrackContentManifest.updateOne(
      { manifest_id: snapshot.content_manifest_id },
      { $set: { state: 'pending' } },
    ).exec();

    await get(`/api/release-tracks/${legacyTrackId}/snapshots/latest?format=bundle`);

    const manifest = await ReleaseTrackContentManifest.findOne({
      manifest_id: snapshot.content_manifest_id,
    })
      .lean()
      .exec();
    expect(manifest.state).toBe('active');
  });

  after(async function () {
    await database.closeConnection();
  });
});
