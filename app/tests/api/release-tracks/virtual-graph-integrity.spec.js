'use strict';

const request = require('supertest');
const { expect } = require('expect');

const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const AttackObject = require('../../../models/attack-object-model');
const linkById = require('../../../lib/linkById');
const dynamicRepo = require('../../../repository/release-tracks/release-track-dynamic.repository');
const {
  ReleaseTrackContentManifest,
} = require('../../../models/release-tracks/release-track-content-manifest-model');
const { releaseExactMembers } = require('./release-track-test-helpers');

const staticMarkingDefinitionId = 'marking-definition--613f2e26-407d-48c7-9eca-b8e91df99dc9';

describe('Virtual release-track graph integrity', function () {
  let app;
  let passportCookie;

  before(async function () {
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();
    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;
    app = await require('../../../index').initializeApp();
    passportCookie = await login.loginAnonymous(app);
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

  async function get(path, status = 200) {
    const response = await request(app)
      .get(path)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(status);
    return response.body;
  }

  function technique(name, domains = ['enterprise-attack'], description = `${name} description`) {
    const timestamp = new Date().toISOString();
    return {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        created: timestamp,
        modified: timestamp,
        name,
        description,
        spec_version: '2.1',
        type: 'attack-pattern',
        object_marking_refs: [staticMarkingDefinitionId],
        kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'persistence' }],
        x_mitre_version: '1.0',
        x_mitre_domains: domains,
        x_mitre_is_subtechnique: false,
        x_mitre_platforms: ['Windows'],
      },
    };
  }

  function mitigation(name, domains) {
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
        object_marking_refs: [staticMarkingDefinitionId],
        x_mitre_version: '1.0',
        x_mitre_domains: domains,
      },
    };
  }

  async function createVirtual(name, members, domains = ['enterprise-attack']) {
    const component = await post('/api/release-tracks/new', {
      name: `${name} Component`,
      type: 'standard',
    });
    await releaseExactMembers(app, passportCookie, component.id, members);
    const virtual = await post('/api/release-tracks/new', {
      name,
      type: 'virtual',
      composition: {
        component_tracks: [
          {
            track_id: component.id,
            resolution_strategy: 'latest_tagged',
            priority: 0,
            filters: { domains },
          },
        ],
        deduplication: { strategy: 'prioritize_latest_object' },
      },
    });
    await post(`/api/release-tracks/${virtual.id}/virtual/snapshots/create`, {});
    return virtual;
  }

  it('applies virtual domain constraints to relationship secondary objects', async function () {
    const enterpriseRoot = await post('/api/techniques', technique('Enterprise Graph Root'));
    const mobileSecondary = await post(
      '/api/mitigations',
      mitigation('Mobile Graph Secondary', ['mobile-attack']),
    );
    const relationship = await post('/api/relationships', {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        spec_version: '2.1',
        type: 'relationship',
        relationship_type: 'mitigates',
        source_ref: mobileSecondary.stix.id,
        target_ref: enterpriseRoot.stix.id,
        object_marking_refs: [staticMarkingDefinitionId],
      },
    });
    const virtual = await createVirtual('Enterprise Bounded Graph', [enterpriseRoot]);

    const bundle = await get(`/api/release-tracks/${virtual.id}/snapshots/latest?format=bundle`);
    const ids = bundle.objects.map((object) => object.id);

    expect(ids).toContain(enterpriseRoot.stix.id);
    expect(ids).not.toContain(mobileSecondary.stix.id);
    expect(ids).not.toContain(relationship.stix.id);
  });

  it('does not resolve LinkById through a newer deprecated ATT&CK-ID collision', async function () {
    const activeTarget = await post('/api/techniques', technique('Active Link Target'));
    const attackId = activeTarget.workspace.attack_id;
    const attackReference = activeTarget.stix.external_references.find(
      (reference) => reference.external_id === attackId,
    );
    const deprecatedCollision = await post(
      '/api/mitigations',
      mitigation('Deprecated Collision', ['enterprise-attack']),
    );
    await AttackObject.collection.updateOne(
      { 'stix.id': deprecatedCollision.stix.id },
      {
        $set: {
          'workspace.attack_id': attackId,
          'stix.modified': new Date(Date.now() + 60_000),
          'stix.x_mitre_deprecated': true,
        },
      },
    );
    const selectedTarget = await linkById.getAttackObjectFromDatabase(attackId);
    expect(selectedTarget.stix.id).toBe(activeTarget.stix.id);
    const root = await post(
      '/api/techniques',
      technique('LinkById Root', ['enterprise-attack'], `See (LinkById: ${attackId}).`),
    );
    const virtual = await createVirtual('Virtual Link Target Selection', [root]);

    const bundle = await get(`/api/release-tracks/${virtual.id}/snapshots/latest?format=bundle`);
    const exportedRoot = bundle.objects.find((object) => object.id === root.stix.id);

    expect(exportedRoot.description).toBe(`See [Active Link Target](${attackReference.url}).`);
  });

  it('seals virtual materialization and publishes that manifest unchanged at release', async function () {
    const root = await post('/api/techniques', technique('Frozen Virtual Root'));
    const virtual = await createVirtual('Virtual Frozen Release Graph', [root]);
    const draft = await dynamicRepo.getLatestSnapshot(virtual.id);
    expect(draft.content_manifest_id).toBeDefined();
    const materializationManifest = await ReleaseTrackContentManifest.findOne({
      manifest_id: draft.content_manifest_id,
    })
      .lean()
      .exec();
    expect(materializationManifest.seal_reason).toBe('members_written');

    const preview = await get(
      `/api/release-tracks/${virtual.id}/snapshots/latest/release/preview` +
        '?format=bundle&version=1.0',
    );
    expect(preview.objects.find((object) => object.id === root.stix.id).name).toBe(root.stix.name);

    const releasedResponse = await post(
      `/api/release-tracks/${virtual.id}/snapshots/latest/release`,
      { version: '1.0' },
      200,
    );
    expect(releasedResponse.content_manifest_id).toBe(draft.content_manifest_id);
    expect(releasedResponse.publication).toBeDefined();
    expect(releasedResponse.bundle_id).toMatch(/^bundle--/);
    expect(releasedResponse.bundle_hashes.manifest_id).toBe(draft.content_manifest_id);

    const releasedBundle = await get(
      `/api/release-tracks/${virtual.id}/snapshots/latest?format=bundle`,
    );
    expect(releasedBundle.id).toBe(releasedResponse.bundle_id);
    expect(releasedBundle.objects.find((object) => object.id === root.stix.id).name).toBe(
      root.stix.name,
    );
    expect(releasedBundle.objects[0]).toMatchObject({
      type: 'x-mitre-collection',
      x_mitre_version: '1.0',
    });
  });

  after(async function () {
    await database.closeConnection();
  });
});
