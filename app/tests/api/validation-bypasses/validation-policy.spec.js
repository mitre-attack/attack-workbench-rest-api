'use strict';

const { expect } = require('expect');
const sinon = require('sinon');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { createRequire } = require('module');
const database = require('../../../lib/database-in-memory');
const repository = require('../../../repository/validation-policy-repository');
const rules = require('../../../repository/validation-bypasses-repository');
const service = require('../../../services/system/validation-policy-service');
const bypassService = require('../../../services/system/validation-bypasses-service');
const Legacy = require('../../../models/validation-bypass-rule-model');
const { evaluateObject, matchErrorBypass } = require('../../../lib/adm-validation');
const { supportedStixTypes } = require('../../../lib/validation-policy-rules');
const { BadRequestError, DuplicateIdError } = require('../../../exceptions');
const migration = require('../../../../migrations/20261008000000-initialize-validation-policy');
const BypassRuleReasons = require('../../../lib/bypass-rule-constants');

const errorRule = (field = 'name') => ({
  fieldPath: [field],
  errorCode: 'invalid_type',
  stixType: 'all',
});
const exemption = (overrides = {}) => ({
  kind: 'object-exemption',
  name: 'Selected revoked',
  enabled: true,
  retirementStatus: 'revoked',
  stixTypes: ['tool'],
  ...overrides,
});
const object = (stix = {}, state = 'work-in-progress') => ({
  stix: { type: 'tool', ...stix },
  workspace: { workflow: { state } },
});

describe('Canonical validation policy foundation', function () {
  before(async function () {
    await database.initializeConnection();
  });
  beforeEach(async function () {
    await repository.model.deleteMany({});
    await Legacy.deleteMany({});
  });
  after(async function () {
    await database.closeConnection();
  });

  it('uses legacy storage until explicit cutover and preserves original ids and payload', async function () {
    const legacy = await rules.save({
      ...errorRule(),
      warningMessage: 'Keep warning',
      autoCreated: true,
      autoCreatedReason: BypassRuleReasons.STATIC,
    });
    expect(await repository.readPolicy()).toBeNull();
    const original = await Legacy.findById(legacy._id).lean();
    await service.initialize();
    expect(await rules.retrieveById(legacy._id)).toEqual(original);
    await rules.updateById(legacy._id, { ...errorRule(), warningMessage: 'Canonical only' });
    expect((await Legacy.findById(legacy._id).lean()).warningMessage).toBe('Keep warning');
  });

  for (const canonical of [false, true]) {
    it(`accepts uppercase and lowercase rule ids in ${canonical ? 'canonical' : 'legacy'} storage`, async function () {
      if (canonical) await service.initialize();
      const saved = await rules.save(errorRule());
      const lower = String(saved._id);
      const upper = lower.toUpperCase();
      expect(upper).not.toBe(lower);
      expect(await rules.retrieveById(upper)).toEqual(await rules.retrieveById(lower));
      const updated = await rules.updateById(upper, {
        ...errorRule(),
        warningMessage: 'Uppercase update',
      });
      expect(String(updated._id)).toBe(lower);
      expect((await rules.retrieveById(lower)).warningMessage).toBe('Uppercase update');
      expect(String((await rules.deleteById(upper))._id)).toBe(lower);
      expect(await rules.retrieveById(lower)).toBeNull();
      expect(await rules.retrieveById(upper)).toBeNull();
    });
  }

  it('preserves omitted legacy update options and generated ownership before cutover', async function () {
    const saved = await rules.save({
      ...errorRule(),
      suppressError: false,
      warningMessage: 'Retained warning',
      autoCreated: true,
      autoCreatedReason: BypassRuleReasons.NAMESPACE,
      triggerEvent: 'original-event',
    });
    const before = await rules.retrieveById(saved._id);
    const updated = await rules.updateById(saved._id, errorRule('description'));
    expect(updated).toEqual({ ...before, fieldPath: ['description'] });
    expect(await repository.readPolicy()).toBeNull();
    expect(
      await bypassService.checkBypassRule({ path: ['description'], code: 'invalid_type' }, 'tool'),
    ).toEqual({ bypassed: true, warningMessage: 'Retained warning' });
    expect((await rules.deleteByReason(BypassRuleReasons.NAMESPACE)).deletedCount).toBe(1);
    expect(await rules.retrieveById(saved._id)).toBeNull();
  });

  it('shares legacy actionable bypass matching, warnings, and numeric path selectors', async function () {
    const error = { path: ['external_references', 0, 'external_id'], code: 'custom' };
    const base = {
      fieldPath: ['external_references', '0', 'external_id'],
      errorCode: 'custom',
      stixType: 'all',
    };
    for (const [overrides, bypassed, warningMessage] of [
      [{ suppressError: true }, true, null],
      [{ suppressError: false, warningMessage: 'Warning only' }, true, 'Warning only'],
      [{ suppressError: true, warningMessage: 'Suppressed warning' }, true, 'Suppressed warning'],
      [{ suppressError: false }, false, null],
      [{}, false, null],
      [{ suppressError: true, stixType: 'malware' }, false, null],
      [{ suppressError: true, errorCode: 'invalid_type' }, false, null],
      [
        { suppressError: true, fieldPath: ['external_references', '1', 'external_id'] },
        false,
        null,
      ],
      [{ suppressError: true, kind: 'object-exemption' }, false, null],
    ]) {
      const rule = { ...base, ...overrides };
      expect(Boolean(matchErrorBypass(error, 'tool', [rule]))).toBe(bypassed);
      expect(await bypassService.checkBypassRule(error, 'tool', [rule])).toEqual({
        bypassed,
        warningMessage,
      });
    }
    const inactive = { ...base, suppressError: false };
    const warning = { ...base, stixType: 'tool', warningMessage: 'First actionable rule' };
    const suppress = { ...base, suppressError: true };
    expect(matchErrorBypass(error, 'tool', [inactive, warning, suppress])).toBe(warning);
    expect(
      await bypassService.checkBypassRule(error, 'tool', [inactive, warning, suppress]),
    ).toEqual({
      bypassed: true,
      warningMessage: warning.warningMessage,
    });
  });

  it('initializes from migration-driver BSON and remains readable/writable through Mongoose', async function () {
    const migrationRequire = createRequire(require.resolve('migrate-mongo'));
    const { MongoClient, ObjectId } = migrationRequire('mongodb');
    const client = new MongoClient(mongoose.connection.client.s.url);
    await client.connect();
    try {
      const db = client.db(mongoose.connection.name);
      const id = new ObjectId();
      await db.collection('validationbypassrules').insertOne({
        ...errorRule(),
        _id: id,
        suppressError: true,
        autoCreated: false,
        autoCreatedReason: null,
        triggerEvent: null,
        warningMessage: null,
      });
      await migration.up(db);
      expect(String((await rules.retrieveById(String(id)))._id)).toBe(String(id));
      await rules.updateById(String(id), {
        ...errorRule(),
        warningMessage: 'Updated through Mongoose',
      });
      const nativePolicy = await db
        .collection(repository.COLLECTION)
        .findOne({ _id: repository.POLICY_ID });
      expect(
        nativePolicy.rules.find((rule) => String(rule._id) === String(id)).warningMessage,
      ).toBe('Updated through Mongoose');
      await migration.up(db);
      expect((await repository.readPolicy()).policy_revision).toBe(2);
    } finally {
      await client.close();
    }
  });

  it('runs the canonical migration after all historical legacy rule migrations', function () {
    const files = require('fs')
      .readdirSync(require('path').resolve(__dirname, '../../../../migrations'))
      .filter((name) => /^\d/.test(name))
      .sort();
    expect(files.at(-1)).toBe('20261008000000-initialize-validation-policy.js');
  });

  it('does not restore deleted or disabled defaults after initialization or migration retries', async function () {
    await service.initialize();
    const defaults = (await rules.findAll()).filter((rule) => rule.kind === 'object-exemption');
    expect(defaults).toHaveLength(2);
    await rules.deleteById(defaults[0]._id);
    await rules.updateById(defaults[1]._id, { ...defaults[1], enabled: false });
    const before = await repository.readPolicy();
    await service.initialize();
    expect(await repository.readPolicy()).toEqual(before);
    expect(before.defaults_seeded).toBe(true);
    expect(before.policy_revision).toBe(3);
  });

  it('deduplicates normalized selectors and rejects mixed-kind rules', async function () {
    await service.initialize();
    const saved = await rules.save(exemption({ stixTypes: ['tool', 'malware', 'tool'] }));
    expect(saved.stixTypes).toEqual(['malware', 'tool']);
    await expect(
      rules.save(exemption({ stixTypes: ['malware', 'tool'], name: 'Other name', enabled: false })),
    ).rejects.toBeInstanceOf(DuplicateIdError);
    await expect(rules.save(exemption({ fieldPath: [] }))).rejects.toBeInstanceOf(BadRequestError);
    await expect(rules.save({ ...errorRule(), enabled: true })).rejects.toBeInstanceOf(
      BadRequestError,
    );
    await expect(rules.save(exemption({ stixTypes: [] }))).rejects.toBeInstanceOf(BadRequestError);
    await expect(rules.save(exemption({ stixTypes: ['unsupported'] }))).rejects.toBeInstanceOf(
      BadRequestError,
    );
    const old = await rules.save(errorRule());
    expect(old.suppressError).toBe(true);
    expect(old.kind).toBeUndefined();
    await expect(rules.save({ ...errorRule(), kind: 'error-bypass' })).rejects.toBeInstanceOf(
      DuplicateIdError,
    );
  });

  it('does not lose simultaneous edits or their monotonic pending intent', async function () {
    await service.initialize();
    const saved = await Promise.all(
      Array.from({ length: 12 }, (_, index) => rules.save(errorRule(`field-${index}`))),
    );
    await Promise.all(
      saved.map((rule, index) =>
        rules.updateById(rule._id, { ...rule, warningMessage: `Warning ${index}` }),
      ),
    );
    const policy = await repository.readPolicy();
    expect(policy.rules).toHaveLength(14);
    expect(policy.policy_revision).toBe(25);
    expect(policy.evaluation_generation).toBe(25);
    expect(policy.reconciliation.status).toBe('pending');
    expect(policy.reconciliation.desired_policy_revision).toBe(25);
    expect(policy.reconciliation.desired_generation).toBe(25);
    expect(policy.rules.filter((rule) => rule.warningMessage)).toHaveLength(12);
  });

  it('has one winner for simultaneous duplicate creates', async function () {
    await service.initialize();
    const results = await Promise.allSettled([rules.save(errorRule()), rules.save(errorRule())]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected').reason).toBeInstanceOf(
      DuplicateIdError,
    );
    expect((await repository.readPolicy()).policy_revision).toBe(2);
  });

  it('rebuilds generated groups atomically, preserves rule identities, and records one intent', async function () {
    await service.initialize();
    await bypassService.createNamespaceRules(['tool', 'malware']);
    const before = await repository.readPolicy();
    const oldId = before.rules.find((rule) => rule.stixType === 'tool')._id;
    await bypassService.createNamespaceRules(['tool', 'attack-pattern']);
    const after = await repository.readPolicy();
    expect(after.policy_revision).toBe(before.policy_revision + 1);
    expect(after.reconciliation.desired_generation).toBe(after.evaluation_generation);
    expect(after.rules.some((rule) => rule.stixType === 'malware')).toBe(false);
    expect(String(after.rules.find((rule) => rule.stixType === 'tool')._id)).toBe(String(oldId));
    await bypassService.createNamespaceRules(['tool', 'attack-pattern']);
    expect((await repository.readPolicy()).policy_revision).toBe(after.policy_revision);
  });

  it('static seeding is a no-op when selectors exist and legacy seeding does not initialize policy', async function () {
    await bypassService.loadStaticRules(
      require('path').resolve(__dirname, '../../../lib/default-bypass-rules.json'),
    );
    expect(await repository.readPolicy()).toBeNull();
    await service.initialize();
    const before = await repository.readPolicy();
    await bypassService.loadStaticRules(
      require('path').resolve(__dirname, '../../../lib/default-bypass-rules.json'),
    );
    expect(await repository.readPolicy()).toEqual(before);
  });

  it('rejects an oversized rule atomically', async function () {
    await service.initialize();
    const before = await repository.readPolicy();
    await expect(
      rules.save({ ...errorRule(), warningMessage: 'x'.repeat(repository.MAX_POLICY_BYTES) }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(await repository.readPolicy()).toEqual(before);
  });

  it('rejects excessive rule counts without changing the policy', async function () {
    await service.initialize();
    const before = await repository.readPolicy();
    const oversized = Array.from({ length: repository.MAX_RULES + 1 }, (_, index) => ({
      ...errorRule(`count-${index}`),
      _id: new mongoose.Types.ObjectId(),
    }));
    await expect(
      repository.mutateRules(() => ({ rules: oversized, value: null })),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(await repository.readPolicy()).toEqual(before);
  });

  it('retains rule order and revision when repeating an unchanged generated group', async function () {
    await service.initialize();
    await bypassService.createNamespaceRules(['tool']);
    await bypassService.createIdentityRules(['tool'], 'test');
    const before = await repository.readPolicy();
    await bypassService.createNamespaceRules(['tool']);
    expect(await repository.readPolicy()).toEqual(before);
  });

  it('preserves retry guidance in the HTTP response when policy mutation retries exhaust', async () => {
    await service.initialize();
    const update = sinon
      .stub(repository.model.collection, 'updateOne')
      .resolves({ modifiedCount: 0 });
    try {
      const app = express();
      app.post('/rules', (req, res, next) => {
        rules
          .save(errorRule())
          .then((rule) => res.json(rule))
          .catch(next);
      });
      const handler = require('../../../lib/error-handler');
      app.use(handler.serviceExceptions, handler.catchAll);
      const response = await request(app).post('/rules').expect(500).expect('Content-Type', /json/);
      expect(response.body.details).toContain('Retry the operation.');
      expect(update.callCount).toBe(100);
      expect((await repository.readPolicy()).policy_revision).toBe(1);
    } finally {
      update.restore();
    }
  });

  it('isolates immutable snapshots from later edits', async function () {
    await service.initialize();
    const snapshot = await service.loadSnapshot();
    expect(Object.isFrozen(snapshot.rules[0])).toBe(true);
    expect(typeof snapshot.rules[0]._id).toBe('string');
    await rules.deleteById(snapshot.rules[0]._id);
    expect(snapshot.rules).toHaveLength(2);
    expect((await service.loadSnapshot()).rules).toHaveLength(1);
  });

  it('rejects engine mismatches until explicit activation and only advances the evaluation generation', async function () {
    await service.initialize();
    await repository.model.collection.updateOne(
      { _id: repository.POLICY_ID },
      { $set: { 'engine_context.evaluator_version': 'older' } },
    );
    await expect(service.initialize()).rejects.toThrow('does not match');
    await expect(service.loadSnapshot()).rejects.toThrow('does not match');
    await expect(rules.save(errorRule())).rejects.toThrow('does not match');
    await service.initialize({ activateEngine: true });
    const current = await repository.readPolicy();
    expect(current.policy_revision).toBe(1);
    expect(current.evaluation_generation).toBe(2);
    expect(current.engine_context).toEqual(service.readEngineContext());
    await service.initialize({ activateEngine: true });
    expect((await repository.readPolicy()).evaluation_generation).toBe(2);
  });

  it('allocates ordered shared publication tokens and fences stale contexts', async function () {
    await service.initialize();
    const snapshot = await service.loadSnapshot();
    const tokens = await Promise.all(
      Array.from({ length: 10 }, () => repository.allocatePublicationToken(snapshot)),
    );
    expect(tokens.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await rules.save(errorRule());
    expect(await repository.allocatePublicationToken(snapshot)).toBeNull();
    expect(await repository.allocatePublicationToken(await service.loadSnapshot())).toBe(11);
  });
});

describe('Pure ADM policy evaluation', function () {
  const snapshot = {
    rules: [
      { _id: 'revoked-rule', ...exemption({ stixTypes: 'all' }) },
      {
        _id: 'deprecated-rule',
        ...exemption({ name: 'Deprecated', retirementStatus: 'deprecated', stixTypes: 'all' }),
      },
    ],
  };

  it('exempts Boolean retirement flags across every supported type before parsing', function () {
    for (const type of supportedStixTypes) {
      expect(evaluateObject(object({ type, revoked: true, name: 123 }), snapshot).outcome).toBe(
        'exempt',
      );
      expect(
        evaluateObject(object({ type, x_mitre_deprecated: true, name: 123 }), snapshot).outcome,
      ).toBe('exempt');
    }
    expect(evaluateObject(object({ revoked: 'true', name: 123 }), snapshot).outcome).toBe(
      'invalid',
    );
    expect(
      evaluateObject(object({ revoked: false, x_mitre_deprecated: false }), snapshot).outcome,
    ).toBe('valid');
  });

  it('reports overlapping matches, honors scopes, and does not treat disabled rules as denials', function () {
    const rules = [...snapshot.rules, { _id: 'disabled', ...exemption({ enabled: false }) }];
    expect(
      evaluateObject(object({ revoked: true, x_mitre_deprecated: true }), { rules })
        .matchingExemptions,
    ).toHaveLength(2);
    const scoped = { rules: [{ _id: 'scope', ...exemption() }] };
    expect(
      evaluateObject(object({ type: 'malware', revoked: true, name: 123 }), scoped).outcome,
    ).toBe('invalid');
    expect(evaluateObject(object({ type: 'tool', revoked: true, name: 123 }), scoped).outcome).toBe(
      'exempt',
    );
    expect(
      evaluateObject(object({ revoked: true, name: 123 }), { rules: [rules[2]] }).outcome,
    ).toBe('invalid');
  });

  it('distinguishes disabled, unsupported, WIP, full, and deprecated types without flags', function () {
    expect(evaluateObject(object({ revoked: true }), snapshot, { enabled: false }).outcome).toBe(
      'disabled',
    );
    expect(evaluateObject(object({ type: 'unknown' }), snapshot).outcome).toBe('unsupported');
    expect(evaluateObject(object(), snapshot).outcome).toBe('valid');
    expect(evaluateObject(object({}, 'reviewed'), snapshot).outcome).toBe('invalid');
    expect(
      evaluateObject(object({ type: 'x-mitre-data-source' }, 'reviewed'), snapshot).outcome,
    ).toBe('invalid');
  });

  it('normalizes dates without modifying inputs and retains old issue suppression/warnings', function () {
    const input = object({ created: new Date('2025-01-01T00:00:00Z'), name: 123 });
    const bypass = {
      rules: [{ ...errorRule(), suppressError: false, warningMessage: 'Name warning' }],
    };
    const result = evaluateObject(input, bypass);
    expect(result.outcome).toBe('valid');
    expect(result.warnings).toEqual([
      { message: 'Name warning', path: ['name'], code: 'invalid_type' },
    ]);
    expect(input.stix.created).toBeInstanceOf(Date);
    expect(
      evaluateObject(input, { rules: [{ ...errorRule(), suppressError: false }] }).outcome,
    ).toBe('invalid');
    expect(
      evaluateObject(input, { rules: [{ ...errorRule(), suppressError: true }] }).outcome,
    ).toBe('valid');
  });

  it('keeps numeric path matching and nonmatching issues separate', function () {
    const input = object({ name: 123, x_mitre_platforms: ['BogusOS'] });
    const rule = {
      fieldPath: ['x_mitre_platforms', '0'],
      errorCode: 'invalid_value',
      stixType: 'tool',
      suppressError: true,
    };
    const result = evaluateObject(input, { rules: [rule] });
    expect(result.outcome).toBe('invalid');
    expect(result.errors.map((error) => error.path)).toEqual([['name']]);
  });
});
