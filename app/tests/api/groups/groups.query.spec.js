const fs = require('fs').promises;

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

const userAccountsService = require('../../../services/system/user-accounts-service');
const groupsService = require('../../../services/stix/groups-service');

function asyncWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(path) {
  const data = await fs.readFile(require.resolve(path));
  return JSON.parse(data);
}

async function configureAndLoadGroups(baseGroup, userAccountId1, userAccountId2) {
  // Helper: create a group from config
  async function createGroup(overrides, userAccountId) {
    const data = _.cloneDeep(baseGroup);
    Object.assign(data.stix, overrides.stix || {});
    if (overrides.workspace) {
      data.workspace = { ...data.workspace, ...overrides.workspace };
    }

    if (!data.stix.name) {
      data.stix.name = `group-${data.stix.x_mitre_deprecated}-undefined`;
    }
    if (!data.stix.created) {
      const timestamp = new Date().toISOString();
      data.stix.created = timestamp;
      data.stix.modified = timestamp;
    }

    return groupsService.create(data, { import: false, userAccountId });
  }

  // group 1a: x_mitre_deprecated,revoked undefined (user account 1)
  const group1a = await createGroup({}, userAccountId1);

  // group 1b: x_mitre_deprecated,revoked undefined (user account 2)
  await createGroup({}, userAccountId2);

  // group 2: x_mitre_deprecated = false, state = work-in-progress
  await createGroup(
    { stix: { x_mitre_deprecated: false }, workspace: { workflow: { state: 'work-in-progress' } } },
    userAccountId1,
  );

  // group 3: x_mitre_deprecated = true, state = awaiting-review
  await createGroup(
    { stix: { x_mitre_deprecated: true }, workspace: { workflow: { state: 'awaiting-review' } } },
    userAccountId1,
  );

  // group 4: revoked via the revoke workflow (x_mitre_deprecated = false)
  // Use group1a as the revoking object so we don't add extra groups to the count
  const group4 = await createGroup(
    { stix: { x_mitre_deprecated: false }, workspace: { workflow: { state: 'awaiting-review' } } },
    userAccountId1,
  );
  await groupsService.revoke(group4.stix.id, {
    revoking: { stixId: group1a.stix.id, modified: group1a.stix.modified },
  });

  // group 5: multiple versions, last version has x_mitre_deprecated = true and is revoked
  const id = `intrusion-set--${uuid.v4()}`;
  const createdTimestamp = new Date().toISOString();

  const data5a = _.cloneDeep(baseGroup);
  data5a.stix.id = id;
  data5a.stix.name = 'multiple-versions';
  data5a.workspace.workflow = { state: 'awaiting-review' };
  data5a.stix.created = createdTimestamp;
  data5a.stix.modified = createdTimestamp;
  await groupsService.create(data5a, { import: false, userAccountId: userAccountId1 });

  await asyncWait(10); // wait so the modified timestamp can change
  const data5b = _.cloneDeep(baseGroup);
  data5b.stix.id = id;
  data5b.stix.name = 'multiple-versions';
  data5b.workspace.workflow = { state: 'awaiting-review' };
  data5b.stix.created = createdTimestamp;
  data5b.stix.modified = new Date().toISOString();
  await groupsService.create(data5b, { import: false, userAccountId: userAccountId1 });

  await asyncWait(10);
  // Create version 5c with deprecated flag
  const data5c = _.cloneDeep(baseGroup);
  data5c.stix.id = id;
  data5c.stix.name = 'multiple-versions';
  data5c.workspace.workflow = { state: 'awaiting-review' };
  data5c.stix.x_mitre_deprecated = true;
  data5c.stix.created = createdTimestamp;
  data5c.stix.modified = new Date().toISOString();
  await groupsService.create(data5c, { import: false, userAccountId: userAccountId2 });

  // Revoke group5 using group1a as the revoking object
  await groupsService.revoke(id, {
    revoking: { stixId: group1a.stix.id, modified: group1a.stix.modified },
  });
}

const userAccountData1 = {
  email: 'test-blue@test.org',
  username: 'test-blue@test.org',
  displayName: 'Test User Blue',
  status: 'active',
  role: 'editor',
};

const userAccountData2 = {
  email: 'test-red@test.org',
  username: 'test-red@test.org',
  displayName: 'Test User Red',
  status: 'active',
  role: 'editor',
};

let userAccount1;
let userAccount2;

describe('Groups API Queries', function () {
  let app;
  let passportCookie;

  before(async function () {
    // Establish the database connection
    // Use an in-memory database that we spin up for the test
    await database.initializeConnection();

    // Check for a valid database configuration
    await databaseConfiguration.checkSystemConfiguration();

    // Disable ADM validation for tests
    config.validateRequests.withAttackDataModel = false;
    config.validateRequests.withOpenApi = true;

    // Initialize the express app
    app = await require('../../../index').initializeApp();

    // Log into the app
    passportCookie = await login.loginAnonymous(app);

    userAccount1 = await userAccountsService.create(userAccountData1);
    userAccount2 = await userAccountsService.create(userAccountData2);

    const baseGroup = await readJson('./groups.query.json');
    await configureAndLoadGroups(baseGroup, userAccount1.id, userAccount2.id);
  });

  it('GET /api/groups should return 3 of the preloaded groups', async function () {
    const res = await request(app)
      .get('/api/groups')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get both of the non-deprecated, non-revoked groups
    const groups = res.body;
    expect(groups).toBeDefined();
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBe(3);
  });

  it('GET /api/groups should return groups with x_mitre_deprecated not set to true (false or undefined)', async function () {
    const res = await request(app)
      .get('/api/groups?includeDeprecated=false')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get both of the non-deprecated, non-revoked groups
    const groups = res.body;
    expect(groups).toBeDefined();
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBe(3);
  });

  it('GET /api/groups should return all non-revoked groups', async function () {
    const res = await request(app)
      .get('/api/groups?includeDeprecated=true')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get all the non-revoked groups
    const groups = res.body;
    expect(groups).toBeDefined();
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBe(4);
  });

  it('GET /api/groups should return groups with revoked not set to true (false or undefined)', async function () {
    const res = await request(app)
      .get('/api/groups?includeRevoked=false')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get all the non-revoked groups
    const groups = res.body;
    expect(groups).toBeDefined();
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBe(3);
  });

  it('GET /api/groups should return all non-deprecated groups', async function () {
    const res = await request(app)
      .get('/api/groups?includeRevoked=true')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get all the non-deprecated groups
    const groups = res.body;
    expect(groups).toBeDefined();
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBe(4);
  });

  it('GET /api/groups should return groups with workflow.state set to work-in-progress', async function () {
    const res = await request(app)
      .get('/api/groups?state=work-in-progress')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the group with the correct workflow.state
    const groups = res.body;
    expect(groups).toBeDefined();
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBe(1);

    const group = groups[0];
    expect(group.workspace.workflow.state).toEqual('work-in-progress');
  });

  it('GET /api/groups should return groups with the ATT&CK ID G0001', async function () {
    const res = await request(app)
      .get('/api/groups?search=G0001')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the latest group with the correct ATT&CK ID
    const groups = res.body;
    logger.info(`Received groups: ${groups}`);
    expect(groups).toBeDefined();
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBe(1);

    const group = groups[0];
    logger.info(`Received group: ${JSON.stringify(group)}`);
    expect(group.workspace.attack_id).toEqual('G0001');
  });

  it('GET /api/groups should return groups created by userAccount1', async function () {
    const res = await request(app)
      .get(`/api/groups?lastUpdatedBy=${userAccount1.id}`)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the (non-deprecated, non-revoked) groups created by userAccount1
    const groups = res.body;
    expect(groups).toBeDefined();
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBe(2);

    expect(groups[0].workspace.workflow.created_by_user_account).toEqual(userAccount1.id);
    expect(groups[1].workspace.workflow.created_by_user_account).toEqual(userAccount1.id);
  });

  it('GET /api/groups should return groups created by userAccount2', async function () {
    const res = await request(app)
      .get(`/api/groups?lastUpdatedBy=${userAccount2.id}`)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the (non-deprecated, non-revoked) group created by userAccount2
    const groups = res.body;
    expect(groups).toBeDefined();
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBe(1);

    expect(groups[0].workspace.workflow.created_by_user_account).toEqual(userAccount2.id);
  });

  it('GET /api/groups should return groups created by both userAccount1 and userAccount2', async function () {
    const res = await request(app)
      .get(`/api/groups?lastUpdatedBy=${userAccount1.id}&lastUpdatedBy=${userAccount2.id}`)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the (non-deprecated, non-revoked) groups created by both user accounts
    const groups = res.body;
    expect(groups).toBeDefined();
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBe(3);
  });

  after(async function () {
    await database.closeConnection();
  });
});
