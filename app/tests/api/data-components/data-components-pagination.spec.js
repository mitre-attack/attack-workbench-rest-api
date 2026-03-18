const dataComponentsService = require('../../../services/stix/data-components-service');
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
    type: 'x-mitre-data-component',
    description: 'This is a data component.',
    external_references: [{ source_name: 'source-1', external_id: 's1' }],
    object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
    created_by_ref: 'identity--6444f546-6900-4456-b3b1-015c88d70dab',
    x_mitre_log_sources: [
      {
        name: 'perm-1',
        channel: 'channel-1',
      },
      {
        name: 'perm-2',
        channel: 'channel-2',
      },
    ],
  },
};

const options = {
  prefix: 'x-mitre-data-component',
  baseUrl: '/api/data-components',
  label: 'Data Components',
};
const paginationTests = new PaginationTests(dataComponentsService, initialObjectData, options);
paginationTests.executeTests();
