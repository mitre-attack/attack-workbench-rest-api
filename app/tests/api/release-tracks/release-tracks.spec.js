const request = require('supertest');
const { expect } = require('expect');

const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');

const logger = require('../../../lib/logger');
logger.level = 'debug';

function buildTechnique(name, description) {
  const timestamp = new Date().toISOString();
  return {
    workspace: {
      workflow: {
        state: 'work-in-progress',
      },
    },
    stix: {
      created: timestamp,
      modified: timestamp,
      name,
      description,
      spec_version: '2.1',
      type: 'attack-pattern',
      object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
      created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
      kill_chain_phases: [{ kill_chain_name: 'kill-chain-name-1', phase_name: 'phase-1' }],
      x_mitre_is_subtechnique: false,
      x_mitre_platforms: ['platform-1'],
    },
  };
}

describe('Release Tracks API', function () {
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

  async function createTechnique(name, description) {
    const res = await request(app)
      .post('/api/techniques')
      .send(buildTechnique(name, description))
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    return res.body;
  }

  it('GET /api/release-tracks includes latest tier count summaries', async function () {
    const memberObject = await createTechnique('Member Technique', 'Member description');
    const candidateObject = await createTechnique('Candidate Technique', 'Candidate description');
    const stagedObject = await createTechnique('Staged Technique', 'Staged description');

    const createRes = await request(app)
      .post('/api/release-tracks/new')
      .send({
        name: 'Enterprise Test',
        description: 'Release track summary test',
        type: 'standard',
      })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    const trackId = createRes.body.id;

    await request(app)
      .post(`/api/release-tracks/${trackId}/contents`)
      .send({
        x_mitre_contents: [
          {
            obj_ref: memberObject.stix.id,
            obj_modified: memberObject.stix.modified,
          },
        ],
      })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    await request(app)
      .post(`/api/release-tracks/${trackId}/candidates`)
      .send({
        object_refs: [
          {
            id: candidateObject.stix.id,
            modified: candidateObject.stix.modified,
          },
          {
            id: stagedObject.stix.id,
            modified: stagedObject.stix.modified,
          },
        ],
      })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    await request(app)
      .post(`/api/release-tracks/${trackId}/candidates/promote`)
      .send({
        object_refs: [stagedObject.stix.id],
      })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const listRes = await request(app)
      .get('/api/release-tracks')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const track = listRes.body.data.find((entry) => entry.track_id === trackId);
    expect(track).toBeDefined();
    expect(track.summary).toEqual({
      members_count: 1,
      staged_count: 1,
      candidates_count: 1,
    });

    const latestRes = await request(app)
      .get(`/api/release-tracks/${trackId}`)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    const candidate = latestRes.body.candidates.find(
      (entry) => entry.object_ref === candidateObject.stix.id,
    );
    expect(candidate).toMatchObject({
      attack_id: candidateObject.workspace.attack_id,
      name: candidateObject.stix.name,
      description: candidateObject.stix.description,
      modified_by_user: {
        username: 'anonymous',
        displayName: 'Anonymous User',
        name: 'Anonymous User',
      },
    });

    const staged = latestRes.body.staged.find((entry) => entry.object_ref === stagedObject.stix.id);
    expect(staged).toMatchObject({
      attack_id: stagedObject.workspace.attack_id,
      name: stagedObject.stix.name,
      description: stagedObject.stix.description,
      modified_by_user: {
        username: 'anonymous',
        displayName: 'Anonymous User',
        name: 'Anonymous User',
      },
    });
  });

  after(async function () {
    await database.closeConnection();
  });
});
