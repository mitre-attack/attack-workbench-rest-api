'use strict';

const { expect } = require('expect');
const sinon = require('sinon');
const mongoose = require('mongoose');
const request = require('supertest');
const { randomUUID } = require('crypto');
const database = require('../../../lib/database-in-memory');
const configuration = require('../../../lib/database-configuration');
const config = require('../../../config/config');
const policy = require('../../../services/system/validation-policy-service');
const operation = require('../../../services/system/validation-operation-service');
const diagnostics = require('../../../services/system/validation-diagnostic-service');
const worker = require('../../../services/system/validation-reconciliation-service');
const repository = require('../../../repository/validation-policy-repository');
const rules = require('../../../repository/validation-bypasses-repository');
const Model = require('../../../models/attack-object-model');
const Relationship = require('../../../models/relationship-model');
const BaseService = require('../../../services/meta-classes/base.service');
const login = require('../../shared/login');
const scheduler = require('../../../scheduler/validate-objects-task');
const originalConfig = {
  adm: config.validateRequests.withAttackDataModel,
  openapi: config.validateRequests.withOpenApi,
  scheduler: config.scheduler.enableScheduler,
};
const service = new BaseService(null, null);
const malformed = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  stix: { type: 'tool', id: `tool--${randomUUID()}`, modified: new Date(), name: 42, ...overrides },
  workspace: { workflow: { state: 'reviewed' } },
});
const dropExemptions = () =>
  repository.mutateRules((current) => ({
    rules: current.filter((r) => r.kind !== 'object-exemption'),
  }));

async function stored(data) {
  await Model.collection.insertOne(data);
  return data;
}

describe('Validation publication and durable reconciliation', function () {
  before(async () => {
    await database.initializeConnection();
  });
  beforeEach(async () => {
    config.validateRequests.withAttackDataModel = true;
    config.scheduler.enableScheduler = false;
    await Promise.all([
      repository.model.deleteMany({}),
      Model.deleteMany({}),
      Relationship.deleteMany({}),
    ]);
    await policy.initialize();
  });
  afterEach(async () => {
    sinon.restore();
    await worker.stop();
  });
  after(async () => {
    await database.closeConnection();
    config.validateRequests.withAttackDataModel = originalConfig.adm;
    config.validateRequests.withOpenApi = originalConfig.openapi;
    config.scheduler.enableScheduler = originalConfig.scheduler;
  });

  const Group = require('../../../models/group-model');
  const BaseRepository = require('../../../repository/_base.repository');
  const groupRepository = new BaseRepository(Group);
  const recoverableGroup = () => ({
    stix: {
      type: 'intrusion-set',
      id: `intrusion-set--${randomUUID()}`,
      name: 'Retired malformed revision',
      created: new Date(),
      modified: new Date(),
      spec_version: '2.1',
      x_mitre_deprecated: true,
      x_mitre_domains: ['invalid-domain'],
    },
    workspace: { workflow: { state: 'reviewed' } },
  });

  it('recovers an old-snapshot insert after the new policy scan completed', async () => {
    let inserted;
    await operation.run(async () => {
      const data = recoverableGroup();
      expect((await service.validateComposedObject(data)).outcome).toBe('exempt');
      await dropExemptions();
      expect((await worker.runOnce()).status).toBe('completed');
      inserted = await groupRepository.save(data);
    });
    let current = await Model.collection.findOne({ _id: inserted._id });
    expect(current.workspace.evaluation_needed).toBe(true);
    expect(current.workspace.evaluation_context).toBeUndefined();
    expect((await worker.runOnce()).status).toBe('completed');
    current = await Model.collection.findOne({ _id: inserted._id });
    expect(current.workspace.evaluation_needed).toBeUndefined();
    expect(current.workspace.evaluation_context.outcome).toBe('invalid');
    expect(current.workspace.validation.errors.length).toBeGreaterThan(0);
  });

  it('keeps bulk persistence errors indexed and publishes valid neighbors with string or Date timestamps', async () => {
    const invalid = recoverableGroup();
    invalid.stix.modified = 'not-a-date';
    const stringDate = recoverableGroup();
    stringDate.stix.modified = stringDate.stix.modified.toISOString();
    const date = recoverableGroup();
    await operation.run(async () => {
      for (const data of [invalid, stringDate, date]) {
        expect((await service.validateComposedObject(data)).outcome).toBe('exempt');
      }
      const result = await groupRepository.saveMany([invalid, stringDate, date]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ index: 0, code: 'ValidationError' });
      expect(result.errors[0].message).toContain('stix.modified');
      expect(result.inserted.map((document) => document.stix.id)).toEqual([
        stringDate.stix.id,
        date.stix.id,
      ]);
      expect(await Model.collection.findOne({ 'stix.id': invalid.stix.id })).toBeNull();
      for (const document of result.inserted) {
        const current = await Model.collection.findOne({ _id: document._id });
        expect(current.workspace.evaluation_context.outcome).toBe('exempt');
        expect(current.workspace.evaluation_needed).toBeUndefined();
        expect(document.workspace.evaluation_context.outcome).toBe('exempt');
      }
    });
  });

  it('recovers an interrupted bulk insert publication across worker restart with scheduler off', async () => {
    expect(config.scheduler.enableScheduler).toBe(false);
    expect((await worker.runOnce()).status).toBe('completed');
    const data = recoverableGroup();
    const publish = sinon
      .stub(groupRepository, 'publishInsertedValidation')
      .rejects(new Error('process interrupted'));
    await expect(
      operation.run(async () => {
        await service.validateComposedObject(data);
        await groupRepository.saveMany([data]);
      }),
    ).rejects.toThrow('process interrupted');
    publish.restore();
    let current = await Model.collection.findOne({ 'stix.id': data.stix.id });
    expect(current.workspace.evaluation_needed).toBe(true);
    expect(current.workspace.evaluation_context).toBeUndefined();
    await worker.stop();
    // A fresh module instance has no in-memory knowledge of the interrupted write.
    const modulePath =
      require.resolve('../../../services/system/validation-reconciliation-service');
    delete require.cache[modulePath];
    const restarted = require(modulePath);
    await restarted.start({ pollMs: 5 });
    try {
      for (let attempt = 0; attempt < 200; attempt++) {
        current = await Model.collection.findOne({ 'stix.id': data.stix.id });
        if (!current.workspace.evaluation_needed) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(current.workspace.evaluation_needed).toBeUndefined();
      expect(current.workspace.evaluation_context.outcome).toBe('exempt');
      expect(current.workspace.validation).toBeUndefined();
    } finally {
      await restarted.stop();
    }
  });

  it('requires explicit initialization and rejects engine mismatch without fallback', async () => {
    await repository.model.deleteMany({});
    await expect(service.validateComposedObject(malformed())).rejects.toThrow(
      'not been initialized',
    );
    expect(await repository.readPolicy()).toBeNull();
    await policy.initialize();
    await repository.model.collection.updateOne(
      {},
      { $set: { 'engine_context.evaluator_version': 'future' } },
    );
    await expect(operation.run(() => true)).rejects.toThrow();
    await expect(worker.claim()).rejects.toThrow();
  });

  it('holds one immutable snapshot and collects outcomes despite a policy edit mid-operation', async () => {
    const observed = [];
    await operation.run(
      async ({ snapshot }) => {
        expect(Object.isFrozen(snapshot.rules)).toBe(true);
        expect((await service.validateComposedObject(malformed({ revoked: true }))).outcome).toBe(
          'exempt',
        );
        await dropExemptions();
        expect((await service.validateComposedObject(malformed({ revoked: true }))).outcome).toBe(
          'exempt',
        );
      },
      { collector: (item) => observed.push(item) },
    );
    expect(observed).toHaveLength(2);
    expect(observed[0].snapshot).toBe(observed[1].snapshot);
    expect((await service.validateComposedObject(malformed({ revoked: true }))).outcome).toBe(
      'invalid',
    );
  });

  it('strictly validates retired imports after removal and preserves fail-open error recording', async () => {
    expect(
      (await service.composeForImport(malformed({ revoked: true }), { validateContents: true }))
        .throwIfValidating,
    ).toBeNull();
    await dropExemptions();
    const strict = await service.composeForImport(malformed({ revoked: true }), {
      validateContents: true,
    });
    expect(strict.throwIfValidating).not.toBeNull();
    const open = await service.composeForImport(malformed({ revoked: true }), {
      validateContents: false,
    });
    expect(open.throwIfValidating).toBeNull();
    expect(open.data.workspace.validation.errors.length).toBeGreaterThan(0);
    expect(open.data.workspace.evaluation_context.outcome).toBe('invalid');
  });

  it('records disabled and unsupported separately from conformance and strips client markers', async () => {
    config.validateRequests.withAttackDataModel = false;
    const data = malformed({ revoked: true });
    data.workspace.evaluation_context = { outcome: 'valid', publication_token: 999999 };
    const result = await service.composeForImport(data, {});
    expect(result.data.workspace.evaluation_context.outcome).toBe('disabled');
    expect(result.data.workspace.evaluation_context.publication_token).not.toBe(999999);
    expect(
      (await service.validateComposedObject(malformed({ type: 'unknown' }), { enabled: true }))
        .outcome,
    ).toBe('unsupported');
  });

  it('fences older same-policy errors and successful clears, changed input and workflow', async () => {
    const document = await stored(malformed());
    const snapshot = await policy.loadSnapshot();
    const oldToken = await repository.allocatePublicationToken(snapshot);
    const newToken = await repository.allocatePublicationToken(snapshot);
    const invalid = policy.evaluateObject(document, snapshot);
    const publish = (result, publicationToken, observed = document) =>
      diagnostics.publish({ model: Model, document: observed, result, snapshot, publicationToken });
    expect(await publish(invalid, newToken)).toBe(true);
    expect(await publish({ outcome: 'valid', errors: [] }, oldToken)).toBe(false);
    expect(
      await publish(
        { outcome: 'invalid', errors: [{ message: 'old', path: [], code: 'old' }] },
        oldToken,
      ),
    ).toBe(false);
    await Model.collection.updateOne(
      { _id: document._id },
      { $set: { 'workspace.workflow.state': 'work-in-progress' } },
    );
    expect(await publish(invalid, newToken + 1)).toBe(false);
    await Model.collection.updateOne(
      { _id: document._id },
      { $set: { 'workspace.workflow.state': 'reviewed', 'stix.name': 'changed' } },
    );
    expect(await publish(invalid, newToken + 2)).toBe(false);
  });

  it('replaces changed error contents even when issue count is unchanged', async () => {
    const document = await stored(malformed());
    const snapshot = await policy.loadSnapshot();
    for (const message of ['first message', 'different message']) {
      const publicationToken = await repository.allocatePublicationToken(snapshot);
      await diagnostics.publish({
        model: Model,
        document,
        snapshot,
        publicationToken,
        result: { outcome: 'invalid', errors: [{ message, path: ['name'], code: 'invalid_type' }] },
      });
    }
    expect(
      (await Model.collection.findOne({ _id: document._id })).workspace.validation.errors[0]
        .message,
    ).toBe('different message');
  });

  it('runs full historical scans independently of request and scheduler toggles, preserving content/history', async () => {
    config.validateRequests.withAttackDataModel = false;
    const document = malformed({ revoked: true });
    document.workspace.import_categories = { errors: [{ error_message: 'historic import error' }] };
    document.workspace.validation = { errors: [{ message: 'old', code: 'old', path: [] }] };
    await stored(document);
    const active = await stored(malformed());
    const relationship = {
      ...malformed({ type: 'relationship', revoked: true }),
      _id: new mongoose.Types.ObjectId(),
    };
    await Relationship.collection.insertOne(relationship);
    expect((await worker.runOnce({ batchSize: 1 })).status).toBe('completed');
    let result = await Model.collection.findOne({ _id: document._id });
    expect(result.stix).toEqual(document.stix);
    expect(result.workspace.workflow).toEqual(document.workspace.workflow);
    expect(result.workspace.import_categories).toEqual(document.workspace.import_categories);
    expect(result.workspace.validation).toBeUndefined();
    expect(result.workspace.evaluation_context.outcome).toBe('exempt');
    expect((await worker.status()).progress).toEqual({ processed: 3, total: 3 });
    expect(
      (await Model.collection.findOne({ _id: active._id })).workspace.validation.errors.length,
    ).toBeGreaterThan(0);
    await dropExemptions();
    await scheduler.validateObjects();
    result = await Model.collection.findOne({ _id: document._id });
    expect(result.workspace.evaluation_context.outcome).toBe('invalid');
  });

  for (const slowStage of ['counting', 'publication']) {
    it(`keeps its lease while ${slowStage} takes longer than 30 seconds`, async () => {
      const document = await stored(malformed({ revoked: true }));
      const clock = sinon.useFakeTimers({
        now: Date.now(),
        toFake: ['Date', 'setInterval', 'clearInterval'],
      });
      const renewals = [];
      const renew = repository.renewReconciliation;
      sinon.stub(repository, 'renewReconciliation').callsFake((...args) => {
        const renewal = renew(...args);
        renewals.push(renewal);
        return renewal;
      });
      const slow = async () => {
        for (let step = 0; step < 4; step++) {
          await clock.tickAsync(10000);
          await Promise.all(renewals);
        }
      };
      if (slowStage === 'counting') {
        const revisions = require('../../../repository/validation-diagnostics-repository');
        const count = revisions.countAll;
        sinon.stub(revisions, 'countAll').callsFake(async () => {
          const total = await count();
          await slow();
          return total;
        });
      } else {
        const publish = diagnostics.publish;
        sinon.stub(diagnostics, 'publish').callsFake(async (options) => {
          await slow();
          return publish(options);
        });
      }
      expect((await worker.runOnce()).status).toBe('completed');
      expect((await worker.status()).progress).toEqual({ processed: 1, total: 1 });
      expect(
        (await Model.collection.findOne({ _id: document._id })).workspace.evaluation_context
          .outcome,
      ).toBe('exempt');
      expect(clock.countTimers()).toBe(0);
    });
  }

  for (const interrupted of ['renewal failure', 'policy replacement']) {
    it(`stops its heartbeat and preserves durable state after ${interrupted}`, async () => {
      const clock = sinon.useFakeTimers({
        now: Date.now(),
        toFake: ['Date', 'setInterval', 'clearInterval'],
      });
      const revisions = require('../../../repository/validation-diagnostics-repository');
      if (interrupted === 'renewal failure') {
        const renew = repository.renewReconciliation;
        sinon
          .stub(repository, 'renewReconciliation')
          .onFirstCall()
          .callsFake(renew)
          .onSecondCall()
          .rejects(new Error('injected heartbeat failure'));
      }
      sinon.stub(revisions, 'countAll').callsFake(async () => {
        if (interrupted === 'policy replacement') await dropExemptions();
        await clock.tickAsync(10000);
        return 0;
      });
      if (interrupted === 'renewal failure') {
        await expect(worker.runOnce()).rejects.toThrow('injected heartbeat failure');
        const status = await worker.status();
        expect(status.status).toBe('failed');
        expect(status.last_error.message).toBe('injected heartbeat failure');
      } else {
        expect((await worker.runOnce()).status).toBe('superseded');
        expect((await worker.status()).status).toBe('pending');
      }
      expect(clock.countTimers()).toBe(0);
    });
  }

  it('resumes checkpointed expired claims and rejects the old claimant', async () => {
    await stored(malformed());
    await stored(malformed());
    const first = await worker.claim();
    expect((await worker.processClaim(first, { batchSize: 1, maxBatches: 1 })).status).toBe(
      'running',
    );
    expect((await worker.status()).progress.processed).toBe(1);
    await repository.model.collection.updateOne(
      {},
      { $set: { 'reconciliation.lease_expires_at': new Date(0) } },
    );
    const resumed = await worker.claim({ owner: 'restarted process' });
    expect(resumed.publicationToken).toBeGreaterThan(first.publicationToken);
    expect((await worker.processClaim(first)).status).toBe('superseded');
    expect((await worker.processClaim(resumed)).status).toBe('completed');
    expect((await worker.status()).progress).toEqual({ processed: 2, total: 2 });
  });

  it('supersedes old generations and restarts full scans after rule and engine changes', async () => {
    await stored(malformed({ revoked: true }));
    const old = await worker.claim();
    await dropExemptions();
    expect((await worker.processClaim(old)).status).toBe('superseded');
    expect((await worker.status()).checkpoint).toBeNull();
    await worker.runOnce();
    const before = await policy.loadSnapshot();
    await repository.model.collection.updateOne(
      {},
      { $set: { 'engine_context.evaluator_version': 'previous' } },
    );
    await policy.initialize({ activateEngine: true });
    const after = await policy.loadSnapshot();
    expect(after.policy_revision).toBe(before.policy_revision);
    expect(after.evaluation_generation).toBe(before.evaluation_generation + 1);
    expect((await worker.status()).status).toBe('pending');
  });

  it('persists failure and retries from durable checkpoint without exposing claim tokens', async () => {
    await stored(malformed());
    const stub = sinon
      .stub(diagnostics, 'publish')
      .rejects(new Error('injected diagnostic failure'));
    await expect(worker.runOnce()).rejects.toThrow('injected diagnostic failure');
    const status = await worker.status();
    expect(status.status).toBe('failed');
    expect(status.last_error.message).toBe('injected diagnostic failure');
    expect(status.claim_token).toBeUndefined();
    stub.restore();
    expect((await worker.retry()).status).toBe('pending');
    await worker.start({ pollMs: 5 });
    for (let i = 0; i < 100 && (await worker.status()).status !== 'completed'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await worker.stop();
    expect((await worker.status()).status).toBe('completed');
  });

  it('reevaluates an input changed during a worker publication attempt', async () => {
    const document = await stored(malformed());
    const publish = diagnostics.publish;
    let changed = false;
    sinon.stub(diagnostics, 'publish').callsFake(async (args) => {
      if (!changed) {
        changed = true;
        await Model.collection.updateOne(
          { _id: document._id },
          {
            $set: {
              'stix.name': 'Now valid partial tool',
              'workspace.workflow.state': 'work-in-progress',
            },
          },
        );
      }
      return publish(args);
    });
    await worker.runOnce();
    const current = await Model.collection.findOne({ _id: document._id });
    expect(current.workspace.evaluation_context.workflow_state).toBe('work-in-progress');
    expect(current.workspace.evaluation_context.outcome).toBe('valid');
  });

  it('hides stale diagnostics and never edits historical import reports in projections', async () => {
    const data = malformed({ revoked: true });
    data.workspace.validation = { errors: [{ message: 'stale' }] };
    data.workspace.import_categories = { errors: [{ message: 'historical' }] };
    diagnostics.project(data, await policy.loadSnapshot());
    expect(data.workspace.validation).toBeUndefined();
    expect(data.workspace.import_categories.errors).toEqual([{ message: 'historical' }]);
  });
});

describe('Retired validation HTTP operations', function () {
  let app, cookie, baseline;
  before(async () => {
    await database.initializeConnection();
    await configuration.checkSystemConfiguration();
    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;
    app = await require('../../../index').initializeApp();
    cookie = await login.loginAnonymous(app);
    baseline = (await repository.readPolicy()).rules;
  });
  beforeEach(async () => {
    await repository.mutateRules(() => ({ rules: baseline }));
  });
  afterEach(() => sinon.restore());
  after(async () => {
    await database.closeConnection();
    config.validateRequests.withAttackDataModel = originalConfig.adm;
    config.validateRequests.withOpenApi = originalConfig.openapi;
    config.scheduler.enableScheduler = originalConfig.scheduler;
  });
  const call = (method, url, body) =>
    request(app)[method](url).set('Cookie', `${cookie.name}=${cookie.value}`).send(body);
  const group = () => ({
    workspace: {
      workflow: { state: 'reviewed' },
      evaluation_context: { outcome: 'valid', publication_token: 999999 },
    },
    stix: {
      type: 'intrusion-set',
      id: `intrusion-set--${randomUUID()}`,
      name: 'Retired invalid group',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      spec_version: '2.1',
      x_mitre_domains: ['invalid-domain'],
      x_mitre_deprecated: true,
    },
  });

  it('preserves model validation, strictness and casting for exempt PUT with OpenAPI disabled', async () => {
    const created = (await call('post', '/api/groups', group()).expect(201)).body;
    const path = `/api/groups/${created.stix.id}/modified/${created.stix.modified}`;
    config.validateRequests.withOpenApi = false;
    try {
      await call('put', path, {
        stix: created.stix,
        workspace: { workflow: { state: 'not-a-real-workflow' } },
      }).expect(500);
      let stored = await Model.collection.findOne({ 'stix.id': created.stix.id });
      expect(stored.workspace.workflow.state).toBe('reviewed');
      const date = '2026-01-02T03:04:05.000Z';
      await call('put', path, {
        stix: created.stix,
        workspace: {
          workflow: { state: 'reviewed', created_by_user_account: 123 },
          collections: [{ collection_ref: 'collection-test', collection_modified: date }],
          unknown_client_field: 'must not persist',
        },
      }).expect(200);
      stored = await Model.collection.findOne({ 'stix.id': created.stix.id });
      expect(stored.workspace.workflow.created_by_user_account).toBe('123');
      expect(stored.workspace.collections[0].collection_modified).toEqual(new Date(date));
      expect(stored.workspace.unknown_client_field).toBeUndefined();
      expect(stored.workspace.evaluation_context.outcome).toBe('exempt');
    } finally {
      config.validateRequests.withOpenApi = true;
    }
  });

  it('accepts malformed deprecated POST and metadata PUT but rejects active and narrowed scope', async () => {
    const body = group();
    const created = await call('post', '/api/groups', body).expect(201);
    expect(created.body.workspace.evaluation_context.outcome).toBe('exempt');
    expect(created.body.workspace.evaluation_context.publication_token).not.toBe(999999);
    const path = `/api/groups/${created.body.stix.id}/modified/${created.body.stix.modified}`;
    await call('put', path, {
      stix: created.body.stix,
      workspace: { workflow: { state: 'reviewed' } },
    }).expect(200);
    const active = group();
    active.stix.x_mitre_deprecated = false;
    await call('post', '/api/groups', active).expect(400);
    const exemption = baseline.find((r) => r.retirementStatus === 'deprecated');
    await rules.updateById(exemption._id, { ...exemption, stixTypes: ['tool'] });
    await call('post', '/api/groups', group()).expect(400);
    await call('put', `${path}?dryRun=true`, {
      stix: created.body.stix,
      workspace: { workflow: { state: 'reviewed' } },
    }).expect(400);
  });

  it('rejects restoration as active and checks strict release admission under the same policy', async () => {
    const created = (await call('post', '/api/groups', group()).expect(201)).body;
    const reviewed = require('../../../services/release-tracks/reviewed-state-service');
    const entries = [{ object_ref: created.stix.id, object_modified: created.stix.modified }];
    await reviewed.ensureReviewed(entries);
    await dropExemptions();
    await expect(reviewed.ensureReviewed(entries)).rejects.toThrow('ADM validation failed');
    const restored = {
      stix: {
        ...created.stix,
        modified: new Date(Date.now() + 1000).toISOString(),
        x_mitre_deprecated: false,
      },
      workspace: { workflow: { state: 'reviewed' } },
    };
    await call('post', '/api/groups', restored).expect(400);
  });

  const technique = () => ({
    workspace: { workflow: { state: 'work-in-progress' } },
    stix: {
      name: 'Conversion policy fixture',
      type: 'attack-pattern',
      spec_version: '2.1',
      description: 'Technique fixture',
      x_mitre_is_subtechnique: false,
      x_mitre_platforms: ['Windows'],
      x_mitre_domains: ['enterprise-attack'],
      kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'execution' }],
    },
  });

  it('rejects malformed hierarchy retirement before saving a converted primary', async () => {
    const parent = (await call('post', '/api/techniques', technique()).expect(201)).body;
    const child = (await call('post', '/api/techniques', technique()).expect(201)).body;
    await call('post', `/api/techniques/${child.stix.id}/convert-to-subtechnique`, {
      parentTechniqueAttackId: parent.workspace.attack_id,
    }).expect(200);
    const relation = await Relationship.collection.findOne({
      'stix.source_ref': child.stix.id,
      'stix.relationship_type': 'subtechnique-of',
    });
    await Relationship.collection.updateOne(
      { _id: relation._id },
      { $set: { 'stix.description': 42 } },
    );
    await rules.deleteById(baseline.find((rule) => rule.retirementStatus === 'deprecated')._id);
    const before = await Model.countDocuments({ 'stix.id': child.stix.id });
    await call('post', `/api/techniques/${child.stix.id}/convert-to-technique`, {}).expect(400);
    expect(await Model.countDocuments({ 'stix.id': child.stix.id })).toBe(before);
    expect(await Relationship.countDocuments({ 'stix.id': relation.stix.id })).toBe(1);
  });

  it('preflights tactic ADM failures before the primary save and permits repair/retry', async () => {
    const collected = sinon.spy(operation, 'collect');
    const tactic = (
      await call('post', '/api/tactics', {
        workspace: { workflow: { state: 'work-in-progress' } },
        stix: {
          type: 'x-mitre-tactic',
          name: 'Policy tactic',
          x_mitre_shortname: 'execution',
          x_mitre_domains: ['enterprise-attack'],
          spec_version: '2.1',
        },
      }).expect(201)
    ).body;
    const dependent = (await call('post', '/api/techniques', technique()).expect(201)).body;
    await Model.collection.updateOne(
      { 'stix.id': dependent.stix.id },
      { $set: { 'stix.x_mitre_domains': ['invalid-domain'] } },
    );
    const changed = {
      workspace: tactic.workspace,
      stix: {
        ...tactic.stix,
        modified: new Date(Date.now() + 1000).toISOString(),
        x_mitre_shortname: 'updated-phase',
      },
    };
    const response = await call('post', '/api/tactics', changed).expect(400);
    expect(response.body.message).toBe('ADM validation failed');
    expect(await Model.countDocuments({ 'stix.id': dependent.stix.id })).toBe(1);
    expect(await Model.countDocuments({ 'stix.id': tactic.stix.id })).toBe(1);
    const failedVisit = collected
      .getCalls()
      .find(({ args }) => args[0].stix.id === dependent.stix.id && args[2]?.phase === 'preflight');
    expect(failedVisit.args[1].outcome).toBe('invalid');
    collected.resetHistory();
    await Model.collection.updateOne(
      { 'stix.id': dependent.stix.id },
      { $set: { 'stix.x_mitre_domains': ['enterprise-attack'] } },
    );
    await call('post', '/api/tactics', changed).expect(201);
    expect(await Model.countDocuments({ 'stix.id': tactic.stix.id })).toBe(2);
    expect(await Model.countDocuments({ 'stix.id': dependent.stix.id })).toBe(2);
    const latest = await Model.collection.findOne(
      { 'stix.id': dependent.stix.id },
      { sort: { 'stix.modified': -1 } },
    );
    expect(latest.stix.kill_chain_phases[0].phase_name).toBe('updated-phase');
    const visits = collected.getCalls().filter(({ args }) => args[0].stix.id === dependent.stix.id);
    expect(visits.map(({ args }) => args[2].phase)).toEqual(['preflight', 'evaluation']);
    expect(visits[0].args[0].stix.modified).toBe(visits[1].args[0].stix.modified);
    collected.restore();
  });

  it('preflights identity ADM failures before configuration changes and permits repair/retry', async () => {
    const collected = sinon.spy(operation, 'collect');
    const dependent = (await call('post', '/api/techniques', technique()).expect(201)).body;
    await Model.collection.updateOne(
      { 'stix.id': dependent.stix.id },
      { $set: { 'stix.x_mitre_domains': ['invalid-domain'] } },
    );
    const identity = (
      await call('post', '/api/identities', {
        workspace: { workflow: { state: 'work-in-progress' } },
        stix: {
          type: 'identity',
          name: 'New organization',
          identity_class: 'organization',
          spec_version: '2.1',
        },
      }).expect(201)
    ).body;
    const configurations = require('../../../repository/system-configurations-repository');
    const beforeConfig = await configurations.retrieveOne({ lean: true });
    const configCount = await configurations.model.countDocuments({});
    await Model.collection.updateOne(
      { 'stix.id': dependent.stix.id },
      { $set: { 'stix.created_by_ref': beforeConfig.organization_identity_ref } },
    );
    const response = await call('post', '/api/config/organization-identity', {
      id: identity.stix.id,
    }).expect(400);
    expect(response.body.message).toBe('ADM validation failed');
    expect(await Model.countDocuments({ 'stix.id': dependent.stix.id })).toBe(1);
    expect(await configurations.model.countDocuments({})).toBe(configCount);
    expect((await configurations.retrieveOne({ lean: true })).organization_identity_ref).toBe(
      beforeConfig.organization_identity_ref,
    );
    collected.resetHistory();
    // Repair all earlier invalid fixtures that share the provenance chain.
    await Model.collection.updateMany(
      { 'stix.x_mitre_domains': ['invalid-domain'] },
      { $set: { 'stix.x_mitre_domains': ['enterprise-attack'] } },
    );
    await call('post', '/api/config/organization-identity', { id: identity.stix.id }).expect(204);
    expect(await configurations.model.countDocuments({})).toBe(configCount + 1);
    expect(await Model.countDocuments({ 'stix.id': dependent.stix.id })).toBe(2);
    const latest = await Model.collection.findOne(
      { 'stix.id': dependent.stix.id },
      { sort: { 'stix.modified': -1 } },
    );
    expect(latest.stix.created_by_ref).toBe(identity.stix.id);
    expect(latest.stix.x_mitre_modified_by_ref).toBe(identity.stix.id);
    expect(latest.stix.modified).toBeInstanceOf(Date);
    expect(latest.stix.modified.getTime()).toBeGreaterThan(
      new Date(dependent.stix.modified).getTime(),
    );
    expect(latest.__t).toBe(require('../../../lib/model-names').ModelName.Technique);
    expect(latest.stix.x_mitre_platforms).toEqual(dependent.stix.x_mitre_platforms);
    expect(latest.stix.x_mitre_is_subtechnique).toBe(dependent.stix.x_mitre_is_subtechnique);
    expect(latest.stix.kill_chain_phases).toEqual(dependent.stix.kill_chain_phases);
    const visits = collected.getCalls().filter(({ args }) => args[0].stix.id === dependent.stix.id);
    expect(visits.map(({ args }) => args[2].phase)).toEqual(['preflight', 'evaluation']);
    expect(visits[0].args[0].stix.modified).toBe(visits[1].args[0].stix.modified);
    expect(latest.stix.modified).toEqual(new Date(visits[1].args[0].stix.modified));
    await call('post', '/api/config/organization-identity', { id: identity.stix.id }).expect(204);
    expect(await Model.countDocuments({ 'stix.id': dependent.stix.id })).toBe(2);
  });

  it('preserves published bundles while reconciliation changes current diagnostics', async () => {
    const object = (await call('post', '/api/groups', group()).expect(201)).body;
    const track = (
      await call('post', '/api/release-tracks/new', {
        name: `Retired ${randomUUID().replaceAll('-', '')}`,
        type: 'standard',
      }).expect(201)
    ).body;
    const { releaseExactMembers } = require('../release-tracks/release-track-test-helpers');
    const released = await releaseExactMembers(app, cookie, track.id, [object], { version: '1.0' });
    const path = `/api/release-tracks/${track.id}/snapshots/${released.modified}`;
    const before = (await call('get', `${path}?format=bundle`).expect(200)).body;
    await dropExemptions();
    await worker.runOnce();
    const after = (await call('get', `${path}?format=bundle`).expect(200)).body;
    expect(after.objects).toEqual(before.objects);
    const stored = await Model.collection.findOne({ 'stix.id': object.stix.id });
    expect(stored.workspace.workflow.state).toBe('reviewed');
    expect(stored.workspace.evaluation_context.outcome).toBe('invalid');
  });

  it('preflights the primary revoked revision before any side effects and clears cloned diagnostics', async () => {
    const original = (await call('post', '/api/groups', group()).expect(201)).body;
    const replacement = (await call('post', '/api/groups', group()).expect(201)).body;
    await Model.collection.updateMany(
      { 'stix.id': { $in: [original.stix.id, replacement.stix.id] } },
      {
        $set: {
          'stix.x_mitre_deprecated': false,
          'workspace.validation': { errors: [{ message: 'old' }] },
          'workspace.evaluation_context': { outcome: 'invalid', publication_token: 999999 },
        },
      },
    );
    const revokeRule = baseline.find((r) => r.retirementStatus === 'revoked');
    await rules.deleteById(revokeRule._id);
    const before = await Relationship.countDocuments({});
    const body = { revoking: { stixId: replacement.stix.id, modified: replacement.stix.modified } };
    await call('post', `/api/groups/${original.stix.id}/revoke`, body).expect(400);
    expect(await Relationship.countDocuments({})).toBe(before);
    expect(await Model.countDocuments({ 'stix.id': original.stix.id })).toBe(1);
    await repository.mutateRules(() => ({ rules: baseline }));
    const revoked = await call('post', `/api/groups/${original.stix.id}/revoke`, body).expect(200);
    expect(revoked.body.primary.stix.revoked).toBe(true);
    expect(revoked.body.primary.workspace.validation).toBeUndefined();
    expect(revoked.body.primary.workspace.evaluation_context.outcome).toBe('exempt');
    expect(revoked.body.primary.workspace.evaluation_context.publication_token).not.toBe(999999);
  });

  it('does not let a delayed request clear a newer same-policy diagnostic result', async () => {
    const created = (await call('post', '/api/groups', group()).expect(201)).body;
    const diagnosticRepository = require('../../../repository/validation-diagnostics-repository');
    const publish = diagnosticRepository.publish;
    const stub = sinon.stub(diagnosticRepository, 'publish').callsFake(async (args) => {
      const newerToken = await repository.allocatePublicationToken(args.snapshot);
      await publish({
        ...args,
        workspace: undefined,
        publicationToken: newerToken,
        result: {
          outcome: 'invalid',
          errors: [{ message: 'newer diagnostic', path: ['name'], code: 'test' }],
        },
      });
      return publish(args);
    });
    try {
      await call('put', `/api/groups/${created.stix.id}/modified/${created.stix.modified}`, {
        stix: created.stix,
        workspace: { workflow: { state: 'reviewed' } },
      }).expect(500);
      const stored = await Model.collection.findOne({ 'stix.id': created.stix.id });
      expect(stored.workspace.validation.errors[0].message).toBe('newer diagnostic');
    } finally {
      stub.restore();
    }
  });

  it('restricts reconciliation status and retry to administrators', async () => {
    const accounts = require('../../../models/user-account-model');
    const account =
      await require('../../../services/system/system-configuration-service').retrieveAnonymousUserAccount();
    await accounts.updateOne({ id: account.id }, { $set: { role: 'visitor' } });
    try {
      await call('get', '/api/config/validation-bypasses/reconciliation').expect(401);
      await call('post', '/api/config/validation-bypasses/reconciliation/retry').expect(401);
    } finally {
      await accounts.updateOne({ id: account.id }, { $set: { role: account.role } });
    }
  });

  it('exposes reconciliation status/retry before dynamic id routes with OpenAPI enabled', async () => {
    const status = await call('get', '/api/config/validation-bypasses/reconciliation').expect(200);
    expect(status.body.status).toBe('pending');
    expect(status.body.claim_token).toBeUndefined();
    await call('post', '/api/config/validation-bypasses/reconciliation/retry').expect(200);
  });
});
