const request = require('supertest');
const { expect } = require('expect');

const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');

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
    name: 'course-of-action-1',
    spec_version: '2.1',
    type: 'course-of-action',
    description: 'This is a mitigation.',
    external_references: [{ source_name: 'source-1', external_id: 's1' }],
    object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
    created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
    labels: ['label1', 'label2'],
    x_mitre_version: '1.1',
  },
};

describe('Mitigations API', function () {
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

  it('GET /api/mitigations returns an empty array of mitigations', async function () {
    const res = await request(app)
      .get('/api/mitigations')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an empty array
    const mitigations = res.body;
    expect(mitigations).toBeDefined();
    expect(Array.isArray(mitigations)).toBe(true);
    expect(mitigations.length).toBe(0);
  });

  it('POST /api/mitigations does not create an empty mitigation', async function () {
    const body = {};
    await request(app)
      .post('/api/mitigations')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(400);
  });

  let mitigation1;
  it('POST /api/mitigations creates a mitigation', async function () {
    const timestamp = new Date().toISOString();
    initialObjectData.stix.created = timestamp;
    initialObjectData.stix.modified = timestamp;
    const body = initialObjectData;
    const res = await request(app)
      .post('/api/mitigations')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created mitigation
    mitigation1 = res.body;
    expect(mitigation1).toBeDefined();
    expect(mitigation1.stix).toBeDefined();
    expect(mitigation1.stix.id).toBeDefined();
    expect(mitigation1.stix.created).toBeDefined();
    expect(mitigation1.stix.modified).toBeDefined();
    expect(mitigation1.stix.x_mitre_attack_spec_version).toBe(config.app.attackSpecVersion);

    expect(mitigation1.stix.labels).toBeDefined();
    expect(Array.isArray(mitigation1.stix.labels)).toBe(true);
    expect(mitigation1.stix.labels.length).toBe(2);
  });

  it('GET /api/mitigations returns the added mitigation', async function () {
    const res = await request(app)
      .get('/api/mitigations')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one mitigation in an array
    const mitigations = res.body;
    expect(mitigations).toBeDefined();
    expect(Array.isArray(mitigations)).toBe(true);
    expect(mitigations.length).toBe(1);
  });

  it('GET /api/mitigations/:id should not return a mitigation when the id cannot be found', async function () {
    await request(app)
      .get('/api/mitigations/not-an-id')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(404);
  });

  it('GET /api/mitigations/:id returns the added mitigation', async function () {
    const res = await request(app)
      .get('/api/mitigations/' + mitigation1.stix.id)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one mitigation in an array
    const mitigations = res.body;
    expect(mitigations).toBeDefined();
    expect(Array.isArray(mitigations)).toBe(true);
    expect(mitigations.length).toBe(1);

    const mitigation = mitigations[0];
    expect(mitigation).toBeDefined();
    expect(mitigation.stix).toBeDefined();
    expect(mitigation.stix.id).toBe(mitigation1.stix.id);
    expect(mitigation.stix.type).toBe(mitigation1.stix.type);
    expect(mitigation.stix.name).toBe(mitigation1.stix.name);
    expect(mitigation.stix.description).toBe(mitigation1.stix.description);
    expect(mitigation.stix.spec_version).toBe(mitigation1.stix.spec_version);
    expect(mitigation.stix.object_marking_refs).toEqual(
      expect.arrayContaining(mitigation1.stix.object_marking_refs),
    );
    expect(mitigation.stix.created_by_ref).toBe(mitigation1.stix.created_by_ref);
    expect(mitigation.stix.x_mitre_version).toBe(mitigation1.stix.x_mitre_version);
    expect(mitigation.stix.x_mitre_attack_spec_version).toBe(
      mitigation1.stix.x_mitre_attack_spec_version,
    );

    expect(mitigation.stix.labels).toBeDefined();
    expect(Array.isArray(mitigation.stix.labels)).toBe(true);
    expect(mitigation.stix.labels.length).toBe(mitigation1.stix.labels.length);
  });

  it('PUT /api/mitigations updates a mitigation', async function () {
    const originalModified = mitigation1.stix.modified;
    const timestamp = new Date().toISOString();
    mitigation1.stix.modified = timestamp;
    mitigation1.stix.description = 'This is an updated mitigation.';
    const body = mitigation1;
    const res = await request(app)
      .put('/api/mitigations/' + mitigation1.stix.id + '/modified/' + originalModified)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the updated mitigation
    const mitigation = res.body;
    expect(mitigation).toBeDefined();
    expect(mitigation.stix.id).toBe(mitigation1.stix.id);
    expect(mitigation.stix.modified).toBe(mitigation1.stix.modified);
  });

  it('POST /api/mitigations does not create a mitigation with the same id and modified date', async function () {
    const body = mitigation1;
    await request(app)
      .post('/api/mitigations')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(409);
  });

  let mitigation2;
  it('POST /api/mitigations should create a new version of a mitigation with a duplicate stix.id but different stix.modified date', async function () {
    mitigation2 = cloneForCreate(mitigation1);
    const timestamp = new Date().toISOString();
    mitigation2.stix.modified = timestamp;
    const body = mitigation2;
    const res = await request(app)
      .post('/api/mitigations')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created mitigation
    const mitigation = res.body;
    expect(mitigation).toBeDefined();
  });

  let mitigation3;
  it('POST /api/mitigations should create a new version of a mitigation with a duplicate stix.id but different stix.modified date', async function () {
    mitigation3 = cloneForCreate(mitigation1);
    const timestamp = new Date().toISOString();
    mitigation3.stix.modified = timestamp;
    const body = mitigation3;
    const res = await request(app)
      .post('/api/mitigations')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created mitigation
    const mitigation = res.body;
    expect(mitigation).toBeDefined();
  });

  it('GET /api/mitigations returns the latest added mitigation', async function () {
    const res = await request(app)
      .get('/api/mitigations/' + mitigation3.stix.id)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one mitigation in an array
    const mitigations = res.body;
    expect(mitigations).toBeDefined();
    expect(Array.isArray(mitigations)).toBe(true);
    expect(mitigations.length).toBe(1);
    const mitigation = mitigations[0];
    expect(mitigation.stix.id).toBe(mitigation3.stix.id);
    expect(mitigation.stix.modified).toBe(mitigation3.stix.modified);
  });

  it('GET /api/mitigations returns all added mitigations', async function () {
    const res = await request(app)
      .get('/api/mitigations/' + mitigation1.stix.id + '?versions=all')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get two mitigations in an array
    const mitigations = res.body;
    expect(mitigations).toBeDefined();
    expect(Array.isArray(mitigations)).toBe(true);
    expect(mitigations.length).toBe(3);
  });

  it('GET /api/mitigations/:id/modified/:modified returns the first added mitigation', async function () {
    const res = await request(app)
      .get('/api/mitigations/' + mitigation1.stix.id + '/modified/' + mitigation1.stix.modified)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one mitigation in an array
    const mitigation = res.body;
    expect(mitigation).toBeDefined();
    expect(mitigation.stix).toBeDefined();
    expect(mitigation.stix.id).toBe(mitigation1.stix.id);
    expect(mitigation.stix.modified).toBe(mitigation1.stix.modified);
  });

  it('GET /api/mitigations/:id/modified/:modified returns the second added mitigation', async function () {
    const res = await request(app)
      .get('/api/mitigations/' + mitigation2.stix.id + '/modified/' + mitigation2.stix.modified)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one mitigation in an array
    const mitigation = res.body;
    expect(mitigation).toBeDefined();
    expect(mitigation.stix).toBeDefined();
    expect(mitigation.stix.id).toBe(mitigation2.stix.id);
    expect(mitigation.stix.modified).toBe(mitigation2.stix.modified);
  });

  it('DELETE /api/mitigations/:id should not delete a mitigation when the id cannot be found', async function () {
    await request(app)
      .delete('/api/mitigations/not-an-id')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(404);
  });

  it('DELETE /api/mitigations/:id/modified/:modified deletes a mitigation', async function () {
    await request(app)
      .delete('/api/mitigations/' + mitigation1.stix.id + '/modified/' + mitigation1.stix.modified)
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(204);
  });

  it('DELETE /api/mitigations/:id should delete all the mitigations with the same stix id', async function () {
    await request(app)
      .delete('/api/mitigations/' + mitigation2.stix.id)
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(204);
  });

  it('GET /api/mitigations returns an empty array of mitigations', async function () {
    const res = await request(app)
      .get('/api/mitigations')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an empty array
    const mitigations = res.body;
    expect(mitigations).toBeDefined();
    expect(Array.isArray(mitigations)).toBe(true);
    expect(mitigations.length).toBe(0);
  });

  after(async function () {
    await database.closeConnection();
  });
});
