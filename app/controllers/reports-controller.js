'use strict';

const reportsService = require('../services/reports-service');
const logger = require('../lib/logger');

/**
 * Handler for GET /api/reports/link-by-id/missing
 * Retrieves objects that contain "attack.mitre.org" in their description.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getMissingLinkById = async function (req, res) {
  const options = {
    type: req.query.type,
  };

  try {
    const results = await reportsService.getMissingLinkById(options);
    logger.debug(`Success: Retrieved ${results.length} object(s) with missing LinkById`);
    return res.status(200).send(results);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get objects with missing LinkById. Server error.');
  }
};

/**
 * Handler for GET /api/reports/parallel-relationships
 * Retrieves parallel relationships (same source_ref, target_ref, and relationship_type).
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getParallelRelationships = async function (req, res) {
  try {
    const results = await reportsService.getParallelRelationships();
    logger.debug(`Success: Retrieved ${results.size} set(s) of parallel relationship(s)`);
    // Convert Map to object for JSON serialization
    return res.status(200).send(Object.fromEntries(results));
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get parallel relationships. Server error.');
  }
};
