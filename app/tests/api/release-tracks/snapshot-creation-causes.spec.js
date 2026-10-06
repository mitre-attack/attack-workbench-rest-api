'use strict';

const request = require('supertest');
const { expect } = require('expect');
const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const snapshotService = require('../../../services/release-tracks/snapshot-service');
const standard = require('../../../services/release-tracks/standard-track-service');
const virtual = require('../../../services/release-tracks/virtual-track-service');
const modelFactory = require('../../../models/release-tracks/model-factory');
const Cause = require('../../../lib/release-tracks/snapshot-creation-causes');

describe('Snapshot creation causes', function () {
  let app;
  let cookie;
  before(async function () {
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();
    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;
    app = await require('../../../index').initializeApp();
    cookie = await login.loginAnonymous(app);
  });
  after(async function () {
    await database.closeConnection();
  });

  async function api(method, path, body, status = 200) {
    const call = request(app)[method](path).set('Cookie', `${cookie.name}=${cookie.value}`);
    if (body !== undefined) call.send(body);
    return (await call.expect(status)).body;
  }
  async function create(name, type = 'standard', extra = {}) {
    return api('post', '/api/release-tracks/new', { name, type, ...extra }, 201);
  }
  async function assertPersisted(snapshot, cause, userId) {
    expect(snapshot.creation_cause).toBe(cause);
    const stored = await modelFactory
      .getModel(snapshot.id)
      .findOne({ modified: snapshot.modified })
      .lean();
    expect(stored.creation_cause).toBe(cause);
    if (userId) {
      expect(stored.creation_actor).toEqual({ kind: 'user', user_account_id: userId });
    }
    return snapshot;
  }

  it('attributes each new snapshot to its invoker, enriches GETs, and tolerates deleted users', async function () {
    const User = require('../../../models/user-account-model');
    const id = 'identity--12345678-1234-4234-8234-123456789012';
    await User.create({
      id,
      username: 'second.editor',
      displayName: 'Second Editor',
      email: 'private@example.test',
      role: 'editor',
      status: 'active',
      created: new Date(),
      modified: new Date(),
    });
    await api(
      'post',
      '/api/release-tracks/new',
      {
        name: 'Spoofed Actor',
        type: 'virtual',
        creation_actor: { kind: 'user', user_account_id: id },
        creation_cause: Cause.ScheduledSnapshot,
      },
      400,
    );
    const first = await create('Creation Actor Track', 'virtual');
    expect(first.creation_cause).toBe(Cause.TrackCreated);
    expect(first.creation_actor.kind).toBe('user');
    expect(first.creation_actor.user_account_id).toBe(first.created_by_ref);
    expect(first.creation_actor.user_account_id).not.toBe(id);
    const edited = await snapshotService.updateMetadata(first.id, { description: 'Changed' }, id);
    expect(edited.created_by_ref).toBe(first.created_by_ref);
    expect(edited.creation_actor).toEqual({ kind: 'user', user_account_id: id });
    const stored = await modelFactory
      .getModel(first.id)
      .findOne({ modified: edited.modified })
      .lean();
    expect(stored.creation_actor).toEqual(edited.creation_actor);
    for (const suffix of ['latest', encodeURIComponent(new Date(edited.modified).toISOString())]) {
      const response = await api('get', `/api/release-tracks/${first.id}/snapshots/${suffix}`);
      expect(response.creation_actor.user).toEqual({
        id,
        username: 'second.editor',
        displayName: 'Second Editor',
        name: 'Second Editor',
      });
    }
    const history = await api('get', `/api/release-tracks/${first.id}/snapshots`);
    expect(history.data[0].creation_actor.user.displayName).toBe('Second Editor');
    expect(history.data[1].creation_actor.user_account_id).toBe(first.created_by_ref);
    const copy = await snapshotService.cloneTrack(first.id, {
      name: 'Creation Actor Copy',
      userAccountId: first.created_by_ref,
    });
    expect(copy.creation_actor.user_account_id).toBe(first.created_by_ref);
    await User.deleteOne({ id });
    const deleted = await api('get', `/api/release-tracks/${first.id}/snapshots/latest`);
    expect(deleted.creation_actor).toEqual({ kind: 'user', user_account_id: id });
  });

  it('persists config causes and exposes them in latest, timestamp, and history GETs', async function () {
    const initial = await create('Creation Cause Virtual', 'virtual');
    await assertPersisted(initial, Cause.TrackCreated);
    await api('put', `/api/release-tracks/${initial.id}/virtual/schedule`, {
      mode: 'cron',
      cron: '*/15 * * * *',
    });
    expect(await modelFactory.getModel(initial.id).countDocuments()).toBe(1);
    const configured = await api('put', `/api/release-tracks/${initial.id}/config`, {
      publication: { created_by_ref: { inherit: true } },
    });
    // Config endpoints return a config envelope; inspect the new snapshot itself.
    expect(configured).toBeDefined();
    const latest = await api('get', `/api/release-tracks/${initial.id}/snapshots/latest`);
    await assertPersisted(latest, Cause.ConfigurationUpdated);
    expect(latest.creation_actor.user_account_id).toBe(initial.created_by_ref);
    const selected = await api(
      'get',
      `/api/release-tracks/${initial.id}/snapshots/${encodeURIComponent(latest.modified)}`,
    );
    expect(selected.creation_cause).toBe(Cause.ConfigurationUpdated);
    const history = await api('get', `/api/release-tracks/${initial.id}/snapshots`);
    expect(history.data.map((row) => row.creation_cause)).toEqual([
      Cause.ConfigurationUpdated,
      Cause.TrackCreated,
    ]);
  });

  it('retains creation cause when tagging, assigns new causes on metadata changes and track copies', async function () {
    const initial = await create('Creation Cause Lifecycle');
    const metadata = await snapshotService.updateMetadata(initial.id, {
      name: 'Creation Cause Renamed',
    });
    await assertPersisted(metadata, Cause.MetadataUpdated);
    const released = await api(
      'post',
      `/api/release-tracks/${initial.id}/snapshots/latest/release`,
      { version: '1.0' },
    );
    await assertPersisted(released, Cause.ReleaseTagged);
    expect(released.creation_actor.user_account_id).toBe(initial.created_by_ref);
    const source = await api(
      'get',
      `/api/release-tracks/${initial.id}/snapshots/${encodeURIComponent(new Date(metadata.modified).toISOString())}`,
    );
    expect(source.creation_cause).toBe(Cause.MetadataUpdated);
    expect(source.creation_actor).toEqual({ kind: 'unknown' });
    const copy = await snapshotService.cloneTrack(initial.id, { name: 'Creation Cause Copy' });
    await assertPersisted(copy, Cause.TrackCloned);
    const configured = await snapshotService.updateConfig(initial.id, { auto_promote: false });
    await assertPersisted(configured, Cause.ConfigurationUpdated);
  });

  it('distinguishes manual, scheduled, and composition-created virtual drafts', async function () {
    const component = await create('Creation Cause Component');
    await api('post', `/api/release-tracks/${component.id}/snapshots/latest/release`, {
      version: '1.0',
    });
    const composition = {
      component_tracks: [
        { track_id: component.id, resolution_strategy: 'latest_tagged', priority: 0 },
      ],
    };
    const track = await create('Creation Cause Materialization', 'virtual', { composition });
    const manual = await virtual.createVirtualSnapshot(track.id, {
      userAccountId: track.created_by_ref,
    });
    await assertPersisted(manual, Cause.ManualSnapshot);
    expect(manual.creation_actor.user_account_id).toBe(track.created_by_ref);
    const tagged = await api('post', `/api/release-tracks/${track.id}/snapshots/latest/release`, {
      version: '1.0',
    });
    expect(tagged.creation_cause).toBe(Cause.ManualSnapshot);
    expect(tagged.creation_actor.user_account_id).toBe(track.created_by_ref);
    const scheduled = await virtual.createVirtualSnapshot(track.id, {
      scheduledMaterialization: {
        schedule_mode: 'cron',
        scheduled_for: new Date('2027-01-01T00:00:00Z'),
      },
    });
    await assertPersisted(scheduled, Cause.ScheduledSnapshot);
    expect(scheduled.creation_actor).toEqual({ kind: 'system' });
    await assertPersisted(
      await virtual.updateComposition(track.id, composition),
      Cause.CompositionUpdated,
    );
  });

  it('records standard workflow operations and automatic promotion', async function () {
    const object = await api(
      'post',
      '/api/techniques',
      {
        workspace: { workflow: { state: 'work-in-progress' } },
        stix: {
          type: 'attack-pattern',
          spec_version: '2.1',
          name: 'Creation Cause Technique',
          description: 'Technique used to verify workflow snapshot provenance.',
          x_mitre_version: '1.0',
          x_mitre_domains: ['enterprise-attack'],
          x_mitre_platforms: ['Windows'],
          x_mitre_is_subtechnique: false,
          kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'persistence' }],
          object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
        },
      },
      201,
    );
    const track = await create('Creation Cause Workflow', 'standard', {
      config: { auto_promote: false, member_sync: { strategy: 'manual' } },
    });
    const ref = { id: object.stix.id, modified: object.stix.modified };
    await assertPersisted(
      await standard.addCandidates(track.id, [ref], 'cause-test'),
      Cause.CandidatesAdded,
      'cause-test',
    );
    await assertPersisted(
      await standard.updateCandidateVersion(
        track.id,
        ref.id,
        {
          old_modified: ref.modified,
          new_modified: 'latest',
        },
        'version-editor',
      ),
      Cause.CandidateVersionUpdated,
      'version-editor',
    );
    await assertPersisted(
      await standard.reviewCandidates(
        track.id,
        { from: 'work-in-progress', to: 'reviewed' },
        'reviewer',
      ),
      Cause.CandidatesReviewed,
      'reviewer',
    );
    await assertPersisted(
      await standard.promoteCandidates(track.id, [ref.id], 'cause-test'),
      Cause.CandidatesPromoted,
      'cause-test',
    );
    await assertPersisted(
      await standard.demoteStaged(track.id, [{ id: ref.id, modified: 'latest' }], 'cause-test'),
      Cause.StagedDemoted,
      'cause-test',
    );
    await api('delete', `/api/release-tracks/${track.id}/candidates/${ref.id}`, undefined, 204);
    await assertPersisted(
      await snapshotService.getLatestSnapshot(track.id),
      Cause.CandidateRemoved,
      track.created_by_ref,
    );
    await snapshotService.updateConfig(track.id, {
      auto_promote: true,
      candidacy_threshold: 'work-in-progress',
    });
    await assertPersisted(
      await standard.addCandidates(track.id, [ref], 'cause-test'),
      Cause.CandidatesAutoPromoted,
      'cause-test',
    );
  });

  it('records bundle imports and automatic synchronization of object edits', async function () {
    const importer = require('../../../services/release-tracks/bundle-import-service');
    const track = await importer.createTrackFromBundle(
      {
        type: 'bundle',
        id: 'bundle--11111111-1111-4111-8111-111111111111',
        objects: [
          {
            type: 'attack-pattern',
            spec_version: '2.1',
            id: 'attack-pattern--11111111-1111-4111-8111-111111111111',
            name: 'Creation Cause Import',
            description: 'Technique imported to verify snapshot provenance.',
            x_mitre_domains: ['enterprise-attack'],
            x_mitre_platforms: ['Windows'],
            x_mitre_version: '1.0',
            x_mitre_attack_spec_version: '3.3.0',
            x_mitre_is_subtechnique: false,
            kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'execution' }],
            external_references: [{ source_name: 'mitre-attack', external_id: 'T9998' }],
            created: '2026-01-01T00:00:00.000Z',
            modified: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
      'identity--12345678-1234-4234-8234-123456789012',
    );
    await assertPersisted(
      track,
      Cause.BundleImported,
      'identity--12345678-1234-4234-8234-123456789012',
    );
    const object = await api(
      'post',
      '/api/techniques',
      {
        workspace: { workflow: { state: 'work-in-progress' } },
        stix: { type: 'attack-pattern', spec_version: '2.1', name: 'Creation Cause Sync' },
      },
      201,
    );
    const syncedTrack = await create('Creation Cause Sync Track');
    await standard.addCandidates(
      syncedTrack.id,
      [{ id: object.stix.id, modified: object.stix.modified }],
      'cause-test',
    );
    const sync = require('../../../services/release-tracks/member-sync-service');
    const results = await sync.handleObjectModified({
      objectRef: object.stix.id,
      newModified: object.stix.modified,
      trigger: 'in-place-update',
      modifiedBy: 'object-editor',
    });
    expect(results).toHaveLength(1);
    await assertPersisted(results[0], Cause.MemberSynced, 'object-editor');
  });

  it('does not invent history for legacy snapshots or inherit a source cause on an unclassified clone', async function () {
    const track = await create('Creation Cause Legacy', 'virtual');
    const Model = modelFactory.getModel(track.id);
    await Model.collection.updateOne(
      { id: track.id },
      { $unset: { creation_cause: '', creation_actor: '' } },
    );
    const latest = await api('get', `/api/release-tracks/${track.id}/snapshots/latest`);
    expect(latest.creation_cause).toBe(Cause.Unknown);
    expect(latest.creation_actor).toEqual({ kind: 'unknown' });
    const history = await api('get', `/api/release-tracks/${track.id}/snapshots`);
    expect(history.data[0].creation_cause).toBe(Cause.Unknown);
    expect(history.data[0].creation_actor).toEqual({ kind: 'unknown' });
    const clone = await snapshotService.cloneSnapshot(
      track.id,
      { ...latest, creation_cause: Cause.ScheduledSnapshot },
      {
        creation_cause: Cause.TrackCreated,
        creation_actor: { kind: 'user', user_account_id: 'spoofed' },
      },
    );
    await assertPersisted(clone, Cause.Unknown);
    expect(clone.creation_actor).toEqual({ kind: 'unknown' });
    await expect(
      new Model({ ...clone, _id: undefined, creation_cause: 'made_up' }).validate(),
    ).rejects.toThrow();
  });
});
