const request = require('supertest');
const { expect } = require('expect');

const { cloneForCreate } = require('../../shared/clone-for-create');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');

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
    spec_version: '2.1',
    type: 'marking-definition',
    definition_type: 'statement',
    definition: { statement: 'This is a marking definition.' },
    created_by_ref: 'identity--6444f546-6900-4456-b3b1-015c88d70dab',
  },
};

describe('Marking Definitions API', function () {
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

    // Log into the app
    passportCookie = await login.loginAnonymous(app);
  });

  it('GET /api/marking-definitions returns the pre-defined marking definitions', async function () {
    const res = await request(app)
      .get('/api/marking-definitions')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an empty array
    const markingDefinitions = res.body;
    expect(markingDefinitions).toBeDefined();
    expect(Array.isArray(markingDefinitions)).toBe(true);
    expect(markingDefinitions.length).toBe(4);
  });

  it('POST /api/marking-definitions does not create an empty marking definition', async function () {
    const body = {};
    await request(app)
      .post('/api/marking-definitions')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(400);
  });

  let markingDefinition1;
  it('POST /api/marking-definitions creates a marking definition', async function () {
    const timestamp = new Date().toISOString();
    initialObjectData.stix.created = timestamp;
    const body = initialObjectData;
    const res = await request(app)
      .post('/api/marking-definitions')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created marking definition
    markingDefinition1 = res.body;
    expect(markingDefinition1).toBeDefined();
    expect(markingDefinition1.stix).toBeDefined();
    expect(markingDefinition1.stix.id).toBeDefined();
    expect(markingDefinition1.stix.created).toBeDefined();
  });

  it('GET /api/marking-definitions returns the added marking definition', async function () {
    const res = await request(app)
      .get('/api/marking-definitions')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one additional marking definition in an array
    const markingDefinitions = res.body;
    expect(markingDefinitions).toBeDefined();
    expect(Array.isArray(markingDefinitions)).toBe(true);

    const addedMarkingDefinitions = markingDefinitions.filter(
      (x) => x.workspace.workflow.state === 'work-in-progress',
    );
    expect(addedMarkingDefinitions.length).toBe(1);
  });

  it('GET /api/marking-definitions/:id should not return a marking definition when the id cannot be found', async function () {
    await request(app)
      .get('/api/marking-definitions/not-an-id')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(404);
  });

  it('GET /api/marking-definitions/:id returns the added marking definition', async function () {
    const res = await request(app)
      .get('/api/marking-definitions/' + markingDefinition1.stix.id)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one marking definition in an array
    const markingDefinitions = res.body;
    expect(markingDefinitions).toBeDefined();
    expect(Array.isArray(markingDefinitions)).toBe(true);
    expect(markingDefinitions.length).toBe(1);

    const markingDefinition = markingDefinitions[0];
    expect(markingDefinition).toBeDefined();
    expect(markingDefinition.stix).toBeDefined();
    expect(markingDefinition.stix.id).toBe(markingDefinition1.stix.id);
    expect(markingDefinition.stix.type).toBe(markingDefinition1.stix.type);
    expect(markingDefinition.stix.name).toBe(markingDefinition1.stix.name);
    expect(markingDefinition.stix.description).toBe(markingDefinition1.stix.description);
    expect(markingDefinition.stix.spec_version).toBe(markingDefinition1.stix.spec_version);
    expect(markingDefinition.stix.object_marking_refs).toEqual(
      expect.arrayContaining(markingDefinition1.stix.object_marking_refs),
    );
    expect(markingDefinition.stix.created_by_ref).toBe(markingDefinition1.stix.created_by_ref);
  });

  it('PUT /api/marking-definitions updates a marking definition', async function () {
    markingDefinition1.stix.description = 'This is an updated marking definition.';
    const body = cloneForCreate(markingDefinition1);
    const res = await request(app)
      .put('/api/marking-definitions/' + markingDefinition1.stix.id)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the updated marking definition
    const markingDefinition = res.body;
    expect(markingDefinition).toBeDefined();
    expect(markingDefinition.stix.id).toBe(markingDefinition1.stix.id);
  });

  it('POST /api/marking-definitions does not create a marking definition with the same id', async function () {
    const body = cloneForCreate(markingDefinition1);
    await request(app)
      .post('/api/marking-definitions')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(400);
  });

  it('DELETE /api/marking-definitions deletes a marking definition', async function () {
    await request(app)
      .delete('/api/marking-definitions/' + markingDefinition1.stix.id)
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(204);
  });

  it('GET /api/marking-definitions returns the pre-defined marking definitions', async function () {
    const res = await request(app)
      .get('/api/marking-definitions')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an empty array
    const markingDefinitions = res.body;
    expect(markingDefinitions).toBeDefined();
    expect(Array.isArray(markingDefinitions)).toBe(true);
    expect(markingDefinitions.length).toBe(4);
  });

  after(async function () {
    await database.closeConnection();
  });
});
