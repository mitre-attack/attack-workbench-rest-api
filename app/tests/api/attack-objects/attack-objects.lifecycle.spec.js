const request = require('supertest');
const { expect } = require('expect');
const { randomUUID } = require('crypto');

const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const config = require('../../../config/config');
const login = require('../../shared/login');
const AttackObject = require('../../../models/attack-object-model');

// Exercise the public API with ADM enabled. The sole model write below constructs
// legacy imported inactive objects that cannot be authored through guarded APIs.
describe('Attack object lifecycle graph integrity API', function () {
  let app;
  let cookie;

  before(async function () {
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();
    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;
    app = await require('../../../index').initializeApp();
    const session = await login.loginAnonymous(app);
    cookie = `${session.name}=${session.value}`;
  });

  after(async function () {
    await database.closeConnection();
  });

  function api(method, path, body) {
    const call = request(app)[method](path).set('Accept', 'application/json').set('Cookie', cookie);
    return body === undefined ? call : call.send(body);
  }

  function payload(type, fields = {}) {
    const timestamp = new Date().toISOString();
    return {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        type,
        spec_version: '2.1',
        created: timestamp,
        modified: timestamp,
        ...(type === 'relationship'
          ? {}
          : {
              name: `lifecycle-${randomUUID()}`,
              x_mitre_domains: ['enterprise-attack'],
            }),
        ...fields,
      },
    };
  }

  async function create(resource, type, fields = {}) {
    const response = await api('post', `/api/${resource}`, payload(type, fields)).expect(201);
    return response.body;
  }

  function technique() {
    return create('techniques', 'attack-pattern', {
      x_mitre_is_subtechnique: false,
      x_mitre_platforms: ['Windows'],
    });
  }

  function component(fields = {}) {
    return create('data-components', 'x-mitre-data-component', fields);
  }

  function analytic(refs) {
    return create('analytics', 'x-mitre-analytic', {
      x_mitre_platforms: ['Windows'],
      ...(refs ? { x_mitre_log_source_references: refs } : {}),
    });
  }

  function logSource(target, name = 'Security', channel = 'Operational') {
    return { x_mitre_data_component_ref: target.stix.id, name, channel };
  }

  function relationshipBody(source, target, type = 'subtechnique-of') {
    return payload('relationship', {
      relationship_type: type,
      source_ref: source.stix.id,
      target_ref: target.stix.id,
    });
  }

  function revision(object, changes = {}) {
    return {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        ...object.stix,
        modified: new Date(
          Math.max(Date.now(), Date.parse(object.stix.modified) + 1),
        ).toISOString(),
        ...changes,
      },
    };
  }

  async function revise(resource, object, changes) {
    const response = await api('post', `/api/${resource}`, revision(object, changes)).expect(201);
    return response.body;
  }

  async function latest(resource, object) {
    const response = await api('get', `/api/${resource}/${object.stix.id}?versions=latest`).expect(
      200,
    );
    expect(response.body).toHaveLength(1);
    return response.body[0];
  }

  async function versions(resource, object) {
    const response = await api('get', `/api/${resource}/${object.stix.id}?versions=all`).expect(
      200,
    );
    return response.body;
  }

  async function check(object) {
    const response = await api(
      'get',
      `/api/attack-objects/${object.stix.id}/deprecation-check`,
    ).expect(200);
    return response.body;
  }

  async function legacyInactive(object, field = 'x_mitre_deprecated') {
    await AttackObject.collection.updateOne(
      { 'stix.id': object.stix.id, 'stix.modified': new Date(object.stix.modified) },
      { $set: { [`stix.${field}`]: true } },
    );
    return { ...object, stix: { ...object.stix, [field]: true } };
  }

  function revoke(resource, original, replacement, query = '') {
    return api(
      'post',
      `/api/${resource}/${original.stix.id}/revoke?preserveRelationships=true${query}`,
      {
        revoking: { stixId: replacement.stix.id, modified: replacement.stix.modified },
      },
    );
  }

  it('returns 404 for a missing deprecation-check object', async function () {
    await api(
      'get',
      `/api/attack-objects/attack-pattern--${randomUUID()}/deprecation-check`,
    ).expect(404);
  });

  for (const relationshipType of ['subtechnique-of', 'revoked-by']) {
    for (const endpoint of ['source', 'target']) {
      it(`preserves active ${relationshipType} when deprecating its ${endpoint}`, async function () {
        const source = await technique();
        const target = await technique();
        const response = await api(
          'post',
          '/api/relationships',
          relationshipBody(source, target, relationshipType),
        ).expect(201);
        const relationship = response.body;
        const object = endpoint === 'source' ? source : target;
        expect(await check(object)).toEqual({
          stix_id: object.stix.id,
          can_deprecate: true,
          blockers: { sros: [], embedded: [] },
        });
        expect(
          (await revise('techniques', object, { x_mitre_deprecated: true })).stix
            .x_mitre_deprecated,
        ).toBe(true);
        expect((await latest('relationships', relationship)).stix).toEqual(relationship.stix);
        expect(await versions('relationships', relationship)).toHaveLength(1);

        // The cascade exemption does not prevent explicitly retiring the SRO itself.
        expect(await check(relationship)).toEqual({
          stix_id: relationship.stix.id,
          can_deprecate: true,
          blockers: { sros: [], embedded: [] },
        });
        const retired = await revise('relationships', relationship, { x_mitre_deprecated: true });
        expect(retired.stix.x_mitre_deprecated).toBe(true);
        expect(await versions('relationships', relationship)).toHaveLength(2);
      });
    }
  }

  it('blocks ordinary SROs in both directions while preserving hierarchy and replacement links', async function () {
    const source = await create('software', 'malware', { is_family: true });
    const target = await technique();
    const parent = await technique();
    const predecessor = await technique();
    const hierarchy = await api(
      'post',
      '/api/relationships',
      relationshipBody(target, parent, 'subtechnique-of'),
    ).expect(201);
    const replacement = await api(
      'post',
      '/api/relationships',
      relationshipBody(predecessor, target, 'revoked-by'),
    ).expect(201);
    const ordinary = await api(
      'post',
      '/api/relationships',
      relationshipBody(source, target, 'uses'),
    ).expect(201);
    for (const [object, resource, direction] of [
      [source, 'software', 'outbound'],
      [target, 'techniques', 'inbound'],
    ]) {
      const eligibility = await check(object);
      expect(eligibility).toEqual({
        stix_id: object.stix.id,
        can_deprecate: false,
        blockers: {
          sros: [
            {
              stix_id: ordinary.body.stix.id,
              modified: ordinary.body.stix.modified,
              relationship_type: 'uses',
              direction,
            },
          ],
          embedded: [],
        },
      });
      const rejected = await api(
        'post',
        `/api/${resource}`,
        revision(object, { x_mitre_deprecated: true }),
      ).expect(409);
      expect(rejected.body).toEqual({
        message: expect.any(String),
        code: 'deprecation_blocked',
        ...eligibility,
      });
      expect(await versions(resource, object)).toHaveLength(1);
    }
    await revise('relationships', ordinary.body, { x_mitre_deprecated: true });
    for (const [object, resource] of [
      [source, 'software'],
      [target, 'techniques'],
    ]) {
      expect((await check(object)).can_deprecate).toBe(true);
      await revise(resource, object, { x_mitre_deprecated: true });
    }
    for (const preserved of [hierarchy.body, replacement.body]) {
      expect((await latest('relationships', preserved)).stix).toEqual(preserved.stix);
      expect(await versions('relationships', preserved)).toHaveLength(1);
    }
  });

  it('still blocks embedded references alongside a preserved replacement link', async function () {
    const target = await component();
    const replacement = await component();
    const source = await analytic([logSource(target)]);
    const relationship = await api(
      'post',
      '/api/relationships',
      relationshipBody(target, replacement, 'revoked-by'),
    ).expect(201);
    const eligibility = await check(target);
    expect(eligibility.can_deprecate).toBe(false);
    expect(eligibility.blockers.sros).toEqual([]);
    expect(eligibility.blockers.embedded).toEqual([
      {
        source_ref: source.stix.id,
        target_ref: target.stix.id,
        path: 'x_mitre_log_source_references[0].x_mitre_data_component_ref',
        direction: 'inbound',
      },
    ]);
    const rejected = await api(
      'post',
      '/api/data-components',
      revision(target, { x_mitre_deprecated: true }),
    ).expect(409);
    expect(rejected.body.code).toBe('deprecation_blocked');
    expect(rejected.body.blockers).toEqual(eligibility.blockers);
    expect(await versions('data-components', target)).toHaveLength(1);
    expect((await latest('relationships', relationship.body)).stix).toEqual(relationship.body.stix);
    expect(await versions('relationships', relationship.body)).toHaveLength(1);
  });

  it('counts latest inbound and outbound embedded refs, ignoring removed historical refs', async function () {
    const first = await component();
    const second = await component();
    const source = await analytic([logSource(first)]);
    const edge = {
      source_ref: source.stix.id,
      target_ref: first.stix.id,
      path: 'x_mitre_log_source_references[0].x_mitre_data_component_ref',
    };
    expect((await check(first)).blockers.embedded).toEqual([{ ...edge, direction: 'inbound' }]);
    expect((await check(source)).blockers.embedded).toEqual([{ ...edge, direction: 'outbound' }]);
    await api('post', '/api/analytics', revision(source, { x_mitre_deprecated: true })).expect(409);
    const updated = await revise('analytics', source, {
      x_mitre_log_source_references: [logSource(second)],
    });
    expect((await check(first)).can_deprecate).toBe(true);
    expect((await check(second)).blockers.embedded).toEqual([
      {
        ...edge,
        target_ref: second.stix.id,
        direction: 'inbound',
      },
    ]);
    const removal = revision(updated);
    delete removal.stix.x_mitre_log_source_references;
    await api('post', '/api/analytics', removal).expect(201);
    expect((await check(second)).can_deprecate).toBe(true);
    expect((await check(source)).can_deprecate).toBe(true);
  });

  for (const field of ['revoked', 'x_mitre_deprecated']) {
    it(`counts an imported ${field} inbound referrer as a blocker`, async function () {
      const target = await component();
      const source = await analytic([logSource(target)]);
      await legacyInactive(source, field);
      const eligibility = await check(target);
      expect(eligibility.can_deprecate).toBe(false);
      expect(eligibility.blockers.embedded).toEqual([
        {
          source_ref: source.stix.id,
          target_ref: target.stix.id,
          path: 'x_mitre_log_source_references[0].x_mitre_data_component_ref',
          direction: 'inbound',
        },
      ]);
      const rejected = await api(
        'post',
        '/api/data-components',
        revision(target, {
          x_mitre_deprecated: true,
        }),
      ).expect(409);
      expect(rejected.body.code).toBe('deprecation_blocked');
      expect(rejected.body.blockers).toEqual(eligibility.blockers);
    });

    for (const endpoint of ['source', 'target']) {
      it(`rejects ordinary SROs with a ${field} ${endpoint}, but permits revoked-by`, async function () {
        let source = await technique();
        let target = await technique();
        if (endpoint === 'source') source = await legacyInactive(source, field);
        else target = await legacyInactive(target, field);
        const rejected = await api(
          'post',
          '/api/relationships',
          relationshipBody(source, target),
        ).expect(409);
        expect(rejected.body.code).toBe('inactive_reference');
        expect(rejected.body.references.length).toBeGreaterThan(0);
        await api(
          'post',
          '/api/relationships',
          relationshipBody(source, target, 'revoked-by'),
        ).expect(201);
      });
    }
  }

  it('allows retiring a legacy ordinary SRO whose endpoint is already inactive', async function () {
    const source = await technique();
    const target = await technique();
    const response = await api(
      'post',
      '/api/relationships',
      relationshipBody(source, target),
    ).expect(201);
    await legacyInactive(target);
    const retired = await revise('relationships', response.body, { x_mitre_deprecated: true });
    expect(retired.stix.x_mitre_deprecated).toBe(true);
    expect((await check(source)).can_deprecate).toBe(true);
  });

  it('rejects new inactive domain refs but permits unchanged legacy refs on an unrelated revision', async function () {
    const target = await component();
    const source = await analytic([logSource(target)]);
    await legacyInactive(target);
    const rejected = await api(
      'post',
      '/api/analytics',
      payload('x-mitre-analytic', {
        x_mitre_platforms: ['Windows'],
        x_mitre_log_source_references: [logSource(target)],
      }),
    ).expect(409);
    expect(rejected.body.code).toBe('inactive_reference');
    expect(rejected.body.references.length).toBeGreaterThan(0);
    const unlinked = await analytic();
    const rejectedRevision = await api(
      'post',
      '/api/analytics',
      revision(unlinked, {
        x_mitre_log_source_references: [logSource(target)],
      }),
    ).expect(409);
    expect(rejectedRevision.body.code).toBe('inactive_reference');
    expect(await versions('analytics', unlinked)).toHaveLength(1);
    const retained = await revise('analytics', source, {
      description: 'Unrelated legacy metadata edit',
    });
    expect(retained.stix.x_mitre_log_source_references).toEqual(
      source.stix.x_mitre_log_source_references,
    );
    const removal = revision(retained, { x_mitre_deprecated: true });
    delete removal.stix.x_mitre_log_source_references;
    const retired = await api('post', '/api/analytics', removal).expect(201);
    expect(retired.body.stix.x_mitre_deprecated).toBe(true);
    expect((await check(target)).blockers.embedded).toEqual([]);
  });

  it('migrates inbound log sources without losing name, channel, duplicate-target details or existing B refs', async function () {
    const original = await component();
    const replacement = await component();
    const refs = [
      logSource(original, 'Original one', 'Channel one'),
      logSource(original, 'Original two', 'Channel two'),
      logSource(replacement, 'Retained B', 'Channel B'),
    ];
    const source = await analytic(refs);
    await revoke('data-components', original, replacement).expect(200);
    const migrated = await latest('analytics', source);
    expect(migrated.stix.x_mitre_log_source_references).toHaveLength(3);
    expect(migrated.stix.x_mitre_log_source_references).toEqual(
      expect.arrayContaining(
        refs.map((ref) => ({ ...ref, x_mitre_data_component_ref: replacement.stix.id })),
      ),
    );
    expect((await latest('data-components', original)).stix.revoked).toBe(true);
    expect((await check(original)).blockers.embedded).toEqual([]);
  });

  for (const alreadyReferenced of [false, true]) {
    it(`preserves outgoing data-source refs and B metadata (B already references source: ${alreadyReferenced})`, async function () {
      const dataSource = await create('data-sources', 'x-mitre-data-source');
      const original = await component({ x_mitre_data_source_ref: dataSource.stix.id });
      const replacement = await component({
        ...(alreadyReferenced ? { x_mitre_data_source_ref: dataSource.stix.id } : {}),
        x_mitre_log_sources: [{ name: 'Retained B event', channel: 'Retained B channel' }],
      });
      await revoke('data-components', original, replacement).expect(200);
      const migrated = await latest('data-components', replacement);
      expect(migrated.stix.name).toBe(replacement.stix.name);
      expect(migrated.stix.x_mitre_data_source_ref).toBe(dataSource.stix.id);
      expect(migrated.stix.x_mitre_log_sources).toEqual(replacement.stix.x_mitre_log_sources);
      const revoked = await latest('data-components', original);
      expect(revoked.stix.revoked).toBe(true);
      expect(revoked.stix.x_mitre_data_source_ref).toBe(dataSource.stix.id);
      expect((await check(dataSource)).blockers.embedded.map((edge) => edge.source_ref)).toEqual(
        expect.arrayContaining([original.stix.id, replacement.stix.id]),
      );
    });
  }

  it('rejects scalar-ref merge conflicts before revoking A or creating any revisions', async function () {
    const first = await create('data-sources', 'x-mitre-data-source');
    const second = await create('data-sources', 'x-mitre-data-source');
    const original = await component({ x_mitre_data_source_ref: first.stix.id });
    const replacement = await component({ x_mitre_data_source_ref: second.stix.id });
    const beforeA = await versions('data-components', original);
    const beforeB = await versions('data-components', replacement);
    await revoke('data-components', original, replacement).expect(409);
    expect(await versions('data-components', original)).toEqual(beforeA);
    expect(await versions('data-components', replacement)).toEqual(beforeB);
    expect((await latest('data-components', original)).stix.revoked).not.toBe(true);
    expect((await check(original)).blockers.sros).toEqual([]);
  });

  it('rejects an inactive inbound referrer preflight without partial migration or revocation', async function () {
    const original = await component();
    const replacement = await component();
    const active = await analytic([logSource(original)]);
    const inactive = await analytic([logSource(original)]);
    await legacyInactive(inactive);
    const beforeA = await versions('data-components', original);
    const beforeB = await versions('data-components', replacement);
    const beforeActive = await versions('analytics', active);
    const beforeInactive = await versions('analytics', inactive);
    await revoke('data-components', original, replacement).expect(409);
    expect(await versions('data-components', original)).toEqual(beforeA);
    expect(await versions('data-components', replacement)).toEqual(beforeB);
    expect(await versions('analytics', active)).toEqual(beforeActive);
    expect(await versions('analytics', inactive)).toEqual(beforeInactive);
    expect((await latest('data-components', original)).stix.revoked).not.toBe(true);
    expect((await check(original)).blockers.sros).toEqual([]);
  });

  it('does not persist a dry-run reference revision or backlinks and does not leak options to later writes', async function () {
    const first = await component();
    const second = await component();
    const source = await analytic([logSource(first)]);
    const beforeSource = await versions('analytics', source);
    const beforeFirst = await versions('data-components', first);
    const beforeSecond = await versions('data-components', second);
    const proposed = revision(source, { x_mitre_log_source_references: [logSource(second)] });
    const preview = await api('post', '/api/analytics?dryRun=true', proposed).expect(200);
    expect(preview.body.stix.x_mitre_log_source_references).toEqual([logSource(second)]);
    expect(await versions('analytics', source)).toEqual(beforeSource);
    expect(await versions('data-components', first)).toEqual(beforeFirst);
    expect(await versions('data-components', second)).toEqual(beforeSecond);
    expect((await check(first)).can_deprecate).toBe(false);
    expect((await check(second)).can_deprecate).toBe(true);
    const unrelated = await analytic();
    expect((await latest('analytics', unrelated)).stix.id).toBe(unrelated.stix.id);
    await api('post', '/api/analytics', proposed).expect(201);
    expect((await check(first)).can_deprecate).toBe(true);
    expect((await check(second)).can_deprecate).toBe(false);
  });

  it('requires an active latest replacement before any revocation side effects', async function () {
    const original = await component();
    const replacement = await component();
    const newer = await revise('data-components', replacement, { description: 'new revision' });
    await revoke('data-components', original, replacement).expect(409);
    await legacyInactive(newer);
    await revoke('data-components', original, newer).expect(409);
    expect((await latest('data-components', original)).stix.revoked).not.toBe(true);
    expect(await versions('data-components', original)).toHaveLength(1);
    expect((await check(original)).blockers.sros).toEqual([]);
  });

  it('rejects a newly added log-source occurrence to an inactive component while allowing reorder', async function () {
    const target = await component();
    const first = logSource(target, 'Security', 'one');
    const second = logSource(target, 'Security', 'two');
    const source = await analytic([first, second]);
    await legacyInactive(target);
    const reordered = await revise('analytics', source, {
      x_mitre_log_source_references: [second, first],
    });
    await api(
      'post',
      '/api/analytics',
      revision(reordered, {
        x_mitre_log_source_references: [second, first, logSource(target, 'Security', 'three')],
      }),
    ).expect(409);
  });

  it('fails closed while another Mongo graph-write owner holds the lock', async function () {
    const lock = require('../../../repository/graph-write-lock-repository');
    const token = randomUUID();
    await lock.acquire(token);
    try {
      const response = await api(
        'post',
        '/api/data-components',
        payload('x-mitre-data-component'),
      ).expect(409);
      expect(response.body.code).toBe('graph_write_conflict');
    } finally {
      await lock.release(token);
    }
  });

  it('recursively extracts domain refs but excludes attribution, markings, and inventory', function () {
    const { references } = require('../../../lib/domain-references');
    const source = `x-mitre-analytic--${randomUUID()}`;
    const target = `x-mitre-data-component--${randomUUID()}`;
    const refs = references({
      id: source,
      type: 'x-mitre-analytic',
      created_by_ref: target,
      x_mitre_modified_by_ref: target,
      object_marking_refs: [target],
      granular_markings: [{ marking_ref: target }],
      x_mitre_contents: [{ object_ref: target }],
      x_mitre_log_source_references: [
        { x_mitre_data_component_ref: target, name: 'a', channel: 'b' },
      ],
      nested: { object_refs: [target] },
    });
    expect(refs.map((ref) => ref.path)).toEqual([
      'x_mitre_log_source_references[0].x_mitre_data_component_ref',
      'nested.object_refs[0]',
    ]);
  });

  it('merges outgoing log-source records semantically without losing replacement data', function () {
    const { mergeOutgoing, substitute } = require('../../../lib/domain-references');
    const a = `x-mitre-analytic--${randomUUID()}`;
    const b = `x-mitre-analytic--${randomUUID()}`;
    const target = { stix: { id: `x-mitre-data-component--${randomUUID()}` } };
    const common = logSource(target);
    const addition = logSource(target, 'Sysmon', 'Operational');
    const original = {
      type: 'x-mitre-analytic',
      id: a,
      x_mitre_log_source_references: [common, addition],
    };
    const replacement = {
      type: 'x-mitre-analytic',
      id: b,
      name: 'Replacement',
      x_mitre_log_source_references: [common],
    };
    const merged = mergeOutgoing(replacement, original, a, b);
    expect(merged.name).toBe('Replacement');
    expect(merged.x_mitre_log_source_references).toEqual([common, addition]);
    expect(replacement.x_mitre_log_source_references).toEqual([common]);
    expect(
      substitute({ type: 'x-mitre-detection-strategy', x_mitre_analytic_refs: [a, b] }, a, b)
        .x_mitre_analytic_refs,
    ).toEqual([b]);
  });

  for (const edgeKind of ['sro', 'embedded']) {
    it(`serializes competing ${edgeKind} creation and deprecation without leaving an active edge to an inactive target`, async function () {
      // Repeat with independent IDs, racing actual requests rather than mocking a lock.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const target = edgeKind === 'sro' ? await technique() : await component();
        const source = edgeKind === 'sro' ? await create('groups', 'intrusion-set') : undefined;
        const resource = edgeKind === 'sro' ? 'techniques' : 'data-components';
        const body =
          edgeKind === 'sro'
            ? relationshipBody(source, target, 'uses')
            : payload('x-mitre-analytic', {
                x_mitre_platforms: ['Windows'],
                x_mitre_log_source_references: [logSource(target)],
              });
        const edgeRequest = () =>
          api('post', edgeKind === 'sro' ? '/api/relationships' : '/api/analytics', body);
        const deprecationRequest = () =>
          api('post', `/api/${resource}`, revision(target, { x_mitre_deprecated: true }));
        const calls =
          attempt % 2 === 0
            ? [edgeRequest(), deprecationRequest()]
            : [deprecationRequest(), edgeRequest()];
        const results = await Promise.all(calls);
        expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
        expect(['inactive_reference', 'deprecation_blocked', 'graph_write_conflict']).toContain(
          results.find((result) => result.status === 409).body.code,
        );
        const stored = await latest(resource, target);
        const eligibility = await check(target);
        const edges =
          edgeKind === 'sro' ? eligibility.blockers.sros : eligibility.blockers.embedded;
        if (stored.stix.x_mitre_deprecated) {
          expect(edges).toEqual([]);
        } else {
          expect(edges).toHaveLength(1);
          expect(eligibility.can_deprecate).toBe(false);
        }
      }
    });
  }
});
