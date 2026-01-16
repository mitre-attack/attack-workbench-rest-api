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
    name: 'asset-1',
    spec_version: '2.1',
    type: 'x-mitre-asset',
    description: 'This is an asset.',
    x_mitre_sectors: ['sector placeholder 1'],
    x_mitre_related_assets: [
      {
        name: 'related asset 1',
        related_asset_sectors: ['related asset sector placeholder 1'],
        description: 'This is a related asset',
      },
      {
        name: 'related asset 2',
        related_asset_sectors: ['related asset sector placeholder 2'],
        description: 'This is another related asset',
      },
    ],
    external_references: [{ source_name: 'source-1', external_id: 's1' }],
    object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
    created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
    x_mitre_version: '1.1',
  },
};

describe('Assets API', function () {
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

  it('GET /api/assets returns an empty array of assets', async function () {
    const res = await request(app)
      .get('/api/assets')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an empty array
    const assets = res.body;
    expect(assets).toBeDefined();
    expect(Array.isArray(assets)).toBe(true);
    expect(assets.length).toBe(0);
  });

  it('POST /api/assets does not create an empty asset', async function () {
    const body = {};
    await request(app)
      .post('/api/assets')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(400);
  });

  let asset1;
  it('POST /api/assets creates an asset', async function () {
    const timestamp = new Date().toISOString();
    initialObjectData.stix.created = timestamp;
    initialObjectData.stix.modified = timestamp;
    const body = initialObjectData;
    const res = await request(app)
      .post('/api/assets')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created asset
    asset1 = res.body;
    expect(asset1).toBeDefined();
    expect(asset1.stix).toBeDefined();
    expect(asset1.stix.id).toBeDefined();
    expect(asset1.stix.created).toBeDefined();
    expect(asset1.stix.modified).toBeDefined();
    expect(asset1.stix.x_mitre_attack_spec_version).toBe(config.app.attackSpecVersion);

    expect(asset1.stix.x_mitre_sectors).toBeDefined();
    expect(Array.isArray(asset1.stix.x_mitre_sectors)).toBe(true);
    expect(asset1.stix.x_mitre_sectors.length).toBe(1);

    expect(asset1.stix.x_mitre_related_assets).toBeDefined();
    expect(Array.isArray(asset1.stix.x_mitre_related_assets)).toBe(true);
    expect(asset1.stix.x_mitre_related_assets.length).toBe(2);
  });

  it('GET /api/assets returns the added asset', async function () {
    const res = await request(app)
      .get('/api/assets')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one asset in an array
    const assets = res.body;
    expect(assets).toBeDefined();
    expect(Array.isArray(assets)).toBe(true);
    expect(assets.length).toBe(1);
  });

  it('GET /api/assets/:id should not return an asset when the id cannot be found', async function () {
    await request(app)
      .get('/api/assets/not-an-id')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(404);
  });

  it('GET /api/assets/:id?versions=all should not return an asset when the id cannot be found', async function () {
    await request(app)
      .get('/api/assets/not-an-id?versions=all')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(404);
  });

  it('GET /api/assets/:id returns the added asset', async function () {
    const res = await request(app)
      .get('/api/assets/' + asset1.stix.id)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one asset in an array
    const assets = res.body;
    expect(assets).toBeDefined();
    expect(Array.isArray(assets)).toBe(true);
    expect(assets.length).toBe(1);

    const asset = assets[0];
    expect(asset).toBeDefined();
    expect(asset.stix).toBeDefined();
    expect(asset.stix.id).toBe(asset1.stix.id);
    expect(asset.stix.type).toBe(asset1.stix.type);
    expect(asset.stix.name).toBe(asset1.stix.name);
    expect(asset.stix.description).toBe(asset1.stix.description);
    expect(asset.stix.spec_version).toBe(asset1.stix.spec_version);
    expect(asset.stix.object_marking_refs).toEqual(
      expect.arrayContaining(asset1.stix.object_marking_refs),
    );
    expect(asset.stix.created_by_ref).toBe(asset1.stix.created_by_ref);
    expect(asset.stix.x_mitre_version).toBe(asset1.stix.x_mitre_version);
    expect(asset.stix.x_mitre_attack_spec_version).toBe(asset1.stix.x_mitre_attack_spec_version);

    expect(asset.stix.x_mitre_sectors).toBeDefined();
    expect(Array.isArray(asset.stix.x_mitre_sectors)).toBe(true);
    expect(asset.stix.x_mitre_sectors.length).toBe(1);

    expect(asset.stix.x_mitre_related_assets).toBeDefined();
    expect(Array.isArray(asset.stix.x_mitre_related_assets)).toBe(true);
    expect(asset.stix.x_mitre_related_assets.length).toBe(2);
  });

  it('PUT /api/assets updates an asset', async function () {
    const originalModified = asset1.stix.modified;
    const timestamp = new Date().toISOString();
    asset1.stix.modified = timestamp;
    asset1.stix.description = 'This is an updated asset.';
    const body = asset1;
    const res = await request(app)
      .put('/api/assets/' + asset1.stix.id + '/modified/' + originalModified)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the updated asset
    const asset = res.body;
    expect(asset).toBeDefined();
    expect(asset.stix.id).toBe(asset1.stix.id);
    expect(asset.stix.modified).toBe(asset1.stix.modified);
  });

  it('POST /api/assets does not create an asset with the same id and modified date', async function () {
    const body = cloneForCreate(asset1);
    // Keep the same modified date to trigger duplicate detection
    body.stix.modified = asset1.stix.modified;
    await request(app)
      .post('/api/assets')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(409);
  });

  let asset2;
  it('POST /api/assets should create a new version of an asset with a duplicate stix.id but different stix.modified date', async function () {
    asset2 = cloneForCreate(asset1);
    const timestamp = new Date().toISOString();
    asset2.stix.modified = timestamp;
    const body = asset2;
    const res = await request(app)
      .post('/api/assets')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created asset
    const asset = res.body;
    expect(asset).toBeDefined();
  });

  let asset3;
  it('POST /api/assets should create a new version of an asset with a duplicate stix.id but different stix.modified date', async function () {
    asset3 = cloneForCreate(asset1);
    const timestamp = new Date().toISOString();
    asset3.stix.modified = timestamp;
    const body = asset3;
    const res = await request(app)
      .post('/api/assets')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created asset
    const asset = res.body;
    expect(asset).toBeDefined();
  });

  it('GET /api/assets returns the latest added asset', async function () {
    const res = await request(app)
      .get('/api/assets/' + asset3.stix.id)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one asset in an array
    const assets = res.body;
    expect(assets).toBeDefined();
    expect(Array.isArray(assets)).toBe(true);
    expect(assets.length).toBe(1);
    const asset = assets[0];
    expect(asset.stix.id).toBe(asset3.stix.id);
    expect(asset.stix.modified).toBe(asset3.stix.modified);
  });

  it('GET /api/assets returns all added assets', async function () {
    const res = await request(app)
      .get('/api/assets/' + asset1.stix.id + '?versions=all')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get two assets in an array
    const assets = res.body;
    expect(assets).toBeDefined();
    expect(Array.isArray(assets)).toBe(true);
    expect(assets.length).toBe(3);
  });

  it('GET /api/assets/:id/modified/:modified returns the first added asset', async function () {
    const res = await request(app)
      .get('/api/assets/' + asset1.stix.id + '/modified/' + asset1.stix.modified)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one asset in an array
    const asset = res.body;
    expect(asset).toBeDefined();
    expect(asset.stix).toBeDefined();
    expect(asset.stix.id).toBe(asset1.stix.id);
    expect(asset.stix.modified).toBe(asset1.stix.modified);
  });

  it('GET /api/assets/:id/modified/:modified returns the second added asset', async function () {
    const res = await request(app)
      .get('/api/assets/' + asset2.stix.id + '/modified/' + asset2.stix.modified)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one asset in an array
    const asset = res.body;
    expect(asset).toBeDefined();
    expect(asset.stix).toBeDefined();
    expect(asset.stix.id).toBe(asset2.stix.id);
    expect(asset.stix.modified).toBe(asset2.stix.modified);
  });

  it('DELETE /api/assets/:id should not delete an asset when the id cannot be found', async function () {
    await request(app)
      .delete('/api/assets/not-an-id')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(404);
  });

  it('DELETE /api/assets/:id/modified/:modified deletes an asset', async function () {
    await request(app)
      .delete('/api/assets/' + asset1.stix.id + '/modified/' + asset1.stix.modified)
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(204);
  });

  it('DELETE /api/assets/:id should delete all the assets with the same stix id', async function () {
    await request(app)
      .delete('/api/assets/' + asset2.stix.id)
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(204);
  });

  it('GET /api/assets returns an empty array of assets', async function () {
    const res = await request(app)
      .get('/api/assets')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an empty array
    const assets = res.body;
    expect(assets).toBeDefined();
    expect(Array.isArray(assets)).toBe(true);
    expect(assets.length).toBe(0);
  });

  after(async function () {
    await database.closeConnection();
  });
});
