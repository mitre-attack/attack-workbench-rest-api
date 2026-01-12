'use strict';

const { z, ZodError } = require('zod');
const { StatusCodes } = require('http-status-codes');
const logger = require('../lib/logger');
const { processValidationIssues } = require('../services/validate-service');
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

function extractStringLiteralFromStixTypeZodSchema(zodSchema) {
  // Method 1: Direct shape access (works for most schemas)
  if (zodSchema.shape?.type?.def?.values?.[0]) {
    return zodSchema.shape.type.def.values[0];
  }
  // Method 2: Through _zod.def.in.def (works for schemas with .transform())
  else if (zodSchema._zod?.def?.in?.def?.shape?.type?.def?.values?.[0]) {
    return zodSchema._zod.def.in.def.shape.type.def.values[0];
  }
  // Method 3: Works for schemas that support multiple types, i.e., softwareSchema -> [tool, malware]
  else if (zodSchema.shape?.type.def.options) {
    const stixTypes = [];
    for (const opt of zodSchema.shape.type.def.options) {
      stixTypes.push(opt.def.values[0]);
    }
    return stixTypes;
  } else {
    throw new Error('Could not extract STIX type from schema');
  }
}

/**
 * Factory function that creates a combined workspace+STIX schema with conditional partial validation
 * @param {z.ZodObject} stixSchema - The STIX object schema to validate against
 * @param {string} workflowState - The workflow state to determine validation strictness
 * @param {string[]} omitStixFields - Array of STIX field names to omit from validation
 * @returns {z.ZodObject} Combined schema with workspace and conditional stix validation
 */
/**
 * Factory function that creates a combined workspace+STIX schema with conditional partial validation
 * @param {z.ZodObject} stixSchema - The STIX object schema to validate against
 * @param {string} workflowState - The workflow state to determine validation strictness
 * @param {string[]} omitStixFields - Array of STIX field names to omit from validation
 * @returns {z.ZodObject} Combined schema with workspace and conditional stix validation
 */
function createWorkspaceStixSchema(
  stixSchema,
  workflowState,
  omitStixFields = ['x_mitre_attack_spec_version', 'external_references'],
) {
  logger.debug('Creating combined workspace+STIX schema:', { workflowState, omitStixFields });

  try {
    // Extract the STIX type from the schema with fallback for transformed schemas
    const stixTypeStringLiteral = extractStringLiteralFromStixTypeZodSchema(stixSchema);

    logger.debug('Extracted STIX type from schema:', { stixTypeStringLiteral });

    // Apply partial validation for work-in-progress, full validation otherwise
    const usePartialValidation = workflowState === 'work-in-progress';
    logger.debug('Validation mode:', { workflowState, usePartialValidation });

    let stixValidationSchema = usePartialValidation ? stixSchema.partial() : stixSchema;

    // Build omit object from array of field names
    if (omitStixFields.length > 0) {
      const omitObject = omitStixFields.reduce((acc, field) => {
        acc[field] = true;
        return acc;
      }, {});
      stixValidationSchema = stixValidationSchema.omit(omitObject);
    }

    const combinedSchema = z.object({
      workspace: createWorkspaceSchema(stixTypeStringLiteral),
      stix: stixValidationSchema,
    });

    logger.debug('Successfully created combined schema');
    return combinedSchema;
  } catch (error) {
    logger.warn('Could not extract STIX type from schema, using basic validation:', {
      error: error.message,
      workflowState,
      omitStixFields,
    });

    let stixValidationSchema =
      workflowState === 'work-in-progress' ? stixSchema.partial() : stixSchema;

    // Apply omit in error case as well
    if (omitStixFields.length > 0) {
      const omitObject = omitStixFields.reduce((acc, field) => {
        acc[field] = true;
        return acc;
      }, {});
      stixValidationSchema = stixValidationSchema.omit(omitObject);
    }

    return z.object({
      workspace: workspaceSchema,
      stix: stixValidationSchema,
    });
  }
}

/**
 * Middleware for parsing the request body using a specified STIX schema from the ATT&CK Data Model.
 * Both the `workspace` and `stix` keys are checked.
 * @param {z.ZodObject|z.ZodObject[]} oneOrMoreZodSchemas - Single schema or array of schemas to validate against
 * @param {Object} options - Configuration options
 * @param {boolean} options.enabled - Whether validation is enabled (defaults to true)
 * @returns {Function} Express middleware function
 */
function middleware(oneOrMoreZodSchemas, options = {}) {
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
      // Extract workflow state from request body
      const workflowState = req.body?.workspace?.workflow?.state || 'reviewed'; // Default to strict validation
      logger.debug('Determined workflow state:', {
        workflowState,
        isDefault: !req.body?.workspace?.workflow?.state,
      });

      // Determine which schema to use based on request STIX type
      const requestStixType = req.body?.stix?.type;
      logger.debug('Request STIX type:', { requestStixType });

      let finalSchema;

      // Handle array of schemas - find the one that matches the request type
      if (Array.isArray(oneOrMoreZodSchemas)) {
        logger.debug('Multiple schemas provided, finding matching schema for request type');

        for (const schema of oneOrMoreZodSchemas) {
          try {
            const schemaStixType = extractStringLiteralFromStixTypeZodSchema(schema);
            logger.debug('Checking schema with type:', { schemaStixType });

            // Check if this schema matches the request type
            if (
              (typeof schemaStixType === 'string' && schemaStixType === requestStixType) ||
              (Array.isArray(schemaStixType) && schemaStixType.includes(requestStixType))
            ) {
              logger.debug('Found matching schema for request type:', {
                requestStixType,
                schemaStixType,
              });
              finalSchema = schema;
              break;
            }
          } catch (error) {
            logger.debug('Could not extract type from schema, skipping:', { error: error.message });
            continue;
          }
        }

        if (!finalSchema) {
          throw new Error(
            `No matching schema found for STIX type: ${requestStixType}. Available schemas: ${oneOrMoreZodSchemas.length}`,
          );
        }
      } else {
        // Single schema - use it directly
        logger.debug('Single schema provided, using directly');
        finalSchema = oneOrMoreZodSchemas;
      }

      // Create schema with conditional validation based on workflow state
      const combinedSchema = createWorkspaceStixSchema(finalSchema, workflowState);

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
 * Pre-configured validation middleware factory that uses runtime configuration.
 * The middleware reads the config value at request time to support dynamic config changes (e.g., during tests).
 */
function validateWorkspaceStixData(oneOrMoreZodSchemas) {
  return (req, res, next) => {
    // Read config at request time to allow dynamic changes
    const config = require('../config/config');
    const enabled = config.validateRequests.withAttackDataModel;
    const middlewareFn = middleware(oneOrMoreZodSchemas, { enabled });
    return middlewareFn(req, res, next);
  };
}

module.exports = {
  /** Express middleware factory for workspace+STIX validation */
  validateWorkspaceStixData,
  /** Factory function for creating combined workspace+STIX schemas */
  createWorkspaceStixSchema,
  /** Basic workspace schema without dynamic attackId validation */
  workspaceSchema,
};
