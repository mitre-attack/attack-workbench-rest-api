'use strict';

// =============================================================================
// Version Utilities
//
// Parsing, comparison, calculation, and validation for MAJOR.MINOR version
// strings used by release track tagging.
//
// ATT&CK release tracks use a two-part versioning scheme (MAJOR.MINOR),
// not three-part semver. See docs/COLLECTIONS_V2/03_VERSIONING.md.
// =============================================================================

const { InvalidVersionError } = require('../../exceptions');

const VERSION_PATTERN = /^\d+\.\d+$/;

/**
 * Parse a version string into its numeric components.
 *
 * @param {string} str - Version string in "MAJOR.MINOR" format
 * @returns {{ major: number, minor: number }}
 * @throws {InvalidVersionError} If the string is not a valid version
 */
exports.parseVersion = function parseVersion(str) {
  if (!str || !VERSION_PATTERN.test(str)) {
    throw new InvalidVersionError(`Invalid version format: "${str}" (expected MAJOR.MINOR)`);
  }
  const [major, minor] = str.split('.').map(Number);
  return { major, minor };
};

/**
 * Compare two version strings.
 *
 * @param {string} a - First version
 * @param {string} b - Second version
 * @returns {number} -1 if a < b, 0 if a === b, 1 if a > b
 */
exports.compareVersions = function compareVersions(a, b) {
  const va = exports.parseVersion(a);
  const vb = exports.parseVersion(b);

  if (va.major !== vb.major) return va.major < vb.major ? -1 : 1;
  if (va.minor !== vb.minor) return va.minor < vb.minor ? -1 : 1;
  return 0;
};

/**
 * Calculate the next version based on version history and bump type.
 *
 * If an explicit version is provided, it is returned as-is (validation
 * is handled separately by validateVersionProgression).
 *
 * If the version history is empty, the first version defaults to "1.0".
 *
 * @param {Array<{ version: string }>} versionHistory - Existing version history entries
 * @param {string} [bumpType='minor'] - 'major' or 'minor'
 * @param {string} [explicitVersion] - Explicit version override
 * @returns {string} The calculated version string
 */
exports.calculateNextVersion = function calculateNextVersion(
  versionHistory,
  bumpType,
  explicitVersion,
) {
  if (explicitVersion) {
    // Validate format only; monotonicity is checked by validateVersionProgression
    exports.parseVersion(explicitVersion);
    return explicitVersion;
  }

  if (!versionHistory || versionHistory.length === 0) {
    return '1.0';
  }

  // Find the highest existing version (history may not be sorted)
  let highest = null;
  for (const entry of versionHistory) {
    if (!highest || exports.compareVersions(entry.version, highest) > 0) {
      highest = entry.version;
    }
  }

  const { major, minor } = exports.parseVersion(highest);
  const type = bumpType || 'minor';

  return type === 'major' ? `${major + 1}.0` : `${major}.${minor + 1}`;
};

/**
 * Validate that a new version is strictly greater than all existing versions.
 *
 * @param {string} newVersion - The version to validate
 * @param {Array<{ version: string }>} versionHistory - Existing version history entries
 * @throws {InvalidVersionError} If the version is not greater than all existing versions
 */
exports.validateVersionProgression = function validateVersionProgression(
  newVersion,
  versionHistory,
) {
  if (!versionHistory || versionHistory.length === 0) {
    return; // No history — any valid version is acceptable
  }

  for (const entry of versionHistory) {
    if (exports.compareVersions(newVersion, entry.version) <= 0) {
      throw new InvalidVersionError(
        `Version "${newVersion}" must be greater than existing version "${entry.version}"`,
      );
    }
  }
};
