const mitigationsService = require('../../../services/stix/mitigations-service');
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
    type: 'course-of-action',
    description: 'This is a mitigation.',
    external_references: [{ source_name: 'source-1', external_id: 's1' }],
    object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
    created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
    x_mitre_version: '1.1',
  },
};

const options = {
  prefix: 'course-of-action',
  baseUrl: '/api/mitigations',
  label: 'Mitigations',
};
const paginationTests = new PaginationTests(mitigationsService, initialObjectData, options);
paginationTests.executeTests();
