'use strict';

const request = require('supertest');
const { expect } = require('expect');
const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const service = require('../../../services/release-tracks/release-tracks-service');
const snapshotService = require('../../../services/release-tracks/snapshot-service');
const versioning = require('../../../services/release-tracks/versioning-service');
const cleanup = require('../../../services/release-tracks/draft-cleanup-service');
const manifests = require('../../../services/release-tracks/content-manifest-service');
const bundleHashes = require('../../../services/release-tracks/bundle-hash-service');
const publication = require('../../../services/release-tracks/publication-service');
const dynamicRepo = require('../../../repository/release-tracks/release-track-dynamic.repository');
const registryRepo = require('../../../repository/release-tracks/release-track-registry.repository');
const auditRepo = require('../../../repository/release-tracks/release-track-audit-event.repository');
const occurrenceRepo = require('../../../repository/release-tracks/virtual-track-schedule-occurrence.repository');
const modelFactory = require('../../../models/release-tracks/model-factory');
const {
  ReleaseTrackContentManifest,
  ReleaseTrackContentManifestEntry,
} = require('../../../models/release-tracks/release-track-content-manifest-model');
const { ReleaseConflictError, InsufficientRoleError } = require('../../../exceptions');
const admin = { role: 'admin', user_account_id: 'identity--00000000-0000-4000-8000-000000000901' };
const editor = { ...admin, role: 'editor' };
const iso = (value) => new Date(value).toISOString();

// These tests exercise observable history, exports, recovery, and lock conflicts.
// Faults are restored in finally blocks so the shared API process remains usable.
describe('Virtual draft lifecycle API', function () {
  let app;
  let cookie;
  let fixtureNumber = 0;

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
    const call = request(app)
      [method](path)
      .set('Accept', 'application/json')
      .set('Cookie', `${cookie.name}=${cookie.value}`);
    if (body !== undefined) call.send(body);
    return (await call.expect(status)).body;
  }

  function base(track) {
    return `/api/release-tracks/${track.id}`;
  }
  function selected(track, snapshot) {
    return `${base(track)}/snapshots/${encodeURIComponent(iso(snapshot.modified))}`;
  }
  async function history(track) {
    return api('get', `${base(track)}/snapshots?limit=200&offset=0`);
  }
  async function draft(track, description = 'Draft') {
    return api('post', `${base(track)}/meta`, { description });
  }
  async function policy(track, maximum) {
    return api('put', `${base(track)}/virtual/draft-retention`, { max_drafts: maximum });
  }
  async function preview(track, snapshot) {
    return api('get', `${selected(track, snapshot)}/release/preview`);
  }
  async function squash(track, target, version = '1.0') {
    const reviewed = await preview(track, target);
    return api('post', `${selected(track, target)}/release`, {
      version,
      squash_drafts: true,
      squash_fingerprint: reviewed.draft_squash.fingerprint,
    });
  }

  async function fixture() {
    fixtureNumber += 1;
    const component = await api(
      'post',
      '/api/release-tracks/new',
      { name: `Lifecycle Component ${fixtureNumber}`, type: 'standard' },
      201,
    );
    const composition = {
      component_tracks: [
        { track_id: component.id, resolution_strategy: 'latest_draft', priority: 0 },
      ],
    };
    const track = await api(
      'post',
      '/api/release-tracks/new',
      { name: `Lifecycle Virtual ${fixtureNumber}`, type: 'virtual', composition },
      201,
    );
    const materialized = await api('post', `${base(track)}/virtual/snapshots/create`, {}, 201);
    return { track, materialized, component, composition };
  }

  it('keeps disabled history and changes live policy without creating or deleting a snapshot', async function () {
    const { track } = await fixture();
    await draft(track, 'Unlimited first');
    const latest = await draft(track, 'Unlimited second');
    const before = await history(track);
    expect(before.pagination.total).toBe(4);
    expect((await policy(track, 1)).draft_retention).toEqual({ max_drafts: 1 });
    expect((await history(track)).data.map((entry) => entry.modified)).toEqual(
      before.data.map((entry) => entry.modified),
    );
    const oldView = await api('get', selected(track, track));
    expect(oldView.draft_retention).toEqual({ max_drafts: 1 });
    expect(oldView.snapshot_count).toBe(4);
    expect(oldView.tagged_release_count).toBe(0);
    expect((await api('get', `${base(track)}/config`)).draft_retention).toEqual({ max_drafts: 1 });
    await policy(track, null);
    await draft(track, 'Disabled again');
    expect((await history(track)).pagination.total).toBe(5);
    await policy(track, 1);
    const clone = await api(
      'post',
      `${selected(track, latest)}/clone`,
      { name: `Lifecycle Clone ${fixtureNumber}` },
      201,
    );
    expect((await api('get', `${base(clone)}/snapshots/latest`)).draft_retention).toEqual({
      max_drafts: null,
    });
  });

  it('rejects destructive policy values and enforces administrator authorization in the service', async function () {
    const { track, materialized, component } = await fixture();
    for (const value of [0, -1, 1.5, '10', Number.MAX_SAFE_INTEGER + 1]) {
      await api('put', `${base(track)}/virtual/draft-retention`, { max_drafts: value }, 400);
    }
    await api('put', `${base(component)}/virtual/draft-retention`, { max_drafts: 1 }, 400);
    await expect(cleanup.updatePolicy(track.id, { max_drafts: 1 }, editor)).rejects.toBeInstanceOf(
      InsufficientRoleError,
    );
    await expect(
      service.createTrack({
        name: 'Forbidden Retention',
        type: 'virtual',
        draft_retention: { max_drafts: 1 },
        actor: editor,
      }),
    ).rejects.toBeInstanceOf(InsufficientRoleError);
    await expect(
      versioning.releaseByModified(track.id, materialized.modified, {
        squash_drafts: true,
        actor: editor,
      }),
    ).rejects.toBeInstanceOf(InsufficientRoleError);
    await expect(
      cleanup.retry(track.id, '00000000-0000-4000-8000-000000000902', editor),
    ).rejects.toBeInstanceOf(InsufficientRoleError);
    await api(
      'post',
      `${base(component)}/snapshots/latest/release`,
      { squash_drafts: true, squash_fingerprint: 'not valid' },
      400,
    );
    // Ordinary tagging remains an editor operation, without any destructive opt-in.
    expect(
      (await versioning.releaseByModified(track.id, materialized.modified, { actor: editor }))
        .version,
    ).toBe('1.0');
  });

  it('counts every virtual draft creation cause at N equals one, including quarantine alternatives', async function () {
    const { track, composition } = await fixture();
    await policy(track, 1);
    const writes = [
      () => draft(track, 'Metadata counted'),
      () => api('put', `${base(track)}/config`, { auto_promote: true }),
      () => api('put', `${base(track)}/virtual/composition`, composition),
      () => api('post', `${base(track)}/virtual/snapshots/create`, {}, 201),
      () =>
        api(
          'post',
          `${base(track)}/virtual/snapshots/create`,
          {
            scheduled_materialization: {
              schedule_mode: 'dates',
              scheduled_for: '2030-01-01T00:00:00.000Z',
            },
          },
          201,
        ),
    ];
    for (const write of writes) {
      const created = await write();
      expect(created.draft_cleanup.status).toBe('completed');
      const remaining = await history(track);
      expect(remaining.data.map((entry) => entry.modified)).toEqual([created.modified]);
    }
    const technique = await api(
      'post',
      '/api/techniques',
      {
        workspace: { workflow: { state: 'work-in-progress' } },
        stix: {
          type: 'attack-pattern',
          spec_version: '2.1',
          name: 'Lifecycle Quarantine',
          created: '2026-01-01T00:00:00.000Z',
          modified: '2026-01-01T00:00:00.000Z',
          x_mitre_platforms: ['Windows'],
          x_mitre_is_subtechnique: false,
          kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'persistence' }],
        },
      },
      201,
    );
    const latest = await dynamicRepo.getLatestSnapshot(track.id);
    await modelFactory.getModel(track.id).updateOne(
      { modified: latest.modified },
      {
        $set: {
          quarantine: [
            {
              object_ref: technique.stix.id,
              object_modified: technique.stix.modified,
              source_track_id: composition.component_tracks[0].track_id,
              source_track_name: 'Lifecycle source',
              source_snapshot_version: null,
              conflict_reason: 'Alternative exact revision',
            },
          ],
        },
      },
    );
    const promoted = await api('post', `${base(track)}/virtual/quarantine/promote`, {
      object_ref: technique.stix.id,
      object_modified: technique.stix.modified,
    });
    expect(promoted.creation_cause).toBe('quarantine_promoted');
    expect((await history(track)).data.map((entry) => entry.modified)).toEqual([promoted.modified]);
    const retainedObject = await api(
      'get',
      `/api/techniques/${technique.stix.id}/modified/${technique.stix.modified}`,
    );
    expect(retainedObject.stix.id).toBe(technique.stix.id);
    expect(
      retainedObject.workspace.release_tracks.find((entry) => entry.id === track.id),
    ).toMatchObject({
      type: 'virtual',
      tier: 'members',
    });
  });

  it('keeps ten drafts across release boundaries while tags never consume the count', async function () {
    const { track, materialized } = await fixture();
    const released = await api('post', `${selected(track, materialized)}/release`, {
      version: '1.0',
    });
    await policy(track, 10);
    const drafts = [];
    for (let index = 0; index < 12; index += 1) drafts.push(await draft(track, `Count ${index}`));
    const all = await history(track);
    expect(all.pagination.total).toBe(11);
    expect(
      all.data.filter((entry) => entry.version == null).map((entry) => entry.modified),
    ).toEqual(
      drafts
        .slice(-10)
        .reverse()
        .map((entry) => entry.modified),
    );
    expect(all.data.find((entry) => entry.version === '1.0').modified).toBe(released.modified);
    const latest = await api('get', `${base(track)}/snapshots/latest`);
    expect([latest.snapshot_count, latest.tagged_release_count]).toEqual([11, 1]);
  });

  it('squashes first and historical releases by snapshot chronology, preserving newer history', async function () {
    const { track, materialized } = await fixture();
    const selectedDraft = await draft(track, 'Selected first release');
    const newerDraft = await draft(track, 'Newer draft must survive');
    const laterRelease = await draft(track, 'Tag later first');
    await api('post', `${selected(track, laterRelease)}/release`, { version: '3.0' });
    const reviewed = await preview(track, selectedDraft);
    expect(reviewed.draft_squash).toMatchObject({
      lower_bound: null,
      upper_bound: selectedDraft.modified,
      eligible_count: 2,
      protected_count: 0,
    });
    const first = await squash(track, selectedDraft);
    expect(first.modified).toBe(selectedDraft.modified);
    expect(first.content_manifest_id).toBe(selectedDraft.content_manifest_id);
    expect(first.draft_cleanup).toMatchObject({
      status: 'completed',
      deleted_count: 2,
      release_committed: true,
    });
    expect((await history(track)).data.map((entry) => entry.modified)).toEqual([
      laterRelease.modified,
      newerDraft.modified,
      selectedDraft.modified,
    ]);
    await api('get', selected(track, materialized), undefined, 404);
    const lowerDraft = await dynamicRepo.getSnapshotByModified(track.id, newerDraft.modified);
    expect((await preview(track, lowerDraft)).draft_squash.lower_bound).toBe(
      selectedDraft.modified,
    );
  });

  it('rejects a stale squash preview before any tag or history deletion', async function () {
    const { track, materialized } = await fixture();
    const target = await draft(track, 'Stale target');
    const reviewed = await preview(track, target);
    await api('post', `${selected(track, materialized)}/release`, { version: '1.0' });
    const before = await history(track);
    await api(
      'post',
      `${selected(track, target)}/release`,
      {
        version: '2.0',
        squash_drafts: true,
        squash_fingerprint: reviewed.draft_squash.fingerprint,
      },
      409,
    );
    expect((await history(track)).data).toEqual(before.data);
    expect((await api('get', selected(track, target))).version).toBeNull();
  });

  it('preserves shared manifests and surviving exports, and removes only orphan manifest storage', async function () {
    const { track, materialized } = await fixture();
    const orphanId = track.content_manifest_id;
    const released = await api('post', `${selected(track, materialized)}/release`, {
      version: '1.0',
    });
    const beforeBundle = await api('get', `${selected(track, released)}?format=bundle`);
    const sharedDraft = await draft(track, 'Shares released manifest');
    await policy(track, 1);
    const latest = await draft(track, 'Keep same shared manifest');
    expect(latest.content_manifest_id).toBe(sharedDraft.content_manifest_id);
    expect(await ReleaseTrackContentManifest.exists({ manifest_id: orphanId })).toBeNull();
    expect(await ReleaseTrackContentManifestEntry.countDocuments({ manifest_id: orphanId })).toBe(
      0,
    );
    expect(
      await ReleaseTrackContentManifest.exists({ manifest_id: released.content_manifest_id }),
    ).not.toBeNull();
    expect(await api('get', `${selected(track, released)}?format=bundle`)).toEqual(beforeBundle);
    expect((await api('get', selected(track, released))).bundle_hashes).toEqual(
      released.bundle_hashes,
    );
    const stored = await dynamicRepo.getSnapshotByModified(track.id, latest.modified);
    expect(stored).not.toHaveProperty('draft_cleanup');
    expect(stored).not.toHaveProperty('draft_retention');
  });

  it('skips source-protected excess and secures receipts before removing scheduled drafts', async function () {
    const { track, materialized } = await fixture();
    const released = await api('post', `${selected(track, materialized)}/release`, {
      version: '1.0',
    });
    // Preserve a legacy source pointer even though new virtual releases tag in place.
    await modelFactory
      .getModel(track.id)
      .updateOne(
        { modified: released.modified },
        { $set: { release_source_modified: track.modified } },
      );
    const scheduledFor = '2031-01-01T00:00:00.000Z';
    const scheduled = await api(
      'post',
      `${base(track)}/virtual/snapshots/create`,
      { scheduled_materialization: { schedule_mode: 'dates', scheduled_for: scheduledFor } },
      201,
    );
    await policy(track, 1);
    const latest = await draft(track, 'Receipt backed pruning');
    expect(latest.draft_cleanup.protected_count).toBe(1);
    expect((await history(track)).data.map((entry) => entry.modified)).toEqual([
      latest.modified,
      released.modified,
      track.modified,
    ]);
    expect(
      iso(
        (await occurrenceRepo.getMaterializationReceipt(track.id, scheduledFor)).snapshot_modified,
      ),
    ).toBe(scheduled.modified);
    const conflict = await api(
      'post',
      `${base(track)}/virtual/snapshots/create`,
      { scheduled_materialization: { schedule_mode: 'dates', scheduled_for: scheduledFor } },
      409,
    );
    expect(conflict).toMatchObject({ already_materialized: true, snapshot_removed: true });
    expect((await history(track)).pagination.total).toBe(3);
  });

  it('repairs failed manifest cleanup after retention is disabled without choosing more drafts', async function () {
    const { track } = await fixture();
    await draft(track, 'Second old draft');
    await policy(track, 1);
    const discard = manifests.discardUnreferenced;
    let created;
    try {
      manifests.discardUnreferenced = async () => {
        throw new Error('Injected orphan cleanup failure');
      };
      created = await draft(track, 'Committed draft with deferred cleanup');
    } finally {
      manifests.discardUnreferenced = discard;
    }
    expect(created.draft_cleanup.status).toBe('failed');
    const countBeforeRetry = (await history(track)).pagination.total;
    await policy(track, null);
    const discovered = await api('get', `${base(track)}/virtual/draft-cleanup`);
    expect(discovered.data.map((entry) => entry.operation_id)).toContain(
      created.draft_cleanup.operation_id,
    );
    const repaired = await api(
      'post',
      `${base(track)}/virtual/draft-cleanup/${created.draft_cleanup.operation_id}/retry`,
      {},
    );
    expect(repaired.status).toBe('completed');
    expect((await history(track)).pagination.total).toBe(countBeforeRetry);
    const registry = await registryRepo.findByTrackId(track.id);
    expect(registry.snapshot_count).toBe(countBeforeRetry);
    const snapshots = (await dynamicRepo.getAllSnapshots(track.id)).data;
    const survivingIds = [...new Set(snapshots.map((entry) => entry.content_manifest_id))];
    expect(
      (await ReleaseTrackContentManifest.find({ track_id: track.id }).lean())
        .map((entry) => entry.manifest_id)
        .sort(),
    ).toEqual(survivingIds.sort());
  });

  it('finishes partial release publication through cleanup retry, never a repeated tag', async function () {
    const { track } = await fixture();
    const target = await draft(track, 'Partial publication target');
    const reviewed = await preview(track, target);
    const generate = bundleHashes.generateBundleHashes;
    let failed;
    try {
      bundleHashes.generateBundleHashes = async () => {
        throw new Error('Injected publication failure');
      };
      failed = await api(
        'post',
        `${selected(track, target)}/release`,
        {
          version: '1.0',
          squash_drafts: true,
          squash_fingerprint: reviewed.draft_squash.fingerprint,
        },
        500,
      );
    } finally {
      bundleHashes.generateBundleHashes = generate;
    }
    expect(failed.release_committed).toBe(true);
    expect((await history(track)).pagination.total).toBe(3);
    await api('post', `${selected(track, target)}/release`, { version: '1.0' }, 409);
    const repaired = await api(
      'post',
      `${base(track)}/virtual/draft-cleanup/${failed.operation_id}/retry`,
      {},
    );
    expect(repaired).toMatchObject({
      status: 'completed',
      deleted_count: 2,
      release_committed: true,
    });
    const release = await api('get', selected(track, target));
    expect(release.bundle_hashes).toBeDefined();
    expect(
      release.version_history.filter((entry) => entry.snapshot_id === target.modified),
    ).toHaveLength(1);
    expect((await history(track)).pagination.total).toBe(1);
  });

  it('does not resume a squash against a rolled-back and re-released timestamp', async function () {
    const { track } = await fixture();
    const target = await draft(track, 'Original release identity');
    const remove = dynamicRepo.deleteHistoricalDraft;
    let first;
    try {
      dynamicRepo.deleteHistoricalDraft = async () => {
        throw new Error('Injected deletion failure');
      };
      first = await squash(track, target);
    } finally {
      dynamicRepo.deleteHistoricalDraft = remove;
    }
    expect(first.draft_cleanup).toMatchObject({ status: 'failed', release_committed: true });
    await api('post', `${selected(track, target)}/draft`, { confirm_version: '1.0' });
    await api('post', `${selected(track, target)}/release`, { version: '1.0' });
    const before = await history(track);
    const retry = await api(
      'post',
      `${base(track)}/virtual/draft-cleanup/${first.draft_cleanup.operation_id}/retry`,
      {},
    );
    expect(retry).toMatchObject({ status: 'failed', release_committed: false, deleted_count: 0 });
    expect((await history(track)).data.map((entry) => entry.modified)).toEqual(
      before.data.map((entry) => entry.modified),
    );
  });

  it('narrows a pending squash around a newly inserted tag without crossing it', async function () {
    const { track, materialized } = await fixture();
    const middle = await draft(track, 'New boundary');
    const target = await draft(track, 'Upper boundary');
    const remove = dynamicRepo.deleteHistoricalDraft;
    let released;
    try {
      dynamicRepo.deleteHistoricalDraft = async () => {
        throw new Error('Pause squash');
      };
      released = await squash(track, target, '3.0');
    } finally {
      dynamicRepo.deleteHistoricalDraft = remove;
    }
    await api('post', `${selected(track, middle)}/release`, { version: '2.0' });
    const repaired = await api(
      'post',
      `${base(track)}/virtual/draft-cleanup/${released.draft_cleanup.operation_id}/retry`,
      {},
    );
    expect(repaired.status).toBe('completed');
    expect((await api('get', selected(track, materialized))).version).toBeNull();
    expect((await history(track)).pagination.total).toBe(4);
  });

  it('keeps successful releases when final audit recording fails and retries only repair', async function () {
    const { track } = await fixture();
    const target = await draft(track, 'Audit completion failure');
    const save = auditRepo.saveCleanup;
    let released;
    try {
      auditRepo.saveCleanup = async function (eventId, state, status, error) {
        if (status === 'completed') throw new Error('Injected audit completion failure');
        return save.call(this, eventId, state, status, error);
      };
      released = await squash(track, target);
    } finally {
      auditRepo.saveCleanup = save;
    }
    expect(released.draft_cleanup).toMatchObject({ status: 'failed', deleted_count: 2 });
    expect((await history(track)).pagination.total).toBe(1);
    const repaired = await api(
      'post',
      `${base(track)}/virtual/draft-cleanup/${released.draft_cleanup.operation_id}/retry`,
      {},
    );
    expect(repaired).toMatchObject({ status: 'completed', deleted_count: 2 });
    expect((await api('get', selected(track, target))).bundle_id).toBe(released.bundle_id);
  });

  it('persists a creation-time policy and scheduled API receipts through composition cleanup', async function () {
    const { component, composition } = await fixture();
    const initialScheduled = { schedule_mode: 'dates', scheduled_for: '2032-01-01T00:00:00.000Z' };
    const track = await api(
      'post',
      '/api/release-tracks/new',
      {
        name: `Lifecycle Configured ${fixtureNumber}`,
        type: 'virtual',
        composition,
        draft_retention: { max_drafts: 1 },
        scheduled_materialization: initialScheduled,
      },
      201,
    );
    expect(track.draft_retention).toEqual({ max_drafts: 1 });
    expect(
      iso(
        (await occurrenceRepo.getMaterializationReceipt(track.id, initialScheduled.scheduled_for))
          .snapshot_modified,
      ),
    ).toBe(track.modified);
    const nextScheduled = { schedule_mode: 'dates', scheduled_for: '2032-02-01T00:00:00.000Z' };
    const updated = await api('put', `${base(track)}/virtual/composition`, {
      component_tracks: [
        { track_id: component.id, resolution_strategy: 'latest_draft', priority: 0 },
      ],
      scheduled_materialization: nextScheduled,
    });
    expect((await history(track)).data.map((entry) => entry.modified)).toEqual([updated.modified]);
    expect(
      iso(
        (await occurrenceRepo.getMaterializationReceipt(track.id, nextScheduled.scheduled_for))
          .snapshot_modified,
      ),
    ).toBe(updated.modified);
    await draft(track, 'Remove scheduled composition result');
    await api(
      'put',
      `${base(track)}/virtual/composition`,
      {
        ...composition,
        scheduled_materialization: nextScheduled,
      },
      409,
    );
    expect((await history(track)).pagination.total).toBe(1);
  });

  it('keeps a scheduled candidate when its receipt cannot be durably secured', async function () {
    const { track } = await fixture();
    const scheduledFor = '2033-01-01T00:00:00.000Z';
    const scheduled = await api(
      'post',
      `${base(track)}/virtual/snapshots/create`,
      {
        scheduled_materialization: { schedule_mode: 'dates', scheduled_for: scheduledFor },
      },
      201,
    );
    await policy(track, 1);
    const record = occurrenceRepo.recordMaterialization;
    let latest;
    try {
      occurrenceRepo.recordMaterialization = async () => {
        throw new Error('Receipt store unavailable');
      };
      latest = await draft(track, 'Keep protected scheduled excess');
    } finally {
      occurrenceRepo.recordMaterialization = record;
    }
    expect(latest.draft_cleanup).toMatchObject({ status: 'completed', protected_count: 1 });
    expect((await history(track)).data.map((entry) => entry.modified)).toEqual([
      latest.modified,
      scheduled.modified,
    ]);
  });

  it('retains manifest headers until failed entry deletion can be repaired', async function () {
    const { track } = await fixture();
    const manifestId = track.content_manifest_id;
    const originalEntries = await ReleaseTrackContentManifestEntry.countDocuments({
      manifest_id: manifestId,
    });
    await policy(track, 1);
    const removeEntries = ReleaseTrackContentManifestEntry.deleteMany;
    let latest;
    try {
      ReleaseTrackContentManifestEntry.deleteMany = function (query) {
        if (query.manifest_id === manifestId)
          return {
            exec: async () => {
              throw new Error('Entry deletion unavailable');
            },
          };
        return removeEntries.call(this, query);
      };
      latest = await draft(track, 'Entries first recovery');
    } finally {
      ReleaseTrackContentManifestEntry.deleteMany = removeEntries;
    }
    expect(latest.draft_cleanup.status).toBe('failed');
    expect(await ReleaseTrackContentManifest.exists({ manifest_id: manifestId })).not.toBeNull();
    expect(await ReleaseTrackContentManifestEntry.countDocuments({ manifest_id: manifestId })).toBe(
      originalEntries,
    );
    const repaired = await api(
      'post',
      `${base(track)}/virtual/draft-cleanup/${latest.draft_cleanup.operation_id}/retry`,
      {},
    );
    expect(repaired.status).toBe('completed');
    expect(repaired.error).toBeUndefined();
    expect(await ReleaseTrackContentManifest.exists({ manifest_id: manifestId })).toBeNull();
    expect(await ReleaseTrackContentManifestEntry.countDocuments({ manifest_id: manifestId })).toBe(
      0,
    );
    expect((await history(track)).data.map((entry) => entry.modified)).toEqual([latest.modified]);
  });

  it('deletes nothing when publication fails before tagging and retry never tags implicitly', async function () {
    const { track } = await fixture();
    const target = await draft(track, 'Failed before tag');
    const reviewed = await preview(track, target);
    const freeze = publication.freezePublication;
    let failed;
    try {
      publication.freezePublication = async () => {
        throw new Error('Cannot freeze publication');
      };
      failed = await api(
        'post',
        `${selected(track, target)}/release`,
        {
          squash_drafts: true,
          squash_fingerprint: reviewed.draft_squash.fingerprint,
        },
        500,
      );
    } finally {
      publication.freezePublication = freeze;
    }
    expect(failed.release_committed).toBe(false);
    const retried = await api(
      'post',
      `${base(track)}/virtual/draft-cleanup/${failed.operation_id}/retry`,
      {},
    );
    expect(retried).toMatchObject({ status: 'failed', release_committed: false, deleted_count: 0 });
    expect((await history(track)).pagination.total).toBe(3);
    expect((await api('get', selected(track, target))).version).toBeNull();
  });

  it('repairs persisted draft completion before attempting retention after a counter failure', async function () {
    const { track } = await fixture();
    await policy(track, 1);
    const update = registryRepo.updateByTrackId;
    let created;
    try {
      registryRepo.updateByTrackId = async function (id, values) {
        if (id === track.id && values.snapshot_count !== undefined)
          throw new Error('Counter repair unavailable');
        return update.call(this, id, values);
      };
      created = await draft(track, 'Saved before counters failed');
    } finally {
      registryRepo.updateByTrackId = update;
    }
    expect(created.draft_cleanup.status).toBe('failed');
    expect((await history(track)).pagination.total).toBe(3);
    const repaired = await api(
      'post',
      `${base(track)}/virtual/draft-cleanup/${created.draft_cleanup.operation_id}/retry`,
      {},
    );
    expect(repaired).toMatchObject({ status: 'completed', deleted_count: 2 });
    expect((await api('get', `${base(track)}/snapshots/latest`)).modified).toBe(created.modified);
    expect((await registryRepo.findByTrackId(track.id)).snapshot_count).toBe(1);
  });

  it('serializes materialization and deletion while a metadata writer has read its source', async function () {
    const { track } = await fixture();
    await policy(track, 1);
    const readLatest = snapshotService.getLatestSnapshot;
    let enter;
    let resume;
    const entered = new Promise((resolve) => {
      enter = resolve;
    });
    const paused = new Promise((resolve) => {
      resume = resolve;
    });
    let first = true;
    let writing;
    try {
      snapshotService.getLatestSnapshot = async function (trackId, options) {
        const source = await readLatest(trackId, options);
        if (trackId === track.id && first) {
          first = false;
          enter();
          await paused;
        }
        return source;
      };
      writing = service.updateMetadata(track.id, { description: 'Serialized metadata winner' });
      await entered;
      await expect(service.createVirtualSnapshot(track.id, {})).rejects.toBeInstanceOf(
        ReleaseConflictError,
      );
      await expect(service.deleteTrack(track.id, admin, track.id)).rejects.toBeInstanceOf(
        ReleaseConflictError,
      );
    } finally {
      resume();
      snapshotService.getLatestSnapshot = readLatest;
      if (writing) await writing;
    }
    const latest = await api('get', `${base(track)}/snapshots/latest`);
    expect(latest.description).toBe('Serialized metadata winner');
    expect((await history(track)).data.map((entry) => entry.modified)).toEqual([latest.modified]);
    expect((await api('get', `${selected(track, latest)}?format=bundle`)).type).toBe('bundle');
  });

  it('locks every virtual source read against deletion and refuses an expired cleanup lease', async function () {
    const { track, composition } = await fixture();
    const before = (await history(track)).pagination.total;
    await versioning.withReleaseLock(track.id, async (lease) => {
      const competing = [
        () => service.updateMetadata(track.id, { description: 'blocked' }),
        () => service.updateConfig(track.id, { auto_promote: true }),
        () => service.updateComposition(track.id, composition),
        () => service.createVirtualSnapshot(track.id, {}),
        () =>
          service.promoteQuarantinedObject(track.id, {
            object_ref: 'attack-pattern--00000000-0000-4000-8000-000000000903',
            object_modified: new Date(),
          }),
        () => snapshotService.cloneTrack(track.id, { name: 'Blocked clone' }),
        () =>
          snapshotService.cloneFromSnapshot(track.id, track.modified, {
            name: 'Blocked exact clone',
          }),
        () => service.deleteTrack(track.id, admin, track.id),
      ];
      for (const operation of competing)
        await expect(operation()).rejects.toBeInstanceOf(ReleaseConflictError);
      await registryRepo.model.updateOne(
        { track_id: track.id },
        { $set: { 'release_lock.acquired_at': new Date(0) } },
      );
      await expect(lease.assertOwned()).rejects.toBeInstanceOf(ReleaseConflictError);
    });
    expect((await history(track)).pagination.total).toBe(before);
  });
});
