const mongoose = require('mongoose');
const request = require('supertest');
const { expect } = require('expect');

const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const ReleaseTrackRegistry = require('../../../models/release-tracks/release-track-registry-model');
const backfillMigration = require('../../../../migrations/20260716000000-backfill-release-track-tagged-releases');
const { stageExactMembers } = require('./release-track-test-helpers');

const staticMarkingDefinitionId = 'marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168';

function buildTechnique(name, identity = {}) {
  const timestamp = new Date().toISOString();
  return {
    workspace: { workflow: { state: 'work-in-progress' } },
    stix: {
      ...identity,
      created: identity.created || timestamp,
      modified: identity.modified || timestamp,
      name,
      description: `${name} description`,
      spec_version: '2.1',
      type: 'attack-pattern',
      object_marking_refs: [staticMarkingDefinitionId],
      kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'persistence' }],
      x_mitre_is_subtechnique: false,
      x_mitre_platforms: ['Windows'],
      x_mitre_version: '1.0',
      x_mitre_domains: ['enterprise-attack'],
    },
  };
}

describe('GET /api/release-tracks/objects/:objectRef/releases', function () {
  let app;
  let passportCookie;
  let objectRevisionA;
  let objectRevisionB;
  let otherObject;
  let trackA;
  let trackATaggedSnapshot;
  let trackB;
  let virtualTrack;

  before(async function () {
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();

    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;

    app = await require('../../../index').initializeApp();
    passportCookie = await login.loginAnonymous(app);

    objectRevisionA = await post('/api/techniques', buildTechnique('Release Lineage A'), 201);
    objectRevisionB = await post(
      '/api/techniques',
      buildTechnique('Release Lineage B', {
        id: objectRevisionA.stix.id,
        created: objectRevisionA.stix.created,
        modified: new Date(new Date(objectRevisionA.stix.modified).getTime() + 1000).toISOString(),
      }),
      201,
    );
    otherObject = await post('/api/techniques', buildTechnique('Other Release Object'), 201);

    const createdA = await createTrack('Releases By Object A');
    trackA = createdA.id;
    await setMembers(trackA, [objectRevisionA]);
    trackATaggedSnapshot = await releaseLatest(trackA);

    // Append another object in a later release. Existing members remain part
    // of the immutable lineage because direct member replacement is not
    // supported.
    await setMembers(trackA, [otherObject]);
    await releaseLatest(trackA);

    const createdB = await createTrack('Releases By Object B');
    trackB = createdB.id;
    await setMembers(trackB, [objectRevisionB]);
    await releaseLatest(trackB);

    // A tagged snapshot where the object is only a candidate must not match.
    const candidateOnly = await createTrack('Releases Candidate Only');
    await post(
      `/api/release-tracks/${candidateOnly.id}/candidates`,
      { object_refs: [{ id: objectRevisionA.stix.id, modified: objectRevisionA.stix.modified }] },
      200,
    );
    await releaseLatest(candidateOnly.id);

    // Virtual tagged releases use the same direct-members semantics.
    const virtual = await post(
      '/api/release-tracks/new',
      { name: 'Releases By Object Virtual', type: 'virtual' },
      201,
    );
    virtualTrack = virtual.id;
    await put(`/api/release-tracks/${virtualTrack}/virtual/composition`, {
      component_tracks: [{ track_id: trackB, resolution_strategy: 'latest_tagged', priority: 0 }],
    });
    await post(`/api/release-tracks/${virtualTrack}/virtual/snapshots/create`, {}, 201);
    await releaseLatest(virtualTrack);
  });

  async function post(path, body, status) {
    const response = await request(app)
      .post(path)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`);
    if (response.status !== status) {
      throw new Error(
        `${path} expected ${status}, received ${response.status}: ${JSON.stringify(response.body)}`,
      );
    }
    return response.body;
  }

  async function put(path, body, status = 200) {
    const response = await request(app)
      .put(path)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(status);
    return response.body;
  }

  async function get(path, status = 200) {
    return request(app)
      .get(path)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(status);
  }

  async function createTrack(name) {
    return post('/api/release-tracks/new', { name, type: 'standard' }, 201);
  }

  async function setMembers(trackId, objects) {
    return stageExactMembers(app, passportCookie, trackId, objects);
  }

  async function releaseLatest(trackId, increment = 'minor') {
    return post(
      `/api/release-tracks/${trackId}/snapshots/latest/release`,
      {
        increment,
      },
      200,
    );
  }

  it('returns historical tagged member occurrences across tracks and revisions', async function () {
    const response = await get(`/api/release-tracks/objects/${objectRevisionA.stix.id}/releases`);

    expect(response.body.object_ref).toBe(objectRevisionA.stix.id);
    expect(response.body.pagination).toEqual({ total: 4, limit: 50, offset: 0 });
    expect(response.body.data).toHaveLength(4);

    const standardA = response.body.data.filter((entry) => entry.track_id === trackA);
    const standardB = response.body.data.find((entry) => entry.track_id === trackB);
    const virtual = response.body.data.find((entry) => entry.track_id === virtualTrack);

    expect(standardA).toHaveLength(2);
    expect(standardA).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          track_type: 'standard',
          track_name: 'Releases By Object A',
          version: '1.0',
          object_modified: objectRevisionA.stix.modified,
        }),
        expect.objectContaining({
          track_type: 'standard',
          track_name: 'Releases By Object A',
          version: '1.1',
          object_modified: objectRevisionA.stix.modified,
        }),
      ]),
    );
    expect(standardB).toMatchObject({
      track_type: 'standard',
      version: '1.0',
      object_modified: objectRevisionB.stix.modified,
    });
    expect(virtual).toMatchObject({
      track_type: 'virtual',
      version: '1.0',
      object_modified: objectRevisionB.stix.modified,
    });
    expect(response.body.data.every((entry) => entry.tagged_at && entry.tagged_by)).toBe(true);
  });

  it('maintains a reconciled registry catalogue during normal tagging', async function () {
    const registry = await ReleaseTrackRegistry.findOne({ track_id: trackA }).lean().exec();
    expect(registry.tagged_release_count).toBe(2);
    expect(registry.tagged_releases).toHaveLength(2);
    expect(registry.tagged_releases.map((release) => release.version).sort()).toEqual([
      '1.0',
      '1.1',
    ]);
    expect(registry.latest_tagged_version).toBe('1.1');
  });

  it('previews the next version from the track-wide release ledger', async function () {
    await post(
      `/api/release-tracks/${trackA}/meta`,
      { description: 'Draft created after the current release' },
      200,
    );

    const minor = await get(
      `/api/release-tracks/${trackA}/snapshots/latest/release/preview?increment=minor`,
    );
    const major = await get(
      `/api/release-tracks/${trackA}/snapshots/latest/release/preview?increment=major`,
    );
    expect(minor.body.version).toBe('1.2');
    expect(major.body.version).toBe('2.0');
  });

  it('supports type filtering, ordering, and pagination', async function () {
    const standard = await get(
      `/api/release-tracks/objects/${objectRevisionA.stix.id}/releases?type=standard&order=desc&limit=1&offset=1`,
    );
    expect(standard.body.pagination).toEqual({ total: 3, limit: 1, offset: 1 });
    expect(standard.body.data).toHaveLength(1);
    expect(standard.body.data[0].track_type).toBe('standard');

    const virtual = await get(
      `/api/release-tracks/objects/${objectRevisionA.stix.id}/releases?type=virtual`,
    );
    expect(virtual.body.pagination.total).toBe(1);
    expect(virtual.body.data[0].track_id).toBe(virtualTrack);
  });

  it('returns an empty list for a valid STIX ID with no tagged membership', async function () {
    const missing = 'attack-pattern--99999999-9999-4999-8999-999999999999';
    const response = await get(`/api/release-tracks/objects/${missing}/releases`);
    expect(response.body).toEqual({
      object_ref: missing,
      data: [],
      pagination: { total: 0, limit: 50, offset: 0 },
    });
  });

  it('rejects malformed STIX IDs and invalid query values', async function () {
    await get('/api/release-tracks/objects/not-a-stix-id/releases', 400);
    await get(
      `/api/release-tracks/objects/${objectRevisionA.stix.id}/releases?order=sideways`,
      400,
    );
    await get(`/api/release-tracks/objects/${objectRevisionA.stix.id}/releases?limit=0`, 400);
  });

  it('rejects direct deletion of a tagged release', async function () {
    await request(app)
      .delete(`/api/release-tracks/${trackA}/snapshots/${trackATaggedSnapshot.modified}`)
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(409);
  });

  it('backfills missing registry refs from authoritative tagged snapshots', async function () {
    await ReleaseTrackRegistry.updateOne(
      { track_id: trackA },
      {
        $set: { tagged_releases: [], tagged_release_count: 0, latest_tagged_version: null },
      },
    );

    await backfillMigration.up(mongoose.connection.db);

    const registry = await ReleaseTrackRegistry.findOne({ track_id: trackA }).lean().exec();
    expect(registry.tagged_releases).toHaveLength(2);
    expect(registry.tagged_release_count).toBe(2);
    expect(registry.latest_tagged_version).toBe('1.1');

    const response = await get(
      `/api/release-tracks/objects/${objectRevisionA.stix.id}/releases?type=standard`,
    );
    expect(response.body.pagination.total).toBe(3);
  });
});
