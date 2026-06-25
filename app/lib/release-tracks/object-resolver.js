'use strict';

// =============================================================================
// Object Resolver
//
// Resolves STIX object references to concrete modified timestamps by querying
// the existing STIX service layer. This is used when adding candidates with
// `modified: "latest"` or when modified is omitted.
//
// Follows the same serviceMap pattern as import-bundle.js.
// =============================================================================

const types = require('../types');
const { BadRequestError, NotFoundError } = require('../../exceptions');

// ---------------------------------------------------------------------------
// Service map – lazy-loaded to avoid circular dependency issues at startup.
// ---------------------------------------------------------------------------

let _serviceMap = null;

function getServiceMap() {
  if (_serviceMap) return _serviceMap;

  _serviceMap = {
    [types.Technique]: require('../../services/stix/techniques-service'),
    [types.Tactic]: require('../../services/stix/tactics-service'),
    [types.Group]: require('../../services/stix/groups-service'),
    [types.Campaign]: require('../../services/stix/campaigns-service'),
    [types.Mitigation]: require('../../services/stix/mitigations-service'),
    [types.Matrix]: require('../../services/stix/matrices-service'),
    [types.Relationship]: require('../../services/stix/relationships-service'),
    [types.MarkingDefinition]: require('../../services/stix/marking-definitions-service'),
    [types.Identity]: require('../../services/stix/identities-service'),
    [types.Note]: require('../../services/system/notes-service'),
    [types.DataSource]: require('../../services/stix/data-sources-service'),
    [types.DataComponent]: require('../../services/stix/data-components-service'),
    [types.Asset]: require('../../services/stix/assets-service'),
    [types.Analytic]: require('../../services/stix/analytics-service'),
    [types.DetectionStrategy]: require('../../services/stix/detection-strategies-service'),
  };

  // Software types share a single service
  const softwareService = require('../../services/stix/software-service');
  _serviceMap[types.Malware] = softwareService;
  _serviceMap[types.Tool] = softwareService;

  return _serviceMap;
}

/**
 * Resolve the latest `stix.modified` timestamp for a given STIX object ID.
 *
 * @param {string} objectRef - A STIX identifier (e.g. "attack-pattern--<uuid>")
 * @returns {Promise<Date>} The most recent modified timestamp for the object
 * @throws {BadRequestError} If the object type is not recognized
 * @throws {NotFoundError} If the object does not exist in the database
 */
exports.resolveLatestModified = async function resolveLatestModified(objectRef) {
  const type = objectRef.split('--')[0];
  const serviceMap = getServiceMap();
  const service = serviceMap[type];

  if (!service) {
    throw new BadRequestError({
      message: `Unknown object type: ${type}`,
      details: `Cannot resolve latest version for object ref "${objectRef}"`,
    });
  }

  // retrieveById with { versions: 'latest' } returns a single-element array
  // sorted by stix.modified descending. We use 'latest' to be efficient.
  const results = await service.retrieveById(objectRef, { versions: 'latest' });

  if (!results || results.length === 0) {
    throw new NotFoundError({
      details: `Object ${objectRef} not found — cannot resolve latest modified timestamp`,
    });
  }

  return new Date(results[0].stix.modified);
};
