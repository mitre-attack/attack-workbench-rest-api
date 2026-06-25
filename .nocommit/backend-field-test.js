#!/usr/bin/env node

'use strict';

/**
 * Backend Field Requirements Test
 *
 * This script specifically tests the fields that are typically set by the backend
 * to identify which ones the frontend needs to start including when posting
 * "awaiting-review" objects.
 *
 * Focus areas:
 * 1. Core STIX fields: type, spec_version, created, modified
 * 2. Backend-managed fields: x_mitre_attack_spec_version, x_mitre_domains, x_mitre_modified_by_ref
 * 3. STIX identity fields: created_by_ref, object_marking_refs
 */

const supertest = require('supertest');
const { v4: uuidv4 } = require('uuid');

// Import your Express app
const app = require('./app/app');

// Test configuration
const TEST_CONFIG = {
  // Standard test identity and marking refs used by the backend
  IDENTITY_REF: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
  MARKING_REF: 'marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168',
  ATTACK_SPEC_VERSION: '3.3.0',
  DOMAINS: ['enterprise-attack']
};

/**
 * Backend-managed fields that we want to test
 */
const BACKEND_FIELDS_TO_TEST = [
  'x_mitre_attack_spec_version',
  'x_mitre_domains',
  'x_mitre_modified_by_ref',
  'created_by_ref',
  'object_marking_refs'
];

/**
 * Core STIX fields that should always be required
 */
const CORE_STIX_FIELDS = [
  'type',
  'spec_version',
  'created',
  'modified'
];

/**
 * Create base valid objects for testing
 */
function createBaseObjects() {
  const now = new Date().toISOString();

  const baseStixObject = {
    type: 'attack-pattern', // Will be overridden per object type
    spec_version: '2.1',
    id: '', // Will be set per test
    created: now,
    modified: now,
    name: 'Test Object',
    description: 'Test description',
    x_mitre_attack_spec_version: TEST_CONFIG.ATTACK_SPEC_VERSION,
    x_mitre_version: '1.0',
    x_mitre_domains: TEST_CONFIG.DOMAINS,
    x_mitre_modified_by_ref: TEST_CONFIG.IDENTITY_REF,
    created_by_ref: TEST_CONFIG.IDENTITY_REF,
    object_marking_refs: [TEST_CONFIG.MARKING_REF],
    external_references: [{
      source_name: 'mitre-attack',
      external_id: 'T9999',
      url: 'https://attack.mitre.org/techniques/T9999'
    }]
  };

  return {
    technique: {
      workspace: {
        workflow: { state: 'awaiting-review' },
        attackId: 'T9999'
      },
      stix: {
        ...baseStixObject,
        type: 'attack-pattern',
        id: 'attack-pattern--' + uuidv4(),
        x_mitre_is_subtechnique: false
      }
    },

    tactic: {
      workspace: {
        workflow: { state: 'awaiting-review' },
        attackId: 'TA9999'
      },
      stix: {
        ...baseStixObject,
        type: 'x-mitre-tactic',
        id: 'x-mitre-tactic--' + uuidv4(),
        x_mitre_shortname: 'test-tactic',
        external_references: [{
          source_name: 'mitre-attack',
          external_id: 'TA9999',
          url: 'https://attack.mitre.org/tactics/TA9999'
        }]
      }
    },

    campaign: {
      workspace: {
        workflow: { state: 'awaiting-review' }
      },
      stix: {
        ...baseStixObject,
        type: 'campaign',
        id: 'campaign--' + uuidv4(),
        aliases: ['Test Campaign'],
        first_seen: now,
        last_seen: now,
        x_mitre_first_seen_citation: '(Citation: Test)',
        x_mitre_last_seen_citation: '(Citation: Test)',
        revoked: false,
        external_references: [{
          source_name: 'Test',
          description: 'Test reference'
        }]
      }
    }
  };
}

/**
 * Test field requirements for a specific object type
 */
async function testObjectFieldRequirements(objectType, endpoint, baseObject) {
  console.log(`\n🔍 Testing ${objectType} (${endpoint})`);

  const results = {
    objectType,
    endpoint,
    coreFieldResults: {},
    backendFieldResults: {},
    validationErrors: []
  };

  // Test 1: Core STIX fields - these should ALWAYS be required
  console.log(`\n   Testing core STIX fields...`);
  for (const field of CORE_STIX_FIELDS) {
    try {
      const testObject = JSON.parse(JSON.stringify(baseObject));
      delete testObject.stix[field];

      const response = await makeRequest(endpoint, testObject);
      results.coreFieldResults[field] = {
        required: response.status === 400,
        status: response.status,
        error: response.status === 400 ? response.body : null
      };

      console.log(`     ${field}: ${response.status === 400 ? '❌ Required' : '✅ Optional'}`);
    } catch (error) {
      results.coreFieldResults[field] = { error: error.message };
      console.log(`     ${field}: 💥 Error - ${error.message}`);
    }
  }

  // Test 2: Backend-managed fields - these are the problematic ones
  console.log(`\n   Testing backend-managed fields...`);
  for (const field of BACKEND_FIELDS_TO_TEST) {
    try {
      const testObject = JSON.parse(JSON.stringify(baseObject));
      delete testObject.stix[field];

      const response = await makeRequest(endpoint, testObject);
      results.backendFieldResults[field] = {
        required: response.status === 400,
        status: response.status,
        error: response.status === 400 ? response.body : null
      };

      const status = response.status === 400 ? '❌ Required (PROBLEM!)' : '✅ Optional';
      console.log(`     ${field}: ${status}`);

      if (response.status === 400) {
        results.validationErrors.push({
          field,
          error: response.body
        });
      }
    } catch (error) {
      results.backendFieldResults[field] = { error: error.message };
      console.log(`     ${field}: 💥 Error - ${error.message}`);
    }
  }

  // Test 3: Full object with "awaiting-review" status
  console.log(`\n   Testing complete awaiting-review object...`);
  try {
    const response = await makeRequest(endpoint, baseObject);
    console.log(`     Complete object: ${response.status < 400 ? '✅ Valid' : '❌ Invalid'}`);
    if (response.status >= 400) {
      console.log(`     Error: ${JSON.stringify(response.body, null, 2)}`);
    }
  } catch (error) {
    console.log(`     Complete object: 💥 Error - ${error.message}`);
  }

  return results;
}

/**
 * Make HTTP request with proper headers
 */
async function makeRequest(endpoint, data) {
  return supertest(app)
    .post(endpoint)
    .send(data)
    .set('Content-Type', 'application/json')
    .set('Authorization', 'Bearer test-token') // Adjust auth as needed
    .timeout(5000);
}

/**
 * Generate analysis report
 */
function generateAnalysisReport(allResults) {
  console.log('\n' + '='*80);
  console.log('📊 BACKEND FIELD REQUIREMENTS ANALYSIS');
  console.log('='*80);

  // Analyze core STIX field requirements
  console.log(`\n🔒 CORE STIX FIELD ANALYSIS:`);
  const coreFieldAnalysis = {};
  CORE_STIX_FIELDS.forEach(field => {
    const results = allResults.map(r => r.coreFieldResults[field]?.required).filter(Boolean);
    const requiredCount = results.filter(Boolean).length;
    const totalCount = results.length;
    coreFieldAnalysis[field] = { requiredCount, totalCount };
    console.log(`   ${field}: Required in ${requiredCount}/${totalCount} schemas`);
  });

  // Analyze backend field requirements - THIS IS THE KEY SECTION
  console.log(`\n⚠️  BACKEND FIELD ANALYSIS (PROBLEMATIC FIELDS):`);
  const problematicFields = [];

  BACKEND_FIELDS_TO_TEST.forEach(field => {
    const results = allResults.map(r => r.backendFieldResults[field]);
    const requiredResults = results.filter(r => r?.required);
    const totalTested = results.filter(r => r && !r.error).length;

    if (requiredResults.length > 0) {
      problematicFields.push({
        field,
        requiredIn: requiredResults.length,
        totalTested,
        schemas: allResults
          .filter(r => r.backendFieldResults[field]?.required)
          .map(r => r.objectType)
      });

      console.log(`   ❌ ${field}: Required in ${requiredResults.length}/${totalTested} schemas`);
      console.log(`      Affects: ${problematicFields[problematicFields.length - 1].schemas.join(', ')}`);
    } else {
      console.log(`   ✅ ${field}: Optional in all schemas`);
    }
  });

  // Frontend recommendations
  console.log(`\n🎯 FRONTEND RECOMMENDATIONS:`);

  if (problematicFields.length === 0) {
    console.log(`   ✅ Good news! No backend-managed fields are required for "awaiting-review" objects.`);
  } else {
    console.log(`   ⚠️  The frontend needs to include these fields when posting "awaiting-review" objects:`);
    problematicFields.forEach(pf => {
      console.log(`\n   📋 ${pf.field}:`);
      console.log(`      - Required in: ${pf.schemas.join(', ')}`);
      console.log(`      - Recommended value: Check backend configuration`);

      // Provide specific recommendations
      if (pf.field === 'x_mitre_attack_spec_version') {
        console.log(`      - Suggested value: "${TEST_CONFIG.ATTACK_SPEC_VERSION}"`);
      } else if (pf.field === 'x_mitre_domains') {
        console.log(`      - Suggested value: ${JSON.stringify(TEST_CONFIG.DOMAINS)}`);
      } else if (pf.field === 'x_mitre_modified_by_ref') {
        console.log(`      - Suggested value: "${TEST_CONFIG.IDENTITY_REF}"`);
      } else if (pf.field === 'created_by_ref') {
        console.log(`      - Suggested value: "${TEST_CONFIG.IDENTITY_REF}"`);
      } else if (pf.field === 'object_marking_refs') {
        console.log(`      - Suggested value: ["${TEST_CONFIG.MARKING_REF}"]`);
      }
    });
  }

  // Validation errors summary
  const allValidationErrors = allResults.flatMap(r => r.validationErrors);
  if (allValidationErrors.length > 0) {
    console.log(`\n💥 VALIDATION ERRORS ENCOUNTERED:`);
    allValidationErrors.forEach(err => {
      console.log(`   - ${err.field}: ${JSON.stringify(err.error)}`);
    });
  }

  return { coreFieldAnalysis, problematicFields, allValidationErrors };
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Starting Backend Field Requirements Test');
  console.log('='*80);

  const baseObjects = createBaseObjects();
  const testCases = [
    { type: 'technique', endpoint: '/api/techniques', object: baseObjects.technique },
    { type: 'tactic', endpoint: '/api/tactics', object: baseObjects.tactic },
    { type: 'campaign', endpoint: '/api/campaigns', object: baseObjects.campaign }
  ];

  const allResults = [];

  for (const testCase of testCases) {
    try {
      const results = await testObjectFieldRequirements(
        testCase.type,
        testCase.endpoint,
        testCase.object
      );
      allResults.push(results);

      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`💥 Failed to test ${testCase.type}:`, error.message);
    }
  }

  // Generate comprehensive analysis
  const analysis = generateAnalysisReport(allResults);

  console.log('\n✅ Backend field requirements test complete!');
  return analysis;
}

// Export for potential use as module
module.exports = {
  createBaseObjects,
  testObjectFieldRequirements,
  generateAnalysisReport,
  BACKEND_FIELDS_TO_TEST,
  CORE_STIX_FIELDS
};

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Test failed:', error);
    process.exit(1);
  });
}