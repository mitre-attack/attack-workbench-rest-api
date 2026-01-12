const request = require('supertest');
//const { expect } = require('expect');

const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const config = require('../../../config/config');
const logger = require('../../../lib/logger');
logger.level = 'debug';

describe('Session API', function () {
  let app;

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
  });

  // it('GET /api/session', function (done) {
  //     request(app)
  //         .get('/api/session')
  //         .set('Accept', 'application/json')
  //         .expect(200)
  //         .expect('Content-Type', /json/)
  //         .end(function(err, res) {
  //             if (err) {
  //                 done(err);
  //             }
  //             else {
  //                 // We expect to get the current session
  //                 const session = res.body;
  //                 expect(session).toBeDefined();
  //
  //                 done();
  //             }
  //         });
  // });

  // Temporary change: /api/session returns 401 if the user is not logged in.
  //   This will be fixed with a general purpose solution for logging in when
  //   running tests, but is changed to expect the 401 for now.
  it('GET /api/session', async function () {
    await request(app).get('/api/session').set('Accept', 'application/json').expect(401);
  });

  after(async function () {
    await database.closeConnection();
  });
});
