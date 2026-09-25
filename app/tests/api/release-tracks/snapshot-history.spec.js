const request = require('supertest');
const { expect } = require('expect');

const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const dynamicRepo = require('../../../repository/release-tracks/release-track-dynamic.repository');
const registryRepo = require('../../../repository/release-tracks/release-track-registry.repository');
const {
  ReleaseTrackContentManifestEntry,
} = require('../../../models/release-tracks/release-track-content-manifest-model');

const markingDefinitionId = 'marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168';
const objectRevisions = [];

function memberEntry(index) {
  return {
    object_ref: objectRevisions[index].id,
    object_modified: objectRevisions[index].modified,
  };
}

function stagedEntry(index, modified) {
  return {
    ...memberEntry(index),
    object_status: 'reviewed',
    object_staged_at: modified,
    object_staged_by: 'snapshot-history-test',
  };
}

function candidateEntry(index, modified) {
  return {
    ...memberEntry(index),
    object_status: 'work-in-progress',
    object_added_at: modified,
    object_added_by: 'snapshot-history-test',
  };
}

function snapshotBase(snapshot) {
  const clone = { ...snapshot };
  delete clone._id;
  delete clone.__v;
  return clone;
}

describe('GET /api/release-tracks/:id/snapshots', function () {
  let app;
  let passportCookie;
  let standardTrack;
  let virtualTrack;
  let standardTaggedModified;
  let standardLatestModified;
  let virtualResolvedAt;

  before(async function () {
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();

    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;

    app = await require('../../../index').initializeApp();
    passportCookie = await login.loginAnonymous(app);

    for (let index = 0; index < 6; index++) {
      objectRevisions.push(await createTechnique(`Snapshot History Technique ${index + 1}`));
    }
    standardTrack = await createTrack('Snapshot History Standard', 'standard');
    virtualTrack = await createTrack('Snapshot History Virtual', 'virtual');

    const standardCreated = new Date(standardTrack.modified);
    standardTaggedModified = new Date(standardCreated.getTime() + 1000);
    standardLatestModified = new Date(standardCreated.getTime() + 2000);

    await dynamicRepo.saveSnapshot(standardTrack.id, {
      ...snapshotBase(standardTrack),
      modified: standardTaggedModified,
      version: '1.0',
      content_manifest_id: 'release-track-content-manifest--snapshot-history',
      bundle_id: 'bundle--snapshot-history',
      bundle_hashes: {
        manifest_id: 'release-track-content-manifest--snapshot-history',
        stix_2_0: 'a'.repeat(64),
        stix_2_1: 'b'.repeat(64),
      },
      members: [memberEntry(0), memberEntry(1)],
      staged: [stagedEntry(2, standardTaggedModified)],
      candidates: [
        candidateEntry(3, standardTaggedModified),
        candidateEntry(4, standardTaggedModified),
        candidateEntry(5, standardTaggedModified),
      ],
    });
    const manifestCommon = {
      manifest_id: 'release-track-content-manifest--snapshot-history',
      track_id: standardTrack.id,
      snapshot_modified: standardTaggedModified,
    };
    const versionedManifestEntry = (index, kind, extra = {}) => ({
      ...manifestCommon,
      revision_key: `${objectRevisions[index].id}::${new Date(
        objectRevisions[index].modified,
      ).getTime()}`,
      kind,
      object_ref: objectRevisions[index].id,
      object_modified: objectRevisions[index].modified,
      ...extra,
    });
    await ReleaseTrackContentManifestEntry.insertMany([
      versionedManifestEntry(0, 'root', { tier: 'members' }),
      versionedManifestEntry(1, 'root', { tier: 'members' }),
      versionedManifestEntry(2, 'secondary'),
      versionedManifestEntry(3, 'secondary'),
      versionedManifestEntry(4, 'relationship'),
      {
        ...manifestCommon,
        revision_key: `${markingDefinitionId}::unversioned`,
        kind: 'supporting',
        object_ref: markingDefinitionId,
      },
      versionedManifestEntry(5, 'link_target'),
    ]);
    await dynamicRepo.saveSnapshot(standardTrack.id, {
      ...snapshotBase(standardTrack),
      modified: standardLatestModified,
      version: null,
      members: [memberEntry(0)],
      staged: [stagedEntry(1, standardLatestModified), stagedEntry(2, standardLatestModified)],
      candidates: [candidateEntry(3, standardLatestModified)],
    });
    await registryRepo.updateByTrackId(standardTrack.id, {
      latest_snapshot_modified: standardLatestModified,
      snapshot_count: 3,
    });
    await registryRepo.replaceTaggedReleases(
      standardTrack.id,
      [
        {
          snapshot_modified: standardTaggedModified,
          version: '1.0',
          tagged_at: standardTaggedModified,
          tagged_by: 'snapshot-history-test',
        },
      ],
      '1.0',
    );

    const virtualCreated = new Date(virtualTrack.modified);
    const virtualTaggedModified = new Date(virtualCreated.getTime() + 1000);
    virtualResolvedAt = new Date(virtualCreated.getTime() + 500);
    await dynamicRepo.saveSnapshot(virtualTrack.id, {
      ...snapshotBase(virtualTrack),
      modified: virtualTaggedModified,
      version: '1.0',
      members: [memberEntry(0), memberEntry(1)],
      composition_resolution: {
        resolved_at: virtualResolvedAt,
        component_snapshots: [
          {
            track_id: standardTrack.id,
            track_name: standardTrack.name,
            track_type: 'standard',
            resolved_snapshot_id: standardTaggedModified,
            resolved_version: '1.0',
            strategy_used: 'latest_tagged',
            filters_applied: { domains: ['enterprise'] },
            total_objects_in_source: 2,
            objects_after_filter: 2,
            objects_contributed: 2,
          },
        ],
        deduplication: {
          total_objects_before: 2,
          total_objects_after: 2,
          duplicates_found: 0,
          conflicts_resolved: [],
        },
        summary: {
          total_objects: 2,
          quarantined_objects: 1,
        },
      },
      quarantine: [
        {
          ...memberEntry(2),
          source_track_id: standardTrack.id,
          source_track_name: standardTrack.name,
          source_snapshot_version: '1.0',
          conflict_reason: 'conflicting object revisions',
        },
      ],
    });
    await registryRepo.updateByTrackId(virtualTrack.id, {
      latest_snapshot_modified: virtualTaggedModified,
      snapshot_count: 2,
    });
    await registryRepo.replaceTaggedReleases(
      virtualTrack.id,
      [
        {
          snapshot_modified: virtualTaggedModified,
          version: '1.0',
          tagged_at: virtualTaggedModified,
          tagged_by: 'snapshot-history-test',
        },
      ],
      '1.0',
    );
  });

  async function createTrack(name, type) {
    const response = await request(app)
      .post('/api/release-tracks/new')
      .send({ name, type })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201);
    return response.body;
  }

  async function createTechnique(name) {
    const timestamp = new Date().toISOString();
    const response = await request(app)
      .post('/api/techniques')
      .send({
        workspace: { workflow: { state: 'work-in-progress' } },
        stix: {
          type: 'attack-pattern',
          spec_version: '2.1',
          created: timestamp,
          modified: timestamp,
          name,
          description: `${name} description`,
          object_marking_refs: [markingDefinitionId],
          kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'persistence' }],
          x_mitre_is_subtechnique: false,
          x_mitre_platforms: ['Windows'],
        },
      })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201);
    return {
      id: response.body.stix.id,
      modified: response.body.stix.modified,
    };
  }

  function get(path, status = 200) {
    return request(app)
      .get(path)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(status);
  }

  it('returns every standard snapshot newest first with standard tier counts', async function () {
    const response = await get(`/api/release-tracks/${standardTrack.id}/snapshots`);

    expect(response.body.pagination).toEqual({
      total: 3,
      limit: 50,
      offset: 0,
    });
    expect(response.body.counts).toEqual({ tagged: 1, drafts: 2, total: 3 });
    expect(response.body.latest_snapshot_modified).toBe(standardLatestModified.toISOString());
    expect(response.body.latest_tagged_snapshot_modified).toBe(
      standardTaggedModified.toISOString(),
    );
    expect(response.body.data).toHaveLength(3);
    expect(response.body.data[0]).toMatchObject({
      id: standardTrack.id,
      type: 'standard',
      modified: standardLatestModified.toISOString(),
      version: null,
      members_count: 1,
      staged_count: 2,
      candidates_count: 1,
    });
    expect(response.body.data[0]).not.toHaveProperty('quarantine_count');
    // The rolling draft inherits the track-creation manifest, which holds
    // only the publishing identity as a supporting object.
    expect(response.body.data[0]).toMatchObject({
      content_manifest_id: standardTrack.content_manifest_id,
      content_statistics: {
        primary_count: 0,
        secondary_count: 0,
        relationship_count: 0,
        supporting_count: 1,
        link_target_count: 0,
        total_count: 1,
      },
    });
    expect(response.body.data[0]).not.toHaveProperty('bundle_id');
    expect(response.body.data[1]).toMatchObject({
      modified: standardTaggedModified.toISOString(),
      version: '1.0',
      content_manifest_id: 'release-track-content-manifest--snapshot-history',
      bundle_id: 'bundle--snapshot-history',
      bundle_hashes: {
        manifest_id: 'release-track-content-manifest--snapshot-history',
        stix_2_0: 'a'.repeat(64),
        stix_2_1: 'b'.repeat(64),
      },
      members_count: 2,
      staged_count: 1,
      candidates_count: 3,
      content_statistics: {
        primary_count: 2,
        secondary_count: 2,
        relationship_count: 1,
        supporting_count: 1,
        link_target_count: 1,
        total_count: 7,
      },
    });
  });

  it('returns type-oriented counts for virtual snapshots', async function () {
    const response = await get(`/api/release-tracks/${virtualTrack.id}/snapshots?tagged=true`);

    expect(response.body.pagination.total).toBe(1);
    expect(response.body.counts).toEqual({ tagged: 1, drafts: 0, total: 1 });
    expect(response.body.latest_snapshot_modified).toBe(response.body.data[0].modified);
    expect(response.body.latest_tagged_snapshot_modified).toBe(response.body.data[0].modified);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      id: virtualTrack.id,
      type: 'virtual',
      version: '1.0',
      members_count: 2,
      quarantine_count: 1,
      composition_resolution: {
        resolved_at: virtualResolvedAt.toISOString(),
        component_snapshots: [
          {
            track_id: standardTrack.id,
            track_name: standardTrack.name,
            track_type: 'standard',
            resolved_snapshot_id: standardTaggedModified.toISOString(),
            resolved_version: '1.0',
            strategy_used: 'latest_tagged',
            filters_applied: { domains: ['enterprise'] },
            total_objects_in_source: 2,
            objects_after_filter: 2,
            objects_contributed: 2,
          },
        ],
      },
    });
    expect(response.body.data[0].composition_resolution).not.toHaveProperty('deduplication');
    expect(response.body.data[0].composition_resolution).not.toHaveProperty('summary');
    expect(response.body.data[0]).not.toHaveProperty('staged_count');
    expect(response.body.data[0]).not.toHaveProperty('candidates_count');
  });

  it('filters tagged and untagged snapshots before pagination', async function () {
    const tagged = await get(
      `/api/release-tracks/${standardTrack.id}/snapshots?tagged=true&limit=1&offset=0`,
    );
    expect(tagged.body.pagination).toEqual({
      total: 1,
      limit: 1,
      offset: 0,
    });
    expect(tagged.body.counts).toEqual({ tagged: 1, drafts: 0, total: 1 });
    expect(tagged.body.latest_snapshot_modified).toBe(standardLatestModified.toISOString());
    expect(tagged.body.latest_tagged_snapshot_modified).toBe(standardTaggedModified.toISOString());
    expect(tagged.body.data.map((snapshot) => snapshot.version)).toEqual(['1.0']);

    const untagged = await get(
      `/api/release-tracks/${standardTrack.id}/snapshots?tagged=false&limit=1&offset=1`,
    );
    expect(untagged.body.pagination).toEqual({
      total: 2,
      limit: 1,
      offset: 1,
    });
    expect(untagged.body.counts).toEqual({ tagged: 0, drafts: 2, total: 2 });
    expect(untagged.body.latest_snapshot_modified).toBe(standardLatestModified.toISOString());
    expect(untagged.body.latest_tagged_snapshot_modified).toBe(
      standardTaggedModified.toISOString(),
    );
    expect(untagged.body.data).toHaveLength(1);
    expect(untagged.body.data[0].version).toBeNull();
  });

  it('retains full matching counts on partial and off-end pages', async function () {
    const partial = await get(`/api/release-tracks/${standardTrack.id}/snapshots?limit=1&offset=1`);
    expect(partial.body.counts).toEqual({ tagged: 1, drafts: 2, total: 3 });
    expect(partial.body.pagination).toEqual({ total: 3, limit: 1, offset: 1 });
    expect(partial.body.data.map((snapshot) => snapshot.modified)).toEqual([
      standardTaggedModified.toISOString(),
    ]);

    for (const [filter, counts] of [
      ['', { tagged: 1, drafts: 2, total: 3 }],
      ['&tagged=true', { tagged: 1, drafts: 0, total: 1 }],
      ['&tagged=false', { tagged: 0, drafts: 2, total: 2 }],
    ]) {
      const response = await get(
        `/api/release-tracks/${standardTrack.id}/snapshots?limit=1&offset=10${filter}`,
      );
      expect(response.body.data).toEqual([]);
      expect(response.body.counts).toEqual(counts);
      expect(response.body.pagination).toEqual({ total: counts.total, limit: 1, offset: 10 });
      expect(response.body.latest_snapshot_modified).toBe(standardLatestModified.toISOString());
      expect(response.body.latest_tagged_snapshot_modified).toBe(
        standardTaggedModified.toISOString(),
      );
    }
  });

  it('reports no releases for a draft-only track without losing its latest identity', async function () {
    const track = await createTrack('History Draft Only', 'virtual');
    const all = await get(`/api/release-tracks/${track.id}/snapshots`);
    expect(all.body.counts).toEqual({ tagged: 0, drafts: 1, total: 1 });
    expect(all.body.latest_tagged_snapshot_modified).toBeNull();

    const releases = await get(`/api/release-tracks/${track.id}/snapshots?tagged=true`);
    expect(releases.body.data).toEqual([]);
    expect(releases.body.counts).toEqual({ tagged: 0, drafts: 0, total: 0 });
    expect(releases.body.pagination.total).toBe(0);
    expect(releases.body.latest_snapshot_modified).toBe(track.modified);
    expect(releases.body.latest_tagged_snapshot_modified).toBeNull();
  });

  it('uses chronological release identities on historical pages of a release-only track', async function () {
    const track = await createTrack('History Releases Only', 'standard');
    await dynamicRepo.updateSnapshot(track.id, track.modified, { $set: { version: '9.0' } });
    const newerModified = new Date(new Date(track.modified).getTime() + 1000);
    await dynamicRepo.saveSnapshot(track.id, {
      ...snapshotBase(track),
      modified: newerModified,
      version: '1.0',
    });
    await registryRepo.updateByTrackId(track.id, {
      latest_snapshot_modified: newerModified,
      snapshot_count: 2,
    });
    // The newest snapshot comes first and has the lower version: neither the
    // final ledger entry nor the highest semantic version identifies Latest.
    await registryRepo.replaceTaggedReleases(
      track.id,
      [
        {
          snapshot_modified: newerModified,
          version: '1.0',
          tagged_at: newerModified,
          tagged_by: 'snapshot-history-test',
        },
        {
          snapshot_modified: track.modified,
          version: '9.0',
          tagged_at: track.modified,
          tagged_by: 'snapshot-history-test',
        },
      ],
      '9.0',
    );

    const releases = await get(
      `/api/release-tracks/${track.id}/snapshots?tagged=true&limit=1&offset=1`,
    );
    expect(releases.body.data.map((snapshot) => snapshot.version)).toEqual(['9.0']);
    expect(releases.body.counts).toEqual({ tagged: 2, drafts: 0, total: 2 });
    expect(releases.body.pagination.total).toBe(2);
    expect(releases.body.latest_snapshot_modified).toBe(newerModified.toISOString());
    expect(releases.body.latest_tagged_snapshot_modified).toBe(newerModified.toISOString());

    const drafts = await get(`/api/release-tracks/${track.id}/snapshots?tagged=false`);
    expect(drafts.body.data).toEqual([]);
    expect(drafts.body.counts).toEqual({ tagged: 0, drafts: 0, total: 0 });
    expect(drafts.body.pagination.total).toBe(0);
    expect(drafts.body.latest_snapshot_modified).toBe(newerModified.toISOString());
    expect(drafts.body.latest_tagged_snapshot_modified).toBe(newerModified.toISOString());
  });

  it('returns zero counts and null identities for an empty track history', async function () {
    const track = await createTrack('History Empty', 'virtual');
    await dynamicRepo.deleteSnapshot(track.id, track.modified);
    await registryRepo.updateByTrackId(track.id, {
      latest_snapshot_modified: null,
      snapshot_count: 0,
    });

    const response = await get(`/api/release-tracks/${track.id}/snapshots?limit=1&offset=10`);
    expect(response.body.data).toEqual([]);
    expect(response.body.counts).toEqual({ tagged: 0, drafts: 0, total: 0 });
    expect(response.body.pagination).toEqual({ total: 0, limit: 1, offset: 10 });
    expect(response.body.latest_snapshot_modified).toBeNull();
    expect(response.body.latest_tagged_snapshot_modified).toBeNull();
  });

  it('retrieves the latest snapshot from the canonical endpoint', async function () {
    const response = await get(`/api/release-tracks/${standardTrack.id}/snapshots/latest`);

    expect(response.body.modified).toBe(standardLatestModified.toISOString());
    expect(response.body.members).toHaveLength(1);
    expect(response.body.staged).toHaveLength(2);
    expect(response.body.candidates).toHaveLength(1);
  });

  it('does not allow latest-snapshot retrieval at the release-track resource path', async function () {
    await get(`/api/release-tracks/${standardTrack.id}`, 405);
  });

  it('rejects invalid filter and pagination values', async function () {
    await get(`/api/release-tracks/${standardTrack.id}/snapshots?tagged=yes`, 400);
    await get(`/api/release-tracks/${standardTrack.id}/snapshots?limit=0`, 400);
    await get(`/api/release-tracks/${standardTrack.id}/snapshots?limit=201`, 400);
    await get(`/api/release-tracks/${standardTrack.id}/snapshots?offset=-1`, 400);
    await get(`/api/release-tracks/${standardTrack.id}/snapshots?versions=all`, 400);
    await get(`/api/release-tracks/${standardTrack.id}/snapshots?include=members`, 400);
  });

  it('returns 404 when the release track does not exist', async function () {
    await get(
      '/api/release-tracks/release-track--00000000-0000-4000-8000-000000000099/snapshots',
      404,
    );
  });

  after(async function () {
    await database.closeConnection();
  });
});
