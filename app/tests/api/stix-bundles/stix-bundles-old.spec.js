const request = require('supertest');
const { expect } = require('expect');

const config = require('../../../config/config');
const logger = require('../../../lib/logger');
logger.level = 'debug';

const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');

const enterpriseDomain = 'enterprise-attack';
const mobileDomain = 'mobile-attack';
const icsDomain = 'ics-attack';

const collectionId = 'x-mitre-collection--30ee11cf-0a05-4d9e-ab54-9b8563669647';
const collectionTimestamp = new Date().toISOString();

const markingDefinitionId = 'marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168';
const mitreIdentityId = 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5';

const initialObjectData = {
  type: 'bundle',
  id: 'bundle--0cde353c-ea5b-4668-9f68-971946609282',
  spec_version: '2.1',
  objects: [
    {
      id: collectionId,
      created: collectionTimestamp,
      modified: collectionTimestamp,
      name: 'collection-1',
      spec_version: '2.1',
      type: 'x-mitre-collection',
      description: 'This is a collection.',
      external_references: [],
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      x_mitre_contents: [
        {
          object_ref: 'attack-pattern--2204c371-6100-4ae0-82f3-25c07c29772a',
          object_modified: '2020-03-30T14:03:43.761Z',
        },
        {
          object_ref: 'attack-pattern--1eaebf46-e361-4437-bc23-d5d65a3b92e3',
          object_modified: '2020-02-17T13:14:31.140Z',
        },
        {
          object_ref: 'attack-pattern--82f04b1e-5371-4a6f-be06-411f0f43b483',
          object_modified: '2019-02-03T16:56:41.200Z',
        },
        {
          object_ref: 'attack-pattern--2bb2861b-fb40-42dc-b15f-1a6b64b6a39f',
          object_modified: '2019-02-03T16:56:41.200Z',
        },
        {
          object_ref: 'course-of-action--25dc1ce8-eb55-4333-ae30-a7cb4f5894a1',
          object_modified: '2018-10-17T00:14:20.652Z',
        },
        {
          object_ref: 'course-of-action--e944670c-d03a-4e93-a21c-b3d4c53ec4c9',
          object_modified: '2018-10-17T00:14:20.652Z',
        },
        {
          object_ref: 'malware--04227b24-7817-4de1-9050-b7b1b57f5866',
          object_modified: '2020-03-30T18:17:52.697Z',
        },
        {
          object_ref: 'intrusion-set--8a831aaa-f3e0-47a3-bed8-a9ced744dd12',
          object_modified: '2020-06-03T20:22:40.401Z',
        },
        {
          object_ref: 'intrusion-set--ed0222fb-b970-4337-b9a2-62aeb02860e5',
          object_modified: '2023-05-02T20:19:40.401Z',
        },
        {
          object_ref: 'relationship--12098dee-27b3-4d0b-a15a-6b5955ba8879',
          object_modified: '2019-09-04T14:32:13.000Z',
        },
        {
          object_ref: 'intrusion-set--6b9ebeb5-20bf-48b0-afb7-988d769a2f01',
          object_modified: '2020-05-15T15:44:47.629Z',
        },
        {
          object_ref: 'campaign--a3038910-f8ca-4ba8-b116-21d0f333f231',
          object_modified: '2020-07-03T20:22:40.401Z',
        },
        {
          object_ref: 'campaign--649b389e-1f7a-4696-8a95-04d0851bd551',
          object_modified: '2020-07-03T20:22:40.401Z',
        },
        {
          object_ref: mitreIdentityId,
          object_modified: '2017-06-01T00:00:00.000Z',
        },
        {
          object_ref: markingDefinitionId,
          object_modified: '2017-06-01T00:00:00Z',
        },
        {
          object_ref: 'note--6b9456275-20bf-48b0-afb7-988d769a2f99',
          object_modified: '2020-04-12T15:44:47.629Z',
        },
        {
          object_ref: 'x-mitre-data-source--880b771b-17a8-4a6c-a259-9027c395010c',
          object_modified: '2020-04-12T15:44:47.629Z',
        },
        {
          object_ref: 'x-mitre-data-source--3e396a50-dd74-45cf-b8a3-974ab80c9a3e',
          object_modified: '2020-04-12T15:44:47.629Z',
        },
        {
          object_ref: 'x-mitre-data-component--47667153-e24d-4514-bdf4-5720312d9e7d',
          object_modified: '2020-04-12T15:44:47.629Z',
        },
        {
          object_ref: 'x-mitre-data-component--f8b4833e-a6d4-4a05-ba6e-1936d4109d0a',
          object_modified: '2020-04-12T15:44:47.629Z',
        },
        {
          object_ref: 'relationship--caa8928b-0bf6-45cd-8504-6c27b9cd96a8',
          object_modified: '2019-09-04T14:32:13.000Z',
        },
        {
          object_ref: 'relationship--b0c6c76c-7699-447f-9f3f-573aec51431c',
          object_modified: '2019-09-04T14:32:13.000Z',
        },
        {
          object_ref: 'relationship--e7f994c6-3e08-4aea-a30e-97cc6fe610c6',
          object_modified: '2019-09-04T14:32:13.000Z',
        },
        {
          object_ref: 'relationship--89586929-ca62-423f-94bf-cc03ec8161bb',
          object_modified: '2021-06-06T14:00:00.000Z',
        },
        {
          object_ref: 'relationship--21d3572e-398d-4473-93eb-eb9a2a069d53',
          object_modified: '2021-06-07T14:00:00.000Z',
        },
        {
          object_ref: 'relationship--a5a80c31-0dde-4fd7-a520-a7593d21c954',
          object_modified: '2021-06-08T14:00:00.000Z',
        },
        {
          object_ref: 'relationship--1e1c5e5a-2a3e-423f-b1d0-67b7dc5b90cc',
          object_modified: '2023-06-08T14:00:00.000Z',
        },
        {
          object_ref: 'relationship--d5426745-9530-485e-a757-d8c540f600f8',
          object_modified: '2021-06-06T14:00:00.000Z',
        },
      ],
    },
    {
      id: mitreIdentityId,
      name: 'The MITRE Corporation',
      identity_class: 'organization',
      object_marking_refs: [markingDefinitionId],
      type: 'identity',
      modified: '2017-06-01T00:00:00.000Z',
      created: '2017-06-01T00:00:00.000Z',
      spec_version: '2.1',
    },
    {
      type: 'marking-definition',
      id: markingDefinitionId,
      created_by_ref: mitreIdentityId,
      created: '2017-06-01T00:00:00Z',
      definition_type: 'statement',
      definition: {
        statement:
          'Copyright 2015-2021, The MITRE Corporation. MITRE ATT&CK and ATT&CK are registered trademarks of The MITRE Corporation.',
      },
      spec_version: '2.1',
    },
    {
      id: 'attack-pattern--2204c371-6100-4ae0-82f3-25c07c29772a',
      created: '2020-03-30T14:03:43.761Z',
      modified: '2020-03-30T14:03:43.761Z',
      name: 'attack-pattern-1',
      x_mitre_version: '1.0',
      spec_version: '2.1',
      type: 'attack-pattern',
      description: 'This is a technique.',
      external_references: [
        { source_name: 'mitre-attack', external_id: 'T1' },
        {
          source_name: 'attack-pattern-1 source',
          description: 'this is a source description',
        },
      ],
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      kill_chain_phases: [{ kill_chain_name: 'kill-chain-name-1', phase_name: 'phase-1' }],
      x_mitre_data_sources: ['Command: Command Execution', 'Network Traffic: Network Traffic Flow'],
      x_mitre_detection: 'detection text',
      x_mitre_is_subtechnique: false,
      x_mitre_impact_type: ['impact-1'],
      x_mitre_platforms: ['platform-1', 'platform-2'],
      x_mitre_domains: [enterpriseDomain],
    },
    {
      id: 'attack-pattern--1eaebf46-e361-4437-bc23-d5d65a3b92e3',
      created: '2020-02-12T18:55:24.728Z',
      modified: '2020-02-17T13:14:31.140Z',
      name: 'attack-pattern-2',
      x_mitre_version: '1.0',
      spec_version: '2.1',
      type: 'attack-pattern',
      description: 'This is a technique.',
      external_references: [
        { source_name: 'mitre-attack', external_id: 'T1' },
        {
          source_name: 'attack-pattern-1 source',
          description: 'this is a source description',
        },
      ],
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      kill_chain_phases: [{ kill_chain_name: 'kill-chain-name-1', phase_name: 'phase-1' }],
      x_mitre_detection: 'detection text',
      x_mitre_is_subtechnique: false,
      x_mitre_impact_type: ['impact-1'],
      x_mitre_platforms: ['platform-1', 'platform-2'],
      x_mitre_domains: [mobileDomain],
    },
    {
      id: 'attack-pattern--82f04b1e-5371-4a6f-be06-411f0f43b483',
      created: '2019-02-03T16:56:41.200Z',
      modified: '2019-02-03T16:56:41.200Z',
      name: 'attack-pattern-3',
      x_mitre_version: '1.0',
      spec_version: '2.1',
      type: 'attack-pattern',
      description: 'This is another technique.',
      external_references: [
        { source_name: 'mitre-attack', external_id: 'T1' },
        {
          source_name: 'attack-pattern-2 source',
          description: 'this is a source description 2',
        },
      ],
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      kill_chain_phases: [{ kill_chain_name: 'kill-chain-name-1', phase_name: 'phase-1' }],
      x_mitre_data_sources: [
        'Operational Databases: Device Alarm',
        'Network Traffic: Network Traffic Flow',
      ],
      x_mitre_detection: 'detection text',
      x_mitre_is_subtechnique: false,
      x_mitre_impact_type: ['impact-1'],
      x_mitre_platforms: ['platform-1', 'platform-2'],
      x_mitre_domains: [icsDomain],
    },
    {
      id: 'attack-pattern--2bb2861b-fb40-42dc-b15f-1a6b64b6a39f',
      created: '2019-02-03T16:56:41.200Z',
      modified: '2019-02-03T16:56:41.200Z',
      name: 'attack-pattern-4',
      x_mitre_version: '1.0',
      spec_version: '2.1',
      type: 'attack-pattern',
      description: 'This is another technique.',
      external_references: [
        { source_name: 'mitre-attack', external_id: 'T1' },
        {
          source_name: 'attack-pattern-2 source',
          description: 'this is a source description 2',
        },
      ],
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      kill_chain_phases: [{ kill_chain_name: 'kill-chain-name-1', phase_name: 'phase-1' }],
      x_mitre_data_sources: [
        'Command: Command Execution',
        'Operational Databases: Device Alarm',
        'Network Traffic: Network Traffic Flow',
      ],
      x_mitre_detection: 'detection text',
      x_mitre_is_subtechnique: false,
      x_mitre_impact_type: ['impact-1'],
      x_mitre_platforms: ['platform-1', 'platform-2'],
      x_mitre_domains: [enterpriseDomain, icsDomain],
    },
    {
      id: 'course-of-action--25dc1ce8-eb55-4333-ae30-a7cb4f5894a1',
      type: 'course-of-action',
      created_by_ref: mitreIdentityId,
      name: 'mitigation-1',
      description: 'This is a mitigation',
      external_references: [{ source_name: 'mitre-attack', external_id: 'M1' }],
      object_marking_refs: [markingDefinitionId],
      x_mitre_version: '1.0',
      modified: '2018-10-17T00:14:20.652Z',
      created: '2017-10-25T14:48:53.732Z',
      spec_version: '2.1',
      x_mitre_domains: [enterpriseDomain],
    },
    {
      id: 'course-of-action--e944670c-d03a-4e93-a21c-b3d4c53ec4c9',
      type: 'course-of-action',
      created_by_ref: mitreIdentityId,
      name: 'mitigation-2',
      description: "This is a mitigation that isn't in the contents",
      external_references: [{ source_name: 'mitre-attack', external_id: 'M1' }],
      object_marking_refs: [markingDefinitionId],
      x_mitre_version: '1.0',
      modified: '2018-10-17T00:14:20.652Z',
      created: '2017-10-25T14:48:53.732Z',
      spec_version: '2.1',
      x_mitre_domains: [enterpriseDomain],
      x_mitre_deprecated: true,
    },
    {
      id: 'malware--04227b24-7817-4de1-9050-b7b1b57f5866',
      type: 'malware',
      created_by_ref: mitreIdentityId,
      name: 'software-1',
      description: 'This is a software with an alias',
      external_references: [
        { source_name: 'mitre-attack', external_id: 'S1' },
        { source_name: 'malware-1 source', description: 'this is a source description' },
        { source_name: 'xyzzy', description: '(Citation: Adventure 1975)' },
      ],
      object_marking_refs: [markingDefinitionId],
      x_mitre_version: '1.0',
      modified: '2020-03-30T18:17:52.697Z',
      created: '2017-10-25T14:48:53.732Z',
      spec_version: '2.1',
      x_mitre_domains: [enterpriseDomain],
      x_mitre_aliases: ['xyzzy'],
    },
    {
      type: 'intrusion-set',
      id: 'intrusion-set--8a831aaa-f3e0-47a3-bed8-a9ced744dd12',
      created_by_ref: mitreIdentityId,
      name: 'Dark Caracal',
      description:
        '[Dark Caracal](https://attack.mitre.org/groups/G0070) is threat group that has been attributed to the Lebanese General Directorate of General Security (GDGS) and has operated since at least 2012. (Citation: Lookout Dark Caracal Jan 2018)',
      object_marking_refs: [markingDefinitionId],
      external_references: [
        {
          source_name: 'mitre-attack',
          url: 'https://attack.mitre.org/groups/G0070',
          external_id: 'G0070',
        },
        {
          source_name: 'Dark Caracal',
          description: '(Citation: Lookout Dark Caracal Jan 2018)',
        },
        {
          url: 'https://info.lookout.com/rs/051-ESQ-475/images/Lookout_Dark-Caracal_srr_20180118_us_v.1.0.pdf',
          description:
            'Blaich, A., et al. (2018, January 18). Dark Caracal: Cyber-espionage at a Global Scale. Retrieved April 11, 2018.',
          source_name: 'Lookout Dark Caracal Jan 2018',
        },
      ],
      aliases: ['Dark Caracal'],
      modified: '2020-06-03T20:22:40.401Z',
      created: '2018-10-17T00:14:20.652Z',
      spec_version: '2.1',
      x_mitre_version: '1.2',
    },
    {
      type: 'intrusion-set',
      id: 'intrusion-set--ed0222fb-b970-4337-b9a2-62aeb02860e5',
      created_by_ref: mitreIdentityId,
      name: 'Another group',
      description:
        "This is another group. It isn't referenced by a technique, but is associated with a campaign",
      object_marking_refs: [markingDefinitionId],
      external_references: [
        {
          source_name: 'mitre-attack',
          url: 'https://attack.mitre.org/groups/G0999',
          external_id: 'G0999',
        },
      ],
      aliases: ['Some group alias'],
      modified: '2023-05-02T20:19:40.401Z',
      created: '2018-10-17T00:19:20.652Z',
      spec_version: '2.1',
      x_mitre_version: '1.2',
    },
    {
      type: 'campaign',
      id: 'campaign--a3038910-f8ca-4ba8-b116-21d0f333f231',
      created_by_ref: mitreIdentityId,
      name: 'campaign-1',
      description: 'This is a campaign',
      first_seen: '2016-04-06T00:00:00.000Z',
      last_seen: '2016-07-12T00:00:00.000Z',
      x_mitre_first_seen_citation: '(Citation: Article 1)',
      x_mitre_last_seen_citation: '(Citation: Article 2)',
      object_marking_refs: [markingDefinitionId],
      external_references: [
        {
          source_name: 'mitre-attack',
          url: 'https://attack.mitre.org/campaigns/C0001',
          external_id: 'C0001',
        },
      ],
      aliases: ['Another campaign name'],
      modified: '2020-07-03T20:22:40.401Z',
      created: '2018-11-17T00:14:20.652Z',
      spec_version: '2.1',
      x_mitre_version: '1.2',
    },
    {
      type: 'campaign',
      id: 'campaign--649b389e-1f7a-4696-8a95-04d0851bd551',
      created_by_ref: mitreIdentityId,
      name: 'campaign-2',
      description: 'This is another campaign',
      first_seen: '2016-04-06T00:00:00.000Z',
      last_seen: '2016-07-12T00:00:00.000Z',
      x_mitre_first_seen_citation: '(Citation: Article 1)',
      x_mitre_last_seen_citation: '(Citation: Article 2)',
      object_marking_refs: [markingDefinitionId],
      external_references: [
        {
          source_name: 'mitre-attack',
          url: 'https://attack.mitre.org/campaigns/C0002',
          external_id: 'C0002',
        },
      ],
      aliases: ['Another campaign name'],
      modified: '2020-07-03T20:22:40.401Z',
      created: '2018-11-17T00:14:20.652Z',
      spec_version: '2.1',
      x_mitre_version: '1.2',
    },
    {
      created_by_ref: mitreIdentityId,
      object_marking_refs: [markingDefinitionId],
      source_ref: 'intrusion-set--8a831aaa-f3e0-47a3-bed8-a9ced744dd12',
      target_ref: 'attack-pattern--2204c371-6100-4ae0-82f3-25c07c29772a',
      external_references: [],
      description: 'Test relationship',
      relationship_type: 'uses',
      id: 'relationship--12098dee-27b3-4d0b-a15a-6b5955ba8879',
      type: 'relationship',
      modified: '2019-09-04T14:32:13.000Z',
      created: '2019-09-04T14:28:16.426Z',
      spec_version: '2.1',
    },
    {
      external_references: [],
      object_marking_refs: [markingDefinitionId],
      description: "This is a group that isn't in the domain",
      name: 'Dark Hydra',
      created_by_ref: mitreIdentityId,
      id: 'intrusion-set--6b9ebeb5-20bf-48b0-afb7-988d769a2f01',
      type: 'intrusion-set',
      aliases: ['Hydra'],
      modified: '2020-05-15T15:44:47.629Z',
      created: '2018-10-17T00:14:20.652Z',
      x_mitre_version: '1.2',
      spec_version: '2.1',
    },
    {
      type: 'note',
      id: 'note--6b9456275-20bf-48b0-afb7-988d769a2f99',
      spec_version: '2.1',
      abstract: 'This is the abstract for a note.',
      content: 'This is the content for a note.',
      authors: ['Author 1', 'Author 2'],
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      object_refs: ['malware--04227b24-7817-4de1-9050-b7b1b57f5866'],
      modified: '2020-04-12T15:44:47.629Z',
      created: '2019-10-22T00:14:20.652Z',
    },
    {
      type: 'x-mitre-data-source',
      id: 'x-mitre-data-source--880b771b-17a8-4a6c-a259-9027c395010c',
      name: 'Command',
      spec_version: '2.1',
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      modified: '2020-04-12T15:44:47.629Z',
      created: '2019-10-22T00:14:20.652Z',
      external_references: [{ source_name: 'mitre-attack', external_id: 'DS1' }],
    },
    {
      type: 'x-mitre-data-source',
      id: 'x-mitre-data-source--3e396a50-dd74-45cf-b8a3-974ab80c9a3e',
      name: 'Network Traffic',
      spec_version: '2.1',
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      modified: '2020-04-12T15:44:47.629Z',
      created: '2019-10-22T00:14:20.652Z',
      external_references: [{ source_name: 'mitre-attack', external_id: 'DS1' }],
    },
    {
      type: 'x-mitre-data-component',
      id: 'x-mitre-data-component--47667153-e24d-4514-bdf4-5720312d9e7d',
      name: 'Command Execution',
      spec_version: '2.1',
      x_mitre_data_source_ref: 'x-mitre-data-source--880b771b-17a8-4a6c-a259-9027c395010c',
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      modified: '2020-04-12T15:44:47.629Z',
      created: '2019-10-22T00:14:20.652Z',
    },
    {
      type: 'x-mitre-data-component',
      id: 'x-mitre-data-component--f8b4833e-a6d4-4a05-ba6e-1936d4109d0a',
      name: 'Network Traffic Flow',
      spec_version: '2.1',
      x_mitre_data_source_ref: 'x-mitre-data-source--3e396a50-dd74-45cf-b8a3-974ab80c9a3e',
      object_marking_refs: [markingDefinitionId],
      created_by_ref: mitreIdentityId,
      modified: '2020-04-12T15:44:47.629Z',
      created: '2019-10-22T00:14:20.652Z',
    },
    {
      created_by_ref: mitreIdentityId,
      object_marking_refs: [markingDefinitionId],
      source_ref: 'x-mitre-data-component--47667153-e24d-4514-bdf4-5720312d9e7d',
      target_ref: 'attack-pattern--2204c371-6100-4ae0-82f3-25c07c29772a',
      external_references: [],
      description: 'Detects relationship',
      relationship_type: 'detects',
      id: 'relationship--caa8928b-0bf6-45cd-8504-6c27b9cd96a8',
      type: 'relationship',
      modified: '2019-09-04T14:32:13.000Z',
      created: '2019-09-04T14:28:16.426Z',
      spec_version: '2.1',
    },
    {
      created_by_ref: mitreIdentityId,
      object_marking_refs: [markingDefinitionId],
      source_ref: 'x-mitre-data-component--47667153-e24d-4514-bdf4-5720312d9e7d',
      target_ref: 'attack-pattern--2bb2861b-fb40-42dc-b15f-1a6b64b6a39f',
      external_references: [],
      description: 'Detects relationship',
      relationship_type: 'detects',
      id: 'relationship--e7f994c6-3e08-4aea-a30e-97cc6fe610c6',
      type: 'relationship',
      modified: '2019-09-04T14:32:13.000Z',
      created: '2019-09-04T14:28:16.426Z',
      spec_version: '2.1',
    },
    {
      created_by_ref: mitreIdentityId,
      object_marking_refs: [markingDefinitionId],
      source_ref: 'x-mitre-data-component--f8b4833e-a6d4-4a05-ba6e-1936d4109d0a',
      target_ref: 'attack-pattern--2204c371-6100-4ae0-82f3-25c07c29772a',
      external_references: [],
      description: 'Test relationship',
      relationship_type: 'detects',
      id: 'relationship--b0c6c76c-7699-447f-9f3f-573aec51431c',
      type: 'relationship',
      modified: '2019-09-04T14:32:13.000Z',
      created: '2019-09-04T14:28:16.426Z',
      spec_version: '2.1',
    },
    {
      created_by_ref: mitreIdentityId,
      object_marking_refs: [markingDefinitionId],
      source_ref: 'campaign--a3038910-f8ca-4ba8-b116-21d0f333f231',
      target_ref: 'attack-pattern--2bb2861b-fb40-42dc-b15f-1a6b64b6a39f',
      external_references: [],
      description: 'Campaign uses technique',
      relationship_type: 'uses',
      id: 'relationship--89586929-ca62-423f-94bf-cc03ec8161bb',
      type: 'relationship',
      modified: '2021-06-06T14:00:00.000Z',
      created: '2021-06-06T14:00:00.000Z',
      spec_version: '2.1',
    },
    {
      created_by_ref: mitreIdentityId,
      object_marking_refs: [markingDefinitionId],
      source_ref: 'campaign--649b389e-1f7a-4696-8a95-04d0851bd551',
      target_ref: 'attack-pattern--82f04b1e-5371-4a6f-be06-411f0f43b483',
      external_references: [],
      description: 'Campaign uses technique',
      relationship_type: 'uses',
      id: 'relationship--d5426745-9530-485e-a757-d8c540f600f8',
      type: 'relationship',
      modified: '2021-06-06T14:00:00.000Z',
      created: '2021-06-06T14:00:00.000Z',
      spec_version: '2.1',
    },
    {
      created_by_ref: mitreIdentityId,
      object_marking_refs: [markingDefinitionId],
      source_ref: 'campaign--a3038910-f8ca-4ba8-b116-21d0f333f231',
      target_ref: 'malware--04227b24-7817-4de1-9050-b7b1b57f5866',
      external_references: [],
      description: 'Campaign uses software',
      relationship_type: 'uses',
      id: 'relationship--21d3572e-398d-4473-93eb-eb9a2a069d53',
      type: 'relationship',
      modified: '2021-06-07T14:00:00.000Z',
      created: '2021-06-07T14:00:00.000Z',
      spec_version: '2.1',
    },
    {
      created_by_ref: mitreIdentityId,
      object_marking_refs: [markingDefinitionId],
      source_ref: 'campaign--a3038910-f8ca-4ba8-b116-21d0f333f231',
      target_ref: 'intrusion-set--8a831aaa-f3e0-47a3-bed8-a9ced744dd12',
      external_references: [],
      description: 'Campaign attributed to group',
      relationship_type: 'attributed-to',
      id: 'relationship--a5a80c31-0dde-4fd7-a520-a7593d21c954',
      type: 'relationship',
      modified: '2021-06-08T14:00:00.000Z',
      created: '2021-06-08T14:00:00.000Z',
      spec_version: '2.1',
    },
    {
      created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
      object_marking_refs: [markingDefinitionId],
      source_ref: 'campaign--649b389e-1f7a-4696-8a95-04d0851bd551',
      target_ref: 'intrusion-set--ed0222fb-b970-4337-b9a2-62aeb02860e5',
      external_references: [],
      description: 'Campaign attributed to group and is the only reference to the group',
      relationship_type: 'attributed-to',
      id: 'relationship--1e1c5e5a-2a3e-423f-b1d0-67b7dc5b90cc',
      type: 'relationship',
      modified: '2023-06-08T14:00:00.000Z',
      created: '2023-06-08T14:00:00.000Z',
      spec_version: '2.1',
    },
  ],
};

function normalizeLegacyBundleFixtureForAdmImport(bundle) {
  const counters = {
    'attack-pattern': 9000,
    'course-of-action': 9000,
    malware: 9000,
    'intrusion-set': 9000,
    'x-mitre-data-source': 9000,
  };

  for (const stixObject of bundle.objects) {
    if (
      Array.isArray(stixObject.external_references) &&
      stixObject.external_references.length === 0 &&
      stixObject.type !== 'intrusion-set'
    ) {
      delete stixObject.external_references;
    }

    if (stixObject.type !== 'marking-definition' && stixObject.type !== 'note') {
      stixObject.x_mitre_attack_spec_version = config.app.attackSpecVersion;
    }

    switch (stixObject.type) {
      case 'x-mitre-collection':
        stixObject.x_mitre_version = '1.0';
        break;

      case 'identity':
        break;

      case 'attack-pattern':
        counters[stixObject.type] += 1;
        stixObject.external_references[0].external_id = `T${counters[stixObject.type]}`;
        stixObject.kill_chain_phases = stixObject.kill_chain_phases.map((phase) => ({
          ...phase,
          kill_chain_name: stixObject.x_mitre_domains.includes(mobileDomain)
            ? 'mitre-mobile-attack'
            : stixObject.x_mitre_domains.includes(icsDomain)
              ? 'mitre-ics-attack'
              : 'mitre-attack',
          phase_name: 'execution',
        }));
        stixObject.x_mitre_platforms = ['Windows', 'Linux'];
        delete stixObject.x_mitre_impact_type;
        break;

      case 'course-of-action':
        counters[stixObject.type] += 1;
        stixObject.external_references[0].external_id = `M${counters[stixObject.type]}`;
        stixObject.x_mitre_modified_by_ref = mitreIdentityId;
        break;

      case 'malware':
        counters[stixObject.type] += 1;
        stixObject.external_references[0].external_id = `S${counters[stixObject.type]}`;
        stixObject.is_family = false;
        stixObject.x_mitre_aliases = [stixObject.name, ...stixObject.x_mitre_aliases];
        stixObject.x_mitre_modified_by_ref = mitreIdentityId;
        stixObject.x_mitre_platforms = ['Windows'];
        break;

      case 'intrusion-set':
        counters[stixObject.type] += 1;
        if (
          !Array.isArray(stixObject.external_references) ||
          stixObject.external_references.length === 0
        ) {
          stixObject.external_references = [
            { source_name: 'mitre-attack', external_id: `G${counters[stixObject.type]}` },
          ];
        }
        stixObject.aliases = [stixObject.name, ...stixObject.aliases];
        stixObject.x_mitre_domains = [enterpriseDomain];
        break;

      case 'campaign':
        stixObject.aliases = [stixObject.name, ...stixObject.aliases];
        stixObject.external_references.push(
          { source_name: 'Article 1', description: 'First seen citation.' },
          { source_name: 'Article 2', description: 'Last seen citation.' },
        );
        stixObject.revoked = false;
        stixObject.x_mitre_domains = [enterpriseDomain];
        stixObject.x_mitre_modified_by_ref = mitreIdentityId;
        break;

      case 'relationship':
        stixObject.x_mitre_modified_by_ref = mitreIdentityId;
        break;

      case 'x-mitre-data-source':
        counters[stixObject.type] += 1;
        stixObject.external_references[0].external_id = `DS${counters[stixObject.type]}`;
        stixObject.description = `${stixObject.name} data source.`;
        stixObject.x_mitre_collection_layers = ['Host'];
        stixObject.x_mitre_domains = [enterpriseDomain];
        stixObject.x_mitre_modified_by_ref = mitreIdentityId;
        stixObject.x_mitre_version = '1.0';
        break;

      case 'x-mitre-data-component':
        stixObject.description = `${stixObject.name} data component.`;
        stixObject.x_mitre_domains = [enterpriseDomain];
        stixObject.x_mitre_modified_by_ref = mitreIdentityId;
        stixObject.x_mitre_version = '1.0';
        break;

      default:
        break;
    }
  }
}

normalizeLegacyBundleFixtureForAdmImport(initialObjectData);

// function printBundleCount(bundle) {
//     const count = {
//         techniques: 0,
//         groups: 0,
//         campaigns: 0,
//         relationships: 0
//     };
//
//     for (const stixObject of bundle.objects) {
//         if (stixObject.type === 'attack-pattern') {
//             count.techniques++;
//         }
//         else if (stixObject.type === 'intrusion-set') {
//             count.groups++;
//         }
//         else if (stixObject.type === 'campaign') {
//             count.campaigns++;
//         }
//         else if (stixObject.type === 'relationship') {
//             count.relationships++;
//         }
//     }
//
//     console.log(`Technique count = ${ count.techniques }`);
//     console.log(`Group count = ${ count.groups }`);
//     console.log(`Campaign count = ${ count.campaigns }`);
//     console.log(`Relationship count = ${ count.relationships }`);
// }

describe('STIX Bundles Basic API', function () {
  let app;
  let passportCookie;

  before(async function () {
    // Establish the database connection
    // Use an in-memory database that we spin up for the test
    await database.initializeConnection();

    // Check for a valid database configuration
    await databaseConfiguration.checkSystemConfiguration();

    // Enable ADM validation for the legacy bundle import path
    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;

    // Initialize the express app
    app = await require('../../../index').initializeApp();

    // Log into the app
    passportCookie = await login.loginAnonymous(app);
  });

  it('POST /api/collection-bundles imports a collection bundle', function (done) {
    const body = initialObjectData;
    request(app)
      .post('/api/collection-bundles')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/)
      .end(function (err, res) {
        if (err) {
          done(err);
        } else {
          // We expect to get the created collection object
          const collection = res.body;
          expect(collection).toBeDefined();
          expect(collection.workspace.import_categories.additions.length).toBe(
            initialObjectData.objects[0].x_mitre_contents.length,
          );
          expect(collection.workspace.import_categories.errors.length).toBe(0);
          done();
        }
      });
  });

  it('GET /api/stix-bundles exports an empty STIX bundle', function (done) {
    request(app)
      .get('/api/stix-bundles?domain=not-a-domain')
      .query({ useLegacyMethod: true })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .end(function (err, res) {
        if (err) {
          done(err);
        } else {
          // We expect to get the exported STIX bundle
          const stixBundle = res.body;
          expect(stixBundle).toBeDefined();
          expect(Array.isArray(stixBundle.objects)).toBe(true);
          expect(stixBundle.objects.length).toBe(0);
          done();
        }
      });
  });

  it('GET /api/stix-bundles exports the STIX bundle for the enterprise domain', function (done) {
    request(app)
      .get(`/api/stix-bundles?domain=${enterpriseDomain}&includeNotes=true`)
      .query({ useLegacyMethod: true })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/)
      .end(function (err, res) {
        if (err) {
          done(err);
        } else {
          // We expect to get the exported STIX bundle
          const stixBundle = res.body;
          expect(stixBundle).toBeDefined();
          expect(Array.isArray(stixBundle.objects)).toBe(true);

          // 4 primary objects, 7 relationship objects, 6 secondary objects,
          // 1 note, 1 identity, 1 marking definition
          //printBundleCount(stixBundle);
          expect(stixBundle.objects.length).toBe(20);

          done();
        }
      });
  });

  it('GET /api/stix-bundles exports the STIX 2.1 bundle for the enterprise domain with a collection object', function (done) {
    const bundleVersion = '17.1';
    const bundleModified = '2025-05-06T14:00:00.188Z';
    const encodedBundleModified = encodeURIComponent(bundleModified);
    const attackSpecVersion = '3.2.0';

    request(app)
      .get(
        `/api/stix-bundles?domain=${enterpriseDomain}&includeNotes=true&stixVersion=2.1&includeCollectionObject=true&collectionObjectVersion=${bundleVersion}&collectionObjectModified=${encodedBundleModified}&collectionAttackSpecVersion=${attackSpecVersion}`,
      )
      .query({ useLegacyMethod: true })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/)
      .end(function (err, res) {
        if (err) {
          done(err);
        } else {
          // We expect to get the exported STIX bundle
          const stixBundle = res.body;
          expect(stixBundle).toBeDefined();
          expect(stixBundle.spec_version).toBeUndefined();
          expect(Array.isArray(stixBundle.objects)).toBe(true);

          // 4 primary objects, 7 relationship objects, 6 secondary objects,
          // 1 note, 1 identity, 1 marking definition, 1 collection object
          expect(stixBundle.objects.length).toBe(21);

          const collectionObject = stixBundle.objects[0];
          expect(collectionObject.id).toBe(
            'x-mitre-collection--1f5f1533-f617-4ca8-9ab4-6a02367fa019',
          );
          expect(collectionObject.name).toBe('Enterprise ATT&CK');
          expect(collectionObject.x_mitre_version).toBe(bundleVersion);
          expect(collectionObject.modified).toBe(bundleModified);
          expect(collectionObject.x_mitre_contents.length).toBe(19); // 21 - 2: marking-definition and x-mitre-collection are not included
          expect(collectionObject.object_marking_refs.length).toBe(1);
          expect(collectionObject.object_marking_refs[0]).toBe(markingDefinitionId);
          expect(collectionObject.x_mitre_attack_spec_version).toBe(attackSpecVersion);
          expect(collectionObject.created_by_ref).toBe(mitreIdentityId);
          expect(collectionObject.spec_version).toBe('2.1');
          done();
        }
      });
  });

  it('GET /api/stix-bundles exports the STIX bundle for the enterprise domain including deprecated objects', function (done) {
    request(app)
      .get(`/api/stix-bundles?domain=${enterpriseDomain}&includeDeprecated=true&includeNotes=true`)
      .query({ useLegacyMethod: true })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/)
      .end(function (err, res) {
        if (err) {
          done(err);
        } else {
          // We expect to get the exported STIX bundle
          const stixBundle = res.body;
          expect(stixBundle).toBeDefined();
          expect(Array.isArray(stixBundle.objects)).toBe(true);
          // 5 primary objects, 7 relationship objects, 6 secondary objects,
          // 1 note, 1 identity, 1 marking definition
          expect(stixBundle.objects.length).toBe(21);

          done();
        }
      });
  });

  it('GET /api/stix-bundles exports the STIX bundle for the mobile domain', function (done) {
    request(app)
      .get(`/api/stix-bundles?domain=${mobileDomain}`)
      .query({ useLegacyMethod: true })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/)
      .end(function (err, res) {
        if (err) {
          done(err);
        } else {
          // We expect to get the exported STIX bundle
          const stixBundle = res.body;
          expect(stixBundle).toBeDefined();
          expect(Array.isArray(stixBundle.objects)).toBe(true);
          // 1 primary objects, 1 identity, 1 marking definition
          expect(stixBundle.objects.length).toBe(3);

          done();
        }
      });
  });

  it('GET /api/stix-bundles exports the STIX bundle for the ics domain', function (done) {
    request(app)
      .get(`/api/stix-bundles?domain=${icsDomain}`)
      .query({ useLegacyMethod: true })
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/)
      .end(function (err, res) {
        if (err) {
          done(err);
        } else {
          // We expect to get the exported STIX bundle
          const stixBundle = res.body;
          expect(stixBundle).toBeDefined();
          expect(Array.isArray(stixBundle.objects)).toBe(true);
          // 3 primary objects, 5 relationship objects, 5 secondary objects,
          // 1 identity, 1 marking definition
          expect(stixBundle.objects.length).toBe(15);

          const groupObjects = stixBundle.objects.filter((o) => o.type === 'intrusion-set');
          expect(groupObjects.length).toBe(2);

          done();
        }
      });
  });

  after(async function () {
    await database.closeConnection();
  });
});
