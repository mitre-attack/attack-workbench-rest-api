'use strict';

const { z, ZodError } = require('zod');
const { StatusCodes } = require('http-status-codes');
const logger = require('../lib/logger');
const { processValidationIssues } = require('../services/system/validate-service');
const { STIX_SCHEMAS } = require('../lib/validation-schemas');
const {
  createAttackIdSchema,
  stixTypeToAttackIdMapping,
} = require('@mitre-attack/attack-data-model/dist/schemas/common/property-schemas/attack-id');

/**
 * Basic workspace schema (without rigid attack ID validation)
 * @type {z.ZodObject}
 */
const workspaceSchema = z.object({
  workflow: z
    .object({
      state: z.enum(['work-in-progress', 'awaiting-review', 'reviewed', 'static']),
    })
    .optional(),
  attackId: z.string().optional(),
  collections: z
    .array(
      z.object({
        collection_ref: z.string(),
        collection_modified: z.iso.datetime(),
      }),
    )
    .optional(),
});

/**
 * Creates a workspace schema with dynamic attackId validation based on STIX type
 * @param {string} stixType - The STIX type (e.g., 'x-mitre-tactic')
 * @returns {z.ZodObject} Workspace schema with appropriate attackId validation
 */
function createWorkspaceSchema(stixType) {
  logger.debug('Creating workspace schema for STIX type:', { stixType });

  // Check if this STIX type has an associated attack ID pattern
  const hasAttackId = stixType in stixTypeToAttackIdMapping;
  logger.debug('STIX type attack ID support:', { stixType, hasAttackId });

  // Add attackId validation only if this STIX type supports attack IDs
  if (hasAttackId) {
    logger.debug('Adding dynamic attackId validation for STIX type:', { stixType });
    return workspaceSchema.extend({
      attackId: createAttackIdSchema(stixType).optional(),
    });
  }

  // For STIX types without attack IDs, use the basic schema
  logger.debug('Using basic workspace schema (no attackId validation) for STIX type:', {
    stixType,
  });
  return workspaceSchema;
}

/**
 * Middleware for validating the request body against a pre-composed STIX schema.
 * Wraps the STIX schema with a workspace schema and parses the request body.
 * @param {z.ZodObject} stixSchema - Pre-composed STIX schema (with omit/partial/checks already applied)
 * @param {Object} options - Configuration options
 * @param {boolean} options.enabled - Whether validation is enabled (defaults to true)
 * @returns {Function} Express middleware function
 */
function middleware(stixSchema, options = {}) {
  const { enabled = true } = options;

  return (req, res, next) => {
    // Skip validation if disabled
    if (!enabled) {
      logger.debug('Workspace STIX validation is disabled, skipping');
      return next();
    }

    logger.debug('Starting workspace+STIX validation middleware');

    logger.debug('Request body structure:', {
      hasWorkspace: !!req.body?.workspace,
      hasStix: !!req.body?.stix,
      bodyKeys: Object.keys(req.body || {}),
      workflowState: req.body?.workspace?.workflow?.state,
    });

    try {
      const stixType = req.body?.stix?.type;

      // Wrap the pre-composed STIX schema with the workspace schema
      const combinedSchema = z.object({
        workspace: createWorkspaceSchema(stixType),
        stix: stixSchema,
      });

      logger.debug('Attempting to parse request body with combined schema');
      combinedSchema.parse(req.body);

      logger.debug('Validation successful, proceeding to next middleware');
      next();
    } catch (error) {
      logger.debug('Validation failed:', {
        errorType: error.constructor.name,
        isZodError: error instanceof ZodError,
      });

      if (error instanceof ZodError) {
        // Extract STIX type from request body for error-to-warning conversion
        const stixType = req.body?.stix?.type;

        // Process validation issues using shared logic to separate errors from warnings
        const { errors, warnings } = processValidationIssues(error.issues, stixType);

        logger.debug('Processed validation issues:', {
          issueCount: error.issues?.length,
          errorCount: errors.length,
          warningCount: warnings.length,
          errors,
          warnings,
        });

        // Only block the request if there are actual errors (warnings are OK)
        if (errors.length > 0) {
          logger.info('Request validation failed', {
            endpoint: req.path,
            method: req.method,
            validationErrors: errors,
            validationWarnings: warnings,
          });

          res.status(StatusCodes.BAD_REQUEST).json({
            error: 'Invalid data',
            details: errors,
            warnings: warnings.length > 0 ? warnings : undefined,
          });
        } else {
          // Only warnings, allow the request to proceed
          logger.info('Request validation passed with warnings', {
            endpoint: req.path,
            method: req.method,
            validationWarnings: warnings,
          });

          // Attach warnings to request for potential use by controllers
          req.validationWarnings = warnings;
          next();
        }
      } else {
        logger.error('Validation middleware error:', {
          error: error.message,
          stack: error.stack,
          endpoint: req.path,
          method: req.method,
        });
        res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Internal Server Error' });
      }
    }
  };
}

/**
 * Get the schema to use for validating a STIX object.
 *
 * Some STIX types define both a "base" schema and "checks" (refinements),
 * while others only define a single schema (no refinements). This helper
 * composes the correct schema based on the STIX type and workflow status.
 *
 * Composition order (for schemas with checks):
 *   base → .omit() → .partial() (if WIP) → .check(checks)
 *
 * This ordering is critical because Zod v4.3.6+ disallows .omit(), .pick(),
 * and .partial() on schemas that already have .check() applied.
 *
 * @param {string} stixType - The STIX `type` being validated (e.g. "attack-pattern")
 * @param {string} status - The workflow state (e.g. "work-in-progress", "awaiting-review", "reviewed")
 * @param {string[]} omitStixFields - Array of STIX field names to omit from validation
 * @returns {Object|null} Zod schema, or null if the STIX type is unknown
 */
function getSchema(
  stixType,
  status,
  omitStixFields = ['x_mitre_attack_spec_version', 'external_references'],
) {
  const admSchemaRef = STIX_SCHEMAS[stixType];
  if (!admSchemaRef) return null;

  const isPartial = status === 'work-in-progress';
  let stixSchema;

  if (admSchemaRef.base && admSchemaRef.checks) {
    // Schema with refinements: compose in the safe order (omit/partial BEFORE check)
    stixSchema = admSchemaRef.base;

    if (omitStixFields.length > 0) {
      const omitObject = omitStixFields.reduce((acc, field) => {
        acc[field] = true;
        return acc;
      }, {});
      stixSchema = stixSchema.omit(omitObject);
    }

    if (isPartial) {
      stixSchema = stixSchema.partial();
    }

    // Re-apply refinements last
    stixSchema = stixSchema.check(admSchemaRef.checks);
  } else {
    // Simple schema (no refinements): safe to call .omit() and .partial() directly
    stixSchema = admSchemaRef;

    if (omitStixFields.length > 0) {
      const omitObject = omitStixFields.reduce((acc, field) => {
        acc[field] = true;
        return acc;
      }, {});
      stixSchema = stixSchema.omit(omitObject);
    }

    if (isPartial) {
      stixSchema = stixSchema.partial();
    }
  }

  logger.debug('Resolved STIX schema:', { stixType, status, isPartial, omitStixFields });
  return stixSchema;
}

/**
 * Pre-configured validation middleware factory that uses runtime configuration.
 * The middleware reads the config value at request time to support dynamic config changes (e.g., during tests).
 *
 * @param {string|string[]} expectedStixType - The STIX type(s) this endpoint accepts
 *   (e.g. "attack-pattern" or ["tool", "malware"] for software)
 * @returns {Function} Express middleware function
 */
function validateWorkspaceStixData(expectedStixType) {
  const allowedTypes = Array.isArray(expectedStixType) ? expectedStixType : [expectedStixType];

  return (req, res, next) => {
    // Read config at request time to allow dynamic changes
    const config = require('../config/config');
    const enabled = config.validateRequests.withAttackDataModel;
    const requestStixType = req.body?.stix?.type;
    const workflowState = req.body?.workspace?.workflow?.state || 'reviewed';

    // Verify the request's STIX type is one this endpoint accepts
    if (!allowedTypes.includes(requestStixType)) {
      return next(
        new Error(
          `Unexpected STIX type "${requestStixType}". This endpoint accepts: ${allowedTypes.join(', ')}`,
        ),
      );
    }

    const finalSchema = getSchema(requestStixType, workflowState);
    if (!finalSchema) {
      return next(
        new Error(
          `No schema found for STIX type "${requestStixType}". Request body is probably invalid.`,
        ),
      );
    }

    const middlewareFn = middleware(finalSchema, { enabled });
    return middlewareFn(req, res, next);
  };
}

module.exports = {
  /** Express middleware factory for workspace+STIX validation */
  validateWorkspaceStixData,
  /** Basic workspace schema without dynamic attackId validation */
  workspaceSchema,
};
