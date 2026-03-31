const request = require('supertest');
const { expect } = require('expect');

const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');

const config = require('../../../config/config');
const login = require('../../shared/login');
const { cloneForCreate } = require('../../shared/clone-for-create');

const logger = require('../../../lib/logger');
logger.level = 'debug';

const initialObjectData = {
  workspace: {
    workflow: {
      state: 'work-in-progress',
    },
  },
  stix: {
    name: 'revoke-test-technique',
    spec_version: '2.1',
    type: 'attack-pattern',
    description: 'This technique will be revoked.',
    object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
    created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
    kill_chain_phases: [{ kill_chain_name: 'kill-chain-name-1', phase_name: 'phase-1' }],
    x_mitre_is_subtechnique: false,
    x_mitre_platforms: ['platform-1'],
  },
};

describe('Techniques Revoke API', function () {
  let app;
  let passportCookie;

  before(async function () {
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();

    config.validateRequests.withAttackDataModel = false;
    config.validateRequests.withOpenApi = true;

    app = await require('../../../index').initializeApp();
    passportCookie = await login.loginAnonymous(app);
  });

  let techniqueA;
  let techniqueB;

  it('POST /api/techniques creates technique A (to be revoked)', async function () {
    const timestamp = new Date().toISOString();
    const body = {
      ...initialObjectData,
      stix: {
        ...initialObjectData.stix,
        name: 'technique-A',
        created: timestamp,
        modified: timestamp,
      },
    };
    const res = await request(app)
      .post('/api/techniques')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    techniqueA = res.body;
    expect(techniqueA.stix.id).toBeDefined();
  });

  it('POST /api/techniques creates technique B (the replacement)', async function () {
    const timestamp = new Date().toISOString();
    const body = {
      ...initialObjectData,
      stix: {
        ...initialObjectData.stix,
        name: 'technique-B',
        created: timestamp,
        modified: timestamp,
      },
    };
    const res = await request(app)
      .post('/api/techniques')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    techniqueB = res.body;
    expect(techniqueB.stix.id).toBeDefined();
  });

  it('POST /api/techniques/:stixId/revoke returns 400 for self-revocation', async function () {
    const res = await request(app)
      .post(`/api/techniques/${techniqueA.stix.id}/revoke`)
      .send({
        revoking: { stixId: techniqueA.stix.id, modified: techniqueA.stix.modified },
      })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(400);

    expect(res.body.message || res.text).toBeDefined();
  });

  it('POST /api/techniques/:stixId/revoke returns 404 for cross-type revocation (object B not in techniques collection)', async function () {
    // Create a tactic (different type) and try to use it as the revoking object.
    // Since each type has its own repository, the tactic won't be found in the
    // techniques collection, resulting in a 404.
    const timestamp = new Date().toISOString();
    const tacticBody = {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        name: 'tactic-cross-type',
        spec_version: '2.1',
        type: 'x-mitre-tactic',
        description: 'A tactic.',
        x_mitre_shortname: 'cross-type-test',
        object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
        created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
        created: timestamp,
        modified: timestamp,
      },
    };
    const tacticRes = await request(app)
      .post('/api/tactics')
      .send(tacticBody)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201);
    const tactic = tacticRes.body;

    await request(app)
      .post(`/api/techniques/${techniqueA.stix.id}/revoke`)
      .send({
        revoking: { stixId: tactic.stix.id, modified: tactic.stix.modified },
      })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(404);
  });

  it('POST /api/techniques/:stixId/revoke returns 404 when object A is not found', async function () {
    await request(app)
      .post('/api/techniques/attack-pattern--00000000-0000-0000-0000-000000000000/revoke')
      .send({
        revoking: { stixId: techniqueB.stix.id, modified: techniqueB.stix.modified },
      })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(404);
  });

  it('POST /api/techniques/:stixId/revoke returns 404 when object B is not found', async function () {
    await request(app)
      .post(`/api/techniques/${techniqueA.stix.id}/revoke`)
      .send({
        revoking: {
          stixId: 'attack-pattern--00000000-0000-0000-0000-000000000000',
          modified: '2026-01-01T00:00:00.000Z',
        },
      })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(404);
  });

  it('POST /api/techniques/:stixId/revoke returns 400 when revoking.stixId is missing', async function () {
    await request(app)
      .post(`/api/techniques/${techniqueA.stix.id}/revoke`)
      .send({ revoking: { modified: '2026-01-01T00:00:00.000Z' } })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(400);
  });

  it('POST /api/techniques/:stixId/revoke returns 400 when revoking.modified is missing', async function () {
    await request(app)
      .post(`/api/techniques/${techniqueA.stix.id}/revoke`)
      .send({ revoking: { stixId: techniqueB.stix.id } })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(400);
  });

  let revokeResult;
  it('POST /api/techniques/:stixId/revoke revokes technique A in favor of technique B', async function () {
    const res = await request(app)
      .post(`/api/techniques/${techniqueA.stix.id}/revoke`)
      .send({
        revoking: { stixId: techniqueB.stix.id, modified: techniqueB.stix.modified },
      })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    revokeResult = res.body;

    // Verify the response structure
    expect(revokeResult.revokedObject).toBeDefined();
    expect(revokeResult.revokedByRelationship).toBeDefined();
    expect(revokeResult.relationshipsSummary).toBeDefined();

    // Verify the revoked object
    expect(revokeResult.revokedObject.stix.id).toBe(techniqueA.stix.id);
    expect(revokeResult.revokedObject.stix.revoked).toBe(true);

    // Verify the revoked-by relationship
    expect(revokeResult.revokedByRelationship.stix.relationship_type).toBe('revoked-by');
    expect(revokeResult.revokedByRelationship.stix.source_ref).toBe(techniqueA.stix.id);
    expect(revokeResult.revokedByRelationship.stix.target_ref).toBe(techniqueB.stix.id);
  });

  it('GET /api/techniques/:stixId returns the revoked technique with revoked = true', async function () {
    const res = await request(app)
      .get(`/api/techniques/${techniqueA.stix.id}?versions=latest`)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const techniques = res.body;
    expect(techniques).toBeDefined();
    expect(techniques.length).toBe(1);
    expect(techniques[0].stix.revoked).toBe(true);
  });

  it('GET /api/techniques excludes the revoked technique by default', async function () {
    const res = await request(app)
      .get('/api/techniques')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const techniques = res.body;
    const revokedIds = techniques.map((t) => t.stix.id);
    expect(revokedIds).not.toContain(techniqueA.stix.id);
  });

  it('GET /api/techniques?includeRevoked=true includes the revoked technique', async function () {
    const res = await request(app)
      .get('/api/techniques?includeRevoked=true')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const techniques = res.body;
    const ids = techniques.map((t) => t.stix.id);
    expect(ids).toContain(techniqueA.stix.id);
  });

  it('POST /api/techniques/:stixId/revoke returns 409 when object A is already revoked', async function () {
    await request(app)
      .post(`/api/techniques/${techniqueA.stix.id}/revoke`)
      .send({
        revoking: { stixId: techniqueB.stix.id, modified: techniqueB.stix.modified },
      })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(409);
  });

  it('POST /api/techniques strips revoked from create requests', async function () {
    const timestamp = new Date().toISOString();
    const body = {
      ...initialObjectData,
      stix: {
        ...initialObjectData.stix,
        name: 'sneaky-revoke-attempt',
        created: timestamp,
        modified: timestamp,
        revoked: true,
      },
    };
    const res = await request(app)
      .post('/api/techniques')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // The revoked flag should have been stripped
    expect(res.body.stix.revoked).not.toBe(true);
  });

  it('PUT /api/techniques strips revoked from update requests', async function () {
    const updateData = cloneForCreate(techniqueB);
    updateData.stix.revoked = true;
    updateData.stix.description = 'Trying to sneak in revoked via update.';

    const res = await request(app)
      .put(`/api/techniques/${techniqueB.stix.id}/modified/${techniqueB.stix.modified}`)
      .send(updateData)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // The revoked flag should have been stripped, description updated
    expect(res.body.stix.revoked).not.toBe(true);
    expect(res.body.stix.description).toBe('Trying to sneak in revoked via update.');
  });

  it('POST /api/techniques/:stixId/revoke with preserveRelationships transfers relationships', async function () {
    // Create two new techniques: C (to be revoked) and D (replacement)
    let timestamp = new Date().toISOString();
    const bodyC = {
      ...initialObjectData,
      stix: {
        ...initialObjectData.stix,
        name: 'technique-C',
        created: timestamp,
        modified: timestamp,
      },
    };
    const resC = await request(app)
      .post('/api/techniques')
      .send(bodyC)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201);
    const techniqueC = resC.body;

    timestamp = new Date().toISOString();
    const bodyD = {
      ...initialObjectData,
      stix: {
        ...initialObjectData.stix,
        name: 'technique-D',
        created: timestamp,
        modified: timestamp,
      },
    };
    const resD = await request(app)
      .post('/api/techniques')
      .send(bodyD)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201);
    const techniqueD = resD.body;

    // Create a relationship involving technique C
    timestamp = new Date().toISOString();
    const relBody = {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        type: 'relationship',
        spec_version: '2.1',
        relationship_type: 'uses',
        source_ref: techniqueC.stix.id,
        target_ref: techniqueB.stix.id,
        created: timestamp,
        modified: timestamp,
      },
    };
    const relRes = await request(app)
      .post('/api/relationships')
      .send(relBody)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201);
    const originalRel = relRes.body;

    // Revoke technique C with preserveRelationships=true
    const revokeRes = await request(app)
      .post(`/api/techniques/${techniqueC.stix.id}/revoke?preserveRelationships=true`)
      .send({
        revoking: { stixId: techniqueD.stix.id, modified: techniqueD.stix.modified },
      })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const result = revokeRes.body;
    expect(result.relationshipsSummary.transferred).toBe(1);
    expect(result.relationshipsSummary.deprecated).toBeGreaterThanOrEqual(1);

    // Verify the original relationship was deprecated (not deleted — history preserved)
    const relRes2 = await request(app)
      .get(`/api/relationships/${originalRel.stix.id}?versions=latest`)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200);

    const deprecatedRels = relRes2.body;
    expect(deprecatedRels.length).toBe(1);
    expect(deprecatedRels[0].stix.x_mitre_deprecated).toBe(true);

    // Verify a new relationship was created pointing to technique D
    const allRelsRes = await request(app)
      .get(`/api/relationships?sourceRef=${techniqueD.stix.id}`)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200);

    const transferredRels = allRelsRes.body.filter(
      (r) => r.stix.relationship_type === 'uses' && r.stix.target_ref === techniqueB.stix.id,
    );
    expect(transferredRels.length).toBe(1);
  });

  it('POST /api/techniques/:stixId/revoke with preserveRelationships skips duplicate relationships', async function () {
    // Create technique E (to be revoked) and technique F (replacement)
    let timestamp = new Date().toISOString();
    const bodyE = {
      ...initialObjectData,
      stix: {
        ...initialObjectData.stix,
        name: 'technique-E',
        created: timestamp,
        modified: timestamp,
      },
    };
    const resE = await request(app)
      .post('/api/techniques')
      .send(bodyE)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201);
    const techniqueE = resE.body;

    timestamp = new Date().toISOString();
    const bodyF = {
      ...initialObjectData,
      stix: {
        ...initialObjectData.stix,
        name: 'technique-F',
        created: timestamp,
        modified: timestamp,
      },
    };
    const resF = await request(app)
      .post('/api/techniques')
      .send(bodyF)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201);
    const techniqueF = resF.body;

    // Create mitigation M1
    timestamp = new Date().toISOString();
    const bodyM = {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        name: 'mitigation-dedup-test',
        spec_version: '2.1',
        type: 'course-of-action',
        description: 'Mitigates both E and F.',
        created: timestamp,
        modified: timestamp,
      },
    };
    const resM = await request(app)
      .post('/api/mitigations')
      .send(bodyM)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201);
    const mitigationM = resM.body;

    // Create "mitigates" relationship M1 → E
    timestamp = new Date().toISOString();
    const relME = {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        type: 'relationship',
        spec_version: '2.1',
        relationship_type: 'mitigates',
        source_ref: mitigationM.stix.id,
        target_ref: techniqueE.stix.id,
        created: timestamp,
        modified: timestamp,
      },
    };
    await request(app)
      .post('/api/relationships')
      .send(relME)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201);

    // Create "mitigates" relationship M1 → F (pre-existing duplicate)
    timestamp = new Date().toISOString();
    const relMF = {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        type: 'relationship',
        spec_version: '2.1',
        relationship_type: 'mitigates',
        source_ref: mitigationM.stix.id,
        target_ref: techniqueF.stix.id,
        created: timestamp,
        modified: timestamp,
      },
    };
    const resRelMF = await request(app)
      .post('/api/relationships')
      .send(relMF)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201);
    const preExistingRel = resRelMF.body;

    // Revoke technique E in favor of technique F with preserveRelationships=true
    const revokeRes = await request(app)
      .post(`/api/techniques/${techniqueE.stix.id}/revoke?preserveRelationships=true`)
      .send({
        revoking: { stixId: techniqueF.stix.id, modified: techniqueF.stix.modified },
      })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const result = revokeRes.body;

    // The duplicate should have been skipped, not transferred
    expect(result.relationshipsSummary.transferred).toBe(0);
    expect(result.relationshipsSummary.duplicatesSkipped).toBe(1);

    // Verify exactly one "mitigates" relationship exists from M1 → F (the pre-existing one)
    const relsRes = await request(app)
      .get(`/api/relationships?sourceRef=${mitigationM.stix.id}&targetRef=${techniqueF.stix.id}`)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200);

    const mitigatesRels = relsRes.body.filter((r) => r.stix.relationship_type === 'mitigates');
    expect(mitigatesRels.length).toBe(1);
    expect(mitigatesRels[0].stix.id).toBe(preExistingRel.stix.id);

    // Verify the original M1 → E relationship was deprecated (not deleted — history preserved)
    const origRes = await request(app)
      .get(
        `/api/relationships?sourceRef=${mitigationM.stix.id}&targetRef=${techniqueE.stix.id}&includeDeprecated=true`,
      )
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200);

    const oldMitigatesRels = origRes.body.filter((r) => r.stix.relationship_type === 'mitigates');
    expect(oldMitigatesRels.length).toBe(1);
    expect(oldMitigatesRels[0].stix.x_mitre_deprecated).toBe(true);

    // Verify it's excluded from default queries (without includeDeprecated)
    const defaultRes = await request(app)
      .get(`/api/relationships?sourceRef=${mitigationM.stix.id}&targetRef=${techniqueE.stix.id}`)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200);

    const defaultRels = defaultRes.body.filter((r) => r.stix.relationship_type === 'mitigates');
    expect(defaultRels.length).toBe(0);
  });

  after(async function () {
    await database.closeConnection();
  });
});
