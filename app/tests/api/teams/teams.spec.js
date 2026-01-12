const request = require('supertest');
const { expect } = require('expect');

const config = require('../../../config/config');
const logger = require('../../../lib/logger');
logger.level = 'debug';

const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const UserAccount = require('../../../models/user-account-model');
const Team = require('../../../models/team-model');

const login = require('../../shared/login');

// need an example user to add to the team
const exampleUser = {
  id: '1',
  email: 'user1@test.com',
  username: 'user1@test.com',
  displayName: 'User 1',
  status: 'active',
  role: 'visitor',
  modified: new Date(),
  created: new Date(),
};

// teamsId property will be created by REST API
const initialObjectData = {
  name: 'teamName',
  description: 'teamDescription',
  userIDs: [exampleUser.id],
};

describe('Teams API', function () {
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

    // Add an example user
    const user1 = new UserAccount(exampleUser);
    await user1.save();

    // Disable ADM validation for tests
    config.validateRequests.withAttackDataModel = false;
    config.validateRequests.withOpenApi = true;

    // Initialize the express app
    app = await require('../../../index').initializeApp();

    // Log into the app
    passportCookie = await login.loginAnonymous(app);
  });

  it('POST /api/teams does not create an empty team', async function () {
    const body = {};
    await request(app)
      .post('/api/teams')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(400);
  });

  let team1;
  it('POST /api/teams creates a team', async function () {
    const body = initialObjectData;
    const res = await request(app)
      .post('/api/teams')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created team
    team1 = res.body;
    expect(team1).toBeDefined();
    expect(team1.id).toBeDefined();
  });

  it('GET /api/teams returns the added team', async function () {
    const res = await request(app)
      .get('/api/teams')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the added team
    const teams = res.body;
    expect(teams).toBeDefined();
    expect(Array.isArray(teams)).toBe(true);
    expect(teams.length).toBe(1);
  });

  it('GET /api/teams/:id should not return a team when the id cannot be found', async function () {
    await request(app)
      .get('/api/teams/not-an-id')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(404);
  });

  it('GET /api/teams/:id returns the added team', async function () {
    const res = await request(app)
      .get('/api/teams/' + team1.id)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one team in an array
    const team = res.body;
    expect(team).toBeDefined();
    expect(team.id).toBe(team1.id);
    expect(team.name).toBe(team1.name);
    expect(team.description).toBe(team1.description);
    expect(team.userIDs.length).toBe(team1.userIDs.length);
    expect(team.userIDs[0]).toBe(team1.userIDs[0]);

    // The created and modified timestamps should match
    expect(team.created).toBeDefined();
    expect(team.modified).toBeDefined();
    expect(team.created).toEqual(team.modified);
  });

  it('PUT /api/teams updates a team', async function () {
    const body = team1;
    body.description = 'updated';
    const res = await request(app)
      .put('/api/teams/' + team1.id)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the updated team
    const team = res.body;
    expect(team).toBeDefined();
    expect(team.id).toBe(team1.id);

    // The modified timestamp should be different from the created timestamp
    expect(team.created).toBeDefined();
    expect(team.modified).toBeDefined();
    expect(team.created).not.toEqual(team.modified);
  });

  it('GET /api/teams uses the search parameter to return the team', async function () {
    const res = await request(app)
      .get('/api/teams?search=team')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one team in an array
    const teams = res.body;
    expect(teams).toBeDefined();
    expect(Array.isArray(teams)).toBe(true);
    expect(teams.length).toBe(1);
  });

  it('POST /api/teams does not create a team with a duplicate name', async function () {
    const body = initialObjectData;
    await request(app)
      .post('/api/teams')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(409);
  });

  it('GET /api/teams/:id/users returns a list of users', async function () {
    const body = initialObjectData;
    const res = await request(app)
      .get(`/api/teams/${team1.id}/users`)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one team in an array
    const users = res.body;
    expect(users).toBeDefined();
    expect(Array.isArray(users)).toBe(true);
    expect(users.length).toBe(1);
    expect(users[0].id).toBe(exampleUser.id);
  });

  it('DELETE /api/teams deletes a teams', async function () {
    await request(app)
      .delete('/api/teams/' + team1.id)
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(204);
  });

  after(async function () {
    await database.closeConnection();
  });
});
