'use strict';

const { expect } = require('expect');
const sinon = require('sinon');
const request = require('supertest');
const express = require('express');
const { randomUUID } = require('crypto');
const database = require('../../../lib/database-in-memory');
const configuration = require('../../../lib/database-configuration');
const config = require('../../../config/config');
const policy = require('../../../services/system/validation-policy-service');
const rules = require('../../../repository/validation-bypasses-repository');
const policyRepository = require('../../../repository/validation-policy-repository');
const reports = require('../../../repository/validation-reports-repository');
const service = require('../../../services/validation-reports-service');
const Model = require('../../../models/attack-object-model');
const Relationship = require('../../../models/relationship-model');
const login = require('../../shared/login');
const original = {
  adm: config.validateRequests.withAttackDataModel,
  openapi: config.validateRequests.withOpenApi,
  basic: config.serviceAuthn.basicApikey.enable,
  basicAccounts: config.serviceAuthn.basicApikey.serviceAccounts,
};
const group = () => ({
  workspace: { workflow: { state: 'reviewed' } },
  stix: {
    type: 'intrusion-set',
    id: `intrusion-set--${randomUUID()}`,
    name: 'Retired malformed group',
    spec_version: '2.1',
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    x_mitre_domains: ['invalid-domain'],
    x_mitre_deprecated: true,
  },
});

describe('Quiet opt-in validation reports', function () {
  let app, cookie, baseline, deprecated, revoked;
  before(async () => {
    await database.initializeConnection();
    await configuration.checkSystemConfiguration();
    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;
    config.serviceAuthn.basicApikey.enable = true;
    config.serviceAuthn.basicApikey.serviceAccounts = [
      { name: 'report-importer', apikey: 'test-key', serviceRole: 'collection-manager' },
    ];
    app = await require('../../../index').initializeApp();
    const session = await login.loginAnonymous(app);
    cookie = `${session.name}=${session.value}`;
    baseline = (await policyRepository.readPolicy()).rules;
    deprecated = String(baseline.find((r) => r.retirementStatus === 'deprecated')._id);
    revoked = String(baseline.find((r) => r.retirementStatus === 'revoked')._id);
  });
  beforeEach(async () => {
    await policyRepository.mutateRules(() => ({ rules: baseline }));
    await Promise.all([reports.model.deleteMany({}), reports.applicationsModel.deleteMany({})]);
  });
  afterEach(() => sinon.restore());
  after(async () => {
    config.validateRequests.withAttackDataModel = original.adm;
    config.validateRequests.withOpenApi = original.openapi;
    config.serviceAuthn.basicApikey.enable = original.basic;
    config.serviceAuthn.basicApikey.serviceAccounts = original.basicAccounts;
    await database.closeConnection();
  });
  const call = (method, path, body) => request(app)[method](path).set('Cookie', cookie).send(body);
  const getReport = (report, query = {}) =>
    call('get', `/api/validation-reports/${report.reportId}`).query(query);
  async function bothReport() {
    const object = (await call('post', '/api/groups', group()).expect(201)).body;
    await Model.collection.updateOne(
      { 'stix.id': object.stix.id },
      { $set: { 'stix.revoked': true } },
    );
    const stored = (
      await call('get', `/api/groups/${object.stix.id}/modified/${object.stix.modified}`).expect(
        200,
      )
    ).body;
    return (
      await call(
        'put',
        `/api/groups/${object.stix.id}/modified/${object.stix.modified}?exemptionReport=details&exemptionLimit=1`,
        stored,
      ).expect(200)
    ).body;
  }
  it('keeps ordinary writes quiet and warnings unchanged; summary does not retain records', async () => {
    const quiet = (await call('post', '/api/groups', group()).expect(201)).body;
    expect(quiet.exemptionReport).toBeUndefined();
    expect(quiet.workspace.validation?.warnings).toBeUndefined();
    const selected = (
      await call('post', '/api/groups?exemptionReport=summary', group()).expect(201)
    ).body;
    expect(selected.exemptionReport.reportedExemptRevisions).toBe(1);
    expect(selected.exemptionReport.ruleApplications).toBe(1);
    expect(selected.exemptionReport.byRule[0].ruleId).toBe(deprecated);
    expect(selected.exemptionReport.details).toBeUndefined();
    expect(await reports.model.countDocuments()).toBe(0);
  });
  it('captures the composed revision in dry-run without persistence', async () => {
    const data = group();
    const response = (
      await call('post', '/api/groups?dryRun=true&exemptionReport=details', data).expect(200)
    ).body;
    const report = response.exemptionReport;
    expect(report.details[0].object_ref).toBe(response.stix.id);
    expect(report.details[0].object_modified).toBe(response.stix.modified);
    expect(report.details[0].ruleName.length).toBeGreaterThan(0);
    expect(report.details[0].phase).toBe('evaluation');
    expect(report.evaluatedScope.preflightOnlyRevisions).toBe(0);
    expect(await Model.countDocuments({ 'stix.id': data.stix.id })).toBe(0);
    expect((await getReport(report).expect(200)).body.details).toEqual(report.details);
  });
  it('filters before counts, intersects both selectors, and keeps all enforcement rules', async () => {
    const response = (
      await call(
        'post',
        `/api/groups?exemptionReport=details&exemptionStatuses=revoked&exemptionRuleIds=${deprecated}`,
        group(),
      ).expect(201)
    ).body;
    expect(response.exemptionReport.reportedExemptRevisions).toBe(0);
    expect(response.exemptionReport.ruleApplications).toBe(0);
    expect(response.exemptionReport.evaluatedScope.byOutcome.exempt).toBe(1);
    const all = (await getReport(response.exemptionReport).expect(200)).body;
    expect(all.ruleApplications).toBe(1);
    const invalid = group();
    invalid.stix.x_mitre_deprecated = false;
    const failure = (
      await call(
        'post',
        '/api/groups?exemptionReport=details&exemptionStatuses=revoked',
        invalid,
      ).expect(400)
    ).body;
    expect(failure.message).toBe('ADM validation failed');
    expect(failure.exemptionReport.state).toBe('partial');
    expect(failure.exemptionReport.evaluatedScope.byOutcome.invalid).toBe(1);
    expect(failure.exemptionReport.reportedExemptRevisions).toBe(0);
    expect(await Model.countDocuments({ 'stix.id': invalid.stix.id })).toBe(0);
  });
  function admOnlyClient() {
    // Exercise the supported ADM-only boundary without the cached OpenAPI router.
    const isolated = express();
    isolated.use(express.json());
    isolated.use((req, res, next) => {
      req.user = { userAccountId: randomUUID(), strategy: 'anonymId', role: 'admin' };
      const operation = require('../../../services/system/validation-operation-service');
      operation
        .run(({ snapshot }) => {
          const middleware = require('../../../lib/validation-report-middleware');
          const collector = middleware.prepare(req, snapshot);
          if (collector) {
            operation.current().collector = collector.collect;
            middleware.install(req, res, collector);
          }
          next();
        })
        .catch(next);
    });
    const authz = require('../../../lib/authz-middleware');
    isolated.post(
      '/api/groups',
      authz.requireRole(authz.editorOrHigher),
      require('../../../controllers/groups-controller').create,
    );
    isolated.post(
      '/api/collection-bundles',
      authz.requireRole(authz.editorOrHigher),
      require('../../../controllers/collection-bundles-controller').importBundle,
    );
    isolated.use(require('../../../lib/error-handler').serviceExceptions);
    isolated.use(require('../../../lib/error-handler').catchAll);
    return (method, path, body) => request(isolated)[method](path).send(body);
  }
  it('preserves ADM errors for malformed timestamps with summary and details reporting', async () => {
    const admCall = admOnlyClient();
    for (const dryRun of [false, true]) {
      const data = group();
      data.stix.x_mitre_deprecated = false;
      data.stix.modified = 'not-a-date';
      const query = { dryRun };
      const quiet = (await admCall('post', '/api/groups', data).query(query).expect(400)).body;
      expect(quiet.message).toBe('ADM validation failed');
      expect(quiet.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: ['modified'] })]),
      );
      for (const mode of ['summary', 'details']) {
        const failure = (
          await admCall('post', '/api/groups', data)
            .query({ ...query, exemptionReport: mode })
            .expect(400)
        ).body;
        expect(failure.message).toBe(quiet.message);
        expect(failure.details).toEqual(quiet.details);
        expect(failure.warnings).toEqual(quiet.warnings);
        expect(failure.exemptionReport.state).toBe('partial');
        expect(failure.exemptionReport.evaluatedScope).toEqual({
          revisions: 1,
          byOutcome: { invalid: 1 },
          preflightOnlyRevisions: 0,
        });
        if (mode === 'details') {
          expect(failure.exemptionReport.availability).toBe('retained');
          const retained = (await getReport(failure.exemptionReport).expect(200)).body;
          expect(retained.state).toBe('partial');
          expect(retained.evaluatedScope).toEqual(failure.exemptionReport.evaluatedScope);
        }
      }
      expect(await Model.countDocuments({ 'stix.id': data.stix.id })).toBe(0);
    }
  });
  it('reports an unusable exempt timestamp as null without changing dry-run success', async () => {
    const admCall = admOnlyClient();
    const data = group();
    data.stix.modified = 'not-a-date';
    const quiet = (await admCall('post', '/api/groups', data).query({ dryRun: true }).expect(200))
      .body;
    const reported = (
      await admCall('post', '/api/groups', data)
        .query({ dryRun: true, exemptionReport: 'details' })
        .expect(200)
    ).body;
    expect(reported.stix.modified).toBe(quiet.stix.modified);
    expect(reported.warnings).toEqual(quiet.warnings);
    expect(reported.exemptionReport.evaluatedScope.byOutcome).toEqual({ exempt: 1 });
    expect(reported.exemptionReport.details[0]).toMatchObject({
      object_ref: data.stix.id,
      object_modified: null,
      ruleId: deprecated,
    });
    const retained = (await getReport(reported.exemptionReport).expect(200)).body;
    expect(retained.details).toEqual(reported.exemptionReport.details);
    expect(await Model.countDocuments({ 'stix.id': data.stix.id })).toBe(0);
  });
  it('preserves rule names and deleted rules from the captured snapshot', async () => {
    const response = (
      await call('post', '/api/groups?exemptionReport=details', group()).expect(201)
    ).body;
    const before = response.exemptionReport;
    await rules.updateById(deprecated, {
      ...baseline.find((r) => String(r._id) === deprecated),
      name: 'Renamed after operation',
    });
    await rules.deleteById(deprecated);
    const after = (
      await getReport(before, { exemptionRuleIds: deprecated.toUpperCase() }).expect(200)
    ).body;
    expect(after.policyRevision).toBe(before.policyRevision);
    expect(after.details).toEqual(before.details);
    expect(after.byRule[0].ruleName).toBe(before.byRule[0].ruleName);
  });
  it('counts both retirement categories separately, dedupes revisions, and pages bounded applications', async () => {
    const response = await bothReport();
    const report = response.exemptionReport;
    expect(report.reportedExemptRevisions).toBe(1);
    expect(report.ruleApplications).toBe(2);
    expect(report.byStatus).toEqual({ revoked: 1, deprecated: 1 });
    expect(report.byRule.map((r) => r.ruleId).sort()).toEqual([deprecated, revoked].sort());
    const both = (
      await getReport(report, {
        exemptionStatuses: 'revoked,deprecated',
        exemptionRuleIds: `${revoked},${deprecated}`,
      }).expect(200)
    ).body;
    expect(both.ruleApplications).toBe(2);
    expect(report.details).toHaveLength(1);
    expect(report.hasMore).toBe(true);
    const next = (
      await getReport(report, { exemptionCursor: report.nextCursor, exemptionLimit: 1 }).expect(200)
    ).body;
    expect(next.details).toHaveLength(1);
    expect(next.details[0].ruleId).not.toBe(report.details[0].ruleId);
    expect(next.hasMore).toBe(false);
    expect(next.nextCursor).toBeNull();
    await getReport(report, { exemptionCursor: 'garbage' }).expect(400);
    await getReport(report, {
      exemptionCursor: report.nextCursor,
      exemptionStatuses: 'revoked',
    }).expect(400);
    const other = await bothReport();
    await getReport(other.exemptionReport, { exemptionCursor: report.nextCursor }).expect(400);
    await getReport(report, { exemptionLimit: 100 }).expect(200);
    await getReport(report, { exemptionLimit: 101 }).expect(400);
  });
  it('rejects unsafe choices and report filters without opt-in before persistence', async () => {
    for (const query of [
      'exemptionStatuses=deprecated',
      'exemptionLimit=1',
      'exemptionReport=nope',
      'exemptionReport=details&exemptionStatuses=active',
      'exemptionReport=details&exemptionRuleIds=not-an-id',
      `exemptionReport=details&exemptionRuleIds=${'0'.repeat(24)}`,
      'exemptionReport=details&exemptionLimit=0',
      'exemptionReport=details&exemptionLimit=1.5',
      'exemptionReport=details&exemptionStatuses=revoked,,deprecated',
    ]) {
      const data = group();
      await call('post', `/api/groups?${query}`, data).expect(400);
      expect(await Model.countDocuments({ 'stix.id': data.stix.id })).toBe(0);
    }
  });
  it('retains actual core success when report persistence fails', async () => {
    sinon.stub(reports, 'save').rejects(new Error('report database unavailable'));
    const result = (await call('post', '/api/groups?exemptionReport=details', group()).expect(201))
      .body;
    expect(result.exemptionReport.availability).toBe('unavailable');
    expect(result.exemptionReport.reportId).toBeNull();
    expect(result.exemptionReport.state).toBe('completed');
    expect(await Model.countDocuments({ 'stix.id': result.stix.id })).toBe(1);
  });
  it('enforces wall-clock expiry and still gives explicit expiry after TTL cleanup', async () => {
    const response = (
      await call('post', '/api/groups?exemptionReport=details', group()).expect(201)
    ).body;
    const report = response.exemptionReport;
    await request(app).get(`/api/validation-reports/${report.reportId}`).expect(401);
    const claims = await service.claims(report.reportId);
    const ownerApp = principalApp({
      userAccountId: claims.owner.userAccountId,
      strategy: 'anonymId',
      role: 'admin',
    });
    const afterExpiry = Date.now() + 24 * 60 * 60 * 1000 + 1;
    const clock = sinon.stub(Date, 'now').returns(afterExpiry);
    await request(ownerApp).get(`/reports/${report.reportId}`).expect(410);
    await reports.model.deleteMany({});
    await reports.applicationsModel.deleteMany({});
    await request(ownerApp).get(`/reports/${report.reportId}`).expect(410);
    clock.restore();
  });
  function principalApp(user) {
    const isolated = express();
    isolated.use((req, res, next) => {
      req.user = user;
      next();
    });
    isolated.get(
      '/reports/:reportId',
      require('../../../controllers/validation-reports-controller').retrieve,
    );
    isolated.use(require('../../../lib/error-handler').serviceExceptions);
    return isolated;
  }
  it('checks human ownership, admin override and current original-operation role', async () => {
    const response = (
      await call('post', '/api/groups?exemptionReport=details', group()).expect(201)
    ).body;
    const report = response.exemptionReport;
    const claims = await service.claims(report.reportId);
    await request(
      principalApp({ userAccountId: 'other-user', strategy: 'anonymId', role: 'editor' }),
    )
      .get(`/reports/${report.reportId}`)
      .expect(403);
    await request(
      principalApp({ userAccountId: 'other-user', strategy: 'anonymId', role: 'admin' }),
    )
      .get(`/reports/${report.reportId}`)
      .expect(200);
    await request(
      principalApp({
        userAccountId: claims.owner.userAccountId,
        strategy: 'anonymId',
        role: 'visitor',
      }),
    )
      .get(`/reports/${report.reportId}`)
      .expect(401);
  });
  it('separates basic/challenge/OIDC service realms and rereads current service permission', async () => {
    const snapshot = await policy.loadSnapshot();
    const collector = service.createCollector(
      snapshot,
      service.options({ exemptionReport: 'details' }, snapshot),
    );
    const user = { service: true, strategy: 'basic', serviceName: 'report-importer' };
    const report = await collector.finish(
      {
        user,
        method: 'POST',
        path: '/api/collection-bundles',
        validationReportAuthorization: {
          userRoles: ['admin', 'editor', 'team_lead'],
          serviceRoles: ['collection-manager'],
        },
      },
      true,
    );
    expect(config.serviceAuthn.basicApikey.serviceAccounts[0].serviceRole).toBe(
      'collection-manager',
    );
    expect((await service.claims(report.reportId)).authorization.serviceRoles).toEqual([
      'collection-manager',
    ]);
    await request(principalApp(user)).get(`/reports/${report.reportId}`).expect(200);
    await request(principalApp({ ...user, strategy: 'bearer' }))
      .get(`/reports/${report.reportId}`)
      .expect(403);
    await request(principalApp({ service: true, strategy: 'bearer', clientId: 'report-importer' }))
      .get(`/reports/${report.reportId}`)
      .expect(403);
    config.serviceAuthn.basicApikey.serviceAccounts[0].serviceRole = 'read-only';
    await request(principalApp(user)).get(`/reports/${report.reportId}`).expect(401);
    config.serviceAuthn.basicApikey.serviceAccounts[0].serviceRole = 'collection-manager';
    const saved = config.serviceAuthn.basicApikey.serviceAccounts;
    config.serviceAuthn.basicApikey.serviceAccounts = [];
    await request(principalApp(user)).get(`/reports/${report.reportId}`).expect(401);
    config.serviceAuthn.basicApikey.serviceAccounts = saved;
  });
  it('copies collector identity immediately and dedupes preflight/evaluation visits', async () => {
    const snapshot = await policy.loadSnapshot();
    const collector = service.createCollector(
      snapshot,
      service.options({ exemptionReport: 'details' }, snapshot),
    );
    const data = group(),
      result = policy.evaluateObject(data, snapshot);
    collector.collect({ data, result, phase: 'preflight' });
    collector.collect({ data, result, phase: 'evaluation' });
    const id = data.stix.id;
    data.stix.id = 'changed-after-collection';
    result.matchingExemptions[0].name = 'changed';
    const originalReport = (
      await call('post', '/api/groups?exemptionReport=details', group()).expect(201)
    ).body.exemptionReport;
    const claims = await service.claims(originalReport.reportId);
    const report = await collector.finish(
      {
        user: { userAccountId: claims.owner.userAccountId, strategy: 'anonymId' },
        validationReportAuthorization: claims.authorization,
      },
      false,
    );
    expect(report.ruleApplications).toBe(1);
    expect(report.evaluatedScope.revisions).toBe(1);
    expect(report.evaluatedScope.preflightOnlyRevisions).toBe(0);
    expect(report.details[0].object_ref).toBe(id);
    expect(report.details[0].ruleName).not.toBe('changed');
    expect(report.details[0].phase).toBe('evaluation');
  });
  function bundle() {
    const object = group().stix;
    object.x_mitre_attack_spec_version = config.app.attackSpecVersion;
    object.x_mitre_version = '1.0';
    object.external_references = [{ source_name: 'mitre-attack', external_id: 'G1234' }];
    const collection = {
      type: 'x-mitre-collection',
      id: `x-mitre-collection--${randomUUID()}`,
      name: `Report import ${randomUUID().replaceAll('-', '')}`,
      spec_version: '2.1',
      created: object.created,
      modified: object.modified,
      x_mitre_attack_spec_version: config.app.attackSpecVersion,
      x_mitre_version: '1.0',
      x_mitre_contents: [{ object_ref: object.id, object_modified: object.modified }],
    };
    return { type: 'bundle', id: `bundle--${randomUUID()}`, objects: [collection, object] };
  }
  const technique = () => ({
    workspace: { workflow: { state: 'work-in-progress' } },
    stix: {
      name: 'Conversion reporting regression',
      type: 'attack-pattern',
      spec_version: '2.1',
      description: 'Technique fixture',
      x_mitre_is_subtechnique: false,
      x_mitre_platforms: ['Windows'],
      x_mitre_domains: ['enterprise-attack'],
      kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'execution' }],
    },
  });
  async function subtechnique() {
    const parent = (await call('post', '/api/techniques', technique()).expect(201)).body;
    const child = (await call('post', '/api/techniques', technique()).expect(201)).body;
    await call('post', `/api/techniques/${child.stix.id}/convert-to-subtechnique`, {
      parentTechniqueAttackId: parent.workspace.attack_id,
    }).expect(200);
    const hierarchy = await Relationship.findOne({
      'stix.source_ref': child.stix.id,
      'stix.relationship_type': 'subtechnique-of',
    }).lean();
    return { parent, child, hierarchy };
  }
  it('reports one persisted hierarchy retirement with its exact conversion revision identity', async () => {
    const { child, hierarchy } = await subtechnique();
    const result = (
      await call(
        'post',
        `/api/techniques/${child.stix.id}/convert-to-technique?exemptionReport=details`,
        {},
      ).expect(200)
    ).body;
    const stored = await Relationship.find({ 'stix.id': hierarchy.stix.id }).lean();
    const retired = stored.filter((row) => row.stix.x_mitre_deprecated);
    expect(stored).toHaveLength(2);
    expect(retired).toHaveLength(1);
    const report = result.exemptionReport;
    expect(report.state).toBe('completed');
    expect(report.reportedExemptRevisions).toBe(1);
    expect(report.ruleApplications).toBe(1);
    expect(report.byRule).toEqual([expect.objectContaining({ ruleId: deprecated, count: 1 })]);
    expect(report.details).toEqual([
      expect.objectContaining({
        object_ref: hierarchy.stix.id,
        object_modified: new Date(retired[0].stix.modified).toISOString(),
        ruleId: deprecated,
        phase: 'evaluation',
      }),
    ]);
    expect(report.evaluatedScope).toEqual({
      revisions: 2,
      byOutcome: { valid: 1, exempt: 1 },
      preflightOnlyRevisions: 0,
    });
    expect((await getReport(report).expect(200)).body.details).toEqual(report.details);
    expect((await getReport(report).expect(200)).body.evaluatedScope).toEqual(
      report.evaluatedScope,
    );
  });
  it('retains conversion preflight scope without saving either revision when hierarchy ADM validation rejects', async () => {
    const { child, hierarchy } = await subtechnique();
    const primaryCount = await Model.countDocuments({ 'stix.id': child.stix.id });
    await Relationship.collection.updateOne(
      { _id: hierarchy._id },
      { $set: { 'stix.spec_version': 'invalid' } },
    );
    await rules.deleteById(deprecated);
    const result = (
      await call(
        'post',
        `/api/techniques/${child.stix.id}/convert-to-technique?exemptionReport=details`,
        {},
      ).expect(400)
    ).body;
    const report = result.exemptionReport;
    expect(result.message).toBe('ADM validation failed');
    expect(report.state).toBe('partial');
    expect(report.details).toEqual([]);
    expect(report.ruleApplications).toBe(0);
    expect(report.reportedExemptRevisions).toBe(0);
    expect(report.evaluatedScope).toEqual({
      revisions: 2,
      byOutcome: { valid: 1, invalid: 1 },
      preflightOnlyRevisions: 2,
    });
    expect(await Model.countDocuments({ 'stix.id': child.stix.id })).toBe(primaryCount);
    expect(await Relationship.countDocuments({ 'stix.id': hierarchy.stix.id })).toBe(1);
    expect((await getReport(report).expect(200)).body.evaluatedScope).toEqual(
      report.evaluatedScope,
    );
  });
  async function revokeFixture() {
    const primary = (await call('post', '/api/groups', group()).expect(201)).body;
    const replacement = (await call('post', '/api/groups', group()).expect(201)).body;
    await Model.collection.updateMany(
      { 'stix.id': { $in: [primary.stix.id, replacement.stix.id] } },
      { $set: { 'stix.x_mitre_deprecated': false } },
    );
    const relationship = (
      await call('post', '/api/relationships', {
        workspace: { workflow: { state: 'reviewed' } },
        stix: {
          type: 'relationship',
          spec_version: '2.1',
          relationship_type: 'uses',
          source_ref: primary.stix.id,
          target_ref: replacement.stix.id,
        },
      }).expect(201)
    ).body;
    return { primary, replacement, relationship };
  }
  it('labels every visited revoke guard as preflight when the primary ADM guard rejects', async () => {
    const { primary, replacement, relationship } = await revokeFixture();
    await rules.deleteById(revoked);
    const response = (
      await call('post', `/api/groups/${primary.stix.id}/revoke?exemptionReport=details`, {
        revoking: { stixId: replacement.stix.id, modified: replacement.stix.modified },
      }).expect(400)
    ).body;
    const report = response.exemptionReport;
    expect(response.message).toBe('ADM validation failed');
    expect(report.state).toBe('partial');
    expect(report.evaluatedScope).toEqual({
      revisions: 3,
      byOutcome: { exempt: 1, valid: 1, invalid: 1 },
      preflightOnlyRevisions: 3,
    });
    expect(report.reportedExemptRevisions).toBe(1);
    expect(report.ruleApplications).toBe(1);
    expect(report.details).toEqual([
      expect.objectContaining({
        object_ref: relationship.stix.id,
        ruleId: deprecated,
        phase: 'preflight',
      }),
    ]);
    expect(await Relationship.countDocuments({ 'stix.id': relationship.stix.id })).toBe(1);
    expect(
      await Relationship.countDocuments({
        'stix.id': relationship.stix.id,
        'stix.modified': new Date(report.details[0].object_modified),
      }),
    ).toBe(0);
    expect(await Model.countDocuments({ 'stix.id': primary.stix.id })).toBe(1);
    expect(
      await Relationship.countDocuments({
        'stix.source_ref': primary.stix.id,
        'stix.relationship_type': 'revoked-by',
      }),
    ).toBe(0);
    expect((await getReport(report).expect(200)).body.details).toEqual(report.details);
    expect((await getReport(report).expect(200)).body.evaluatedScope).toEqual(
      report.evaluatedScope,
    );
  });
  it('stops at a rejected related revoke guard before visiting or writing the primary', async () => {
    const { primary, replacement, relationship } = await revokeFixture();
    await rules.deleteById(deprecated);
    await Relationship.collection.updateOne(
      { 'stix.id': relationship.stix.id },
      { $set: { 'stix.spec_version': 'invalid' } },
    );
    const response = (
      await call('post', `/api/groups/${primary.stix.id}/revoke?exemptionReport=details`, {
        revoking: { stixId: replacement.stix.id, modified: replacement.stix.modified },
      }).expect(400)
    ).body;
    const report = response.exemptionReport;
    expect(response.message).toBe('ADM validation failed');
    expect(report.state).toBe('partial');
    expect(report.evaluatedScope).toEqual({
      revisions: 1,
      byOutcome: { invalid: 1 },
      preflightOnlyRevisions: 1,
    });
    expect(report.details).toEqual([]);
    expect(report.ruleApplications).toBe(0);
    expect(await Relationship.countDocuments({ 'stix.id': relationship.stix.id })).toBe(1);
    expect(await Model.countDocuments({ 'stix.id': primary.stix.id })).toBe(1);
    expect(
      await Relationship.countDocuments({
        'stix.source_ref': primary.stix.id,
        'stix.relationship_type': 'revoked-by',
      }),
    ).toBe(0);
    expect((await getReport(report).expect(200)).body.evaluatedScope).toEqual(
      report.evaluatedScope,
    );
  });
  it('reuses revoke preflight identities and replaces their phases when actual writes succeed', async () => {
    const { primary, replacement, relationship } = await revokeFixture();
    const result = (
      await call('post', `/api/groups/${primary.stix.id}/revoke?exemptionReport=details`, {
        revoking: { stixId: replacement.stix.id, modified: replacement.stix.modified },
      }).expect(200)
    ).body;
    const report = result.exemptionReport;
    expect(result.primary.stix.revoked).toBe(true);
    expect(report.state).toBe('completed');
    expect(report.evaluatedScope).toEqual({
      revisions: 3,
      byOutcome: { exempt: 2, valid: 1 },
      preflightOnlyRevisions: 0,
    });
    expect(report.reportedExemptRevisions).toBe(2);
    expect(report.ruleApplications).toBe(2);
    expect(report.details.map((row) => row.phase)).toEqual(['evaluation', 'evaluation']);
    expect(await Model.countDocuments({ 'stix.id': primary.stix.id })).toBe(2);
    expect(await Relationship.countDocuments({ 'stix.id': relationship.stix.id })).toBe(2);
    expect(
      await Relationship.countDocuments({
        'stix.source_ref': primary.stix.id,
        'stix.relationship_type': 'revoked-by',
      }),
    ).toBe(1);
    for (const row of report.details) {
      const model = row.object_ref.startsWith('relationship--') ? Relationship : Model;
      expect(
        await model.collection.countDocuments({
          'stix.id': row.object_ref,
          'stix.modified': new Date(row.object_modified),
        }),
      ).toBe(1);
    }
    expect((await getReport(report).expect(200)).body.details).toEqual(report.details);
    expect((await getReport(report).expect(200)).body.evaluatedScope).toEqual(
      report.evaluatedScope,
    );
  });
  it('evaluates import previews without running write hooks or changing stored diagnostics', async () => {
    const data = bundle();
    const groups = require('../../../services/stix/groups-service');
    const collections = require('../../../services/stix/collections-service');
    const before = sinon.spy(groups, 'beforeCreate');
    const after = sinon.spy(groups, 'afterCreate');
    const emitted = sinon.spy(groups, 'emitCreatedEvent');
    const collectionCreate = sinon.spy(collections, 'create');
    const preview = (
      await call('post', '/api/collection-bundles', data)
        .query({ previewOnly: true, validateContents: true, exemptionReport: 'details' })
        .expect(201)
    ).body;
    expect(preview.exemptionReport.evaluatedScope.revisions).toBe(2);
    expect(preview.exemptionReport.evaluatedScope.byOutcome.exempt).toBe(1);
    expect(preview.exemptionReport.details[0]).toMatchObject({
      object_ref: data.objects[1].id,
      ruleId: deprecated,
      phase: 'evaluation',
    });
    expect(preview.workspace.import_categories.additions).toContain(data.objects[1].id);
    expect(preview.workspace.import_categories.errors).toEqual([]);
    expect(before.called || after.called || emitted.called || collectionCreate.called).toBe(false);
    expect(await Model.countDocuments({ 'stix.id': { $in: data.objects.map((o) => o.id) } })).toBe(
      0,
    );
    const actual = (
      await call('post', '/api/collection-bundles', data)
        .query({ validateContents: true, exemptionReport: 'details' })
        .expect(201)
    ).body;
    expect(actual.exemptionReport.evaluatedScope).toEqual(preview.exemptionReport.evaluatedScope);
    expect(actual.workspace.import_categories).toEqual(preview.workspace.import_categories);
    const stored = await Model.collection.findOne({ 'stix.id': data.objects[1].id });
    const proposed = structuredClone(data);
    proposed.objects[0].modified = new Date(
      Date.parse(data.objects[0].modified) + 1000,
    ).toISOString();
    proposed.objects[1].modified = proposed.objects[0].modified;
    proposed.objects[0].x_mitre_contents[0].object_modified = proposed.objects[1].modified;
    await call('post', '/api/collection-bundles', proposed)
      .query({ previewOnly: true, exemptionReport: 'details' })
      .expect(201);
    expect(await Model.collection.findOne({ 'stix.id': data.objects[1].id })).toEqual(stored);
  });
  it('reports strict preview rejection after removing an exemption, independently of filters', async () => {
    await policyRepository.mutateRules(() => ({
      rules: baseline.filter((r) => String(r._id) !== deprecated),
    }));
    const data = bundle();
    const admCall = admOnlyClient();
    const preview = (
      await admCall('post', '/api/collection-bundles', data)
        .query({
          previewOnly: true,
          validateContents: true,
          exemptionReport: 'details',
          exemptionStatuses: 'revoked',
        })
        .expect(201)
    ).body;
    expect(preview.exemptionReport.evaluatedScope.byOutcome.invalid).toBe(2);
    expect(preview.exemptionReport.reportedExemptRevisions).toBe(0);
    expect(preview.workspace.import_categories.errors).toEqual([
      expect.objectContaining({
        object_ref: data.objects[1].id,
        error_type: 'Validation error',
        details: expect.any(Array),
      }),
    ]);
    expect(await Model.countDocuments({ 'stix.id': { $in: data.objects.map((o) => o.id) } })).toBe(
      0,
    );
    const actual = (
      await admCall('post', '/api/collection-bundles', data)
        .query({ validateContents: true, exemptionReport: 'details' })
        .expect(201)
    ).body;
    expect(actual.exemptionReport.evaluatedScope).toEqual(preview.exemptionReport.evaluatedScope);
    // Persistence retains the existing import-history schema, which omits
    // issue details; preview still includes those in-memory ADM issues.
    const { details, ...expectedError } = preview.workspace.import_categories.errors[0];
    expect(details.length).toBeGreaterThan(0);
    expect(actual.workspace.import_categories.errors).toEqual([expectedError]);
    expect(actual.workspace.import_categories.additions).toEqual(
      preview.workspace.import_categories.additions,
    );
    expect(await Model.countDocuments({ 'stix.id': data.objects[1].id })).toBe(0);
  });
  it('retains preview evidence from its snapshot when reporting filters hide a matching exemption', async () => {
    const data = bundle();
    data.objects[0].x_mitre_deprecated = true;
    const preview = (
      await call('post', '/api/collection-bundles', data)
        .query({ previewOnly: true, exemptionReport: 'details', exemptionStatuses: 'revoked' })
        .expect(201)
    ).body;
    expect(preview.exemptionReport.evaluatedScope.byOutcome.exempt).toBe(2);
    expect(preview.exemptionReport.reportedExemptRevisions).toBe(0);
    await rules.deleteById(deprecated);
    const retained = (await getReport(preview.exemptionReport).expect(200)).body;
    expect(retained.reportedExemptRevisions).toBe(2);
    expect(retained.details.map((d) => d.object_ref).sort()).toEqual(
      data.objects.map((o) => o.id).sort(),
    );
    expect(retained.policyRevision).toBe(preview.exemptionReport.policyRevision);
    expect(retained.details.every((d) => d.ruleId === deprecated)).toBe(true);
    expect(await Model.countDocuments({ 'stix.id': { $in: data.objects.map((o) => o.id) } })).toBe(
      0,
    );
  });
  it('reports collection imports without changing import history or exported STIX', async () => {
    const data = bundle();
    const imported = (
      await call('post', '/api/collection-bundles?exemptionReport=details', data).expect(201)
    ).body;
    expect(imported.exemptionReport.reportedExemptRevisions).toBe(1);
    expect(imported.exemptionReport.details[0].object_ref).toBe(data.objects[1].id);
    const stored = await Model.collection.findOne({ 'stix.id': data.objects[0].id });
    expect(stored.workspace.import_categories).toEqual(imported.workspace.import_categories);
    expect(stored.exemptionReport).toBeUndefined();
    const exported = (
      await call('get', `/api/collection-bundles?collectionId=${data.objects[0].id}`).expect(200)
    ).body;
    expect(JSON.stringify(exported)).not.toContain('exemptionReport');
    expect(exported.objects.find((o) => o.id === data.objects[1].id).x_mitre_deprecated).toBe(true);
  });
  it('retains partial evaluated evidence when an import fails after persistent writes', async () => {
    const importService = require('../../../services/stix/collection-bundles-service');
    const originalImport = importService.importBundle;
    sinon.stub(importService, 'importBundle').callsFake(async (...args) => {
      await originalImport(...args);
      throw new Error('Unexpected post-import failure');
    });
    const data = bundle();
    const response = (
      await call('post', '/api/collection-bundles?exemptionReport=details', data).expect(500)
    ).body;
    expect(response.result).toContain('Server error');
    expect(response.exemptionReport.state).toBe('partial');
    expect(response.exemptionReport.reportedExemptRevisions).toBe(1);
    expect((await getReport(response.exemptionReport).expect(200)).body.state).toBe('partial');
    expect(await Model.countDocuments({ 'stix.id': data.objects[1].id })).toBe(1);
  });
  it('augments only terminal complete/error SSE events and preserves the actual import result', async () => {
    const data = bundle();
    const success = await call(
      'post',
      '/api/collection-bundles?stream=true&exemptionReport=details',
      data,
    ).expect(200);
    const complete = success.text
      .split('\n\n')
      .find((event) => event.startsWith('event: complete'));
    const payload = JSON.parse(complete.split('data: ')[1]);
    expect(payload.stix.id).toBe(data.objects[0].id);
    expect(payload.exemptionReport.ruleApplications).toBe(1);
    expect(payload.exemptionReport.state).toBe('completed');
    for (const event of success.text
      .split('\n\n')
      .filter((event) => event.startsWith('event: progress')))
      expect(event).not.toContain('exemptionReport');
    const failure = await call(
      'post',
      '/api/collection-bundles?stream=true&exemptionReport=details',
      { type: 'bundle', id: `bundle--${randomUUID()}`, objects: [] },
    ).expect(200);
    const error = failure.text.split('\n\n').find((event) => event.startsWith('event: error'));
    expect(JSON.parse(error.split('data: ')[1]).exemptionReport.state).toBe('partial');
  });
  it('preserves the terminal SSE success and persisted import when report retention fails', async () => {
    const data = bundle();
    const failure = sinon.stub(reports, 'save').rejects(new Error('SSE report retention failure'));
    try {
      const success = await call(
        'post',
        '/api/collection-bundles?stream=true&exemptionReport=details',
        data,
      ).expect(200);
      const terminal = success.text
        .split('\n\n')
        .filter((event) => /^event: (complete|error)/.test(event));
      expect(terminal).toHaveLength(1);
      expect(terminal[0]).toMatch(/^event: complete\n/);
      const result = JSON.parse(terminal[0].split('data: ')[1]);
      expect(result.stix.id).toBe(data.objects[0].id);
      expect(result.workspace.import_categories.additions).toContain(data.objects[1].id);
      expect(result.exemptionReport).toEqual(
        expect.objectContaining({
          state: 'completed',
          availability: 'unavailable',
          reportId: null,
          ruleApplications: 1,
        }),
      );
      const stored = await Model.collection.findOne({
        'stix.id': data.objects[1].id,
        'stix.modified': new Date(data.objects[1].modified),
      });
      expect(stored.stix).toEqual(
        expect.objectContaining({
          id: data.objects[1].id,
          x_mitre_deprecated: true,
          x_mitre_domains: ['invalid-domain'],
        }),
      );
      expect(await Model.countDocuments({ 'stix.id': data.objects[1].id })).toBe(1);
      const collection = await Model.collection.findOne({ 'stix.id': data.objects[0].id });
      expect(collection.workspace.import_categories).toEqual(result.workspace.import_categories);
      expect(collection.exemptionReport).toBeUndefined();
      expect(failure.calledOnce).toBe(true);
      expect(await reports.model.countDocuments()).toBe(0);
      expect(await reports.applicationsModel.countDocuments()).toBe(0);
    } finally {
      failure.restore();
      await Model.deleteMany({ 'stix.id': { $in: data.objects.map((object) => object.id) } });
    }
  });
  it('allows the importing basic service to retrieve its report, then revokes access on role change', async () => {
    const data = bundle();
    const imported = (
      await request(app)
        .post('/api/collection-bundles?exemptionReport=details')
        .auth('report-importer', 'test-key')
        .send(data)
        .expect(201)
    ).body;
    await request(app)
      .get(`/api/validation-reports/${imported.exemptionReport.reportId}`)
      .auth('report-importer', 'test-key')
      .expect(200);
    config.serviceAuthn.basicApikey.serviceAccounts[0].serviceRole = 'read-only';
    await request(app)
      .get(`/api/validation-reports/${imported.exemptionReport.reportId}`)
      .auth('report-importer', 'test-key')
      .expect(401);
    config.serviceAuthn.basicApikey.serviceAccounts[0].serviceRole = 'collection-manager';
  });
  it('evaluates release previews under the publication policy without reviewing or saving', async () => {
    const object = (await call('post', '/api/groups', group()).expect(201)).body;
    const track = (
      await call('post', '/api/release-tracks/new', {
        name: `Preview ${randomUUID().replaceAll('-', '')}`,
        type: 'standard',
      }).expect(201)
    ).body;
    await call('post', `/api/release-tracks/${track.id}/candidates`, {
      object_refs: [{ id: object.stix.id, modified: object.stix.modified }],
    }).expect(200);
    await call('post', `/api/release-tracks/${track.id}/candidates/promote`, {
      object_refs: [object.stix.id],
    }).expect(200);
    const snapshot = (
      await call('get', `/api/release-tracks/${track.id}/snapshots/latest`).expect(200)
    ).body;
    // Evaluation must use the full reviewed schema without changing stored workflow.
    await Model.collection.updateOne(
      { 'stix.id': object.stix.id },
      { $set: { 'workspace.workflow.state': 'work-in-progress' } },
    );
    const before = await Model.collection.findOne({ 'stix.id': object.stix.id });
    const historyPath = `/api/release-tracks/${track.id}/snapshots`;
    const history = (await call('get', historyPath).expect(200)).body;
    const targets = ['latest', encodeURIComponent(snapshot.modified)];
    for (const target of targets) {
      for (const format of ['summary', 'workbench', 'bundle']) {
        const path = `/api/release-tracks/${track.id}/snapshots/${target}/release/preview`;
        const preview = (
          await call('get', path).query({ format, exemptionReport: 'details' }).expect(200)
        ).body;
        expect(preview.exemptionReport.evaluatedScope).toEqual({
          revisions: 1,
          byOutcome: { exempt: 1 },
          preflightOnlyRevisions: 1,
        });
        expect(preview.exemptionReport.reportedExemptRevisions).toBe(1);
        expect(preview.exemptionReport.details[0]).toMatchObject({
          object_ref: object.stix.id,
          ruleId: deprecated,
          phase: 'preflight',
        });
      }
    }
    await rules.updateById(deprecated, {
      ...baseline.find((rule) => String(rule._id) === deprecated),
      enabled: false,
    });
    for (const target of targets) {
      for (const format of ['summary', 'workbench', 'bundle']) {
        const path = `/api/release-tracks/${track.id}/snapshots/${target}/release/preview`;
        const failure = (
          await call('get', path).query({ format, exemptionReport: 'details' }).expect(400)
        ).body;
        expect(failure.message).toBe('ADM validation failed');
        expect(failure.details).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: ['x_mitre_domains', 0] }),
            expect.objectContaining({ path: ['x_mitre_version'] }),
          ]),
        );
        expect(failure.exemptionReport.evaluatedScope.byOutcome).toEqual({ invalid: 1 });
        expect(failure.exemptionReport.state).toBe('partial');
      }
    }
    // A quiet preview must enforce ADM too; reporting never changes enforcement.
    await call('get', `/api/release-tracks/${track.id}/snapshots/latest/release/preview`).expect(
      400,
    );
    const publication = (
      await call('post', `/api/release-tracks/${track.id}/snapshots/latest/release`, {
        version: '1.0',
      }).expect(400)
    ).body;
    expect(publication.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ['x_mitre_domains', 0] }),
        expect.objectContaining({ path: ['x_mitre_version'] }),
      ]),
    );
    expect(await Model.collection.findOne({ 'stix.id': object.stix.id })).toEqual(before);
    expect((await call('get', historyPath).expect(200)).body).toEqual(history);
  });

  it('captures release bundle import, admission, review and publication in their original operations', async () => {
    const data = bundle();
    const imported = (
      await call(
        'post',
        '/api/release-tracks/new-from-bundle?exemptionReport=details',
        data,
      ).expect(201)
    ).body;
    expect(imported.exemptionReport.reportedExemptRevisions).toBe(1);
    const object = (await call('post', '/api/groups', group()).expect(201)).body;
    const track = (
      await call('post', '/api/release-tracks/new', {
        name: `Report ${randomUUID().replaceAll('-', '')}`,
        type: 'standard',
      }).expect(201)
    ).body;
    const admitted = (
      await call('post', `/api/release-tracks/${track.id}/candidates?exemptionReport=details`, {
        object_refs: [{ id: object.stix.id, modified: object.stix.modified }],
      }).expect(200)
    ).body;
    expect(admitted.exemptionReport.state).toBe('completed');
    const reviewed = (
      await call(
        'post',
        `/api/release-tracks/${track.id}/candidates/promote?exemptionReport=details`,
        { object_refs: [object.stix.id] },
      ).expect(200)
    ).body;
    expect(reviewed.exemptionReport.reportedExemptRevisions).toBe(1);
    const published = (
      await call(
        'post',
        `/api/release-tracks/${track.id}/snapshots/latest/release?exemptionReport=details`,
        { version: '1.0' },
      ).expect(200)
    ).body;
    expect(published.exemptionReport.reportedExemptRevisions).toBe(1);
    const exported = (
      await call('get', `/api/release-tracks/${track.id}/snapshots/latest?format=bundle`).expect(
        200,
      )
    ).body;
    expect(JSON.stringify(exported)).not.toContain('exemptionReport');
  });
  it('captures revoke preflight once per exact revision/rule', async () => {
    const primary = (await call('post', '/api/groups', group()).expect(201)).body;
    const replacement = (await call('post', '/api/groups', group()).expect(201)).body;
    await Model.collection.updateOne(
      { 'stix.id': replacement.stix.id },
      { $set: { 'stix.x_mitre_deprecated': false } },
    );
    const result = (
      await call('post', `/api/groups/${primary.stix.id}/revoke?exemptionReport=details`, {
        revoking: { stixId: replacement.stix.id, modified: replacement.stix.modified },
      }).expect(200)
    ).body;
    expect(result.primary.stix.revoked).toBe(true);
    const entries = result.exemptionReport.details.filter((r) => r.object_ref === primary.stix.id);
    expect(entries.filter((r) => r.ruleId === revoked)).toHaveLength(1);
    expect(entries.filter((r) => r.ruleId === deprecated)).toHaveLength(1);
    expect(
      new Set(entries.map((r) => JSON.stringify([r.object_ref, r.object_modified, r.ruleId]))).size,
    ).toBe(entries.length);
  });
  it('preserves configuration204 while retaining summary evidence via compact headers', async () => {
    const identity = (await call('get', '/api/config/organization-identity').expect(200)).body;
    const response = await call(
      'post',
      '/api/config/organization-identity?exemptionReport=summary',
      { id: identity.stix.id },
    ).expect(204);
    expect(response.text).toBe('');
    expect(response.headers['x-validation-report-availability']).toBe('retained');
    expect(response.headers['x-validation-report-state']).toBe('completed');
    expect(response.headers['access-control-expose-headers']).toContain('X-Validation-Report-Id');
    const retained = await call(
      'get',
      `/api/validation-reports/${response.headers['x-validation-report-id']}`,
    ).expect(200);
    expect(retained.body.reportedExemptRevisions).toBe(
      Number(response.headers['x-validation-report-exempt-revisions']),
    );
  });
  it('retains signed report/cursor access across a fresh service instance and session-secret changes', async () => {
    const response = await bothReport();
    const report = response.exemptionReport;
    const modulePath = require.resolve('../../../services/validation-reports-service');
    delete require.cache[modulePath];
    const restarted = require(modulePath);
    const oldSecret = config.session.secret;
    config.session.secret = 'a different session secret after restart';
    try {
      const claims = await restarted.claims(report.reportId);
      expect(claims.owner.kind).toBe('human');
      const continued = await restarted.retrieve(
        report.reportId,
        { exemptionCursor: report.nextCursor, exemptionLimit: 1 },
        claims,
      );
      expect(continued.status).toBe(200);
      expect(continued.body.details).toHaveLength(1);
      expect(continued.body.hasMore).toBe(false);
    } finally {
      config.session.secret = oldSecret;
    }
  });
  it('bounds bulk pages to50 by default and100 maximum and counts overlapping matches independently', async () => {
    await rules.save({
      kind: 'object-exemption',
      name: 'Deprecated groups',
      enabled: true,
      retirementStatus: 'deprecated',
      stixTypes: ['intrusion-set'],
    });
    const snapshot = await policy.loadSnapshot();
    const collector = service.createCollector(
      snapshot,
      service.options({ exemptionReport: 'details', exemptionLimit: '100' }, snapshot),
    );
    for (let index = 0; index < 125; index++) {
      const data = group();
      collector.collect({
        data,
        result: policy.evaluateObject(data, snapshot),
        phase: 'preflight',
      });
      collector.collect({
        data,
        result: policy.evaluateObject(data, snapshot),
        phase: 'evaluation',
      });
    }
    const originalReport = (
      await call('post', '/api/groups?exemptionReport=details', group()).expect(201)
    ).body.exemptionReport;
    const claims = await service.claims(originalReport.reportId);
    const report = await collector.finish(
      {
        user: { userAccountId: claims.owner.userAccountId, strategy: 'anonymId' },
        validationReportAuthorization: claims.authorization,
      },
      true,
    );
    expect(report.reportedExemptRevisions).toBe(125);
    expect(report.ruleApplications).toBe(250);
    expect(report.details).toHaveLength(100);
    expect(report.truncated).toBe(true);
    expect(report.evaluatedScope.revisions).toBe(125);
    const first = (await getReport(report).expect(200)).body;
    expect(first.details).toHaveLength(50);
    let current = first,
      visited = [...first.details];
    while (current.hasMore) {
      current = (await getReport(report, { exemptionCursor: current.nextCursor }).expect(200)).body;
      visited.push(...current.details);
    }
    expect(visited).toHaveLength(250);
    expect(
      new Set(visited.map((r) => JSON.stringify([r.object_ref, r.object_modified, r.ruleId]))).size,
    ).toBe(250);
    expect(current.truncated).toBe(false);
  });
  it('preserves204 configuration success when optional retention is unavailable', async () => {
    const identity = (await call('get', '/api/config/organization-identity').expect(200)).body;
    sinon.stub(reports, 'save').rejects(new Error('report unavailable'));
    const response = await call(
      'post',
      '/api/config/organization-identity?exemptionReport=details',
      { id: identity.stix.id },
    ).expect(204);
    expect(response.headers['x-validation-report-availability']).toBe('unavailable');
    expect(response.headers['x-validation-report-id']).toBeUndefined();
    expect(response.text).toBe('');
  });
  it('retains visited preflight scope on deterministic propagation failure before primary writes', async () => {
    const tactic = (
      await call('post', '/api/tactics', {
        workspace: { workflow: { state: 'work-in-progress' } },
        stix: {
          type: 'x-mitre-tactic',
          spec_version: '2.1',
          name: 'Report preflight tactic',
          x_mitre_shortname: 'execution',
          x_mitre_domains: ['enterprise-attack'],
        },
      }).expect(201)
    ).body;
    const technique = (retired) => ({
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        type: 'attack-pattern',
        spec_version: '2.1',
        name: 'Report preflight dependent',
        x_mitre_is_subtechnique: false,
        x_mitre_platforms: ['Windows'],
        x_mitre_domains: ['enterprise-attack'],
        kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'execution' }],
        x_mitre_deprecated: retired,
      },
    });
    const exempt = (await call('post', '/api/techniques', technique(true)).expect(201)).body;
    const invalid = (await call('post', '/api/techniques', technique(false)).expect(201)).body;
    await Model.collection.updateOne(
      { 'stix.id': invalid.stix.id },
      { $set: { 'stix.x_mitre_domains': ['invalid-domain'] } },
    );
    const changed = {
      workspace: tactic.workspace,
      stix: {
        ...tactic.stix,
        modified: new Date(Date.now() + 1000).toISOString(),
        x_mitre_shortname: 'changedexecution',
      },
    };
    const response = (
      await call('post', '/api/tactics?exemptionReport=details', changed).expect(400)
    ).body;
    expect(response.exemptionReport.state).toBe('partial');
    expect(response.exemptionReport.evaluatedScope.preflightOnlyRevisions).toBeGreaterThan(0);
    expect(response.exemptionReport.evaluatedScope.byOutcome.invalid).toBe(1);
    expect(await Model.countDocuments({ 'stix.id': tactic.stix.id })).toBe(1);
    expect(await Model.countDocuments({ 'stix.id': exempt.stix.id })).toBe(1);
    expect(await Model.countDocuments({ 'stix.id': invalid.stix.id })).toBe(1);
    expect((await getReport(response.exemptionReport).expect(200)).body.evaluatedScope).toEqual(
      response.exemptionReport.evaluatedScope,
    );
  });
});
