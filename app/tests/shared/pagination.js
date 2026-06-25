const request = require('supertest');
const { expect } = require('expect');
const _ = require('lodash');

const config = require('../../config/config');
const logger = require('../../lib/logger');
logger.level = 'debug';

const database = require('../../lib/database-in-memory');
const databaseConfiguration = require('../../lib/database-configuration');

const login = require('./login');

function PaginationTests(service, initialObjectAData, options) {
  this.service = service;
  this.initialObjectData = initialObjectAData;

  this.options = {
    numberOfObjects: 45,
    prefix: options.prefix ?? 'test-object',
    baseUrl: options.baseUrl,
    label: options.label ?? 'TestObjects',
    // Optional: pin ADM request validation for this suite. Left undefined, the
    // suite inherits whatever the shared config singleton currently holds.
    validateWithAdm: options.validateWithAdm,
  };

  this.options.stateQuery = options.state ? `&state=${options.state}` : '';
}
module.exports = PaginationTests;

PaginationTests.prototype.loadObjects = async function () {
  // Initialize the data
  for (let i = 0; i < this.options.numberOfObjects; i++) {
    const data = _.cloneDeep(this.initialObjectData);
    data.stix.name = `${this.options.prefix}-${i}`;

    const timestamp = new Date();
    data.stix.created = timestamp.toISOString();
    data.stix.modified = timestamp.toISOString();

    try {
      await this.service.create(data, { import: false });
    } catch (err) {
      console.log(err);
    }
  }
};

PaginationTests.prototype.executeTests = function () {
  const self = this;

  describe(`${this.options.label} Pagination API`, function () {
    let app;
    let passportCookie;

    before(async function () {
      // Pin ADM validation state (when the caller specified one) so the suite
      // does not depend on whichever spec ran last leaving the shared config
      // singleton in a particular state.
      if (self.options.validateWithAdm !== undefined) {
        config.validateRequests.withAttackDataModel = self.options.validateWithAdm;
      }

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

    it(`GET ${self.options.baseUrl} return an empty page`, async function () {
      const res = await request(app)
        .get(`${self.options.baseUrl}?offset=0&limit=10${self.options.stateQuery}`)
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(200)
        .expect('Content-Type', /json/);

      // We expect to get an array with zero test objects
      const testObjects = res.body;
      expect(testObjects).toBeDefined();
      expect(Array.isArray(testObjects)).toBe(true);
      expect(testObjects.length).toBe(0);
    });

    it(`GET ${self.options.baseUrl} return an empty page with offset`, async function () {
      const res = await request(app)
        .get(`${self.options.baseUrl}?offset=10&limit=10${self.options.stateQuery}`)
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(200)
        .expect('Content-Type', /json/);

      // We expect to get an array with zero test objects
      const testObjects = res.body;
      expect(testObjects).toBeDefined();
      expect(Array.isArray(testObjects)).toBe(true);
      expect(testObjects.length).toBe(0);
    });

    it(`GET ${self.options.baseUrl} return an empty page with pagination data`, async function () {
      const res = await request(app)
        .get(
          `${self.options.baseUrl}?offset=0&limit=10&includePagination=true${self.options.stateQuery}`,
        )
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(200)
        .expect('Content-Type', /json/);

      // We expect to get an array with zero test objects
      const testObjects = res.body.data;
      expect(testObjects).toBeDefined();
      expect(Array.isArray(testObjects)).toBe(true);
      expect(testObjects.length).toBe(0);

      // We expect pagination data to be included
      const pagination = res.body.pagination;
      expect(pagination).toBeDefined();
      expect(pagination.total).toBe(0);
      expect(pagination.limit).toBe(10);
      expect(pagination.offset).toBe(0);
    });

    it(`GET ${self.options.baseUrl} return an empty page with offset with pagination data`, async function () {
      const res = await request(app)
        .get(
          `${self.options.baseUrl}?offset=10&limit=10&includePagination=true${self.options.stateQuery}`,
        )
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(200)
        .expect('Content-Type', /json/);

      // We expect to get an array with zero test objects
      const testObjects = res.body.data;
      expect(testObjects).toBeDefined();
      expect(Array.isArray(testObjects)).toBe(true);
      expect(testObjects.length).toBe(0);

      // We expect pagination data to be included
      const pagination = res.body.pagination;
      expect(pagination).toBeDefined();
      expect(pagination.total).toBe(0);
      expect(pagination.limit).toBe(10);
      expect(pagination.offset).toBe(10);
    });

    it(`GET ${self.options.baseUrl} returns the array of preloaded objects`, async function () {
      await self.loadObjects();
      const res = await request(app)
        .get(`${self.options.baseUrl}?offset=0${self.options.stateQuery}`)
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(200)
        .expect('Content-Type', /json/)
        .send();

      // We expect to get all the test objects
      const testObjects = res.body;
      expect(testObjects).toBeDefined();
      expect(Array.isArray(testObjects)).toBe(true);
      expect(testObjects.length).toBe(self.options.numberOfObjects);
    });

    const pageSizeList = [5, 10, 20];
    const offset = 10;
    pageSizeList.forEach(function (pageSize) {
      it(`GET ${self.options.baseUrl} returns a page of preloaded objects`, async function () {
        const res = await request(app)
          .get(
            `${self.options.baseUrl}?offset=${offset}&limit=${pageSize}${self.options.stateQuery}`,
          )
          .set('Accept', 'application/json')
          .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
          .expect(200)
          .expect('Content-Type', /json/);

        // We expect to get an array with one page of test objects
        const testObjects = res.body;
        expect(testObjects).toBeDefined();
        expect(Array.isArray(testObjects)).toBe(true);
        expect(testObjects.length).toBe(pageSize);
      });

      it(`GET ${self.options.baseUrl} returns a page of preloaded objects with pagination data`, async function () {
        const res = await request(app)
          .get(
            `${self.options.baseUrl}?offset=${offset}&limit=${pageSize}&includePagination=true${self.options.stateQuery}`,
          )
          .set('Accept', 'application/json')
          .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
          .expect(200)
          .expect('Content-Type', /json/);

        // We expect to get an array with one page of test objects
        const testObjects = res.body.data;
        expect(testObjects).toBeDefined();
        expect(Array.isArray(testObjects)).toBe(true);
        expect(testObjects.length).toBe(pageSize);

        // We expect pagination data to be included
        const pagination = res.body.pagination;
        expect(pagination).toBeDefined();
        expect(pagination.total).toBe(self.options.numberOfObjects);
        expect(pagination.limit).toBe(pageSize);
        expect(pagination.offset).toBe(offset);
      });
    });

    it(`GET ${self.options.baseUrl} return a partial page of preloaded objects`, async function () {
      const res = await request(app)
        .get(`${self.options.baseUrl}?offset=40&limit=20${self.options.stateQuery}`)
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(200)
        .expect('Content-Type', /json/);

      // We expect to get an array with one page of test objects
      const testObjects = res.body;
      expect(testObjects).toBeDefined();
      expect(Array.isArray(testObjects)).toBe(true);
      expect(testObjects.length).toBe(5);
    });

    it(`GET ${self.options.baseUrl} return a partial page of preloaded objects with pagination data`, async function () {
      const res = await request(app)
        .get(
          `${self.options.baseUrl}?offset=40&limit=20&includePagination=true${self.options.stateQuery}`,
        )
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(200)
        .expect('Content-Type', /json/);

      // We expect to get an array with one page of test objects
      const testObjects = res.body.data;
      expect(testObjects).toBeDefined();
      expect(Array.isArray(testObjects)).toBe(true);
      expect(testObjects.length).toBe(5);

      // We expect pagination data to be included
      const pagination = res.body.pagination;
      expect(pagination).toBeDefined();
      expect(pagination.total).toBe(45);
      expect(pagination.limit).toBe(20);
      expect(pagination.offset).toBe(40);
    });

    after(async function () {
      await database.closeConnection();
    });
  });
};
