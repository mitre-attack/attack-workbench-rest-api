'use strict';

const request = require('supertest');
const { expect } = require('expect');
const sinon = require('sinon');

const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const Technique = require('../../../models/technique-model');
const ReleaseTrackReconciliation = require('../../../models/release-tracks/release-track-reconciliation-model');
const attackObjectsRepo = require('../../../repository/attack-objects-repository');
const dynamicRepo = require('../../../repository/release-tracks/release-track-dynamic.repository');
const reconciliationService = require('../../../services/release-tracks/reconciliation-service');
const { DatabaseError } = require('../../../exceptions');
const { releaseExactMembers } = require('./release-track-test-helpers');

const markingDefinitionId = 'marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168';

function buildTechnique(name) {
  const timestamp = new Date().toISOString();
  return {
    workspace: { workflow: { state: 'work-in-progress' } },
    stix: {
      created: timestamp,
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

describe('Release-track durable backref reconciliation', function () {
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

  afterEach(function () {
    sinon.restore();
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

  async function getTechnique(technique) {
    return (
      await api(
        'get',
        `/api/techniques/${technique.stix.id}/modified/${technique.stix.modified}`,
        undefined,
        200,
      )
    ).body;
  }

  it('returns failure, persists the failed attempt, and repairs a committed release', async function () {
    const technique = await post('/api/techniques', buildTechnique('Reconciliation Failure'), 201);
    const track = await post(
      '/api/release-tracks/new',
      { name: 'Reconciliation Failure Track', type: 'standard' },
      201,
    );
    await post(`/api/release-tracks/${track.id}/candidates`, {
      object_refs: [{ id: technique.stix.id, modified: technique.stix.modified }],
    });
    await post(`/api/release-tracks/${track.id}/candidates/promote`, {
      object_refs: [technique.stix.id],
    });

    sinon
      .stub(attackObjectsRepo, 'bulkWrite')
      .rejects(new DatabaseError(new Error('injected backref write failure')));

    const release = await api(
      'post',
      `/api/release-tracks/${track.id}/snapshots/latest/release`,
      { version: '1.0' },
      500,
    );
    expect(release.body).toMatchObject({
      message: 'Release-track membership protection could not be reconciled',
      track_id: track.id,
      reconciliation_id: expect.any(String),
    });

    const tagged = await dynamicRepo.getLatestTaggedSnapshot(track.id);
    expect(tagged.version).toBe('1.0');

    let record = await ReleaseTrackReconciliation.findOne({
      reconciliation_id: release.body.reconciliation_id,
    })
      .lean()
      .exec();
    expect(record).toMatchObject({
      track_id: track.id,
      status: 'failed',
      attempts: 1,
      last_error: {
        name: 'AggregateError',
        message: expect.stringContaining('required listener'),
      },
    });

    let stored = await getTechnique(technique);
    expect(stored.workspace.release_tracks).toEqual([
      expect.objectContaining({ id: track.id, tier: 'staged' }),
    ]);

    sinon.restore();
    const results = await reconciliationService.repairOutstanding({
      limit: 100,
      continueOnError: false,
    });
    expect(results).toContainEqual({
      reconciliation_id: release.body.reconciliation_id,
      track_id: track.id,
      status: 'completed',
    });

    // Only outstanding work is retained: a repaired reconciliation leaves no
    // record behind.
    record = await ReleaseTrackReconciliation.findOne({
      reconciliation_id: release.body.reconciliation_id,
    })
      .lean()
      .exec();
    expect(record).toBeNull();

    stored = await getTechnique(technique);
    expect(stored.workspace.release_tracks).toEqual([
      {
        id: track.id,
        type: 'standard',
        tier: 'members',
        status: 'reviewed',
      },
    ]);
  });

  it('repairs legacy drift with an idempotent full scan', async function () {
    const technique = await post('/api/techniques', buildTechnique('Full Scan Repair'), 201);
    const track = await post(
      '/api/release-tracks/new',
      { name: 'Full Scan Repair Track', type: 'standard' },
      201,
    );
    await releaseExactMembers(app, passportCookie, track.id, [technique]);

    await Technique.updateOne(
      {
        'stix.id': technique.stix.id,
        'stix.modified': new Date(technique.stix.modified),
      },
      { $pull: { 'workspace.release_tracks': { id: track.id } } },
    );
    expect((await getTechnique(technique)).workspace.release_tracks || []).toHaveLength(0);

    const first = await reconciliationService.reconcileAll({ continueOnError: false });
    expect(first).toContainEqual(
      expect.objectContaining({
        track_id: track.id,
        status: 'completed',
      }),
    );
    expect((await getTechnique(technique)).workspace.release_tracks).toEqual([
      expect.objectContaining({ id: track.id, tier: 'members' }),
    ]);

    const second = await reconciliationService.reconcileAll({ continueOnError: false });
    expect(second).toContainEqual(
      expect.objectContaining({
        track_id: track.id,
        status: 'completed',
      }),
    );
    expect((await getTechnique(technique)).workspace.release_tracks).toHaveLength(1);
  });
});
