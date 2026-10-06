'use strict';

const request = require('supertest');
const { expect } = require('expect');
const sinon = require('sinon');
const crypto = require('node:crypto');
const dynamicRepo = require('../../../repository/release-tracks/release-track-dynamic.repository');
const registryRepo = require('../../../repository/release-tracks/release-track-registry.repository');
const snapshotService = require('../../../services/release-tracks/snapshot-service');
const versioningService = require('../../../services/release-tracks/versioning-service');
const bundleHashService = require('../../../services/release-tracks/bundle-hash-service');
const releaseHistoryService = require('../../../services/release-tracks/release-history-service');

const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const UserAccount = require('../../../models/user-account-model');
const ReleaseTrackAuditEvent = require('../../../models/release-tracks/release-track-audit-event-model');
const auditRepository = require('../../../repository/release-tracks/release-track-audit-event.repository');
const systemConfigurationService = require('../../../services/system/system-configuration-service');
const {
  ReleaseTrackContentManifest,
} = require('../../../models/release-tracks/release-track-content-manifest-model');
const { releaseExactMembers } = require('./release-track-test-helpers');

const markingDefinitionId = 'marking-definition--613f2e26-407d-48c7-9eca-b8e91df99dc9';

describe('Release-track destructive authorization and audit', function () {
  let app;
  let passportCookie;
  let anonymousUser;

  before(async function () {
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();
    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;
    app = await require('../../../index').initializeApp();
    passportCookie = await login.loginAnonymous(app);
    anonymousUser = await systemConfigurationService.retrieveAnonymousUserAccount();
  });

  after(async function () {
    sinon.restore();
    await UserAccount.updateOne({ id: anonymousUser.id }, { $set: { role: 'admin' } });
    await database.closeConnection();
  });

  afterEach(function () {
    sinon.restore();
  });

  async function setRole(role) {
    await UserAccount.updateOne({ id: anonymousUser.id }, { $set: { role } });
  }

  function api(method, path, body, status, query) {
    const call = request(app)
      [method](path)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`);
    if (query) call.query(query);
    if (body !== undefined) call.send(body);
    return call.expect(status);
  }

  async function post(path, body, status = 200, query) {
    return (await api('post', path, body, status, query)).body;
  }

  function convert(path, version, status = 200) {
    return api('post', `${path}/draft`, { confirm_version: version }, status);
  }

  it('requires admin role, exact confirmation, and a durable outcome record', async function () {
    await setRole('admin');
    const track = await post(
      '/api/release-tracks/new',
      { name: 'Destructive authorization standard', type: 'standard' },
      201,
    );

    await setRole('editor');
    await api('delete', `/api/release-tracks/${track.id}`, undefined, 401, {
      confirm_track_id: track.id,
    });
    expect(await ReleaseTrackAuditEvent.countDocuments()).toBe(0);

    await setRole('admin');
    await api('delete', `/api/release-tracks/${track.id}`, undefined, 400);
    await api('delete', `/api/release-tracks/${track.id}`, undefined, 400, {
      confirm_track_id: 'release-track--00000000-0000-4000-8000-000000000099',
    });
    expect(await ReleaseTrackAuditEvent.countDocuments()).toBe(0);

    await api('delete', `/api/release-tracks/${track.id}`, undefined, 204, {
      confirm_track_id: track.id,
    });

    const events = await ReleaseTrackAuditEvent.find().sort({ started_at: 1 }).lean().exec();
    expect(events).toHaveLength(1);
    expect(events.map((event) => [event.action, event.status])).toEqual([
      ['delete_track', 'completed'],
    ]);
    expect(events[0]).toMatchObject({
      track_id: track.id,
      confirmation: track.id,
      actor: {
        user_account_id: anonymousUser.id,
        role: 'admin',
        authentication_strategy: 'anonymId',
      },
      result: { deleted: true },
    });
  });

  it('lets only administrators delete the most recent release, with confirmation and audit', async function () {
    await setRole('admin');
    const timestamp = new Date().toISOString();
    const technique = await post(
      '/api/techniques',
      {
        workspace: { workflow: { state: 'work-in-progress' } },
        stix: {
          type: 'attack-pattern',
          spec_version: '2.1',
          created: timestamp,
          modified: timestamp,
          name: 'Release deletion member',
          description: 'Member for release deletion tests.',
          kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'execution' }],
          x_mitre_is_subtechnique: false,
          x_mitre_domains: ['enterprise-attack'],
          x_mitre_platforms: ['Windows'],
          x_mitre_version: '1.0',
          object_marking_refs: [markingDefinitionId],
        },
      },
      201,
    );
    const track = await post(
      '/api/release-tracks/new',
      { name: 'Release deletion track', type: 'standard' },
      201,
    );
    const first = await releaseExactMembers(app, passportCookie, track.id, [technique], {
      version: '1.0',
    });
    const firstSource = await api(
      'get',
      `/api/release-tracks/${track.id}/snapshots/${encodeURIComponent(first.release_source_modified)}`,
      undefined,
      200,
    );
    expect(firstSource.body).toMatchObject({
      version: null,
      staged: [expect.objectContaining({ object_ref: technique.stix.id })],
    });
    const secondDraft = await post(
      `/api/release-tracks/${track.id}/meta`,
      { description: 'next' },
      200,
    );
    const second = await post(
      `/api/release-tracks/${track.id}/snapshots/latest/release`,
      { version: '1.1' },
      200,
    );
    const secondPath = `/api/release-tracks/${track.id}/snapshots/${encodeURIComponent(
      second.modified,
    )}`;
    const firstPath = `/api/release-tracks/${track.id}/snapshots/${encodeURIComponent(
      first.modified,
    )}`;

    // Editors cannot delete a release even with the right confirmation.
    await setRole('editor');
    await convert(secondPath, '1.1', 403);

    await setRole('admin');
    await api('post', `${secondPath}/draft`, {}, 400);
    await convert(secondPath, '9.9', 400);
    expect(
      await ReleaseTrackAuditEvent.countDocuments({ action: 'convert_release_to_draft' }),
    ).toBe(0);
    // Only the most recent release can be deleted; the rejected attempt is
    // audited as failed, like any confirmed destructive request.
    await convert(firstPath, '1.0', 409);
    expect(
      await ReleaseTrackAuditEvent.countDocuments({
        action: 'convert_release_to_draft',
        status: 'failed',
      }),
    ).toBe(1);

    await convert(secondPath, '1.1', 200);

    await api('get', secondPath, undefined, 404);
    const remaining = await api(
      'get',
      `/api/release-tracks/${track.id}/snapshots/latest`,
      undefined,
      200,
    );
    expect(remaining.body.modified).toBe(secondDraft.modified);
    expect(remaining.body.version).toBeNull();
    expect(remaining.body.description).toBe('next');
    expect(remaining.body.version_history.map((entry) => entry.version)).toEqual(['1.0']);
    expect(
      await ReleaseTrackContentManifest.countDocuments({
        manifest_id: second.content_manifest_id,
      }),
    ).toBe(0);
    const registry = await api('get', '/api/release-tracks', undefined, 200);
    const entry = registry.body.data.find((candidate) => candidate.track_id === track.id);
    expect(entry.tagged_release_count).toBe(1);
    expect(entry.latest_tagged_version).toBe('1.0');

    const event = await ReleaseTrackAuditEvent.findOne({
      action: 'convert_release_to_draft',
      status: 'completed',
    })
      .lean()
      .exec();
    expect(event).toMatchObject({
      track_id: track.id,
      confirmation: '1.1',
      status: 'completed',
      request: { snapshot_modified: new Date(second.modified).toISOString() },
      result: { snapshot_modified: expect.any(Date), version: null, members_count: 1 },
    });

    // The version is free again and the track keeps working.
    await post(`/api/release-tracks/${track.id}/meta`, { description: 'again' }, 200);
    const again = await post(
      `/api/release-tracks/${track.id}/snapshots/latest/release`,
      { version: '1.1' },
      200,
    );
    expect(again.version).toBe('1.1');
  });

  it('blocks deletion when implicit or explicit virtual snapshots resolved the release', async function () {
    await setRole('admin');
    const component = await post(
      '/api/release-tracks/new',
      { name: 'Protected component release', type: 'standard' },
      201,
    );
    const released = await post(
      `/api/release-tracks/${component.id}/snapshots/latest/release`,
      { version: '1.0' },
      200,
    );

    const virtualSnapshots = [];
    for (const [name, rule] of [
      ['Implicit dependent', { resolution_strategy: 'latest_tagged' }],
      ['Explicit dependent', { resolution_strategy: 'specific_version', version: '1.0' }],
    ]) {
      const virtual = await post(
        '/api/release-tracks/new',
        {
          name,
          type: 'virtual',
          composition: {
            component_tracks: [{ track_id: component.id, priority: 1, ...rule }],
          },
        },
        201,
      );
      virtualSnapshots.push({
        trackId: virtual.id,
        snapshot: await post(`/api/release-tracks/${virtual.id}/virtual/snapshots/create`, {}, 201),
      });
    }

    const response = await convert(
      `/api/release-tracks/${component.id}/snapshots/${encodeURIComponent(released.modified)}`,
      '1.0',
      409,
    );
    expect(response.body.dependent_snapshots).toHaveLength(2);
    expect(response.body.dependent_snapshots.map((item) => item.track_name).sort()).toEqual([
      'Explicit dependent',
      'Implicit dependent',
    ]);
    await api(
      'get',
      `/api/release-tracks/${component.id}/snapshots/${encodeURIComponent(released.modified)}`,
      undefined,
      200,
    );

    const retagged = await api(
      'put',
      `/api/release-tracks/${component.id}/snapshots/${encodeURIComponent(released.modified)}/release`,
      { version: '1.1' },
      200,
    );
    expect(retagged.body.version).toBe('1.1');
    for (const virtual of virtualSnapshots) {
      const persisted = await api(
        'get',
        `/api/release-tracks/${virtual.trackId}/snapshots/${encodeURIComponent(virtual.snapshot.modified)}`,
        undefined,
        200,
      );
      expect(persisted.body.composition_resolution.component_snapshots[0]).toMatchObject({
        resolved_version: '1.0',
        resolved_snapshot_id: released.modified,
      });
    }
  });

  it('lets administrators retag a release within its semantic-version bounds', async function () {
    await setRole('admin');
    const track = await post(
      '/api/release-tracks/new',
      { name: 'Retag release track', type: 'standard' },
      201,
    );
    const first = await post(
      `/api/release-tracks/${track.id}/snapshots/latest/release`,
      { version: '1.0' },
      200,
    );
    await post(`/api/release-tracks/${track.id}/meta`, { description: 'second' }, 200);
    const second = await post(
      `/api/release-tracks/${track.id}/snapshots/latest/release`,
      { version: '2.0' },
      200,
    );

    await setRole('editor');
    await api(
      'put',
      `/api/release-tracks/${track.id}/snapshots/${encodeURIComponent(second.modified)}/release`,
      { version: '1.1' },
      403,
    );

    await setRole('admin');
    const retagged = await api(
      'put',
      `/api/release-tracks/${track.id}/snapshots/${encodeURIComponent(second.modified)}/release`,
      { version: '1.1' },
      200,
    );
    expect(retagged.body).toMatchObject({
      modified: second.modified,
      version: '1.1',
      bundle_id: second.bundle_id,
    });
    expect(retagged.body.bundle_hashes.stix_2_0).toBe(second.bundle_hashes.stix_2_0);
    expect(retagged.body.bundle_hashes.stix_2_1).not.toBe(second.bundle_hashes.stix_2_1);
    expect(retagged.body.version_history.map((entry) => entry.version)).toEqual(['1.0', '1.1']);

    const history = await api('get', `/api/release-tracks/${track.id}/snapshots`, undefined, 200);
    const summary = history.body.data.find((entry) => entry.modified === second.modified);
    expect(summary.release_source_modified).toBe(second.release_source_modified);
    expect(summary.bundle_hashes).toEqual(retagged.body.bundle_hashes);
    for (const stixVersion of ['2.0', '2.1']) {
      const download = await api(
        'get',
        `/api/release-tracks/${track.id}/snapshots/${encodeURIComponent(second.modified)}`,
        undefined,
        200,
        { format: 'bundle', stixVersion },
      );
      const digest = crypto
        .createHash('sha256')
        .update(JSON.stringify(download.body, null, 4))
        .digest('hex');
      expect(digest).toBe(summary.bundle_hashes[stixVersion === '2.0' ? 'stix_2_0' : 'stix_2_1']);
    }

    await api(
      'put',
      `/api/release-tracks/${track.id}/snapshots/${encodeURIComponent(first.modified)}/release`,
      { version: '1.2' },
      400,
    );

    const event = await ReleaseTrackAuditEvent.findOne({
      action: 'retag_release',
      status: 'completed',
    })
      .lean()
      .exec();
    expect(event).toMatchObject({
      track_id: track.id,
      confirmation: '2.0',
      request: { previous_version: '2.0', next_version: '1.1' },
    });
  });

  for (const [label, target, method, versionPublished] of [
    ['hash generation', bundleHashService, 'generateBundleHashes', false],
    ['copied history', dynamicRepo, 'replaceVersionHistoryVersion', true],
    ['release catalogue', releaseHistoryService, 'reconcileTaggedReleases', true],
    ['registry counters', snapshotService, 'syncRegistryCounters', true],
  ]) {
    it(`recovers a retag interrupted during ${label}`, async function () {
      await setRole('admin');
      const track = await post('/api/release-tracks/new', { name: label, type: 'standard' }, 201);
      const base = `/api/release-tracks/${track.id}`;
      const released = await post(`${base}/snapshots/latest/release`, { version: '1.0' });
      const draft = await post(`${base}/meta`, { description: 'Copied release history' });
      const path = `${base}/snapshots/${encodeURIComponent(released.modified)}`;
      const failure = sinon.stub(target, method).rejects(new Error(`Injected ${label} failure`));
      await api('put', `${path}/release`, { version: '1.1' }, 500);
      failure.restore();
      const persisted = await dynamicRepo.getSnapshotByModified(track.id, released.modified);
      expect(persisted.version).toBe(versionPublished ? '1.1' : '1.0');
      expect(persisted.bundle_hashes.stix_2_0).toBe(released.bundle_hashes.stix_2_0);
      if (!versionPublished) expect(persisted.bundle_hashes).toEqual(released.bundle_hashes);
      const retried = await api('put', `${path}/release`, { version: '1.1' }, 200);
      expect(retried.body.bundle_hashes.stix_2_1).not.toBe(released.bundle_hashes.stix_2_1);
      const copied = await dynamicRepo.getSnapshotByModified(track.id, draft.modified);
      expect(copied.version_history.map((entry) => entry.version)).toEqual(['1.1']);
      const registry = await registryRepo.findByTrackId(track.id);
      expect(registry.tagged_releases.map((entry) => entry.version)).toEqual(['1.1']);
      const events = await ReleaseTrackAuditEvent.find({
        track_id: track.id,
        action: 'retag_release',
      }).lean();
      expect(events.map((event) => event.status).sort()).toEqual(['completed', 'failed']);
    });
  }

  for (const strategy of ['latest_tagged', 'specific_version']) {
    it(`holds component locks until ${strategy} materialization is persisted`, async function () {
      await setRole('admin');
      const component = await post(
        '/api/release-tracks/new',
        { name: strategy.replaceAll('_', ' '), type: 'standard' },
        201,
      );
      const base = `/api/release-tracks/${component.id}`;
      const released = await post(`${base}/snapshots/latest/release`, { version: '1.0' });
      const virtual = await post(
        '/api/release-tracks/new',
        {
          name: 'Concurrent dependent',
          type: 'virtual',
          composition: {
            component_tracks: [
              {
                track_id: component.id,
                priority: 1,
                resolution_strategy: strategy,
                ...(strategy === 'specific_version' ? { version: '1.0' } : {}),
              },
            ],
          },
        },
        201,
      );
      const path = `${base}/snapshots/${encodeURIComponent(released.modified)}`;
      const clone = snapshotService.cloneSnapshot;
      const stub = sinon.stub(snapshotService, 'cloneSnapshot').callsFake(async (...args) => {
        await convert(path, '1.0', 409);
        return clone(...args);
      });
      await post(`/api/release-tracks/${virtual.id}/virtual/snapshots/create`, {}, 201);
      expect(stub.calledOnce).toBe(true);
      stub.restore();
      const blocked = await convert(path, '1.0', 409);
      expect(blocked.body.dependent_snapshots).toHaveLength(1);
      expect((await registryRepo.findByTrackId(component.id)).release_lock).toBeUndefined();
    });
  }

  it('repairs missing hashes on a same-version retry and holds the lock during audit capture', async function () {
    await setRole('admin');
    const track = await post(
      '/api/release-tracks/new',
      { name: 'Retag repair', type: 'standard' },
      201,
    );
    const base = `/api/release-tracks/${track.id}`;
    const released = await post(`${base}/snapshots/latest/release`, { version: '1.0' });
    const path = `${base}/snapshots/${encodeURIComponent(released.modified)}`;
    await dynamicRepo.updateSnapshot(track.id, released.modified, {
      $unset: { bundle_hashes: '' },
    });
    const create = auditRepository.create;
    const stub = sinon.stub(auditRepository, 'create').callsFake(async (...args) => {
      await api('put', `${path}/release`, { version: '1.1' }, 409);
      return create.apply(auditRepository, args);
    });
    const repaired = await api('put', `${path}/release`, { version: '1.0' }, 200);
    expect(stub.calledOnce).toBe(true);
    expect(repaired.body.version).toBe('1.0');
    expect(repaired.body.bundle_hashes).toEqual(released.bundle_hashes);
    const event = await ReleaseTrackAuditEvent.findOne({
      track_id: track.id,
      action: 'retag_release',
    }).lean();
    expect(event.request.previous_version).toBe('1.0');
    expect(event.request.next_version).toBe('1.0');
  });

  it('does not publish retag hashes if the content manifest changed during export', async function () {
    await setRole('admin');
    const track = await post(
      '/api/release-tracks/new',
      { name: 'Manifest race', type: 'standard' },
      201,
    );
    const base = `/api/release-tracks/${track.id}`;
    const released = await post(`${base}/snapshots/latest/release`, { version: '1.0' });
    const generate = bundleHashService.generateBundleHashes;
    sinon.stub(bundleHashService, 'generateBundleHashes').callsFake(async (snapshot) => {
      const hashes = await generate(snapshot);
      // Simulate administrative manifest replacement after export was read.
      await dynamicRepo.replaceContentManifest(
        track.id,
        released.modified,
        released.content_manifest_id,
        track.content_manifest_id,
      );
      return hashes;
    });
    await api(
      'put',
      `${base}/snapshots/${encodeURIComponent(released.modified)}/release`,
      { version: '1.1' },
      409,
    );
    const current = await dynamicRepo.getSnapshotByModified(track.id, released.modified);
    expect(current.version).toBe('1.0');
    expect(current.content_manifest_id).toBe(track.content_manifest_id);
    expect(current.bundle_hashes).toBeUndefined();
  });

  it('blocks materialization while rollback holds the component lock', async function () {
    await setRole('admin');
    const component = await post(
      '/api/release-tracks/new',
      { name: 'Rollback first', type: 'standard' },
      201,
    );
    const base = `/api/release-tracks/${component.id}`;
    const released = await post(`${base}/snapshots/latest/release`, { version: '1.0' });
    const virtual = await post(
      '/api/release-tracks/new',
      {
        name: 'Dependent',
        type: 'virtual',
        composition: {
          component_tracks: [
            { track_id: component.id, priority: 1, resolution_strategy: 'latest_tagged' },
          ],
        },
      },
      201,
    );
    const find = dynamicRepo.findSnapshotsResolvingComponent;
    sinon.stub(dynamicRepo, 'findSnapshotsResolvingComponent').callsFake(async (...args) => {
      await api('post', `/api/release-tracks/${virtual.id}/virtual/snapshots/create`, {}, 409);
      return find.apply(dynamicRepo, args);
    });
    await convert(`${base}/snapshots/${encodeURIComponent(released.modified)}`, '1.0', 200);
    expect((await registryRepo.findByTrackId(component.id)).release_lock).toBeUndefined();
  });

  it('rechecks confirmation after a retag wins the release lock', async function () {
    await setRole('admin');
    const track = await post(
      '/api/release-tracks/new',
      { name: 'Confirmation race', type: 'standard' },
      201,
    );
    const base = `/api/release-tracks/${track.id}`;
    const released = await post(`${base}/snapshots/latest/release`, { version: '1.0' });
    const path = `${base}/snapshots/${encodeURIComponent(released.modified)}`;
    const acquire = registryRepo.acquireReleaseLock;
    const stub = sinon.stub(registryRepo, 'acquireReleaseLock').callsFake(async (...args) => {
      stub.restore();
      await api('put', `${path}/release`, { version: '1.1' }, 200);
      return acquire.apply(registryRepo, args);
    });
    const rejected = await convert(path, '1.0', 400);
    expect(rejected.body.expected_version).toBe('1.1');
    expect((await dynamicRepo.getSnapshotByModified(track.id, released.modified)).version).toBe(
      '1.1',
    );
    const event = await ReleaseTrackAuditEvent.findOne({
      track_id: track.id,
      action: 'retag_release',
    }).lean();
    expect(event.request.previous_version).toBe('1.0');
    expect(event.request.next_version).toBe('1.1');
  });

  it('releases partially acquired component locks after a conflict', async function () {
    const components = [];
    for (let i = 0; i < 2; i++) {
      components.push(
        await post('/api/release-tracks/new', { name: `Lock ${i}`, type: 'standard' }, 201),
      );
    }
    components.sort((a, b) => a.id.localeCompare(b.id));
    const virtual = await post(
      '/api/release-tracks/new',
      {
        name: 'Multiple locks',
        type: 'virtual',
        composition: {
          component_tracks: components.map((component, priority) => ({
            track_id: component.id,
            priority,
            resolution_strategy: 'latest_tagged',
          })),
        },
      },
      201,
    );
    await versioningService.withReleaseLock(components[1].id, () =>
      api('post', `/api/release-tracks/${virtual.id}/virtual/snapshots/create`, {}, 409),
    );
    for (const component of components) {
      expect((await registryRepo.findByTrackId(component.id)).release_lock).toBeUndefined();
    }
    // Resolution failure must also unwind the complete lock set.
    await api('post', `/api/release-tracks/${virtual.id}/virtual/snapshots/create`, {}, 400);
    for (const component of components) {
      expect((await registryRepo.findByTrackId(component.id)).release_lock).toBeUndefined();
    }
  });

  it('rejects tagged DELETE for every role, then permits deleting an eligible restored standard draft', async function () {
    await setRole('admin');
    const track = await post(
      '/api/release-tracks/new',
      { name: 'Three operations', type: 'standard' },
      201,
    );
    const base = `/api/release-tracks/${track.id}`;
    const first = await post(`${base}/snapshots/latest/release`, { version: '1.0' });
    const draft = await post(`${base}/meta`, { description: 'Next cycle' });
    const released = await post(`${base}/snapshots/latest/release`, { version: '1.1' });
    const path = `${base}/snapshots/${encodeURIComponent(released.modified)}`;
    for (const role of ['editor', 'admin']) {
      await setRole(role);
      await api('delete', path, undefined, 409);
      await api('delete', path, undefined, 409, { confirm_version: '1.1' });
    }
    await api('delete', `${base}/snapshots/${encodeURIComponent(draft.modified)}`, undefined, 409);
    const restored = await convert(path, '1.1');
    expect(restored.body).toMatchObject({
      modified: draft.modified,
      version: null,
    });
    expect(restored.body.creation_cause).toEqual(draft.creation_cause);
    expect(restored.body.creation_actor).toEqual(draft.creation_actor);
    await setRole('editor');
    await api(
      'delete',
      `${base}/snapshots/${encodeURIComponent(restored.body.modified)}`,
      undefined,
      204,
    );
    const latest = await api('get', `${base}/snapshots/latest`, undefined, 200);
    expect(latest.body.modified).toBe(first.modified);
  });

  it('converts virtual releases in place, retaining provenance, before allowing draft deletion', async function () {
    await setRole('admin');
    const component = await post(
      '/api/release-tracks/new',
      { name: 'Virtual source', type: 'standard' },
      201,
    );
    await post(`/api/release-tracks/${component.id}/snapshots/latest/release`, { version: '1.0' });
    const virtual = await post(
      '/api/release-tracks/new',
      {
        name: 'Virtual conversion',
        type: 'virtual',
        composition: {
          component_tracks: [
            { track_id: component.id, priority: 1, resolution_strategy: 'latest_tagged' },
          ],
        },
      },
      201,
    );
    const base = `/api/release-tracks/${virtual.id}`;
    const draft = await post(
      `${base}/virtual/snapshots/create`,
      { description: 'Preserve me' },
      201,
    );
    const release = await post(`${base}/snapshots/latest/release`, { version: '1.0' });
    const path = `${base}/snapshots/${encodeURIComponent(release.modified)}`;
    await api('delete', path, undefined, 409);
    const restored = await convert(path, '1.0');
    expect(restored.body).toMatchObject({
      modified: draft.modified,
      version: null,
      content_manifest_id: draft.content_manifest_id,
      composition_resolution: draft.composition_resolution,
      snapshot_description: draft.snapshot_description,
      version_history: [],
    });
    expect(restored.body.creation_cause).toEqual(draft.creation_cause);
    expect(restored.body.creation_actor).toEqual(draft.creation_actor);
    for (const field of ['publication', 'bundle_id', 'bundle_hashes'])
      expect(restored.body).not.toHaveProperty(field);
    expect(
      await ReleaseTrackContentManifest.countDocuments({ manifest_id: draft.content_manifest_id }),
    ).toBe(1);
    await convert(path, '1.0', 409);
    // The same materialized draft can be tagged again, then explicitly converted.
    await post(`${path}/release`, { version: '1.0' });
    await convert(path, '1.0');
    await setRole('editor');
    await api('delete', path, undefined, 204);
    expect((await api('get', `${base}/snapshots/latest`, undefined, 200)).body.modified).toBe(
      virtual.modified,
    );
  });

  it('protects draft dependencies, historical drafts, and the only snapshot', async function () {
    await setRole('admin');
    const track = await post(
      '/api/release-tracks/new',
      { name: 'Protected draft', type: 'standard' },
      201,
    );
    const path = `/api/release-tracks/${track.id}/snapshots/${encodeURIComponent(track.modified)}`;
    await api('delete', path, undefined, 409);
    const virtual = await post(
      '/api/release-tracks/new',
      { name: 'Legacy dependent', type: 'virtual' },
      201,
    );
    // Current composition resolution requires tagged sources. Model a retained
    // historical dependency on a draft so deletion cannot assume none exist.
    await dynamicRepo.updateSnapshot(virtual.id, virtual.modified, {
      $set: {
        composition_resolution: {
          resolved_at: new Date(),
          component_snapshots: [
            {
              track_id: track.id,
              track_name: track.name,
              track_type: 'standard',
              resolved_snapshot_id: track.modified,
              resolved_version: '1.0',
              strategy_used: 'specific_snapshot',
              total_objects_in_source: 0,
              objects_after_filter: 0,
              objects_contributed: 0,
            },
          ],
        },
      },
    });
    const rejected = await api('delete', path, undefined, 409);
    expect(rejected.body.dependent_snapshots).toHaveLength(1);
    await post(`/api/release-tracks/${virtual.id}/meta`, { description: 'new draft' });
    await api(
      'delete',
      `/api/release-tracks/${virtual.id}/snapshots/${encodeURIComponent(virtual.modified)}`,
      undefined,
      409,
    );
  });

  it('does not retire a standard release whose preserved source is missing', async function () {
    await setRole('admin');
    const track = await post(
      '/api/release-tracks/new',
      { name: 'Missing source', type: 'standard' },
      201,
    );
    const base = `/api/release-tracks/${track.id}`;
    const released = await post(`${base}/snapshots/latest/release`, { version: '1.0' });
    await dynamicRepo.deleteSnapshot(track.id, released.release_source_modified);
    const path = `${base}/snapshots/${encodeURIComponent(released.modified)}`;
    await convert(path, '1.0', 409);
    expect((await api('get', path, undefined, 200)).body.version).toBe('1.0');
  });

  it('reports an audit-finalization failure without hiding the persisted mutation', async function () {
    await setRole('admin');
    const track = await post(
      '/api/release-tracks/new',
      { name: 'Track deletion audit finalization failure', type: 'standard' },
      201,
    );

    sinon.stub(auditRepository, 'complete').rejects(new Error('injected audit update failure'));
    const response = await api('delete', `/api/release-tracks/${track.id}`, undefined, 500, {
      confirm_track_id: track.id,
    });
    auditRepository.complete.restore();

    expect(response.body).toMatchObject({
      message: 'Release-track audit recording could not be finalized',
      track_id: track.id,
    });
    expect(response.body.audit_event_id).toEqual(expect.any(String));

    await api('get', `/api/release-tracks/${track.id}/snapshots/latest`, undefined, 404);

    const pendingEvent = await ReleaseTrackAuditEvent.findOne({
      event_id: response.body.audit_event_id,
    })
      .lean()
      .exec();
    expect(pendingEvent).toMatchObject({
      action: 'delete_track',
      track_id: track.id,
      status: 'pending',
    });
    expect(pendingEvent.finished_at).toBeNull();
  });
});
