const request = require('supertest');
const { expect } = require('expect');

const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const config = require('../../../config/config');
const logger = require('../../../lib/logger');
logger.level = 'debug';

const amberStixId = 'marking-definition--f88d31f6-486f-44da-b317-01333bde0b82';

const markingDefinitionData = {
  workspace: {
    workflow: {
      state: 'work-in-progress',
    },
  },
  stix: {
    spec_version: '2.1',
    type: 'marking-definition',
    definition_type: 'statement',
    definition: { statement: 'This is a marking definition.' },
    created_by_ref: 'identity--6444f546-6900-4456-b3b1-015c88d70dab',
  },
};

describe('System Configuration API', function () {
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

  it('GET /api/config/system-version returns the system version info', async function () {
    const res = await request(app)
      .get('/api/config/system-version')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the system version info
    const systemVersionInfo = res.body;
    expect(systemVersionInfo).toBeDefined();
    expect(systemVersionInfo.version).toBeDefined();
    expect(systemVersionInfo.attackSpecVersion).toBeDefined();
  });

  it('GET /api/config/allowed-values returns the allowed values', async function () {
    const res = await request(app)
      .get('/api/config/allowed-values')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the list of allowed values
    const allowedValues = res.body;
    expect(allowedValues).toBeDefined();
    expect(Array.isArray(allowedValues)).toBe(true);

    const expectedObjectType = 'technique';
    const expectedPropertyName = 'x_mitre_platforms';
    const expectedDomainName = 'enterprise-attack';
    const expectedPropertyValue = 'Linux';

    // Test some content
    const techniqueAllowedValues = allowedValues.find(
      (item) => item.objectType === expectedObjectType,
    );
    expect(techniqueAllowedValues).toBeDefined();

    const propertyAllowedValues = techniqueAllowedValues.properties.find(
      (item) => item.propertyName === expectedPropertyName,
    );
    expect(propertyAllowedValues).toBeDefined();

    const domainAllowedValues = propertyAllowedValues.domains.find(
      (item) => item.domainName === expectedDomainName,
    );
    expect(domainAllowedValues).toBeDefined();
    expect(domainAllowedValues.allowedValues).toContain(expectedPropertyValue);
  });

  it('GET /api/config/organization-identity returns the organizaton identity', async function () {
    const res = await request(app)
      .get('/api/config/organization-identity')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the organization identity
    const identity = res.body;
    expect(identity).toBeDefined();
  });

  it('GET /api/config/authn returns the available authentication mechanisms', async function () {
    const res = await request(app)
      .get('/api/config/authn')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the list of authentication mechanisms
    const authnConfig = res.body;
    expect(authnConfig).toBeDefined();
    expect(authnConfig.mechanisms).toBeDefined();
    expect(Array.isArray(authnConfig.mechanisms)).toBe(true);
  });

  let amberTlpMarkingDefinition;
  it('GET /api/marking-definitions returns the static TLP marking definitions', async function () {
    const res = await request(app)
      .get('/api/marking-definitions')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the pre-defined TLP marking definitions
    const markingDefinitions = res.body;
    expect(markingDefinitions).toBeDefined();
    expect(Array.isArray(markingDefinitions)).toBe(true);
    expect(markingDefinitions.length).toBe(4);

    amberTlpMarkingDefinition = markingDefinitions.find((x) => x.stix.id === amberStixId);
    expect(amberTlpMarkingDefinition).toBeDefined();
  });

  it('PUT /api/marking-definitions fails to update a static marking definition', async function () {
    amberTlpMarkingDefinition.stix.description = 'This is an updated marking definition.';
    const body = amberTlpMarkingDefinition;
    await request(app)
      .put('/api/marking-definitions/' + amberTlpMarkingDefinition.stix.id)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(400);
  });

  it('GET /api/config/default-marking-definitions returns an empty array since no default has been set', async function () {
    const res = await request(app)
      .get('/api/config/default-marking-definitions')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an empty array
    const defaultMarkingDefinitions = res.body;
    expect(defaultMarkingDefinitions).toBeDefined();
    expect(Array.isArray(defaultMarkingDefinitions)).toBe(true);
    expect(defaultMarkingDefinitions.length).toBe(0);
  });

  let markingDefinition;
  it('POST /api/marking-definitions creates a marking definition', async function () {
    const timestamp = new Date().toISOString();
    markingDefinitionData.stix.created = timestamp;
    const body = markingDefinitionData;
    const res = await request(app)
      .post('/api/marking-definitions')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created marking definition
    markingDefinition = res.body;
    expect(markingDefinition).toBeDefined();
  });

  it('POST /api/config/default-marking-definitions sets the default marking definitions', async function () {
    const body = [markingDefinition.stix.id];
    const res = await request(app)
      .post('/api/config/default-marking-definitions')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(204);

    // We expect the response body to be an empty object
    expect(res.body).toBeDefined();
    expect(Object.getOwnPropertyNames(res.body)).toHaveLength(0);
  });

  it('GET /api/config/default-marking-definitions returns an array containing the marking definition', async function () {
    const res = await request(app)
      .get('/api/config/default-marking-definitions')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an empty array
    const defaultMarkingDefinitions = res.body;
    expect(defaultMarkingDefinitions).toBeDefined();
    expect(Array.isArray(defaultMarkingDefinitions)).toBe(true);
    expect(defaultMarkingDefinitions.length).toBe(1);
    expect(defaultMarkingDefinitions[0].stix.id).toBe(markingDefinition.stix.id);
  });

  it('GET /api/config/default-marking-definitions returns an array containing the marking definition reference', async function () {
    const res = await request(app)
      .get('/api/config/default-marking-definitions?refOnly=true')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an empty array
    const defaultMarkingDefinitions = res.body;
    expect(defaultMarkingDefinitions).toBeDefined();
    expect(Array.isArray(defaultMarkingDefinitions)).toBe(true);
    expect(defaultMarkingDefinitions.length).toBe(1);
    expect(defaultMarkingDefinitions[0]).toBe(markingDefinition.stix.id);
  });

  it('GET /api/config/organization-namespace returns the default namespace', async function () {
    const res = await request(app)
      .get('/api/config/organization-namespace')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the default namespace
    const namespace = res.body;
    expect(namespace).toBeDefined();
    expect(namespace.range_start).toBeNull();
    expect(namespace.prefix).toBeNull();
  });

  const testNamespace = { range_start: 3000, prefix: 'TESTORG' };
  it('POST /api/config/organization-namespace sets the organization namespace', async function () {
    const body = testNamespace;
    const res = await request(app)
      .post('/api/config/organization-namespace')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(204);

    // We expect the response body to be an empty object
    expect(res.body).toBeDefined();
    expect(Object.getOwnPropertyNames(res.body)).toHaveLength(0);
  });

  it('GET /api/config/organization-namespace returns the updated namespace', async function () {
    const res = await request(app)
      .get('/api/config/organization-namespace')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the default namespace
    const namespace = res.body;
    expect(namespace).toBeDefined();
    expect(namespace.range_start).toBe(testNamespace.range_start);
    expect(namespace.prefix).toBe(testNamespace.prefix);
  });

  after(async function () {
    await database.closeConnection();
  });
});
