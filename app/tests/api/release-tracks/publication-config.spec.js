'use strict';

const request = require('supertest');
const { expect } = require('expect');

const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const { releaseExactMembers } = require('./release-track-test-helpers');

const markingDefinitionId = 'marking-definition--613f2e26-407d-48c7-9eca-b8e91df99dc9';
const tlpGreenMarkingId = 'marking-definition--34098fce-860f-48ae-8e50-ebd3cc5e41da';

describe('Release-track publication configuration', function () {
  let app;
  let passportCookie;
  let organizationIdentity;
  let trackIdentity;

  before(async function () {
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();
    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;
    app = await require('../../../index').initializeApp();
    passportCookie = await login.loginAnonymous(app);
    organizationIdentity = (await get('/api/config/organization-identity')).stix;
    const timestamp = new Date().toISOString();
    trackIdentity = (
      await post('/api/identities', {
        workspace: { workflow: { state: 'work-in-progress' } },
        stix: {
          type: 'identity',
          spec_version: '2.1',
          created: timestamp,
          modified: timestamp,
          name: 'Track Publishing Identity',
          identity_class: 'organization',
          object_marking_refs: [markingDefinitionId],
        },
      })
    ).stix;
  });

  function api(method, path, body, status) {
    const call = request(app)
      [method](path)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`);
    if (body !== undefined) call.send(body);
    return call.expect(status);
  }

  async function post(path, body, status = 201) {
    return (await api('post', path, body, status)).body;
  }

  async function put(path, body, status = 200) {
    return (await api('put', path, body, status)).body;
  }

  async function get(path, status = 200) {
    return (await api('get', path, undefined, status)).body;
  }

  function technique(name) {
    const timestamp = new Date().toISOString();
    return {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        created: timestamp,
        modified: timestamp,
        name,
        description: `${name} description`,
        spec_version: '2.1',
        type: 'attack-pattern',
        object_marking_refs: [markingDefinitionId],
        kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'persistence' }],
        x_mitre_domains: ['enterprise-attack'],
        x_mitre_is_subtechnique: false,
        x_mitre_platforms: ['Windows'],
        x_mitre_version: '1.0',
      },
    };
  }

  async function collectionObject(trackId, selector = 'latest') {
    const bundle = await get(
      `/api/release-tracks/${trackId}/snapshots/${encodeURIComponent(selector)}?format=bundle`,
    );
    return bundle.objects[0];
  }

  it('inherits identity and markings from the global scope by default and reports the sources', async function () {
    const track = await post('/api/release-tracks/new', {
      name: 'Publication Defaults',
      type: 'standard',
    });
    const trackConfig = await get(`/api/release-tracks/${track.id}/config`);

    expect(trackConfig.publication).toEqual({
      created_by_ref: { inherit: true },
      object_marking_refs: { inherit: true },
    });
    expect(trackConfig.publication_resolved).toMatchObject({
      collection_id: `x-mitre-collection--${track.id.split('--')[1]}`,
      created: track.created,
      created_by_ref: organizationIdentity.id,
      attack_spec_version: config.app.attackSpecVersion,
      sources: {
        collection_id: 'derived',
        created: 'derived',
        created_by_ref: 'global',
        // The test environment configures no default markings, so the
        // collection object falls back to the markings its contents reference.
        object_marking_refs: 'content',
      },
    });
    const collection = await collectionObject(track.id);
    expect(collection.created_by_ref).toBe(organizationIdentity.id);
    // An empty draft has no content markings to fall back to, so the
    // (empty) array is stripped by STIX conformance.
    expect(collection.object_marking_refs).toBeUndefined();
  });

  it('applies explicit track overrides to draft exports and freezes them at release', async function () {
    const member = await post('/api/techniques', technique('Publication Override Member'));
    const track = await post('/api/release-tracks/new', {
      name: 'Publication Overrides',
      type: 'standard',
    });
    const canonicalCollectionId = 'x-mitre-collection--1f5f1533-f617-4ca8-9ab4-6a02367fa019';
    const canonicalCreated = '2018-01-17T12:56:55.080Z';

    const updated = await put(`/api/release-tracks/${track.id}/config`, {
      publication: {
        collection_id: canonicalCollectionId,
        created: canonicalCreated,
        created_by_ref: { inherit: false, value: trackIdentity.id },
        object_marking_refs: { inherit: false, value: [tlpGreenMarkingId] },
      },
    });
    expect(updated.config.publication).toMatchObject({
      collection_id: canonicalCollectionId,
      created: canonicalCreated,
      created_by_ref: { inherit: false, value: trackIdentity.id },
      object_marking_refs: { inherit: false, value: [tlpGreenMarkingId] },
    });
    const resolved = (await get(`/api/release-tracks/${track.id}/config`)).publication_resolved;
    expect(resolved.sources).toEqual({
      collection_id: 'track',
      created: 'track',
      created_by_ref: 'track',
      object_marking_refs: 'track',
    });

    const draftCollection = await collectionObject(track.id);
    expect(draftCollection).toMatchObject({
      id: canonicalCollectionId,
      created: canonicalCreated,
      created_by_ref: trackIdentity.id,
      object_marking_refs: [tlpGreenMarkingId],
    });
    expect(draftCollection).not.toHaveProperty('x_mitre_version');

    const released = await releaseExactMembers(app, passportCookie, track.id, [member], {
      version: '1.0',
    });
    expect(released.publication).toMatchObject({
      collection_id: canonicalCollectionId,
      created: canonicalCreated,
      created_by_ref: trackIdentity.id,
      object_marking_refs: [tlpGreenMarkingId],
    });
    const releaseBundle = await get(
      `/api/release-tracks/${track.id}/snapshots/${encodeURIComponent(
        released.modified,
      )}?format=bundle`,
    );
    expect(releaseBundle.objects[0]).toMatchObject({
      id: canonicalCollectionId,
      x_mitre_version: '1.0',
      created: canonicalCreated,
      created_by_ref: trackIdentity.id,
      object_marking_refs: [tlpGreenMarkingId],
    });
    // The publishing identity and configured markings ship as supporting objects.
    expect(releaseBundle.objects.some((object) => object.id === trackIdentity.id)).toBe(true);
    expect(releaseBundle.objects.some((object) => object.id === tlpGreenMarkingId)).toBe(true);
    expect(releaseBundle.objects[0].x_mitre_contents.map((entry) => entry.object_ref)).toContain(
      trackIdentity.id,
    );

    // Reverting the rule affects future drafts but never the frozen release.
    await put(`/api/release-tracks/${track.id}/config`, {
      publication: { created_by_ref: { inherit: true } },
    });
    expect((await collectionObject(track.id)).created_by_ref).toBe(organizationIdentity.id);
    expect((await collectionObject(track.id, released.modified)).created_by_ref).toBe(
      trackIdentity.id,
    );

    // Collection identity is immutable once the track has a release.
    const conflict = await put(
      `/api/release-tracks/${track.id}/config`,
      { publication: { collection_id: null } },
      409,
    );
    expect(conflict.message).toMatch(/collection_id cannot change/);
    await put(
      `/api/release-tracks/${track.id}/config`,
      { publication: { created: '2019-01-01T00:00:00.000Z' } },
      409,
    );
    // Restating the same values is not a change.
    await put(`/api/release-tracks/${track.id}/config`, {
      publication: { collection_id: canonicalCollectionId, created: canonicalCreated },
    });
  });

  it('rejects malformed publication rules and the retired top-level marking field', async function () {
    const track = await post('/api/release-tracks/new', {
      name: 'Publication Validation',
      type: 'standard',
    });
    await put(
      `/api/release-tracks/${track.id}/config`,
      { publication: { created_by_ref: { inherit: false } } },
      400,
    );
    await put(
      `/api/release-tracks/${track.id}/config`,
      { publication: { object_marking_refs: { inherit: true, value: [] } } },
      400,
    );
    await put(
      `/api/release-tracks/${track.id}/config`,
      { publication: { collection_id: 'attack-pattern--not-a-collection' } },
      400,
    );
    await post(
      '/api/release-tracks/new',
      {
        name: 'Retired Marking Field',
        type: 'standard',
        object_marking_refs: [markingDefinitionId],
      },
      400,
    );
  });

  after(async function () {
    await database.closeConnection();
  });
});
