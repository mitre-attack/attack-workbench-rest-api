#!/usr/bin/env node

'use strict';

/**
 * Field Requirements Probe for ATT&CK Workbench API
 *
 * This script systematically tests which fields are required when posting
 * "awaiting-review" objects to identify which fields the frontend needs to include.
 *
 * It tests each STIX object type by:
 * 1. Creating a base valid object with "awaiting-review" status
 * 2. Removing one field at a time to see which ones cause validation failures
 * 3. Generating a report of required vs optional fields
 */

const request = require('supertest');
const database = require('./app/lib/database-in-memory');
const databaseConfiguration = require('./app/lib/database-configuration');
const login = require('./app/tests/shared/login');

const logger = require('./app/lib/logger');
logger.level = 'debug';
const {
  techniqueSchema,
  tacticSchema,
  campaignSchema,
  groupSchema,
  mitigationSchema,
  relationshipSchema,
  identitySchema,
  collectionSchema,
  matrixSchema,
  dataSourceSchema,
  dataComponentSchema,
  detectionStrategySchema,
  assetSchema,
  analyticSchema,
} = require('@mitre-attack/attack-data-model');

// Schema to route mapping
const SCHEMA_TO_ENDPOINT = {
  techniqueSchema: '/api/techniques',
  tacticSchema: '/api/tactics',
  campaignSchema: '/api/campaigns',
  groupSchema: '/api/groups',
  mitigationSchema: '/api/mitigations',
  relationshipSchema: '/api/relationships',
  identitySchema: '/api/identities',
  collectionSchema: '/api/collections',
  matrixSchema: '/api/matrices',
  dataSourceSchema: '/api/data-sources',
  dataComponentSchema: '/api/data-components',
  detectionStrategySchema: '/api/detection-strategies',
  assetSchema: '/api/assets',
  analyticSchema: '/api/analytics',
};

const SCHEMAS = {
  techniqueSchema,
  tacticSchema,
  campaignSchema,
  groupSchema,
  mitigationSchema,
  relationshipSchema,
  identitySchema,
  collectionSchema,
  matrixSchema,
  dataSourceSchema,
  dataComponentSchema,
  detectionStrategySchema,
  assetSchema,
  analyticSchema,
};

/**
 * Generate base template objects for each STIX type
 */
function generateBaseTemplates() {
  const now = new Date().toISOString();

  return {
    techniqueSchema: {
      workspace: {
        workflow: { state: 'awaiting-review' },
        attackId: 'T9999',
        collections: [],
      },
      stix: {
        type: 'attack-pattern',
        spec_version: '2.1',
        id: 'attack-pattern--' + require('uuid').v4(),
        created: now,
        modified: now,
        name: 'Test Technique',
        description: 'Test technique description',
        x_mitre_is_subtechnique: false,
        x_mitre_domains: ['enterprise-attack'],
        x_mitre_attack_spec_version: '3.3.0',
        x_mitre_version: '1.0',
        x_mitre_modified_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
        external_references: [
          {
            source_name: 'mitre-attack',
            external_id: 'T9999',
            url: 'https://attack.mitre.org/techniques/T9999',
          },
        ],
        created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
        object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
      },
    },

    tacticSchema: {
      workspace: {
        workflow: { state: 'awaiting-review' },
        attackId: 'TA9999',
        collections: [],
      },
      stix: {
        type: 'x-mitre-tactic',
        spec_version: '2.1',
        id: 'x-mitre-tactic--' + require('uuid').v4(),
        created: now,
        modified: now,
        name: 'Test Tactic',
        description: 'Test tactic description',
        x_mitre_shortname: 'test-tactic',
        x_mitre_domains: ['enterprise-attack'],
        x_mitre_attack_spec_version: '3.3.0',
        x_mitre_version: '1.0',
        x_mitre_modified_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
        external_references: [
          {
            source_name: 'mitre-attack',
            external_id: 'TA9999',
            url: 'https://attack.mitre.org/tactics/TA9999',
          },
        ],
        created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
        object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
      },
    },

    campaignSchema: {
      workspace: {
        workflow: { state: 'awaiting-review' },
        collections: [],
      },
      stix: {
        type: 'campaign',
        spec_version: '2.1',
        id: 'campaign--' + require('uuid').v4(),
        created: now,
        modified: now,
        name: 'Test Campaign',
        description: 'Test campaign description',
        aliases: ['Test Campaign'],
        first_seen: now,
        last_seen: now,
        x_mitre_first_seen_citation: '(Citation: Test)',
        x_mitre_last_seen_citation: '(Citation: Test)',
        x_mitre_domains: ['enterprise-attack'],
        x_mitre_attack_spec_version: '3.3.0',
        x_mitre_version: '1.0',
        x_mitre_modified_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
        external_references: [
          {
            source_name: 'Test',
            description: 'Test reference',
          },
        ],
        created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
        object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
        revoked: false,
      },
    },

    // Add more templates as needed...
  };
}

/**
 * Extract all field paths from a nested object
 */
function extractFieldPaths(obj, prefix = '') {
  const paths = [];

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      paths.push(...extractFieldPaths(value, currentPath));
    } else {
      paths.push(currentPath);
    }
  }

  return paths;
}

/**
 * Remove a field from an object by path (e.g., 'stix.name' or 'workspace.workflow.state')
 */
function removeFieldByPath(obj, path) {
  const copy = JSON.parse(JSON.stringify(obj));
  const parts = path.split('.');
  let current = copy;

  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) return copy;
    current = current[parts[i]];
  }

  delete current[parts[parts.length - 1]];
  return copy;
}

/**
 * Test field requirements for a specific schema
 */
async function probeSchemaFieldRequirements(schemaName, schema, baseTemplate, endpoint, app, passportCookie) {
  console.log(`\n🔍 Probing ${schemaName}...`);

  const results = {
    schemaName,
    endpoint,
    totalFields: 0,
    requiredFields: [],
    optionalFields: [],
    errors: [],
  };

  // Get all field paths from the base template
  const fieldPaths = extractFieldPaths(baseTemplate);
  results.totalFields = fieldPaths.length;

  console.log(`   Found ${fieldPaths.length} fields to test`);

  // Test each field by removing it
  for (const fieldPath of fieldPaths) {
    try {
      const testObject = removeFieldByPath(baseTemplate, fieldPath);

      const response = await request(app)
        .post(endpoint)
        .send(testObject)
        .set('Content-Type', 'application/json')
        .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`);

      if (response.status === 400) {
        // Field is required
        results.requiredFields.push({
          field: fieldPath,
          error: response.body.error,
          details: response.body.details,
        });
        console.log(`   ❌ Required: ${fieldPath}`);
      } else if (response.status >= 200 && response.status < 300) {
        // Field is optional
        results.optionalFields.push(fieldPath);
        console.log(`   ✅ Optional: ${fieldPath}`);
      } else {
        // Unexpected response
        results.errors.push({
          field: fieldPath,
          status: response.status,
          error: response.body,
        });
        console.log(`   ⚠️  Unexpected (${response.status}): ${fieldPath}`);
      }
    } catch (error) {
      results.errors.push({
        field: fieldPath,
        error: error.message,
      });
      console.log(`   💥 Error testing ${fieldPath}: ${error.message}`);
    }

    // Small delay to avoid overwhelming the server
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return results;
}

/**
 * Main execution function
 */
async function main() {
  console.log('🚀 Starting Field Requirements Probe for ATT&CK Workbench API');
  console.log('='.repeat(80));

  let app;
  let passportCookie;

  try {
    // Initialize the database and app (following test pattern)
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();

    // Initialize the express app
    app = await require('./app/index').initializeApp();

    // Log into the app
    passportCookie = await login.loginAnonymous(app);

    console.log('✅ App initialized successfully');

    const baseTemplates = generateBaseTemplates();
    const allResults = [];

    // Test each schema
    for (const [schemaName, endpoint] of Object.entries(SCHEMA_TO_ENDPOINT)) {
      if (!baseTemplates[schemaName]) {
        console.log(`⚠️  Skipping ${schemaName} - no base template defined`);
        continue;
      }

      try {
        const results = await probeSchemaFieldRequirements(
          schemaName,
          SCHEMAS[schemaName],
          baseTemplates[schemaName],
          endpoint,
          app,
          passportCookie
        );
        allResults.push(results);
      } catch (error) {
        console.error(`💥 Failed to probe ${schemaName}:`, error.message);
      }
    }

    // Generate comprehensive report
    generateReport(allResults);

  } finally {
    // Clean up database connection
    if (database) {
      await database.closeConnection();
    }
  }
}

/**
 * Generate comprehensive analysis report
 */
function generateReport(allResults) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 FIELD REQUIREMENTS ANALYSIS REPORT');
  console.log('='.repeat(80));

  // Summary statistics
  const totalSchemas = allResults.length;
  const totalFieldsTested = allResults.reduce((sum, r) => sum + r.totalFields, 0);
  const totalRequiredFields = allResults.reduce((sum, r) => sum + r.requiredFields.length, 0);
  const totalOptionalFields = allResults.reduce((sum, r) => sum + r.optionalFields.length, 0);

  console.log(`\n📈 SUMMARY:`);
  console.log(`   Schemas tested: ${totalSchemas}`);
  console.log(`   Total fields tested: ${totalFieldsTested}`);
  console.log(`   Required fields: ${totalRequiredFields}`);
  console.log(`   Optional fields: ${totalOptionalFields}`);

  // Common required fields across all schemas
  const commonRequired = findCommonFields(
    allResults.map((r) => r.requiredFields.map((rf) => rf.field)),
  );
  console.log(`\n🔒 FIELDS REQUIRED ACROSS ALL SCHEMAS:`);
  commonRequired.forEach((field) => console.log(`   - ${field}`));

  // Backend-set fields that are causing issues
  const backendFields = allResults.flatMap((r) =>
    r.requiredFields.filter(
      (rf) =>
        rf.field.includes('x_mitre_attack_spec_version') ||
        rf.field.includes('x_mitre_domains') ||
        rf.field.includes('x_mitre_modified_by_ref') ||
        rf.field.includes('created_by_ref') ||
        rf.field.includes('object_marking_refs'),
    ),
  );

  console.log(`\n⚠️  BACKEND-SET FIELDS CAUSING VALIDATION FAILURES:`);
  backendFields.forEach((field) => {
    console.log(`   - ${field.field} (${field.error})`);
  });

  // Detailed per-schema breakdown
  console.log(`\n📋 DETAILED BREAKDOWN BY SCHEMA:`);
  allResults.forEach((result) => {
    console.log(`\n   ${result.schemaName} (${result.endpoint}):`);
    console.log(`     Required: ${result.requiredFields.length} fields`);
    console.log(`     Optional: ${result.optionalFields.length} fields`);
    console.log(`     Errors: ${result.errors.length} fields`);

    if (result.requiredFields.length > 0) {
      console.log(`     Required fields:`);
      result.requiredFields.forEach((rf) => {
        console.log(`       - ${rf.field}`);
      });
    }
  });

  // Frontend action items
  console.log(`\n🎯 FRONTEND ACTION ITEMS:`);
  console.log(
    `\n   The frontend should ensure these fields are included when posting "awaiting-review" objects:`,
  );

  const frontendRequiredFields = new Set();
  allResults.forEach((result) => {
    result.requiredFields.forEach((rf) => {
      // Filter out fields that should be handled by backend
      if (
        !rf.field.includes('created') &&
        !rf.field.includes('modified') &&
        !rf.field.includes('id') &&
        !rf.field.includes('spec_version') &&
        !rf.field.includes('type')
      ) {
        frontendRequiredFields.add(rf.field);
      }
    });
  });

  [...frontendRequiredFields].sort().forEach((field) => {
    console.log(`   - ${field}`);
  });

  console.log(`\n✅ Probe complete! Check the detailed results above.`);
}

/**
 * Find fields that appear in all result sets
 */
function findCommonFields(fieldSets) {
  if (fieldSets.length === 0) return [];

  return fieldSets[0].filter((field) => fieldSets.every((set) => set.includes(field)));
}

// Run the probe
if (require.main === module) {
  main().catch((error) => {
    console.error('💥 Probe failed:', error);
    process.exit(1);
  });
}

module.exports = {
  generateBaseTemplates,
  probeSchemaFieldRequirements,
  extractFieldPaths,
  removeFieldByPath,
};
