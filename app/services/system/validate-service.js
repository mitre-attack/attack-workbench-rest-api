'use strict';
const { STIX_SCHEMAS, ERROR_TRANSFORMATION_RULES } = require('../../lib/validation-schemas');

/**
 * Get the schema to use for validating a STIX object.
 *
 * Some STIX types define both a "base" schema and "checks" (refinements),
 * while others only define a single schema (no refinements). This helper
 * composes the correct schema based on the STIX type and workflow status.
 *
 * Composition order (for schemas with checks):
 *   base → .partial() (if WIP) → .check(checks)
 *
 * This ordering is critical because Zod v4.3.6+ disallows .omit(), .pick(),
 * and .partial() on schemas that already have .check() applied.
 *
 * For WIP objects, all fields are made optional via .partial().
 * For non-WIP objects, the raw ADM schema is used as-is. Server-controlled
 * field errors are handled post-validation by ERROR_TRANSFORMATION_RULES.
 *
 * @param {string} stixType - The STIX `type` being validated (e.g. "attack-pattern")
 * @param {string} status - The workflow state (e.g. "work-in-progress", "awaiting-review", "reviewed")
 * @returns {Object|null} Zod schema, or null if the STIX type is unknown
 */
function getSchema(stixType, status) {
  const admSchemaRef = STIX_SCHEMAS[stixType];
  if (!admSchemaRef) return null;

  const isWip = status === 'work-in-progress';

  if (admSchemaRef.base && admSchemaRef.checks) {
    // Schema with refinements: compose in the safe order (partial BEFORE check)
    const base = isWip ? admSchemaRef.base.partial() : admSchemaRef.base;
    return base.check(admSchemaRef.checks);
  }

  // Simple schema (no refinements)
  return isWip ? admSchemaRef.partial() : admSchemaRef;
}
exports.getSchema = getSchema;

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

  // Get the schema to run
  const stixSchema = getSchema(type, status);

  // Validate STIX data
  const stixResult = stixSchema.safeParse(stix);

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
