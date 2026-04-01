const request = require('supertest');
const { expect } = require('expect');

const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');

const config = require('../../../config/config');
const login = require('../../shared/login');

const logger = require('../../../lib/logger');
logger.level = 'debug';

const baseTechniqueData = {
  workspace: {
    workflow: {
      state: 'work-in-progress',
    },
  },
  stix: {
    name: 'convert-test-technique',
    type: 'attack-pattern',
    description: 'A technique for conversion tests.',
    object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
    created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
    kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'execution' }],
    x_mitre_is_subtechnique: false,
    x_mitre_platforms: ['Linux'],
  },
};

describe('Techniques Convert API', function () {
  let app;
  let passportCookie;

  before(async function () {
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();

    config.validateRequests.withAttackDataModel = false;
    config.validateRequests.withOpenApi = false;

    app = await require('../../../index').initializeApp();
    passportCookie = await login.loginAnonymous(app);
  });

  // =============================================
  // Convert technique → subtechnique
  // =============================================
  describe('POST /api/techniques/:stixId/convert-to-subtechnique', function () {
    let parentTechnique;
    let technique;

    it('creates a parent technique', async function () {
      const timestamp = new Date().toISOString();
      const body = {
        ...baseTechniqueData,
        stix: {
          ...baseTechniqueData.stix,
          name: 'parent-technique',
          created: timestamp,
          modified: timestamp,
        },
      };
      const res = await request(app)
        .post('/api/techniques')
        .send(body)
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(201);

      parentTechnique = res.body;
      expect(parentTechnique.workspace.attack_id).toBeDefined();
    });

    it('creates a technique to convert', async function () {
      const timestamp = new Date().toISOString();
      const body = {
        ...baseTechniqueData,
        stix: {
          ...baseTechniqueData.stix,
          name: 'technique-to-convert',
          created: timestamp,
          modified: timestamp,
        },
      };
      const res = await request(app)
        .post('/api/techniques')
        .send(body)
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(201);

      technique = res.body;
      expect(technique.stix.x_mitre_is_subtechnique).toBe(false);
    });

    it('converts the technique to a subtechnique', async function () {
      const res = await request(app)
        .post(`/api/techniques/${technique.stix.id}/convert-to-subtechnique`)
        .send({ parentTechniqueAttackId: parentTechnique.workspace.attack_id })
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(200)
        .expect('Content-Type', /json/);

      const body = res.body;

      // WorkflowResult envelope
      expect(body.workflow).toBe('convert-to-subtechnique');
      expect(body.primary).toBeDefined();
      expect(body.sideEffects).toBeDefined();

      const converted = body.primary;

      // Same STIX ID, new version
      expect(converted.stix.id).toBe(technique.stix.id);
      expect(converted.stix.modified).not.toBe(technique.stix.modified);

      // Subtechnique fields
      expect(converted.stix.x_mitre_is_subtechnique).toBe(true);
      expect(converted.workspace.attack_id).toMatch(
        new RegExp(`^${parentTechnique.workspace.attack_id}\\.\\d{3}$`),
      );

      // External reference updated
      const attackRef = converted.stix.external_references.find(
        (ref) => ref.source_name === 'mitre-attack',
      );
      expect(attackRef).toBeDefined();
      expect(attackRef.external_id).toBe(converted.workspace.attack_id);
      expect(attackRef.url).toContain('/techniques/');

      // Side effect: subtechnique-of relationship was created
      expect(body.sideEffects.created.length).toBe(1);
      const createdRel = body.sideEffects.created[0];
      expect(createdRel.stix.relationship_type).toBe('subtechnique-of');
      expect(createdRel.stix.source_ref).toBe(technique.stix.id);
      expect(createdRel.stix.target_ref).toBe(parentTechnique.stix.id);
    });

    it('returns 400 when technique is already a subtechnique', async function () {
      await request(app)
        .post(`/api/techniques/${technique.stix.id}/convert-to-subtechnique`)
        .send({ parentTechniqueAttackId: parentTechnique.workspace.attack_id })
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(400);
    });

    it('returns 400 when parentTechniqueAttackId is missing', async function () {
      await request(app)
        .post(`/api/techniques/${technique.stix.id}/convert-to-subtechnique`)
        .send({})
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(400);
    });

    it('returns 400 when parentTechniqueAttackId has invalid format', async function () {
      await request(app)
        .post(`/api/techniques/${technique.stix.id}/convert-to-subtechnique`)
        .send({ parentTechniqueAttackId: 'INVALID' })
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(400);
    });

    it('returns 400 when parentTechniqueAttackId does not exist', async function () {
      // T9999 has valid format but no technique with this ATT&CK ID exists
      await request(app)
        .post(`/api/techniques/${technique.stix.id}/convert-to-subtechnique`)
        .send({ parentTechniqueAttackId: 'T9999' })
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(400);
    });

    it('returns 404 for non-existent stixId', async function () {
      await request(app)
        .post('/api/techniques/attack-pattern--does-not-exist/convert-to-subtechnique')
        .send({ parentTechniqueAttackId: parentTechnique.workspace.attack_id })
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(404);
    });
  });

  // =============================================
  // Convert subtechnique → technique
  // =============================================
  describe('POST /api/techniques/:stixId/convert-to-technique', function () {
    let parentTechnique;
    let subtechnique;

    it('creates a parent technique', async function () {
      const timestamp = new Date().toISOString();
      const body = {
        ...baseTechniqueData,
        stix: {
          ...baseTechniqueData.stix,
          name: 'parent-for-sub',
          created: timestamp,
          modified: timestamp,
        },
      };
      const res = await request(app)
        .post('/api/techniques')
        .send(body)
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(201);

      parentTechnique = res.body;
    });

    it('creates a subtechnique', async function () {
      const timestamp = new Date().toISOString();
      const body = {
        ...baseTechniqueData,
        stix: {
          ...baseTechniqueData.stix,
          name: 'subtechnique-to-convert',
          x_mitre_is_subtechnique: true,
          created: timestamp,
          modified: timestamp,
        },
      };
      const res = await request(app)
        .post(`/api/techniques?parentTechniqueId=${parentTechnique.workspace.attack_id}`)
        .send(body)
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(201);

      subtechnique = res.body;
      expect(subtechnique.stix.x_mitre_is_subtechnique).toBe(true);
      expect(subtechnique.workspace.attack_id).toContain('.');
    });

    it('creates a subtechnique-of relationship', async function () {
      const timestamp = new Date().toISOString();
      const relBody = {
        workspace: { workflow: { state: 'work-in-progress' } },
        stix: {
          spec_version: '2.1',
          type: 'relationship',
          relationship_type: 'subtechnique-of',
          source_ref: subtechnique.stix.id,
          target_ref: parentTechnique.stix.id,
          created: timestamp,
          modified: timestamp,
          created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
          object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
        },
      };
      const res = await request(app)
        .post('/api/relationships')
        .send(relBody)
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(201);

      expect(res.body.stix.relationship_type).toBe('subtechnique-of');
    });

    it('converts the subtechnique to a technique', async function () {
      const res = await request(app)
        .post(`/api/techniques/${subtechnique.stix.id}/convert-to-technique`)
        .send({})
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(200)
        .expect('Content-Type', /json/);

      const body = res.body;

      // WorkflowResult envelope
      expect(body.workflow).toBe('convert-to-technique');
      expect(body.primary).toBeDefined();
      expect(body.sideEffects).toBeDefined();

      const converted = body.primary;

      // Same STIX ID, new version
      expect(converted.stix.id).toBe(subtechnique.stix.id);
      expect(converted.stix.modified).not.toBe(subtechnique.stix.modified);

      // Technique fields
      expect(converted.stix.x_mitre_is_subtechnique).toBe(false);
      expect(converted.workspace.attack_id).toMatch(/^T\d{4}$/);
      expect(converted.workspace.attack_id).not.toContain('.');

      // External reference updated
      const attackRef = converted.stix.external_references.find(
        (ref) => ref.source_name === 'mitre-attack',
      );
      expect(attackRef).toBeDefined();
      expect(attackRef.external_id).toBe(converted.workspace.attack_id);
      expect(attackRef.url).toMatch(/\/techniques\/T\d{4}$/);

      // Side effect: subtechnique-of relationship was deprecated
      expect(body.sideEffects.deprecated.length).toBeGreaterThan(0);
      const deprecatedRel = body.sideEffects.deprecated[0];
      expect(deprecatedRel.stix.relationship_type).toBe('subtechnique-of');
      expect(deprecatedRel.stix.x_mitre_deprecated).toBe(true);
    });

    it('returns 400 when technique is not a subtechnique', async function () {
      // The subtechnique was just converted to a technique, so trying again should fail
      await request(app)
        .post(`/api/techniques/${subtechnique.stix.id}/convert-to-technique`)
        .send({})
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(400);
    });

    it('returns 404 for non-existent stixId', async function () {
      await request(app)
        .post('/api/techniques/attack-pattern--does-not-exist/convert-to-technique')
        .send({})
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(404);
    });
  });

  // =============================================
  // Block conversion when technique has child subtechniques
  // =============================================
  describe('Block convert-to-subtechnique when technique has children', function () {
    let parentTechnique;
    let childSubtechnique;
    let wouldBeParent;

    it('creates a parent technique', async function () {
      const timestamp = new Date().toISOString();
      const body = {
        ...baseTechniqueData,
        stix: {
          ...baseTechniqueData.stix,
          name: 'parent-with-children',
          created: timestamp,
          modified: timestamp,
        },
      };
      const res = await request(app)
        .post('/api/techniques')
        .send(body)
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(201);

      parentTechnique = res.body;
    });

    it('creates a would-be parent technique for the conversion attempt', async function () {
      const timestamp = new Date().toISOString();
      const body = {
        ...baseTechniqueData,
        stix: {
          ...baseTechniqueData.stix,
          name: 'would-be-parent',
          created: timestamp,
          modified: timestamp,
        },
      };
      const res = await request(app)
        .post('/api/techniques')
        .send(body)
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(201);

      wouldBeParent = res.body;
    });

    it('creates a child subtechnique', async function () {
      const timestamp = new Date().toISOString();
      const body = {
        ...baseTechniqueData,
        stix: {
          ...baseTechniqueData.stix,
          name: 'child-subtechnique',
          x_mitre_is_subtechnique: true,
          created: timestamp,
          modified: timestamp,
        },
      };
      const res = await request(app)
        .post(`/api/techniques?parentTechniqueId=${parentTechnique.workspace.attack_id}`)
        .send(body)
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(201);

      childSubtechnique = res.body;
    });

    it('creates a subtechnique-of relationship from child to parent', async function () {
      const timestamp = new Date().toISOString();
      const relBody = {
        workspace: { workflow: { state: 'work-in-progress' } },
        stix: {
          spec_version: '2.1',
          type: 'relationship',
          relationship_type: 'subtechnique-of',
          source_ref: childSubtechnique.stix.id,
          target_ref: parentTechnique.stix.id,
          created: timestamp,
          modified: timestamp,
          created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
          object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
        },
      };
      await request(app)
        .post('/api/relationships')
        .send(relBody)
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(201);
    });

    it('returns 400 when trying to convert a parent technique that has subtechniques', async function () {
      const res = await request(app)
        .post(`/api/techniques/${parentTechnique.stix.id}/convert-to-subtechnique`)
        .send({ parentTechniqueAttackId: wouldBeParent.workspace.attack_id })
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(400);

      expect(res.body.details).toContain('subtechnique');
      expect(res.body.details).toContain('Rehome');
    });
  });

  // =============================================
  // x_mitre_is_subtechnique is preserved on update
  // =============================================
  describe('PUT preserves x_mitre_is_subtechnique', function () {
    let technique;

    it('creates a technique', async function () {
      const timestamp = new Date().toISOString();
      const body = {
        ...baseTechniqueData,
        stix: {
          ...baseTechniqueData.stix,
          name: 'immutable-subtech-field',
          created: timestamp,
          modified: timestamp,
        },
      };
      const res = await request(app)
        .post('/api/techniques')
        .send(body)
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(201);

      technique = res.body;
      expect(technique.stix.x_mitre_is_subtechnique).toBe(false);
    });

    it('update ignores attempt to change x_mitre_is_subtechnique', async function () {
      const updateBody = {
        ...technique,
        stix: {
          ...technique.stix,
          x_mitre_is_subtechnique: true, // attempt to change
          description: 'Updated description',
        },
      };

      const res = await request(app)
        .put(`/api/techniques/${technique.stix.id}/modified/${technique.stix.modified}`)
        .send(updateBody)
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(200);

      // The field should remain false
      expect(res.body.stix.x_mitre_is_subtechnique).toBe(false);
      // But the description should have been updated
      expect(res.body.stix.description).toBe('Updated description');
    });
  });

  // =============================================
  // Revoked technique cannot be converted
  // =============================================
  describe('Revoked techniques cannot be converted', function () {
    let techniqueA;
    let techniqueB;

    it('creates two techniques', async function () {
      const timestamp1 = new Date().toISOString();
      const body1 = {
        ...baseTechniqueData,
        stix: {
          ...baseTechniqueData.stix,
          name: 'revoked-convert-A',
          created: timestamp1,
          modified: timestamp1,
        },
      };
      const res1 = await request(app)
        .post('/api/techniques')
        .send(body1)
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(201);
      techniqueA = res1.body;

      const timestamp2 = new Date().toISOString();
      const body2 = {
        ...baseTechniqueData,
        stix: {
          ...baseTechniqueData.stix,
          name: 'revoked-convert-B',
          created: timestamp2,
          modified: timestamp2,
        },
      };
      const res2 = await request(app)
        .post('/api/techniques')
        .send(body2)
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(201);
      techniqueB = res2.body;
    });

    it('revokes technique A', async function () {
      await request(app)
        .post(`/api/techniques/${techniqueA.stix.id}/revoke`)
        .send({
          revoking: { stixId: techniqueB.stix.id, modified: techniqueB.stix.modified },
        })
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(200);
    });

    it('returns 400 when trying to convert a revoked technique to subtechnique', async function () {
      await request(app)
        .post(`/api/techniques/${techniqueA.stix.id}/convert-to-subtechnique`)
        .send({ parentTechniqueAttackId: techniqueB.workspace.attack_id })
        .set('Accept', 'application/json')
        .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
        .expect(400);
    });
  });

  after(async function () {
    await database.closeConnection();
  });
});
