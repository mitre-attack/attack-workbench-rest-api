const request = require('supertest');
const { expect } = require('expect');

const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const AttackObject = require('../../../models/attack-object-model');
const config = require('../../../config/config');
const login = require('../../shared/login');

const logger = require('../../../lib/logger');
logger.level = 'debug';

const targetRef2 = 'attack-pattern--d63a3fb8-9452-4e9d-a60a-54be68d5998c';

// test malware object
const malwareObject = {
  workspace: {
    workflow: {
      state: 'work-in-progress',
    },
  },
  stix: {
    id: 'malware--1c1ab115-f015-462c-92a0-f887277d8519',
    name: 'software-2',
    spec_version: '2.1',
    type: 'malware',
    description:
      'This is a malware type of software, with a URL that it should not have (https://attack.mitre.org/software/SW0001)',
    is_family: false,
    object_marking_refs: ['marking-definition--c2a0b8f8-51d4-4702-8e42-ce7a65235bce'],
    x_mitre_version: '1.1',
    x_mitre_contributors: ['contributor-mk', 'contributor-cm'],
    x_mitre_domains: ['mobile-attack'],
    created: '2023-03-01T00:00:00.000Z',
    modified: '2023-03-01T00:00:00.000Z',
  },
};

const initialObjectData = {
  workspace: {
    workflow: {
      state: 'work-in-progress',
    },
  },
  stix: {
    spec_version: '2.1',
    type: 'relationship',
    description: 'This is a relationship containing https://attack.mitre.org/.',
    source_ref: malwareObject.stix.id,
    relationship_type: 'uses',
    target_ref: targetRef2,
    external_references: [{ source_name: 'source-1', external_id: 's1' }],
    object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
    created_by_ref: 'identity--6444f546-6900-4456-b3b1-015c88d70dab',
  },
};

describe('Reports API', function () {
  let app;
  let passportCookie;

  before(async function () {
    // Establish the database connection
    // Use an in-memory database that we spin up for the test
    await database.initializeConnection();

    // Wait until the indexes are created
    await AttackObject.init();

    // Check for a valid database configuration
    await databaseConfiguration.checkSystemConfiguration();

    // Enable ADM validation; the request payloads in this spec are ADM-compliant
    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;

    // Initialize the express app
    app = await require('../../../index').initializeApp();

    // Log into the app
    passportCookie = await login.loginAnonymous(app);
  });

  let software1;
  it('POST /api/software creates a software', async function () {
    // Further setup - need to index malware object with in database first
    const body = malwareObject;
    const res = await request(app)
      .post('/api/software')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    software1 = res.body;
    expect(software1).toBeDefined();
    expect(software1.stix).toBeDefined();
    expect(software1.stix.id).toBeDefined();
    expect(software1.stix.created).toBeDefined();
    expect(software1.stix.modified).toBeDefined();
  });

  it('GET /api/reports/link-by-id/missing returns the object with an attack.mitre.org URL in the description', async function () {
    const res = await request(app)
      .get('/api/reports/link-by-id/missing')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get ATT&CK objects in an array
    const attackObjects = res.body;
    expect(attackObjects).toBeDefined();
    expect(Array.isArray(attackObjects)).toBe(true);

    expect(attackObjects.length).toBe(1);
    expect(attackObjects[0].stix.name).toBe('software-2');
  });

  let relationship2;
  it('POST /api/relationships creates a relationship', async function () {
    const timestamp = new Date().toISOString();
    initialObjectData.stix.created = timestamp;
    initialObjectData.stix.modified = timestamp;
    initialObjectData.stix.source_ref = software1.stix.id;
    initialObjectData.stix.target_ref = targetRef2;
    const body = initialObjectData;
    const res = await request(app)
      .post('/api/relationships')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created relationship
    relationship2 = res.body;
    expect(relationship2).toBeDefined();
  });

  it('GET /api/reports/link-by-id/missing returns the relationship with an attack.mitre.org URL in the description', async function () {
    const res = await request(app)
      .get('/api/reports/link-by-id/missing')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one relationship in an array
    const mlRelationships = res.body;
    expect(mlRelationships).toBeDefined();
    expect(Array.isArray(mlRelationships)).toBe(true);

    expect(mlRelationships.length).toBe(2);
    expect(mlRelationships[0].stix.source_ref).toBe(software1.stix.id);
  });

  after(async function () {
    await database.closeConnection();
  });
});
