const request = require('supertest');
const { expect } = require('expect');

const database = require('../../lib/database-in-memory');
const databaseConfiguration = require('../../lib/database-configuration');
const login = require('../shared/login');

const logger = require('../../lib/logger');
logger.level = 'debug';

describe('Anonymous User Authentication', function () {
  let app;
  let passportCookie;

  before(async function () {
    // Configure the test to use anonymous authentication
    process.env.AUTHN_MECHANISM = 'anonymous';

    // Establish the database connection
    // Use an in-memory database that we spin up for the test
    await database.initializeConnection();

    // Check for a valid database configuration
    await databaseConfiguration.checkSystemConfiguration();

    // Initialize the express app
    app = await require('../../index').initializeApp();
  });

  it('GET /api/session returns not authorized (before logging in)', async function () {
    await request(app).get('/api/session').set('Accept', 'application/json').expect(401);
  });

  it('GET /api/authn/anonymous/login successfully logs the user in', async function () {
    // Use the shared login helper
    passportCookie = await login.loginAnonymous(app);
    expect(passportCookie).toBeDefined();
  });

  it('GET /api/session returns the user session', async function () {
    const response = await request(app)
      .get('/api/session')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200);

    // We expect to get the current session
    const session = response.body;
    expect(session).toBeDefined();
  });

  it('GET /api/authn/anonymous/logout successfully logs the user out', async function () {
    await request(app)
      .get('/api/authn/anonymous/logout')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200);
  });

  it('GET /api/session returns not authorized (after logging out)', async function () {
    await request(app)
      .get('/api/session')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(401);
  });

  it('GET /api/authn/oidc/login cannot log in using incorrect authentication mechanism', async function () {
    const encodedDestination = encodeURIComponent('http://localhost/startPage');
    await request(app)
      .get(`/api/authn/oidc/login?destination=${encodedDestination}`)
      .set('Accept', 'application/json')
      .expect(404);
  });

  it('GET /api/authn/oidc/logout cannot log out using incorrect authentication mechanism', async function () {
    await request(app).get('/api/authn/oidc/logout').set('Accept', 'application/json').expect(404);
  });

  after(async function () {
    await database.closeConnection();
  });
});
