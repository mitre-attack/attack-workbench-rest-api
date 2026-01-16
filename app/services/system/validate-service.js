'use strict';

const {
  tacticSchema,
  techniqueSchema,
  groupSchema,
  malwareSchema,
  toolSchema,
  mitigationSchema,
  assetSchema,
  dataSourceSchema,
  campaignSchema,
  dataComponentSchema,
  detectionStrategySchema,
  analyticSchema,
  matrixSchema,
  relationshipSchema,
  collectionSchema,
  markingDefinitionSchema,
} = require('@mitre-attack/attack-data-model');

const STIX_SCHEMAS = {
  'x-mitre-tactic': tacticSchema,
  'attack-pattern': techniqueSchema,
  'intrusion-set': groupSchema,
  malware: malwareSchema,
  tool: toolSchema,
  campaign: campaignSchema,
  relationship: relationshipSchema,
  'course-of-action': mitigationSchema,
  'marking-definition': markingDefinitionSchema,
  'x-mitre-asset': assetSchema,
  'x-mitre-data-source': dataSourceSchema,
  'x-mitre-data-component': dataComponentSchema,
  'x-mitre-detection-strategy': detectionStrategySchema,
  'x-mitre-analytic': analyticSchema,
  'x-mitre-matrix': matrixSchema,
  'x-mitre-collection': collectionSchema,
};

/**
 * Configuration for transforming validation errors (to warnings or suppression)
 * Add new rules here to convert specific validation errors to warnings or suppress them entirely
 *
 * stixType can be:
 * - A single STIX type string (e.g., 'x-mitre-tactic')
 * - An array of STIX types (e.g., ['attack-pattern', 'x-mitre-tactic'])
 * - 'all' to match any STIX type
 */
const ERROR_TRANSFORMATION_RULES = [
  // x_mitre_modified_by_ref is handled by the backend
  {
    fieldPath: ['stix', 'x_mitre_modified_by_ref'],
    errorCode: 'invalid_value',
    stixType: 'all',
    suppressError: true,
  },
  // Just raise a warning for x_mitre_shortname, letting users know that the value may not comply with the ADM predefined tactic names
  {
    fieldPath: ['stix', 'x_mitre_shortname'],
    errorCode: 'invalid_value',
    stixType: 'x-mitre-tactic',
    warningMessage:
      'Tactic shortname does not match predefined ATT&CK tactics. This may prevent compatibility with official ATT&CK data but can be used for custom taxonomies.',
  },
  // Users cannot set domain membership on some objects - in such cases, x_mitre_domains is set when the content in a STIX bundle
  {
    fieldPath: ['stix', 'x_mitre_domains'],
    errorCode: 'invalid_type',
    stixType: ['intrusion-set', 'campaign', 'x-mitre-matrix', 'x-mitre-detection-strategy'],
    suppressError: true,
  },
  // Users cannot set x_mitre_attack_spec_version - this is handled by the backend
  {
    fieldPath: ['stix', 'x_mitre_attack_spec_version'],
    errorCode: 'invalid_type',
    stixType: 'all',
    suppressError: true,
  },
  // Users cannot set object_marking_refs on campaigns
  {
    fieldPath: ['stix', 'object_marking_refs'],
    errorCode: 'invalid_type',
    stixType: ['campaign', 'identity'],
    suppressError: true,
  },
  {
    fieldPath: ['stix', 'created_by_ref'],
    errorCode: 'invalid_type',
    stixType: ['campaign', 'x-mitre-matrix', 'x-mitre-asset', 'course-of-action'],
    suppressError: true,
  },
  // Add more rules here as needed
];
exports.ERROR_TRANSFORMATION_RULES = ERROR_TRANSFORMATION_RULES;

/**
 * Check if a validation error should be transformed (converted to warning or suppressed)
 * @param {Object} error - The validation error from Zod
 * @param {string} stixType - The STIX type being validated
 * @returns {Object|null} The rule that matches, or null if no transformation should occur
 */
function shouldTransformError(error, stixType) {
  for (const rule of ERROR_TRANSFORMATION_RULES) {
    // Validate that suppressError and warningMessage are mutually exclusive
    if (rule.suppressError && rule.warningMessage !== undefined && rule.warningMessage !== '') {
      console.warn(
        'Rule has both suppressError and warningMessage set. suppressError takes precedence.',
      );
    }

    // Check if stixType matches (if specified in rule)
    if (rule.stixType) {
      // Handle 'all' case
      if (rule.stixType === 'all') {
        // Match any STIX type
      } else if (Array.isArray(rule.stixType)) {
        // Check if current stixType is in the array
        if (!rule.stixType.includes(stixType)) {
          continue;
        }
      } else if (rule.stixType !== stixType) {
        // Single string comparison
        continue;
      }
    }

    // Check if field path matches (if specified in rule)
    if (rule.fieldPath && JSON.stringify(rule.fieldPath) !== JSON.stringify(error.path)) {
      continue;
    }

    // Check if error code matches (if specified in rule)
    if (rule.errorCode && rule.errorCode !== error.code) {
      continue;
    }

    // All specified criteria match
    return rule;
  }
  return null;
}
exports.shouldTransformError = shouldTransformError;

/**
 * Process validation issues and separate them into errors and warnings
 * @param {Array} issues - Zod validation issues
 * @param {string} stixType - The STIX type being validated
 * @param {string} pathPrefix - Prefix to add to error paths (e.g., 'stix')
 * @returns {Object} Object with errors and warnings arrays
 */
function processValidationIssues(issues, stixType, pathPrefix = '') {
  const errors = [];
  const warnings = [];

  (issues || []).forEach((issue) => {
    const fullPath = pathPrefix ? [pathPrefix, ...issue.path] : issue.path;
    const errorData = {
      message: `${fullPath.join('.')} is ${issue.message}`,
      path: fullPath,
      code: issue.code,
      input: issue.input,
    };

    const transformationRule = shouldTransformError(errorData, stixType);

    if (transformationRule) {
      // Check if error should be suppressed (suppressError takes precedence)
      if (transformationRule.suppressError) {
        // Suppress the error entirely - don't add to errors or warnings
        return;
      } else if (transformationRule.warningMessage !== undefined) {
        // Convert error to warning
        warnings.push({
          message: transformationRule.warningMessage || errorData.message,
          path: errorData.path,
          code: errorData.code,
          input: issue.input,
        });
      } else {
        // Fallback - keep as error if no valid transformation
        errors.push(errorData);
      }
    } else {
      // Keep as error
      errors.push(errorData);
    }
  });

  return { errors, warnings };
}
exports.processValidationIssues = processValidationIssues;

/**
 * Validates a STIX object based on its type and status
 * @param {Object} payload - The request body
 * @param {string} payload.type - STIX object type
 * @param {string} payload.status - Validation strictness level
 * @param {Object} payload.stix - STIX object data to validate
 * @returns {Object} Validation result with valid flag and errors/data
 */
exports.validateStixObject = function (payload) {
  const { type, status, stix } = payload;

  // Check if STIX type is supported
  const baseSchema = STIX_SCHEMAS[type];
  if (!baseSchema) {
    return {
      valid: false,
      errors: [
        {
          message: `Unknown STIX type: ${type}`,
          path: ['type'],
          code: 'custom',
          input: type,
        },
      ],
    };
  }

  // Apply partial validation for work-in-progress
  const stixSchema = status === 'work-in-progress' ? baseSchema.partial() : baseSchema;

  // Validate STIX data
  const stixResult = stixSchema.safeParse(stix);
  // const stixResult = baseSchema.safeParse(stix);

  if (stixResult.success) {
    return {
      valid: true,
      data: stixResult.data,
    };
  }

  // Process validation errors and separate them into errors and warnings
  const { errors, warnings } = processValidationIssues(stixResult.error.issues, type, 'stix');

  return {
    valid: errors.length === 0, // Valid if no blocking errors (warnings are OK)
    errors,
    warnings,
  };
};
