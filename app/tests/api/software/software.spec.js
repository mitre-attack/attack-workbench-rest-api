const request = require('supertest');
const { expect } = require('expect');
const _ = require('lodash');

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
    name: 'software-1',
    spec_version: '2.1',
    type: 'malware',
    description: 'This is a malware type of software.',
    is_family: true,
    external_references: [{ source_name: 'source-1', external_id: 's1' }],
    object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
    created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
    x_mitre_version: '1.1',
    x_mitre_aliases: ['software-1'],
    x_mitre_platforms: ['platform-1'],
    x_mitre_contributors: ['contributor-1', 'contributor-2'],
    x_mitre_domains: ['mobile-attack'],
  },
};

// Software missing required property stix.name
const invalidMissingName = _.cloneDeep(initialObjectData);
invalidMissingName.stix.name = undefined;

// Software (malware) missing required property stix.is_family
const invalidMalwareMissingIsFamily = _.cloneDeep(initialObjectData);
delete invalidMalwareMissingIsFamily.stix.is_family;

// Software (tool) includes property stix.is_family
const invalidToolIncludesIsFamily = _.cloneDeep(initialObjectData);
invalidToolIncludesIsFamily.stix.type = 'tool';

describe('Software API', function () {
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

  it('GET /api/software returns an empty array of software', async function () {
    const res = await request(app)
      .get('/api/software')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an empty array
    const software = res.body;
    expect(software).toBeDefined();
    expect(Array.isArray(software)).toBe(true);
    expect(software.length).toBe(0);
  });

  it('POST /api/software does not create an empty software', async function () {
    const body = {};
    await request(app)
      .post('/api/software')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(400);
  });

  it('POST /api/software does not create a software missing the name property', async function () {
    const timestamp = new Date().toISOString();
    invalidMissingName.stix.created = timestamp;
    invalidMissingName.stix.modified = timestamp;
    const body = invalidMissingName;
    await request(app)
      .post('/api/software')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(400);
  });

  it('POST /api/software does not create a software (tool) with the is_family property', async function () {
    const timestamp = new Date().toISOString();
    invalidToolIncludesIsFamily.stix.created = timestamp;
    invalidToolIncludesIsFamily.stix.modified = timestamp;
    const body = invalidToolIncludesIsFamily;
    await request(app)
      .post('/api/software')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(400);
  });

  let software1;
  it('POST /api/software creates a software', async function () {
    const timestamp = new Date().toISOString();
    initialObjectData.stix.created = timestamp;
    initialObjectData.stix.modified = timestamp;
    const body = initialObjectData;
    const res = await request(app)
      .post('/api/software')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created software
    software1 = res.body;
    expect(software1).toBeDefined();
    expect(software1.stix).toBeDefined();
    expect(software1.stix.id).toBeDefined();
    expect(software1.stix.created).toBeDefined();
    expect(software1.stix.modified).toBeDefined();
    expect(software1.stix.x_mitre_attack_spec_version).toBe(config.app.attackSpecVersion);
  });

  it('GET /api/software returns the added software', async function () {
    const res = await request(app)
      .get('/api/software')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one software in an array
    const software = res.body;
    expect(software).toBeDefined();
    expect(Array.isArray(software)).toBe(true);
    expect(software.length).toBe(1);
  });

  it('GET /api/software/:id should not return a software when the id cannot be found', async function () {
    await request(app)
      .get('/api/software/not-an-id')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(404);
  });

  it('GET /api/software/:id returns the added software', async function () {
    const res = await request(app)
      .get('/api/software/' + software1.stix.id)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one software in an array
    const softwareObjects = res.body;
    expect(softwareObjects).toBeDefined();
    expect(Array.isArray(softwareObjects)).toBe(true);
    expect(softwareObjects.length).toBe(1);

    const software = softwareObjects[0];
    expect(software).toBeDefined();
    expect(software.stix).toBeDefined();
    expect(software.stix.id).toBe(software1.stix.id);
    expect(software.stix.type).toBe(software1.stix.type);
    expect(software.stix.name).toBe(software1.stix.name);
    expect(software.stix.description).toBe(software1.stix.description);
    expect(software.stix.is_family).toBe(software1.stix.is_family);
    expect(software.stix.spec_version).toBe(software1.stix.spec_version);
    expect(software.stix.object_marking_refs).toEqual(
      expect.arrayContaining(software1.stix.object_marking_refs),
    );
    expect(software.stix.created_by_ref).toBe(software1.stix.created_by_ref);
    expect(software.stix.x_mitre_version).toBe(software1.stix.x_mitre_version);
    expect(software.stix.x_mitre_aliases).toEqual(
      expect.arrayContaining(software1.stix.x_mitre_aliases),
    );
    expect(software.stix.x_mitre_platforms).toEqual(
      expect.arrayContaining(software1.stix.x_mitre_platforms),
    );
    expect(software.stix.x_mitre_contributors).toEqual(
      expect.arrayContaining(software1.stix.x_mitre_contributors),
    );
    expect(software.stix.x_mitre_attack_spec_version).toBe(
      software1.stix.x_mitre_attack_spec_version,
    );
  });

  it('PUT /api/software updates a software', async function () {
    const originalModified = software1.stix.modified;
    const timestamp = new Date().toISOString();
    software1.stix.modified = timestamp;
    software1.stix.description = 'This is an updated software.';
    const body = software1;
    const res = await request(app)
      .put('/api/software/' + software1.stix.id + '/modified/' + originalModified)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the updated software
    const software = res.body;
    expect(software).toBeDefined();
    expect(software.stix.id).toBe(software1.stix.id);
    expect(software.stix.modified).toBe(software1.stix.modified);
  });

  it('POST /api/software does not create a software with the same id and modified date', async function () {
    const body = software1;
    await request(app)
      .post('/api/software')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(409);
  });

  let software2;
  it('POST /api/software should create a new version of a software with a duplicate stix.id but different stix.modified date', async function () {
    software2 = cloneForCreate(software1);
    const timestamp = new Date().toISOString();
    software2.stix.modified = timestamp;
    const body = software2;
    const res = await request(app)
      .post('/api/software')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created software
    const software = res.body;
    expect(software).toBeDefined();
  });

  it('GET /api/software returns the latest added software', async function () {
    const res = await request(app)
      .get('/api/software/' + software2.stix.id)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one software in an array
    const software = res.body;
    expect(software).toBeDefined();
    expect(Array.isArray(software)).toBe(true);
    expect(software.length).toBe(1);
    const softwre = software[0];
    expect(softwre.stix.id).toBe(software2.stix.id);
    expect(softwre.stix.modified).toBe(software2.stix.modified);
  });

  it('GET /api/software returns all added software', async function () {
    const res = await request(app)
      .get('/api/software/' + software1.stix.id + '?versions=all')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get two software in an array
    const software = res.body;
    expect(software).toBeDefined();
    expect(Array.isArray(software)).toBe(true);
    expect(software.length).toBe(2);
  });

  it('GET /api/software/:id/modified/:modified returns the first added software', async function () {
    const res = await request(app)
      .get('/api/software/' + software1.stix.id + '/modified/' + software1.stix.modified)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one software in an array
    const software = res.body;
    expect(software).toBeDefined();
    expect(software.stix).toBeDefined();
    expect(software.stix.id).toBe(software1.stix.id);
    expect(software.stix.modified).toBe(software1.stix.modified);
  });

  it('GET /api/software/:id/modified/:modified returns the second added software', async function () {
    const res = await request(app)
      .get('/api/software/' + software2.stix.id + '/modified/' + software2.stix.modified)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one software in an array
    const software = res.body;
    expect(software).toBeDefined();
    expect(software.stix).toBeDefined();
    expect(software.stix.id).toBe(software2.stix.id);
    expect(software.stix.modified).toBe(software2.stix.modified);
  });

  let software3;
  it('POST /api/software should create a new version of a software with a duplicate stix.id but different stix.modified date', async function () {
    software3 = cloneForCreate(software1);
    const timestamp = new Date().toISOString();
    software3.stix.modified = timestamp;
    const body = software3;
    const res = await request(app)
      .post('/api/software')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created software
    const software = res.body;
    expect(software).toBeDefined();
  });

  it('DELETE /api/software/:id should not delete a software when the id cannot be found', async function () {
    await request(app)
      .delete('/api/software/not-an-id')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(404);
  });

  it('DELETE /api/software/:id/modified/:modified deletes a software', async function () {
    await request(app)
      .delete('/api/software/' + software1.stix.id + '/modified/' + software1.stix.modified)
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(204);
  });

  it('DELETE /api/software/:id should delete all the software with the same stix id', async function () {
    await request(app)
      .delete('/api/software/' + software2.stix.id)
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(204);
  });

  it('GET /api/software returns an empty array of software', async function () {
    const res = await request(app)
      .get('/api/software')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an empty array
    const software = res.body;
    expect(software).toBeDefined();
    expect(Array.isArray(software)).toBe(true);
    expect(software.length).toBe(0);
  });

  it('POST /api/software creates a software (malware) missing the is_family property using a default value', async function () {
    const timestamp = new Date().toISOString();
    invalidMalwareMissingIsFamily.stix.created = timestamp;
    invalidMalwareMissingIsFamily.stix.modified = timestamp;
    const body = invalidMalwareMissingIsFamily;
    const res = await request(app)
      .post('/api/software')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created software
    const malware = res.body;
    expect(malware).toBeDefined();
    expect(malware.stix).toBeDefined();
    expect(malware.stix.id).toBeDefined();
    expect(malware.stix.created).toBeDefined();
    expect(malware.stix.modified).toBeDefined();
    expect(typeof malware.stix.is_family).toBe('boolean');
    expect(malware.stix.is_family).toBe(true);
  });

  after(async function () {
    await database.closeConnection();
  });
});
