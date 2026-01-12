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
    name: 'attack-pattern-1',
    spec_version: '2.1',
    type: 'attack-pattern',
    description: 'This is a technique. Orange.',
    // external_references: [
    object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
    created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
    kill_chain_phases: [{ kill_chain_name: 'kill-chain-name-1', phase_name: 'phase-1' }],
    x_mitre_modified_by_ref: 'identity--d6424da5-85a0-496e-ae17-494499271108',
    // x_mitre_data_sources: ['data-source-1', 'data-source-2'], // TODO field is deprecated
    x_mitre_detection: 'detection text',
    x_mitre_is_subtechnique: false,
    x_mitre_impact_type: ['impact-1'],
    x_mitre_platforms: ['platform-1', 'platform-2'],
    x_mitre_network_requirements: true,
  },
};

describe('Techniques Basic API', function () {
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

  it('GET /api/techniques returns an empty array of techniques', async function () {
    const res = await request(app)
      .get('/api/techniques')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an empty array
    const techniques = res.body;
    expect(techniques).toBeDefined();
    expect(Array.isArray(techniques)).toBe(true);
    expect(techniques.length).toBe(0);
  });

  it('POST /api/techniques does not create an empty technique', async function () {
    const body = {};
    await request(app)
      .post('/api/techniques')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(400);
  });

  let technique1;
  it('POST /api/techniques creates a technique', async function () {
    const timestamp = new Date().toISOString();
    initialObjectData.stix.created = timestamp;
    initialObjectData.stix.modified = timestamp;
    const body = initialObjectData;
    const res = await request(app)
      .post('/api/techniques')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created technique
    technique1 = res.body;
    expect(technique1).toBeDefined();
    expect(technique1.stix).toBeDefined();
    expect(technique1.stix.id).toBeDefined();
    expect(technique1.stix.created).toBeDefined();
    expect(technique1.stix.modified).toBeDefined();
    expect(technique1.stix.x_mitre_attack_spec_version).toBe(config.app.attackSpecVersion);
    expect(technique1.workspace.workflow.created_by_user_account).toBeDefined();
    expect(technique1.workspace.attack_id).toBeDefined();
  });

  it('GET /api/techniques returns the added technique', async function () {
    const res = await request(app)
      .get('/api/techniques')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one technique in an array
    const techniques = res.body;
    expect(techniques).toBeDefined();
    expect(Array.isArray(techniques)).toBe(true);
    expect(techniques.length).toBe(1);
  });

  it('GET /api/techniques/:id should not return a technique when the id cannot be found', async function () {
    await request(app)
      .get('/api/techniques/not-an-id')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(404);
  });

  it('GET /api/techniques/:id returns the added technique', async function () {
    const res = await request(app)
      .get('/api/techniques/' + technique1.stix.id)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one technique in an array
    const techniques = res.body;
    expect(techniques).toBeDefined();
    expect(Array.isArray(techniques)).toBe(true);
    expect(techniques.length).toBe(1);

    const technique = techniques[0];
    expect(technique).toBeDefined();
    expect(technique.stix).toBeDefined();
    expect(technique.stix.id).toBe(technique1.stix.id);
    expect(technique.stix.type).toBe(technique1.stix.type);
    expect(technique.stix.name).toBe(technique1.stix.name);
    expect(technique.stix.description).toBe(technique1.stix.description);
    expect(technique.stix.spec_version).toBe(technique1.stix.spec_version);
    expect(technique.stix.object_marking_refs).toEqual(
      expect.arrayContaining(technique1.stix.object_marking_refs),
    );
    expect(technique.stix.created_by_ref).toBe(technique1.stix.created_by_ref);
    expect(technique.stix.x_mitre_modified_by_ref).toBe(technique1.stix.x_mitre_modified_by_ref);
    // x_mitre_data_sources is deprecated and not set in the test data
    if (technique1.stix.x_mitre_data_sources) {
      expect(technique.stix.x_mitre_data_sources).toEqual(
        expect.arrayContaining(technique1.stix.x_mitre_data_sources),
      );
    }
    expect(technique.stix.x_mitre_detection).toBe(technique1.stix.x_mitre_detection);
    expect(technique.stix.x_mitre_is_subtechnique).toBe(technique1.stix.x_mitre_is_subtechnique);
    expect(technique.stix.x_mitre_impact_type).toEqual(
      expect.arrayContaining(technique1.stix.x_mitre_impact_type),
    );
    expect(technique.stix.x_mitre_network_requirements).toEqual(
      technique1.stix.x_mitre_network_requirements,
    );
    expect(technique.stix.x_mitre_platforms).toEqual(
      expect.arrayContaining(technique1.stix.x_mitre_platforms),
    );
    expect(technique.stix.x_mitre_attack_spec_version).toBe(
      technique1.stix.x_mitre_attack_spec_version,
    );

    expect(technique.workspace.attack_id).toEqual(technique1.workspace.attack_id);

    expect(technique.stix.x_mitre_deprecated).toBe(false);
    expect(technique.stix.x_mitre_defense_bypassed).not.toBeDefined();
    expect(technique.stix.x_mitre_permissions_required).not.toBeDefined();
    expect(technique.stix.x_mitre_system_requirements).not.toBeDefined();
    expect(technique.stix.x_mitre_tactic_type).not.toBeDefined();

    expect(technique.created_by_identity).toBeDefined();
    expect(technique.modified_by_identity).toBeDefined();
    expect(technique.created_by_user_account).toBeDefined();
  });

  it('PUT /api/techniques updates a technique', async function () {
    const originalModified = technique1.stix.modified;
    const timestamp = new Date().toISOString();
    technique1.stix.modified = timestamp;
    technique1.stix.description = 'This is an updated technique.';
    const body = cloneForCreate(technique1);
    const res = await request(app)
      .put('/api/techniques/' + technique1.stix.id + '/modified/' + originalModified)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the updated technique
    const technique = res.body;
    expect(technique).toBeDefined();
    expect(technique.stix.id).toBe(technique1.stix.id);
    expect(technique.stix.modified).toBe(technique1.stix.modified);
  });

  it('POST /api/techniques does not create a technique with the same id and modified date', async function () {
    const body = cloneForCreate(technique1);
    await request(app)
      .post('/api/techniques')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(409);
  });

  let technique2;
  it('POST /api/techniques should create a new version of a technique with a duplicate stix.id but different stix.modified date', async function () {
    technique2 = cloneForCreate(technique1);
    const timestamp = new Date().toISOString();
    technique2.stix.modified = timestamp;
    technique2.stix.description = 'Still a technique. Purple!';
    const body = technique2;
    const res = await request(app)
      .post('/api/techniques')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created technique
    const technique = res.body;
    expect(technique).toBeDefined();
  });

  let technique3;
  it('POST /api/techniques should create a new version of a technique with a duplicate stix.id but different stix.modified date', async function () {
    technique3 = cloneForCreate(technique1);
    const timestamp = new Date().toISOString();
    technique3.stix.modified = timestamp;
    technique3.stix.description = 'Still a technique. Blue!';
    const body = technique3;
    const res = await request(app)
      .post('/api/techniques')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created technique
    const technique = res.body;
    expect(technique).toBeDefined();
  });

  it('GET /api/techniques returns the latest added technique', async function () {
    const res = await request(app)
      .get('/api/techniques/' + technique3.stix.id)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one technique in an array
    const techniques = res.body;
    expect(techniques).toBeDefined();
    expect(Array.isArray(techniques)).toBe(true);
    expect(techniques.length).toBe(1);
    const technique = techniques[0];
    expect(technique.stix.id).toBe(technique3.stix.id);
    expect(technique.stix.modified).toBe(technique3.stix.modified);
  });

  it('GET /api/techniques returns all added techniques', async function () {
    const res = await request(app)
      .get('/api/techniques/' + technique1.stix.id + '?versions=all')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get two techniques in an array
    const techniques = res.body;
    expect(techniques).toBeDefined();
    expect(Array.isArray(techniques)).toBe(true);
    expect(techniques.length).toBe(3);
  });

  it('GET /api/techniques/:id/modified/:modified returns the first added technique', async function () {
    const res = await request(app)
      .get('/api/techniques/' + technique1.stix.id + '/modified/' + technique1.stix.modified)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one technique in an array
    const technique = res.body;
    expect(technique).toBeDefined();
    expect(technique.stix).toBeDefined();
    expect(technique.stix.id).toBe(technique1.stix.id);
    expect(technique.stix.modified).toBe(technique1.stix.modified);
  });

  it('GET /api/techniques/:id/modified/:modified returns the second added technique', async function () {
    const res = await request(app)
      .get('/api/techniques/' + technique2.stix.id + '/modified/' + technique2.stix.modified)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one technique in an array
    const technique = res.body;
    expect(technique).toBeDefined();
    expect(technique.stix).toBeDefined();
    expect(technique.stix.id).toBe(technique2.stix.id);
    expect(technique.stix.modified).toBe(technique2.stix.modified);
  });

  it('GET /api/techniques uses the search parameter to return the latest version of the technique', async function () {
    const res = await request(app)
      .get('/api/techniques?search=blue')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one technique in an array
    const techniques = res.body;
    expect(techniques).toBeDefined();
    expect(Array.isArray(techniques)).toBe(true);
    expect(techniques.length).toBe(1);

    // We expect it to be the latest version of the technique
    const technique = techniques[0];
    expect(technique).toBeDefined();
    expect(technique.stix).toBeDefined();
    expect(technique.stix.id).toBe(technique3.stix.id);
    expect(technique.stix.modified).toBe(technique3.stix.modified);
  });

  it('GET /api/techniques uses the search parameter (ATT&CK ID) to return the latest version of the technique', async function () {
    // Use the auto-generated ATT&CK ID from technique1
    const attackId = technique1.workspace.attack_id;
    const res = await request(app)
      .get(`/api/techniques?search=${attackId}`)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one technique in an array
    const techniques = res.body;
    expect(techniques).toBeDefined();
    expect(Array.isArray(techniques)).toBe(true);
    expect(techniques.length).toBe(1);

    // We expect it to be the latest version of the technique
    const technique = techniques[0];
    expect(technique).toBeDefined();
    expect(technique.stix).toBeDefined();
    expect(technique.stix.id).toBe(technique3.stix.id);
    expect(technique.stix.modified).toBe(technique3.stix.modified);
    expect(technique.workspace.attack_id).toEqual(attackId);
  });

  it('GET /api/techniques should not get the first version of the techniques when using the search parameter', async function () {
    const res = await request(app)
      .get('/api/techniques?search=orange')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get zero techniques in an array
    const techniques = res.body;
    expect(techniques).toBeDefined();
    expect(Array.isArray(techniques)).toBe(true);
    expect(techniques.length).toBe(0);
  });

  it('DELETE /api/techniques/:id should not delete a technique when the id cannot be found', async function () {
    await request(app)
      .delete('/api/techniques/not-an-id')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(404);
  });

  it('DELETE /api/techniques/:id/modified/:modified deletes a technique', async function () {
    await request(app)
      .delete('/api/techniques/' + technique1.stix.id + '/modified/' + technique1.stix.modified)
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(204);
  });

  it('DELETE /api/techniques/:id should delete all the techniques with the same stix id', async function () {
    await request(app)
      .delete('/api/techniques/' + technique2.stix.id)
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(204);
  });

  it('GET /api/techniques returns an empty array of techniques', async function () {
    const res = await request(app)
      .get('/api/techniques')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an empty array
    const techniques = res.body;
    expect(techniques).toBeDefined();
    expect(Array.isArray(techniques)).toBe(true);
    expect(techniques.length).toBe(0);
  });

  after(async function () {
    await database.closeConnection();
  });
});
