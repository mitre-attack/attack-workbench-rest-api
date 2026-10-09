const request = require('supertest');
const { expect } = require('expect');

const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const { releaseExactMembers } = require('./release-track-test-helpers');

const logger = require('../../../lib/logger');
logger.level = 'debug';

const staticMarkingDefinitionId = 'marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168';

function buildTechnique(name) {
  const timestamp = new Date().toISOString();
  return {
    workspace: {
      workflow: {
        state: 'work-in-progress',
      },
    },
    stix: {
      created: timestamp,
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

describe('Release Track Backrefs (workspace.release_tracks) API', function () {
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

  async function postObject(path, body, expectedStatus = 201) {
    const res = await request(app)
      .post(path)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(expectedStatus);
    return res.body;
  }

  async function getObjectVersion(path) {
    const res = await request(app)
      .get(path)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200);
    return res.body;
  }

  async function getTechniqueVersion(technique) {
    return getObjectVersion(
      `/api/techniques/${technique.stix.id}/modified/${technique.stix.modified}`,
    );
  }

  async function createTrack(name) {
    const res = await postObject('/api/release-tracks/new', { name, type: 'standard' });
    return res.id;
  }

  async function addCandidates(trackId, objects) {
    return postObject(
      `/api/release-tracks/${trackId}/candidates`,
      {
        object_refs: objects.map((o) => ({ id: o.stix.id, modified: o.stix.modified })),
      },
      200,
    );
  }

  async function releaseLatest(trackId) {
    return postObject(
      `/api/release-tracks/${trackId}/snapshots/latest/release`,
      {
        increment: 'minor',
      },
      200,
    );
  }

  function trackEntries(object) {
    return object.workspace.release_tracks || [];
  }

  function entryForTrack(object, trackId) {
    return trackEntries(object).find((e) => e.id === trackId);
  }

  describe('candidate lifecycle', function () {
    let trackId;
    let technique;

    before(async function () {
      technique = await postObject('/api/techniques', buildTechnique('Backref Lifecycle'));
      trackId = await createTrack('Backref Lifecycle Track');
    });

    it('adding a candidate sets a candidate backref on the pinned revision', async function () {
      await addCandidates(trackId, [technique]);

      const retrieved = await getTechniqueVersion(technique);
      expect(entryForTrack(retrieved, trackId)).toEqual({
        id: trackId,
        type: 'standard',
        tier: 'candidates',
        status: 'work-in-progress',
      });
    });

    it('reviewing candidates updates the backref status', async function () {
      await postObject(
        `/api/release-tracks/${trackId}/candidates/review`,
        { from: 'work-in-progress', to: 'awaiting-review' },
        200,
      );

      const retrieved = await getTechniqueVersion(technique);
      expect(entryForTrack(retrieved, trackId)).toEqual({
        id: trackId,
        type: 'standard',
        tier: 'candidates',
        status: 'awaiting-review',
      });
    });

    it('promoting candidates flips the backref tier to staged', async function () {
      await postObject(
        `/api/release-tracks/${trackId}/candidates/promote`,
        { object_refs: [technique.stix.id] },
        200,
      );

      const retrieved = await getTechniqueVersion(technique);
      expect(entryForTrack(retrieved, trackId)).toEqual({
        id: trackId,
        type: 'standard',
        tier: 'staged',
        status: 'awaiting-review',
      });
    });

    it('demoting staged entries returns the backref tier to candidates', async function () {
      await postObject(
        `/api/release-tracks/${trackId}/staged/demote`,
        { object_refs: [{ id: technique.stix.id, modified: technique.stix.modified }] },
        200,
      );

      const retrieved = await getTechniqueVersion(technique);
      expect(entryForTrack(retrieved, trackId)).toEqual({
        id: trackId,
        type: 'standard',
        tier: 'candidates',
        status: 'awaiting-review',
      });
    });

    it('releasing the track promotes staged backrefs to member/reviewed', async function () {
      await postObject(
        `/api/release-tracks/${trackId}/candidates/promote`,
        { object_refs: [technique.stix.id] },
        200,
      );
      await releaseLatest(trackId);

      const retrieved = await getTechniqueVersion(technique);
      expect(entryForTrack(retrieved, trackId)).toEqual({
        id: trackId,
        type: 'standard',
        tier: 'members',
        status: 'reviewed',
      });
    });

    it('deleting the track removes its backrefs', async function () {
      await request(app)
        .delete(`/api/release-tracks/${trackId}`)
        .query({ confirm_track_id: trackId })
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(204);

      const retrieved = await getTechniqueVersion(technique);
      expect(entryForTrack(retrieved, trackId)).toBeUndefined();
    });
  });

  describe('track type on backrefs', function () {
    it('marks entries from virtual tracks with type virtual', async function () {
      // Build a standard component track with one tagged member
      const technique = await postObject('/api/techniques', buildTechnique('Backref Virtual'));
      const componentTrackId = await createTrack('Backref Virtual Component Track');
      await addCandidates(componentTrackId, [technique]);
      await postObject(
        `/api/release-tracks/${componentTrackId}/candidates/promote`,
        { object_refs: [technique.stix.id] },
        200,
      );
      await releaseLatest(componentTrackId);

      // Compose a virtual track over it and create a snapshot
      const virtual = await postObject('/api/release-tracks/new', {
        name: 'Backref Virtual Track',
        type: 'virtual',
      });
      await request(app)
        .put(`/api/release-tracks/${virtual.id}/virtual/composition`)
        .send({
          component_tracks: [
            { track_id: componentTrackId, resolution_strategy: 'latest_tagged', priority: 0 },
          ],
        })
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(200);
      await postObject(`/api/release-tracks/${virtual.id}/virtual/snapshots/create`, {}, 201);

      // The object now carries one entry per referencing track, with types
      const retrieved = await getTechniqueVersion(technique);
      expect(entryForTrack(retrieved, componentTrackId)).toMatchObject({
        type: 'standard',
        tier: 'members',
      });
      expect(entryForTrack(retrieved, virtual.id)).toMatchObject({
        type: 'virtual',
        tier: 'members',
      });
    });
  });

  describe('candidate removal and version pins', function () {
    it('removing a candidate removes the backref', async function () {
      const technique = await postObject('/api/techniques', buildTechnique('Backref Removal'));
      const trackId = await createTrack('Backref Removal Track');
      await addCandidates(trackId, [technique]);

      await request(app)
        .delete(`/api/release-tracks/${trackId}/candidates/${technique.stix.id}`)
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(204);

      const retrieved = await getTechniqueVersion(technique);
      expect(entryForTrack(retrieved, trackId)).toBeUndefined();
    });

    it('updating a candidate version pin moves the backref to the new revision', async function () {
      const revisionA = await postObject('/api/techniques', buildTechnique('Backref Pin Move'));

      // Create a second revision of the same object
      const revisionBData = buildTechnique('Backref Pin Move v2');
      revisionBData.stix.id = revisionA.stix.id;
      revisionBData.stix.created = revisionA.stix.created;
      revisionBData.stix.modified = new Date(
        new Date(revisionA.stix.modified).getTime() + 1000,
      ).toISOString();
      const revisionB = await postObject('/api/techniques', revisionBData);

      const trackId = await createTrack('Backref Pin Move Track');
      await addCandidates(trackId, [revisionA]);

      await postObject(
        `/api/release-tracks/${trackId}/candidates/${revisionA.stix.id}/update-version`,
        { old_modified: revisionA.stix.modified, new_modified: revisionB.stix.modified },
        200,
      );

      const retrievedA = await getTechniqueVersion(revisionA);
      const retrievedB = await getTechniqueVersion(revisionB);
      expect(entryForTrack(retrievedA, trackId)).toBeUndefined();
      expect(entryForTrack(retrievedB, trackId)).toEqual({
        id: trackId,
        type: 'standard',
        tier: 'candidates',
        status: 'work-in-progress',
      });
    });
  });

  describe('members and snapshots', function () {
    it('deleting the latest draft reverts its candidate backrefs', async function () {
      const technique = await postObject('/api/techniques', buildTechnique('Backref Contents'));
      const trackId = await createTrack('Backref Contents Track');
      await postObject(
        `/api/release-tracks/${trackId}/snapshots/latest/release`,
        { version: '1.0' },
        200,
      );

      const candidateSnapshot = await addCandidates(trackId, [technique]);

      let retrieved = await getTechniqueVersion(technique);
      expect(entryForTrack(retrieved, trackId)).toEqual({
        id: trackId,
        type: 'standard',
        tier: 'candidates',
        status: 'work-in-progress',
      });

      // Deleting the latest rolling draft reverts contents to the preceding
      // empty tagged snapshot — the backref disappears.
      await request(app)
        .delete(`/api/release-tracks/${trackId}/snapshots/${candidateSnapshot.modified}`)
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(204);

      retrieved = await getTechniqueVersion(technique);
      expect(entryForTrack(retrieved, trackId)).toBeUndefined();
    });

    it('an object referenced by two tracks carries one backref per track', async function () {
      const technique = await postObject('/api/techniques', buildTechnique('Backref Two Tracks'));
      const trackA = await createTrack('Backref Two Tracks A');
      const trackB = await createTrack('Backref Two Tracks B');

      await addCandidates(trackA, [technique]);
      await addCandidates(trackB, [technique]);

      const retrieved = await getTechniqueVersion(technique);
      expect(entryForTrack(retrieved, trackA)).toMatchObject({ tier: 'candidates' });
      expect(entryForTrack(retrieved, trackB)).toMatchObject({ tier: 'candidates' });
      expect(trackEntries(retrieved)).toHaveLength(2);
    });

    it('cloning a track adds backrefs for the new track', async function () {
      const technique = await postObject('/api/techniques', buildTechnique('Backref Clone'));
      const trackId = await createTrack('Backref Clone Track');
      await addCandidates(trackId, [technique]);

      const cloned = await postObject(
        `/api/release-tracks/${trackId}/clone`,
        { name: 'Backref Clone Track Copy' },
        201,
      );

      const retrieved = await getTechniqueVersion(technique);
      expect(entryForTrack(retrieved, trackId)).toMatchObject({ tier: 'candidates' });
      expect(entryForTrack(retrieved, cloned.id)).toMatchObject({ tier: 'candidates' });
    });
  });

  describe('member sync', function () {
    it('a new revision of a member object gets a candidate backref while the member revision keeps its own', async function () {
      const revisionA = await postObject('/api/techniques', buildTechnique('Backref Member Sync'));
      const trackId = await createTrack('Backref Member Sync Track');

      await releaseExactMembers(app, passportCookie, trackId, [revisionA]);

      // Creating a new revision triggers member sync (default strategy:
      // track_latest) which auto-enrolls the new revision as a candidate
      const revisionBData = buildTechnique('Backref Member Sync v2');
      revisionBData.stix.id = revisionA.stix.id;
      revisionBData.stix.created = revisionA.stix.created;
      revisionBData.stix.modified = new Date(
        new Date(revisionA.stix.modified).getTime() + 1000,
      ).toISOString();
      const revisionB = await postObject('/api/techniques', revisionBData);

      const retrievedA = await getTechniqueVersion(revisionA);
      const retrievedB = await getTechniqueVersion(revisionB);
      expect(entryForTrack(retrievedA, trackId)).toEqual({
        id: trackId,
        type: 'standard',
        tier: 'members',
        status: 'reviewed',
      });
      expect(entryForTrack(retrievedB, trackId)).toEqual({
        id: trackId,
        type: 'standard',
        tier: 'candidates',
        status: 'work-in-progress',
      });
    });

    it('a new revision of a candidate object moves the pin and backref to the new revision', async function () {
      const revisionA = await postObject(
        '/api/techniques',
        buildTechnique('Backref Candidate Sync'),
      );
      const trackId = await createTrack('Backref Candidate Sync Track');
      await addCandidates(trackId, [revisionA]);

      const revisionBData = buildTechnique('Backref Candidate Sync v2');
      revisionBData.stix.id = revisionA.stix.id;
      revisionBData.stix.created = revisionA.stix.created;
      revisionBData.stix.modified = new Date(
        new Date(revisionA.stix.modified).getTime() + 1000,
      ).toISOString();
      const revisionB = await postObject('/api/techniques', revisionBData);

      // The POST response itself reflects the moved backref — the events
      // that re-pin the track are awaited before the response is composed
      expect(entryForTrack(revisionB, trackId)).toEqual({
        id: trackId,
        type: 'standard',
        tier: 'candidates',
        status: 'work-in-progress',
      });

      const retrievedA = await getTechniqueVersion(revisionA);
      const retrievedB = await getTechniqueVersion(revisionB);
      expect(entryForTrack(retrievedA, trackId)).toBeUndefined();
      expect(entryForTrack(retrievedB, trackId)).toEqual({
        id: trackId,
        type: 'standard',
        tier: 'candidates',
        status: 'work-in-progress',
      });
    });

    it('a new revision of a staged object returns the pin to candidates (default supplant)', async function () {
      const revisionA = await postObject('/api/techniques', buildTechnique('Backref Staged Sync'));
      const trackId = await createTrack('Backref Staged Sync Track');
      await addCandidates(trackId, [revisionA]);
      await postObject(
        `/api/release-tracks/${trackId}/candidates/promote`,
        { object_refs: [revisionA.stix.id] },
        200,
      );

      const revisionBData = buildTechnique('Backref Staged Sync v2');
      revisionBData.stix.id = revisionA.stix.id;
      revisionBData.stix.created = revisionA.stix.created;
      revisionBData.stix.modified = new Date(
        new Date(revisionA.stix.modified).getTime() + 1000,
      ).toISOString();
      const revisionB = await postObject('/api/techniques', revisionBData);

      const retrievedA = await getTechniqueVersion(revisionA);
      const retrievedB = await getTechniqueVersion(revisionB);
      expect(entryForTrack(retrievedA, trackId)).toBeUndefined();
      expect(entryForTrack(retrievedB, trackId)).toEqual({
        id: trackId,
        type: 'standard',
        tier: 'candidates',
        status: 'work-in-progress',
      });
    });

    it('moves a dynamic candidate backref even when supplant ignores workflow changes', async function () {
      const revisionA = await postObject(
        '/api/techniques',
        buildTechnique('Backref Dynamic Ignore'),
      );
      const trackId = await createTrack('Backref Dynamic Ignore Track');
      await releaseExactMembers(app, passportCookie, trackId, [revisionA]);
      await request(app)
        .put(`/api/release-tracks/${trackId}/config`)
        .send({
          member_sync: {
            strategy: 'track_latest',
            supplant: { behavior: 'ignore', status_policy: 'reset' },
          },
        })
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(200);

      const revisionBData = buildTechnique('Backref Dynamic Ignore v2');
      revisionBData.stix.id = revisionA.stix.id;
      revisionBData.stix.created = revisionA.stix.created;
      revisionBData.stix.modified = new Date(
        new Date(revisionA.stix.modified).getTime() + 1000,
      ).toISOString();
      const revisionB = await postObject('/api/techniques', revisionBData);

      const revisionCData = buildTechnique('Backref Dynamic Ignore v3');
      revisionCData.stix.id = revisionA.stix.id;
      revisionCData.stix.created = revisionA.stix.created;
      revisionCData.stix.modified = new Date(
        new Date(revisionB.stix.modified).getTime() + 1000,
      ).toISOString();
      const revisionC = await postObject('/api/techniques', revisionCData);

      expect(entryForTrack(await getTechniqueVersion(revisionB), trackId)).toBeUndefined();
      expect(entryForTrack(await getTechniqueVersion(revisionC), trackId)).toEqual({
        id: trackId,
        type: 'standard',
        tier: 'candidates',
        status: 'work-in-progress',
      });

      const snapshot = await getObjectVersion(`/api/release-tracks/${trackId}/snapshots/latest`);
      expect(snapshot.candidates).toHaveLength(1);
      expect(snapshot.candidates[0].object_modified).toBe('latest');
    });

    it('manual strategy leaves candidate pins on the original revision', async function () {
      const revisionA = await postObject('/api/techniques', buildTechnique('Backref Manual Sync'));
      const trackId = await createTrack('Backref Manual Sync Track');
      await request(app)
        .put(`/api/release-tracks/${trackId}/config`)
        .send({ member_sync: { strategy: 'manual' } })
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(200);
      await addCandidates(trackId, [revisionA]);

      const revisionBData = buildTechnique('Backref Manual Sync v2');
      revisionBData.stix.id = revisionA.stix.id;
      revisionBData.stix.created = revisionA.stix.created;
      revisionBData.stix.modified = new Date(
        new Date(revisionA.stix.modified).getTime() + 1000,
      ).toISOString();
      const revisionB = await postObject('/api/techniques', revisionBData);

      const retrievedA = await getTechniqueVersion(revisionA);
      const retrievedB = await getTechniqueVersion(revisionB);
      expect(entryForTrack(retrievedA, trackId)).toEqual({
        id: trackId,
        type: 'standard',
        tier: 'candidates',
        status: 'work-in-progress',
      });
      expect(entryForTrack(retrievedB, trackId)).toBeUndefined();
    });
  });

  describe('relationships', function () {
    it('relationship documents get backrefs in their own collection', async function () {
      const technique = await postObject('/api/techniques', buildTechnique('Backref Rel Target'));
      const group = await postObject('/api/groups', {
        workspace: { workflow: { state: 'work-in-progress' } },
        stix: {
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          name: 'Backref Rel Group',
          spec_version: '2.1',
          type: 'intrusion-set',
          description: 'Group used to verify relationship backrefs.',
          object_marking_refs: [staticMarkingDefinitionId],
        },
      });
      const relationship = await postObject('/api/relationships', {
        workspace: { workflow: { state: 'work-in-progress' } },
        stix: {
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          spec_version: '2.1',
          type: 'relationship',
          relationship_type: 'uses',
          source_ref: group.stix.id,
          target_ref: technique.stix.id,
          object_marking_refs: [staticMarkingDefinitionId],
        },
      });

      const trackId = await createTrack('Backref Relationship Track');
      await addCandidates(trackId, [relationship]);

      const retrieved = await getObjectVersion(
        `/api/relationships/${relationship.stix.id}/modified/${relationship.stix.modified}`,
      );
      expect(entryForTrack(retrieved, trackId)).toEqual({
        id: trackId,
        type: 'standard',
        tier: 'candidates',
        status: 'work-in-progress',
      });
    });
  });

  describe('manual re-adds and the into_candidates policy', function () {
    async function setTrackConfig(trackId, config) {
      await request(app)
        .put(`/api/release-tracks/${trackId}/config`)
        .send(config)
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(200);
    }

    async function listCandidates(trackId) {
      const res = await getObjectVersion(`/api/release-tracks/${trackId}/candidates`);
      return res.candidates;
    }

    function buildNextRevision(previous, name) {
      const data = buildTechnique(name);
      data.stix.id = previous.stix.id;
      data.stix.created = previous.stix.created;
      data.stix.modified = new Date(
        new Date(previous.stix.modified).getTime() + 1000,
      ).toISOString();
      return data;
    }

    it('keeps an omitted candidate selector dynamic as newer revisions are created', async function () {
      const revisionA = await postObject('/api/techniques', buildTechnique('Backref Readd'));
      const trackId = await createTrack('Backref Readd Track');
      // manual strategy isolates the add-candidates path from revision sync
      await setTrackConfig(trackId, { member_sync: { strategy: 'manual' } });
      await postObject(
        `/api/release-tracks/${trackId}/candidates`,
        { object_refs: [{ id: revisionA.stix.id }] },
        200,
      );

      const revisionB = await postObject(
        '/api/techniques',
        buildNextRevision(revisionA, 'Backref Readd v2'),
      );

      // Re-adding the same dynamic selector is idempotent.
      await postObject(
        `/api/release-tracks/${trackId}/candidates`,
        { object_refs: [{ id: revisionA.stix.id }] },
        200,
      );

      const candidates = await listCandidates(trackId);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].object_modified).toBe('latest');

      expect(entryForTrack(await getTechniqueVersion(revisionA), trackId)).toBeUndefined();
      expect(entryForTrack(await getTechniqueVersion(revisionB), trackId)).toEqual({
        id: trackId,
        type: 'standard',
        tier: 'candidates',
        status: 'work-in-progress',
      });

      // Another dynamic re-add remains idempotent.
      await postObject(
        `/api/release-tracks/${trackId}/candidates`,
        { object_refs: [{ id: revisionA.stix.id }] },
        200,
      );
      expect(await listCandidates(trackId)).toHaveLength(1);
    });

    it('into_candidates=abort rejects a conflicting re-add with 409', async function () {
      const revisionA = await postObject('/api/techniques', buildTechnique('Backref Abort'));
      const trackId = await createTrack('Backref Abort Track');
      await setTrackConfig(trackId, {
        member_sync: { strategy: 'manual' },
        promotion_conflicts: { into_candidates: 'abort' },
      });
      await addCandidates(trackId, [revisionA]);

      await postObject('/api/techniques', buildNextRevision(revisionA, 'Backref Abort v2'));

      await postObject(
        `/api/release-tracks/${trackId}/candidates`,
        { object_refs: [{ id: revisionA.stix.id }] },
        409,
      );

      // Track state unchanged: still pinned at revision A, backref intact
      const candidates = await listCandidates(trackId);
      expect(candidates).toHaveLength(1);
      expect(new Date(candidates[0].object_modified).toISOString()).toBe(revisionA.stix.modified);
      expect(entryForTrack(await getTechniqueVersion(revisionA), trackId)).toBeDefined();
    });
  });

  describe('server-controlled field', function () {
    it('strips client-supplied workspace.release_tracks on create', async function () {
      const data = buildTechnique('Backref Injection Create');
      data.workspace.release_tracks = [
        { id: 'release-track--00000000-0000-4000-8000-000000000000', tier: 'members' },
      ];

      const created = await postObject('/api/techniques', data);
      expect(created.workspace.release_tracks).toBeUndefined();
    });

    it('preserves server-managed backrefs when a PUT omits or fakes them', async function () {
      const technique = await postObject(
        '/api/techniques',
        buildTechnique('Backref Injection Put'),
      );
      const trackId = await createTrack('Backref Injection Track');
      await addCandidates(trackId, [technique]);

      const update = JSON.parse(JSON.stringify(technique));
      update.workspace.release_tracks = [
        { id: 'release-track--00000000-0000-4000-8000-000000000000', tier: 'members' },
      ];

      const res = await request(app)
        .put(`/api/techniques/${technique.stix.id}/modified/${technique.stix.modified}`)
        .send(update)
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(200);

      // Workspace-only PUT retains the real server-managed entry and discards
      // the fake client-supplied one without creating a content revision.
      expect(entryForTrack(res.body, trackId)).toEqual({
        id: trackId,
        type: 'standard',
        tier: 'candidates',
        status: 'work-in-progress',
      });
      expect(trackEntries(res.body)).toHaveLength(1);
    });
  });

  describe('revision clones never inherit backrefs', function () {
    it('revoking an object strips backrefs from the revoked and deprecated revisions', async function () {
      const techniqueA = await postObject('/api/techniques', buildTechnique('Backref Revoke A'));
      const techniqueB = await postObject('/api/techniques', buildTechnique('Backref Revoke B'));
      const group = await postObject('/api/groups', {
        workspace: { workflow: { state: 'work-in-progress' } },
        stix: {
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          name: 'Backref Revoke Group',
          spec_version: '2.1',
          type: 'intrusion-set',
          description: 'Group used to verify revoke backref stripping.',
          object_marking_refs: [staticMarkingDefinitionId],
        },
      });
      const relationship = await postObject('/api/relationships', {
        workspace: { workflow: { state: 'work-in-progress' } },
        stix: {
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          spec_version: '2.1',
          type: 'relationship',
          relationship_type: 'uses',
          source_ref: group.stix.id,
          target_ref: techniqueA.stix.id,
          object_marking_refs: [staticMarkingDefinitionId],
        },
      });

      const trackId = await createTrack('Backref Revoke Track');
      await addCandidates(trackId, [techniqueA, relationship]);

      const res = await request(app)
        .post(`/api/techniques/${techniqueA.stix.id}/revoke`)
        .send({ revoking: { stixId: techniqueB.stix.id, modified: techniqueB.stix.modified } })
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(200);

      // The revoked revision carries a backref only via revision sync (the
      // candidate pin moved to it) — never via clone-copying: the entry is
      // the re-pinned candidate, not the fake members entry a copy would show
      expect(res.body.primary.stix.revoked).toBe(true);
      expect(entryForTrack(res.body.primary, trackId)).toEqual({
        id: trackId,
        type: 'standard',
        tier: 'candidates',
        status: 'work-in-progress',
      });
      const oldTechniqueRevision = await getTechniqueVersion(techniqueA);
      expect(entryForTrack(oldTechniqueRevision, trackId)).toBeUndefined();

      // The relationship referencing the revoked object was deprecated into a
      // new revision — relationships are not revision-synced, so any backref
      // here would be a clone leak
      const latestRels = await getObjectVersion(`/api/relationships/${relationship.stix.id}`);
      const latestRel = latestRels[0];
      expect(latestRel.stix.x_mitre_deprecated).toBe(true);
      expect(latestRel.stix.modified).not.toBe(relationship.stix.modified);
      expect(latestRel.workspace.release_tracks).toBeUndefined();

      // The pinned relationship revision keeps its backref (its pin did not move)
      const pinnedRel = await getObjectVersion(
        `/api/relationships/${relationship.stix.id}/modified/${relationship.stix.modified}`,
      );
      expect(entryForTrack(pinnedRel, trackId)).toMatchObject({ tier: 'candidates' });
    });

    it('technique conversion strips backrefs from the converted revision', async function () {
      const parent = await postObject('/api/techniques', buildTechnique('Backref Convert Parent'));
      const technique = await postObject(
        '/api/techniques',
        buildTechnique('Backref Convert Child'),
      );
      const trackId = await createTrack('Backref Convert Track');
      await addCandidates(trackId, [technique]);

      const res = await request(app)
        .post(`/api/techniques/${technique.stix.id}/convert-to-subtechnique`)
        .send({ parentTechniqueAttackId: parent.workspace.attack_id })
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(200);

      // The converted revision carries a backref only via revision sync (the
      // candidate pin moved to it) — never via clone-copying: the entry is
      // the re-pinned candidate, not a fake copied entry
      expect(res.body.primary.stix.x_mitre_is_subtechnique).toBe(true);
      expect(entryForTrack(res.body.primary, trackId)).toEqual({
        id: trackId,
        type: 'standard',
        tier: 'candidates',
        status: 'work-in-progress',
      });

      // The pre-conversion revision no longer carries the entry
      const oldRevision = await getTechniqueVersion(technique);
      expect(entryForTrack(oldRevision, trackId)).toBeUndefined();
    });
  });

  after(async function () {
    await database.closeConnection();
  });
});
