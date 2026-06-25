const request = require('supertest');
const { expect } = require('expect');
const fs = require('fs');

const logger = require('../../lib/logger');
logger.level = 'debug';

const database = require('../../lib/database-in-memory');
const databaseConfiguration = require('../../lib/database-configuration');
const path = require('path');

const login = require('../shared/login');

const testFilePath = './test-files';

// Get a list of collection bundle filenames in the test-files sub-directory
const collectionBundleFilenames = [];
const directory = path.join(__dirname, testFilePath);
if (fs.existsSync(directory)) {
  fs.readdirSync(directory).forEach((filename) => {
    if (filename.endsWith('.json')) {
      collectionBundleFilenames.push(filename);
    }
  });
}

async function readJson(filePath) {
  const fullPath = require.resolve(filePath);
  const data = await fs.promises.readFile(fullPath);
  return JSON.parse(data);
}

describe('Collection Bundles API Full-Size Test', function () {
  let app;
  let passportCookie;

  before(async function () {
    // Establish the database connection
    // Use an in-memory database that we spin up for the test
    await database.initializeConnection();

    // Check for a valid database configuration
    await databaseConfiguration.checkSystemConfiguration();

    // Initialize the express app
    app = await require('../../index').initializeApp();

    // Log into the app
    passportCookie = await login.loginAnonymous(app);
  });

  // Create one test suite for each collection bundle
  for (const filename of collectionBundleFilenames) {
    describe(`Test suite for the ${filename} collection bundle`, function () {
      let collectionBundle;

      before(async function () {
        const filePath = testFilePath + '/' + filename;
        collectionBundle = await readJson(filePath);
      });

      it(`POST /api/collection-bundles previews the import of the ${filename} collection bundle (checkOnly)`, async function () {
        this.timeout(30000);
        const body = collectionBundle;
        const res = await request(app)
          .post('/api/collection-bundles?checkOnly=true')
          .send(body)
          .set('Accept', 'application/json')
          .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
          .expect(201)
          .expect('Content-Type', /json/);

        // We expect to get the created collection object
        const collection = res.body;
        expect(collection).toBeDefined();

        // MITRE marking definition is missing from x_mitre_contents in the bundle
        expect(collection.workspace.import_categories.errors.length).toBe(1);
      });

      it(`POST /api/collection-bundles previews the import of the ${filename} collection bundle (previewOnly)`, async function () {
        this.timeout(30000);
        const body = collectionBundle;
        const res = await request(app)
          .post('/api/collection-bundles?previewOnly=true')
          .send(body)
          .set('Accept', 'application/json')
          .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
          .expect(201)
          .expect('Content-Type', /json/);

        // We expect to get the created collection object
        const collection = res.body;
        expect(collection).toBeDefined();

        // MITRE marking definition is missing from x_mitre_contents in the bundle
        expect(collection.workspace.import_categories.errors.length).toBe(1);
      });

      it(`POST /api/collection-bundles imports the ${filename} collection bundle`, async function () {
        this.timeout(60000);
        const body = collectionBundle;
        const res = await request(app)
          .post('/api/collection-bundles')
          .send(body)
          .set('Accept', 'application/json')
          .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
          .expect(201)
          .expect('Content-Type', /json/);

        // We expect to get the created collection object
        const collection = res.body;
        expect(collection).toBeDefined();

        // MITRE marking definition is missing from x_mitre_contents in the bundle
        expect(collection.workspace.import_categories.errors.length).toBe(1);
      });

      const domain = 'enterprise-attack';
      it('GET /api/stix-bundles exports the STIX bundle', async function () {
        const res = await request(app)
          .get(`/api/stix-bundles?domain=${domain}`)
          .set('Accept', 'application/json')
          .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
          .expect(200)
          .expect('Content-Type', /json/);

        // We expect to get the exported stix bundle
        const stixBundle = res.body;
        expect(stixBundle).toBeDefined();
        expect(Array.isArray(stixBundle.objects)).toBe(true);

        // We expect to get at most one of any object
        const objectMap = new Map();
        for (const stixObject of stixBundle.objects) {
          expect(objectMap.get(stixObject.id)).toBeUndefined();
          objectMap.set(stixObject.id, stixObject.id);
        }
      });
    });
  }

  after(async function () {
    await database.closeConnection();
  });
});
