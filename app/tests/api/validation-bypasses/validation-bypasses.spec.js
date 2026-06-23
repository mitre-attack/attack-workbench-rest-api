const request = require('supertest');
const { expect } = require('expect');

const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const ValidationBypassRule = require('../../../models/validation-bypass-rule-model');

const logger = require('../../../lib/logger');
logger.level = 'debug';

const initialRuleData = {
  fieldPath: ['x_test_field'],
  errorCode: 'custom',
  stixType: 'x-test-validation-bypass',
  suppressError: false,
  warningMessage: 'Test warning.',
};

const secondaryRuleData = {
  fieldPath: ['x_test_other_field'],
  errorCode: 'invalid_type',
  stixType: 'x-test-validation-bypass',
  suppressError: true,
};

const runtimeBypassRuleData = {
  fieldPath: ['x_mitre_platforms', '0'],
  errorCode: 'invalid_value',
  stixType: 'attack-pattern',
  suppressError: true,
};

function buildTechniqueWithInvalidPlatform() {
  const timestamp = new Date().toISOString();
  return {
    workspace: {
      workflow: {
        state: 'work-in-progress',
      },
    },
    stix: {
      name: 'technique with invalid platform',
      spec_version: '2.1',
      type: 'attack-pattern',
      description: 'This technique intentionally uses a non-ADM platform.',
      object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
      created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
      kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'impact' }],
      x_mitre_modified_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
      x_mitre_detection: 'detection text',
      x_mitre_is_subtechnique: false,
      x_mitre_impact_type: ['Availability'],
      x_mitre_platforms: ['BogusOS'],
      x_mitre_network_requirements: true,
      created: timestamp,
      modified: timestamp,
    },
  };
}

describe('Validation Bypasses API', function () {
  let app;
  let passportCookie;

  before(async function () {
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();
    await ValidationBypassRule.init();

    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;

    app = await require('../../../index').initializeApp();
    passportCookie = await login.loginAnonymous(app);
  });

  it('GET /api/config/validation-bypasses returns validation bypass rules', async function () {
    const res = await request(app)
      .get('/api/config/validation-bypasses')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const rules = res.body;
    expect(rules).toBeDefined();
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
  });

  it('POST /api/config/validation-bypasses does not create an empty rule', async function () {
    await request(app)
      .post('/api/config/validation-bypasses')
      .send({})
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(400);
  });

  let rule1;
  it('POST /api/config/validation-bypasses creates a rule', async function () {
    const res = await request(app)
      .post('/api/config/validation-bypasses')
      .send(initialRuleData)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    rule1 = res.body;
    expect(rule1).toBeDefined();
    expect(rule1._id).toBeDefined();
    expect(rule1.fieldPath).toEqual(initialRuleData.fieldPath);
    expect(rule1.errorCode).toBe(initialRuleData.errorCode);
    expect(rule1.stixType).toBe(initialRuleData.stixType);
    expect(rule1.suppressError).toBe(false);
    expect(rule1.warningMessage).toBe(initialRuleData.warningMessage);
    expect(rule1.autoCreated).toBe(false);
  });

  it('GET /api/config/validation-bypasses/:id returns the created rule', async function () {
    const res = await request(app)
      .get('/api/config/validation-bypasses/' + rule1._id)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const rule = res.body;
    expect(rule).toBeDefined();
    expect(rule._id).toBe(rule1._id);
    expect(rule.fieldPath).toEqual(rule1.fieldPath);
    expect(rule.errorCode).toBe(rule1.errorCode);
    expect(rule.stixType).toBe(rule1.stixType);
  });

  it('GET /api/config/validation-bypasses returns paginated validation bypass rules', async function () {
    const res = await request(app)
      .get('/api/config/validation-bypasses?includePagination=true&limit=1')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    expect(res.body).toBeDefined();
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.total).toBeGreaterThan(0);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(1);
  });

  it('PUT /api/config/validation-bypasses/:id does not update a rule when the body is missing required properties', async function () {
    await request(app)
      .put('/api/config/validation-bypasses/' + rule1._id)
      .send({ warningMessage: 'No matching criteria.' })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(400);
  });

  it('PUT /api/config/validation-bypasses/:id does not update a rule when the id is not found', async function () {
    await request(app)
      .put('/api/config/validation-bypasses/000000000000000000000000')
      .send(initialRuleData)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(404);
  });

  it('PUT /api/config/validation-bypasses/:id updates a rule', async function () {
    const updatedRule = {
      ...rule1,
      fieldPath: ['x_test_field', 'nested'],
      errorCode: 'invalid_type',
      suppressError: true,
      warningMessage: 'Updated test warning.',
    };

    const res = await request(app)
      .put('/api/config/validation-bypasses/' + rule1._id)
      .send(updatedRule)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    rule1 = res.body;
    expect(rule1).toBeDefined();
    expect(rule1.fieldPath).toEqual(updatedRule.fieldPath);
    expect(rule1.errorCode).toBe(updatedRule.errorCode);
    expect(rule1.suppressError).toBe(true);
    expect(rule1.warningMessage).toBe(updatedRule.warningMessage);
  });

  it('POST /api/config/validation-bypasses does not create a duplicate rule', async function () {
    await request(app)
      .post('/api/config/validation-bypasses')
      .send(rule1)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(409);
  });

  let rule2;
  it('POST /api/config/validation-bypasses creates a second rule', async function () {
    const res = await request(app)
      .post('/api/config/validation-bypasses')
      .send(secondaryRuleData)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    rule2 = res.body;
    expect(rule2).toBeDefined();
    expect(rule2._id).toBeDefined();
  });

  it('PUT /api/config/validation-bypasses/:id does not update a rule to duplicate another rule', async function () {
    await request(app)
      .put('/api/config/validation-bypasses/' + rule2._id)
      .send({
        fieldPath: rule1.fieldPath,
        errorCode: rule1.errorCode,
        stixType: rule1.stixType,
        suppressError: true,
      })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(409);
  });

  it('POST /api/techniques rejects an ADM validation error before a runtime bypass rule exists', async function () {
    await request(app)
      .post('/api/techniques')
      .send(buildTechniqueWithInvalidPlatform())
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(400);
  });

  let runtimeRule;
  it('POST /api/config/validation-bypasses creates a rule that is immediately honored by ADM validation', async function () {
    const bypassRes = await request(app)
      .post('/api/config/validation-bypasses')
      .send(runtimeBypassRuleData)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    runtimeRule = bypassRes.body;

    const techniqueRes = await request(app)
      .post('/api/techniques')
      .send(buildTechniqueWithInvalidPlatform())
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    expect(techniqueRes.body).toBeDefined();
    expect(techniqueRes.body.stix.x_mitre_platforms).toEqual(['BogusOS']);
  });

  it('DELETE /api/config/validation-bypasses/:id does not delete a rule when the id is not found', async function () {
    await request(app)
      .delete('/api/config/validation-bypasses/000000000000000000000000')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(404);
  });

  it('DELETE /api/config/validation-bypasses/:id deletes a rule', async function () {
    await request(app)
      .delete('/api/config/validation-bypasses/' + rule1._id)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(204);

    await request(app)
      .get('/api/config/validation-bypasses/' + rule1._id)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(404);
  });

  after(async function () {
    if (rule2?._id) {
      await ValidationBypassRule.findByIdAndDelete(rule2._id).exec();
    }
    if (runtimeRule?._id) {
      await ValidationBypassRule.findByIdAndDelete(runtimeRule._id).exec();
    }
    await database.closeConnection();
  });
});
