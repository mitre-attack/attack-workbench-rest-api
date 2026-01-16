'use strict';

const assert = require('assert');

/**
 * Service-layer assertion utilities
 *
 * This module provides assertion helpers for validating internal invariants in the service layer.
 * Unlike middleware validation (which validates user input), these assertions check for programming
 * errors and data integrity issues that should never occur in normal operation.
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
 * @param {Array} array - The array to check for uniqueness
 * @param {string} fieldName - Name of the field being checked (for error messages)
 * @param {object} context - Additional context to include in error message (e.g., { stixId: '...' })
 * @throws {AssertionError} If array contains duplicate values
 *
 * @example
 * assertUnique(['a', 'b', 'c'], 'analytic_refs', { stixId: 'detection-strategy--123' });
 * // Passes
 *
 * assertUnique(['a', 'b', 'a'], 'analytic_refs', { stixId: 'detection-strategy--123' });
 * // Throws: AssertionError: analytic_refs must contain unique values. Found duplicates in detection-strategy--123
 */
function assertUnique(array, fieldName, context = {}) {
  if (!Array.isArray(array)) {
    assert.fail(`${fieldName} must be an array, got ${typeof array}`);
  }

  if (array.length === 0) {
    return; // Empty arrays are trivially unique
  }

  const uniqueValues = new Set(array);
  const contextStr = context.stixId ? ` in ${context.stixId}` : '';

  assert.strictEqual(
    uniqueValues.size,
    array.length,
    `${fieldName} must contain unique values. Found duplicates${contextStr}`,
  );
}

module.exports = {
  assertUnique,
};
