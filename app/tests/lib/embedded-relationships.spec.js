const request = require('supertest');
const { expect } = require('expect');

const database = require('../../lib/database-in-memory');
const databaseConfiguration = require('../../lib/database-configuration');
const login = require('../shared/login');

const logger = require('../../lib/logger');
const { cloneForCreate } = require('../shared/clone-for-create');
logger.level = 'debug';

describe('Embedded Relationships - Detection Strategies and Analytics', function () {
  let app;
  let passportCookie;

  before(async function () {
    // Establish the database connection
    await database.initializeConnection();

    // Check for a valid database configuration
    await databaseConfiguration.checkSystemConfiguration();

    // Initialize the express app
    app = await require('../../index').initializeApp();

    // Log into the app
    passportCookie = await login.loginAnonymous(app);
  });

  describe('Create Detection Strategy with Analytics', function () {
    let analytic1, analytic2, detectionStrategy;

    it('Setup: Create two analytics', async function () {
      const timestamp = new Date().toISOString();

      // Create first analytic
      const analytic1Data = {
        workspace: {
          workflow: { state: 'work-in-progress' },
        },
        stix: {
          name: 'Test Analytic 1',
          type: 'x-mitre-analytic',
          spec_version: '2.1',
          description: 'Test analytic 1',
          created: timestamp,
          modified: timestamp,
          x_mitre_domains: ['enterprise-attack'],
          x_mitre_platforms: ['windows'],
          x_mitre_version: '1.0',
          x_mitre_attack_spec_version: '3.3.0',
          object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
          created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
        },
      };

      const res1 = await request(app)
        .post('/api/analytics')
        .send(analytic1Data)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect(201)
        .expect('Content-Type', /json/);

      analytic1 = res1.body;
      expect(analytic1.stix.id).toBeDefined();

      // Create second analytic
      const analytic2Data = {
        workspace: {
          workflow: { state: 'work-in-progress' },
        },
        stix: {
          name: 'Test Analytic 2',
          type: 'x-mitre-analytic',
          spec_version: '2.1',
          description: 'Test analytic 2',
          created: timestamp,
          modified: timestamp,
          x_mitre_domains: ['enterprise-attack'],
          x_mitre_platforms: ['windows'],
          x_mitre_version: '1.0',
          x_mitre_attack_spec_version: '3.3.0',
          object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
          created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
        },
      };

      const res2 = await request(app)
        .post('/api/analytics')
        .send(analytic2Data)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect(201)
        .expect('Content-Type', /json/);

      analytic2 = res2.body;
      expect(analytic2.stix.id).toBeDefined();
    });

    it('Should create detection strategy with analytics and build outbound embedded_relationships', async function () {
      const timestamp = new Date().toISOString();

      const detectionStrategyData = {
        workspace: {
          workflow: { state: 'work-in-progress' },
        },
        stix: {
          name: 'Test Detection Strategy',
          type: 'x-mitre-detection-strategy',
          spec_version: '2.1',
          description: 'Test detection strategy',
          created: timestamp,
          modified: timestamp,
          x_mitre_domains: ['enterprise-attack'],
          x_mitre_version: '1.0',
          x_mitre_attack_spec_version: '3.3.0',
          x_mitre_analytic_refs: [analytic1.stix.id, analytic2.stix.id],
          object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
          created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
        },
      };

      const res = await request(app)
        .post('/api/detection-strategies')
        .send(detectionStrategyData)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect(201)
        .expect('Content-Type', /json/);

      detectionStrategy = res.body;

      // Verify detection strategy was created
      expect(detectionStrategy.stix.id).toBeDefined();
      expect(detectionStrategy.stix.x_mitre_analytic_refs).toHaveLength(2);

      // Verify outbound embedded_relationships were created
      expect(detectionStrategy.workspace.embedded_relationships).toBeDefined();
      expect(detectionStrategy.workspace.embedded_relationships).toHaveLength(2);

      const outboundRel1 = detectionStrategy.workspace.embedded_relationships.find(
        (rel) => rel.stix_id === analytic1.stix.id,
      );
      expect(outboundRel1).toBeDefined();
      expect(outboundRel1.direction).toBe('outbound');
      expect(outboundRel1.attack_id).toBe(analytic1.workspace.attack_id);

      const outboundRel2 = detectionStrategy.workspace.embedded_relationships.find(
        (rel) => rel.stix_id === analytic2.stix.id,
      );
      expect(outboundRel2).toBeDefined();
      expect(outboundRel2.direction).toBe('outbound');
      expect(outboundRel2.attack_id).toBe(analytic2.workspace.attack_id);
    });

    it('Should add inbound embedded_relationships to analytics', async function () {
      // Wait a bit for event handlers to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Fetch the updated analytics
      const res1 = await request(app)
        .get(`/api/analytics/${analytic1.stix.id}`)
        .query({ versions: 'latest' })
        .query({ includeRefs: true })
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect(200)
        .expect('Content-Type', /json/);

      const updatedAnalytic1 = res1.body[0];

      // Verify inbound embedded_relationship was added
      expect(updatedAnalytic1.workspace.embedded_relationships).toBeDefined();
      expect(updatedAnalytic1.workspace.embedded_relationships).toHaveLength(1);

      const inboundRel = updatedAnalytic1.workspace.embedded_relationships[0];
      expect(inboundRel.stix_id).toBe(detectionStrategy.stix.id);
      expect(inboundRel.direction).toBe('inbound');
      expect(inboundRel.attack_id).toBe(detectionStrategy.workspace.attack_id);

      // Verify external_references was updated with URL
      const attackRef = updatedAnalytic1.stix.external_references.find(
        (ref) => ref.source_name === 'mitre-attack',
      );
      expect(attackRef).toBeDefined();
      expect(attackRef.url).toBe(
        `https://attack.mitre.org/detectionstrategies/${detectionStrategy.workspace.attack_id}#${analytic1.workspace.attack_id}`,
      );
    });
  });

  describe('Update Detection Strategy - Add Analytics', function () {
    let analytic3, detectionStrategy2;

    it('Setup: Create an analytic and a detection strategy without analytics', async function () {
      // Create analytic
      const timestamp1 = new Date().toISOString();
      const analytic3Data = {
        workspace: {
          workflow: { state: 'work-in-progress' },
        },
        stix: {
          name: 'Test Analytic 3',
          type: 'x-mitre-analytic',
          spec_version: '2.1',
          description: 'Test analytic 3',
          created: timestamp1,
          modified: timestamp1,
          x_mitre_domains: ['enterprise-attack'],
          x_mitre_platforms: ['windows'],
          x_mitre_version: '1.0',
          x_mitre_attack_spec_version: '3.3.0',
          object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
          created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
        },
      };

      const res1 = await request(app)
        .post('/api/analytics')
        .send(analytic3Data)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect(201);

      analytic3 = res1.body;

      // Create detection strategy without analytics
      const timestamp2 = new Date().toISOString();
      const detectionStrategyData = {
        workspace: {
          workflow: { state: 'work-in-progress' },
        },
        stix: {
          name: 'Test Detection Strategy 2',
          type: 'x-mitre-detection-strategy',
          spec_version: '2.1',
          description: 'Test detection strategy 2',
          created: timestamp2,
          modified: timestamp2,
          x_mitre_domains: ['enterprise-attack'],
          x_mitre_version: '1.0',
          x_mitre_attack_spec_version: '3.3.0',
          x_mitre_analytic_refs: [], // Empty initially
          object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
          created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
        },
      };

      const res2 = await request(app)
        .post('/api/detection-strategies')
        .send(detectionStrategyData)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect(201);

      detectionStrategy2 = res2.body;

      // Verify no embedded_relationships initially
      expect(detectionStrategy2.workspace.embedded_relationships?.length || 0).toBe(0);
    });

    it('Should add analytic to detection strategy and create bidirectional relationships', async function () {
      const timestamp = new Date().toISOString();

      // Update detection strategy to add analytic
      const updatedData = {
        ...detectionStrategy2,
        stix: {
          ...detectionStrategy2.stix,
          modified: timestamp,
          x_mitre_analytic_refs: [analytic3.stix.id],
        },
      };

      // Use the actual modified timestamp from the created object
      const res = await request(app)
        .put(
          `/api/detection-strategies/${detectionStrategy2.stix.id}/modified/${detectionStrategy2.stix.modified}`,
        )
        .send(updatedData)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect(200);

      const updatedDetectionStrategy = res.body;

      // Verify outbound relationship was added
      expect(updatedDetectionStrategy.workspace.embedded_relationships).toHaveLength(1);
      expect(updatedDetectionStrategy.workspace.embedded_relationships[0].stix_id).toBe(
        analytic3.stix.id,
      );
      expect(updatedDetectionStrategy.workspace.embedded_relationships[0].direction).toBe(
        'outbound',
      );

      // Wait for event handlers
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify inbound relationship was added to analytic
      const res2 = await request(app)
        .get(`/api/analytics/${analytic3.stix.id}`)
        .query({ versions: 'latest', includeRefs: true })
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect(200);

      const updatedAnalytic3 = res2.body[0];
      expect(updatedAnalytic3.workspace.embedded_relationships).toHaveLength(1);
      expect(updatedAnalytic3.workspace.embedded_relationships[0].stix_id).toBe(
        detectionStrategy2.stix.id,
      );
      expect(updatedAnalytic3.workspace.embedded_relationships[0].direction).toBe('inbound');

      // Verify URL was added
      const attackRef = updatedAnalytic3.stix.external_references.find(
        (ref) => ref.source_name === 'mitre-attack',
      );
      expect(attackRef.url).toBe(
        `https://attack.mitre.org/detectionstrategies/${detectionStrategy2.workspace.attack_id}#${analytic3.workspace.attack_id}`,
      );
    });
  });

  describe('Update Detection Strategy - Remove Analytics', function () {
    let analytic4, detectionStrategy3;

    it('Setup: Create detection strategy with analytics', async function () {
      // Create analytic
      const timestamp1 = new Date().toISOString();
      const analytic4Data = {
        workspace: {
          workflow: { state: 'work-in-progress' },
        },
        stix: {
          name: 'Test Analytic 4',
          type: 'x-mitre-analytic',
          spec_version: '2.1',
          description: 'Test analytic 4',
          created: timestamp1,
          modified: timestamp1,
          x_mitre_domains: ['enterprise-attack'],
          x_mitre_platforms: ['windows'],
          x_mitre_version: '1.0',
          x_mitre_attack_spec_version: '3.3.0',
          object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
          created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
        },
      };

      const res1 = await request(app)
        .post('/api/analytics')
        .send(analytic4Data)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect(201);

      analytic4 = res1.body;

      // Create detection strategy with analytics
      const timestamp2 = new Date().toISOString();
      const detectionStrategyData = {
        workspace: {
          workflow: { state: 'work-in-progress' },
        },
        stix: {
          name: 'Test Detection Strategy 3',
          type: 'x-mitre-detection-strategy',
          spec_version: '2.1',
          description: 'Test detection strategy 3',
          created: timestamp2,
          modified: timestamp2,
          x_mitre_domains: ['enterprise-attack'],
          x_mitre_version: '1.0',
          x_mitre_attack_spec_version: '3.3.0',
          x_mitre_analytic_refs: [analytic4.stix.id],
          object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
          created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
        },
      };

      const res2 = await request(app)
        .post('/api/detection-strategies')
        .send(detectionStrategyData)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect(201);

      detectionStrategy3 = res2.body;

      // Wait for event handlers
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    it('Should remove analytic from detection strategy and clean up bidirectional relationships', async function () {
      const timestamp = new Date().toISOString();

      // Update detection strategy to remove analytic
      const updatedData = cloneForCreate(detectionStrategy3);
      updatedData.stix.modified = timestamp; // Bump timestamp
      updatedData.stix.x_mitre_analytic_refs = []; // Remove all analytics

      // Use the actual modified timestamp from the created object
      const res = await request(app)
        .post('/api/detection-strategies')
        .send(updatedData)
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect(201);

      const updatedDetectionStrategy = res.body;

      // Verify outbound relationship was removed
      expect(updatedDetectionStrategy.workspace.embedded_relationships?.length || 0).toBe(0);

      // Wait for event handlers
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify inbound relationship was removed from analytic
      const res2 = await request(app)
        .get(`/api/analytics/${analytic4.stix.id}`)
        .query({ versions: 'latest' })
        .query({ includeRefs: true })
        .set('Accept', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
        .expect(200);

      const updatedAnalytic4 = res2.body[0];
      expect(updatedAnalytic4.workspace.embedded_relationships?.length || 0).toBe(0);

      // Verify URL was removed
      const attackRef = updatedAnalytic4.stix.external_references.find(
        (ref) => ref.source_name === 'mitre-attack',
      );
      expect(attackRef.url).toBeUndefined();
    });
  });

  after(async function () {
    await database.closeConnection();
  });
});
