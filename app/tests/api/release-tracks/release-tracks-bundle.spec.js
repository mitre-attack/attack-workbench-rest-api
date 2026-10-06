/**
 * Release Track Snapshot Bundle Export Tests
 * ===========================================
 *
 * Regression tests for the `format=bundle` output format on the snapshot
 * retrieval endpoints:
 *
 *   - GET /api/release-tracks/:id/snapshots/latest
 *   - GET /api/release-tracks/:id/snapshots/:modified
 *
 * Covered behavior:
 *   - Default bundle contains members only, plus referenced identities and
 *     marking definitions (self-contained bundle)
 *   - A sealed content manifest contains active relationships only when both
 *     endpoint IDs are members; releases replay it and drafts inherit it
 *   - `include` adds staged and/or candidate tiers (comma-separated or
 *     repeated, singular or plural tier names)
 *   - `state` narrows the included staged/candidate entries by workflow
 *     status; entries marked 'reviewed' are always included
 *   - `stixVersion` controls bundle/object STIX version conformance
 *   - STIX 2.1 bundles always begin with the x-mitre-collection object, which
 *     is projected from the snapshot and its publication metadata
 *   - LinkById tags are converted to markdown citations
 *   - Invalid `include`/`state` values are rejected with 400
 */

const request = require('supertest');
const { expect } = require('expect');

const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const { releaseExactMembers } = require('./release-track-test-helpers');

const logger = require('../../../lib/logger');
logger.level = 'debug';

// Seeded by databaseConfiguration.checkSystemConfiguration()
const staticMarkingDefinitionId = 'marking-definition--613f2e26-407d-48c7-9eca-b8e91df99dc9';

describe('Release Tracks Bundle Export API', function () {
  let app;
  let passportCookie;

  // The organization identity stamped onto created objects by the server
  let organizationIdentityId;
  let trackId;
  let trackUuid;
  let taggedModified;
  let snapshotModified;

  let memberObject;
  let linkedMemberObject;
  let relationshipSource;
  let includedRelationship;
  let excludedRelationship;
  let secondaryGroup;
  let secondaryRelationship;
  let linkedAttackId;
  let linkedAttackUrl;
  let candidateWip;
  let candidateAwaitingReview;
  let candidateReviewed;
  let stagedObject;

  before(async function () {
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();

    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;

    app = await require('../../../index').initializeApp();
    passportCookie = await login.loginAnonymous(app);
  });

  async function postObject(path, body) {
    const res = await request(app)
      .post(path)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);
    return res.body;
  }

  async function postAction(path, body, expectedStatus = 200) {
    const res = await request(app)
      .post(path)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(expectedStatus);
    return res.body;
  }

  async function getBundle(path, expectedStatus = 200) {
    const res = await request(app)
      .get(path)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(expectedStatus);
    return res.body;
  }

  function buildTechnique(name, overrides = {}) {
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
        description: `Description for ${name}`,
        spec_version: '2.1',
        type: 'attack-pattern',
        object_marking_refs: [staticMarkingDefinitionId],
        kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'persistence' }],
        x_mitre_is_subtechnique: false,
        x_mitre_platforms: ['Windows'],
        x_mitre_version: '1.0',
        x_mitre_domains: ['enterprise-attack'],
        ...overrides,
      },
    };
  }

  function bundleObjectIds(bundle) {
    return bundle.objects.map((o) => o.id);
  }

  before('set up release track with tiered contents', async function () {
    // The server auto-generates an ATT&CK ID (and matching external reference)
    // for techniques; LinkById tags resolve against that generated ID
    linkedMemberObject = await postObject('/api/techniques', buildTechnique('Linked Technique'));
    linkedAttackId = linkedMemberObject.workspace.attack_id;
    const linkedAttackRef = (linkedMemberObject.stix.external_references || []).find(
      (ref) => ref.external_id === linkedAttackId,
    );
    linkedAttackUrl = linkedAttackRef?.url || '';

    // The server stamps created_by_ref with the organization identity
    organizationIdentityId = linkedMemberObject.stix.created_by_ref;

    // Member whose description references the linked technique
    memberObject = await postObject(
      '/api/techniques',
      buildTechnique('Member Technique', {
        description: `See (LinkById: ${linkedAttackId}) for details.`,
      }),
    );

    candidateWip = await postObject('/api/techniques', buildTechnique('Candidate WIP'));
    candidateAwaitingReview = await postObject(
      '/api/techniques',
      buildTechnique('Candidate Awaiting Review'),
    );
    candidateReviewed = await postObject('/api/techniques', buildTechnique('Candidate Reviewed'));
    stagedObject = await postObject('/api/techniques', buildTechnique('Staged Technique'));
    relationshipSource = await postObject('/api/groups', {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        name: 'Bundle Relationship Group',
        description: 'Group used to verify dynamic relationship inclusion.',
        spec_version: '2.1',
        type: 'intrusion-set',
        object_marking_refs: [staticMarkingDefinitionId],
        x_mitre_version: '1.0',
        x_mitre_domains: ['enterprise-attack'],
      },
    });
    includedRelationship = await postObject('/api/relationships', {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        spec_version: '2.1',
        type: 'relationship',
        relationship_type: 'uses',
        source_ref: relationshipSource.stix.id,
        target_ref: memberObject.stix.id,
        object_marking_refs: [staticMarkingDefinitionId],
      },
    });
    excludedRelationship = await postObject('/api/relationships', {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        spec_version: '2.1',
        type: 'relationship',
        relationship_type: 'uses',
        source_ref: relationshipSource.stix.id,
        target_ref: candidateWip.stix.id,
        object_marking_refs: [staticMarkingDefinitionId],
      },
    });
    secondaryGroup = await postObject('/api/groups', {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        name: 'Bundle Secondary Group',
        description: 'A member endpoint for relationship graph tests.',
        spec_version: '2.1',
        type: 'intrusion-set',
        object_marking_refs: [staticMarkingDefinitionId],
        x_mitre_version: '1.0',
        x_mitre_domains: ['enterprise-attack'],
      },
    });
    secondaryRelationship = await postObject('/api/relationships', {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        description: 'Frozen relationship description.',
        spec_version: '2.1',
        type: 'relationship',
        relationship_type: 'uses',
        source_ref: secondaryGroup.stix.id,
        target_ref: memberObject.stix.id,
        object_marking_refs: [staticMarkingDefinitionId],
      },
    });

    const track = await postAction(
      '/api/release-tracks/new',
      {
        name: 'Bundle Test Track',
        description: 'Release track bundle export test',
        snapshot_description: 'Virtual snapshot',
        type: 'standard',
      },
      201,
    );
    trackId = track.id;
    trackUuid = trackId.split('--')[1];

    // Disable auto-promotion so reviewed candidates stay in the candidates tier
    await request(app)
      .put(`/api/release-tracks/${trackId}/config`)
      .send({ auto_promote: false })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200);

    // Members enter through the supported candidate → staged → release
    // lifecycle.
    const tagged = await releaseExactMembers(app, passportCookie, trackId, [
      memberObject,
      linkedMemberObject,
      relationshipSource,
      secondaryGroup,
    ]);
    taggedModified = tagged.modified;

    // Candidates (all start as work-in-progress)
    await postAction(`/api/release-tracks/${trackId}/candidates`, {
      object_refs: [
        { id: candidateWip.stix.id, modified: candidateWip.stix.modified },
        { id: candidateAwaitingReview.stix.id, modified: candidateAwaitingReview.stix.modified },
        { id: candidateReviewed.stix.id, modified: candidateReviewed.stix.modified },
        { id: stagedObject.stix.id, modified: stagedObject.stix.modified },
      ],
    });

    // Transition candidate statuses
    await postAction(`/api/release-tracks/${trackId}/candidates/review`, {
      from: 'work-in-progress',
      to: 'awaiting-review',
      object_refs: [candidateAwaitingReview.stix.id],
    });
    await postAction(`/api/release-tracks/${trackId}/candidates/review`, {
      from: 'work-in-progress',
      to: 'reviewed',
      object_refs: [candidateReviewed.stix.id],
    });

    // Promote one candidate to staged (retains work-in-progress status)
    const promoteRes = await postAction(`/api/release-tracks/${trackId}/candidates/promote`, {
      object_refs: [stagedObject.stix.id],
    });
    snapshotModified = promoteRes.modified;
  });

  it('GET /api/release-tracks/:id/snapshots/latest?format=bundle returns a members-only STIX 2.1 bundle', async function () {
    const bundle = await getBundle(`/api/release-tracks/${trackId}/snapshots/latest?format=bundle`);

    expect(bundle.type).toBe('bundle');
    expect(bundle.id).toMatch(/^bundle--/);
    // STIX 2.1 removed spec_version from the bundle object
    expect(bundle.spec_version).toBeUndefined();

    const ids = bundleObjectIds(bundle);
    expect(ids).toContain(memberObject.stix.id);
    expect(ids).toContain(linkedMemberObject.stix.id);
    expect(ids).toContain(secondaryGroup.stix.id);
    expect(ids).toContain(secondaryRelationship.stix.id);

    // Tier entries not selected via include are excluded
    expect(ids).not.toContain(candidateWip.stix.id);
    expect(ids).not.toContain(candidateAwaitingReview.stix.id);
    expect(ids).not.toContain(candidateReviewed.stix.id);
    expect(ids).not.toContain(stagedObject.stix.id);

    // Referenced supporting objects are included so the bundle is self-contained
    expect(ids).toContain(organizationIdentityId);
    expect(ids).toContain(staticMarkingDefinitionId);

    // Objects conform to STIX 2.1
    const member = bundle.objects.find((o) => o.id === memberObject.stix.id);
    expect(member.spec_version).toBe('2.1');

    // Bundle objects contain STIX properties only (no workspace/workflow data)
    expect(member.workspace).toBeUndefined();
  });

  it('GET /api/release-tracks/:id/snapshots/latest?format=bundle includes a collection object projected from the snapshot', async function () {
    const bundle = await getBundle(`/api/release-tracks/${trackId}/snapshots/latest?format=bundle`);
    const snapshot = await getBundle(`/api/release-tracks/${trackId}/snapshots/latest`);
    const trackConfig = await getBundle(`/api/release-tracks/${trackId}/config`);

    const toc = bundle.objects[0];
    expect(toc.type).toBe('x-mitre-collection');
    expect(toc.id).toBe(`x-mitre-collection--${trackUuid}`);
    expect(toc.name).toBe('Bundle Test Track');
    // This rolling draft belongs to the next release cycle, so it has no
    // snapshot-local description and falls back to the track description.
    expect(toc.description).toBe('Release track bundle export test');
    // Draft snapshots have no publication version, so the key is omitted.
    expect(toc).not.toHaveProperty('x_mitre_version');
    expect(toc.x_mitre_attack_spec_version).toBe(config.app.attackSpecVersion);
    expect(toc.spec_version).toBe('2.1');
    expect(toc.created_by_ref).toBe(organizationIdentityId);
    expect(toc.created).toBe(new Date(snapshot.created).toISOString());
    expect(toc.modified).toBe(new Date(snapshot.modified).toISOString());

    // Collection markings follow the publication rule. Neither scope
    // configures markings here, so the object carries the markings referenced
    // by its contents; everything emitted except marking definitions is
    // listed in x_mitre_contents
    expect(trackConfig.publication_resolved.sources.object_marking_refs).toBe('content');
    expect(toc.object_marking_refs).toEqual([staticMarkingDefinitionId]);
    const contentRefs = toc.x_mitre_contents.map((entry) => entry.object_ref);
    expect(contentRefs).toContain(memberObject.stix.id);
    expect(contentRefs).toContain(includedRelationship.stix.id);
    expect(contentRefs).toContain(organizationIdentityId);
    expect(contentRefs).not.toContain(staticMarkingDefinitionId);
    expect(contentRefs).not.toContain(toc.id);
  });

  it('adds only relationships whose endpoints are both selected for the bundle', async function () {
    const bundle = await getBundle(`/api/release-tracks/${trackId}/snapshots/latest?format=bundle`);
    const ids = bundleObjectIds(bundle);

    expect(ids).toContain(includedRelationship.stix.id);
    expect(ids).toContain(secondaryRelationship.stix.id);
    expect(ids).not.toContain(excludedRelationship.stix.id);

    const snapshot = await getBundle(`/api/release-tracks/${trackId}/snapshots/latest`);
    expect(snapshot.members.map((member) => member.object_ref)).not.toContain(
      includedRelationship.stix.id,
    );
  });

  it('replays sealed relationship pointers and protects manifest dependencies', async function () {
    const relationshipUpdate = JSON.parse(JSON.stringify(secondaryRelationship));
    delete relationshipUpdate._id;
    delete relationshipUpdate.__v;
    delete relationshipUpdate.__t;
    relationshipUpdate.stix.modified = new Date(
      new Date(secondaryRelationship.stix.modified).getTime() + 1000,
    ).toISOString();
    relationshipUpdate.stix.description = 'A corrected relationship revision.';
    relationshipUpdate.stix.external_references = [
      {
        source_name: 'deterministic-bundle-test',
        description: 'Regression-test relationship source.',
      },
    ];

    await request(app)
      .post('/api/relationships')
      .send(relationshipUpdate)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201);

    const bundle = await getBundle(
      `/api/release-tracks/${trackId}/snapshots/${encodeURIComponent(
        taggedModified,
      )}?format=bundle`,
    );
    const pinnedRelationship = bundle.objects.find(
      (object) => object.id === secondaryRelationship.stix.id,
    );
    expect(pinnedRelationship.modified).toBe(secondaryRelationship.stix.modified);
    expect(pinnedRelationship.description).toBe('Frozen relationship description.');

    await request(app)
      .delete(
        `/api/relationships/${secondaryRelationship.stix.id}/modified/` +
          encodeURIComponent(secondaryRelationship.stix.modified),
      )
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(409);

    const secondaryUpdate = JSON.parse(JSON.stringify(secondaryGroup));
    secondaryUpdate.stix.description = 'Attempted in-place graph drift.';
    await request(app)
      .put(
        `/api/groups/${secondaryGroup.stix.id}/modified/` +
          encodeURIComponent(secondaryGroup.stix.modified),
      )
      .send(secondaryUpdate)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(409);

    await request(app)
      .delete(
        `/api/groups/${secondaryGroup.stix.id}/modified/` +
          encodeURIComponent(secondaryGroup.stix.modified),
      )
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(409);
  });

  it('maps the release notes onto the collection object of the released snapshot', async function () {
    const bundle = await getBundle(
      `/api/release-tracks/${trackId}/snapshots/${encodeURIComponent(
        taggedModified,
      )}?format=bundle`,
    );

    expect(bundle.objects[0]).toMatchObject({
      type: 'x-mitre-collection',
      description: 'Virtual snapshot',
    });
  });

  it('protects manifest dependencies from collection cascade deletion', async function () {
    const timestamp = new Date().toISOString();
    const collection = await postObject('/api/collections', {
      workspace: {
        imported: timestamp,
        import_categories: {},
        workflow: {},
      },
      stix: {
        id: `x-mitre-collection--${trackUuid}`,
        type: 'x-mitre-collection',
        spec_version: '2.1',
        created: timestamp,
        modified: timestamp,
        name: 'Graph protection cascade fixture',
        description: 'Attempts to cascade-delete a protected manifest member.',
        x_mitre_version: '1.0',
        x_mitre_contents: [
          {
            object_ref: secondaryGroup.stix.id,
            object_modified: secondaryGroup.stix.modified,
          },
        ],
        object_marking_refs: [staticMarkingDefinitionId],
      },
    });

    await request(app)
      .delete(
        `/api/collections/${collection.stix.id}/modified/` +
          `${encodeURIComponent(collection.stix.modified)}?deleteAllContents=true`,
      )
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(409);

    await request(app)
      .get(
        `/api/groups/${secondaryGroup.stix.id}/modified/` +
          encodeURIComponent(secondaryGroup.stix.modified),
      )
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200);
  });

  it('no longer accepts includeToc: the collection object is always present in STIX 2.1', async function () {
    await getBundle(
      `/api/release-tracks/${trackId}/snapshots/latest?format=bundle&includeToc=false`,
      400,
    );
  });

  it('bundles replay the sealed manifest and never add workflow tiers', async function () {
    const bundle = await getBundle(`/api/release-tracks/${trackId}/snapshots/latest?format=bundle`);

    const ids = bundleObjectIds(bundle);
    expect(ids).toContain(memberObject.stix.id);
    expect(ids).not.toContain(stagedObject.stix.id);
    expect(ids).not.toContain(candidateWip.stix.id);
    expect(ids).not.toContain(candidateAwaitingReview.stix.id);
    expect(ids).not.toContain(candidateReviewed.stix.id);
  });

  it('rejects include for bundles on drafts and releases alike', async function () {
    for (const include of ['staged', 'candidates', 'candidates,staged', 'all', 'members']) {
      await getBundle(
        `/api/release-tracks/${trackId}/snapshots/latest?format=bundle&include=${include}`,
        400,
      );
    }
    await getBundle(
      `/api/release-tracks/${trackId}/snapshots/${encodeURIComponent(
        taggedModified,
      )}?format=bundle&include=candidates`,
      400,
    );
  });

  it('no longer accepts state: bundles carry no workflow tiers to filter', async function () {
    await getBundle(
      `/api/release-tracks/${trackId}/snapshots/latest?format=bundle&state=work-in-progress`,
      400,
    );
  });

  it('GET /api/release-tracks/:id/snapshots/latest?format=bundle converts LinkById tags to markdown citations', async function () {
    const bundle = await getBundle(`/api/release-tracks/${trackId}/snapshots/latest?format=bundle`);
    const member = bundle.objects.find((o) => o.id === memberObject.stix.id);
    expect(member.description).toBe(`See [Linked Technique](${linkedAttackUrl}) for details.`);
  });

  it('GET /api/release-tracks/:id/snapshots/latest?format=bundle&stixVersion=2.0 conforms the bundle to STIX 2.0', async function () {
    const bundle = await getBundle(
      `/api/release-tracks/${trackId}/snapshots/latest?format=bundle&stixVersion=2.0`,
    );

    expect(bundle.spec_version).toBe('2.0');
    expect(bundle.objects.some((object) => object.type === 'x-mitre-collection')).toBe(false);
    const member = bundle.objects.find((o) => o.id === memberObject.stix.id);
    expect(member.spec_version).toBeUndefined();
  });

  it('rejects invalid stixVersion values for bundle exports', async function () {
    await getBundle(
      `/api/release-tracks/${trackId}/snapshots/latest?format=bundle&stixVersion=3.0`,
      400,
    );
  });

  it('GET /api/release-tracks/:id/snapshots/:modified?format=bundle exports a historical snapshot', async function () {
    const bundle = await getBundle(
      `/api/release-tracks/${trackId}/snapshots/${snapshotModified}?format=bundle`,
    );

    expect(bundle.type).toBe('bundle');
    expect(bundle.spec_version).toBeUndefined();
    expect(bundle.objects[0].type).toBe('x-mitre-collection');

    const ids = bundleObjectIds(bundle);
    expect(ids).toContain(memberObject.stix.id);
    expect(ids).not.toContain(candidateWip.stix.id);
    expect(ids).not.toContain(stagedObject.stix.id);
  });

  it('GET /api/release-tracks/:id/snapshots/latest (workbench default) is unaffected by bundle parameters', async function () {
    const snapshot = await getBundle(`/api/release-tracks/${trackId}/snapshots/latest`);
    expect(snapshot.members).toBeDefined();
    expect(snapshot.candidates).toBeDefined();
    expect(snapshot.staged).toBeDefined();
    expect(snapshot.type).toBe('standard');
  });

  after(async function () {
    await database.closeConnection();
  });
});
