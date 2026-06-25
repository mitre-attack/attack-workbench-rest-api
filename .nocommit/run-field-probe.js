#!/usr/bin/env node

'use strict';

/**
 * Field Requirements Probe Runner
 *
 * This script safely runs the field requirements tests without requiring
 * a running server, by directly testing the validation middleware logic.
 */

const { validateWorkspaceStixData } = require('./app/lib/validation-middleware');
const {
  techniqueSchema,
  tacticSchema,
  campaignSchema,
} = require('@mitre-attack/attack-data-model');
const { v4: uuidv4 } = require('uuid');

/**
 * Mock Express request/response for testing middleware
 */
function createMockReqRes(body) {
  const req = {
    body,
    path: '/test',
    method: 'POST'
  };

  const res = {
    statusCode: 200,
    responseBody: null,
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(body) {
      this.responseBody = body;
      return this;
    }
  };

  const next = function() {
    // Middleware passed validation
  };

  return { req, res, next };
}

/**
 * Test middleware validation for a given object
 */
function testValidation(schema, testObject) {
  const middleware = validateWorkspaceStixData(schema);
  const { req, res, next } = createMockReqRes(testObject);

  return new Promise((resolve) => {
    // Override next to capture success
    const nextOverride = () => {
      resolve({ success: true, status: 200 });
    };

    // Override response methods to capture errors
    res.status = function(code) {
      this.statusCode = code;
      return this;
    };
    res.json = function(body) {
      this.responseBody = body;
      resolve({
        success: false,
        status: this.statusCode,
        error: body
      });
      return this;
    };

    try {
      middleware(req, res, nextOverride);
    } catch (error) {
      resolve({
        success: false,
        status: 500,
        error: { message: error.message }
      });
    }
  });
}

/**
 * Create base test objects
 */
function createTestObjects() {
  const now = new Date().toISOString();

  const baseStixFields = {
    spec_version: '2.1',
    created: now,
    modified: now,
    name: 'Test Object',
    description: 'Test description',
    x_mitre_attack_spec_version: '3.3.0',
    x_mitre_version: '1.0',
    x_mitre_domains: ['enterprise-attack'],
    x_mitre_modified_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
    created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
    object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
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
        ...baseStixFields,
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
        ...baseStixFields,
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
        ...baseStixFields,
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
 * Test specific field requirements
 */
async function probeFieldRequirements() {
  console.log('🔍 Testing Field Requirements for "awaiting-review" Objects');
  console.log('='*70);

  const schemas = {
    technique: techniqueSchema,
    tactic: tacticSchema,
    campaign: campaignSchema
  };

  const testObjects = createTestObjects();

  // Fields that are typically set by the backend
  const BACKEND_FIELDS = [
    'x_mitre_attack_spec_version',
    'x_mitre_domains',
    'x_mitre_modified_by_ref',
    'created_by_ref',
    'object_marking_refs'
  ];

  // Core STIX fields that should always be required
  const CORE_FIELDS = [
    'type',
    'spec_version',
    'created',
    'modified'
  ];

  const results = {};

  for (const [objectType, schema] of Object.entries(schemas)) {
    console.log(`\n🔍 Testing ${objectType}...`);
    results[objectType] = {
      coreFields: {},
      backendFields: {},
      baselineValid: false
    };

    const baseObject = testObjects[objectType];

    // Test 1: Baseline - full object should be valid
    const baselineResult = await testValidation(schema, baseObject);
    results[objectType].baselineValid = baselineResult.success;
    console.log(`   Baseline (full object): ${baselineResult.success ? '✅' : '❌'}`);
    if (!baselineResult.success) {
      console.log(`     Error: ${JSON.stringify(baselineResult.error, null, 2)}`);
    }

    // Test 2: Core STIX fields
    console.log('\n   Core STIX fields:');
    for (const field of CORE_FIELDS) {
      const testObj = JSON.parse(JSON.stringify(baseObject));
      delete testObj.stix[field];

      const result = await testValidation(schema, testObj);
      results[objectType].coreFields[field] = {
        required: !result.success,
        error: result.error
      };

      console.log(`     ${field}: ${result.success ? '✅ Optional' : '❌ Required'}`);
    }

    // Test 3: Backend-managed fields
    console.log('\n   Backend-managed fields:');
    for (const field of BACKEND_FIELDS) {
      const testObj = JSON.parse(JSON.stringify(baseObject));
      delete testObj.stix[field];

      const result = await testValidation(schema, testObj);
      results[objectType].backendFields[field] = {
        required: !result.success,
        error: result.error
      };

      const status = result.success ? '✅ Optional' : '❌ Required (PROBLEM!)';
      console.log(`     ${field}: ${status}`);
    }
  }

  return results;
}

/**
 * Generate analysis report
 */
function generateReport(results) {
  console.log('\n' + '='*70);
  console.log('📊 FIELD REQUIREMENTS ANALYSIS REPORT');
  console.log('='*70);

  // Identify problematic backend fields
  const problematicFields = new Set();
  const coreFieldIssues = new Set();

  Object.entries(results).forEach(([objectType, result]) => {
    // Check core fields
    Object.entries(result.coreFields).forEach(([field, fieldResult]) => {
      if (!fieldResult.required) {
        coreFieldIssues.add(field);
      }
    });

    // Check backend fields
    Object.entries(result.backendFields).forEach(([field, fieldResult]) => {
      if (fieldResult.required) {
        problematicFields.add(field);
      }
    });
  });

  console.log('\n🔒 CORE STIX FIELD ANALYSIS:');
  if (coreFieldIssues.size === 0) {
    console.log('   ✅ All core STIX fields are properly required');
  } else {
    console.log('   ⚠️  These core fields are unexpectedly optional:');
    coreFieldIssues.forEach(field => console.log(`     - ${field}`));
  }

  console.log('\n⚠️  BACKEND FIELD ANALYSIS:');
  if (problematicFields.size === 0) {
    console.log('   ✅ No backend-managed fields are required for "awaiting-review" objects');
    console.log('   ✅ Your validation middleware is working correctly!');
  } else {
    console.log('   ❌ These backend-managed fields are required for "awaiting-review" objects:');
    problematicFields.forEach(field => {
      console.log(`     - ${field}`);

      // Provide recommendations
      if (field === 'x_mitre_attack_spec_version') {
        console.log(`       → Frontend should include: "3.3.0"`);
      } else if (field === 'x_mitre_domains') {
        console.log(`       → Frontend should include: ["enterprise-attack"]`);
      } else if (field === 'x_mitre_modified_by_ref') {
        console.log(`       → Frontend should include: "identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5"`);
      } else if (field === 'created_by_ref') {
        console.log(`       → Frontend should include: "identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5"`);
      } else if (field === 'object_marking_refs') {
        console.log(`       → Frontend should include: ["marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168"]`);
      }
    });
  }

  console.log('\n🎯 RECOMMENDATIONS:');
  if (problematicFields.size === 0) {
    console.log('   ✅ No action required! Your middleware correctly handles "work-in-progress" vs "awaiting-review" validation.');
  } else {
    console.log('   📋 Update your frontend to include these fields when posting "awaiting-review" objects:');
    console.log('   📋 OR modify your validation middleware to handle these fields differently.');
  }

  // Detailed breakdown
  console.log('\n📋 DETAILED BREAKDOWN:');
  Object.entries(results).forEach(([objectType, result]) => {
    console.log(`\n   ${objectType.toUpperCase()}:`);
    console.log(`     Baseline valid: ${result.baselineValid ? '✅' : '❌'}`);

    const requiredCore = Object.entries(result.coreFields)
      .filter(([, fr]) => fr.required).length;
    const requiredBackend = Object.entries(result.backendFields)
      .filter(([, fr]) => fr.required).length;

    console.log(`     Required core fields: ${requiredCore}/4`);
    console.log(`     Required backend fields: ${requiredBackend}/5 ${requiredBackend > 0 ? '⚠️' : '✅'}`);
  });

  return {
    problematicFields: [...problematicFields],
    coreFieldIssues: [...coreFieldIssues],
    summary: {
      hasProblems: problematicFields.size > 0,
      coreFieldsOk: coreFieldIssues.size === 0
    }
  };
}

/**
 * Main execution
 */
async function main() {
  try {
    const results = await probeFieldRequirements();
    const analysis = generateReport(results);

    console.log('\n✅ Field requirements probe complete!');

    if (analysis.summary.hasProblems) {
      console.log('\n🚨 Action required: Frontend needs to include additional fields for "awaiting-review" objects.');
      process.exit(1);
    } else {
      console.log('\n🎉 No issues found! Your validation is working correctly.');
      process.exit(0);
    }
  } catch (error) {
    console.error('\n💥 Probe failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  createTestObjects,
  testValidation,
  probeFieldRequirements,
  generateReport
};