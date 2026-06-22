/**
 * STIX Bundles Export - New ATT&CK Specification Tests (v17+)
 * ============================================================
 *
 * PURPOSE:
 * This test suite validates the NEW ATT&CK v17+ specification workflow,
 * specifically testing the new SDO types (Analytics and Detection Strategies)
 * and their associated behaviors. This suite ensures the new features work
 * correctly and that deprecated behaviors are properly ignored.
 *
 * NEW ATT&CK v17+ SPECIFICATION FEATURES TESTED:
 *
 * 1. ANALYTICS (x-mitre-analytic) - Primary Objects
 *    - Explicitly assigned to domains via x_mitre_domains
 *    - Retrieved as primary objects by domain
 *    - Require ATT&CK IDs
 *
 * 2. DETECTION STRATEGIES (x-mitre-detection-strategy) - Secondary Objects
 *    - NOT explicitly assigned to domains (domain is inferred)
 *    - Included in bundle under TWO conditions:
 *      a) They detect a technique in the bundle (via 'detects' relationship)
 *      b) They reference an analytic in the bundle (via x_mitre_analytic_refs)
 *    - Their x_mitre_domains is set to the domain being exported
 *
 * 3. DATA COMPONENTS & DATA SOURCES - Now Primary Objects
 *    - Both are now PRIMARY objects with explicit domain assignment
 *    - Retrieved by domain (not via relationships)
 *    - Data sources are deprecated but still supported via includeDataSources param
 *    - IMPORTANT: Deprecated 'detects' relationships from data components are IGNORED
 *
 * DEPRECATED BEHAVIORS THAT MUST BE IGNORED:
 * - SRO<x-mitre-data-component, detects, attack-pattern> - Data components can no longer detect
 * - Data components/sources as secondary objects - They're now primary objects
 * - Domain inference for data components - They must have explicit x_mitre_domains
 *
 * TEST SCENARIOS:
 * ✓ Analytics are retrieved as primary objects by domain
 * ✓ Detection strategies are included when they detect techniques in bundle
 * ✓ Detection strategies are included when they reference analytics in bundle
 * ✓ Detection strategies get their x_mitre_domains set to the export domain
 * ✓ Data components are retrieved as primary objects (not via detects relationships)
 * ✓ Data sources are optionally included via includeDataSources parameter
 * ✓ Deprecated detects relationships from data components are ignored
 * ✓ Data components without x_mitre_domains for a domain are NOT included in that domain's export
 *
 * TEST DATA STRUCTURE:
 * - 3 Techniques (attack-patterns) across enterprise and ICS domains
 * - 2 Analytics in enterprise domain
 * - 3 Detection Strategies (secondary objects with no domain assignment)
 * - 2 Data Components with explicit domain assignments
 * - 2 Data Sources with explicit domain assignments
 * - Deprecated detects relationships from data components (to prove they're ignored)
 * - Valid detects relationships from detection strategies
 * - Analytics references in detection strategies (x_mitre_analytic_refs)
 */

const request = require('supertest');
const { expect } = require('expect');
// const fs = require('fs');

const config = require('../../../config/config');
const logger = require('../../../lib/logger');
logger.level = 'debug';

const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');

const enterpriseDomain = 'enterprise-attack';
const icsDomain = 'ics-attack';

const collectionId = 'x-mitre-collection--b0b12345-aaaa-4bbb-8ccc-dddddddddddd';
const collectionTimestamp = new Date().toISOString();

const markingDefinitionId = 'marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168';
const mitreIdentityId = 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5';

/**
 * Test Data: New ATT&CK v17+ Specification Bundle
 *
 * This bundle includes:
 * - 3 techniques (2 enterprise, 1 ICS, with 1 shared)
 * - 2 analytics (both enterprise)
 * - 3 detection strategies (no domain - inferred)
 * - 2 data components (1 enterprise, 1 ICS)
 * - 2 data sources (1 enterprise, 1 ICS)
 * - Valid detects relationships: detection-strategy → technique
 * - Deprecated detects relationships: data-component → technique (should be ignored)
 * - Analytics references: detection-strategy → analytic
 */
const newSpecBundleData = {
  type: 'bundle',
  id: 'bundle--new-spec-test-bundle',
  spec_version: '2.1',
  objects: [
    // ========================================
    // COLLECTION OBJECT
    // ========================================
    {
      id: collectionId,
      created: collectionTimestamp,
      modified: collectionTimestamp,
      name: 'New Spec Test Collection',
      spec_version: '2.1',
      type: 'x-mitre-collection',
      description: 'Test collection for new ATT&CK specification features',
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      x_mitre_attack_spec_version: config.app.attackSpecVersion,
      x_mitre_version: '1.0',
      x_mitre_contents: [
        // Techniques
        {
          object_ref: 'attack-pattern--11111111-1111-4111-8111-111111111111',
          object_modified: '2024-01-15T10:00:00.000Z',
        },
        {
          object_ref: 'attack-pattern--22222222-2222-4222-8222-222222222222',
          object_modified: '2024-01-15T10:00:00.000Z',
        },
        {
          object_ref: 'attack-pattern--33333333-3333-4333-8333-333333333333',
          object_modified: '2024-01-15T10:00:00.000Z',
        },
        // Analytics
        {
          object_ref: 'x-mitre-analytic--44444444-4444-4444-8444-444444444444',
          object_modified: '2024-01-15T10:00:00.000Z',
        },
        {
          object_ref: 'x-mitre-analytic--55555555-5555-4555-8555-555555555555',
          object_modified: '2024-01-15T10:00:00.000Z',
        },
        // Detection Strategies
        {
          object_ref: 'x-mitre-detection-strategy--66666666-6666-4666-8666-666666666666',
          object_modified: '2024-01-15T10:00:00.000Z',
        },
        {
          object_ref: 'x-mitre-detection-strategy--77777777-7777-4777-8777-777777777777',
          object_modified: '2024-01-15T10:00:00.000Z',
        },
        {
          object_ref: 'x-mitre-detection-strategy--88888888-8888-4888-8888-888888888888',
          object_modified: '2024-01-15T10:00:00.000Z',
        },
        // Data Components
        {
          object_ref: 'x-mitre-data-component--99999999-9999-4999-8999-999999999999',
          object_modified: '2024-01-15T10:00:00.000Z',
        },
        {
          object_ref: 'x-mitre-data-component--aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          object_modified: '2024-01-15T10:00:00.000Z',
        },
        // Data Sources
        {
          object_ref: 'x-mitre-data-source--bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          object_modified: '2024-01-15T10:00:00.000Z',
        },
        {
          object_ref: 'x-mitre-data-source--cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          object_modified: '2024-01-15T10:00:00.000Z',
        },
        // Relationships
        {
          object_ref: 'relationship--dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          object_modified: '2024-01-15T10:00:00.000Z',
        },
        {
          object_ref: 'relationship--eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          object_modified: '2024-01-15T10:00:00.000Z',
        },
        {
          object_ref: 'relationship--ffffffff-ffff-4fff-8fff-ffffffffffff',
          object_modified: '2024-01-15T10:00:00.000Z',
        },
        // Supporting objects (identity and marking-definition should also be in x_mitre_contents)
        { object_ref: mitreIdentityId, object_modified: '2017-06-01T00:00:00.000Z' },
        { object_ref: markingDefinitionId, object_modified: '2017-06-01T00:00:00.000Z' },
      ],
    },

    // ========================================
    // TECHNIQUES (attack-pattern)
    // ========================================
    {
      type: 'attack-pattern',
      id: 'attack-pattern--11111111-1111-4111-8111-111111111111',
      created: '2024-01-15T10:00:00.000Z',
      modified: '2024-01-15T10:00:00.000Z',
      name: 'Enterprise Technique 1',
      description: 'A technique in the enterprise domain',
      spec_version: '2.1',
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      external_references: [{ source_name: 'mitre-attack', external_id: 'T9001' }],
      kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'execution' }],
      x_mitre_attack_spec_version: config.app.attackSpecVersion,
      x_mitre_domains: [enterpriseDomain],
      x_mitre_version: '1.0',
      x_mitre_is_subtechnique: false,
    },
    {
      type: 'attack-pattern',
      id: 'attack-pattern--22222222-2222-4222-8222-222222222222',
      created: '2024-01-15T10:00:00.000Z',
      modified: '2024-01-15T10:00:00.000Z',
      name: 'Enterprise Technique 2',
      description: 'Another technique in the enterprise domain',
      spec_version: '2.1',
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      external_references: [{ source_name: 'mitre-attack', external_id: 'T9002' }],
      kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'persistence' }],
      x_mitre_attack_spec_version: config.app.attackSpecVersion,
      x_mitre_domains: [enterpriseDomain],
      x_mitre_version: '1.0',
      x_mitre_is_subtechnique: false,
    },
    {
      type: 'attack-pattern',
      id: 'attack-pattern--33333333-3333-4333-8333-333333333333',
      created: '2024-01-15T10:00:00.000Z',
      modified: '2024-01-15T10:00:00.000Z',
      name: 'ICS Technique 1',
      description: 'A technique in both enterprise and ICS domains',
      spec_version: '2.1',
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      external_references: [{ source_name: 'mitre-attack', external_id: 'T9003' }],
      kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'execution' }],
      x_mitre_attack_spec_version: config.app.attackSpecVersion,
      x_mitre_domains: [enterpriseDomain, icsDomain],
      x_mitre_version: '1.0',
      x_mitre_is_subtechnique: false,
    },

    // ========================================
    // ANALYTICS (x-mitre-analytic) - PRIMARY OBJECTS
    // ========================================
    {
      type: 'x-mitre-analytic',
      id: 'x-mitre-analytic--44444444-4444-4444-8444-444444444444',
      created: '2024-01-15T10:00:00.000Z',
      modified: '2024-01-15T10:00:00.000Z',
      name: 'Process Execution Analytic',
      description: 'Detects suspicious process execution patterns',
      spec_version: '2.1',
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      external_references: [
        {
          source_name: 'mitre-attack',
          external_id: 'AN0001',
          url: 'https://attack.mitre.org/detectionstrategies/DET0002#AN0001',
        },
      ],
      x_mitre_attack_spec_version: config.app.attackSpecVersion,
      x_mitre_domains: [enterpriseDomain],
      x_mitre_platforms: ['Windows'],
      x_mitre_version: '1.0',
    },
    {
      type: 'x-mitre-analytic',
      id: 'x-mitre-analytic--55555555-5555-4555-8555-555555555555',
      created: '2024-01-15T10:00:00.000Z',
      modified: '2024-01-15T10:00:00.000Z',
      name: 'Persistence Mechanism Analytic',
      description: 'Detects persistence mechanism installations',
      spec_version: '2.1',
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      external_references: [{ source_name: 'mitre-attack', external_id: 'AN0002' }],
      // Note: No URL, meaning it's not attached to a detection strategy, meaning we don't want it in the bundle
      x_mitre_attack_spec_version: config.app.attackSpecVersion,
      x_mitre_domains: [enterpriseDomain],
      x_mitre_platforms: ['Windows'],
      x_mitre_version: '1.0',
    },

    // ========================================
    // DETECTION STRATEGIES (x-mitre-detection-strategy) - SECONDARY OBJECTS
    // ========================================
    {
      type: 'x-mitre-detection-strategy',
      id: 'x-mitre-detection-strategy--66666666-6666-4666-8666-666666666666',
      created: '2024-01-15T10:00:00.000Z',
      modified: '2024-01-15T10:00:00.000Z',
      name: 'Detection Strategy 1 - Detects Technique via Relationship',
      spec_version: '2.1',
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      external_references: [{ source_name: 'mitre-attack', external_id: 'DET0001' }],
      x_mitre_analytic_refs: ['x-mitre-analytic--44444444-4444-4444-8444-444444444444'],
      x_mitre_attack_spec_version: config.app.attackSpecVersion,
      x_mitre_domains: [enterpriseDomain],
      x_mitre_modified_by_ref: mitreIdentityId,
      x_mitre_version: '1.0',
    },
    {
      type: 'x-mitre-detection-strategy',
      id: 'x-mitre-detection-strategy--77777777-7777-4777-8777-777777777777',
      created: '2024-01-15T10:00:00.000Z',
      modified: '2024-01-15T10:00:00.000Z',
      name: 'Detection Strategy 2 - References Analytic',
      spec_version: '2.1',
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      external_references: [{ source_name: 'mitre-attack', external_id: 'DET0002' }],
      x_mitre_analytic_refs: ['x-mitre-analytic--44444444-4444-4444-8444-444444444444'],
      x_mitre_attack_spec_version: config.app.attackSpecVersion,
      x_mitre_domains: [enterpriseDomain],
      x_mitre_modified_by_ref: mitreIdentityId,
      x_mitre_version: '1.0',
    },
    {
      type: 'x-mitre-detection-strategy',
      id: 'x-mitre-detection-strategy--88888888-8888-4888-8888-888888888888',
      created: '2024-01-15T10:00:00.000Z',
      modified: '2024-01-15T10:00:00.000Z',
      name: 'Detection Strategy 3 - Not Included (orphaned)',
      spec_version: '2.1',
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      external_references: [{ source_name: 'mitre-attack', external_id: 'DET0003' }],
      x_mitre_analytic_refs: ['x-mitre-analytic--55555555-5555-4555-8555-555555555555'],
      x_mitre_attack_spec_version: config.app.attackSpecVersion,
      x_mitre_domains: [enterpriseDomain],
      x_mitre_modified_by_ref: mitreIdentityId,
      x_mitre_version: '1.0',
      // Note: No detects relationship, and its analytic lacks a URL, so this should NOT appear in bundle
    },

    // ========================================
    // DATA COMPONENTS (x-mitre-data-component) - PRIMARY OBJECTS
    // ========================================
    {
      type: 'x-mitre-data-component',
      id: 'x-mitre-data-component--99999999-9999-4999-8999-999999999999',
      created: '2024-01-15T10:00:00.000Z',
      modified: '2024-01-15T10:00:00.000Z',
      name: 'Enterprise Data Component',
      description: 'A data component in the enterprise domain',
      spec_version: '2.1',
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      external_references: [{ source_name: 'mitre-attack', external_id: 'DC9001' }],
      x_mitre_attack_spec_version: config.app.attackSpecVersion,
      x_mitre_domains: [enterpriseDomain],
      x_mitre_modified_by_ref: mitreIdentityId,
      x_mitre_version: '1.0',
      x_mitre_data_source_ref: 'x-mitre-data-source--bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
    {
      type: 'x-mitre-data-component',
      id: 'x-mitre-data-component--aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      created: '2024-01-15T10:00:00.000Z',
      modified: '2024-01-15T10:00:00.000Z',
      name: 'ICS Data Component',
      description: 'A data component in the ICS domain',
      spec_version: '2.1',
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      external_references: [{ source_name: 'mitre-attack', external_id: 'DC9002' }],
      x_mitre_attack_spec_version: config.app.attackSpecVersion,
      x_mitre_domains: [icsDomain],
      x_mitre_modified_by_ref: mitreIdentityId,
      x_mitre_version: '1.0',
      x_mitre_data_source_ref: 'x-mitre-data-source--cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    },

    // ========================================
    // DATA SOURCES (x-mitre-data-source) - PRIMARY OBJECTS (DEPRECATED)
    // ========================================
    {
      type: 'x-mitre-data-source',
      id: 'x-mitre-data-source--bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      created: '2024-01-15T10:00:00.000Z',
      modified: '2024-01-15T10:00:00.000Z',
      name: 'Enterprise Data Source',
      description: 'A deprecated data source in the enterprise domain',
      spec_version: '2.1',
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      external_references: [{ source_name: 'mitre-attack', external_id: 'DS9001' }],
      x_mitre_attack_spec_version: config.app.attackSpecVersion,
      x_mitre_collection_layers: ['Host'],
      x_mitre_domains: [enterpriseDomain],
      x_mitre_modified_by_ref: mitreIdentityId,
      x_mitre_version: '1.0',
    },
    {
      type: 'x-mitre-data-source',
      id: 'x-mitre-data-source--cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      created: '2024-01-15T10:00:00.000Z',
      modified: '2024-01-15T10:00:00.000Z',
      name: 'ICS Data Source',
      description: 'A deprecated data source in the ICS domain',
      spec_version: '2.1',
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      external_references: [{ source_name: 'mitre-attack', external_id: 'DS9002' }],
      x_mitre_attack_spec_version: config.app.attackSpecVersion,
      x_mitre_collection_layers: ['Host'],
      x_mitre_domains: [icsDomain],
      x_mitre_modified_by_ref: mitreIdentityId,
      x_mitre_version: '1.0',
    },

    // ========================================
    // RELATIONSHIPS
    // ========================================

    // Valid 'detects' relationship: Detection Strategy → Technique
    {
      type: 'relationship',
      id: 'relationship--dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      created: '2024-01-15T10:00:00.000Z',
      modified: '2024-01-15T10:00:00.000Z',
      relationship_type: 'detects',
      source_ref: 'x-mitre-detection-strategy--66666666-6666-4666-8666-666666666666',
      target_ref: 'attack-pattern--11111111-1111-4111-8111-111111111111',
      description: 'Detection strategy detects enterprise technique 1',
      spec_version: '2.1',
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      x_mitre_attack_spec_version: config.app.attackSpecVersion,
      x_mitre_modified_by_ref: mitreIdentityId,
    },

    // Valid 'detects' relationship: Detection Strategy → Technique (different technique)
    {
      type: 'relationship',
      id: 'relationship--eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      created: '2024-01-15T10:00:00.000Z',
      modified: '2024-01-15T10:00:00.000Z',
      relationship_type: 'detects',
      source_ref: 'x-mitre-detection-strategy--66666666-6666-4666-8666-666666666666',
      target_ref: 'attack-pattern--22222222-2222-4222-8222-222222222222',
      description: 'Detection strategy detects enterprise technique 2',
      spec_version: '2.1',
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      x_mitre_attack_spec_version: config.app.attackSpecVersion,
      x_mitre_modified_by_ref: mitreIdentityId,
    },

    // DEPRECATED 'detects' relationship: Data Component → Technique (should be IGNORED)
    {
      type: 'relationship',
      id: 'relationship--ffffffff-ffff-4fff-8fff-ffffffffffff',
      created: '2024-01-15T10:00:00.000Z',
      modified: '2024-01-15T10:00:00.000Z',
      relationship_type: 'detects',
      source_ref: 'x-mitre-data-component--99999999-9999-4999-8999-999999999999',
      target_ref: 'attack-pattern--11111111-1111-4111-8111-111111111111',
      description: 'DEPRECATED: Data component detects technique (should be ignored)',
      spec_version: '2.1',
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      x_mitre_attack_spec_version: config.app.attackSpecVersion,
      x_mitre_modified_by_ref: mitreIdentityId,
    },

    // ========================================
    // SUPPORTING OBJECTS (Identity, Marking Definition)
    // ========================================
    {
      type: 'identity',
      id: mitreIdentityId,
      created: '2017-06-01T00:00:00.000Z',
      modified: '2017-06-01T00:00:00.000Z',
      name: 'The MITRE Corporation',
      identity_class: 'organization',
      object_marking_refs: [markingDefinitionId],
      spec_version: '2.1',
      x_mitre_attack_spec_version: config.app.attackSpecVersion,
    },
    {
      type: 'marking-definition',
      id: markingDefinitionId,
      created_by_ref: mitreIdentityId,
      created: '2017-06-01T00:00:00.000Z',
      definition_type: 'statement',
      definition: {
        statement:
          'Copyright 2015-2024, The MITRE Corporation. MITRE ATT&CK and ATT&CK are registered trademarks of The MITRE Corporation.',
      },
      spec_version: '2.1',
    },
  ],
};

describe('STIX Bundles New Specification API', function () {
  let app;
  let passportCookie;

  before(async function () {
    // Establish the database connection
    // Use an in-memory database that we spin up for the test
    await database.initializeConnection();

    // Check for a valid database configuration
    await databaseConfiguration.checkSystemConfiguration();

    // Enable ADM validation; the imported bundle fixture is ADM-compliant
    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;

    // Initialize the express app
    app = await require('../../../index').initializeApp();

    // Log into the app
    passportCookie = await login.loginAnonymous(app);
  });

  it('POST /api/collection-bundles imports the new spec bundle', async function () {
    const body = newSpecBundleData;
    const res = await request(app)
      .post('/api/collection-bundles')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    const collection = res.body;
    expect(collection).toBeDefined();
    expect(collection.workspace.import_categories.additions.length).toBe(
      newSpecBundleData.objects[0].x_mitre_contents.length,
    );
    expect(collection.workspace.import_categories.errors.length).toBe(0);
  });

  it('GET /api/stix-bundles exports an empty STIX bundle', function (done) {
    request(app)
      .get('/api/stix-bundles?domain=not-a-domain')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .end(function (err, res) {
        if (err) {
          done(err);
        } else {
          // We expect to get the exported STIX bundle
          const stixBundle = res.body;
          expect(stixBundle).toBeDefined();
          expect(Array.isArray(stixBundle.objects)).toBe(true);
          expect(stixBundle.objects.length).toBe(0);
          done();
        }
      });
  });

  it('GET /api/stix-bundles exports enterprise bundle with new specification objects', async function () {
    const res = await request(app)
      .get('/api/stix-bundles')
      .query({ domain: enterpriseDomain })
      .query({ stixVersion: '2.1' })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const stixBundle = res.body;
    expect(stixBundle).toBeDefined();
    expect(Array.isArray(stixBundle.objects)).toBe(true);

    // Write bundle to file for debugging
    // fs.writeFileSync(
    //   './debug-new-spec-enterprise-bundle.json',
    //   JSON.stringify(stixBundle, null, 2),
    // );
    console.log('\n=== New Spec Enterprise Bundle ===');
    console.log(`Total objects: ${stixBundle.objects.length}`);

    // Count objects by type
    const typeCounts = {};
    stixBundle.objects.forEach((obj) => {
      typeCounts[obj.type] = (typeCounts[obj.type] || 0) + 1;
    });
    console.log('Object type counts:', typeCounts);

    // Verify primary objects are included
    const techniques = stixBundle.objects.filter((o) => o.type === 'attack-pattern');
    expect(techniques.length).toBe(3); // new-ent-001, new-ent-002, new-ics-001

    const analytics = stixBundle.objects.filter((o) => o.type === 'x-mitre-analytic');
    expect(analytics.length).toBe(1); // new-ana-001

    const dataComponents = stixBundle.objects.filter((o) => o.type === 'x-mitre-data-component');
    expect(dataComponents.length).toBe(1); // Only new-dc-001 (enterprise)
  });

  it('Filters out deprecated detects relationships from data components', async function () {
    const res = await request(app)
      .get('/api/stix-bundles')
      .query({ domain: enterpriseDomain })
      .query({ stixVersion: '2.1' })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const stixBundle = res.body;

    // Verify deprecated detects relationships are FILTERED OUT
    // The new spec maintains a clean separation: deprecated patterns are excluded
    // even if both endpoints exist in the bundle as primary objects
    const deprecatedRelationship = stixBundle.objects.find(
      (o) => o.id === 'relationship--ffffffff-ffff-4fff-8fff-ffffffffffff',
    );
    expect(deprecatedRelationship).toBeUndefined();

    // Verify only valid detects relationships from detection strategies are included
    const validDetectsRels = stixBundle.objects.filter(
      (o) => o.type === 'relationship' && o.relationship_type === 'detects',
    );
    expect(validDetectsRels.length).toBe(2); // Only DET0001 detects relationships
    validDetectsRels.forEach((rel) => {
      expect(rel.source_ref).toMatch(/^x-mitre-detection-strategy--/);
    });
  });

  it('Includes detection strategy when it detects an in-scope technique via relationship', async function () {
    const res = await request(app)
      .get('/api/stix-bundles')
      .query({ domain: enterpriseDomain })
      .query({ stixVersion: '2.1' })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const stixBundle = res.body;

    // Verify DET0001 is included because it has 'detects' relationships to in-scope techniques
    const ds001 = stixBundle.objects.find(
      (o) => o.id === 'x-mitre-detection-strategy--66666666-6666-4666-8666-666666666666',
    );
    expect(ds001).toBeDefined();
    expect(ds001.name).toBe('Detection Strategy 1 - Detects Technique via Relationship');
    expect(ds001.x_mitre_domains).toEqual([enterpriseDomain]);

    // Verify the 'detects' relationships are included
    const ds001DetectsRels = stixBundle.objects.filter(
      (o) =>
        o.type === 'relationship' &&
        o.relationship_type === 'detects' &&
        o.source_ref === 'x-mitre-detection-strategy--66666666-6666-4666-8666-666666666666',
    );
    expect(ds001DetectsRels.length).toBe(2); // Detects two techniques
  });

  it('Includes detection strategy when it references an in-scope analytic', async function () {
    const res = await request(app)
      .get('/api/stix-bundles')
      .query({ domain: enterpriseDomain })
      .query({ stixVersion: '2.1' })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const stixBundle = res.body;

    // Verify DET0002 is included because it references an in-scope analytic via x_mitre_analytic_refs
    const ds002 = stixBundle.objects.find(
      (o) => o.id === 'x-mitre-detection-strategy--77777777-7777-4777-8777-777777777777',
    );
    expect(ds002).toBeDefined();
    expect(ds002.name).toBe('Detection Strategy 2 - References Analytic');
    expect(ds002.x_mitre_analytic_refs).toContain(
      'x-mitre-analytic--44444444-4444-4444-8444-444444444444',
    );
    expect(ds002.x_mitre_domains).toEqual([enterpriseDomain]);

    // Verify the referenced analytic is in the bundle
    const analytic = stixBundle.objects.find(
      (o) => o.id === 'x-mitre-analytic--44444444-4444-4444-8444-444444444444',
    );
    expect(analytic).toBeDefined();
  });

  it('Excludes detection strategy when neither condition is met', async function () {
    const res = await request(app)
      .get('/api/stix-bundles')
      .query({ domain: enterpriseDomain })
      .query({ stixVersion: '2.1' })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const stixBundle = res.body;

    // Verify DET0003 is NOT included (orphaned - no technique or analytic reference)
    const ds003 = stixBundle.objects.find(
      (o) => o.id === 'x-mitre-detection-strategy--88888888-8888-4888-8888-888888888888',
    );
    expect(ds003).toBeUndefined();
  });

  it('GET /api/stix-bundles with includeDataSources=true includes data sources', async function () {
    const res = await request(app)
      .get('/api/stix-bundles')
      .query({ domain: enterpriseDomain })
      .query({ includeDataSources: true })
      .query({ stixVersion: '2.1' })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const stixBundle = res.body;

    const dataSources = stixBundle.objects.filter((o) => o.type === 'x-mitre-data-source');
    expect(dataSources.length).toBe(1); // Only new-ds-src-001 (enterprise)
    expect(dataSources[0].id).toBe('x-mitre-data-source--bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  });

  it('GET /api/stix-bundles without includeDataSources excludes data sources', async function () {
    const res = await request(app)
      .get('/api/stix-bundles')
      .query({ domain: enterpriseDomain })
      .query({ stixVersion: '2.1' })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const stixBundle = res.body;

    const dataSources = stixBundle.objects.filter((o) => o.type === 'x-mitre-data-source');
    expect(dataSources.length).toBe(0); // Data sources excluded by default
  });

  it('GET /api/stix-bundles for ICS domain excludes enterprise-only objects', async function () {
    const res = await request(app)
      .get('/api/stix-bundles')
      .query({ domain: icsDomain })
      .query({ stixVersion: '2.1' })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const stixBundle = res.body;

    console.log('\n=== New Spec ICS Bundle ===');
    console.log(`Total objects: ${stixBundle.objects.length}`);

    const typeCounts = {};
    stixBundle.objects.forEach((obj) => {
      typeCounts[obj.type] = (typeCounts[obj.type] || 0) + 1;
    });
    console.log('Object type counts:', typeCounts);

    // Only 1 technique should be in ICS (new-ics-001)
    const techniques = stixBundle.objects.filter((o) => o.type === 'attack-pattern');
    expect(techniques.length).toBe(1);
    expect(techniques[0].id).toBe('attack-pattern--33333333-3333-4333-8333-333333333333');

    // No analytics in ICS domain
    const analytics = stixBundle.objects.filter((o) => o.type === 'x-mitre-analytic');
    expect(analytics.length).toBe(0);

    // Only ICS data component (new-dc-002)
    const dataComponents = stixBundle.objects.filter((o) => o.type === 'x-mitre-data-component');
    expect(dataComponents.length).toBe(1);
    expect(dataComponents[0].id).toBe(
      'x-mitre-data-component--aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );

    // No detection strategies (none detect ICS techniques or reference ICS analytics)
    const detectionStrategies = stixBundle.objects.filter(
      (o) => o.type === 'x-mitre-detection-strategy',
    );
    expect(detectionStrategies.length).toBe(0);
  });

  after(async function () {
    await database.closeConnection();
  });
});
