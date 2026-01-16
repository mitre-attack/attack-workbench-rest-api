const request = require('supertest');
const { expect } = require('expect');

const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const Group = require('../../../models/group-model');
const markingDefinitionService = require('../../../services/stix/marking-definitions-service');
const systemConfigurationService = require('../../../services/system/system-configuration-service');

const config = require('../../../config/config');
const login = require('../../shared/login');
const { cloneForCreate } = require('../../shared/clone-for-create');

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
    description: 'This is the initial group. Blue.',
    created_by_ref: 'identity--6444f546-6900-4456-b3b1-015c88d70dab',
  },
};

const markingDefinitionData = {
  workspace: {
    workflow: {
      state: 'reviewed',
    },
  },
  stix: {
    spec_version: '2.1',
    type: 'marking-definition',
    definition_type: 'statement',
    definition: { statement: 'This is a marking definition.' },
    created_by_ref: 'identity--6444f546-6900-4456-b3b1-015c88d70dab',
  },
};

async function addDefaultMarkingDefinition(markingDefinitionData) {
  // Save the marking definition
  const timestamp = new Date().toISOString();
  markingDefinitionData.stix.created = timestamp;
  const savedMarkingDefinition = await markingDefinitionService.create(markingDefinitionData);

  // Get the current list of default marking definitions
  const defaultMarkingDefinitions =
    await systemConfigurationService.retrieveDefaultMarkingDefinitions({ refOnly: true });

  // Add the new marking definition to the list and save it
  defaultMarkingDefinitions.push(savedMarkingDefinition.stix.id);
  await systemConfigurationService.setDefaultMarkingDefinitions(defaultMarkingDefinitions);

  return savedMarkingDefinition;
}

describe('Groups API', function () {
  let app;
  let defaultMarkingDefinition1;
  let defaultMarkingDefinition2;
  let passportCookie;

  before(async function () {
    // Establish the database connection
    // Use an in-memory database that we spin up for the test
    await database.initializeConnection();

    // Wait until the indexes are created
    await Group.init();

    // Check for a valid database configuration
    await databaseConfiguration.checkSystemConfiguration();

    // Initialize the express app
    app = await require('../../../index').initializeApp();

    // Log into the app
    passportCookie = await login.loginAnonymous(app);

    defaultMarkingDefinition1 = await addDefaultMarkingDefinition(markingDefinitionData);
  });

  it('GET /api/groups returns an empty array of groups', async function () {
    const res = await request(app)
      .get('/api/groups')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an empty array
    const groups = res.body;
    expect(groups).toBeDefined();
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBe(0);
  });

  it('POST /api/groups does not create an empty group', async function () {
    const body = {};
    await request(app)
      .post('/api/groups')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(400);
  });

  let group1;
  it('POST /api/groups creates a group', async function () {
    const timestamp = new Date().toISOString();
    initialObjectData.stix.created = timestamp;
    initialObjectData.stix.modified = timestamp;
    const body = initialObjectData;
    const res = await request(app)
      .post('/api/groups')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);
    // We expect to get the created group
    group1 = res.body;
    expect(group1).toBeDefined();
    expect(group1.stix).toBeDefined();
    expect(group1.stix.id).toBeDefined();
    expect(group1.stix.created).toBeDefined();
    expect(group1.stix.modified).toBeDefined();
    expect(group1.stix.x_mitre_attack_spec_version).toBe(config.app.attackSpecVersion);

    // object_marking_refs should contain the default marking definition
    expect(group1.stix.object_marking_refs).toBeDefined();
    expect(Array.isArray(group1.stix.object_marking_refs)).toBe(true);
    expect(group1.stix.object_marking_refs.length).toBe(1);
    expect(group1.stix.object_marking_refs[0]).toBe(defaultMarkingDefinition1.stix.id);
  });

  it('GET /api/groups returns the added group', async function () {
    const res = await request(app)
      .get('/api/groups')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one group in an array
    const groups = res.body;
    expect(groups).toBeDefined();
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBe(1);
  });

  it('GET /api/groups/:id should not return a group when the id cannot be found', async function () {
    await request(app)
      .get('/api/groups/not-an-id')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(404);
  });

  it('GET /api/groups/:id returns the added group', async function () {
    const res = await request(app)
      .get('/api/groups/' + group1.stix.id)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one group in an array
    const groups = res.body;
    expect(groups).toBeDefined();
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBe(1);

    const group = groups[0];
    expect(group).toBeDefined();
    expect(group.stix).toBeDefined();
    expect(group.stix.id).toBe(group1.stix.id);
    expect(group.stix.type).toBe(group1.stix.type);
    expect(group.stix.name).toBe(group1.stix.name);
    expect(group.stix.description).toBe(group1.stix.description);
    expect(group.stix.spec_version).toBe(group1.stix.spec_version);
    expect(group.stix.object_marking_refs).toEqual(
      expect.arrayContaining(group1.stix.object_marking_refs),
    );
    expect(group.stix.created_by_ref).toBe(group1.stix.created_by_ref);
    expect(group.stix.x_mitre_attack_spec_version).toBe(group1.stix.x_mitre_attack_spec_version);
  });

  it('PUT /api/groups updates a group', async function () {
    const originalModified = group1.stix.modified;
    const timestamp = new Date().toISOString();
    group1.stix.modified = timestamp;
    group1.stix.description = 'This is an updated group. Blue.';
    const body = group1;
    const res = await request(app)
      .put('/api/groups/' + group1.stix.id + '/modified/' + originalModified)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the updated group
    const group = res.body;
    expect(group).toBeDefined();
    expect(group.stix.id).toBe(group1.stix.id);
    expect(group.stix.modified).toBe(group1.stix.modified);
  });

  it('POST /api/groups does not create a group with the same id and modified date', async function () {
    const body = cloneForCreate(group1);
    await request(app)
      .post('/api/groups')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(409);
  });

  let group2;
  it('POST /api/groups should create a new version of a group with a duplicate stix.id but different stix.modified date', async function () {
    // Add another default marking definition
    markingDefinitionData.stix.definition.statement =
      'This is the second default marking definition';
    defaultMarkingDefinition2 = await addDefaultMarkingDefinition(markingDefinitionData);

    group2 = cloneForCreate(group1);
    const timestamp = new Date().toISOString();
    group2.stix.modified = timestamp;
    group2.stix.description = 'This is a new version of a group. Green.';

    const body = group2;
    const res = await request(app)
      .post('/api/groups')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created group
    const group = res.body;
    expect(group).toBeDefined();
  });

  it('GET /api/groups returns the latest added group', async function () {
    const res = await request(app)
      .get('/api/groups/' + group2.stix.id)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one group in an array
    const groups = res.body;
    expect(groups).toBeDefined();
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBe(1);
    const group = groups[0];
    expect(group.stix.id).toBe(group2.stix.id);
    expect(group.stix.modified).toBe(group2.stix.modified);

    // object_marking_refs should contain the two default marking definition
    expect(group.stix.object_marking_refs).toBeDefined();
    expect(Array.isArray(group.stix.object_marking_refs)).toBe(true);
    expect(group.stix.object_marking_refs.length).toBe(2);
    expect(group.stix.object_marking_refs.includes(defaultMarkingDefinition1.stix.id)).toBe(true);
    expect(group.stix.object_marking_refs.includes(defaultMarkingDefinition2.stix.id)).toBe(true);
  });

  it('GET /api/groups returns all added groups', async function () {
    const res = await request(app)
      .get('/api/groups/' + group1.stix.id + '?versions=all')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get two groups in an array
    const groups = res.body;
    expect(groups).toBeDefined();
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBe(2);
  });

  it('GET /api/groups/:id/modified/:modified returns the first added group', async function () {
    const res = await request(app)
      .get('/api/groups/' + group1.stix.id + '/modified/' + group1.stix.modified)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one group
    const group = res.body;
    expect(group).toBeDefined();
    expect(group.stix).toBeDefined();
    expect(group.stix.id).toBe(group1.stix.id);
    expect(group.stix.modified).toBe(group1.stix.modified);
  });

  it('GET /api/groups/:id/modified/:modified returns the second added group', async function () {
    const res = await request(app)
      .get('/api/groups/' + group2.stix.id + '/modified/' + group2.stix.modified)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one group
    const group = res.body;
    expect(group).toBeDefined();
    expect(group.stix).toBeDefined();
    expect(group.stix.id).toBe(group2.stix.id);
    expect(group.stix.modified).toBe(group2.stix.modified);
  });

  let group3;
  it('POST /api/groups should create a new group with a different stix.id', async function () {
    const group = cloneForCreate(initialObjectData);
    group.stix.id = undefined;
    const timestamp = new Date().toISOString();
    group.stix.created = timestamp;
    group.stix.modified = timestamp;
    group.stix.name = 'Mr. Brown';
    group.stix.description = 'This is a new group. Red.';
    const body = group;
    const res = await request(app)
      .post('/api/groups')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created group
    group3 = res.body;
    expect(group3).toBeDefined();
  });

  let group4;
  it('POST /api/groups should create a new version of a group with a duplicate stix.id but different stix.modified date', async function () {
    group4 = cloneForCreate(group1);
    const timestamp = new Date().toISOString();
    group4.stix.modified = timestamp;
    group4.stix.description = 'This is a new version of a group. Yellow.';

    const body = group4;
    const res = await request(app)
      .post('/api/groups')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created group
    const group = res.body;
    expect(group).toBeDefined();
  });

  it('GET /api/groups uses the search parameter to return the latest version of the group', async function () {
    const res = await request(app)
      .get('/api/groups?search=yellow')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one group in an array
    const groups = res.body;
    expect(groups).toBeDefined();
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBe(1);

    // We expect it to be the latest version of the group
    const group = groups[0];
    expect(group).toBeDefined();
    expect(group.stix).toBeDefined();
    expect(group.stix.id).toBe(group4.stix.id);
    expect(group.stix.modified).toBe(group4.stix.modified);
  });

  it('GET /api/groups should not get the first version of the group when using the search parameter', async function () {
    const res = await request(app)
      .get('/api/groups?search=blue')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get zero groups in an array
    const groups = res.body;
    expect(groups).toBeDefined();
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBe(0);
  });

  it('GET /api/groups uses the search parameter to return the group using the name property', async function () {
    const res = await request(app)
      .get('/api/groups?search=brown')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one group in an array
    const groups = res.body;
    expect(groups).toBeDefined();
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBe(1);

    // We expect it to be the third group
    const group = groups[0];
    expect(group).toBeDefined();
    expect(group.stix).toBeDefined();
    expect(group.stix.id).toBe(group3.stix.id);
    expect(group.stix.modified).toBe(group3.stix.modified);
  });

  it('DELETE /api/groups/:id should not delete a group when the id cannot be found', async function () {
    await request(app)
      .delete('/api/groups/not-an-id')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(404);
  });

  it('DELETE /api/groups/:id/modified/:modified deletes a group', async function () {
    await request(app)
      .delete('/api/groups/' + group1.stix.id + '/modified/' + group1.stix.modified)
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(204);
  });

  it('DELETE /api/groups/:id should delete all the groups with the same stix id', async function () {
    await request(app)
      .delete('/api/groups/' + group2.stix.id)
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(204);
  });

  it('DELETE /api/groups/:id/modified/:modified should delete the third group', async function () {
    await request(app)
      .delete('/api/groups/' + group3.stix.id + '/modified/' + group3.stix.modified)
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(204);
  });

  it('GET /api/groups returns an empty array of groups', async function () {
    const res = await request(app)
      .get('/api/groups')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an empty array
    const groups = res.body;
    expect(groups).toBeDefined();
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBe(0);
  });

  after(async function () {
    await database.closeConnection();
  });
});
