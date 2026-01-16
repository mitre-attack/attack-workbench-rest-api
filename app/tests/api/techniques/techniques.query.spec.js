const fs = require('fs').promises;

const request = require('supertest');
const { expect } = require('expect');
const _ = require('lodash');
const uuid = require('uuid');

const login = require('../../shared/login');

const logger = require('../../../lib/logger');
logger.level = 'debug';

const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');

const techniquesService = require('../../../services/stix/techniques-service');

function asyncWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(path) {
  const data = await fs.readFile(require.resolve(path));
  return JSON.parse(data);
}

async function configureTechniques(baseTechnique) {
  const techniques = [];
  // x_mitre_deprecated,revoked undefined
  // state undefined
  const data1 = _.cloneDeep(baseTechnique);
  techniques.push(data1);

  // x_mitre_deprecated = false, revoked = false
  // state = work-in-progress
  const data2 = _.cloneDeep(baseTechnique);
  data2.stix.x_mitre_deprecated = false;
  data2.stix.revoked = false;
  data2.stix.x_mitre_domains = ['mobile-attack'];
  data2.stix.x_mitre_platforms.push('platform-3');
  data2.workspace.workflow = { state: 'work-in-progress' };
  techniques.push(data2);

  // x_mitre_deprecated = true, revoked = false
  // state = awaiting-review
  const data3 = _.cloneDeep(baseTechnique);
  data3.stix.x_mitre_deprecated = true;
  data3.stix.revoked = false;
  data3.workspace.workflow = { state: 'awaiting-review' };
  techniques.push(data3);

  // x_mitre_deprecated = false, revoked = true
  // state = awaiting-review
  const data4 = _.cloneDeep(baseTechnique);
  data4.stix.x_mitre_deprecated = false;
  data4.stix.revoked = true;
  data4.workspace.workflow = { state: 'awaiting-review' };
  techniques.push(data4);

  // multiple versions, last version has x_mitre_deprecated = true, revoked = true
  // state = awaiting-review
  const data5a = _.cloneDeep(baseTechnique);
  const id = `attack-pattern--${uuid.v4()}`;
  data5a.stix.id = id;
  data5a.stix.name = 'multiple-versions';
  data5a.workspace.workflow = { state: 'awaiting-review' };
  const createdTimestamp = new Date().toISOString();
  data5a.stix.created = createdTimestamp;
  data5a.stix.modified = createdTimestamp;
  techniques.push(data5a);

  await asyncWait(10); // wait so the modified timestamp can change
  const data5b = _.cloneDeep(baseTechnique);
  data5b.stix.id = id;
  data5b.stix.name = 'multiple-versions';
  data5b.workspace.workflow = { state: 'awaiting-review' };
  data5b.stix.created = createdTimestamp;
  let timestamp = new Date().toISOString();
  data5b.stix.modified = timestamp;
  techniques.push(data5b);

  await asyncWait(10);
  const data5c = _.cloneDeep(baseTechnique);
  data5c.stix.id = id;
  data5c.stix.name = 'multiple-versions';
  data5c.workspace.workflow = { state: 'awaiting-review' };
  data5c.stix.x_mitre_deprecated = true;
  data5c.stix.revoked = true;
  data5c.stix.created = createdTimestamp;
  timestamp = new Date().toISOString();
  data5c.stix.modified = timestamp;
  techniques.push(data5c);

  // x_mitre_deprecated,revoked undefined
  // state = work-in-progress
  const data6 = _.cloneDeep(baseTechnique);
  data6.stix.x_mitre_deprecated = false;
  data6.stix.revoked = false;
  data6.workspace.workflow = { state: 'work-in-progress' };
  techniques.push(data6);

  // x_mitre_deprecated,revoked undefined
  // state = reviewed
  const data7 = _.cloneDeep(baseTechnique);
  data7.stix.x_mitre_deprecated = false;
  data7.stix.revoked = false;
  data7.workspace.workflow = { state: 'reviewed' };
  techniques.push(data7);

  return techniques;
}

async function loadTechniques(techniques) {
  for (const technique of techniques) {
    if (!technique.stix.name) {
      technique.stix.name = `attack-pattern-${technique.stix.x_mitre_deprecated}-${technique.stix.revoked}`;
    }

    if (!technique.stix.created) {
      const timestamp = new Date().toISOString();
      technique.stix.created = timestamp;
      technique.stix.modified = timestamp;
    }

    await techniquesService.create(technique);
  }
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

    // Initialize the express app
    app = await require('../../../index').initializeApp();

    const baseTechnique = await readJson('./techniques.query.json');
    const techniques = await configureTechniques(baseTechnique);
    await loadTechniques(techniques);

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
      .get('/api/techniques?platform=platform-3')
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
