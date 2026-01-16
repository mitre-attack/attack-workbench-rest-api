const fs = require('fs').promises;

const request = require('supertest');
const { expect } = require('expect');

const login = require('../../shared/login');

const logger = require('../../../lib/logger');
logger.level = 'debug';

const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');

const collectionBundlesService = require('../../../services/stix/collection-bundles-service');

async function readJson(path) {
  const data = await fs.readFile(require.resolve(path));
  return JSON.parse(data);
}

describe('Techniques with Tactics API', function () {
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

    const collectionBundle = await readJson('./techniques.tactics.json');
    const collections = collectionBundle.objects.filter(
      (object) => object.type === 'x-mitre-collection',
    );

    const importOptions = {};
    await collectionBundlesService.importBundle(collections[0], collectionBundle, importOptions);

    // Log into the app
    passportCookie = await login.loginAnonymous(app);
  });

  const techniqueId1 = 'attack-pattern--757471d4-d931-4109-82dd-cdd50c04744e';
  const techniqueId2 = 'attack-pattern--fb93f707-fd21-421f-a8b3-4baee9211b3a';

  let technique1;
  let technique2;
  it('GET /api/techniques should return the preloaded technique', async function () {
    const res = await request(app)
      .get('/api/techniques')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const techniques = res.body;
    expect(techniques).toBeDefined();
    expect(Array.isArray(techniques)).toBe(true);
    expect(techniques.length).toBe(2);

    technique1 = techniques.find((t) => t.stix.id === techniqueId1);
    technique2 = techniques.find((t) => t.stix.id === techniqueId2);
  });

  it('GET /api/tactics should return the preloaded tactics', async function () {
    const res = await request(app)
      .get('/api/tactics')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const tactics = res.body;
    expect(tactics).toBeDefined();
    expect(Array.isArray(tactics)).toBe(true);
    expect(tactics.length).toBe(6);
  });

  it('GET /api/techniques/:id/modified/:modified/tactics should not return the tactics when the technique cannot be found', async function () {
    await request(app)
      .get(`/api/techniques/not-an-id/modified/2022-01-01T00:00:00.000Z/tactics`)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(404);
  });

  it('GET /api/techniques/:id/modified/:modified/tactics should return the tactics for technique 1', async function () {
    const res = await request(app)
      .get(`/api/techniques/${technique1.stix.id}/modified/${technique1.stix.modified}/tactics`)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const tactics = res.body;
    expect(tactics).toBeDefined();
    expect(Array.isArray(tactics)).toBe(true);
    expect(tactics.length).toBe(2);
  });

  it('GET /api/techniques/:id/modified/:modified/tactics should return the tactics for technique 2', async function () {
    const res = await request(app)
      .get(`/api/techniques/${technique2.stix.id}/modified/${technique2.stix.modified}/tactics`)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const tactics = res.body;
    expect(tactics).toBeDefined();
    expect(Array.isArray(tactics)).toBe(true);
    expect(tactics.length).toBe(5);
  });

  it('GET /api/techniques/:id/modified/:modified/tactics should return the first page of tactics for technique 2', async function () {
    const res = await request(app)
      .get(
        `/api/techniques/${technique2.stix.id}/modified/${technique2.stix.modified}/tactics?offset=0&limit=2&includePagination=true`,
      )
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const results = res.body;
    const tactics = results.data;
    expect(tactics).toBeDefined();
    expect(Array.isArray(tactics)).toBe(true);
    expect(tactics.length).toBe(2);
  });

  after(async function () {
    await database.closeConnection();
  });
});
