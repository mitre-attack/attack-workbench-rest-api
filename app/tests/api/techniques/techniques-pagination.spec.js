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
    // Removed external_references - backend generates ATT&CK IDs and external references
    object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
    created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
    kill_chain_phases: [{ kill_chain_name: 'kill-chain-name-1', phase_name: 'phase-1' }],
    x_mitre_data_sources: ['data-source-1', 'data-source-2'],
    x_mitre_detection: 'detection text',
    x_mitre_is_subtechnique: false,
    x_mitre_impact_type: ['impact-1'],
    x_mitre_platforms: ['platform-1', 'platform-2'],
  },
};

const options = {
  prefix: 'attack-pattern',
  baseUrl: '/api/techniques',
  label: 'Techniques',
};
const paginationTests = new PaginationTests(techniquesService, initialObjectData, options);
paginationTests.executeTests();
