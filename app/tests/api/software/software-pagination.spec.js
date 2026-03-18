const softwareService = require('../../../services/stix/software-service');
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
    type: 'malware',
    description: 'This is a malware type of software.',
    is_family: true,
    external_references: [{ source_name: 'source-1', external_id: 's1' }],
    object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
    created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
    x_mitre_version: '1.1',
    x_mitre_aliases: ['software-1'],
    x_mitre_platforms: ['platform-1'],
    x_mitre_contributors: ['contributor-1', 'contributor-2'],
    x_mitre_domains: ['mobile-attack'],
  },
};

const options = {
  prefix: 'software',
  baseUrl: '/api/software',
  label: 'Software',
};
const paginationTests = new PaginationTests(softwareService, initialObjectData, options);
paginationTests.executeTests();
