'use strict';

const request = require('supertest');
const { expect } = require('expect');

const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const ReleaseTrackRegistry = require('../../../models/release-tracks/release-track-registry-model');
const releaseTracksService = require('../../../services/release-tracks/release-tracks-service');
const { InsufficientRoleError } = require('../../../exceptions');
const editor = { role: 'editor' };

describe('Virtual release-track snapshot schedule validation API', function () {
  let app;
  let passportCookie;
  let createSequence = 0;

  before(async function () {
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();

    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;

    app = await require('../../../index').initializeApp();
    passportCookie = await login.loginAnonymous(app);
  });

  async function createTrack(snapshotSchedule, status = 201, type = 'virtual') {
    createSequence += 1;
    const name = `Schedule Validation ${createSequence}`;
    const response = await request(app)
      .post('/api/release-tracks/new')
      .send({
        name,
        type,
        snapshot_schedule: snapshotSchedule,
      })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(status);
    return { name, body: response.body };
  }

  async function getRegistryTrack(search) {
    const response = await request(app)
      .get('/api/release-tracks')
      .query({ search })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200);
    return response.body.data[0];
  }

  async function updateSchedule(trackId, snapshotSchedule, status = 200) {
    return request(app)
      .put(`/api/release-tracks/${trackId}/virtual/schedule`)
      .send(snapshotSchedule)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(status);
  }

  it('accepts and persists the fields defined by each schedule mode', async function () {
    const schedules = [
      { mode: 'manual' },
      { mode: 'cron', cron: '0 0 1 1,7 *' },
      { mode: 'cron', cron: '0 0 * * *', draft_retention: { max_drafts: 10 } },
      {
        mode: 'dates',
        dates: ['2027-01-15T00:00:00.000Z', '2027-07-15T00:00:00.000Z'],
      },
    ];

    for (const schedule of schedules) {
      const created = await createTrack(schedule);
      const registryTrack = await getRegistryTrack(created.name);
      expect(registryTrack.snapshot_schedule).toEqual(schedule);
    }
  });

  it('updates a virtual track schedule without creating a snapshot', async function () {
    const created = await createTrack({ mode: 'manual' });
    const trackId = created.body.id;
    const schedule = { mode: 'cron', cron: '15 9 * * 1,3' };

    const response = await updateSchedule(trackId, schedule);

    expect(response.body.snapshot_schedule).toEqual(schedule);
    const registryTrack = await getRegistryTrack(created.name);
    expect(registryTrack.snapshot_schedule).toEqual(schedule);
    expect(registryTrack.snapshot_count).toBe(1);
  });

  it('returns the current registry schedule with workbench snapshots', async function () {
    const created = await createTrack({ mode: 'manual' });
    const schedule = {
      mode: 'dates',
      dates: ['2027-01-15T09:30:00.000Z', '2027-07-15T09:30:00.000Z'],
    };
    await updateSchedule(created.body.id, schedule);

    const response = await request(app)
      .get(`/api/release-tracks/${created.body.id}/snapshots/latest`)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200);

    expect(response.body.snapshot_schedule).toEqual(schedule);
  });

  it('replaces schedule mode fields instead of retaining stale selectors', async function () {
    const created = await createTrack({ mode: 'cron', cron: '0 0 * * *' });

    const response = await updateSchedule(created.body.id, { mode: 'manual' });

    expect(response.body.snapshot_schedule).toEqual({ mode: 'manual' });
    expect(await getRegistryTrack(created.name)).toEqual(
      expect.objectContaining({ snapshot_schedule: { mode: 'manual' } }),
    );
  });

  it('rejects invalid updates and schedule updates on standard tracks', async function () {
    const virtual = await createTrack({ mode: 'manual' });
    const standard = await createTrack(undefined, 201, 'standard');

    await updateSchedule(virtual.body.id, { mode: 'cron' }, 400);
    await updateSchedule(virtual.body.id, { mode: 'manual', cron: '0 0 * * *' }, 400);
    await updateSchedule(standard.body.id, { mode: 'manual' }, 400);
    await updateSchedule(
      'release-track--11111111-1111-4111-8111-111111111111',
      {
        mode: 'manual',
      },
      404,
    );

    expect(() => releaseTracksService.updateSchedule(virtual.body.id, { mode: 'cron' })).toThrow();
  });

  it('allows editor timing edits but requires admin for every changed cron retention threshold', async function () {
    const created = await createTrack({
      mode: 'cron',
      cron: '0 0 * * *',
      draft_retention: { max_drafts: 10 },
    });
    const trackId = created.body.id;
    const changedTiming = {
      mode: 'cron',
      cron: '30 1 * * *',
      draft_retention: { max_drafts: 10 },
    };
    await releaseTracksService.updateSchedule(trackId, changedTiming, editor);
    expect((await getRegistryTrack(created.name)).snapshot_schedule).toEqual(changedTiming);
    for (const draftRetention of [{ max_drafts: 1 }, { max_drafts: null }, undefined]) {
      await expect(
        releaseTracksService.updateSchedule(
          trackId,
          { mode: 'cron', cron: changedTiming.cron, draft_retention: draftRetention },
          editor,
        ),
      ).rejects.toBeInstanceOf(InsufficientRoleError);
    }
    expect((await getRegistryTrack(created.name)).snapshot_schedule).toEqual(changedTiming);
    await releaseTracksService.updateSchedule(
      trackId,
      { mode: 'dates', dates: ['2030-01-01T00:00:00.000Z'] },
      editor,
    );
    await expect(
      releaseTracksService.updateSchedule(trackId, changedTiming, editor),
    ).rejects.toBeInstanceOf(InsufficientRoleError);
    await releaseTracksService.updateSchedule(trackId, { mode: 'manual' }, editor);
    const registry = await getRegistryTrack(created.name);
    expect(registry.snapshot_schedule).toEqual({ mode: 'manual' });
    expect(registry.snapshot_count).toBe(1);
  });

  it('rejects fields that do not apply to manual schedules', async function () {
    const invalidSchedules = [
      { mode: 'manual', cron: '0 0 1 1,7 *' },
      { mode: 'manual', dates: ['2027-01-15T00:00:00.000Z'] },
      { mode: 'manual', unexpected: true },
      { mode: 'manual', draft_retention: { max_drafts: 1 } },
    ];

    for (const schedule of invalidSchedules) {
      await createTrack(schedule, 400);
    }
  });

  it('requires cron and rejects dates for cron schedules', async function () {
    const invalidSchedules = [
      { mode: 'cron' },
      {
        mode: 'cron',
        cron: '0 0 1 1,7 *',
        dates: ['2027-01-15T00:00:00.000Z'],
      },
      { mode: 'cron', cron: '0 0 1 1,7 * 2027' },
    ];

    for (const schedule of invalidSchedules) {
      await createTrack(schedule, 400);
    }
  });

  it('requires non-empty dates and rejects cron for dates schedules', async function () {
    const invalidSchedules = [
      { mode: 'dates' },
      { mode: 'dates', dates: [] },
      {
        mode: 'dates',
        dates: ['2027-01-15T00:00:00.000Z'],
        cron: '0 0 1 1,7 *',
      },
      {
        mode: 'dates',
        dates: ['2027-01-15T00:00:00.000Z'],
        draft_retention: { max_drafts: 1 },
      },
    ];

    for (const schedule of invalidSchedules) {
      await createTrack(schedule, 400);
    }
  });

  it('rejects snapshot schedules on standard tracks', async function () {
    await createTrack({ mode: 'manual' }, 400, 'standard');
  });

  it('repeats schedule validation for non-HTTP service callers', async function () {
    const registryCountBefore = await ReleaseTrackRegistry.countDocuments();

    const invalidTracks = [
      {
        name: 'Invalid Service Schedule',
        type: 'virtual',
        snapshot_schedule: { mode: 'cron' },
      },
      {
        name: 'Invalid Standard Service Schedule',
        type: 'standard',
        snapshot_schedule: { mode: 'manual' },
      },
    ];

    for (const track of invalidTracks) {
      await expect(releaseTracksService.createTrack(track)).rejects.toThrow();
    }

    expect(await ReleaseTrackRegistry.countDocuments()).toBe(registryCountBefore);
  });

  it('repeats mode validation at the persistence boundary', async function () {
    const invalidRegistries = [
      {
        type: 'virtual',
        name: 'Invalid Persistence Schedule',
        snapshot_schedule: {
          mode: 'manual',
          cron: '0 0 1 1,7 *',
        },
      },
      {
        type: 'standard',
        name: 'Invalid Standard Persistence Schedule',
        snapshot_schedule: {
          mode: 'manual',
        },
      },
    ];

    for (const invalidRegistry of invalidRegistries) {
      const registry = new ReleaseTrackRegistry({
        track_id: 'release-track--11111111-1111-4111-8111-111111111111',
        created_at: new Date(),
        updated_at: new Date(),
        ...invalidRegistry,
      });
      await expect(registry.validate()).rejects.toThrow();
    }
  });
});
