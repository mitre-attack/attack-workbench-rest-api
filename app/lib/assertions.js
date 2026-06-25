'use strict';

const { BadlyFormattedParameterError } = require('../exceptions');

/**
 * Service-layer assertion utilities
 *
 * This module provides assertion helpers for validating internal invariants in the service layer.
 * Unlike middleware validation (which validates user input), these assertions check for programming
 * errors and data integrity issues that should never occur in normal operation.
 *
 * These assertions throw BadlyFormattedParameterError (resulting in 400 responses for direct API calls)
 * and are caught and categorized as validation errors during bulk import operations.
 *
 * Usage:
 * ```
 * const assertions = require('./lib/assertions');
 * assertions.assertUnique(refs, 'x_mitre_analytic_refs', { stixId: 'x-mitre-detection-strategy--123' });
 * ```
 */

/**
 * Assert that an array contains only unique values
 *
 * @param {Array|undefined|null} array - The array to check for uniqueness (undefined/null are allowed and skip validation)
 * @param {string} fieldName - Name of the field being checked (for error messages)
 * @param {object} context - Additional context to include in error message (e.g., { stixId: '...' })
 * @throws {BadlyFormattedParameterError} If array is provided but not an array type, or contains duplicate values
 *
 * @example
 * assertUnique(['a', 'b', 'c'], 'analytic_refs', { stixId: 'detection-strategy--123' });
 * // Passes
 *
 * assertUnique(undefined, 'analytic_refs', { stixId: 'detection-strategy--123' });
 * // Passes (undefined is allowed - field is optional)
 *
 * assertUnique(['a', 'b', 'a'], 'analytic_refs', { stixId: 'detection-strategy--123' });
 * // Throws: BadlyFormattedParameterError: analytic_refs must contain unique values. Found duplicates in detection-strategy--123
 */
function assertUnique(array, fieldName, context = {}) {
  // Allow undefined/null - the field may be optional
  if (array === undefined || array === null) {
    return;
  }

  if (!Array.isArray(array)) {
    throw new BadlyFormattedParameterError({
      parameterName: fieldName,
      message: `${fieldName} must be an array, got ${typeof array}`,
    });
  }

  if (array.length === 0) {
    return; // Empty arrays are trivially unique
  }

  const uniqueValues = new Set(array);
  const contextStr = context.stixId ? ` in ${context.stixId}` : '';

  if (uniqueValues.size !== array.length) {
    throw new BadlyFormattedParameterError({
      parameterName: fieldName,
      message: `${fieldName} must contain unique values. Found duplicates${contextStr}`,
    });
  }
}

module.exports = {
  assertUnique,
};
