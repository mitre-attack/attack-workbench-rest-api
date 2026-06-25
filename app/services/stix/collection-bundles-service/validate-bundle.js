'use strict';

const semver = require('semver');
const config = require('../../../config/config');

// Constants for validation error types
const { validationErrors, defaultAttackSpecVersion, makeKey } = require('./bundle-helpers');

/**
 * Validates a STIX bundle for duplicate objects and ATT&CK spec version compatibility
 * @param {Object} bundle - The STIX bundle to validate
 * @param {Array<Object>} bundle.objects - Array of STIX objects in the bundle
 * @returns {Object} Validation results containing:
 *   - errors: Array of validation error objects
 *   - duplicateObjectInBundleCount: Number of duplicate objects found
 *   - invalidAttackSpecVersionCount: Number of invalid ATT&CK spec versions
 * @throws {Error} If the bundle is malformed or missing required properties
 */
module.exports = function validateBundle(bundle) {
  try {
    const validationResult = {
      errors: [],
      duplicateObjectInBundleCount: 0,
      invalidAttackSpecVersionCount: 0,
    };

    // Track unique objects using a Map for O(1) lookup
    const objectMap = new Map();

    // Validate each object in the bundle
    for (const stixObject of bundle.objects) {
      // Check for duplicate objects based on ID and modified date
      const key = makeKey(stixObject.id, stixObject.modified);
      if (objectMap.has(key)) {
        validationResult.errors.push({
          type: validationErrors.duplicateObjectInBundle,
          id: stixObject.id,
          modified: stixObject.modified,
        });
        validationResult.duplicateObjectInBundleCount += 1;
      } else {
        objectMap.set(key, stixObject);
      }

      if (stixObject.type != 'marking-definition') {
        // Validate ATT&CK spec version compatibility
        const objectAttackSpecVersion =
          stixObject.x_mitre_attack_spec_version ?? defaultAttackSpecVersion;

        // Check if version is valid semver and compatible with system version
        if (
          !semver.valid(objectAttackSpecVersion) ||
          semver.gt(objectAttackSpecVersion, config.app.attackSpecVersion)
        ) {
          validationResult.errors.push({
            type: validationErrors.invalidAttackSpecVersion,
            id: stixObject.id,
            modified: stixObject.modified,
          });
          validationResult.invalidAttackSpecVersionCount += 1;
        }
      }
    }
    return validationResult;
  } catch (error) {
    throw new Error(`Bundle validation failed: ${error.message}`);
  }
};
