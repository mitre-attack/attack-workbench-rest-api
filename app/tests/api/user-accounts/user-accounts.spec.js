const request = require('supertest');
const { expect } = require('expect');

const config = require('../../../config/config');
const logger = require('../../../lib/logger');
logger.level = 'debug';

const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const UserAccount = require('../../../models/user-account-model');
const Team = require('../../../models/team-model');
const teamsService = require('../../../services/system/teams-service');

const login = require('../../shared/login');

// userId property will be created by REST API
const initialObjectData = {
  email: 'user@org.com',
  username: 'user@org.com',
  displayName: 'UserFirst UserLast',
  status: 'active',
  role: 'editor',
};

describe('User Accounts API', function () {
  let app;
  let passportCookie;

  before(async function () {
    // Establish the database connection
    // Use an in-memory database that we spin up for the test
    await database.initializeConnection();

    // Check for a valid database configuration
    await databaseConfiguration.checkSystemConfiguration();

    // Wait until the indexes are created
    await UserAccount.init();
    await Team.init();

    // Disable validation for tests
    config.validateRequests.withAttackDataModel = false;
    config.validateRequests.withOpenApi = true;

    // Initialize the express app
    app = await require('../../../index').initializeApp();

    // Log into the app
    passportCookie = await login.loginAnonymous(app);
  });

  it('GET /api/user-accounts returns an array with the anonymous user account', async function () {
    const res = await request(app)
      .get('/api/user-accounts')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an array with one entry (the anonymous user account)
    const userAccounts = res.body;
    expect(userAccounts).toBeDefined();
    expect(Array.isArray(userAccounts)).toBe(true);
    expect(userAccounts.length).toBe(1);
  });

  it('POST /api/user-accounts does not create an empty user account', async function () {
    const body = {};
    await request(app)
      .post('/api/user-accounts')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(400);
  });

  let userAccount1;
  it('POST /api/user-accounts creates a user account', async function () {
    const body = initialObjectData;
    const res = await request(app)
      .post('/api/user-accounts')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created user account
    userAccount1 = res.body;
    expect(userAccount1).toBeDefined();
    expect(userAccount1.id).toBeDefined();
  });

  it('GET /api/user-accounts returns the added user account', async function () {
    const res = await request(app)
      .get('/api/user-accounts')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the added user account and the anonymous user account
    const userAccounts = res.body;
    expect(userAccounts).toBeDefined();
    expect(Array.isArray(userAccounts)).toBe(true);
    expect(userAccounts.length).toBe(2);
  });

  it('GET /api/user-accounts/:id should not return a user account when the id cannot be found', async function () {
    await request(app)
      .get('/api/user-accounts/not-an-id')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(404);
  });

  it('GET /api/user-accounts/:id returns the added user account', async function () {
    const res = await request(app)
      .get('/api/user-accounts/' + userAccount1.id)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one user account in an array
    const userAccount = res.body;
    expect(userAccount).toBeDefined();
    expect(userAccount.id).toBe(userAccount1.id);
    expect(userAccount.email).toBe(userAccount1.email);
    expect(userAccount.username).toBe(userAccount1.username);
    expect(userAccount.displayName).toBe(userAccount1.displayName);
    expect(userAccount.status).toBe(userAccount1.status);
    expect(userAccount.role).toBe(userAccount1.role);

    // The created and modified timestamps should match
    expect(userAccount.created).toBeDefined();
    expect(userAccount.modified).toBeDefined();
    expect(userAccount.created).toEqual(userAccount.modified);
  });

  it('GET /api/user-accounts/:id returns the added user account with a derived STIX Identity object', async function () {
    const res = await request(app)
      .get('/api/user-accounts/' + userAccount1.id + '?includeStixIdentity=true')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one user account in an array
    const userAccount = res.body;
    expect(userAccount).toBeDefined();
    expect(userAccount.id).toBe(userAccount1.id);
    expect(userAccount.email).toBe(userAccount1.email);
    expect(userAccount.username).toBe(userAccount1.username);
    expect(userAccount.displayName).toBe(userAccount1.displayName);
    expect(userAccount.status).toBe(userAccount1.status);
    expect(userAccount.role).toBe(userAccount1.role);

    // The created and modified timestamps should match
    expect(userAccount.created).toBeDefined();
    expect(userAccount.modified).toBeDefined();
    expect(userAccount.created).toEqual(userAccount.modified);

    // The added STIX identity should have the correct data
    const identity = userAccount.identity;
    expect(identity).toBeDefined();
    expect(identity.id).toBe(userAccount1.id);
    expect(identity.type).toBe('identity');
    expect(identity.created).toBe(userAccount1.created);
    expect(identity.modified).toBe(userAccount1.modified);
    expect(identity.identity_class).toBe('individual');
  });

  it('PUT /api/user-accounts updates a user account', async function () {
    const body = userAccount1;
    body.role = 'admin';
    const res = await request(app)
      .put('/api/user-accounts/' + userAccount1.id)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the updated user account
    const userAccount = res.body;
    expect(userAccount).toBeDefined();
    expect(userAccount.identity).toBe(userAccount1.identity);

    // The modified timestamp should be different from the created timestamp
    expect(userAccount.created).toBeDefined();
    expect(userAccount.modified).toBeDefined();
    expect(userAccount.role).toBe('admin');
    expect(userAccount.created).not.toEqual(userAccount.modified);
  });

  it('GET /api/user-accounts uses the search parameter to return the user account', async function () {
    const res = await request(app)
      .get('/api/user-accounts?search=first')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one user account in an array
    const userAccounts = res.body;
    expect(userAccounts).toBeDefined();
    expect(Array.isArray(userAccounts)).toBe(true);
    expect(userAccounts.length).toBe(1);
  });

  it('POST /api/user-accounts does not create a user account with a duplicate email', async function () {
    const body = initialObjectData;
    await request(app)
      .post('/api/user-accounts')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(409);
  });

  it('DELETE /api/user-accounts deletes a user account', async function () {
    await request(app)
      .delete('/api/user-accounts/' + userAccount1.id)
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(204);
  });

  let anonymousUserId = null;
  it('GET /api/user-accounts returns an array with the anonymous user account', async function () {
    const res = await request(app)
      .get('/api/user-accounts')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an empty array
    const userAccount = res.body;
    expect(userAccount).toBeDefined();
    expect(Array.isArray(userAccount)).toBe(true);
    expect(userAccount.length).toBe(1);
    anonymousUserId = userAccount[0].id;
  });

  it('GET /api/user-accounts/{id}/teams should return an empty array when no teams have been associated with a user', async function () {
    const res = await request(app)
      .get(`/api/user-accounts/${anonymousUserId}/teams`)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const teams = res.body;
    expect(teams).toBeDefined();
    expect(Array.isArray(teams)).toBe(true);
    expect(teams.length).toBe(0);
  });

  it('GET /api/user-accounts/{id}/teams should return an array with the list of teams a user is associated with', async function () {
    // Add a new team to the database with the anonymous user as a member
    const timestamp = new Date().toISOString();
    const teamData = {
      userIDs: [anonymousUserId],
      name: 'Example Team',
      created: timestamp,
      modified: timestamp,
    };
    await teamsService.create(teamData);

    const res = await request(app)
      .get(`/api/user-accounts/${anonymousUserId}/teams`)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const teams = res.body;
    expect(teams).toBeDefined();
    expect(Array.isArray(teams)).toBe(true);
    expect(teams.length).toBe(1);
    expect(teams[0].name).toBe(teamData.name);
    expect(teams[0].userIDs.length).toBe(1);
    expect(teams[0].userIDs[0]).toBe(anonymousUserId);
  });

  after(async function () {
    await database.closeConnection();
  });
});
