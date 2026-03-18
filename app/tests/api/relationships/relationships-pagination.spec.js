const relationshipsService = require('../../../services/stix/relationships-service');
const PaginationTests = require('../../shared/pagination');

// modified and created properties will be set before calling REST API
// stix.id property will be created by REST API
const sourceRef1 = 'malware--67e6d66b-1b82-4699-b47a-e2efb6268d14';
const targetRef1 = 'attack-pattern--7b211ac6-c815-4189-93a9-ab415deca926';
const initialObjectData = {
  workspace: {
    workflow: {
      state: 'work-in-progress',
    },
  },
  stix: {
    spec_version: '2.1',
    type: 'relationship',
    description: 'This is a relationship.',
    source_ref: sourceRef1,
    relationship_type: 'uses',
    target_ref: targetRef1,
    external_references: [{ source_name: 'source-1', external_id: 's1' }],
    object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
    created_by_ref: 'identity--6444f546-6900-4456-b3b1-015c88d70dab',
  },
};

const options = {
  prefix: 'relationship',
  baseUrl: '/api/relationships',
  label: 'Relationships',
};
const paginationTests = new PaginationTests(relationshipsService, initialObjectData, options);
paginationTests.executeTests();
