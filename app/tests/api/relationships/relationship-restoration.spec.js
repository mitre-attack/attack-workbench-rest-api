const request = require('supertest');
const { expect } = require('expect');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const config = require('../../../config/config');
const login = require('../../shared/login');
const { cloneForCreate } = require('../../shared/clone-for-create');

describe('Relationship restoration after endpoint un-deprecation', function () {
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

  function api(method, path, data) {
    const call = request(app)[method](`/api/${path}`).set('Cookie', cookie);
    return data === undefined ? call : call.send(data);
  }

  async function create(resource, type, name, fields = {}) {
    const timestamp = new Date().toISOString();
    const response = await api('post', resource, {
      workspace: { workflow: { state: 'work-in-progress' } },
      stix: {
        type,
        name,
        spec_version: '2.1',
        created: timestamp,
        modified: timestamp,
        ...(type === 'relationship'
          ? {}
          : { x_mitre_domains: ['mobile-attack'], x_mitre_platforms: ['Android'] }),
        ...fields,
      },
    }).expect(201);
    return response.body;
  }

  function revision(document, fields) {
    const data = cloneForCreate(document);
    data.workspace = { workflow: { state: 'work-in-progress' } };
    data.stix.modified = new Date(
      Math.max(Date.now(), Date.parse(document.stix.modified) + 1),
    ).toISOString();
    Object.assign(data.stix, fields);
    return data;
  }

  async function revise(resource, document, fields) {
    return (await api('post', resource, revision(document, fields)).expect(201)).body;
  }

  async function latest(resource, document) {
    return (await api('get', `${resource}/${document.stix.id}?versions=latest`).expect(200))
      .body[0];
  }

  async function scenario() {
    const source = await create('software', 'malware', 'Marcher', { is_family: true });
    const target = await create(
      'techniques',
      'attack-pattern',
      'Deliver Malicious Application via Other Means',
      {
        x_mitre_is_subtechnique: false,
      },
    );
    const edge = await create('relationships', 'relationship', undefined, {
      source_ref: source.stix.id,
      target_ref: target.stix.id,
      relationship_type: 'uses',
    });
    const retired = await revise('relationships', edge, { x_mitre_deprecated: true });
    return { source, target, edge, retired };
  }

  for (const inactiveEndpoint of ['source', 'target']) {
    for (const inactiveState of ['deprecated', 'revoked']) {
      it(`keeps the existing SRO retired after restoring one endpoint while its ${inactiveEndpoint} is ${inactiveState}`, async function () {
        const { source, target, edge, retired } = await scenario();
        const other = inactiveEndpoint === 'source' ? source : target;
        const restored = inactiveEndpoint === 'source' ? target : source;
        const otherResource = inactiveEndpoint === 'source' ? 'software' : 'techniques';
        const restoredResource = inactiveEndpoint === 'source' ? 'techniques' : 'software';
        const inactive = await revise(restoredResource, restored, { x_mitre_deprecated: true });
        if (inactiveState === 'deprecated') {
          await revise(otherResource, other, { x_mitre_deprecated: true });
        } else {
          const replacement = await create(
            otherResource,
            other.stix.type,
            'Active replacement',
            other.stix.type === 'malware'
              ? { is_family: true }
              : { x_mitre_is_subtechnique: false },
          );
          await api('post', `${otherResource}/${other.stix.id}/revoke`, {
            revoking: { stixId: replacement.stix.id, modified: replacement.stix.modified },
          }).expect(200);
        }

        // Matches the reported sequence when source=Marcher and the technique is restored.
        await revise(restoredResource, inactive, { x_mitre_deprecated: false });
        expect((await latest(restoredResource, restored)).stix.x_mitre_deprecated).toBe(false);
        expect((await latest('relationships', edge)).stix).toEqual(retired.stix);

        // Even an explicit restore request must validate the opposite endpoint's latest state.
        const rejected = await api(
          'post',
          'relationships',
          revision(retired, {
            x_mitre_deprecated: false,
          }),
        ).expect(409);
        expect(rejected.body.code).toBe('inactive_reference');
        expect(rejected.body.references).toContain(other.stix.id);
        expect((await latest('relationships', edge)).stix).toEqual(retired.stix);
        const history = (await api('get', `relationships/${edge.stix.id}?versions=all`).expect(200))
          .body;
        expect(history.map((document) => document.stix.modified).sort()).toEqual(
          [edge.stix.modified, retired.stix.modified].sort(),
        );
        const otherLatest = await latest(otherResource, other);
        expect(
          otherLatest.stix[inactiveState === 'deprecated' ? 'x_mitre_deprecated' : 'revoked'],
        ).toBe(true);
      });
    }
  }

  it('allows explicit SRO restoration once both latest endpoints are active, without changing retired history', async function () {
    const { source, target, edge, retired } = await scenario();
    const inactiveTarget = await revise('techniques', target, { x_mitre_deprecated: true });
    const inactiveSource = await revise('software', source, { x_mitre_deprecated: true });
    await revise('techniques', inactiveTarget, { x_mitre_deprecated: false });
    await revise('software', inactiveSource, { x_mitre_deprecated: false });
    expect((await latest('relationships', edge)).stix).toEqual(retired.stix);

    const restored = await revise('relationships', retired, { x_mitre_deprecated: false });
    expect(restored.stix.id).toBe(edge.stix.id);
    expect(restored.stix.x_mitre_deprecated).toBe(false);
    expect(restored.stix.source_ref).toBe(source.stix.id);
    expect(restored.stix.target_ref).toBe(target.stix.id);
    expect(Date.parse(restored.stix.modified)).toBeGreaterThan(Date.parse(retired.stix.modified));
    const old = (
      await api('get', `relationships/${edge.stix.id}/modified/${retired.stix.modified}`).expect(
        200,
      )
    ).body;
    expect(old.stix).toEqual(retired.stix);
  });
});
