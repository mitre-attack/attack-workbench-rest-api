'use strict';

const request = require('supertest');
const { expect } = require('expect');

const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');

describe('Virtual release-track composition validation API', function () {
  let app;
  let passportCookie;
  let componentTrack;
  let secondComponentTrack;
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
      name: 'Composition Validation Component',
      type: 'standard',
    });
    secondComponentTrack = await post('/api/release-tracks/new', {
      name: 'Composition Validation Second Component',
      type: 'standard',
    });
    virtualTrack = await post('/api/release-tracks/new', {
      name: 'Composition Validation Virtual',
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

  async function putComposition(composition, status = 200) {
    const response = await request(app)
      .put(`/api/release-tracks/${virtualTrack.id}/virtual/composition`)
      .send(composition)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(status);
    return response.body;
  }

  function component(resolutionStrategy, overrides = {}) {
    return {
      track_id: componentTrack.id,
      resolution_strategy: resolutionStrategy,
      priority: 1,
      ...overrides,
    };
  }

  function composition(componentTrack, overrides = {}) {
    return {
      component_tracks: [componentTrack],
      deduplication: { strategy: 'prioritize_latest_object' },
      ...overrides,
    };
  }

  async function createVirtual(compositionBody, status = 201, name) {
    createSequence += 1;
    return post(
      '/api/release-tracks/new',
      {
        name: name || `Strict Composition Create ${createSequence}`,
        type: 'virtual',
        composition: compositionBody,
      },
      status,
    );
  }

  async function listTracks(search) {
    const response = await request(app)
      .get('/api/release-tracks')
      .query({ search })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200);
    return response.body.data;
  }

  it('rejects unknown composition keys instead of silently stripping them', async function () {
    const invalidCompositions = [
      composition(component('latest_tagged'), { unexpected: true }),
      composition(component('latest_tagged', { unexpected: true })),
      composition(
        component('latest_tagged', {
          filters: { domains: ['enterprise'], domain: 'enterprise' },
        }),
      ),
      composition(component('latest_tagged'), {
        deduplication: {
          strategy: 'prioritize_latest_object',
          fallback: 'quarantine',
        },
      }),
    ];

    for (const invalidComposition of invalidCompositions) {
      await createVirtual(invalidComposition, 400);
      await putComposition(invalidComposition, 400);
    }
  });

  it('requires and restricts selectors according to resolution_strategy', async function () {
    const timestamp = '2024-02-01T10:00:00.000Z';
    const invalidComponents = [
      component('latest_tagged', { version: '1.0' }),
      component('latest_tagged', { snapshot: timestamp }),
      component('latest_draft', { version: '1.0' }),
      component('latest_draft', { snapshot: timestamp }),
      component('specific_version'),
      component('specific_version', { snapshot: timestamp }),
      component('specific_version', { version: '1.0', snapshot: timestamp }),
      component('specific_snapshot'),
      component('specific_snapshot', { version: '1.0' }),
      component('specific_snapshot', { version: '1.0', snapshot: timestamp }),
    ];

    for (const invalidComponent of invalidComponents) {
      await createVirtual(composition(invalidComponent), 400);
      await putComposition(composition(invalidComponent), 400);
    }
  });

  it('accepts only the selector defined by each resolution strategy', async function () {
    const timestamp = '2024-02-01T10:00:00.000Z';
    const validComponents = [
      component('latest_tagged'),
      component('latest_draft'),
      component('specific_version', { version: '1.0' }),
      component('specific_snapshot', { snapshot: timestamp }),
    ];

    for (const validComponent of validComponents) {
      const created = await createVirtual(composition(validComponent));
      expect(created.composition.component_tracks[0]).toMatchObject(validComponent);

      const updated = await putComposition(composition(validComponent));
      expect(updated.composition.component_tracks[0]).toMatchObject(validComponent);
    }
  });

  it('requires unique component priorities and track IDs', async function () {
    const invalidCompositions = [
      composition(component('latest_tagged', { priority: undefined })),
      {
        component_tracks: [
          component('latest_tagged'),
          {
            track_id: secondComponentTrack.id,
            resolution_strategy: 'latest_tagged',
            priority: 1,
          },
        ],
      },
      {
        component_tracks: [component('latest_tagged'), component('latest_tagged', { priority: 2 })],
      },
    ];

    for (const invalidComposition of invalidCompositions) {
      await createVirtual(invalidComposition, 400);
      await putComposition(invalidComposition, 400);
    }
  });

  it('requires standard component tracks during creation and composition update', async function () {
    const missingComponentName = 'Missing Component Create';
    await createVirtual(
      composition({
        track_id: 'release-track--11111111-1111-4111-8111-111111111111',
        resolution_strategy: 'latest_tagged',
        priority: 1,
      }),
      404,
      missingComponentName,
    );
    expect(await listTracks(missingComponentName)).toEqual([]);

    const virtualComponentName = 'Virtual Component Create';
    await createVirtual(
      composition({
        track_id: virtualTrack.id,
        resolution_strategy: 'latest_tagged',
        priority: 1,
      }),
      400,
      virtualComponentName,
    );
    expect(await listTracks(virtualComponentName)).toEqual([]);

    await putComposition(
      composition({
        track_id: virtualTrack.id,
        resolution_strategy: 'latest_tagged',
        priority: 1,
      }),
      400,
    );
  });

  it('rejects native members instead of silently creating a hybrid virtual track', async function () {
    const name = 'Native Members Rejected';
    await post(
      '/api/release-tracks/new',
      {
        name,
        type: 'virtual',
        composition: composition(component('latest_tagged')),
        native_members: [
          {
            object_ref: 'attack-pattern--11111111-1111-4111-8111-111111111111',
            object_modified: '2024-02-01T10:00:00.000Z',
          },
        ],
      },
      400,
    );

    expect(await listTracks(name)).toEqual([]);
  });
});
