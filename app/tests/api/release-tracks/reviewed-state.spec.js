'use strict';

const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { expect } = require('expect');
const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const dynamicRepo = require('../../../repository/release-tracks/release-track-dynamic.repository');
const snapshotService = require('../../../services/release-tracks/snapshot-service');

function campaign(complete = true) {
  return {
    workspace: { workflow: { state: 'work-in-progress' } },
    stix: {
      type: 'campaign',
      spec_version: '2.1',
      id: `campaign--${randomUUID()}`,
      name: 'Reviewed admission campaign',
      ...(complete ? { description: 'Campaign used to verify release admission.' } : {}),
      created: '2026-01-01T00:00:00.000Z',
      modified: '2026-01-02T00:00:00.000Z',
      created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
      revoked: false,
      external_references: [
        {
          source_name: 'mitre-attack',
          external_id: 'C0001',
          url: 'https://attack.mitre.org/campaigns/C0001',
        },
        { source_name: 'Admission', description: 'Campaign evidence' },
      ],
      object_marking_refs: ['marking-definition--613f2e26-407d-48c7-9eca-b8e91df99dc9'],
      x_mitre_attack_spec_version: '3.3.0',
      x_mitre_version: '1.0',
      x_mitre_domains: ['enterprise-attack'],
      x_mitre_modified_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
      aliases: ['Reviewed admission campaign'],
      first_seen: '2025-01-01T00:00:00.000Z',
      last_seen: '2025-02-01T00:00:00.000Z',
      x_mitre_first_seen_citation: '(Citation: Admission)',
      x_mitre_last_seen_citation: '(Citation: Admission)',
    },
  };
}

describe('Legacy reviewed state on release-track admission', function () {
  let app;
  let cookie;

  before(async function () {
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();
    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;
    app = await require('../../../index').initializeApp();
    const passportCookie = await login.loginAnonymous(app);
    cookie = `${passportCookie.name}=${passportCookie.value}`;
  });

  async function post(path, body, status = 200) {
    const response = await request(app).post(path).set('Cookie', cookie).send(body).expect(status);
    return response.body;
  }

  async function get(path) {
    return (await request(app).get(path).set('Cookie', cookie).expect(200)).body;
  }

  async function createTrack(objects) {
    const track = await post(
      '/api/release-tracks/new',
      { name: `Review ${randomUUID().replaceAll('-', '')}`, type: 'standard' },
      201,
    );
    await post(`/api/release-tracks/${track.id}/candidates`, {
      object_refs: objects.map((object) => ({
        id: object.stix.id,
        modified: object.stix.modified,
      })),
    });
    return track;
  }

  it('rejects an incomplete staged batch without reviewing its valid companion', async function () {
    const valid = await post('/api/campaigns', campaign(), 201);
    const invalid = await post('/api/campaigns', campaign(false), 201);
    const track = await createTrack([valid, invalid]);
    await post(
      `/api/release-tracks/${track.id}/candidates/promote`,
      {
        object_refs: [valid.stix.id, invalid.stix.id],
      },
      400,
    );
    const snapshot = await get(`/api/release-tracks/${track.id}/snapshots/latest`);
    expect(snapshot.staged).toEqual([]);
    expect(snapshot.candidates.map((entry) => entry.object_ref).sort()).toEqual(
      [valid.stix.id, invalid.stix.id].sort(),
    );
    for (const object of [valid, invalid]) {
      const stored = await get(`/api/campaigns/${object.stix.id}/modified/${object.stix.modified}`);
      expect(stored.workspace.workflow.state).toBe('work-in-progress');
    }
  });

  it('reviews a valid staged revision without changing its STIX or other workflow metadata', async function () {
    const object = await post('/api/campaigns', campaign(), 201);
    const track = await createTrack([object]);
    const before = await get(`/api/campaigns/${object.stix.id}/modified/${object.stix.modified}`);
    expect(before.workspace.workflow.state).toBe('work-in-progress');
    await post(`/api/release-tracks/${track.id}/candidates/promote`, {
      object_refs: [object.stix.id],
    });
    const after = await get(`/api/campaigns/${object.stix.id}/modified/${object.stix.modified}`);
    expect(after.stix).toEqual(before.stix);
    expect(after.workspace.workflow).toEqual({ ...before.workspace.workflow, state: 'reviewed' });
    const snapshot = await get(`/api/release-tracks/${track.id}/snapshots/latest`);
    expect(snapshot.staged.map((entry) => entry.object_ref)).toEqual([object.stix.id]);
  });

  it('blocks a legacy incomplete member before tagging the snapshot', async function () {
    const object = await post('/api/campaigns', campaign(false), 201);
    const track = await createTrack([object]);
    const source = await snapshotService.getLatestSnapshot(track.id);
    await dynamicRepo.updateSnapshot(track.id, source.modified, {
      $set: {
        candidates: [],
        members: [{ object_ref: object.stix.id, object_modified: object.stix.modified }],
      },
    });
    await post(`/api/release-tracks/${track.id}/snapshots/latest/release`, {}, 400);
    const snapshot = await get(`/api/release-tracks/${track.id}/snapshots/latest`);
    expect(snapshot.version).toBeNull();
    expect(
      (await get(`/api/campaigns/${object.stix.id}/modified/${object.stix.modified}`)).workspace
        .workflow.state,
    ).toBe('work-in-progress');
  });

  it('reviews a valid legacy member on release', async function () {
    const object = await post('/api/campaigns', campaign(), 201);
    const track = await createTrack([object]);
    const source = await snapshotService.getLatestSnapshot(track.id);
    await dynamicRepo.updateSnapshot(track.id, source.modified, {
      $set: {
        candidates: [],
        members: [{ object_ref: object.stix.id, object_modified: object.stix.modified }],
      },
    });
    const released = await post(`/api/release-tracks/${track.id}/snapshots/latest/release`, {});
    expect(released.version).not.toBeNull();
    const stored = await get(`/api/campaigns/${object.stix.id}/modified/${object.stix.modified}`);
    expect(stored.workspace.workflow.state).toBe('reviewed');
    expect(stored.stix).toEqual(object.stix);
  });

  it('rejects member materialization before storing a replacement draft', async function () {
    const object = await post('/api/campaigns', campaign(false), 201);
    const track = await createTrack([object]);
    const source = await snapshotService.getLatestSnapshot(track.id);
    await expect(
      snapshotService.cloneSnapshot(track.id, source, {
        candidates: [],
        members: [{ object_ref: object.stix.id, object_modified: object.stix.modified }],
      }),
    ).rejects.toMatchObject({ message: 'ADM validation failed' });
    const after = await snapshotService.getLatestSnapshot(track.id);
    expect(after.modified).toEqual(source.modified);
    expect(after.members).toEqual([]);
  });

  it('honors a warning bypass while admitting and reviewing the revision', async function () {
    const rule = await post(
      '/api/config/validation-bypasses',
      {
        fieldPath: ['description'],
        errorCode: 'invalid_type',
        stixType: 'campaign',
        warningMessage: 'Campaign description temporarily waived',
      },
      201,
    );
    try {
      const object = await post('/api/campaigns', campaign(false), 201);
      const track = await createTrack([object]);
      const snapshot = await post(`/api/release-tracks/${track.id}/candidates/promote`, {
        object_refs: [object.stix.id],
      });
      expect(snapshot.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ object_ref: object.stix.id, message: rule.warningMessage }),
        ]),
      );
      const stored = await get(`/api/campaigns/${object.stix.id}/modified/${object.stix.modified}`);
      expect(stored.workspace.workflow.state).toBe('reviewed');
      expect(stored.stix.description).toBeUndefined();
    } finally {
      await request(app)
        .delete(`/api/config/validation-bypasses/${rule._id}`)
        .set('Cookie', cookie)
        .expect(204);
    }
  });

  it('reviews relationship revisions through their owning collection', async function () {
    const source = await post('/api/campaigns', campaign(), 201);
    const target = await post(
      '/api/software',
      {
        workspace: { workflow: { state: 'work-in-progress' } },
        stix: { type: 'tool', spec_version: '2.1', name: 'Admission target' },
      },
      201,
    );
    const relationship = await post(
      '/api/relationships',
      {
        workspace: { workflow: { state: 'work-in-progress' } },
        stix: {
          type: 'relationship',
          spec_version: '2.1',
          relationship_type: 'uses',
          source_ref: source.stix.id,
          target_ref: target.stix.id,
          description: 'Campaign uses the tool.',
          created_by_ref: source.stix.created_by_ref,
          object_marking_refs: source.stix.object_marking_refs,
          x_mitre_attack_spec_version: '3.3.0',
          x_mitre_modified_by_ref: source.stix.x_mitre_modified_by_ref,
        },
      },
      201,
    );
    const track = await createTrack([relationship]);
    await post(`/api/release-tracks/${track.id}/candidates/promote`, {
      object_refs: [relationship.stix.id],
    });
    const stored = await get(
      `/api/relationships/${relationship.stix.id}/modified/${relationship.stix.modified}`,
    );
    expect(stored.workspace.workflow.state).toBe('reviewed');
    expect(stored.stix).toEqual(relationship.stix);
  });

  it('reviews only the selected revision when the object has a newer revision', async function () {
    const older = await post('/api/campaigns', campaign(), 201);
    const next = {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: { ...older.stix, modified: '2026-01-03T00:00:00.000Z' },
    };
    const newer = await post('/api/campaigns', next, 201);
    const track = await createTrack([older]);
    await post(`/api/release-tracks/${track.id}/candidates/promote`, {
      object_refs: [older.stix.id],
    });
    const selected = await get(`/api/campaigns/${older.stix.id}/modified/${older.stix.modified}`);
    const unselected = await get(`/api/campaigns/${newer.stix.id}/modified/${newer.stix.modified}`);
    expect(selected.workspace.workflow.state).toBe('reviewed');
    expect(unselected.workspace.workflow.state).toBe('work-in-progress');
    expect(unselected.stix).toEqual(newer.stix);
  });
});
