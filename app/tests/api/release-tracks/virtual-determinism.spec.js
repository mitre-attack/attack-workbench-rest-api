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

  it('previews staged content before a standard track has any release or members', async function () {
    const member = await createRevision('First Preview Staged Member');
    const component = await post('/api/release-tracks/new', {
      name: 'First Preview Source',
      type: 'standard',
      config: { member_sync: { strategy: 'manual' } },
    });
    await post(
      `/api/release-tracks/${component.id}/candidates`,
      { object_refs: [{ id: member.stix.id }] },
      200,
    );
    const source = await post(
      `/api/release-tracks/${component.id}/candidates/promote`,
      { object_refs: [member.stix.id] },
      200,
    );
    expect(source.members).toEqual([]);
    expect(source.staged[0].object_modified).toBe('latest');
    const virtual = await createVirtual('First Preview Virtual', component.id, 'latest_preview');
    const snapshotsBefore = await modelFactory.getModel(component.id).find().lean();
    const materialized = await post(
      `/api/release-tracks/${virtual.id}/virtual/snapshots/create`,
      {},
    );
    expect(materialized.members).toEqual([
      { object_ref: member.stix.id, object_modified: member.stix.modified },
    ]);
    expect(materialized.composition_resolution.component_snapshots[0]).toMatchObject({
      resolved_snapshot_id: source.modified,
      resolved_version: null,
      strategy_used: 'latest_preview',
      total_objects_in_source: 1,
    });
    expect(await modelFactory.getModel(component.id).find().lean()).toEqual(snapshotsBefore);
  });

  it('freezes prospective membership and null provenance without changing the source', async function () {
    const member = await createRevision('Preview Member A');
    const updatedMember = await createRevision('Preview Member B', member);
    const staged = await createRevision('Preview Staged Only');
    const candidate = await createRevision('Preview Candidate Only');
    const component = await post('/api/release-tracks/new', {
      name: 'Preview Source',
      type: 'standard',
      config: {
        member_sync: { strategy: 'manual' },
        promotion_conflicts: { staged_to_members: 'prefer_latest' },
      },
    });
    const published = await releaseExactMembers(app, passportCookie, component.id, [member]);
    const stagedEntry = (object) => ({
      object_ref: object.stix.id,
      object_modified: 'latest',
      object_status: 'work-in-progress',
      object_staged_at: new Date(),
      object_staged_by: 'system',
    });
    const source = await snapshotService.cloneSnapshot(component.id, published, {
      staged: [stagedEntry(updatedMember), stagedEntry(staged)],
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
      'Tagged Alongside Preview',
      member,
    );
    const virtual = await post('/api/release-tracks/new', {
      name: 'Mixed Preview and Tagged Virtual',
      type: 'virtual',
      composition: {
        component_tracks: [
          { track_id: component.id, priority: 0, resolution_strategy: 'latest_preview' },
          { track_id: taggedComponent.id, priority: 1, resolution_strategy: 'latest_tagged' },
        ],
      },
    });
    const snapshotsBefore = await modelFactory.getModel(component.id).find().lean();
    const materialized = await post(
      `/api/release-tracks/${virtual.id}/virtual/snapshots/create`,
      {},
    );
    const standardPreview = await get(
      `/api/release-tracks/${component.id}/snapshots/latest/release/preview?format=workbench`,
    );
    expect(revisionKeys(materialized).sort()).toEqual(revisionKeys(standardPreview).sort());
    expect(materialized.members).toEqual([
      { object_ref: updatedMember.stix.id, object_modified: updatedMember.stix.modified },
      { object_ref: staged.stix.id, object_modified: staged.stix.modified },
    ]);
    expect(materialized.composition_resolution.component_snapshots[0]).toMatchObject({
      track_id: component.id,
      resolved_snapshot_id: new Date(source.modified).toISOString(),
      resolved_version: null,
      strategy_used: 'latest_preview',
      total_objects_in_source: 2,
      objects_contributed: 2,
    });
    expect(await modelFactory.getModel(component.id).find().lean()).toEqual(snapshotsBefore);

    const newerMember = await createRevision('Preview Member C', updatedMember);
    const newerStaged = await createRevision('Preview Staged New Revision', staged);
    const advanced = await post(
      `/api/release-tracks/${component.id}/meta`,
      { description: 'Advance preview source' },
      200,
    );
    const sourcePath = `/api/release-tracks/${component.id}/snapshots/${encodeURIComponent(
      new Date(source.modified).toISOString(),
    )}`;
    expect(revisionKeys(await get(sourcePath))).toEqual(revisionKeys(source));
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
    expect(bundle.objects.filter((object) => object.type === 'course-of-action')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: updatedMember.stix.id,
          modified: updatedMember.stix.modified,
        }),
        expect.objectContaining({ id: staged.stix.id, modified: staged.stix.modified }),
      ]),
    );
    await post(`/api/release-tracks/${component.id}/meta`, { description: 'Advance again' }, 200);
    expect(revisionKeys(await get(sourcePath))).toEqual(revisionKeys(source));
    expect(await dynamicRepo.getSnapshotByModified(component.id, advanced.modified)).toBeNull();

    const next = await post(`/api/release-tracks/${virtual.id}/virtual/snapshots/create`, {});
    expect(next.composition_resolution.component_snapshots[0].resolved_version).toBeNull();
    expect(next.members).toEqual([
      { object_ref: newerMember.stix.id, object_modified: newerMember.stix.modified },
      { object_ref: newerStaged.stix.id, object_modified: newerStaged.stix.modified },
    ]);
    expect(
      revisionKeys(
        await get(
          `/api/release-tracks/${virtual.id}/snapshots/${encodeURIComponent(released.modified)}`,
        ),
      ),
    ).toEqual(revisionKeys(materialized));
  });

  it('applies source promotion policies before cross-component composition', async function () {
    const older = await createRevision('Preview Conflict Older');
    const newer = await createRevision('Preview Conflict Newer', older);
    const cases = [
      { policy: 'always_overwrite', incumbent: newer, incoming: older, expected: older },
      { policy: 'always_reject', incumbent: older, incoming: newer, expected: older },
      { policy: 'prefer_latest', incumbent: newer, incoming: older, expected: newer },
      { policy: 'prefer_latest', incumbent: older, incoming: newer, expected: newer },
    ];
    for (const [index, { policy, incumbent, incoming, expected }] of cases.entries()) {
      const component = await post('/api/release-tracks/new', {
        name: `Preview Policy ${index}`,
        type: 'standard',
        config: {
          member_sync: { strategy: 'manual' },
          promotion_conflicts: { staged_to_members: policy },
        },
      });
      await snapshotService.cloneSnapshot(component.id, component, {
        members: [{ object_ref: incumbent.stix.id, object_modified: incumbent.stix.modified }],
        staged: [
          {
            object_ref: incoming.stix.id,
            object_modified: incoming.stix.modified,
            object_status: 'work-in-progress',
            object_staged_at: new Date(),
            object_staged_by: 'system',
          },
        ],
      });
      const virtual = await createVirtual(
        `Preview Policy Virtual ${index}`,
        component.id,
        'latest_preview',
      );
      const materialized = await post(
        `/api/release-tracks/${virtual.id}/virtual/snapshots/create`,
        {},
      );
      expect(materialized.members).toEqual([
        { object_ref: expected.stix.id, object_modified: expected.stix.modified },
      ]);
      const standardPreview = await get(
        `/api/release-tracks/${component.id}/snapshots/latest/release/preview?format=workbench`,
      );
      const standardRelease = await post(
        `/api/release-tracks/${component.id}/snapshots/latest/release`,
        {},
        200,
      );
      expect(revisionKeys(materialized)).toEqual(revisionKeys(standardPreview));
      expect(revisionKeys(materialized)).toEqual(revisionKeys(standardRelease));
    }
  });

  it('aborts source conflicts even when component filters would hide every conflict', async function () {
    const older = await createRevision('Hidden Preview Conflict Older');
    const newer = await createRevision('Hidden Preview Conflict Newer', older);
    const component = await post('/api/release-tracks/new', {
      name: 'Preview Abort Source',
      type: 'standard',
      config: { promotion_conflicts: { staged_to_members: 'abort' } },
    });
    await snapshotService.cloneSnapshot(component.id, component, {
      members: [{ object_ref: older.stix.id, object_modified: older.stix.modified }],
      staged: [
        {
          object_ref: newer.stix.id,
          object_modified: newer.stix.modified,
          object_status: 'work-in-progress',
          object_staged_at: new Date(),
          object_staged_by: 'system',
        },
      ],
    });
    const virtual = await post('/api/release-tracks/new', {
      name: 'Filtered Preview Abort Virtual',
      type: 'virtual',
      composition: {
        component_tracks: [
          {
            track_id: component.id,
            priority: 0,
            resolution_strategy: 'latest_preview',
            filters: { object_types: ['attack-pattern'] },
          },
        ],
      },
    });
    const sourceBefore = await modelFactory.getModel(component.id).find().lean();
    const virtualBefore = await modelFactory.getModel(virtual.id).find().lean();
    const summary = await get(
      `/api/release-tracks/${component.id}/snapshots/latest/release/preview`,
    );
    const failure = await post(
      `/api/release-tracks/${virtual.id}/virtual/snapshots/create`,
      {},
      409,
    );
    expect(summary.releasable).toBe(false);
    expect(failure).toMatchObject({
      track_id: component.id,
      conflicts: summary.conflicts,
    });
    expect(failure.conflicts).toEqual([
      {
        object_ref: older.stix.id,
        incumbent_version: older.stix.modified,
        incoming_version: newer.stix.modified,
      },
    ]);
    expect(await modelFactory.getModel(component.id).find().lean()).toEqual(sourceBefore);
    expect(await modelFactory.getModel(virtual.id).find().lean()).toEqual(virtualBefore);
  });

  it('filters the exact planned revision rather than inherited members or newer database revisions', async function () {
    const inherited = await createRevision('Domain Preview Inherited');
    const update = cloneForCreate(inherited);
    update.stix.modified = new Date(
      new Date(inherited.stix.modified).getTime() + 1000,
    ).toISOString();
    update.stix.x_mitre_domains = ['mobile-attack'];
    const pinned = await post('/api/mitigations', update);
    const latest = cloneForCreate(pinned);
    latest.stix.modified = new Date(new Date(pinned.stix.modified).getTime() + 1000).toISOString();
    latest.stix.x_mitre_domains = ['enterprise-attack'];
    await post('/api/mitigations', latest);
    const component = await post('/api/release-tracks/new', {
      name: 'Domain Preview Source',
      type: 'standard',
      config: { promotion_conflicts: { staged_to_members: 'always_overwrite' } },
    });
    await snapshotService.cloneSnapshot(component.id, component, {
      members: [{ object_ref: inherited.stix.id, object_modified: inherited.stix.modified }],
      staged: [
        {
          object_ref: pinned.stix.id,
          object_modified: pinned.stix.modified,
          object_status: 'work-in-progress',
          object_staged_at: new Date(),
          object_staged_by: 'system',
        },
      ],
    });
    for (const [domain, expected] of [
      ['enterprise', []],
      ['mobile', [{ object_ref: pinned.stix.id, object_modified: pinned.stix.modified }]],
    ]) {
      const virtual = await post('/api/release-tracks/new', {
        name: `Domain Preview Virtual ${domain}`,
        type: 'virtual',
        composition: {
          component_tracks: [
            {
              track_id: component.id,
              priority: 0,
              resolution_strategy: 'latest_preview',
              filters: { domains: [domain] },
            },
          ],
        },
      });
      const materialized = await post(
        `/api/release-tracks/${virtual.id}/virtual/snapshots/create`,
        {},
      );
      expect(materialized.members).toEqual(expected);
      expect(materialized.composition_resolution.component_snapshots[0]).toMatchObject({
        total_objects_in_source: 1,
        objects_after_filter: expected.length,
      });
    }
  });

  it('preserves historical members-only draft provenance but requires replacing retired composition', async function () {
    const member = await createRevision('Historical Draft Member');
    const component = await post('/api/release-tracks/new', {
      name: 'Historical Draft Source',
      type: 'standard',
    });
    await snapshotService.cloneSnapshot(component.id, component, {
      members: [{ object_ref: member.stix.id, object_modified: member.stix.modified }],
    });
    const virtual = await createVirtual('Historical Draft Virtual', component.id, 'latest_preview');
    const materialized = await post(
      `/api/release-tracks/${virtual.id}/virtual/snapshots/create`,
      {},
    );
    // Simulate a snapshot persisted before latest_draft was retired. Its
    // members-only output must remain labeled honestly and releasable.
    await modelFactory.getModel(virtual.id).collection.updateOne(
      { modified: new Date(materialized.modified) },
      {
        $set: {
          'composition.component_tracks.0.resolution_strategy': 'latest_draft',
          'composition_resolution.component_snapshots.0.strategy_used': 'latest_draft',
        },
      },
    );
    const historical = await get(`/api/release-tracks/${virtual.id}/snapshots/latest`);
    expect(historical.composition.component_tracks[0].resolution_strategy).toBe('latest_draft');
    expect(historical.composition_resolution.component_snapshots[0]).toMatchObject({
      strategy_used: 'latest_draft',
      resolved_version: null,
    });
    const released = await post(
      `/api/release-tracks/${virtual.id}/snapshots/latest/release`,
      {},
      200,
    );
    expect(released.composition_resolution).toEqual(historical.composition_resolution);
    expect(released.version_history.at(-1).component_versions).toEqual({ [component.id]: null });
    expect(revisionKeys(released)).toEqual(revisionKeys(materialized));
    const failure = await post(
      `/api/release-tracks/${virtual.id}/virtual/snapshots/create`,
      {},
      400,
    );
    expect(failure.message).toContain(component.id);
    expect((await get(`/api/release-tracks/${virtual.id}/snapshots/latest`)).modified).toBe(
      released.modified,
    );
    await request(app)
      .put(`/api/release-tracks/${virtual.id}/virtual/composition`)
      .send({
        component_tracks: [
          { track_id: component.id, priority: 0, resolution_strategy: 'latest_preview' },
        ],
      })
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200);
    const next = await post(`/api/release-tracks/${virtual.id}/virtual/snapshots/create`, {});
    expect(next.composition_resolution.component_snapshots[0].strategy_used).toBe('latest_preview');
    const retained = await get(
      `/api/release-tracks/${virtual.id}/snapshots/${encodeURIComponent(released.modified)}`,
    );
    expect(retained.composition_resolution).toEqual(historical.composition_resolution);
  });

  it('uses the newest tagged snapshot for preview while explicit draft selection remains invalid', async function () {
    const member = await createRevision('Newest Tagged Preview Member');
    const staged = await createRevision('Unpublished Legacy Tagged Content');
    const { component, contents: release } = await createReleasedComponent(
      'Newest Tagged Preview Source',
      member,
    );
    // Older tagged data may contain workflow entries. Published membership
    // remains authoritative even when latest_preview selects that snapshot.
    await modelFactory.getModel(component.id).collection.updateOne(
      { modified: new Date(release.modified) },
      {
        $set: {
          staged: [
            {
              object_ref: staged.stix.id,
              object_modified: 'latest',
              object_status: 'work-in-progress',
              object_staged_at: new Date(),
              object_staged_by: 'system',
            },
          ],
        },
      },
    );
    const virtual = await createVirtual(
      'Newest Tagged Preview Virtual',
      component.id,
      'latest_preview',
    );
    const snapshotsBefore = await modelFactory.getModel(component.id).find().lean();
    const materialized = await post(
      `/api/release-tracks/${virtual.id}/virtual/snapshots/create`,
      {},
    );
    expect(revisionKeys(materialized)).toEqual(revisionKeys(release));
    expect(materialized.composition_resolution.component_snapshots[0]).toMatchObject({
      resolved_snapshot_id: release.modified,
      resolved_version: release.version,
      strategy_used: 'latest_preview',
    });
    expect(await modelFactory.getModel(component.id).find().lean()).toEqual(snapshotsBefore);
    const taggedVirtual = await post(
      `/api/release-tracks/${virtual.id}/snapshots/latest/release`,
      {},
      200,
    );
    expect(taggedVirtual.version_history.at(-1).component_versions).toEqual({
      [component.id]: release.version,
    });
    await request(app)
      .put(`/api/release-tracks/${virtual.id}/virtual/composition`)
      .send({
        component_tracks: [
          {
            track_id: component.id,
            priority: 0,
            resolution_strategy: 'specific_snapshot',
            snapshot: release.release_source_modified,
          },
        ],
      })
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200);
    await post(`/api/release-tracks/${virtual.id}/virtual/snapshots/create`, {}, 400);
  });

  it('serializes draft pruning with virtual materialization until provenance is persisted', async function () {
    const component = await post('/api/release-tracks/new', {
      name: 'Draft Pruning Race',
      type: 'standard',
    });
    const virtual = await createVirtual(
      'Draft Pruning Race Virtual',
      component.id,
      'latest_preview',
    );
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
    const virtual = await createVirtual(
      'Temporary Draft Dependent',
      component.id,
      'latest_preview',
    );
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
