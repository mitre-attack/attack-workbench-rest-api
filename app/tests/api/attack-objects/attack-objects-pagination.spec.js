const techniquesService = require('../../../services/stix/techniques-service');
const PaginationTests = require('../../shared/pagination');

// modified and created properties will be set before calling REST API
// stix.id property will be created by REST API
const initialObjectData = {
  workspace: {
    workflow: {
      state: 'work-in-progress',
    },
  },
  stix: {
    spec_version: '2.1',
    type: 'attack-pattern',
    description: 'This is a technique.',
    object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
    created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
    kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'execution' }],
    x_mitre_detection: 'detection text',
    x_mitre_is_subtechnique: false,
    x_mitre_platforms: ['Linux', 'macOS'],
  },
};

// Use the techniques service for creating objects, but the attack-objects API for retrieving them
// Include the state so that the placeholder organization identity isn't retrieved (which would throw off the numbers)
const options = {
  prefix: 'attack-pattern',
  baseUrl: '/api/attack-objects',
  label: 'Attack Objects',
  state: 'work-in-progress',
  // The seeded fixture is ADM-compliant; pin validation on so this suite does
  // not inherit the flag from whichever spec ran before it.
  validateWithAdm: true,
};
const paginationTests = new PaginationTests(techniquesService, initialObjectData, options);
paginationTests.executeTests();
