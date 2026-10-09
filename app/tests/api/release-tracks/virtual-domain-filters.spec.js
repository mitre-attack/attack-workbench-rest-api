const request = require('supertest');
const { expect } = require('expect');

const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const { cloneForCreate } = require('../../shared/clone-for-create');
const { releaseExactMembers } = require('./release-track-test-helpers');
const modelFactory = require('../../../models/release-tracks/model-factory');
const virtualTrackService = require('../../../services/release-tracks/virtual-track-service');

const staticMarkingDefinitionId = 'marking-definition--613f2e26-407d-48c7-9eca-b8e91df99dc9';

describe('Virtual Release Track Domain Filters API', function () {
  let app;
  let passportCookie;
  let tacticId;

  before(async function () {
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();

    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;

    app = await require('../../../index').initializeApp();
    passportCookie = await login.loginAnonymous(app);
    const tactic = await post('/api/tactics', {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        type: 'x-mitre-tactic',
        spec_version: '2.1',
        name: 'Initial Access',
        x_mitre_shortname: 'initial-access',
      },
    });
    tacticId = tactic.stix.id;
  });

  async function post(path, body, status = 201) {
    const response = await request(app)
      .post(path)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(status);
    return response.body;
  }

  function buildMitigation(name, domains) {
    const timestamp = new Date().toISOString();
    return {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        created: timestamp,
        modified: timestamp,
        name,
        description: `${name} description`,
        spec_version: '2.1',
        type: 'course-of-action',
        labels: ['test'],
        x_mitre_version: '1.0',
        x_mitre_domains: domains,
        object_marking_refs: [staticMarkingDefinitionId],
      },
    };
  }

  function buildMatrix(name, externalDomain) {
    const timestamp = new Date().toISOString();
    return {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        created: timestamp,
        modified: timestamp,
        name,
        description: `${name} description`,
        spec_version: '2.1',
        type: 'x-mitre-matrix',
        external_references: [{ source_name: 'test-source', external_id: externalDomain }],
        object_marking_refs: [staticMarkingDefinitionId],
        x_mitre_version: '1.0',
        x_mitre_domains: ['enterprise-attack'],
        tactic_refs: [tacticId],
      },
    };
  }

  async function createVirtual(name, componentTrackId, domains) {
    return post('/api/release-tracks/new', {
      name,
      type: 'virtual',
      composition: {
        component_tracks: [
          {
            track_id: componentTrackId,
            resolution_strategy: 'latest_tagged',
            priority: 0,
            filters: { domains },
          },
        ],
        deduplication: { strategy: 'prioritize_latest_object' },
      },
    });
  }

  async function createVirtualSnapshot(name, componentTrackId, domains) {
    const virtual = await createVirtual(name, componentTrackId, domains);
    return post(`/api/release-tracks/${virtual.id}/virtual/snapshots/create`, {});
  }

  it('includes exact pinned revisions when any canonical ATT&CK domain matches', async function () {
    const enterprise = await post(
      '/api/mitigations',
      buildMitigation('Enterprise Domain Member', ['enterprise-attack']),
    );
    const ics = await post(
      '/api/mitigations',
      buildMitigation('ICS Domain Member', ['ics-attack']),
    );
    const shared = await post(
      '/api/mitigations',
      buildMitigation('Shared Domain Member', ['enterprise-attack', 'mobile-attack']),
    );
    const mobile = await post(
      '/api/mitigations',
      buildMitigation('Mobile Domain Member', ['mobile-attack']),
    );
    const noDomain = await post('/api/mitigations', buildMitigation('No Domain Member', undefined));
    const enterpriseMatrix = await post(
      '/api/matrices',
      buildMatrix('Enterprise Matrix', 'enterprise-attack'),
    );

    const component = await post('/api/release-tracks/new', {
      name: 'Domain Filter Component',
      type: 'standard',
    });
    await releaseExactMembers(app, passportCookie, component.id, [
      enterprise,
      ics,
      shared,
      mobile,
      enterpriseMatrix,
    ]);
    // Simulate a legacy member that predates reviewed-state admission. It must
    // remain domainless so domain filtering, not admission, excludes it.
    await modelFactory.getModel(component.id).collection.updateOne(
      { id: component.id, version: '1.0' },
      {
        $push: {
          members: {
            object_ref: noDomain.stix.id,
            object_modified: new Date(noDomain.stix.modified),
          },
        },
      },
    );

    // A newer revision has a different domain, but virtual composition must
    // evaluate the exact revision pinned in the tagged component snapshot.
    const newerEnterpriseRevision = cloneForCreate(enterprise);
    newerEnterpriseRevision.stix.modified = new Date(Date.now() + 1000).toISOString();
    newerEnterpriseRevision.stix.x_mitre_domains = ['ics-attack'];
    await post('/api/mitigations', newerEnterpriseRevision);

    const enterpriseSnapshot = await createVirtualSnapshot(
      'Enterprise Domain Virtual',
      component.id,
      ['enterprise'],
    );
    const enterpriseIds = enterpriseSnapshot.members.map((member) => member.object_ref);
    expect(enterpriseIds).toEqual(
      expect.arrayContaining([enterprise.stix.id, shared.stix.id, enterpriseMatrix.stix.id]),
    );
    expect(enterpriseIds).not.toContain(ics.stix.id);
    expect(enterpriseIds).not.toContain(mobile.stix.id);
    expect(enterpriseIds).not.toContain(noDomain.stix.id);

    const icsSnapshot = await createVirtualSnapshot('ICS Domain Virtual', component.id, [
      'ics-attack',
    ]);
    const icsIds = icsSnapshot.members.map((member) => member.object_ref);
    expect(icsIds).toEqual(expect.arrayContaining([ics.stix.id]));
    expect(icsIds).not.toContain(shared.stix.id);
    expect(icsIds).not.toContain(enterprise.stix.id);
    expect(icsIds).not.toContain(enterpriseMatrix.stix.id);
    expect(icsIds).not.toContain(noDomain.stix.id);

    const mobileSnapshot = await createVirtualSnapshot('Mobile Domain Virtual', component.id, [
      'mobile',
    ]);
    const mobileIds = mobileSnapshot.members.map((member) => member.object_ref);
    expect(mobileIds).toEqual(expect.arrayContaining([mobile.stix.id, shared.stix.id]));
    expect(mobileIds).not.toContain(enterprise.stix.id);
    expect(mobileIds).not.toContain(ics.stix.id);
  });

  it('selects a legacy domainless matrix by fallback but rejects its new admission', async function () {
    const matrixData = buildMatrix('Domainless Enterprise Matrix', 'enterprise-attack');
    delete matrixData.stix.x_mitre_domains;
    const matrix = await post('/api/matrices', matrixData);
    const component = await post('/api/release-tracks/new', {
      name: 'Legacy Matrix Domain Component',
      type: 'standard',
    });
    await post(
      `/api/release-tracks/${component.id}/snapshots/latest/release`,
      { version: '1.0' },
      200,
    );
    // Install old membership directly: current admission must not accept this
    // deliberately incomplete matrix merely to exercise its domain fallback.
    await modelFactory.getModel(component.id).collection.updateOne(
      { id: component.id, version: '1.0' },
      {
        $push: {
          members: {
            object_ref: matrix.stix.id,
            object_modified: new Date(matrix.stix.modified),
          },
        },
      },
    );

    const enterprise = await createVirtual('Legacy Matrix Enterprise Virtual', component.id, [
      'enterprise',
    ]);
    await expect(virtualTrackService.createVirtualSnapshot(enterprise.id)).rejects.toMatchObject({
      message: 'ADM validation failed',
      details: [
        expect.objectContaining({
          object_ref: matrix.stix.id,
          object_modified: matrix.stix.modified,
          path: ['x_mitre_domains'],
        }),
      ],
    });

    const ics = await createVirtualSnapshot('Legacy Matrix ICS Virtual', component.id, ['ics']);
    expect(ics.members).toEqual([]);
  });

  after(async function () {
    await database.closeConnection();
  });
});
