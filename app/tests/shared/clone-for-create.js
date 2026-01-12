'use strict';

const _ = require('lodash');
const config = require('../../config/config');

/**
 * Creates a deep clone of an ATT&CK object suitable for POST requests.
 *
 * This utility strips all backend-controlled and database-specific fields that would
 * cause ImmutablePropertyError or other validation errors when creating new versions
 * of existing objects via POST requests.
 *
 * Fields removed:
 * - workspace.attack_id: Backend generates ATT&CK IDs; clients cannot set them
 * - MITRE ATT&CK external references: Backend controls official ATT&CK citations
 * - MongoDB fields: _id, __t, __v (database-specific fields)
 *
 * @param {Object} attackObject - The ATT&CK object to clone
 * @returns {Object} A deep clone suitable for POST requests
 *
 * @example
 * // Clone an existing technique to create a new version
 * const technique2 = cloneForCreate(technique1);
 * technique2.stix.modified = new Date().toISOString();
 * technique2.stix.description = 'Updated description';
 * // Now safe to POST technique2
 */
function cloneForCreate(attackObject) {
  // Perform deep clone
  const cloned = _.cloneDeep(attackObject);

  // Remove MongoDB-specific fields
  delete cloned._id;
  delete cloned.__t;
  delete cloned.__v;

  // Remove backend-controlled ATT&CK ID from workspace
  if (cloned.workspace && cloned.workspace.attack_id) {
    delete cloned.workspace.attack_id;
  }

  // Remove MITRE ATT&CK external references (backend controls these)
  if (cloned.stix && cloned.stix.external_references) {
    cloned.stix.external_references = cloned.stix.external_references.filter(
      (ref) => !config.attackSourceNames.includes(ref.source_name),
    );
    // If the list is now empty, remove the field
    if (cloned.stix.external_references.length === 0) {
      delete cloned.stix.external_references;
    }
  }

  return cloned;
}

module.exports = {
  cloneForCreate,
};
