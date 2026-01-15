const request = require('supertest');
const { expect } = require('expect');

const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const config = require('../../../config/config');
const logger = require('../../../lib/logger');
logger.level = 'debug';

const Reference = require('../../../models/reference-model');

// modified and created properties will be set before calling REST API
// stix.id property will be created by REST API
const initialObjectData1 = {
  source_name: 'source 1',
  description: 'This is a reference (#1)',
  url: 'https://www.reference-site.com/myreferencelink1',
};

const initialObjectData2 = {
  source_name: 'source 2',
  description: 'This is a reference (#2)',
  url: 'https://www.reference-site.com/myreferencelink2',
};

const initialObjectData3 = {
  source_name: 'unique source 3',
  description: 'This is a reference (#3)',
  url: 'https://www.reference-site.com/myreferencelink3',
};

describe('References API', function () {
  let app;
  let passportCookie;

  before(async function () {
    // Establish the database connection
    // Use an in-memory database that we spin up for the test
    await database.initializeConnection();

    // Check for a valid database configuration
    await databaseConfiguration.checkSystemConfiguration();

    // Wait until the Reference indexes are created
    await Reference.init();

    // Disable ADM validation for tests
    config.validateRequests.withAttackDataModel = false;
    config.validateRequests.withOpenApi = true;

    // Initialize the express app
    app = await require('../../../index').initializeApp();

    // Log into the app
    passportCookie = await login.loginAnonymous(app);
  });

  it('GET /api/references returns an empty array of references', async function () {
    const res = await request(app)
      .get('/api/references')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an empty array
    const references = res.body;
    expect(references).toBeDefined();
    expect(Array.isArray(references)).toBe(true);
    expect(references.length).toBe(0);
  });

  it('POST /api/references does not create an empty reference', async function () {
    const body = {};
    await request(app)
      .post('/api/references')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(400);
  });

  let reference1;
  it('POST /api/references creates a reference', async function () {
    const body = initialObjectData1;
    const res = await request(app)
      .post('/api/references')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created reference
    reference1 = res.body;
    expect(reference1).toBeDefined();
  });

  let reference2;
  it('POST /api/references creates a second reference', async function () {
    const body = initialObjectData2;
    const res = await request(app)
      .post('/api/references')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created reference
    reference2 = res.body;
    expect(reference2).toBeDefined();
  });

  let reference3;
  it('POST /api/references creates a third reference', async function () {
    const body = initialObjectData3;
    const res = await request(app)
      .post('/api/references')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created reference
    reference3 = res.body;
    expect(reference3).toBeDefined();
  });

  it('GET /api/references returns the added references', async function () {
    const res = await request(app)
      .get('/api/references')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one reference in an array
    const references = res.body;
    expect(references).toBeDefined();
    expect(Array.isArray(references)).toBe(true);
    expect(references.length).toBe(3);
  });

  it('GET /api/references should return an empty array of references when the source_name cannot be found', async function () {
    const res = await request(app)
      .get('/api/references?sourceName=notasourcename')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200);

    // We expect to get an empty array
    const references = res.body;
    expect(references).toBeDefined();
    expect(Array.isArray(references)).toBe(true);
    expect(references.length).toBe(0);
  });

  it('GET /api/references returns the first added reference', async function () {
    const res = await request(app)
      .get('/api/references?sourceName=' + encodeURIComponent(reference1.source_name))
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one reference in an array
    const references = res.body;
    expect(references).toBeDefined();
    expect(Array.isArray(references)).toBe(true);
    expect(references.length).toBe(1);

    const reference = references[0];
    expect(reference).toBeDefined();
    expect(reference.source_name).toBe(reference1.source_name);
    expect(reference.description).toBe(reference1.description);
    expect(reference.url).toBe(reference1.url);
  });

  it('GET /api/references uses the search parameter to return the third added reference', async function () {
    const res = await request(app)
      .get('/api/references?search=' + encodeURIComponent('#3'))
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one reference in an array
    const references = res.body;
    expect(references).toBeDefined();
    expect(Array.isArray(references)).toBe(true);
    expect(references.length).toBe(1);

    const reference = references[0];
    expect(reference).toBeDefined();
    expect(reference.source_name).toBe(reference3.source_name);
    expect(reference.description).toBe(reference3.description);
    expect(reference.url).toBe(reference3.url);
  });

  it('GET /api/references uses the search parameter to return the third added reference searching fields in the source_name', async function () {
    const res = await request(app)
      .get('/api/references?search=' + encodeURIComponent('unique'))
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one reference in an array
    const references = res.body;
    expect(references).toBeDefined();
    expect(Array.isArray(references)).toBe(true);
    expect(references.length).toBe(1);

    const reference = references[0];
    expect(reference).toBeDefined();
    expect(reference.source_name).toBe(reference3.source_name);
    expect(reference.description).toBe(reference3.description);
    expect(reference.url).toBe(reference3.url);
  });

  it('PUT /api/references does not update a reference when the source_name is missing', async function () {
    const body = { description: 'This reference does not have a source_name', url: '' };
    await request(app)
      .put('/api/references')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(400);
  });

  it('PUT /api/references does not update a reference when the source_name is not in the database', async function () {
    const body = {
      source_name: 'not-a-reference',
      description: 'This reference is not in the database',
      url: '',
    };
    await request(app)
      .put('/api/references')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(404);
  });

  it('PUT /api/references updates a reference', async function () {
    reference1.description = 'This is a new description';
    const body = reference1;
    const res = await request(app)
      .put('/api/references')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the updated reference
    const reference = res.body;
    expect(reference).toBeDefined();
    expect(reference.source_name).toBe(reference1.source_name);
    expect(reference.description).toBe(reference1.description);
  });

  it('POST /api/references does not create a reference with a duplicate source_name', async function () {
    const body = reference1;
    await request(app)
      .post('/api/references')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(409);
  });

  it('DELETE /api/references does not delete a reference when the source_name is omitted', async function () {
    await request(app)
      .delete('/api/references')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(400);
  });

  it('DELETE /api/references does not delete a reference with a non-existent source_name', async function () {
    await request(app)
      .delete('/api/references?sourceName=not-a-reference')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(404);
  });

  it('DELETE /api/references deletes a reference', async function () {
    await request(app)
      .delete(`/api/references?sourceName=${reference1.source_name}`)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(204);
  });

  after(async function () {
    await database.closeConnection();
  });
});
