'use strict';

const request = require('supertest');
const { expect } = require('expect');

const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const { releaseExactMembers } = require('./release-track-test-helpers');

const staticMarkingDefinitionId = 'marking-definition--613f2e26-407d-48c7-9eca-b8e91df99dc9';

describe('Virtual release-track deduplication API', function () {
  let app;
  let passportCookie;
  let exactRevision;
  let conflictRevisionA;
  let conflictRevisionB;
  let componentA;
  let componentB;
  let componentC;

  before(async function () {
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();

    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;

    app = await require('../../../index').initializeApp();
    passportCookie = await login.loginAnonymous(app);

    exactRevision = await post('/api/mitigations', buildMitigation('Exact Shared Revision'));
    conflictRevisionA = await post('/api/mitigations', buildMitigation('Conflict Revision A'));
    conflictRevisionB = await post(
      '/api/mitigations',
      buildMitigation('Conflict Revision B', conflictRevisionA),
    );

    componentC = await createReleasedComponent('Deduplication Component C', [conflictRevisionB]);
    await advanceSnapshotClock();
    componentA = await createReleasedComponent('Deduplication Component A', [
      exactRevision,
      conflictRevisionA,
    ]);
    await advanceSnapshotClock();
    componentB = await createReleasedComponent('Deduplication Component B', [
      exactRevision,
      conflictRevisionA,
    ]);
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

  function buildMitigation(name, previous) {
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
        type: 'course-of-action',
        labels: ['test'],
        x_mitre_version: '1.0',
        x_mitre_domains: ['enterprise-attack'],
        object_marking_refs: [staticMarkingDefinitionId],
      },
    };
  }

  async function advanceSnapshotClock() {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  async function createReleasedComponent(name, members) {
    const track = await post('/api/release-tracks/new', { name, type: 'standard' });
    const release = await releaseExactMembers(app, passportCookie, track.id, members);
    return { ...track, release };
  }

  async function materialize(strategy) {
    const names = {
      prioritize_latest_object: 'Dedup Latest Object',
      prioritize_latest_snapshot: 'Dedup Latest Snapshot',
      prioritize_higher_priority: 'Dedup Higher Priority',
      quarantine: 'Dedup Quarantine',
    };
    const virtual = await post('/api/release-tracks/new', {
      name: names[strategy],
      type: 'virtual',
      composition: {
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
          {
            track_id: componentC.id,
            resolution_strategy: 'latest_tagged',
            priority: 3,
          },
        ],
        deduplication: { strategy },
      },
    });

    return post(`/api/release-tracks/${virtual.id}/virtual/snapshots/create`, {});
  }

  function memberModified(snapshot, objectRef) {
    return snapshot.members.find((member) => member.object_ref === objectRef)?.object_modified;
  }

  function contributions(snapshot) {
    return Object.fromEntries(
      snapshot.composition_resolution.component_snapshots.map((component) => [
        component.track_id,
        component.objects_contributed,
      ]),
    );
  }

  function expectReport(snapshot, expectedAfter) {
    const resolution = snapshot.composition_resolution;
    expect(resolution.deduplication).toMatchObject({
      total_objects_before: 5,
      total_objects_after: expectedAfter,
      duplicates_found: 2,
    });
    expect(resolution.deduplication.conflicts_resolved).toHaveLength(1);
    expect(resolution.deduplication.conflicts_resolved[0].object_ref).toBe(
      conflictRevisionA.stix.id,
    );
    expect(Object.values(contributions(snapshot)).reduce((total, count) => total + count, 0)).toBe(
      resolution.summary.total_objects,
    );
  }

  it('prioritizes the latest object revision and attributes each survivor once', async function () {
    const snapshot = await materialize('prioritize_latest_object');

    expect(snapshot.members).toHaveLength(2);
    expect(snapshot.quarantine).toEqual([]);
    expect(memberModified(snapshot, exactRevision.stix.id)).toBe(exactRevision.stix.modified);
    expect(memberModified(snapshot, conflictRevisionA.stix.id)).toBe(
      conflictRevisionB.stix.modified,
    );
    expect(contributions(snapshot)).toEqual({
      [componentA.id]: 1,
      [componentB.id]: 0,
      [componentC.id]: 1,
    });
    expectReport(snapshot, 2);
    expect(snapshot.composition_resolution.deduplication.conflicts_resolved[0]).toMatchObject({
      strategy: 'prioritize_latest_object',
      winner_source: componentC.id,
      candidates_count: 2,
    });
  });

  it('prioritizes the latest component snapshot with deterministic source ownership', async function () {
    const snapshot = await materialize('prioritize_latest_snapshot');

    expect(snapshot.members).toHaveLength(2);
    expect(snapshot.quarantine).toEqual([]);
    expect(memberModified(snapshot, exactRevision.stix.id)).toBe(exactRevision.stix.modified);
    expect(memberModified(snapshot, conflictRevisionA.stix.id)).toBe(
      conflictRevisionA.stix.modified,
    );
    expect(contributions(snapshot)).toEqual({
      [componentA.id]: 0,
      [componentB.id]: 2,
      [componentC.id]: 0,
    });
    expectReport(snapshot, 2);
    expect(snapshot.composition_resolution.deduplication.conflicts_resolved[0]).toMatchObject({
      strategy: 'prioritize_latest_snapshot',
      winner_source: componentB.id,
      candidates_count: 2,
    });
  });

  it('prioritizes the highest-priority component and attributes each survivor once', async function () {
    const snapshot = await materialize('prioritize_higher_priority');

    expect(snapshot.members).toHaveLength(2);
    expect(snapshot.quarantine).toEqual([]);
    expect(memberModified(snapshot, exactRevision.stix.id)).toBe(exactRevision.stix.modified);
    expect(memberModified(snapshot, conflictRevisionA.stix.id)).toBe(
      conflictRevisionA.stix.modified,
    );
    expect(contributions(snapshot)).toEqual({
      [componentA.id]: 2,
      [componentB.id]: 0,
      [componentC.id]: 0,
    });
    expectReport(snapshot, 2);
    expect(snapshot.composition_resolution.deduplication.conflicts_resolved[0]).toMatchObject({
      strategy: 'prioritize_higher_priority',
      winner_source: componentA.id,
      candidates_count: 2,
    });
  });

  it('quarantines only distinct revisions and retains an exact shared revision', async function () {
    const snapshot = await materialize('quarantine');

    expect(snapshot.members).toEqual([
      {
        object_ref: exactRevision.stix.id,
        object_modified: exactRevision.stix.modified,
      },
    ]);
    expect(snapshot.quarantine).toHaveLength(2);
    expect(snapshot.quarantine.map((entry) => entry.object_modified).sort()).toEqual(
      [conflictRevisionA.stix.modified, conflictRevisionB.stix.modified].sort(),
    );
    expect(snapshot.quarantine.map((entry) => entry.source_track_id).sort()).toEqual(
      [componentA.id, componentC.id].sort(),
    );
    expect(contributions(snapshot)).toEqual({
      [componentA.id]: 1,
      [componentB.id]: 0,
      [componentC.id]: 0,
    });
    expectReport(snapshot, 1);
    expect(snapshot.composition_resolution.summary).toEqual({
      total_objects: 1,
      quarantined_objects: 2,
    });
    expect(snapshot.composition_resolution.deduplication.conflicts_resolved[0]).toEqual({
      object_ref: conflictRevisionA.stix.id,
      strategy: 'quarantine',
      quarantined_count: 2,
    });
  });

  after(async function () {
    await database.closeConnection();
  });
});
