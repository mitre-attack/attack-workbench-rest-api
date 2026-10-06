'use strict';

const request = require('supertest');
const { expect } = require('expect');
const sinon = require('sinon');
const { v4: uuidv4 } = require('uuid');

const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const Technique = require('../../../models/technique-model');
const ReleaseTrackRegistry = require('../../../models/release-tracks/release-track-registry-model');
const dynamicRepo = require('../../../repository/release-tracks/release-track-dynamic.repository');
const techniquesRepo = require('../../../repository/techniques-repository');
const { DatabaseError } = require('../../../exceptions');
const { releaseExactMembers } = require('./release-track-test-helpers');

const markingDefinitionId = 'marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168';

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
      name,
      description: `${name} description`,
      spec_version: '2.1',
      type: 'attack-pattern',
      object_marking_refs: [markingDefinitionId],
      kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'persistence' }],
      x_mitre_is_subtechnique: false,
      x_mitre_platforms: ['Windows'],
      x_mitre_version: '1.0',
      x_mitre_domains: ['enterprise-attack'],
    },
  };
}

describe('Release-track primary revision integrity API', function () {
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

  after(async function () {
    await database.closeConnection();
  });

  async function api(method, path, body, status) {
    const call = request(app)
      [method](path)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`);
    if (body !== undefined) call.send(body);
    return call.expect(status);
  }

  async function post(path, body, status = 200) {
    return (await api('post', path, body, status)).body;
  }

  async function get(path, status = 200) {
    return (await api('get', path, undefined, status)).body;
  }

  async function createTechnique(name, previous) {
    return post('/api/techniques', buildTechnique(name, previous), 201);
  }

  async function createTrack(name, type = 'standard', extra = {}) {
    return post('/api/release-tracks/new', { name, type, ...extra }, 201);
  }

  function missingRevision(objectRef = `attack-pattern--${uuidv4()}`) {
    return {
      object_ref: objectRef,
      object_modified: '2026-01-01T00:00:00.000Z',
    };
  }

  async function deleteTechniqueRevision(technique) {
    await Technique.deleteOne({
      'stix.id': technique.stix.id,
      'stix.modified': new Date(technique.stix.modified),
    });
  }

  it('rejects nonexistent exact candidate pins without creating a snapshot', async function () {
    const track = await createTrack('Reject Missing Candidate');
    const missing = missingRevision();

    const response = await api(
      'post',
      `/api/release-tracks/${track.id}/candidates`,
      {
        object_refs: [{ id: missing.object_ref, modified: missing.object_modified }],
      },
      400,
    );
    expect(response.body).toEqual({
      message: 'One or more object revisions do not exist',
      missing_references: [missing],
    });

    expect((await dynamicRepo.getAllSnapshots(track.id)).pagination.total).toBe(1);
  });

  it('rejects a candidate pin update to a nonexistent revision', async function () {
    const technique = await createTechnique('Reject Missing Candidate Update');
    const track = await createTrack('Reject Missing Candidate Update Track');
    await post(`/api/release-tracks/${track.id}/candidates`, {
      object_refs: [{ id: technique.stix.id, modified: technique.stix.modified }],
    });
    const missing = missingRevision(technique.stix.id);

    const response = await api(
      'post',
      `/api/release-tracks/${track.id}/candidates/${technique.stix.id}/update-version`,
      {
        old_modified: technique.stix.modified,
        new_modified: missing.object_modified,
      },
      400,
    );
    expect(response.body.missing_references).toEqual([missing]);

    const latest = await get(`/api/release-tracks/${track.id}/snapshots/latest`);
    expect(latest.candidates[0].object_modified).toBe(technique.stix.modified);
  });

  it('fails preview and release when a staged revision was deleted', async function () {
    const technique = await createTechnique('Deleted Staged Revision');
    const track = await createTrack('Deleted Staged Revision Track');
    await post(`/api/release-tracks/${track.id}/candidates`, {
      object_refs: [{ id: technique.stix.id, modified: technique.stix.modified }],
    });
    await post(`/api/release-tracks/${track.id}/candidates/promote`, {
      object_refs: [technique.stix.id],
    });
    await deleteTechniqueRevision(technique);

    const expectedMissing = {
      object_ref: technique.stix.id,
      object_modified: technique.stix.modified,
    };
    const preview = await api(
      'get',
      `/api/release-tracks/${track.id}/snapshots/latest/release/preview`,
      undefined,
      409,
    );
    expect(preview.body).toEqual({
      message: 'Release-track primary content is incomplete',
      missing_references: [expectedMissing],
    });

    const release = await api(
      'post',
      `/api/release-tracks/${track.id}/snapshots/latest/release`,
      {},
      409,
    );
    expect(release.body.missing_references).toEqual([expectedMissing]);
    expect(
      (await dynamicRepo.getAllSnapshots(track.id, { taggedOnly: true })).pagination.total,
    ).toBe(0);
  });

  it('rejects cloning and export when a stored primary member is missing', async function () {
    const technique = await createTechnique('Missing Stored Member');
    const track = await createTrack('Missing Stored Member Track');
    await releaseExactMembers(app, passportCookie, track.id, [technique]);
    await deleteTechniqueRevision(technique);
    const registryCount = await ReleaseTrackRegistry.countDocuments();

    const bundle = await api(
      'get',
      `/api/release-tracks/${track.id}/snapshots/latest?format=bundle`,
      undefined,
      409,
    );
    expect(bundle.body.missing_references).toEqual([
      {
        object_ref: technique.stix.id,
        object_modified: technique.stix.modified,
      },
    ]);

    const workbench = await api(
      'get',
      `/api/release-tracks/${track.id}/snapshots/latest`,
      undefined,
      409,
    );
    expect(workbench.body.missing_references).toEqual(bundle.body.missing_references);

    await api('post', `/api/release-tracks/${track.id}/clone`, {}, 409);
    expect(await ReleaseTrackRegistry.countDocuments()).toBe(registryCount);
  });

  it('propagates repository hydration failures instead of returning a partial export', async function () {
    const technique = await createTechnique('Failed Primary Hydration');
    const track = await createTrack('Failed Primary Hydration Track');
    await releaseExactMembers(app, passportCookie, track.id, [technique]);
    const hydrationStub = sinon
      .stub(techniquesRepo, 'findManyByIdAndModified')
      .rejects(new DatabaseError(new Error('injected hydration failure')));

    try {
      await api(
        'get',
        `/api/release-tracks/${track.id}/snapshots/latest?format=bundle`,
        undefined,
        500,
      );
    } finally {
      hydrationStub.restore();
    }
  });

  it('aborts virtual materialization when a component member is missing', async function () {
    const technique = await createTechnique('Missing Virtual Component Member');
    const component = await createTrack('Missing Virtual Component');
    await releaseExactMembers(app, passportCookie, component.id, [technique], {
      version: '1.0',
    });
    const virtual = await createTrack('Missing Virtual Primary', 'virtual', {
      composition: {
        component_tracks: [
          {
            track_id: component.id,
            resolution_strategy: 'latest_tagged',
            priority: 1,
          },
        ],
      },
    });
    await deleteTechniqueRevision(technique);

    const response = await api(
      'post',
      `/api/release-tracks/${virtual.id}/virtual/snapshots/create`,
      {},
      409,
    );
    expect(response.body.missing_references).toEqual([
      {
        object_ref: technique.stix.id,
        object_modified: technique.stix.modified,
      },
    ]);
    expect((await dynamicRepo.getAllSnapshots(virtual.id)).pagination.total).toBe(1);
  });

  it('does not create a track when any bundle primary object cannot be imported', async function () {
    const technique = await createTechnique('Existing Bundle Primary');
    const registryCount = await ReleaseTrackRegistry.countDocuments();
    const unsupported = {
      type: 'x-unsupported-primary',
      id: `x-unsupported-primary--${uuidv4()}`,
      modified: '2026-01-01T00:00:00.000Z',
    };

    const response = await api(
      'post',
      '/api/release-tracks/new-from-bundle',
      {
        type: 'bundle',
        id: `bundle--${uuidv4()}`,
        objects: [technique.stix, unsupported],
      },
      400,
    );
    expect(response.body).toMatchObject({
      message: 'Bundle contains an unsupported primary object type',
      details: {
        object_ref: unsupported.id,
        type: unsupported.type,
      },
    });
    expect(await ReleaseTrackRegistry.countDocuments()).toBe(registryCount);
  });
});
