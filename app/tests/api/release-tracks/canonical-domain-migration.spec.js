'use strict';

const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');
const request = require('supertest');
const { expect } = require('expect');

const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const migration = require('../../../../migrations/20260730230000-backfill-canonical-x-mitre-domains');
const defaultBypassRules = require('../../../lib/default-bypass-rules.json');

const markingDefinitionId = 'marking-definition--613f2e26-407d-48c7-9eca-b8e91df99dc9';
const collectionIds = {
  enterprise: 'x-mitre-collection--1f5f1533-f617-4ca8-9ab4-6a02367fa019',
  ics: 'x-mitre-collection--90c00720-636b-4485-b342-8751d232bf09',
  mobile: 'x-mitre-collection--dac0d2d7-8653-445c-9bff-82f934c1e858',
};
const objectFixtures = [
  {
    path: '/api/techniques',
    id: 'attack-pattern--10000000-0000-4000-8000-000000000001',
    type: 'attack-pattern',
    name: 'Active migration technique',
    lifecycle: 'active',
    collectionRefs: [collectionIds.mobile],
    expectedDomains: ['mobile-attack'],
  },
  {
    path: '/api/groups',
    id: 'intrusion-set--00f67a77-86a4-4adf-be26-1a54fc713340',
    type: 'intrusion-set',
    name: 'Active migration group',
    lifecycle: 'active',
    collectionRefs: [collectionIds.enterprise, collectionIds.mobile],
    expectedDomains: ['enterprise-attack', 'mobile-attack'],
  },
  {
    path: '/api/campaigns',
    id: 'campaign--0257b35b-93ef-4a70-80dd-ad5258e6045b',
    type: 'campaign',
    name: 'Active migration campaign',
    lifecycle: 'active',
    // Legacy collection appearance says ICS because the campaign was pulled
    // into an ICS graph as secondary content. Only exact TOC membership is
    // authoritative, and this campaign is an Enterprise primary.
    collectionRefs: [collectionIds.ics],
    expectedDomains: ['enterprise-attack'],
  },
  {
    path: '/api/mitigations',
    id: 'course-of-action--10000000-0000-4000-8000-000000000002',
    type: 'course-of-action',
    name: 'Active migration mitigation',
    lifecycle: 'active',
    collectionRefs: [collectionIds.enterprise],
    expectedDomains: ['enterprise-attack'],
  },
  {
    path: '/api/software',
    id: 'malware--10000000-0000-4000-8000-000000000003',
    type: 'malware',
    name: 'Active migration malware',
    lifecycle: 'active',
    collectionRefs: [collectionIds.enterprise, collectionIds.ics],
    expectedDomains: ['enterprise-attack', 'ics-attack'],
  },
  {
    path: '/api/software',
    id: 'tool--10000000-0000-4000-8000-000000000004',
    type: 'tool',
    name: 'Active migration tool',
    lifecycle: 'active',
    collectionRefs: [collectionIds.enterprise],
    expectedDomains: ['enterprise-attack'],
  },
  {
    path: '/api/analytics',
    id: 'x-mitre-analytic--10000000-0000-4000-8000-000000000005',
    type: 'x-mitre-analytic',
    name: 'Active migration analytic',
    lifecycle: 'active',
    collectionRefs: [collectionIds.enterprise],
    expectedDomains: ['enterprise-attack'],
  },
  {
    path: '/api/assets',
    id: 'x-mitre-asset--10000000-0000-4000-8000-000000000006',
    type: 'x-mitre-asset',
    name: 'Active migration asset',
    lifecycle: 'active',
    collectionRefs: [collectionIds.ics],
    expectedDomains: ['ics-attack'],
  },
  {
    path: '/api/data-components',
    id: 'x-mitre-data-component--10000000-0000-4000-8000-000000000007',
    type: 'x-mitre-data-component',
    name: 'Active migration data component',
    lifecycle: 'active',
    collectionRefs: [collectionIds.enterprise],
    expectedDomains: ['enterprise-attack'],
  },
  {
    path: '/api/data-sources',
    id: 'x-mitre-data-source--10000000-0000-4000-8000-000000000008',
    type: 'x-mitre-data-source',
    name: 'Active migration data source',
    lifecycle: 'active',
    collectionRefs: [collectionIds.enterprise],
    expectedDomains: ['enterprise-attack'],
  },
  {
    path: '/api/detection-strategies',
    id: 'x-mitre-detection-strategy--00060b87-7f99-45aa-9553-a4d94139195c',
    type: 'x-mitre-detection-strategy',
    name: 'Revoked migration detection strategy',
    lifecycle: 'revoked',
    collectionRefs: [collectionIds.enterprise, collectionIds.mobile],
    expectedDomains: ['enterprise-attack', 'mobile-attack'],
  },
  {
    path: '/api/matrices',
    id: 'x-mitre-matrix--eafc1b4c-5e56-4965-bd4e-66a6a89c88cc',
    type: 'x-mitre-matrix',
    name: 'Deprecated migration matrix',
    lifecycle: 'deprecated',
    collectionRefs: [collectionIds.ics],
    expectedDomains: ['ics-attack'],
  },
  {
    path: '/api/tactics',
    id: 'x-mitre-tactic--10000000-0000-4000-8000-000000000009',
    type: 'x-mitre-tactic',
    name: 'Active migration tactic',
    lifecycle: 'active',
    collectionRefs: [collectionIds.enterprise, collectionIds.ics, collectionIds.mobile],
    expectedDomains: ['enterprise-attack', 'ics-attack', 'mobile-attack'],
  },
];
const groupFixture = objectFixtures.find((fixture) => fixture.type === 'intrusion-set');
const campaignFixture = objectFixtures.find((fixture) => fixture.type === 'campaign');

describe('Canonical ATT&CK domain migration', function () {
  let app;
  let migrationClient;
  let migrationDb;
  let passportCookie;
  const created = new Map();
  let trackId;

  before(async function () {
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();
    // Reconstruct the pre-cutover bootstrap rules for this historical migration.
    const Policy = require('../../../models/validation-policy-model');
    const policy = await Policy.findOne({}).lean();
    const legacyRules = policy.rules.filter((rule) => rule.kind !== 'object-exemption');
    await mongoose.connection.collection('validationbypassrules').insertMany(legacyRules);
    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;
    app = await require('../../../index').initializeApp();
    passportCookie = await login.loginAnonymous(app);
    const migrationUri =
      `mongodb://${mongoose.connection.host}:${mongoose.connection.port}/` +
      mongoose.connection.name;
    migrationClient = new MongoClient(migrationUri);
    await migrationClient.connect();
    migrationDb = migrationClient.db(mongoose.connection.name);
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

  before('create representative legacy revisions and a member track', async function () {
    for (const fixture of objectFixtures) {
      const timestamp = new Date().toISOString();
      const stix = {
        type: fixture.type,
        id: fixture.id,
        spec_version: '2.1',
        created: timestamp,
        modified: timestamp,
        name: fixture.name,
        x_mitre_deprecated: false,
        object_marking_refs: [markingDefinitionId],
      };
      if (fixture.type === 'x-mitre-matrix') {
        stix.external_references = [
          {
            source_name: 'mitre-attack',
            external_id: 'enterprise-attack',
          },
        ];
      }

      const document = await post(fixture.path, {
        workspace: { workflow: { state: 'work-in-progress' } },
        stix,
      });
      created.set(fixture.id, document);
      const provenanceResult = await mongoose.connection.db.collection('attackObjects').updateOne(
        { 'stix.id': fixture.id, 'stix.modified': new Date(document.stix.modified) },
        {
          $set: {
            'workspace.collections': fixture.collectionRefs.map((collectionRef) => ({
              collection_ref: collectionRef,
              collection_modified: new Date('2026-01-01T00:00:00.000Z'),
            })),
          },
        },
      );
      expect(provenanceResult.matchedCount).toBe(1);
    }

    const fixturesByDomain = new Map([
      ['enterprise-attack', []],
      ['ics-attack', []],
      ['mobile-attack', []],
    ]);
    for (const fixture of objectFixtures) {
      const document = created.get(fixture.id);
      for (const domain of fixture.expectedDomains) {
        fixturesByDomain.get(domain).push({
          object_ref: document.stix.id,
          object_modified: new Date(document.stix.modified),
        });
      }
    }
    await mongoose.connection.db.collection('attackObjects').insertMany(
      Object.entries(collectionIds).map(([domainName, collectionId]) => ({
        __t: 'Collection',
        workspace: { workflow: { state: 'reviewed' } },
        stix: {
          id: collectionId,
          type: 'x-mitre-collection',
          spec_version: '2.1',
          created: new Date('2026-01-01T00:00:00.000Z'),
          modified: new Date('2026-01-01T00:00:00.000Z'),
          name: `${domainName} canonical collection`,
          x_mitre_contents: fixturesByDomain.get(`${domainName}-attack`),
        },
      })),
    );

    const revokedFixture = objectFixtures.find((fixture) => fixture.lifecycle === 'revoked');
    await mongoose.connection.db.collection('attackObjects').updateOne(
      { 'stix.id': revokedFixture.id },
      {
        $set: {
          'stix.revoked': true,
          'workspace.release_tracks': [
            {
              id: 'release-track--ffffffff-ffff-4fff-8fff-ffffffffffff',
              type: 'standard',
              tier: 'members',
              status: 'reviewed',
            },
          ],
          'workspace.validation': {
            errors: [
              {
                message: 'x_mitre_domains is required',
                path: ['x_mitre_domains'],
                code: 'invalid_type',
              },
              {
                message: 'another retained issue',
                path: ['description'],
                code: 'invalid_type',
              },
            ],
          },
        },
      },
    );
    const deprecatedFixture = objectFixtures.find((fixture) => fixture.lifecycle === 'deprecated');
    await mongoose.connection.db.collection('attackObjects').updateOne(
      { 'stix.id': deprecatedFixture.id },
      {
        $set: {
          'stix.x_mitre_deprecated': true,
          'workspace.validation': {
            errors: [
              {
                message: 'x_mitre_domains is required',
                path: ['x_mitre_domains'],
                code: 'invalid_type',
              },
            ],
          },
        },
      },
    );

    const track = await post('/api/release-tracks/new', {
      name: 'Domain migration track',
      type: 'standard',
    });
    trackId = track.id;
    const group = created.get(groupFixture.id);
    const campaign = created.get(campaignFixture.id);
    const memberSeed = await mongoose.connection.db.collection(trackId).updateOne(
      { id: trackId, modified: new Date(track.modified) },
      {
        $set: {
          members: [
            {
              object_ref: group.stix.id,
              object_modified: new Date(group.stix.modified),
            },
            {
              object_ref: campaign.stix.id,
              object_modified: new Date(campaign.stix.modified),
            },
          ],
        },
      },
    );
    expect(memberSeed.matchedCount).toBe(1);
  });

  it('rejects reviewed objects that omit required ATT&CK domains', async function () {
    const timestamp = new Date().toISOString();
    const response = await post(
      '/api/groups',
      {
        workspace: { workflow: { state: 'reviewed' } },
        stix: {
          type: 'intrusion-set',
          spec_version: '2.1',
          created: timestamp,
          modified: timestamp,
          name: 'Domainless reviewed group',
          aliases: ['Domainless reviewed group'],
          x_mitre_deprecated: false,
          x_mitre_version: '1.0',
          object_marking_refs: [markingDefinitionId],
        },
      },
      400,
    );

    expect(JSON.stringify(response)).toContain('x_mitre_domains');
  });

  it('does not seed missing-domain validation bypasses', function () {
    const retiredRules = defaultBypassRules.filter(
      (rule) =>
        rule.errorCode === 'invalid_type' &&
        rule.fieldPath?.join('.') === 'x_mitre_domains' &&
        migration._private.TARGET_TYPES.includes(rule.stixType),
    );
    expect(retiredRules).toEqual([]);
  });

  it('covers every domain-bearing type and ignores secondary collection appearances', async function () {
    expect(migration._private.TARGET_TYPES).toEqual([
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
    ]);

    const domainsByRevision = await migration._private.buildCanonicalTocDomainIndex(migrationDb);
    const campaign = created.get(campaignFixture.id);
    expect(
      migration._private.domainsFromCanonicalToc(
        {
          stix: {
            id: campaign.stix.id,
            modified: campaign.stix.modified,
          },
          workspace: {
            collections: [{ collection_ref: collectionIds.ics }],
          },
        },
        domainsByRevision,
      ),
    ).toEqual(['enterprise-attack']);
  });

  it('leaves inactive clone ids to the native database driver', async function () {
    const original = await mongoose.connection.db
      .collection('attackObjects')
      .findOne({ 'stix.id': objectFixtures[0].id });
    const prepared = migration._private.prepareInactiveClone({
      document: original,
      domains: ['enterprise-attack'],
    });

    expect(Object.prototype.hasOwnProperty.call(prepared.document, '_id')).toBe(false);
  });

  it('chunks work and caps active service concurrency', async function () {
    const work = Array.from({ length: migration._private.BATCH_SIZE * 2 + 1 }, (_, index) => index);
    expect(migration._private.chunkItems(work).map((batch) => batch.length)).toEqual([
      migration._private.BATCH_SIZE,
      migration._private.BATCH_SIZE,
      1,
    ]);

    let active = 0;
    let maximumActive = 0;
    const results = await migration._private.mapWithConcurrency(
      work.slice(0, 12),
      migration._private.ACTIVE_CONCURRENCY,
      async (value) => {
        active++;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active--;
        return value * 2;
      },
    );

    expect(maximumActive).toBe(migration._private.ACTIVE_CONCURRENCY);
    expect(results).toEqual(work.slice(0, 12).map((value) => value * 2));
  });

  it('backfills active and inactive revisions without mutating history or lifecycle state', async function () {
    await require('../../../models/validation-policy-model').deleteMany({});
    await mongoose.connection.db.collection('validationbypassrules').insertMany(
      migration._private.TARGET_TYPES.map((stixType) => ({
        fieldPath: ['x_mitre_domains'],
        errorCode: 'invalid_type',
        stixType,
        suppressError: true,
      })),
    );

    const report = await migration._private.run(migrationDb, migrationClient);

    expect(report.counts).toMatchObject({
      scanned_candidates: 13,
      active_reposts: 11,
      inactive_clones: 2,
      active_batches: 2,
      inactive_batches: 1,
      revoked: 1,
      deprecated: 1,
      bypasses_removed: 13,
      updated: 13,
      failed: 0,
    });
    expect(report.verification).toEqual({
      remaining_latest_domainless_target_objects: 0,
      remaining_domain_validation_bypasses: 0,
    });

    for (const fixture of objectFixtures) {
      const revisions = await mongoose.connection.db
        .collection('attackObjects')
        .find({ 'stix.id': fixture.id })
        .sort({ 'stix.modified': -1 })
        .toArray();

      expect(revisions).toHaveLength(2);
      expect(revisions[0].stix.x_mitre_domains).toEqual(fixture.expectedDomains);
      expect(revisions[1].stix.x_mitre_domains).toBeUndefined();
      expect(new Date(revisions[0].stix.modified).getTime()).toBeGreaterThan(
        new Date(revisions[1].stix.modified).getTime(),
      );
      expect(revisions[0].stix.revoked === true).toBe(fixture.lifecycle === 'revoked');
      expect(revisions[0].stix.x_mitre_deprecated === true).toBe(
        fixture.lifecycle === 'deprecated',
      );

      if (fixture.lifecycle === 'revoked') {
        expect(revisions[0].workspace.release_tracks).toBeUndefined();
        expect(revisions[0].workspace.validation.errors).toEqual([
          expect.objectContaining({ path: ['description'] }),
        ]);
        expect(revisions[1].workspace.release_tracks).toHaveLength(1);
        expect(revisions[1].workspace.validation.errors).toHaveLength(2);
      }
      if (fixture.lifecycle === 'deprecated') {
        expect(revisions[0].workspace.validation).toBeUndefined();
        expect(revisions[1].workspace.validation.errors).toHaveLength(1);
      }
    }

    const latestTrackSnapshot = await mongoose.connection.db
      .collection(trackId)
      .findOne({}, { sort: { modified: -1 } });
    expect(latestTrackSnapshot.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          object_ref: groupFixture.id,
          object_modified: 'latest',
        }),
        expect.objectContaining({
          object_ref: campaignFixture.id,
          object_modified: 'latest',
        }),
      ]),
    );

    const completedRun = await mongoose.connection.db
      .collection('automationRuns')
      .findOne(
        { name: '20260730230000-backfill-canonical-x-mitre-domains' },
        { sort: { started_at: -1 } },
      );
    const auditItems = await mongoose.connection.db
      .collection('automationRunItems')
      .find({ run_id: completedRun.run_id })
      .sort({ sequence: 1 })
      .toArray();
    expect(auditItems).toHaveLength(13);
    expect(auditItems.map((item) => item.sequence)).toEqual(
      Array.from({ length: 13 }, (_, index) => index + 1),
    );
  });

  it('is idempotent after canonical revisions and bypass removal are complete', async function () {
    const report = await migration._private.run(migrationDb, migrationClient);
    expect(report.counts.scanned_candidates).toBe(0);
    expect(report.counts.updated).toBe(0);
    expect(report.counts.bypasses_removed).toBe(0);
    expect(await migration._private.countRemainingDomainlessTargets(migrationDb)).toBe(0);
  });

  it('leaves unmapped domainless objects unchanged and retains enforcement bypasses', async function () {
    const unknownActiveId = 'intrusion-set--ffffffff-ffff-4fff-8fff-ffffffffffff';
    const unknownInactiveId = 'campaign--eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const now = new Date();
    await mongoose.connection.db.collection('attackObjects').insertMany([
      {
        __t: 'Intrusion-Set',
        workspace: { workflow: { state: 'work-in-progress' } },
        stix: {
          id: unknownActiveId,
          type: 'intrusion-set',
          spec_version: '2.1',
          created: now,
          modified: now,
          name: 'Unsupported custom group',
          revoked: false,
          x_mitre_deprecated: false,
        },
      },
      {
        __t: 'Campaign',
        workspace: { workflow: { state: 'work-in-progress' } },
        stix: {
          id: unknownInactiveId,
          type: 'campaign',
          spec_version: '2.1',
          created: now,
          modified: now,
          name: 'Unsupported deprecated campaign',
          revoked: false,
          x_mitre_deprecated: true,
        },
      },
    ]);
    await mongoose.connection.db.collection('validationbypassrules').insertOne({
      fieldPath: ['x_mitre_domains'],
      errorCode: 'invalid_type',
      stixType: 'intrusion-set',
      suppressError: true,
    });

    const report = await migration._private.run(migrationDb, migrationClient);
    expect(report.counts).toMatchObject({
      scanned_candidates: 0,
      unmapped_skipped: 2,
      active_reposts: 0,
      inactive_clones: 0,
      updated: 0,
      failed: 0,
      bypasses_removed: 0,
    });

    for (const stixId of [unknownActiveId, unknownInactiveId]) {
      const revisions = await mongoose.connection.db
        .collection('attackObjects')
        .find({ 'stix.id': stixId })
        .sort({ 'stix.modified': -1 })
        .toArray();
      expect(revisions).toHaveLength(1);
      expect(revisions[0].stix.x_mitre_domains).toBeUndefined();
    }
    expect(await migration._private.countStaleDomainBypasses(migrationDb)).toBe(1);

    const completedRun = await mongoose.connection.db
      .collection('automationRuns')
      .findOne(
        { name: '20260730230000-backfill-canonical-x-mitre-domains' },
        { sort: { started_at: -1 } },
      );
    expect(completedRun.status).toBe('completed');
    expect(completedRun.counts.unmapped_skipped).toBe(2);
    expect(completedRun.warnings.unmapped_domainless_objects.count).toBe(2);
    expect(completedRun.warnings.unmapped_domainless_objects.sample).toEqual(
      expect.arrayContaining([unknownActiveId, unknownInactiveId]),
    );

    const fallbackItems = await mongoose.connection.db
      .collection('automationRunItems')
      .find({ run_id: completedRun.run_id })
      .toArray();
    expect(fallbackItems).toHaveLength(0);
  });

  after(async function () {
    await migrationClient?.close();
    await database.closeConnection();
  });
});
