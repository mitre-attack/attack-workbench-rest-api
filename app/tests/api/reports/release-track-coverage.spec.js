'use strict';

const request = require('supertest');
const { expect } = require('expect');
const { randomUUID } = require('node:crypto');

const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const AttackObject = require('../../../models/attack-object-model');

const missing = Symbol('missing membership key');
const membership = [{ id: 'release-track--00000000-0000-4000-8000-000000000000', tier: 'members' }];
const supportedTypes = [
  'attack-pattern',
  'campaign',
  'course-of-action',
  'intrusion-set',
  'malware',
  'tool',
  'x-mitre-analytic',
  'x-mitre-asset',
  'x-mitre-data-component',
  'x-mitre-data-source',
  'x-mitre-detection-strategy',
  'x-mitre-matrix',
  'x-mitre-tactic',
];

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
      object_marking_refs: ['marking-definition--613f2e26-407d-48c7-9eca-b8e91df99dc9'],
      kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'persistence' }],
      x_mitre_is_subtechnique: false,
      x_mitre_platforms: ['Windows'],
      x_mitre_domains: ['enterprise-attack'],
      x_mitre_version: '1.0',
    },
  };
}

describe('GET /api/reports/release-track-coverage', function () {
  let app;
  let passportCookie;
  let fixtureIds = [];

  before(async function () {
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();
    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;
    app = await require('../../../index').initializeApp();
    passportCookie = await login.loginAnonymous(app);
  });

  afterEach(async function () {
    await AttackObject.deleteMany({ 'stix.id': { $in: fixtureIds } });
    fixtureIds = [];
  });

  after(async function () {
    await database.closeConnection();
  });

  function authenticated(builder) {
    return builder.set('Cookie', `${passportCookie.name}=${passportCookie.value}`);
  }

  async function report() {
    return (
      await authenticated(request(app).get('/api/reports/release-track-coverage')).expect(200)
    ).body;
  }

  async function create(name, releaseTracks = missing) {
    const response = await authenticated(
      request(app).post('/api/techniques').send(technique(name)),
    ).expect(201);
    fixtureIds.push(response.body.stix.id);
    const document = await AttackObject.findOne({ 'stix.id': response.body.stix.id }).lean();
    // Backrefs are server-controlled. Direct storage writes simulate imported history
    // without using enrollment APIs to manufacture the states under investigation.
    const update =
      releaseTracks === missing
        ? { $unset: { 'workspace.release_tracks': '' } }
        : { $set: { 'workspace.release_tracks': releaseTracks } };
    await AttackObject.collection.updateOne({ _id: document._id }, update);
    return AttackObject.findById(document._id).lean();
  }

  async function revision(document, releaseTracks = missing, changes = {}, offset = 1000) {
    const copy = {
      workspace: { ...document.workspace },
      stix: {
        ...document.stix,
        ...changes,
        modified: new Date(new Date(document.stix.modified).getTime() + offset),
      },
    };
    if (releaseTracks === missing) delete copy.workspace.release_tracks;
    else copy.workspace.release_tracks = releaseTracks;
    await AttackObject.collection.insertOne(copy);
    return copy;
  }

  function ids(entries) {
    return entries.map((entry) => entry.stix.id);
  }

  it('returns empty arrays and zero counts when no supported objects exist', async function () {
    expect(await report()).toEqual({
      untracked_latest_revisions: [],
      never_enrolled_objects: [],
      summary: { untracked_latest_revision_count: 0, never_enrolled_object_count: 0 },
    });
  });

  it('selects the newest revision, checks all history, and returns unique compact sorted findings', async function () {
    const first = await create('Old member', membership);
    // Insert out of modified-time order: insertion order must not determine latest.
    const latest = await revision(first, missing, { name: 'Latest member revision' }, 3000);
    await revision(first, [], { name: 'Intermediate empty' }, 1000);
    await revision(first, null, { name: 'Intermediate null' }, 2000);
    const second = await create('Another old member', membership);
    await revision(second);
    const never = await create('Never enrolled');
    await revision(never, [], { name: 'Latest never enrolled' });

    const result = await report();
    expect(ids(result.untracked_latest_revisions)).toEqual([first.stix.id, second.stix.id].sort());
    expect(
      result.untracked_latest_revisions.find((entry) => entry.stix.id === first.stix.id),
    ).toEqual({
      stix: {
        id: first.stix.id,
        type: 'attack-pattern',
        name: 'Latest member revision',
        modified: latest.stix.modified.toISOString(),
      },
      workspace: { attack_id: first.workspace.attack_id },
    });
    expect(ids(result.never_enrolled_objects)).toEqual([never.stix.id]);
    expect(result.never_enrolled_objects[0].stix.name).toBe('Latest never enrolled');
    expect(result.summary).toEqual({
      untracked_latest_revision_count: 2,
      never_enrolled_object_count: 1,
    });
  });

  it('distinguishes absent, empty, null, and populated latest membership exactly', async function () {
    const findings = [];
    for (const latestMembership of [missing, [], null, membership]) {
      const old = await create('Previously enrolled', membership);
      await revision(old, latestMembership);
      if (latestMembership === missing) findings.push(old.stix.id);
    }
    const result = await report();
    expect(ids(result.untracked_latest_revisions)).toEqual(findings);
    expect(result.never_enrolled_objects).toEqual([]);
  });

  it('reports no recorded membership across missing, empty, and null histories', async function () {
    const findings = [];
    for (const latestMembership of [missing, [], null]) {
      const old = await create('No recorded membership', []);
      await revision(old, null, {}, 1000);
      await revision(old, latestMembership, {}, 2000);
      findings.push(old.stix.id);
    }
    const result = await report();
    expect(result.untracked_latest_revisions).toEqual([]);
    expect(ids(result.never_enrolled_objects)).toEqual(findings.sort());
    expect(result.summary.never_enrolled_object_count).toBe(3);
  });

  it('clears findings when latest membership is restored and does not mistake latest-only membership for a gap', async function () {
    const enrolled = await create('Old member', membership);
    const latest = await revision(enrolled);
    const never = await create('Never enrolled');
    expect((await report()).summary).toEqual({
      untracked_latest_revision_count: 1,
      never_enrolled_object_count: 1,
    });
    await AttackObject.collection.updateMany(
      { _id: { $in: [latest._id, never._id] } },
      { $set: { 'workspace.release_tracks': membership } },
    );
    expect((await report()).summary).toEqual({
      untracked_latest_revision_count: 0,
      never_enrolled_object_count: 0,
    });
  });

  it('keeps inactive latest revisions and objects without ATT&CK IDs', async function () {
    const old = await create('Inactive member', membership);
    const latest = await revision(old, missing, { revoked: true, name: 'Revoked latest' });
    const never = await create('Inactive never enrolled');
    const deprecated = await revision(never, missing, { x_mitre_deprecated: true });
    await AttackObject.collection.updateMany(
      { _id: { $in: [latest._id, deprecated._id] } },
      { $unset: { 'workspace.attack_id': '' } },
    );
    const result = await report();
    expect(ids(result.untracked_latest_revisions)).toEqual([old.stix.id]);
    expect(result.untracked_latest_revisions[0].stix.name).toBe('Revoked latest');
    expect(result.untracked_latest_revisions[0].workspace).toEqual({});
    expect(ids(result.never_enrolled_objects)).toEqual([never.stix.id]);
    expect(result.never_enrolled_objects[0].workspace).toEqual({});
  });

  it('includes every supported content SDO type and excludes non-content types', async function () {
    const excludedTypes = [
      'relationship',
      'identity',
      'note',
      'marking-definition',
      'x-mitre-collection',
    ];
    // Minimal imported records exercise report scope, not type-specific write validation.
    const documents = [...supportedTypes, ...excludedTypes].map((type) => {
      const id = `${type}--${randomUUID()}`;
      fixtureIds.push(id);
      return {
        stix: { id, type, name: type, modified: new Date('2026-01-01T00:00:00Z') },
      };
    });
    await AttackObject.collection.insertMany(documents);
    const result = await report();
    expect(result.untracked_latest_revisions).toEqual([]);
    expect(ids(result.never_enrolled_objects)).toEqual(
      documents
        .filter((entry) => supportedTypes.includes(entry.stix.type))
        .map((entry) => entry.stix.id)
        .sort(),
    );
    expect(result.summary.never_enrolled_object_count).toBe(supportedTypes.length);
    for (const entry of result.never_enrolled_objects) expect(entry.workspace).toEqual({});
  });

  it('does not change stored membership and does not return full revision histories', async function () {
    const old = await create('Long history', membership);
    for (let index = 1; index <= 30; index++) {
      await revision(old, missing, { description: 'x'.repeat(8192) }, index * 1000);
    }
    const query = { 'stix.id': old.stix.id };
    const before = await AttackObject.collection.find(query).sort({ 'stix.modified': 1 }).toArray();
    const result = await report();
    const after = await AttackObject.collection.find(query).sort({ 'stix.modified': 1 }).toArray();
    expect(after).toEqual(before);
    expect(result.untracked_latest_revisions).toHaveLength(1);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(1024);
  });
});
