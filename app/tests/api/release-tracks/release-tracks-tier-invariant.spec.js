const request = require('supertest');
const { expect } = require('expect');

const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const dynamicRepo = require('../../../repository/release-tracks/release-track-dynamic.repository');
const snapshotService = require('../../../services/release-tracks/snapshot-service');
const { releaseExactMembers } = require('./release-track-test-helpers');

const staticMarkingDefinitionId = 'marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168';
const tiers = ['members', 'staged', 'candidates', 'quarantine'];

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
      object_marking_refs: [staticMarkingDefinitionId],
      kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'persistence' }],
      x_mitre_is_subtechnique: false,
      x_mitre_platforms: ['Windows'],
      x_mitre_version: '1.0',
      x_mitre_domains: ['enterprise-attack'],
    },
  };
}

function memberEntry(object) {
  return {
    object_ref: object.stix.id,
    object_modified: object.stix.modified,
  };
}

function candidateEntry(object, status = 'work-in-progress') {
  return {
    ...memberEntry(object),
    object_status: status,
    object_added_at: new Date(),
    object_added_by: 'legacy-state',
  };
}

function stagedEntry(object, status = 'reviewed') {
  return {
    ...memberEntry(object),
    object_status: status,
    object_staged_at: new Date(),
    object_staged_by: 'legacy-state',
  };
}

function occurrences(snapshot, object) {
  const modified = new Date(object.stix.modified).getTime();
  return tiers.flatMap((tier) =>
    (snapshot[tier] || [])
      .filter(
        (entry) =>
          entry.object_ref === object.stix.id &&
          new Date(entry.object_modified).getTime() === modified,
      )
      .map(() => tier),
  );
}

describe('Release-track cross-tier revision uniqueness', function () {
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

  async function post(path, body, expectedStatus = 200) {
    const response = await request(app)
      .post(path)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(expectedStatus);
    return response.body;
  }

  async function put(path, body) {
    const response = await request(app)
      .put(path)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200);
    return response.body;
  }

  async function createTechnique(name, previous) {
    return post('/api/techniques', buildTechnique(name, previous), 201);
  }

  async function createTrack(name, type = 'standard') {
    return post('/api/release-tracks/new', { name, type }, 201);
  }

  async function getLatest(trackId) {
    const response = await request(app)
      .get(`/api/release-tracks/${trackId}/snapshots/latest`)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200);
    return response.body;
  }

  async function setMembers(trackId, objects) {
    return releaseExactMembers(app, passportCookie, trackId, objects);
  }

  async function useManualMemberSync(trackId) {
    return put(`/api/release-tracks/${trackId}/config`, {
      member_sync: { strategy: 'manual' },
    });
  }

  async function injectLatestSnapshot(trackId, overrides) {
    const source = await snapshotService.getLatestSnapshot(trackId);
    return dynamicRepo.updateSnapshot(trackId, source.modified, { $set: overrides });
  }

  it('skips an exact member revision on candidate add but allows a newer revision', async function () {
    const revisionA = await createTechnique('Tier Invariant Add');
    const track = await createTrack('Tier Invariant Add Track');
    await useManualMemberSync(track.id);
    await setMembers(track.id, [revisionA]);
    const revisionB = await createTechnique('Tier Invariant Add v2', revisionA);
    const beforeExactAdd = await getLatest(track.id);

    await post(`/api/release-tracks/${track.id}/candidates`, {
      object_refs: [{ id: revisionA.stix.id, modified: revisionA.stix.modified }],
    });
    const afterExactAdd = await getLatest(track.id);
    expect(afterExactAdd.modified).toBe(beforeExactAdd.modified);
    expect(occurrences(afterExactAdd, revisionA)).toEqual(['members']);

    await injectLatestSnapshot(track.id, {
      candidates: [candidateEntry(revisionA)],
    });
    const legacySnapshot = await getLatest(track.id);
    await post(`/api/release-tracks/${track.id}/candidates`, {
      object_refs: [{ id: revisionA.stix.id, modified: revisionA.stix.modified }],
    });
    const repairedSnapshot = await getLatest(track.id);
    expect(repairedSnapshot.modified).not.toBe(legacySnapshot.modified);
    expect(occurrences(repairedSnapshot, revisionA)).toEqual(['members']);

    await post(`/api/release-tracks/${track.id}/candidates`, {
      object_refs: [{ id: revisionB.stix.id, modified: revisionB.stix.modified }],
    });
    const latest = await getLatest(track.id);
    expect(occurrences(latest, revisionA)).toEqual(['members']);
    expect(occurrences(latest, revisionB)).toEqual(['candidates']);
  });

  it('repairs a legacy member/candidate duplicate during manual promotion', async function () {
    const technique = await createTechnique('Tier Invariant Promote');
    const track = await createTrack('Tier Invariant Promote Track');
    await injectLatestSnapshot(track.id, {
      members: [memberEntry(technique)],
      candidates: [candidateEntry(technique)],
    });

    await post(`/api/release-tracks/${track.id}/candidates/promote`, {
      object_refs: [technique.stix.id],
    });

    expect(occurrences(await getLatest(track.id), technique)).toEqual(['members']);
  });

  it('treats an exact staged/candidate promotion as idempotent under reject policy', async function () {
    const technique = await createTechnique('Tier Invariant Exact Promote');
    const track = await createTrack('Tier Invariant Exact Promote Track');
    await put(`/api/release-tracks/${track.id}/config`, {
      promotion_conflicts: { candidates_to_staged: 'always_reject' },
    });
    await injectLatestSnapshot(track.id, {
      staged: [stagedEntry(technique)],
      candidates: [candidateEntry(technique)],
    });

    await post(`/api/release-tracks/${track.id}/candidates/promote`, {
      object_refs: [technique.stix.id],
    });

    expect(occurrences(await getLatest(track.id), technique)).toEqual(['staged']);
  });

  it('repairs a legacy member/staged duplicate during demotion', async function () {
    const technique = await createTechnique('Tier Invariant Demote');
    const track = await createTrack('Tier Invariant Demote Track');
    await injectLatestSnapshot(track.id, {
      members: [memberEntry(technique)],
      staged: [stagedEntry(technique)],
    });

    await post(`/api/release-tracks/${track.id}/staged/demote`, {
      object_refs: [{ id: technique.stix.id, modified: technique.stix.modified }],
    });

    expect(occurrences(await getLatest(track.id), technique)).toEqual(['members']);
  });

  it('repairs a legacy member/candidate duplicate during a bulk status transition', async function () {
    const technique = await createTechnique('Tier Invariant Review');
    const track = await createTrack('Tier Invariant Review Track');
    await injectLatestSnapshot(track.id, {
      members: [memberEntry(technique)],
      candidates: [candidateEntry(technique)],
    });

    await post(`/api/release-tracks/${track.id}/candidates/review`, {
      from: 'work-in-progress',
      to: 'reviewed',
      object_refs: [{ id: technique.stix.id, modified: technique.stix.modified }],
    });

    expect(occurrences(await getLatest(track.id), technique)).toEqual(['members']);
  });

  it('drops a candidate pin updated to an exact member revision', async function () {
    const revisionA = await createTechnique('Tier Invariant Pin');
    const track = await createTrack('Tier Invariant Pin Track');
    await useManualMemberSync(track.id);
    await setMembers(track.id, [revisionA]);
    const revisionB = await createTechnique('Tier Invariant Pin v2', revisionA);
    await post(`/api/release-tracks/${track.id}/candidates`, {
      object_refs: [{ id: revisionB.stix.id, modified: revisionB.stix.modified }],
    });

    await post(`/api/release-tracks/${track.id}/candidates/${revisionA.stix.id}/update-version`, {
      old_modified: revisionB.stix.modified,
      new_modified: revisionA.stix.modified,
    });

    const latest = await getLatest(track.id);
    expect(occurrences(latest, revisionA)).toEqual(['members']);
    expect(occurrences(latest, revisionB)).toEqual([]);
  });

  it('releases and repairs an exact staged/member duplicate instead of reporting a conflict', async function () {
    const technique = await createTechnique('Tier Invariant Release');
    const track = await createTrack('Tier Invariant Release Track');
    await injectLatestSnapshot(track.id, {
      members: [memberEntry(technique)],
      staged: [stagedEntry(technique)],
      candidates: [candidateEntry(technique)],
    });

    const tagged = await post(`/api/release-tracks/${track.id}/snapshots/latest/release`, {
      increment: 'minor',
    });

    expect(tagged.version).toBe('1.0');
    expect(occurrences(tagged, technique)).toEqual(['members']);
  });

  it('repairs a legacy virtual members/quarantine duplicate on the next mutation', async function () {
    const technique = await createTechnique('Tier Invariant Quarantine');
    const track = await createTrack('Tier Invariant Virtual Track', 'virtual');
    await injectLatestSnapshot(track.id, {
      members: [memberEntry(technique)],
      quarantine: [
        {
          ...memberEntry(technique),
          source_track_id: track.id,
          source_track_name: track.name,
          conflict_reason: 'legacy duplicate',
        },
      ],
    });

    await post(`/api/release-tracks/${track.id}/meta`, {
      description: 'Trigger invariant repair',
    });

    expect(occurrences(await getLatest(track.id), technique)).toEqual(['members']);
  });

  after(async function () {
    await database.closeConnection();
  });
});
