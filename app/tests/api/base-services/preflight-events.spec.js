'use strict';

const { expect } = require('expect');
const sinon = require('sinon');
const EventBus = require('../../../lib/event-bus');
const Events = require('../../../lib/event-constants');
const validationOperation = require('../../../services/system/validation-operation-service');
const graphWriteLock = require('../../../lib/graph-write-lock');
const { ValidationError } = require('../../../exceptions');
const tactics = require('../../../services/stix/tactics-service');
const techniques = require('../../../services/stix/techniques-service');
const attackObjects = require('../../../services/stix/attack-objects-service');
const systemConfiguration = require('../../../services/system/system-configuration-service');
const identities = require('../../../services/stix/identities-service');
const tacticsRepository = require('../../../repository/tactics-repository');
const techniquesRepository = require('../../../repository/techniques-repository');
const attackObjectsRepository = require('../../../repository/attack-objects-repository');

// Exercise the registered owning-service listeners without persisting fixtures.
describe('Required cross-service validation preflight events', function () {
  const tacticId = 'x-mitre-tactic--f691248d-5f1a-438b-815f-148872cea67c';
  const oldIdentity = 'identity--6444f546-6900-4456-b3b1-015c88d70dab';
  const newIdentity = 'identity--cd6053f1-5c19-4474-87ae-49d61e11d067';
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    sandbox.stub(graphWriteLock, 'isHeld').returns(true);
    sandbox.stub(validationOperation, 'run').callsFake((operation) => operation());
  });

  afterEach(function () {
    sandbox.restore();
  });

  function renameTactic(options = {}) {
    sandbox.stub(tacticsRepository, 'retrieveLatestByStixId').resolves({
      stix: { x_mitre_shortname: 'old-phase' },
    });
    return tactics.beforeCreate(
      {
        stix: {
          id: tacticId,
          x_mitre_shortname: 'new-phase',
          x_mitre_domains: ['enterprise-attack'],
        },
      },
      options,
    );
  }

  function changeIdentity() {
    sandbox.stub(identities, 'retrieveById').resolves([{ stix: { id: newIdentity } }]);
    sandbox.stub(systemConfiguration.repository, 'retrieveOne').resolves({
      organization_identity_ref: oldIdentity,
    });
    sandbox
      .stub(systemConfiguration.repository, 'retrieveAllDistinctIdentityRefs')
      .resolves([oldIdentity]);
    return systemConfiguration.setOrganizationIdentity(newIdentity);
  }

  it('rejects a tactic rename with the original ADM error from the technique preflight listener', async function () {
    const failure = new ValidationError('Invalid dependent technique');
    sandbox.stub(techniquesRepository, 'retrieveAllLatestByPhaseName').resolves([
      {
        workspace: {},
        stix: {
          id: 'attack-pattern--f691248d-5f1a-438b-815f-148872cea67c',
          kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'old-phase' }],
        },
      },
    ]);
    sandbox.stub(techniques, 'validateComposedObject').rejects(failure);
    const save = sandbox.spy(techniquesRepository, 'save');
    const options = {};

    await expect(renameTactic(options)).rejects.toBe(failure);
    expect(save.called).toBe(false);
    expect(options.shortnameChange).toBeUndefined();
  });

  it('fails a tactic preflight when its owning listener is unavailable', async function () {
    const event = Events.TACTIC_SHORTNAME_CHANGE_PREFLIGHT_REQUESTED;
    const listeners = EventBus.listeners(event);
    EventBus.removeAllListeners(event);
    try {
      await expect(renameTactic()).rejects.toThrow('requires at least 1 listener');
    } finally {
      listeners.forEach((listener) => EventBus.on(event, listener));
    }
  });

  it('rejects an identity change before saving configuration with the original ADM error', async function () {
    const failure = new ValidationError('Invalid dependent object');
    sandbox.stub(attackObjectsRepository, 'retrieveAllLatestByOrgIdentityRefs').resolves([
      {
        workspace: {},
        stix: { id: tacticId, created_by_ref: oldIdentity },
      },
    ]);
    sandbox.stub(attackObjects, 'validateComposedObject').rejects(failure);
    const createConfig = sandbox.spy(systemConfiguration, '_createNewConfigVersion');
    const save = sandbox.spy(attackObjectsRepository, 'save');

    await expect(changeIdentity()).rejects.toBe(failure);
    expect(createConfig.called).toBe(false);
    expect(save.called).toBe(false);
  });

  it('fails an identity preflight before saving configuration when its owning listener is unavailable', async function () {
    const event = Events.SYSTEM_CONFIGURATION_IDENTITY_CHANGE_PREFLIGHT_REQUESTED;
    const listeners = EventBus.listeners(event);
    const createConfig = sandbox.spy(systemConfiguration, '_createNewConfigVersion');
    EventBus.removeAllListeners(event);
    try {
      await expect(changeIdentity()).rejects.toThrow('requires at least 1 listener');
      expect(createConfig.called).toBe(false);
    } finally {
      listeners.forEach((listener) => EventBus.on(event, listener));
    }
  });
});
