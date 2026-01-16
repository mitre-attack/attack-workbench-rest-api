const fs = require('fs').promises;

const request = require('supertest');
const { expect } = require('expect');

const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');

const login = require('../../shared/login');

const logger = require('../../../lib/logger');
logger.level = 'debug';

const collectionBundlesService = require('../../../services/stix/collection-bundles-service');

async function readJson(path) {
  const data = await fs.readFile(require.resolve(path));
  return JSON.parse(data);
}

describe('Recent Activity API', function () {
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

  it('GET /api/recent-activity returns the placeholder identity', async function () {
    const res = await request(app)
      .get('/api/recent-activity')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const recentActivity = res.body;
    expect(recentActivity).toBeDefined();
    expect(Array.isArray(recentActivity)).toBe(true);
    expect(recentActivity.length).toBe(1);
    expect(recentActivity[0].stix.type).toBe('identity');
  });

  it('GET /api/recent-activity returns more objects after loading test data', async function () {
    const collectionBundle = await readJson('./sample-collection.json');
    const collections = collectionBundle.objects.filter(
      (object) => object.type === 'x-mitre-collection',
    );
    const importOptions = {};

    // Force the x-mitre-collection object to be the most recent
    const collectionTimestamp = new Date().toISOString();
    collectionBundle.objects[0].modified = collectionTimestamp;

    await collectionBundlesService.importBundle(collections[0], collectionBundle, importOptions);

    const res = await request(app)
      .get('/api/recent-activity')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const recentActivity = res.body;
    expect(recentActivity).toBeDefined();
    expect(Array.isArray(recentActivity)).toBe(true);
    expect(recentActivity.length).toBe(12);
    expect(recentActivity[0].stix.type).toBe('x-mitre-collection');
  });

  after(async function () {
    await database.closeConnection();
  });
});
