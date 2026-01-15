const request = require('supertest');
const { expect } = require('expect');
const uuid = require('uuid');

const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const config = require('../../../config/config');
const { cloneForCreate } = require('../../shared/clone-for-create');

const logger = require('../../../lib/logger');
logger.level = 'debug';

const initialTacticData = {
  workspace: {
    workflow: {
      state: 'work-in-progress',
    },
  },
  stix: {
    name: 'x-mitre-tactic-1',
    spec_version: '2.1',
    type: 'x-mitre-tactic',
    description: 'This is a tactic. yellow.',
    external_references: [{ source_name: 'source-1', external_id: 's1' }],
    object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
  },
};

const newIdentityData = {
  workspace: {
    workflow: {
      state: 'work-in-progress',
    },
  },
  stix: {
    name: 'identity-1',
    identity_class: 'organization',
    spec_version: '2.1',
    type: 'identity',
    description: 'This is an identity.',
    object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
  },
};

describe('Create Object with Organization Identity API', function () {
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

  let placeholderIdentity;
  it('GET /api/config/organization-identity returns the organizaton identity', async function () {
    const res = await request(app)
      .get('/api/config/organization-identity')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the organization identity
    placeholderIdentity = res.body;
    expect(placeholderIdentity).toBeDefined();
  });

  let tactic1;
  it('POST /api/tactics creates a tactic', async function () {
    initialTacticData.stix.id = `x-mitre-tactic--${uuid.v4()}`;
    const timestamp = new Date().toISOString();
    initialTacticData.stix.created = timestamp;
    initialTacticData.stix.modified = timestamp;
    const body = initialTacticData;
    const res = await request(app)
      .post('/api/tactics')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created tactic
    tactic1 = res.body;
    expect(tactic1).toBeDefined();
    expect(tactic1.stix).toBeDefined();
    expect(tactic1.stix.id).toBeDefined();
    expect(tactic1.stix.created).toBeDefined();
    expect(tactic1.stix.modified).toBeDefined();
    expect(tactic1.stix.created_by_ref).toBeDefined();
    expect(tactic1.stix.x_mitre_modified_by_ref).toBeDefined();
    expect(tactic1.stix.created_by_ref).toBe(placeholderIdentity.stix.id);
    expect(tactic1.stix.x_mitre_modified_by_ref).toBe(placeholderIdentity.stix.id);
  });

  let newIdentity;
  it('POST /api/identities creates an identity', async function () {
    const timestamp = new Date().toISOString();
    newIdentityData.stix.created = timestamp;
    newIdentityData.stix.modified = timestamp;
    const body = newIdentityData;
    const res = await request(app)
      .post('/api/identities')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created identity
    newIdentity = res.body;
    expect(newIdentity).toBeDefined();
    expect(newIdentity.stix).toBeDefined();
    expect(newIdentity.stix.id).toBeDefined();
    expect(newIdentity.stix.created).toBeDefined();
    expect(newIdentity.stix.modified).toBeDefined();
  });

  it('POST /api/config/organization-identity sets the organization identity', async function () {
    const body = {
      id: newIdentity.stix.id,
    };
    // We expect the response body to be empty
    await request(app)
      .post('/api/config/organization-identity')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(204);
  });

  it('POST /api/tactics creates a new version of the tactic', async function () {
    const tactic2 = cloneForCreate(tactic1);
    const timestamp = new Date().toISOString();
    tactic2.stix.modified = timestamp;
    const body = tactic2;
    const res = await request(app)
      .post('/api/tactics')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created tactic
    const tactic = res.body;
    expect(tactic).toBeDefined();
    expect(tactic.stix).toBeDefined();
    expect(tactic.stix.id).toBeDefined();
    expect(tactic.stix.created).toBeDefined();
    expect(tactic.stix.modified).toBeDefined();
    expect(tactic.stix.created_by_ref).toBeDefined();
    expect(tactic.stix.x_mitre_modified_by_ref).toBeDefined();
    expect(tactic.stix.created_by_ref).toBe(placeholderIdentity.stix.id);
    expect(tactic.stix.x_mitre_modified_by_ref).toBe(newIdentity.stix.id); // Should match the new identity
  });

  after(async function () {
    await database.closeConnection();
  });
});
