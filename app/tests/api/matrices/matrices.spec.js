const fs = require('fs').promises;

const request = require('supertest');
const { expect } = require('expect');

const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');

const config = require('../../../config/config');
const login = require('../../shared/login');
const { cloneForCreate } = require('../../shared/clone-for-create');

const logger = require('../../../lib/logger');
logger.level = 'debug';

const collectionBundlesService = require('../../../services/stix/collection-bundles-service');

async function readJson(path) {
  const data = await fs.readFile(require.resolve(path));
  return JSON.parse(data);
}

// modified and created properties will be set before calling REST API
// stix.id property will be created by REST API
const initialObjectData = {
  workspace: {
    workflow: {
      state: 'work-in-progress',
    },
  },
  stix: {
    name: 'matrix-1',
    spec_version: '2.1',
    type: 'x-mitre-matrix',
    description: 'This is a matrix.',
    external_references: [{ source_name: 'source-1', external_id: 's1' }],
    object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
    created_by_ref: 'identity--6444f546-6900-4456-b3b1-015c88d70dab',
    tactic_refs: [
      'x-mitre-tactic--daa4cbb1-b4f4-4723-a824-7f1efd6e0592',
      'x-mitre-tactic--d679bca2-e57d-4935-8650-8031c87a4400',
    ],
    x_mitre_domains: ['mitre-attack'],
    x_mitre_version: '1.0',
  },
};

describe('Matrices API', function () {
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

  it('GET /api/matrices returns an empty array of matrices', async function () {
    const res = await request(app)
      .get('/api/matrices')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an empty array
    const matrices = res.body;
    expect(matrices).toBeDefined();
    expect(Array.isArray(matrices)).toBe(true);
    expect(matrices.length).toBe(0);
  });

  it('POST /api/matrices does not create an empty matrix', async function () {
    const body = {};
    await request(app)
      .post('/api/matrices')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(400);
  });

  let matrix1;
  it('POST /api/matrices creates a matrix', async function () {
    const timestamp = new Date().toISOString();
    initialObjectData.stix.created = timestamp;
    initialObjectData.stix.modified = timestamp;
    const body = initialObjectData;
    const res = await request(app)
      .post('/api/matrices')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created matrix
    matrix1 = res.body;
    expect(matrix1).toBeDefined();
    expect(matrix1.stix).toBeDefined();
    expect(matrix1.stix.id).toBeDefined();
    expect(matrix1.stix.created).toBeDefined();
    expect(matrix1.stix.modified).toBeDefined();
    expect(matrix1.stix.x_mitre_attack_spec_version).toBe(config.app.attackSpecVersion);
  });

  it('GET /api/matrices returns the added matrix', async function () {
    const res = await request(app)
      .get('/api/matrices')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one matrix in an array
    const matrices = res.body;
    expect(matrices).toBeDefined();
    expect(Array.isArray(matrices)).toBe(true);
    expect(matrices.length).toBe(1);
  });

  it('GET /api/matrices/:id should not return a matrix when the id cannot be found', async function () {
    await request(app)
      .get('/api/matrices/not-an-id')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(404);
  });

  it('GET /api/matrices/:id returns the added matrix', async function () {
    const res = await request(app)
      .get('/api/matrices/' + matrix1.stix.id)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one matrix in an array
    const matrices = res.body;
    expect(matrices).toBeDefined();
    expect(Array.isArray(matrices)).toBe(true);
    expect(matrices.length).toBe(1);

    const matrix = matrices[0];
    expect(matrix).toBeDefined();
    expect(matrix.stix).toBeDefined();
    expect(matrix.stix.id).toBe(matrix1.stix.id);
    expect(matrix.stix.created).toBeDefined();
    expect(matrix.stix.modified).toBeDefined();
    expect(matrix.stix.type).toBe(matrix1.stix.type);
    expect(matrix.stix.name).toBe(matrix1.stix.name);
    expect(matrix.stix.description).toBe(matrix1.stix.description);
    expect(matrix.stix.spec_version).toBe(matrix1.stix.spec_version);
    expect(matrix.stix.object_marking_refs).toEqual(
      expect.arrayContaining(matrix1.stix.object_marking_refs),
    );
    expect(matrix.stix.created_by_ref).toBe(matrix1.stix.created_by_ref);
    expect(matrix.stix.x_mitre_attack_spec_version).toBe(matrix1.stix.x_mitre_attack_spec_version);
  });

  it('PUT /api/matrices updates a matrix', async function () {
    const originalModified = matrix1.stix.modified;
    const timestamp = new Date().toISOString();
    matrix1.stix.modified = timestamp;
    matrix1.stix.description = 'This is an updated matrix.';
    const body = matrix1;

    const res = await request(app)
      .put('/api/matrices/' + matrix1.stix.id + '/modified/' + originalModified)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the updated matrix
    const matrix = res.body;
    expect(matrix).toBeDefined();
    expect(matrix.stix.id).toBe(matrix1.stix.id);
    expect(matrix.stix.modified).toBe(matrix1.stix.modified);
  });

  it('POST /api/matrices does not create a matrix with the same id and modified date', async function () {
    const body = matrix1;
    await request(app)
      .post('/api/matrices')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(409);
  });

  let matrix2;
  it('POST /api/matrices should create a new version of a matrix with a duplicate stix.id but different stix.modified date', async function () {
    matrix2 = cloneForCreate(matrix1);
    const timestamp = new Date().toISOString();
    matrix2.stix.modified = timestamp;
    const body = matrix2;

    const res = await request(app)
      .post('/api/matrices')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created matrix
    const matrix = res.body;
    expect(matrix).toBeDefined();
  });

  let matrix3;
  it('POST /api/matrices should create a new version of a matrix with a duplicate stix.id but different stix.modified date', async function () {
    matrix3 = cloneForCreate(matrix1);
    const timestamp = new Date().toISOString();
    matrix3.stix.modified = timestamp;
    const body = matrix3;

    const res = await request(app)
      .post('/api/matrices')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created matrix
    const matrix = res.body;
    expect(matrix).toBeDefined();
  });

  it('GET /api/matrices returns the latest added matrix', async function () {
    const res = await request(app)
      .get('/api/matrices/' + matrix3.stix.id)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);
    // We expect to get one matrix in an array
    const matrices = res.body;
    expect(matrices).toBeDefined();
    expect(Array.isArray(matrices)).toBe(true);
    expect(matrices.length).toBe(1);
    const matrix = matrices[0];
    expect(matrix.stix.id).toBe(matrix3.stix.id);
    expect(matrix.stix.modified).toBe(matrix3.stix.modified);
  });

  it('GET /api/matrices returns all added matrices', async function () {
    const res = await request(app)
      .get('/api/matrices/' + matrix1.stix.id + '?versions=all')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get two matrices in an array
    const matrices = res.body;
    expect(matrices).toBeDefined();
    expect(Array.isArray(matrices)).toBe(true);
    expect(matrices.length).toBe(3);
  });

  it('GET /api/matrices/:id/modified/:modified returns the first added matrix', async function () {
    const res = await request(app)
      .get('/api/matrices/' + matrix1.stix.id + '/modified/' + matrix1.stix.modified)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);
    // We expect to get one matrix in an array
    const matrix = res.body;
    expect(matrix).toBeDefined();
    expect(matrix.stix).toBeDefined();
    expect(matrix.stix.id).toBe(matrix1.stix.id);
    expect(matrix.stix.modified).toBe(matrix1.stix.modified);
  });

  it('GET /api/matrices/:id/modified/:modified returns the second added matrix', async function () {
    const res = await request(app)
      .get('/api/matrices/' + matrix2.stix.id + '/modified/' + matrix2.stix.modified)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one matrix in an array
    const matrix = res.body;
    expect(matrix).toBeDefined();
    expect(matrix.stix).toBeDefined();
    expect(matrix.stix.id).toBe(matrix2.stix.id);
    expect(matrix.stix.modified).toBe(matrix2.stix.modified);
  });

  it('DELETE /api/matrices/:id should not delete a matrix when the id cannot be found', async function () {
    await request(app)
      .delete('/api/matrices/not-an-id')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(404);
  });

  it('DELETE /api/matrices/:id/modified/:modified deletes a matrix', async function () {
    await request(app)
      .delete('/api/matrices/' + matrix1.stix.id + '/modified/' + matrix1.stix.modified)
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(204);
  });

  it('DELETE /api/matrices/:id should delete all the matrices with the same stix id', async function () {
    await request(app)
      .delete('/api/matrices/' + matrix2.stix.id)
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(204);
  });

  it('GET /api/matrices returns an empty array of matrices', async function () {
    const res = await request(app)
      .get('/api/matrices')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an empty array
    const matrices = res.body;
    expect(matrices).toBeDefined();
    expect(Array.isArray(matrices)).toBe(true);
    expect(matrices.length).toBe(0);
  });

  it('GET /api/matrices/:id/modified/:modified/techniques returns its techniques', async function () {
    const collectionBundle = await readJson('./matrices.techniques.tactics.json');
    const collections = collectionBundle.objects.filter(
      (object) => object.type === 'x-mitre-collection',
    );

    const importOptions = {};
    await collectionBundlesService.importBundle(collections[0], collectionBundle, importOptions);

    const res = await request(app)
      .get(
        '/api/matrices/x-mitre-matrix--2a4858a3-85c3-4418-9729-c3e79800acf7/modified/2020-01-01T00:00:00.000Z/techniques',
      )
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const techniques = res.body;
    expect(techniques).toBeDefined();
    expect(techniques['Nanna-Suen']).toBeDefined();
    expect(techniques['Nanna-Suen'].techniques).toBeDefined();
    expect(Array.isArray(techniques['Nanna-Suen'].techniques)).toBe(true);
    expect(techniques['Nanna-Suen'].techniques.length).toBe(1);
    expect(techniques['Nanna-Suen'].techniques[0].stix.name).toBe('Sample Technique 2');
  });

  after(async function () {
    await database.closeConnection();
  });
});
