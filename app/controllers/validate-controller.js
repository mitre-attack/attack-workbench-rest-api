'use strict';

const { z } = require('zod');
const { StatusCodes } = require('http-status-codes');
const validateService = require('../services/validate-service');
const logger = require('../lib/logger');

const validationRequestSchema = z.object({
  type: z.string(),
  status: z.enum(['work-in-progress', 'awaiting-review', 'reviewed', 'static']),
  stix: z.object({}).loose(),
});

/**
 * Controller for validating STIX objects
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.validate = async function (req, res) {
  logger.debug(req.body);
  try {
    // Validate request structure
    const requestResult = validationRequestSchema.safeParse(req.body);
    if (!requestResult.success) {
      const errors =
        requestResult.error.issues?.map((issue) => ({
          message: `${issue.path?.join('.') || 'root'} is ${issue.message}`,
          path: issue.path,
          code: issue.code,
        })) || [];
      logger.error('Cannot validate request body', { errors });
      return res.status(StatusCodes.BAD_REQUEST).json({ errors });
    } else {
      const result = validateService.validateStixObject(req.body);
      res.json(result);
    }
  } catch (error) {
    console.error('Validation controller error:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: 'Internal Server Error',
    });
  }
};
