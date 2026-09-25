'use strict';

const { expect } = require('expect');
const mongoose = require('mongoose');
const schedule = require('node-schedule');

const config = require('../../config/config');
const database = require('../../lib/database-in-memory');
const databaseConfiguration = require('../../lib/database-configuration');
const ReleaseTrackRegistry = require('../../models/release-tracks/release-track-registry-model');
const VirtualTrackScheduleOccurrence = require('../../models/release-tracks/virtual-track-schedule-occurrence-model');
const dynamicRepo = require('../../repository/release-tracks/release-track-dynamic.repository');
const occurrenceRepo = require('../../repository/release-tracks/virtual-track-schedule-occurrence.repository');
const { ReleaseConflictError } = require('../../exceptions');
const releaseTracksService = require('../../services/release-tracks/release-tracks-service');

describe('Scheduled virtual release-track materialization', function () {
  let task;
  let sequence = 0;

  before(async function () {
    config.scheduler.enableScheduler = false;
    config.validateRequests.withAttackDataModel = true;
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();
    task = require('../../scheduler/virtual-track-snapshots-task');
  });

  after(async function () {
    await schedule.gracefulShutdown();
    await database.closeConnection();
  });

  async function createComponent({ released = true } = {}) {
    sequence += 1;
    const component = await releaseTracksService.createTrack({
      name: `Scheduled Component ${sequence}`,
      type: 'standard',
    });
    if (released) {
      await releaseTracksService.releaseLatest(component.id, {
        version: '1.0',
        userAccountId: 'scheduler-test',
      });
    }
    return component;
  }

  async function createVirtual(componentId, snapshotSchedule) {
    sequence += 1;
    return releaseTracksService.createTrack({
      name: `Scheduled Virtual ${sequence}`,
      type: 'virtual',
      composition: {
        component_tracks: [
          {
            track_id: componentId,
            resolution_strategy: 'latest_tagged',
            priority: 1,
          },
        ],
      },
      snapshot_schedule: snapshotSchedule,
      actor: { role: 'admin' },
    });
  }

  async function snapshotCount(trackId) {
    return (await dynamicRepo.getAllSnapshots(trackId)).pagination.total;
  }

  it('recovers missed dates exactly once and records the automation run', async function () {
    const component = await createComponent();
    const scheduledFor = new Date('2026-01-15T12:00:00.000Z');
    const virtual = await createVirtual(component.id, {
      mode: 'dates',
      dates: [scheduledFor.toISOString()],
    });
    const now = new Date('2026-01-15T12:05:00.000Z');

    await task.reconcileSchedules(now);

    expect(await snapshotCount(virtual.id)).toBe(2);
    const materialized = await dynamicRepo.getSnapshotByScheduledMaterialization(
      virtual.id,
      scheduledFor,
    );
    expect(materialized).toMatchObject({
      type: 'virtual',
      scheduled_materialization: {
        schedule_mode: 'dates',
        scheduled_for: scheduledFor,
      },
    });

    const occurrence = await VirtualTrackScheduleOccurrence.findOne({
      track_id: virtual.id,
      scheduled_for: scheduledFor,
    })
      .lean()
      .exec();
    expect(occurrence).toMatchObject({
      status: 'completed',
      attempt_count: 1,
      snapshot_modified: materialized.modified,
    });

    const automationRun = await mongoose.connection
      .getClient()
      .db()
      .collection('automationRuns')
      .findOne({ 'scope.track_id': virtual.id });
    expect(automationRun).toMatchObject({
      automation_type: 'scheduler',
      name: 'virtual-track-snapshot-materialization',
      status: 'completed',
      counts: { materialized: 1, failed: 0 },
    });

    await task.reconcileSchedules(new Date('2026-01-15T12:10:00.000Z'));
    expect(await snapshotCount(virtual.id)).toBe(2);
    expect(
      await mongoose.connection
        .getClient()
        .db()
        .collection('automationRuns')
        .countDocuments({ 'scope.track_id': virtual.id }),
    ).toBe(1);

    const manual = await releaseTracksService.createVirtualSnapshot(virtual.id);
    expect(manual).not.toHaveProperty('scheduled_materialization');
    expect(await snapshotCount(virtual.id)).toBe(3);
  });

  it('materializes every due date while leaving future dates unregistered', async function () {
    const component = await createComponent();
    const firstDue = new Date('2026-03-01T00:00:00.000Z');
    const secondDue = new Date('2026-03-15T12:00:00.000Z');
    const future = new Date('2026-04-01T00:00:00.000Z');
    const virtual = await createVirtual(component.id, {
      mode: 'dates',
      dates: [firstDue.toISOString(), secondDue.toISOString(), future.toISOString()],
    });

    await task.reconcileSchedules(secondDue);

    expect(await snapshotCount(virtual.id)).toBe(3);
    const occurrences = await VirtualTrackScheduleOccurrence.find({
      track_id: virtual.id,
    })
      .sort({ scheduled_for: 1 })
      .lean()
      .exec();
    expect(occurrences).toHaveLength(2);
    expect(occurrences.map((occurrence) => occurrence.scheduled_for)).toEqual([
      firstDue,
      secondDue,
    ]);
    expect(occurrences.every((occurrence) => occurrence.status === 'completed')).toBe(true);
  });

  it('materializes duplicate cron delivery once', async function () {
    const component = await createComponent();
    const virtual = await createVirtual(component.id, {
      mode: 'cron',
      cron: '0 0 1 1,7 *',
    });
    const scheduledFor = new Date('2026-07-01T00:00:00.000Z');

    await Promise.all([
      task.executeCronOccurrence(virtual.id, scheduledFor),
      task.executeCronOccurrence(virtual.id, scheduledFor),
    ]);

    expect(await snapshotCount(virtual.id)).toBe(2);
    expect(
      await VirtualTrackScheduleOccurrence.countDocuments({
        track_id: virtual.id,
        scheduled_for: scheduledFor,
        status: 'completed',
      }),
    ).toBe(1);
  });

  it('applies only saved cron retention on trusted recurring execution, never on manual or date runs', async function () {
    const component = await createComponent();
    const virtual = await createVirtual(component.id, {
      mode: 'cron',
      cron: '0 0 * * *',
      draft_retention: { max_drafts: 2 },
    });
    await releaseTracksService.updateMetadata(virtual.id, { description: 'Count metadata too' });
    await releaseTracksService.createVirtualSnapshot(virtual.id);
    const spoofed = await releaseTracksService.createVirtualSnapshot(virtual.id, {
      scheduledMaterialization: {
        schedule_mode: 'cron',
        scheduled_for: new Date('2026-07-01T00:00:00.000Z'),
      },
    });
    expect(spoofed).not.toHaveProperty('draft_cleanup');
    expect(await snapshotCount(virtual.id)).toBe(4);
    const scheduled = await task.executeCronOccurrence(
      virtual.id,
      new Date('2026-07-02T00:00:00.000Z'),
    );
    expect(scheduled.draft_cleanup).toMatchObject({ status: 'completed', deleted_count: 3 });
    expect(await snapshotCount(virtual.id)).toBe(2);
    const remaining = (await dynamicRepo.getAllSnapshots(virtual.id)).data;
    expect(remaining.map((entry) => entry.modified)).toEqual([
      scheduled.modified,
      spoofed.modified,
    ]);

    const scheduledFor = new Date('2026-07-03T00:00:00.000Z');
    await releaseTracksService.updateSchedule(
      virtual.id,
      { mode: 'dates', dates: [scheduledFor.toISOString()] },
      { role: 'editor' },
    );
    await task.reconcileSchedules(scheduledFor);
    expect(await snapshotCount(virtual.id)).toBe(3);
    const dateSnapshot = await dynamicRepo.getSnapshotByScheduledMaterialization(
      virtual.id,
      scheduledFor,
    );
    expect(dateSnapshot.scheduled_materialization.schedule_mode).toBe('dates');
  });

  it('registers cron tracks in UTC and removes their jobs after track deletion', async function () {
    const component = await createComponent();
    const virtual = await createVirtual(component.id, {
      mode: 'cron',
      cron: '0 0 1 1,7 *',
    });
    const jobName = `virtual-track-snapshot-materialization:${virtual.id}`;

    await task.reconcileSchedules(new Date('2026-07-15T00:00:00.000Z'));

    const job = schedule.scheduledJobs[jobName];
    expect(job).toBeDefined();
    expect(job.pendingInvocations[0].recurrenceRule._tz).toBe('Etc/UTC');

    await releaseTracksService.deleteTrack(virtual.id);
    await task.reconcileSchedules(new Date('2026-07-15T00:01:00.000Z'));

    expect(schedule.scheduledJobs[jobName]).toBeUndefined();
  });

  it('audits component failures and retries them during reconciliation', async function () {
    const component = await createComponent({ released: false });
    const scheduledFor = new Date('2026-02-01T00:00:00.000Z');
    const virtual = await createVirtual(component.id, {
      mode: 'dates',
      dates: [scheduledFor.toISOString()],
    });
    const firstAttempt = new Date('2026-02-01T00:01:00.000Z');

    await task.reconcileSchedules(firstAttempt);

    let occurrence = await VirtualTrackScheduleOccurrence.findOne({
      track_id: virtual.id,
      scheduled_for: scheduledFor,
    })
      .lean()
      .exec();
    expect(occurrence).toMatchObject({
      status: 'failed',
      attempt_count: 1,
      snapshot_modified: null,
    });
    expect(occurrence.last_error.message).toContain('has no tagged snapshots');
    expect(await snapshotCount(virtual.id)).toBe(1);

    await releaseTracksService.releaseLatest(component.id, {
      version: '1.0',
      userAccountId: 'scheduler-test',
    });
    await task.reconcileSchedules(new Date(firstAttempt.getTime() + 60 * 1000));

    occurrence = await VirtualTrackScheduleOccurrence.findOne({
      track_id: virtual.id,
      scheduled_for: scheduledFor,
    })
      .lean()
      .exec();
    expect(occurrence).toMatchObject({
      status: 'completed',
      attempt_count: 2,
    });
    expect(await snapshotCount(virtual.id)).toBe(2);

    const runs = await mongoose.connection
      .getClient()
      .db()
      .collection('automationRuns')
      .find({ 'scope.track_id': virtual.id })
      .sort({ started_at: 1 })
      .toArray();
    expect(runs.map((run) => run.status)).toEqual(['failed', 'completed']);
  });

  it('reclaims an expired occurrence that has not materialized a snapshot', async function () {
    const component = await createComponent();
    const scheduledFor = new Date('2026-05-01T00:00:00.000Z');
    const virtual = await createVirtual(component.id, {
      mode: 'dates',
      dates: [scheduledFor.toISOString()],
    });
    const now = new Date('2026-05-01T00:10:00.000Z');

    await VirtualTrackScheduleOccurrence.create({
      track_id: virtual.id,
      schedule_mode: 'dates',
      scheduled_for: scheduledFor,
      status: 'running',
      attempt_count: 1,
      claimed_at: new Date('2026-05-01T00:00:00.000Z'),
      claim_expires_at: new Date('2026-05-01T00:05:00.000Z'),
    });

    await task.reconcileSchedules(now);

    expect(await snapshotCount(virtual.id)).toBe(2);
    expect(
      await VirtualTrackScheduleOccurrence.findOne({
        track_id: virtual.id,
        scheduled_for: scheduledFor,
      })
        .lean()
        .exec(),
    ).toMatchObject({
      status: 'completed',
      attempt_count: 2,
    });
  });

  it('completes an expired occurrence from its persisted snapshot without recomputing', async function () {
    const component = await createComponent();
    const scheduledFor = new Date('2026-06-01T00:00:00.000Z');
    const virtual = await createVirtual(component.id, {
      mode: 'dates',
      dates: [scheduledFor.toISOString()],
    });

    await VirtualTrackScheduleOccurrence.create({
      track_id: virtual.id,
      schedule_mode: 'dates',
      scheduled_for: scheduledFor,
      status: 'running',
      attempt_count: 1,
      claimed_at: new Date('2026-06-01T00:00:00.000Z'),
      claim_expires_at: new Date('2026-06-01T00:05:00.000Z'),
    });
    const materialized = await releaseTracksService.createVirtualSnapshot(virtual.id, {
      scheduledMaterialization: {
        schedule_mode: 'dates',
        scheduled_for: scheduledFor,
      },
    });
    // Simulate a legacy save/crash before the receipt was durably written.
    await VirtualTrackScheduleOccurrence.updateOne(
      { track_id: virtual.id, scheduled_for: scheduledFor },
      { $set: { snapshot_modified: null } },
    );

    // A persisted scheduled snapshot is the authoritative result. Recovery
    // must not depend on the component still being available.
    await releaseTracksService.deleteTrack(component.id);
    await task.reconcileSchedules(new Date('2026-06-01T00:10:00.000Z'));

    expect(await snapshotCount(virtual.id)).toBe(2);
    expect(
      await VirtualTrackScheduleOccurrence.findOne({
        track_id: virtual.id,
        scheduled_for: scheduledFor,
      })
        .lean()
        .exec(),
    ).toMatchObject({
      status: 'completed',
      attempt_count: 2,
      snapshot_modified: materialized.modified,
    });

    const recoveryRun = await mongoose.connection
      .getClient()
      .db()
      .collection('automationRuns')
      .findOne({
        'scope.track_id': virtual.id,
        status: 'completed',
      });
    expect(recoveryRun).toMatchObject({
      counts: { materialized: 0, recovered: 1, failed: 0 },
    });
  });

  it('recovers a pruned result after save but before completion even after schedule removal', async function () {
    const component = await createComponent();
    const scheduledFor = new Date('2026-08-01T00:00:00.000Z');
    const virtual = await createVirtual(component.id, {
      mode: 'dates',
      dates: [scheduledFor.toISOString()],
    });
    await occurrenceRepo.register(virtual.id, 'dates', scheduledFor);
    await occurrenceRepo.claim(
      virtual.id,
      scheduledFor,
      scheduledFor,
      new Date(scheduledFor.getTime() + 5 * 60 * 1000),
    );
    const materialized = await releaseTracksService.createVirtualSnapshot(virtual.id, {
      scheduledMaterialization: { schedule_mode: 'dates', scheduled_for: scheduledFor },
    });
    expect(await occurrenceRepo.getMaterializationReceipt(virtual.id, scheduledFor)).toMatchObject({
      status: 'running',
      snapshot_modified: materialized.modified,
    });

    await dynamicRepo.deleteSnapshot(virtual.id, materialized.modified);
    await releaseTracksService.deleteTrack(component.id);
    await ReleaseTrackRegistry.updateOne(
      { track_id: virtual.id },
      { $set: { snapshot_schedule: { mode: 'manual' } } },
    );
    await task.reconcileSchedules(new Date(scheduledFor.getTime() + 10 * 60 * 1000));

    expect(await snapshotCount(virtual.id)).toBe(1);
    expect(await occurrenceRepo.getMaterializationReceipt(virtual.id, scheduledFor)).toMatchObject({
      status: 'completed',
      attempt_count: 2,
      snapshot_modified: materialized.modified,
    });
    const db = mongoose.connection.getClient().db();
    const run = await db.collection('automationRuns').findOne({ 'scope.track_id': virtual.id });
    expect(run).toMatchObject({
      status: 'completed',
      counts: { materialized: 0, recovered: 1, failed: 0 },
    });
    const item = await db.collection('automationRunItems').findOne({ run_id: run.run_id });
    expect(item.details).toMatchObject({
      snapshot_modified: materialized.modified,
      materialized_and_removed: true,
      recovered: true,
    });
    expect(item.details).not.toHaveProperty('members_count');
  });

  it('fences stale completion, failure and skip and never replays a completed pruned result', async function () {
    const component = await createComponent();
    const scheduledFor = new Date('2026-09-01T00:00:00.000Z');
    const virtual = await createVirtual(component.id, {
      mode: 'dates',
      dates: [scheduledFor.toISOString()],
    });
    await occurrenceRepo.register(virtual.id, 'dates', scheduledFor);
    const expires = new Date(scheduledFor.getTime() + 5 * 60 * 1000);
    const stale = await occurrenceRepo.claim(virtual.id, scheduledFor, scheduledFor, expires);
    const owner = await occurrenceRepo.claim(
      virtual.id,
      scheduledFor,
      expires,
      new Date(expires.getTime() + 5 * 60 * 1000),
    );
    expect(await occurrenceRepo.fail(stale, { message: 'stale failure' }, expires)).toBeNull();
    expect(await occurrenceRepo.skip(stale, 'stale skip')).toBeNull();

    const materialized = await releaseTracksService.createVirtualSnapshot(virtual.id, {
      scheduledMaterialization: { schedule_mode: 'dates', scheduled_for: scheduledFor },
    });
    expect(await occurrenceRepo.complete(stale)).toBeNull();
    expect(await occurrenceRepo.skip(owner, 'cannot skip saved work')).toBeNull();
    await occurrenceRepo.complete(owner);
    await dynamicRepo.deleteSnapshot(virtual.id, materialized.modified);

    expect(await occurrenceRepo.fail(owner, { message: 'late failure' }, expires)).toBeNull();
    expect(await occurrenceRepo.fail(stale, { message: 'stale failure' }, expires)).toBeNull();
    expect(await occurrenceRepo.skip(stale, 'late skip')).toBeNull();
    expect(await occurrenceRepo.complete(stale)).toBeNull();
    await task.reconcileSchedules(new Date(expires.getTime() + 10 * 60 * 1000));
    expect(await snapshotCount(virtual.id)).toBe(1);
    expect(await occurrenceRepo.getMaterializationReceipt(virtual.id, scheduledFor)).toMatchObject({
      status: 'completed',
      attempt_count: 2,
      snapshot_modified: materialized.modified,
    });
  });

  it('repairs API-originated materialization without a ledger and refuses a different receipt', async function () {
    const component = await createComponent();
    const virtual = await createVirtual(component.id, { mode: 'manual' });
    const scheduledMaterialization = {
      schedule_mode: 'dates',
      scheduled_for: new Date('2026-10-01T00:00:00.000Z'),
    };
    const materialized = await releaseTracksService.createVirtualSnapshot(virtual.id, {
      scheduledMaterialization,
    });
    // Older API-originated metadata did not create an occurrence ledger.
    await VirtualTrackScheduleOccurrence.deleteOne({
      track_id: virtual.id,
      scheduled_for: scheduledMaterialization.scheduled_for,
    });
    expect(
      await occurrenceRepo.getMaterializationReceipt(
        virtual.id,
        scheduledMaterialization.scheduled_for,
      ),
    ).toBeNull();
    await Promise.all([
      occurrenceRepo.recordMaterialization(
        virtual.id,
        scheduledMaterialization,
        materialized.modified,
      ),
      occurrenceRepo.recordMaterialization(
        virtual.id,
        scheduledMaterialization,
        materialized.modified,
      ),
    ]);
    await expect(
      occurrenceRepo.recordMaterialization(
        virtual.id,
        scheduledMaterialization,
        new Date(new Date(materialized.modified).getTime() + 1),
      ),
    ).rejects.toBeInstanceOf(ReleaseConflictError);

    const receipt = await occurrenceRepo.getMaterializationReceipt(
      virtual.id,
      scheduledMaterialization.scheduled_for,
    );
    await dynamicRepo.deleteSnapshot(virtual.id, materialized.modified);
    expect(await task.executeOccurrence(receipt)).toEqual({
      snapshot_modified: materialized.modified,
      materialized_and_removed: true,
    });
    expect(await snapshotCount(virtual.id)).toBe(1);
    expect(
      await occurrenceRepo.getMaterializationReceipt(
        virtual.id,
        scheduledMaterialization.scheduled_for,
      ),
    ).toMatchObject({ status: 'completed', snapshot_modified: materialized.modified });
  });

  it('retains a receipt through audit failure and retries only recovery', async function () {
    const component = await createComponent();
    const scheduledFor = new Date('2026-11-01T00:00:00.000Z');
    const virtual = await createVirtual(component.id, {
      mode: 'dates',
      dates: [scheduledFor.toISOString()],
    });
    await occurrenceRepo.register(virtual.id, 'dates', scheduledFor);
    const claimed = await occurrenceRepo.claim(
      virtual.id,
      scheduledFor,
      scheduledFor,
      new Date(scheduledFor.getTime() + 5 * 60 * 1000),
    );
    const materialized = await releaseTracksService.createVirtualSnapshot(virtual.id, {
      scheduledMaterialization: { schedule_mode: 'dates', scheduled_for: scheduledFor },
    });
    const retryAt = new Date(scheduledFor.getTime() + 60 * 1000);
    await occurrenceRepo.fail(claimed, { message: 'audit unavailable after save' }, retryAt);
    expect(await occurrenceRepo.getMaterializationReceipt(virtual.id, scheduledFor)).toMatchObject({
      status: 'failed',
      snapshot_modified: materialized.modified,
    });
    await dynamicRepo.deleteSnapshot(virtual.id, materialized.modified);
    await task.reconcileSchedules(retryAt);
    expect(await snapshotCount(virtual.id)).toBe(1);
    expect(await occurrenceRepo.getMaterializationReceipt(virtual.id, scheduledFor)).toMatchObject({
      status: 'completed',
      attempt_count: 2,
      snapshot_modified: materialized.modified,
    });
  });

  it('does not schedule or materialize manual tracks', async function () {
    const component = await createComponent();
    const virtual = await createVirtual(component.id, { mode: 'manual' });

    await task.reconcileSchedules(new Date('2027-01-01T00:00:00.000Z'));

    expect(await snapshotCount(virtual.id)).toBe(1);
    expect(await VirtualTrackScheduleOccurrence.countDocuments({ track_id: virtual.id })).toBe(0);
    expect(
      await ReleaseTrackRegistry.findOne({ track_id: virtual.id }).lean().exec(),
    ).toMatchObject({
      snapshot_schedule: { mode: 'manual' },
    });
  });
});
