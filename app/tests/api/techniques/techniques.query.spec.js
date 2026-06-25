const request = require('supertest');
const { expect } = require('expect');
const _ = require('lodash');
const uuid = require('uuid');

const config = require('../../../config/config');
const login = require('../../shared/login');

const logger = require('../../../lib/logger');
logger.level = 'debug';

const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');

const techniquesService = require('../../../services/stix/techniques-service');

// Base technique used to derive all of the seeded query fixtures. Each created
// technique deep-clones this and overrides only the fields a given test cares
// about (deprecated/revoked status, workflow state, domain, platform).
const baseTechnique = {
  workspace: {
    workflow: {},
  },
  stix: {
    spec_version: '2.1',
    type: 'attack-pattern',
    description: 'This is a technique.',
    external_references: [{ source_name: 'source-1', external_id: 's1' }],
    object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
    created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
    kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'execution' }],
    x_mitre_detection: 'detection text',
    x_mitre_is_subtechnique: false,
    x_mitre_version: '1.0',
    x_mitre_domains: ['enterprise-attack'],
    x_mitre_platforms: ['Linux', 'macOS'],
  },
};

function asyncWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function configureAndLoadTechniques(baseTechnique) {
  // Helper: create a technique from config
  async function createTechnique(overrides) {
    const data = _.cloneDeep(baseTechnique);
    Object.assign(data.stix, overrides.stix || {});
    if (overrides.workspace) {
      data.workspace = { ...data.workspace, ...overrides.workspace };
    }

    if (!data.stix.name) {
      data.stix.name = `attack-pattern-${data.stix.x_mitre_deprecated}-undefined`;
    }
    if (!data.stix.created) {
      const timestamp = new Date().toISOString();
      data.stix.created = timestamp;
      data.stix.modified = timestamp;
    }

    return techniquesService.create(data);
  }

  // technique 1: x_mitre_deprecated,revoked undefined, state undefined
  const technique1 = await createTechnique({});

  // technique 2: x_mitre_deprecated = false, state = work-in-progress, mobile-attack domain.
  // Adds a unique platform ('Windows') so the platform-filter test can target it.
  await createTechnique({
    stix: {
      x_mitre_deprecated: false,
      x_mitre_domains: ['mobile-attack'],
      x_mitre_platforms: [...baseTechnique.stix.x_mitre_platforms, 'Windows'],
    },
    workspace: { workflow: { state: 'work-in-progress' } },
  });

  // technique 3: x_mitre_deprecated = true, state = awaiting-review
  await createTechnique({
    stix: { x_mitre_deprecated: true },
    workspace: { workflow: { state: 'awaiting-review' } },
  });

  // technique 4: revoked via the revoke workflow (x_mitre_deprecated = false)
  // Use technique1 as the revoking object
  const technique4 = await createTechnique({
    stix: { x_mitre_deprecated: false },
    workspace: { workflow: { state: 'awaiting-review' } },
  });
  await techniquesService.revoke(technique4.stix.id, {
    revoking: { stixId: technique1.stix.id, modified: technique1.stix.modified },
  });

  // technique 5: multiple versions, last version deprecated + revoked
  const id = `attack-pattern--${uuid.v4()}`;
  const createdTimestamp = new Date().toISOString();

  const data5a = _.cloneDeep(baseTechnique);
  data5a.stix.id = id;
  data5a.stix.name = 'multiple-versions';
  data5a.workspace.workflow = { state: 'awaiting-review' };
  data5a.stix.created = createdTimestamp;
  data5a.stix.modified = createdTimestamp;
  await techniquesService.create(data5a);

  await asyncWait(10);
  const data5b = _.cloneDeep(baseTechnique);
  data5b.stix.id = id;
  data5b.stix.name = 'multiple-versions';
  data5b.workspace.workflow = { state: 'awaiting-review' };
  data5b.stix.created = createdTimestamp;
  data5b.stix.modified = new Date().toISOString();
  await techniquesService.create(data5b);

  await asyncWait(10);
  const data5c = _.cloneDeep(baseTechnique);
  data5c.stix.id = id;
  data5c.stix.name = 'multiple-versions';
  data5c.workspace.workflow = { state: 'awaiting-review' };
  data5c.stix.x_mitre_deprecated = true;
  data5c.stix.created = createdTimestamp;
  data5c.stix.modified = new Date().toISOString();
  await techniquesService.create(data5c);

  // Revoke technique 5 using technique1 as the revoking object
  await techniquesService.revoke(id, {
    revoking: { stixId: technique1.stix.id, modified: technique1.stix.modified },
  });

  // technique 6: x_mitre_deprecated = false, state = work-in-progress
  await createTechnique({
    stix: { x_mitre_deprecated: false },
    workspace: { workflow: { state: 'work-in-progress' } },
  });

  // technique 7: x_mitre_deprecated = false, state = reviewed
  await createTechnique({
    stix: { x_mitre_deprecated: false },
    workspace: { workflow: { state: 'reviewed' } },
  });
}

describe('Techniques Query API', function () {
  let app;
  let passportCookie;

  before(async function () {
    // Establish the database connection
    // Use an in-memory database that we spin up for the test
    await database.initializeConnection();

    // Check for a valid database configuration
    await databaseConfiguration.checkSystemConfiguration();

    // Enable ADM validation; the seeded fixtures below are ADM-compliant
    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;

    // Initialize the express app
    app = await require('../../../index').initializeApp();

    await configureAndLoadTechniques(baseTechnique);

    // Log into the app
    passportCookie = await login.loginAnonymous(app);
  });

  it('GET /api/techniques should return the preloaded techniques (not deprecated, not revoked)', async function () {
    const res = await request(app)
      .get('/api/techniques')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // Expect techniques 1, 2, 6, and 7
    const techniques = res.body;
    expect(techniques).toBeDefined();
    expect(Array.isArray(techniques)).toBe(true);
    expect(techniques.length).toBe(4);
  });

  it('GET /api/techniques should return techniques with x_mitre_deprecated not set to true (false or undefined)', async function () {
    const res = await request(app)
      .get('/api/techniques?includeDeprecated=false')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // Expect techniques 1, 2, 6, and 7
    const techniques = res.body;
    expect(techniques).toBeDefined();
    expect(Array.isArray(techniques)).toBe(true);
    expect(techniques.length).toBe(4);
  });

  it('GET /api/techniques should include deprecated techniques (excluding revoked)', async function () {
    const res = await request(app)
      .get('/api/techniques?includeDeprecated=true')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // Expect techniques 1, 2, 3, 6, and 7
    const techniques = res.body;
    expect(techniques).toBeDefined();
    expect(Array.isArray(techniques)).toBe(true);
    expect(techniques.length).toBe(5);
  });

  it('GET /api/techniques should return techniques with revoked not set to true (false or undefined)', async function () {
    const res = await request(app)
      .get('/api/techniques?includeRevoked=false')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // Expect techniques 1,2, 6, and 7
    const techniques = res.body;
    expect(techniques).toBeDefined();
    expect(Array.isArray(techniques)).toBe(true);
    expect(techniques.length).toBe(4);
  });

  it('GET /api/techniques should include revoked techniques (but not deprecated)', async function () {
    const res = await request(app)
      .get('/api/techniques?includeRevoked=true')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // Expect techniques 1, 2, 4, 6, and 7
    const techniques = res.body;
    expect(techniques).toBeDefined();
    expect(Array.isArray(techniques)).toBe(true);
    expect(techniques.length).toBe(5);
  });

  it('GET /api/techniques should return techniques with workflow.state set to work-in-progress', async function () {
    const res = await request(app)
      .get('/api/techniques?state=work-in-progress')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // Expect techniques 2 and 6
    const techniques = res.body;
    expect(techniques).toBeDefined();
    expect(Array.isArray(techniques)).toBe(true);
    expect(techniques.length).toBe(2);
  });

  it('GET /api/techniques should return techniques with workflow.state set to work-in-progress or reviewed', async function () {
    const res = await request(app)
      .get('/api/techniques?state=work-in-progress&state=reviewed')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // Expect techniques 2, 6, and 7
    const techniques = res.body;
    expect(techniques).toBeDefined();
    expect(Array.isArray(techniques)).toBe(true);
    expect(techniques.length).toBe(3);
  });

  it('GET /api/techniques should return techniques containing the domain', async function () {
    const res = await request(app)
      .get('/api/techniques?domain=mobile-attack')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // Expect technique 2
    const techniques = res.body;
    expect(techniques).toBeDefined();
    expect(Array.isArray(techniques)).toBe(true);
    expect(techniques.length).toBe(1);
  });

  it('GET /api/techniques should not return any techniques when searching for a non-existent domain', async function () {
    const res = await request(app)
      .get('/api/techniques?domain=not-a-domain')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const techniques = res.body;
    expect(techniques).toBeDefined();
    expect(Array.isArray(techniques)).toBe(true);
    expect(techniques.length).toBe(0);
  });

  it('GET /api/techniques should return techniques containing the platform', async function () {
    const res = await request(app)
      .get('/api/techniques?platform=Windows')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // Expect technique 2
    const techniques = res.body;
    expect(techniques).toBeDefined();
    expect(Array.isArray(techniques)).toBe(true);
    expect(techniques.length).toBe(1);
  });

  it('GET /api/techniques should not return any techniques when searching for a non-existent platform', async function () {
    const res = await request(app)
      .get('/api/techniques?platform=not-a-platform')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const techniques = res.body;
    expect(techniques).toBeDefined();
    expect(Array.isArray(techniques)).toBe(true);
    expect(techniques.length).toBe(0);
  });

  after(async function () {
    await database.closeConnection();
  });
});
