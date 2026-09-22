'use strict';

const request = require('supertest');
const { expect } = require('expect');
const sinon = require('sinon');

const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const modelFactory = require('../../../models/release-tracks/model-factory');
const snapshotService = require('../../../services/release-tracks/snapshot-service');
const dynamicRepo = require('../../../repository/release-tracks/release-track-dynamic.repository');
const login = require('../../shared/login');
const { cloneForCreate } = require('../../shared/clone-for-create');
const { releaseExactMembers } = require('./release-track-test-helpers');

const staticMarkingDefinitionId = 'marking-definition--613f2e26-407d-48c7-9eca-b8e91df99dc9';

describe('Virtual release-track deterministic membership API', function () {
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

  async function get(path) {
    const response = await request(app)
      .get(path)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200);
    return response.body;
  }

  async function post(path, body, status = 201) {
    const response = await request(app)
      .post(path)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(status);
    return response.body;
  }

  function buildMitigation(name) {
    const timestamp = new Date().toISOString();
    return {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        created: timestamp,
        modified: timestamp,
        name,
        description: `${name} description`,
        spec_version: '2.1',
        type: 'course-of-action',
        labels: ['test'],
        x_mitre_version: '1.0',
        x_mitre_domains: ['enterprise-attack'],
        object_marking_refs: [staticMarkingDefinitionId],
      },
    };
  }

  async function createRevision(name, previous) {
    const body = previous ? cloneForCreate(previous) : buildMitigation(name);
    if (previous) {
      body.stix.name = name;
      body.stix.modified = new Date(
        new Date(previous.stix.modified).getTime() + 1000,
      ).toISOString();
    }
    return post('/api/mitigations', body);
  }

  async function createReleasedComponent(name, member, modified = member.stix.modified) {
    const component = await post('/api/release-tracks/new', {
      name,
      type: 'standard',
    });
    const contents = await releaseExactMembers(app, passportCookie, component.id, [
      { id: member.stix.id, modified },
    ]);
    return { component, contents };
  }

  async function createVirtual(name, componentTrackId, strategy = 'latest_tagged') {
    return post('/api/release-tracks/new', {
      name,
      type: 'virtual',
      composition: {
        component_tracks: [
          {
            track_id: componentTrackId,
            resolution_strategy: strategy,
            priority: 1,
          },
        ],
        deduplication: { strategy: 'prioritize_latest_object' },
      },
    });
  }

  function revisionKeys(snapshot) {
    return (snapshot.members || []).map(
      (member) => `${member.object_ref}::${new Date(member.object_modified).toISOString()}`,
    );
  }

  it('resolves latest shorthand before persistence and freezes the tagged component revision', async function () {
    const revisionA = await createRevision('Deterministic Member A');
    const { component, contents } = await createReleasedComponent(
      'Deterministic Exact Component',
      revisionA,
      'latest',
    );

    expect(contents.members).toEqual([
      {
        object_ref: revisionA.stix.id,
        object_modified: revisionA.stix.modified,
      },
    ]);

    // The standard track's default track_latest policy enrolls this new
    // revision into a draft candidate. It must not alter the already-tagged
    // component snapshot selected by virtual composition.
    const revisionB = await createRevision('Deterministic Member B', revisionA);
    const virtual = await createVirtual('Deterministic Exact Virtual', component.id);
    const materialized = await post(
      `/api/release-tracks/${virtual.id}/virtual/snapshots/create`,
      {},
    );

    expect(materialized.members).toEqual([
      {
        object_ref: revisionA.stix.id,
        object_modified: revisionA.stix.modified,
      },
    ]);
    expect(materialized.members[0].object_modified).not.toBe(revisionB.stix.modified);

    const firstLatest = await get(`/api/release-tracks/${virtual.id}/snapshots/latest`);
    const explicit = await get(
      `/api/release-tracks/${virtual.id}/snapshots/${encodeURIComponent(materialized.modified)}`,
    );

    await createRevision('Deterministic Member C', revisionB);
    const secondLatest = await get(`/api/release-tracks/${virtual.id}/snapshots/latest`);

    expect(revisionKeys(firstLatest)).toEqual(revisionKeys(materialized));
    expect(revisionKeys(explicit)).toEqual(revisionKeys(materialized));
    expect(revisionKeys(secondLatest)).toEqual(revisionKeys(materialized));
  });

  it('locks a legacy moving component member to an exact revision during materialization', async function () {
    const revisionA = await createRevision('Legacy Moving Member A');
    const { component } = await createReleasedComponent('Legacy Moving Component', revisionA);
    const revisionB = await createRevision('Legacy Moving Member B', revisionA);

    // Bypass Mongoose to simulate data created before exact Date-valued member
    // pins were enforced. The virtual materialization boundary must consume
    // the shorthand but never copy it into the virtual snapshot.
    const ComponentModel = modelFactory.getModel(component.id);
    await ComponentModel.collection.updateOne(
      { id: component.id, version: '1.0' },
      { $set: { 'members.0.object_modified': 'latest' } },
    );

    const virtual = await createVirtual('Legacy Moving Virtual', component.id);
    const materialized = await post(
      `/api/release-tracks/${virtual.id}/virtual/snapshots/create`,
      {},
    );

    expect(materialized.members).toEqual([
      {
        object_ref: revisionB.stix.id,
        object_modified: revisionB.stix.modified,
      },
    ]);
    expect(materialized.members[0].object_modified).not.toBe('latest');
  });

  it('materializes draft-only members and freezes null provenance through source advance and release', async function () {
    const member = await createRevision('Draft Member A');
    const staged = await createRevision('Draft Staged Only');
    const candidate = await createRevision('Draft Candidate Only');
    const component = await post('/api/release-tracks/new', {
      name: 'Draft Only Source',
      type: 'standard',
      config: { member_sync: { strategy: 'manual' } },
    });
    const source = await snapshotService.cloneSnapshot(component.id, component, {
      members: [{ object_ref: member.stix.id, object_modified: member.stix.modified }],
      staged: [
        {
          object_ref: staged.stix.id,
          object_modified: 'latest',
          object_status: 'work-in-progress',
          object_staged_at: new Date(),
          object_staged_by: 'system',
        },
      ],
      candidates: [
        {
          object_ref: candidate.stix.id,
          object_modified: 'latest',
          object_status: 'work-in-progress',
          object_added_at: new Date(),
          object_added_by: 'system',
        },
      ],
    });
    const { component: taggedComponent } = await createReleasedComponent(
      'Tagged Alongside Draft',
      member,
    );
    const virtual = await post('/api/release-tracks/new', {
      name: 'Mixed Draft and Tagged Virtual',
      type: 'virtual',
      composition: {
        component_tracks: [
          { track_id: component.id, priority: 0, resolution_strategy: 'latest_draft' },
          { track_id: taggedComponent.id, priority: 1, resolution_strategy: 'latest_tagged' },
        ],
      },
    });
    const materialized = await post(
      `/api/release-tracks/${virtual.id}/virtual/snapshots/create`,
      {},
    );
    expect(materialized.members).toEqual([
      { object_ref: member.stix.id, object_modified: member.stix.modified },
    ]);
    expect(materialized.composition_resolution.component_snapshots[0]).toMatchObject({
      track_id: component.id,
      resolved_snapshot_id: new Date(source.modified).toISOString(),
      resolved_version: null,
      strategy_used: 'latest_draft',
      total_objects_in_source: 1,
    });

    const newerMember = await createRevision('Draft Member B', member);
    const advanced = await snapshotService.cloneSnapshot(component.id, source, {
      members: [{ object_ref: newerMember.stix.id, object_modified: newerMember.stix.modified }],
    });
    const sourcePath = `/api/release-tracks/${component.id}/snapshots/${encodeURIComponent(
      new Date(source.modified).toISOString(),
    )}`;
    expect(revisionKeys(await get(sourcePath))).toEqual(revisionKeys(materialized));
    const deletion = await request(app)
      .delete(sourcePath)
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(409);
    expect(deletion.body.dependent_snapshots).toEqual([
      expect.objectContaining({ track_id: virtual.id, snapshot_modified: materialized.modified }),
    ]);

    const released = await post(
      `/api/release-tracks/${virtual.id}/snapshots/latest/release`,
      { version: '1.0' },
      200,
    );
    expect(released.modified).toBe(materialized.modified);
    expect(released.content_manifest_id).toBe(materialized.content_manifest_id);
    expect(revisionKeys(released)).toEqual(revisionKeys(materialized));
    expect(released.composition_resolution).toEqual(materialized.composition_resolution);
    expect(released.version_history.at(-1).component_versions).toEqual({
      [component.id]: null,
      [taggedComponent.id]: '1.0',
    });
    const bundle = await get(`/api/release-tracks/${virtual.id}/snapshots/latest?format=bundle`);
    expect(bundle.objects.filter((object) => object.type === 'course-of-action')).toEqual([
      expect.objectContaining({ id: member.stix.id, modified: member.stix.modified }),
    ]);
    await post(`/api/release-tracks/${component.id}/meta`, { description: 'Advance again' }, 200);
    expect(revisionKeys(await get(sourcePath))).toEqual(revisionKeys(materialized));
    expect(await dynamicRepo.getSnapshotByModified(component.id, advanced.modified)).toBeNull();

    const next = await post(`/api/release-tracks/${virtual.id}/virtual/snapshots/create`, {});
    expect(next.composition_resolution.component_snapshots[0].resolved_version).toBeNull();
    expect(next.members).toEqual([
      { object_ref: newerMember.stix.id, object_modified: newerMember.stix.modified },
    ]);
    expect(
      revisionKeys(
        await get(
          `/api/release-tracks/${virtual.id}/snapshots/${encodeURIComponent(released.modified)}`,
        ),
      ),
    ).toEqual(revisionKeys(materialized));
  });

  it('never falls back to a tagged release or retained historical draft when no active draft exists', async function () {
    const component = await post('/api/release-tracks/new', {
      name: 'Active Draft Selection',
      type: 'standard',
    });
    const virtual = await createVirtual('Active Draft Virtual', component.id, 'latest_draft');
    const first = await post(`/api/release-tracks/${virtual.id}/virtual/snapshots/create`, {});
    const newer = await post(
      `/api/release-tracks/${component.id}/meta`,
      { description: 'New rolling draft' },
      200,
    );
    const release = await post(
      `/api/release-tracks/${component.id}/snapshots/latest/release`,
      {},
      200,
    );
    expect(release.release_source_modified).toBe(newer.modified);
    expect(
      await dynamicRepo.getSnapshotByModified(component.id, component.modified),
    ).not.toBeNull();
    const failure = await post(
      `/api/release-tracks/${virtual.id}/virtual/snapshots/create`,
      {},
      400,
    );
    expect(failure.message).toContain('no active draft');
    expect((await get(`/api/release-tracks/${virtual.id}/snapshots/latest`)).modified).toBe(
      first.modified,
    );
    await request(app)
      .put(`/api/release-tracks/${virtual.id}/virtual/composition`)
      .send({
        component_tracks: [
          {
            track_id: component.id,
            priority: 0,
            resolution_strategy: 'specific_snapshot',
            snapshot: newer.modified,
          },
        ],
      })
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200);
    await post(`/api/release-tracks/${virtual.id}/virtual/snapshots/create`, {}, 400);

    const active = await post(
      `/api/release-tracks/${component.id}/meta`,
      { description: 'Next active draft' },
      200,
    );
    const nextVirtual = await createVirtual(
      'Next Active Draft Virtual',
      component.id,
      'latest_draft',
    );
    const next = await post(`/api/release-tracks/${nextVirtual.id}/virtual/snapshots/create`, {});
    expect(next.composition_resolution.component_snapshots[0].resolved_snapshot_id).toBe(
      active.modified,
    );
  });

  it('serializes draft pruning with virtual materialization until provenance is persisted', async function () {
    const component = await post('/api/release-tracks/new', {
      name: 'Draft Pruning Race',
      type: 'standard',
    });
    const virtual = await createVirtual('Draft Pruning Race Virtual', component.id, 'latest_draft');
    const save = dynamicRepo.saveSnapshot;
    const stub = sinon.stub(dynamicRepo, 'saveSnapshot').callsFake(async (trackId, snapshot) => {
      if (trackId === virtual.id) {
        await post(`/api/release-tracks/${component.id}/meta`, { description: 'Racing edit' }, 409);
      }
      return save.call(dynamicRepo, trackId, snapshot);
    });
    try {
      await post(`/api/release-tracks/${virtual.id}/virtual/snapshots/create`, {});
    } finally {
      stub.restore();
    }
    await post(`/api/release-tracks/${component.id}/meta`, { description: 'After persist' }, 200);
    expect(
      await dynamicRepo.getSnapshotByModified(component.id, component.modified),
    ).not.toBeNull();

    const resolve = dynamicRepo.findResolvedComponentSnapshotIds;
    const scan = sinon
      .stub(dynamicRepo, 'findResolvedComponentSnapshotIds')
      .callsFake(async (...args) => {
        if (args[0] === virtual.id) {
          await post(`/api/release-tracks/${virtual.id}/virtual/snapshots/create`, {}, 409);
        }
        return resolve.apply(dynamicRepo, args);
      });
    try {
      await post(`/api/release-tracks/${component.id}/meta`, { description: 'Pruning first' }, 200);
    } finally {
      scan.restore();
    }
    expect(
      await dynamicRepo.getSnapshotByModified(component.id, component.modified),
    ).not.toBeNull();
  });

  it('prunes a retained source after its last virtual dependent is deleted', async function () {
    const component = await post('/api/release-tracks/new', {
      name: 'Released Draft Retention',
      type: 'standard',
    });
    const virtual = await createVirtual('Temporary Draft Dependent', component.id, 'latest_draft');
    const materialized = await post(
      `/api/release-tracks/${virtual.id}/virtual/snapshots/create`,
      {},
    );
    await post(
      `/api/release-tracks/${component.id}/meta`,
      { description: 'Keep dependent source' },
      200,
    );
    expect(
      await dynamicRepo.getSnapshotByModified(component.id, component.modified),
    ).not.toBeNull();
    await request(app)
      .delete(
        `/api/release-tracks/${virtual.id}/snapshots/${encodeURIComponent(materialized.modified)}`,
      )
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(204);
    await post(
      `/api/release-tracks/${component.id}/meta`,
      { description: 'Prune unused source' },
      200,
    );
    expect(await dynamicRepo.getSnapshotByModified(component.id, component.modified)).toBeNull();
  });

  after(async function () {
    await database.closeConnection();
  });
});
