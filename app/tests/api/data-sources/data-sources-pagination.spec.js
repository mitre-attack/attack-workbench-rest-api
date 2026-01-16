const dataSourcesService = require('../../../services/stix/data-sources-service');
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
    type: 'x-mitre-data-source',
    description: 'This is a data source.',
    external_references: [{ source_name: 'source-1', external_id: 's1' }],
    object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
    created_by_ref: 'identity--6444f546-6900-4456-b3b1-015c88d70dab',
  },
};

const options = {
  prefix: 'x-mitre-data-source',
  baseUrl: '/api/data-sources',
  label: 'Data Sources',
};
const paginationTests = new PaginationTests(dataSourcesService, initialObjectData, options);
paginationTests.executeTests();
