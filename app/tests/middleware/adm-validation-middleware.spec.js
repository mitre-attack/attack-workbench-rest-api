const request = require('supertest');
const { expect } = require('expect');

const database = require('../../lib/database-in-memory');
const databaseConfiguration = require('../../lib/database-configuration');
const config = require('../../config/config');
const login = require('../shared/login');

const logger = require('../../lib/logger');
logger.level = 'debug';

const uuid = require('uuid');
const { createSyntheticStixObject } = require('@mitre-attack/attack-data-model/dist/generator');
const { cloneForCreate } = require('../shared/clone-for-create');

/**
 * Smoke tests for ATT&CK Data Model (ADM) validation middleware.
 *
 * These tests verify that the ADM validation middleware correctly validates
 * POST and PUT requests using the Zod-based schemas from the ADM library.
 *
 * Test Coverage:
 * - POST operations with work-in-progress workflow state (partial validation)
 * - POST operations with reviewed workflow state (full validation)
 * - PUT operations with work-in-progress workflow state (partial validation)
 * - PUT operations with reviewed workflow state (full validation)
 * - True positives: valid data should pass
 * - True negatives: invalid data should fail with proper errors
 * - Validation toggle (enabled/disabled)
 *
 * NOTE: Tests focus on techniques initially. Once validated, can be generalized to other types.
 */

describe('ADM Validation Middleware', function () {
  let app;
  let passportCookie;

  const endpoint = '/api/techniques';
  const stixType = 'attack-pattern';

  /**
   * Helper function to create a synthetic STIX object with unique ID and timestamps.
   *
   * Uses the ADM's createSyntheticStixObject() to generate a valid baseline object,
   * then customizes it for testing purposes (unique IDs, fresh timestamps, etc.).
   *
   * NOTE: This function also includes special handling for x_mitre_platforms and
   * x_mitre_contributors to work around a Mongoose serialization issue. See the
   * inline comments below for detailed explanation.
   */
  function createSyntheticStix(type) {
    const syntheticStix = createSyntheticStixObject(type);
    if (!syntheticStix) {
      throw new Error(`Failed to create synthetic STIX object for type: ${type}`);
    }

    // Remove server-managed field
    delete syntheticStix.x_mitre_attack_spec_version;

    // Generate unique ID to avoid conflicts between tests
    syntheticStix.id = `${type}--${uuid.v4()}`;

    // Set fresh timestamps for each test to avoid conflicts
    const timestamp = new Date().toISOString();
    syntheticStix.created = timestamp;
    syntheticStix.modified = timestamp;

    // =============================================================================
    // SPECIAL HANDLING FOR x_mitre_platforms AND x_mitre_contributors
    // =============================================================================
    //
    // The synthetic generator (createSyntheticStixObject) does NOT populate these
    // two fields, which causes a problem due to how Mongoose serializes documents.
    //
    // THE ROOT CAUSE (Mongoose Schema Behavior):
    // -------------------------------------------
    // In app/models/subschemas/attack-pattern.js, these fields are defined as:
    //   x_mitre_platforms: [String]
    //   x_mitre_contributors: [String]
    //
    // When a field is defined this way in Mongoose (without `default: undefined`),
    // Mongoose will:
    // 1. Initialize the field as an empty array [] when the document is created
    //    (even if not provided in the request)
    // 2. Serialize the field as an empty array [] when returning the document
    //
    // This causes a problem in our tests:
    // - POST request WITHOUT these fields → Mongoose stores them as []
    // - POST response → Server returns { x_mitre_platforms: [], x_mitre_contributors: [] }
    // - PUT request spreads the response → Sends empty arrays back to server
    // - ADM validation FAILS because the schemas require:
    //     x_mitre_platforms: z.array(...).min(1, 'At least one platform is required').optional()
    //     x_mitre_contributors: z.array(...).nonempty().optional()
    // - Empty arrays [] violate the .min(1) and .nonempty() constraints
    //
    // ADM SCHEMA VALIDATION RULES (Conditionally Required Fields):
    // -------------------------------------------------------------
    // These fields are "conditionally required" - optional to include, but IF
    // included must meet constraints:
    // - If omitted entirely (key not present): ✓ VALID (field is optional)
    // - If present with empty array []:        ✗ INVALID (violates .min(1) / .nonempty())
    // - If present with valid items:           ✓ VALID
    //
    // WHY WE POPULATE THEM HERE:
    // --------------------------
    // By populating these fields with valid values BEFORE the initial POST request:
    // 1. POST request includes valid arrays: ['Windows'], ['Test Contributor']
    // 2. Mongoose stores them with valid data (not empty arrays)
    // 3. POST/GET responses return valid arrays
    // 4. PUT requests spread valid arrays (not empty ones)
    // 5. Validation passes throughout the entire POST → GET → PUT cycle
    //
    // FUTURE FIX (Recommended for separate PR):
    // ------------------------------------------
    // The proper architectural fix is to update all Mongoose schemas to use:
    //   x_mitre_platforms: { type: [String], default: undefined }
    //   x_mitre_contributors: { type: [String], default: undefined }
    //
    // This would prevent Mongoose from initializing/serializing these fields when
    // not provided, matching user expectations and avoiding unexpected behavior.
    //
    // NOTE: This issue affects other array fields in the schemas (external_references,
    // object_marking_refs, and various workspace fields) and should be addressed
    // comprehensively in a future PR to avoid scope creep.
    // =============================================================================

    if (!syntheticStix.x_mitre_platforms || syntheticStix.x_mitre_platforms.length === 0) {
      syntheticStix.x_mitre_platforms = ['Windows'];
    }
    if (!syntheticStix.x_mitre_contributors || syntheticStix.x_mitre_contributors.length === 0) {
      syntheticStix.x_mitre_contributors = ['Test Contributor'];
    }

    return syntheticStix;
  }

  before(async function () {
    // Enable ADM validation and disable OpenAPI validation
    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = false;

    // Establish the database connection
    await database.initializeConnection();

    // Check for a valid database configuration
    await databaseConfiguration.checkSystemConfiguration();

    // Initialize the express app
    app = await require('../../index').initializeApp();

    // Log into the app
    passportCookie = await login.loginAnonymous(app);
  });

  after(async function () {
    // Restore default config values
    config.validateRequests.withAttackDataModel = false;
    config.validateRequests.withOpenApi = true;
  });

  describe('POST operations - work-in-progress (partial validation)', function () {
    it('should accept valid complete data in work-in-progress state', async function () {
      const syntheticStix = createSyntheticStix(stixType);

      let requestBody = {
        type: 'attack-pattern',
        status: 'work-in-progress',
        workspace: {
          workflow: {
            state: 'work-in-progress',
          },
        },
        stix: syntheticStix,
      };

      requestBody = cloneForCreate(requestBody);

      const res = await request(app)
        .post(endpoint)
        .send(requestBody)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect('Content-Type', /json/);

      expect(res.status).toBe(201);
      expect(res.body).toBeDefined();
      expect(res.body.stix).toBeDefined();
      expect(res.body.stix.type).toBe(stixType);
    });

    it('should accept partial data in work-in-progress state (missing optional fields)', async function () {
      const syntheticStix = createSyntheticStix(stixType);

      // Remove optional fields to test partial validation
      delete syntheticStix.description;
      delete syntheticStix.x_mitre_platforms;
      delete syntheticStix.x_mitre_data_sources;

      let requestBody = {
        workspace: {
          workflow: {
            state: 'work-in-progress',
          },
        },
        stix: syntheticStix,
      };

      requestBody = cloneForCreate(requestBody);

      const res = await request(app)
        .post(endpoint)
        .send(requestBody)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect('Content-Type', /json/);

      // Should succeed because work-in-progress uses partial validation
      expect(res.status).toBe(201);
      expect(res.body.stix.type).toBe(stixType);
    });

    it('should reject data with invalid field values in work-in-progress state', async function () {
      const syntheticStix = createSyntheticStix(stixType);

      // Make a field invalid
      syntheticStix.x_mitre_is_subtechnique = 'not-a-boolean'; // Should be boolean

      const requestBody = {
        workspace: {
          workflow: {
            state: 'work-in-progress',
          },
        },
        stix: syntheticStix,
      };

      const res = await request(app)
        .post(endpoint)
        .send(requestBody)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect('Content-Type', /json/);

      // Should fail validation
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(res.body.details).toBeDefined();
      expect(Array.isArray(res.body.details)).toBe(true);
    });
  });

  describe('POST operations - reviewed (full validation)', function () {
    it('should accept valid complete data in reviewed state', async function () {
      const syntheticStix = createSyntheticStix(stixType);

      let requestBody = {
        workspace: {
          workflow: {
            state: 'reviewed',
          },
        },
        stix: syntheticStix,
      };

      requestBody = cloneForCreate(requestBody);

      const res = await request(app)
        .post(endpoint)
        .send(requestBody)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect('Content-Type', /json/);

      expect(res.status).toBe(201);
      expect(res.body).toBeDefined();
      expect(res.body.stix).toBeDefined();
      expect(res.body.stix.type).toBe(stixType);
    });

    it('should reject data missing required fields in reviewed state', async function () {
      const syntheticStix = createSyntheticStix(stixType);

      // Remove a required field
      delete syntheticStix.name;

      const requestBody = {
        workspace: {
          workflow: {
            state: 'reviewed',
          },
        },
        stix: syntheticStix,
      };

      const res = await request(app)
        .post(endpoint)
        .send(requestBody)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect('Content-Type', /json/);

      // Should fail validation because 'name' is required in full validation
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(res.body.details).toBeDefined();
      expect(Array.isArray(res.body.details)).toBe(true);
    });

    it('should reject data with invalid field values in reviewed state', async function () {
      const syntheticStix = createSyntheticStix(stixType);

      // Make a field invalid
      syntheticStix.type = 'invalid-type'; // Wrong type

      const requestBody = {
        workspace: {
          workflow: {
            state: 'reviewed',
          },
        },
        stix: syntheticStix,
      };

      const res = await request(app)
        .post(endpoint)
        .send(requestBody)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect('Content-Type', /json/);

      // Should fail validation
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(res.body.details).toBeDefined();
    });
  });

  describe('PUT operations - work-in-progress (partial validation)', function () {
    let createdObject;

    beforeEach(async function () {
      // Create an object to update
      const syntheticStix = createSyntheticStix(stixType);

      let createBody = {
        type: 'attack-pattern',
        status: 'work-in-progress',
        workspace: {
          workflow: {
            state: 'work-in-progress',
          },
        },
        stix: syntheticStix,
      };

      createBody = cloneForCreate(createBody);

      const createRes = await request(app)
        .post(endpoint)
        .send(createBody)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect(201);

      createdObject = createRes.body;
    });

    it('should accept valid updates in work-in-progress state', async function () {
      let updateBody = {
        type: 'attack-pattern',
        status: 'work-in-progress',
        workspace: {
          workflow: {
            state: 'work-in-progress',
          },
        },
        stix: {
          ...createdObject.stix,
          name: 'Updated Technique Name',
          description: 'Updated description',
        },
      };

      updateBody = cloneForCreate(updateBody);

      // Remove server-managed field (server adds this automatically)
      delete updateBody.stix.x_mitre_attack_spec_version;
      // Note: We keep id, created, modified because ADM schemas validate the full STIX structure

      const res = await request(app)
        .put(`${endpoint}/${createdObject.stix.id}/modified/${createdObject.stix.modified}`)
        .send(updateBody)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect('Content-Type', /json/);

      if (res.status !== 200) {
        logger.debug('=== REQUEST FAILED ===');
        logger.debug('Status:', res.status);
        logger.debug('Errors:', JSON.stringify(res.body, null, 2));
      }

      expect(res.status).toBe(200);
      expect(res.body.stix.name).toBe('Updated Technique Name');
    });

    it('should accept updates with missing optional fields in work-in-progress state', async function () {
      let updateBody = {
        type: 'attack-pattern',
        status: 'work-in-progress',
        workspace: {
          workflow: {
            state: 'work-in-progress',
          },
        },
        stix: {
          ...createdObject.stix,
          name: 'Updated Name',
        },
      };

      updateBody = cloneForCreate(updateBody);

      // Remove optional fields to test partial validation
      delete updateBody.stix.description;
      delete updateBody.stix.x_mitre_platforms;

      // Remove server-managed field
      delete updateBody.stix.x_mitre_attack_spec_version;
      // Note: We keep id, created, modified because ADM schemas validate the full STIX structure

      const res = await request(app)
        .put(`${endpoint}/${createdObject.stix.id}/modified/${createdObject.stix.modified}`)
        .send(updateBody)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect('Content-Type', /json/);

      expect(res.status).toBe(200);
    });

    it('should reject updates with invalid field values in work-in-progress state', async function () {
      const updateBody = {
        workspace: {
          workflow: {
            state: 'work-in-progress',
          },
        },
        stix: {
          ...createdObject.stix,
          x_mitre_is_subtechnique: 'not-a-boolean', // Invalid type
        },
      };

      // Remove server-managed field
      delete updateBody.stix.x_mitre_attack_spec_version;
      // Note: We keep id, created, modified because ADM schemas validate the full STIX structure

      const res = await request(app)
        .put(`${endpoint}/${createdObject.stix.id}/modified/${createdObject.stix.modified}`)
        .send(updateBody)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect('Content-Type', /json/);

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('PUT operations - reviewed (full validation)', function () {
    let createdObject;

    beforeEach(async function () {
      // Create an object to update
      const syntheticStix = createSyntheticStix(stixType);

      let createBody = {
        workspace: {
          workflow: {
            state: 'work-in-progress',
          },
        },
        stix: syntheticStix,
      };

      createBody = cloneForCreate(createBody);

      const createRes = await request(app)
        .post(endpoint)
        .send(createBody)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect(201);

      createdObject = createRes.body;
    });

    it('should accept valid complete updates in reviewed state', async function () {
      let updateBody = {
        workspace: {
          workflow: {
            state: 'reviewed',
          },
        },
        stix: {
          ...createdObject.stix,
          name: 'Reviewed Technique Name',
        },
      };

      updateBody = cloneForCreate(updateBody);

      // Remove server-managed field
      delete updateBody.stix.x_mitre_attack_spec_version;
      // Note: We keep id, created, modified because ADM schemas validate the full STIX structure

      const res = await request(app)
        .put(`${endpoint}/${createdObject.stix.id}/modified/${createdObject.stix.modified}`)
        .send(updateBody)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect('Content-Type', /json/);

      expect(res.status).toBe(200);
      expect(res.body.stix.name).toBe('Reviewed Technique Name');
    });

    it('should reject updates missing required fields in reviewed state', async function () {
      const updateBody = {
        workspace: {
          workflow: {
            state: 'reviewed',
          },
        },
        stix: {
          ...createdObject.stix,
        },
      };

      // Remove required field
      delete updateBody.stix.name;
      // Remove server-managed field
      delete updateBody.stix.x_mitre_attack_spec_version;
      // Note: We keep id, created, modified because ADM schemas validate the full STIX structure

      const res = await request(app)
        .put(`${endpoint}/${createdObject.stix.id}/modified/${createdObject.stix.modified}`)
        .send(updateBody)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect('Content-Type', /json/);

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('Validation toggle', function () {
    it('should skip validation when ADM validation is disabled', async function () {
      // Temporarily disable ADM validation
      config.validateRequests.withAttackDataModel = false;

      const syntheticStix = createSyntheticStix(stixType);

      // Remove a required field - this would normally fail validation
      delete syntheticStix.name;

      const requestBody = {
        workspace: {
          workflow: {
            state: 'reviewed',
          },
        },
        stix: syntheticStix,
      };

      const res = await request(app)
        .post(endpoint)
        .send(requestBody)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`);

      // Should NOT return 400 with "Invalid data" error because ADM validation is disabled
      // The request will likely fail at the database level (missing required field),
      // but it should NOT fail with ADM validation error
      if (res.status === 400 && res.headers['content-type']?.includes('json')) {
        expect(res.body.error).not.toBe('Invalid data');
      }

      // Re-enable ADM validation
      config.validateRequests.withAttackDataModel = true;
    });

    it('should enforce validation when ADM validation is enabled', async function () {
      // Ensure ADM validation is enabled
      config.validateRequests.withAttackDataModel = true;

      const syntheticStix = createSyntheticStix(stixType);

      // Remove required field
      delete syntheticStix.name;

      const requestBody = {
        workspace: {
          workflow: {
            state: 'reviewed',
          },
        },
        stix: syntheticStix,
      };

      const res = await request(app)
        .post(endpoint)
        .send(requestBody)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect('Content-Type', /json/);

      // Should return 400 with validation error
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid data');
      expect(res.body.details).toBeDefined();
    });
  });

  describe('Error response format', function () {
    it('should return detailed validation errors with proper structure', async function () {
      const syntheticStix = createSyntheticStix(stixType);

      // Create multiple validation errors
      delete syntheticStix.name; // Missing required field
      syntheticStix.x_mitre_is_subtechnique = 'invalid'; // Wrong type

      const requestBody = {
        workspace: {
          workflow: {
            state: 'reviewed',
          },
        },
        stix: syntheticStix,
      };

      const res = await request(app)
        .post(endpoint)
        .send(requestBody)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect('Content-Type', /json/);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid data');
      expect(res.body.details).toBeDefined();
      expect(Array.isArray(res.body.details)).toBe(true);
      expect(res.body.details.length).toBeGreaterThan(0);

      // Verify each error has expected structure
      res.body.details.forEach((detail) => {
        expect(detail).toHaveProperty('message');
        expect(detail).toHaveProperty('path');
      });
    });
  });
});
