const request = require('supertest');
const _ = require('lodash');

const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const Group = require('../../../models/group-model');
const config = require('../../../config/config');
const login = require('../../shared/login');

const logger = require('../../../lib/logger');
logger.level = 'debug';

// modified and created properties will be set before calling REST API
// stix.id property will be created by REST API
const initialObjectData = {
  workspace: {
    workflow: {
      state: 'work-in-progress',
    },
  },
  stix: {
    name: 'intrusion-set-1',
    spec_version: '2.1',
    type: 'intrusion-set',
    description: 'This is a group. Blue.',
    external_references: [{ source_name: 'source-1', external_id: 's1' }],
    object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
    created_by_ref: 'identity--6444f546-6900-4456-b3b1-015c88d70dab',
  },
};

// getApp must be a function returning the Express app object
// This is necessary so that it is available when the test cases are running
// (it generally won't be available when the tests are initially created)
function executeTests(getApp, propertyName, options) {
  options = options ?? {};
  if (options.required) {
    it(`POST /api/groups does not create a group when ${propertyName} is missing`, async function () {
      const groupData = _.cloneDeep(initialObjectData);
      const timestamp = new Date().toISOString();
      groupData.stix.created = timestamp;
      groupData.stix.modified = timestamp;
      _.set(groupData, propertyName, undefined);
      const body = groupData;
      await request(getApp())
        .post('/api/groups')
        .send(body)
        .set('Accept', 'application/json')
        .expect(400);
    });
  }

  it(`POST /api/groups does not create a group when ${propertyName} is a number`, async function () {
    const groupData = _.cloneDeep(initialObjectData);
    const timestamp = new Date().toISOString();
    groupData.stix.created = timestamp;
    groupData.stix.modified = timestamp;
    _.set(groupData, propertyName, 9);
    const body = groupData;
    await request(getApp())
      .post('/api/groups')
      .send(body)
      .set('Accept', 'application/json')
      .expect(400);
  });

  it(`POST /api/groups does not create a group when ${propertyName} is an object`, async function () {
    const groupData = _.cloneDeep(initialObjectData);
    const timestamp = new Date().toISOString();
    groupData.stix.created = timestamp;
    groupData.stix.modified = timestamp;
    _.set(groupData, propertyName, { value: 'group-name' });
    const body = groupData;
    await request(getApp())
      .post('/api/groups')
      .send(body)
      .set('Accept', 'application/json')
      .expect(400);
  });
}

describe('Groups API Input Validation', function () {
  let app;
  let passportCookie;

  before(async function () {
    // Establish the database connection
    // Use an in-memory database that we spin up for the test
    await database.initializeConnection();

    // Wait until the indexes are created
    await Group.init();

    // Check for a valid database configuration
    await databaseConfiguration.checkSystemConfiguration();

    // Disable ADM validation for tests
    config.validateRequests.withAttackDataModel = false;
    config.validateRequests.withOpenApi = true;

    // Initialize the express app
    app = await require('../../../index').initializeApp();

    // Log into the app
    passportCookie = await login.loginAnonymous(app);
  });

  it('POST /api/groups does not create an empty group', async function () {
    const body = {};
    await request(app)
      .post('/api/groups')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(400);
  });

  it('POST /api/groups does not create a group when an unknown query parameter is provided', async function () {
    const groupData = _.cloneDeep(initialObjectData);
    const timestamp = new Date().toISOString();
    groupData.stix.created = timestamp;
    groupData.stix.modified = timestamp;
    const body = groupData;
    await request(app)
      .post('/api/groups?not-a-parameter=unexpectedvalue')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(400);
  });

  it('POST /api/groups does not create a group when an invalid type is provided', async function () {
    const groupData = _.cloneDeep(initialObjectData);
    const timestamp = new Date().toISOString();
    groupData.stix.created = timestamp;
    groupData.stix.modified = timestamp;
    groupData.stix.type = 'not-a-type';
    const body = groupData;
    await request(app)
      .post('/api/groups')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(400);
  });

  it('POST /api/groups does not create a group when an incorrect type is provided', async function () {
    const groupData = _.cloneDeep(initialObjectData);
    const timestamp = new Date().toISOString();
    groupData.stix.created = timestamp;
    groupData.stix.modified = timestamp;
    groupData.stix.type = 'malware';
    const body = groupData;
    await request(app)
      .post('/api/groups')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(400);
  });

  executeTests(() => app, 'stix.type', { required: true });
  executeTests(() => app, 'stix.spec_version', { required: true });
  executeTests(() => app, 'stix.name', { required: true });
  executeTests(() => app, 'stix.description');
  executeTests(() => app, 'stix.x_mitre_modified_by_ref');
  executeTests(() => app, 'stix.x_mitre_version');
  executeTests(() => app, 'stix.x_mitre_attack_spec_version');

  after(async function () {
    await database.closeConnection();
  });
});
