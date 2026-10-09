'use strict';

const request = require('supertest');
const { expect } = require('expect');

const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const { releaseExactMembers } = require('./release-track-test-helpers');

const staticMarkingDefinitionId = 'marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168';

function buildTechnique(name, previous) {
  const timestamp = previous
    ? new Date(new Date(previous.stix.modified).getTime() + 1000).toISOString()
    : new Date().toISOString();

  return {
    workspace: { workflow: { state: 'work-in-progress' } },
    stix: {
      id: previous?.stix.id,
      created: previous?.stix.created || timestamp,
      modified: timestamp,
      created_by_ref: previous?.stix.created_by_ref,
      name,
      description: `${name} description`,
      spec_version: '2.1',
      type: 'attack-pattern',
      object_marking_refs: [staticMarkingDefinitionId],
      kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'persistence' }],
      x_mitre_version: '1.0',
      x_mitre_domains: ['enterprise-attack'],
      x_mitre_is_subtechnique: false,
      x_mitre_platforms: ['Windows'],
    },
  };
}

describe('Virtual release-track quarantine API', function () {
  let app;
  let passportCookie;

  before(async function () {
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();

    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;

    app = await require('../../../index').initializeApp();
    passportCookie = await login.loginAnonymous(app);
  });

  async function post(path, body, status = 200) {
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

  async function createTrack(name, type = 'standard', composition) {
    return post('/api/release-tracks/new', { name, type, composition }, 201);
  }

  async function createReleasedComponent(name, member) {
    const track = await createTrack(name);
    await releaseExactMembers(app, passportCookie, track.id, [member]);
    return track;
  }

  async function getTechniqueVersion(technique) {
    return get(
      `/api/techniques/${technique.stix.id}/modified/${encodeURIComponent(technique.stix.modified)}`,
    );
  }

  function entryForTrack(object, trackId) {
    return (object.workspace.release_tracks || []).find((entry) => entry.id === trackId);
  }

  it('validates quarantine promotion requests and enforces virtual track type', async function () {
    const technique = await post('/api/techniques', buildTechnique('Quarantine Guard'), 201);
    const standard = await createTrack('Quarantine Standard Guard');
    const body = {
      object_ref: technique.stix.id,
      object_modified: technique.stix.modified,
    };

    await post(`/api/release-tracks/${standard.id}/virtual/quarantine/promote`, body, 400);
    await post(
      `/api/release-tracks/${standard.id}/virtual/quarantine/promote`,
      { object_ref: technique.stix.id },
      400,
    );
  });

  it('promotes one exact revision and removes its quarantined alternatives in a new draft', async function () {
    const revisionA = await post('/api/techniques', buildTechnique('Quarantine Resolution A'), 201);
    const revisionB = await post(
      '/api/techniques',
      buildTechnique('Quarantine Resolution B', revisionA),
      201,
    );
    const componentA = await createReleasedComponent('Quarantine Component A', revisionA);
    const componentB = await createReleasedComponent('Quarantine Component B', revisionB);
    const virtual = await createTrack('Quarantine Resolution Virtual', 'virtual', {
      component_tracks: [
        {
          track_id: componentA.id,
          resolution_strategy: 'latest_tagged',
          priority: 1,
        },
        {
          track_id: componentB.id,
          resolution_strategy: 'latest_tagged',
          priority: 2,
        },
      ],
      deduplication: { strategy: 'quarantine' },
    });
    const materialized = await post(
      `/api/release-tracks/${virtual.id}/virtual/snapshots/create`,
      {},
      201,
    );

    expect(materialized.members).toEqual([]);
    expect(materialized.quarantine).toHaveLength(2);
    expect(materialized.quarantine.map((entry) => entry.object_modified).sort()).toEqual(
      [revisionA.stix.modified, revisionB.stix.modified].sort(),
    );

    const materializedResolution = materialized.composition_resolution;
    const revisionABefore = await getTechniqueVersion(revisionA);
    const revisionBBefore = await getTechniqueVersion(revisionB);
    expect(entryForTrack(revisionABefore, virtual.id)).toMatchObject({
      type: 'virtual',
      tier: 'quarantine',
    });
    expect(entryForTrack(revisionBBefore, virtual.id)).toMatchObject({
      type: 'virtual',
      tier: 'quarantine',
    });

    await post(
      `/api/release-tracks/${virtual.id}/virtual/quarantine/promote`,
      {
        object_ref: revisionA.stix.id,
        object_modified: new Date(new Date(revisionB.stix.modified).getTime() + 1000).toISOString(),
      },
      404,
    );
    const unchanged = await get(`/api/release-tracks/${virtual.id}/snapshots/latest`);
    expect(unchanged.modified).toBe(materialized.modified);

    const promoted = await post(`/api/release-tracks/${virtual.id}/virtual/quarantine/promote`, {
      object_ref: revisionB.stix.id,
      object_modified: revisionB.stix.modified,
    });

    expect(promoted.modified).not.toBe(materialized.modified);
    expect(promoted.creation_cause).toBe('quarantine_promoted');
    expect(materialized.creation_cause).toBe('manual_snapshot');
    expect(promoted.version).toBeNull();
    expect(promoted.members).toEqual([
      {
        object_ref: revisionB.stix.id,
        object_modified: revisionB.stix.modified,
      },
    ]);
    expect(promoted.quarantine).toEqual([]);
    expect(promoted.composition_resolution).toEqual(materializedResolution);

    const historical = await get(
      `/api/release-tracks/${virtual.id}/snapshots/${encodeURIComponent(materialized.modified)}`,
    );
    expect(historical.members).toEqual([]);
    expect(historical.quarantine).toHaveLength(2);

    const revisionAAfter = await getTechniqueVersion(revisionA);
    const revisionBAfter = await getTechniqueVersion(revisionB);
    expect(entryForTrack(revisionAAfter, virtual.id)).toBeUndefined();
    expect(entryForTrack(revisionBAfter, virtual.id)).toEqual({
      id: virtual.id,
      type: 'virtual',
      tier: 'members',
      status: 'reviewed',
    });

    const preview = await get(`/api/release-tracks/${virtual.id}/snapshots/latest/release/preview`);
    expect(preview).toMatchObject({
      type: 'virtual',
      releasable: true,
      after: { members_count: 1, quarantine_count: 0 },
      changes: { quarantined_count: 0 },
    });
  });
});
