const request = require('supertest');
const crypto = require('crypto');

const logger = require('../../lib/logger');
logger.level = 'debug';

const database = require('../../lib/database-in-memory');
const databaseConfiguration = require('../../lib/database-configuration');

const login = require('../shared/login');

const parameterFuzzLimit1 = 100;
const parameterFuzzLimit2 = 100;
const propertyFuzzLimit = 100;
const objectFuzzLimit = 100;

function fuzzString(maxByteLength) {
  const stringBase = 'ascii';
  const byteLength = crypto.randomInt(0, maxByteLength + 1);
  const buffer = crypto.randomBytes(byteLength);
  return buffer.toString(stringBase);
}

function escapeUnprintable(unsafe) {
  const box = String.fromCharCode(9618);
  // eslint-disable-next-line no-control-regex
  const charsRegex = /[\u0000-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u00FF]/g;
  return unsafe.replace(charsRegex, () => box);
}

describe('User Accounts API Test Invalid Data', function () {
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

  // Data Fuzzing I
  for (let i = 0; i < parameterFuzzLimit1; i++) {
    const userAccountData = {
      email: fuzzString(600),
      username: fuzzString(600),
      displayName: fuzzString(600),
      status: fuzzString(600),
      role: fuzzString(600),
    };

    it(`POST /api/user-accounts does not create a user account with invalid data (${escapeUnprintable(userAccountData.username)})`, async function () {
      const body = userAccountData;
      await request(app)
        .post('/api/user-accounts')
        .send(body)
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(400);
    });
  }

  // Data Fuzzing II
  for (let i = 0; i < parameterFuzzLimit2; i++) {
    const userAccountData = {
      email: fuzzString(600),
      username: fuzzString(600),
      displayName: fuzzString(600),
      status: 'active',
      role: 'admin',
    };

    it(`POST /api/user-accounts does create a user account with fuzzed data (${escapeUnprintable(userAccountData.username)})`, async function () {
      const body = userAccountData;
      await request(app)
        .post('/api/user-accounts')
        .send(body)
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(201);
    });
  }

  // Property Fuzzing
  for (let i = 0; i < propertyFuzzLimit; i++) {
    const parameterName = fuzzString(60);
    const userAccountData = {
      email: fuzzString(60),
      username: fuzzString(60),
      displayName: fuzzString(60),
      status: fuzzString(60),
      role: fuzzString(60),
      [parameterName]: fuzzString(60),
    };

    it(`POST /api/user-accounts does not create a user account with invalid property (${escapeUnprintable(parameterName)})`, async function () {
      const body = userAccountData;
      await request(app)
        .post('/api/user-accounts')
        .send(body)
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(400);
    });
  }

  // Object Fuzzing
  for (let i = 0; i < objectFuzzLimit; i++) {
    const parameterName = fuzzString(60);
    const userAccountData = {
      email: fuzzString(60),
      username: {
        [parameterName]: fuzzString(60),
      },
      displayName: fuzzString(60),
      status: 'active',
      role: 'admin',
    };

    it(`POST /api/user-accounts does not create a user account with a non-string username (${escapeUnprintable(parameterName)})`, async function () {
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
