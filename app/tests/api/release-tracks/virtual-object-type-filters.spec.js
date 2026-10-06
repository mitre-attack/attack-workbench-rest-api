'use strict';

const mongoose = require('mongoose');
const request = require('supertest');
const { expect } = require('expect');

const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const types = require('../../../lib/types');
const login = require('../../shared/login');
const { cloneForCreate } = require('../../shared/clone-for-create');
const {
  compositionSchema,
} = require('../../../models/release-tracks/release-track-snapshot-schema');
const releaseTracksService = require('../../../services/release-tracks/release-tracks-service');
const { releaseExactMembers } = require('./release-track-test-helpers');

const staticMarkingDefinitionId = 'marking-definition--613f2e26-407d-48c7-9eca-b8e91df99dc9';
const supportedObjectTypes = Object.values(types);

const compositionBoundarySchema = new mongoose.Schema({
  composition: { type: compositionSchema, required: true },
});
const CompositionBoundary =
  mongoose.models.VirtualObjectTypeFilterCompositionBoundary ||
  mongoose.model('VirtualObjectTypeFilterCompositionBoundary', compositionBoundarySchema);

describe('Virtual release-track object-type filters API', function () {
  let app;
  let passportCookie;
  let componentTrack;
  let virtualTrack;
  let createSequence = 0;

  before(async function () {
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();

    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;

    app = await require('../../../index').initializeApp();
    passportCookie = await login.loginAnonymous(app);

    componentTrack = await post('/api/release-tracks/new', {
      name: 'Object Type Filter Component',
      type: 'standard',
    });
    virtualTrack = await post('/api/release-tracks/new', {
      name: 'Object Type Filter Virtual',
      type: 'virtual',
    });
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

  async function put(path, body, status = 200) {
    const response = await request(app)
      .put(path)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(status);
    return response.body;
  }

  function composition(objectTypes, trackId = componentTrack.id) {
    return {
      component_tracks: [
        {
          track_id: trackId,
          resolution_strategy: 'latest_tagged',
          priority: 0,
          filters: { object_types: objectTypes },
        },
      ],
      deduplication: { strategy: 'prioritize_latest_object' },
    };
  }

  async function createVirtual(compositionBody, status = 201) {
    createSequence += 1;
    return post(
      '/api/release-tracks/new',
      {
        name: `Object Type Filter Create ${createSequence}`,
        type: 'virtual',
        composition: compositionBody,
      },
      status,
    );
  }

  function buildMitigation(name) {
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
        x_mitre_domains: ['enterprise-attack'],
        object_marking_refs: [staticMarkingDefinitionId],
      },
    };
  }

  function buildMatrix(name, tacticId) {
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
        external_references: [{ source_name: 'test-source', external_id: 'enterprise-attack' }],
        object_marking_refs: [staticMarkingDefinitionId],
        x_mitre_version: '1.0',
        x_mitre_domains: ['enterprise-attack'],
        tactic_refs: [tacticId],
      },
    };
  }

  it('accepts the canonical Workbench STIX type vocabulary', async function () {
    const created = await createVirtual(composition(supportedObjectTypes));
    expect(created.composition.component_tracks[0].filters.object_types).toEqual(
      supportedObjectTypes,
    );

    const updated = await put(
      `/api/release-tracks/${virtualTrack.id}/virtual/composition`,
      composition(supportedObjectTypes),
    );
    expect(updated.composition.component_tracks[0].filters.object_types).toEqual(
      supportedObjectTypes,
    );
  });

  it('rejects empty, duplicate, malformed, and unsupported object-type filters', async function () {
    const invalidFilters = [
      [],
      ['attack-pattern', 'attack-pattern'],
      ['Attack-Pattern'],
      ['not-a-workbench-type'],
    ];

    for (const objectTypes of invalidFilters) {
      await createVirtual(composition(objectTypes), 400);
      await put(
        `/api/release-tracks/${virtualTrack.id}/virtual/composition`,
        composition(objectTypes),
        400,
      );
    }
  });

  it('repeats the accepted-value constraint at the persistence boundary', async function () {
    const invalidCompositions = [
      composition(null),
      composition([]),
      composition(['attack-pattern', 'attack-pattern']),
      composition(['not-a-workbench-type']),
    ];

    for (const invalidComposition of invalidCompositions) {
      const boundary = new CompositionBoundary({ composition: invalidComposition });
      await expect(boundary.validate()).rejects.toThrow();
    }
  });

  it('repeats the accepted-value constraint for direct service callers', async function () {
    const invalidComposition = composition(['not-a-workbench-type']);

    await expect(
      releaseTracksService.createTrack({
        name: 'Invalid Service Object Type Filter',
        type: 'virtual',
        composition: invalidComposition,
      }),
    ).rejects.toThrow();

    expect(() =>
      releaseTracksService.updateComposition(virtualTrack.id, invalidComposition),
    ).toThrow();
  });

  it('filters members without replacing the revision pinned by the tagged component', async function () {
    const mitigation = await post('/api/mitigations', buildMitigation('Pinned Type Member'));
    const tactic = await post('/api/tactics', {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        type: 'x-mitre-tactic',
        spec_version: '2.1',
        name: 'Initial Access',
        x_mitre_shortname: 'initial-access',
      },
    });
    const matrix = await post('/api/matrices', buildMatrix('Excluded Type Member', tactic.stix.id));

    await releaseExactMembers(app, passportCookie, componentTrack.id, [mitigation, matrix]);

    const newerMitigationRevision = cloneForCreate(mitigation);
    newerMitigationRevision.stix.modified = new Date(Date.now() + 1000).toISOString();
    newerMitigationRevision.stix.name = 'Newer Unpinned Type Member';
    await post('/api/mitigations', newerMitigationRevision);

    const filteredTrack = await createVirtual(composition(['course-of-action']));
    const materialized = await post(
      `/api/release-tracks/${filteredTrack.id}/virtual/snapshots/create`,
      {},
    );

    expect(materialized.members).toHaveLength(1);
    expect(materialized.members[0].object_ref).toBe(mitigation.stix.id);
    expect(new Date(materialized.members[0].object_modified).toISOString()).toBe(
      mitigation.stix.modified,
    );
    expect(new Date(materialized.members[0].object_modified).toISOString()).not.toBe(
      newerMitigationRevision.stix.modified,
    );
  });

  after(async function () {
    await database.closeConnection();
  });
});
