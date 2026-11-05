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
 * Handler for GET /api/reports/domain-consistency
 * Retrieves active relationships whose endpoints share no domain and
 * domain-bearing objects that declare no domain.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getDomainConsistency = async function (req, res) {
  try {
    const results = await reportsService.getDomainConsistency();
    logger.debug(
      `Success: Retrieved ${results.summary.cross_domain_relationship_count} cross-domain relationship(s) and ${results.summary.objects_without_domains_count} object(s) without domains`,
    );
    return res.status(200).send(results);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get the domain consistency report. Server error.');
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

/**
 * Handler for GET /api/reports/release-track-coverage.
 * Returns latest SDO revisions with missing or no recorded release-track membership.
 */
exports.getReleaseTrackCoverage = async function (req, res) {
  try {
    const results = await reportsService.getReleaseTrackCoverage();
    logger.debug(
      `Success: Retrieved ${results.summary.untracked_latest_revision_count} untracked latest revision(s) and ${results.summary.never_enrolled_object_count} object(s) with no recorded membership`,
    );
    return res.status(200).send(results);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get the release-track coverage report. Server error.');
  }
};
