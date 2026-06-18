const request = require('supertest');

const config = require('../../../config/config');
const logger = require('../../../lib/logger');
logger.level = 'debug';

const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');

const login = require('../../shared/login');

// Invalid user account payloads — each violates a required-field, enum, type, or
// business rule. Used to assert the API rejects malformed input with a 400.
const userAccounts = [
  { email: 'user1@test.com', username: 'user missing status and role' },
  { email: 'user1@test.com', displayName: 'user missing username', status: 'pending' },
  { email: 'user2@test.com', username: 'user invalid status', status: 'abcde', role: 'editor' },
  { email: 'user3@test.com', username: 'user invalid role', status: 'active', role: 'xyzzy' },
  {
    email: 'user4@test.com',
    username: 'user inactive cannot have role',
    status: 'inactive',
    role: 'admin',
  },
  { email: 5, username: 'user has number for email', status: 'active', role: 'editor' },
  { email: 'user6@test.com', username: 6, status: 'active', role: 'editor' },
  { email: 'user7@test.com', username: 'user has number for status', status: 7, role: 'editor' },
  { email: 'user8@test.com', username: 'user has number for role', status: 'active', role: 8 },
];

describe('User Accounts API Test Invalid Data', function () {
  let app;
  let passportCookie;

  before(async function () {
    // Establish the database connection
    // Use an in-memory database that we spin up for the test
    await database.initializeConnection();

    // Check for a valid database configuration
    await databaseConfiguration.checkSystemConfiguration();

    // Disable ADM validation for tests
    config.validateRequests.withAttackDataModel = false;
    config.validateRequests.withOpenApi = true;

    // Initialize the express app
    app = await require('../../../index').initializeApp();

    // Log into the app
    passportCookie = await login.loginAnonymous(app);
  });

  for (const userAccountData of userAccounts) {
    it(`POST /api/user-accounts does not create a user account with invalid data (${userAccountData.username})`, async function () {
      const body = userAccountData;
      await request(app)
        .post('/api/user-accounts')
        .send(body)
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(400);
    });
  }

  after(async function () {
    await database.closeConnection();
  });
});
