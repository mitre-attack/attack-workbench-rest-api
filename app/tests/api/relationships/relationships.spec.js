const request = require('supertest');
const { expect } = require('expect');

const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');

const config = require('../../../config/config');
const login = require('../../shared/login');
const { cloneForCreate } = require('../../shared/clone-for-create');

const logger = require('../../../lib/logger');
logger.level = 'debug';

const sourceRef1 = 'malware--67e6d66b-1b82-4699-b47a-e2efb6268d14';
const targetRef1 = 'attack-pattern--7b211ac6-c815-4189-93a9-ab415deca926';

const sourceRef2 = 'malware--0b32ec39-ba61-4864-9ebe-b4b0b73caf9a';
const targetRef2 = 'attack-pattern--d63a3fb8-9452-4e9d-a60a-54be68d5998c';

const sourceRef3 = 'malware--a5528622-3a8a-4633-86ce-8cdaf8423858';
const targetRef3 = 'attack-pattern--0259baeb-9f63-4c69-bf10-eb038c390688';

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
    type: 'relationship',
    description: 'This is a relationship.',
    source_ref: sourceRef1,
    relationship_type: 'uses',
    target_ref: targetRef1,
    external_references: [{ source_name: 'source-1', external_id: 's1' }],
    object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
    created_by_ref: 'identity--6444f546-6900-4456-b3b1-015c88d70dab',
  },
};

describe('Relationships API', function () {
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
  });

  it('GET /api/relationships returns an empty array of relationships', async function () {
    const res = await request(app)
      .get('/api/relationships')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);
    // We expect to get an empty array
    const relationships = res.body;
    expect(relationships).toBeDefined();
    expect(Array.isArray(relationships)).toBe(true);
    expect(relationships.length).toBe(0);
  });

  it('POST /api/relationships does not create an empty relationship', async function () {
    const body = {};
    await request(app)
      .post('/api/relationships')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(400);
  });

  let relationship1a;
  it('POST /api/relationships creates a relationship', async function () {
    const timestamp = new Date().toISOString();
    initialObjectData.stix.created = timestamp;
    initialObjectData.stix.modified = timestamp;
    const body = initialObjectData;
    const res = await request(app)
      .post('/api/relationships')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created relationship
    relationship1a = res.body;
    expect(relationship1a).toBeDefined();
    expect(relationship1a.stix).toBeDefined();
    expect(relationship1a.stix.id).toBeDefined();
    expect(relationship1a.stix.created).toBeDefined();
    expect(relationship1a.stix.modified).toBeDefined();
    expect(relationship1a.stix.x_mitre_attack_spec_version).toBe(config.app.attackSpecVersion);
  });

  it('GET /api/relationships returns the added relationship', async function () {
    const res = await request(app)
      .get('/api/relationships')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one relationship in an array
    const relationships = res.body;
    expect(relationships).toBeDefined();
    expect(Array.isArray(relationships)).toBe(true);
    expect(relationships.length).toBe(1);
  });

  it('GET /api/relationships/:id should not return a relationship when the id cannot be found', async function () {
    await request(app)
      .get('/api/relationships/not-an-id')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(404);
  });

  it('GET /api/relationships/:id returns the added relationship', async function () {
    const res = await request(app)
      .get('/api/relationships/' + relationship1a.stix.id)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one relationship in an array
    const relationships = res.body;
    expect(relationships).toBeDefined();
    expect(Array.isArray(relationships)).toBe(true);
    expect(relationships.length).toBe(1);

    const relationship = relationships[0];
    expect(relationship).toBeDefined();
    expect(relationship.stix).toBeDefined();
    expect(relationship.stix.id).toBe(relationship1a.stix.id);
    expect(relationship.stix.type).toBe(relationship1a.stix.type);
    expect(relationship.stix.name).toBe(relationship1a.stix.name);
    expect(relationship.stix.description).toBe(relationship1a.stix.description);
    expect(relationship.stix.spec_version).toBe(relationship1a.stix.spec_version);
    expect(relationship.stix.object_marking_refs).toEqual(
      expect.arrayContaining(relationship1a.stix.object_marking_refs),
    );
    expect(relationship.stix.created_by_ref).toBe(relationship1a.stix.created_by_ref);
    expect(relationship.stix.x_mitre_attack_spec_version).toBe(
      relationship1a.stix.x_mitre_attack_spec_version,
    );
  });

  it('PUT /api/relationships updates a relationship', async function () {
    const originalModified = relationship1a.stix.modified;
    const timestamp = new Date().toISOString();
    relationship1a.stix.modified = timestamp;
    relationship1a.stix.description = 'This is an updated relationship.';
    const body = relationship1a;
    const res = await request(app)
      .put('/api/relationships/' + relationship1a.stix.id + '/modified/' + originalModified)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the updated relationship
    const relationship = res.body;
    expect(relationship).toBeDefined();
    expect(relationship.stix.id).toBe(relationship1a.stix.id);
    expect(relationship.stix.modified).toBe(relationship1a.stix.modified);
  });

  it('POST /api/relationships does not create a relationship with the same id and modified date', async function () {
    const body = relationship1a;
    await request(app)
      .post('/api/relationships')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(409);
  });

  let relationship1b;
  it('POST /api/relationships should create a new version of a relationship with a duplicate stix.id but different stix.modified date', async function () {
    relationship1b = cloneForCreate(relationship1a);
    const timestamp = new Date().toISOString();
    relationship1b.stix.modified = timestamp;
    const body = relationship1b;
    const res = await request(app)
      .post('/api/relationships')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created relationship
    const relationship = res.body;
    expect(relationship).toBeDefined();
  });

  let relationship1c;
  it('POST /api/relationships should create a new version of a relationship with a duplicate stix.id but different stix.modified date', async function () {
    relationship1c = cloneForCreate(relationship1a);
    const timestamp = new Date().toISOString();
    relationship1c.stix.modified = timestamp;
    const body = relationship1c;
    const res = await request(app)
      .post('/api/relationships')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created relationship
    const relationship = res.body;
    expect(relationship).toBeDefined();
  });

  it('GET /api/relationships returns the latest added relationship', async function () {
    const res = await request(app)
      .get('/api/relationships')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one relationship in an array
    const relationships = res.body;
    expect(relationships).toBeDefined();
    expect(Array.isArray(relationships)).toBe(true);
    expect(relationships.length).toBe(1);
    const relationship = relationships[0];
    expect(relationship.stix.id).toBe(relationship1c.stix.id);
    expect(relationship.stix.modified).toBe(relationship1c.stix.modified);
  });

  it('GET /api/relationships returns all added relationships', async function () {
    const res = await request(app)
      .get('/api/relationships?versions=all')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get two relationships in an array
    const relationships = res.body;
    expect(relationships).toBeDefined();
    expect(Array.isArray(relationships)).toBe(true);
    expect(relationships.length).toBe(3);
  });

  it('GET /api/relationships/:stixId returns the latest added relationship', async function () {
    const res = await request(app)
      .get('/api/relationships/' + relationship1b.stix.id)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one relationship in an array
    const relationships = res.body;
    expect(relationships).toBeDefined();
    expect(Array.isArray(relationships)).toBe(true);
    expect(relationships.length).toBe(1);
    const relationship = relationships[0];
    expect(relationship.stix.id).toBe(relationship1c.stix.id);
    expect(relationship.stix.modified).toBe(relationship1c.stix.modified);
  });

  it('GET /api/relationships/:stixId returns all added relationships', async function () {
    const res = await request(app)
      .get('/api/relationships/' + relationship1a.stix.id + '?versions=all')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get two relationships in an array
    const relationships = res.body;
    expect(relationships).toBeDefined();
    expect(Array.isArray(relationships)).toBe(true);
    expect(relationships.length).toBe(3);
  });

  it('GET /api/relationships/:id/modified/:modified returns the first added relationship', async function () {
    const res = await request(app)
      .get(
        '/api/relationships/' +
          relationship1a.stix.id +
          '/modified/' +
          relationship1a.stix.modified,
      )
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one relationship in an array
    const relationship = res.body;
    expect(relationship).toBeDefined();
    expect(relationship.stix).toBeDefined();
    expect(relationship.stix.id).toBe(relationship1a.stix.id);
    expect(relationship.stix.modified).toBe(relationship1a.stix.modified);
  });

  it('GET /api/relationships/:id/modified/:modified returns the second added relationship', async function () {
    const res = await request(app)
      .get(
        '/api/relationships/' +
          relationship1b.stix.id +
          '/modified/' +
          relationship1b.stix.modified,
      )
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one relationship in an array
    const relationship = res.body;
    expect(relationship).toBeDefined();
    expect(relationship.stix).toBeDefined();
    expect(relationship.stix.id).toBe(relationship1b.stix.id);
    expect(relationship.stix.modified).toBe(relationship1b.stix.modified);
  });

  let relationship2;
  it('POST /api/relationships creates a relationship', async function () {
    const timestamp = new Date().toISOString();
    initialObjectData.stix.created = timestamp;
    initialObjectData.stix.modified = timestamp;
    initialObjectData.stix.source_ref = sourceRef2;
    initialObjectData.stix.target_ref = targetRef2;
    const body = initialObjectData;
    const res = await request(app)
      .post('/api/relationships')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created relationship
    relationship2 = res.body;
    expect(relationship2).toBeDefined();
  });

  it('GET /api/relationships returns the (latest) relationship matching a source_ref', async function () {
    const res = await request(app)
      .get('/api/relationships?sourceRef=' + sourceRef1)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one relationship in an array
    const relationships = res.body;
    expect(relationships).toBeDefined();
    expect(Array.isArray(relationships)).toBe(true);
    expect(relationships.length).toBe(1);
  });

  it('GET /api/relationships returns the (latest) relationship matching a target_ref', async function () {
    const res = await request(app)
      .get('/api/relationships?targetRef=' + targetRef1)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one relationship in an array
    const relationships = res.body;
    expect(relationships).toBeDefined();
    expect(Array.isArray(relationships)).toBe(true);
    expect(relationships.length).toBe(1);
  });

  it('GET /api/relationships returns the (latest) relationship matching a sourceOrTargetRef', async function () {
    const res = await request(app)
      .get('/api/relationships?sourceOrTargetRef=' + sourceRef1)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one relationship in an array
    const relationships = res.body;
    expect(relationships).toBeDefined();
    expect(Array.isArray(relationships)).toBe(true);
    expect(relationships.length).toBe(1);
  });

  it('GET /api/relationships returns zero relationships for a non-matching source_ref', async function () {
    const res = await request(app)
      .get('/api/relationships?sourceRef=' + sourceRef3)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get zero relationships in an array
    const relationships = res.body;
    expect(relationships).toBeDefined();
    expect(Array.isArray(relationships)).toBe(true);
    expect(relationships.length).toBe(0);
  });

  it('GET /api/relationships returns zero relationships for a non-matching target_ref', async function () {
    const res = await request(app)
      .get('/api/relationships?targetRef=' + targetRef3)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one relationship in an array
    const relationships = res.body;
    expect(relationships).toBeDefined();
    expect(Array.isArray(relationships)).toBe(true);
    expect(relationships.length).toBe(0);
  });

  it('GET /api/relationships returns zero relationships for a non-matching sourceOrTargetRef', async function () {
    const res = await request(app)
      .get('/api/relationships?sourceOrTargetRef=' + sourceRef3)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one relationship in an array
    const relationships = res.body;
    expect(relationships).toBeDefined();
    expect(Array.isArray(relationships)).toBe(true);
    expect(relationships.length).toBe(0);
  });

  it('DELETE /api/relationships/:id should not delete a relationship when the id cannot be found', async function () {
    await request(app)
      .delete('/api/relationships/not-an-id')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(404);
  });

  it('DELETE /api/relationships/:id/modified/:modified deletes a relationship', async function () {
    await request(app)
      .delete(
        '/api/relationships/' +
          relationship1a.stix.id +
          '/modified/' +
          relationship1a.stix.modified,
      )
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(204);
  });

  it('DELETE /api/relationships/:id should delete all the relationships with the same stix id', async function () {
    await request(app)
      .delete('/api/relationships/' + relationship1b.stix.id)
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(204);
  });

  it('DELETE /api/relationships should delete the third relationship', async function () {
    await request(app)
      .delete(
        '/api/relationships/' + relationship2.stix.id + '/modified/' + relationship2.stix.modified,
      )
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(204);
  });

  it('GET /api/relationships returns an empty array of relationships', async function () {
    const res = await request(app)
      .get('/api/relationships')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an empty array
    const relationships = res.body;
    expect(relationships).toBeDefined();
    expect(Array.isArray(relationships)).toBe(true);
    expect(relationships.length).toBe(0);
  });

  after(async function () {
    await database.closeConnection();
  });
});
