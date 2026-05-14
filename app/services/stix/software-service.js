'use strict';

const { PropertyNotAllowedError } = require('../../exceptions');

const { BaseService } = require('../meta-classes');
const softwareRepository = require('../../repository/software-repository');

const { Malware: MalwareType, Tool: ToolType } = require('../../lib/types');

class SoftwareService extends BaseService {
  /**
   * Ensure x_mitre_aliases[0] is always the object's own name.
   *
   * - If no aliases exist, sets aliases to [name].
   * - If aliases exist, removes any prior occurrence of the current (and optionally
   *   previous) name, then prepends the current name at index 0.
   *
   * @param {Object} data - The software object data (mutated in place)
   * @param {string|null} [previousName=null] - The old name to strip on rename
   */
  _normalizeAliases(data, previousName = null) {
    const name = data.stix?.name;
    if (!name) return;

    let aliases = Array.isArray(data.stix.x_mitre_aliases) ? data.stix.x_mitre_aliases : [];

    // Remove current name (avoid duplicate) and previous name (if renamed)
    aliases = aliases.filter(
      (alias) => alias !== name && (previousName === null || alias !== previousName),
    );

    aliases.unshift(name);
    data.stix.x_mitre_aliases = aliases;
  }

  /**
   * Set domain-specific defaults before creating a software object.
   * - For malware: `is_family` defaults to true
   * - For tools: `is_family` is not allowed
   * - Ensures x_mitre_aliases[0] matches the object name
   *
   * @param {Object} data - The software object data
   * @param {Object} [options] - Creation options
   */
  async beforeCreate(data, options) {
    // Import-fidelity contract: defaulting `stix.is_family` and rewriting
    // `stix.x_mitre_aliases` is correct for user-driven flows where the
    // server is the authority on these fields, but incorrect on the import
    // path — the bundle carries authoritative values (including a deliberate
    // omission of `is_family` for malware that doesn't represent a family,
    // which must NOT be defaulted to `true`). `data.stix` is frozen during
    // import-mode hooks (app/lib/import-safety.js), so a missing gate would
    // throw a TypeError at the first attempted stix write below.
    if (options?.import) return;

    // Set is_family default for malware
    if (data.stix && data.stix.type === MalwareType && typeof data.stix.is_family !== 'boolean') {
      data.stix.is_family = true;
    }
    // Validate that is_family is not set for tools
    else if (data.stix && data.stix.type === ToolType && data.stix.is_family !== undefined) {
      throw new PropertyNotAllowedError('is_family is not allowed for tool objects');
    }

    this._normalizeAliases(data);
  }

  /**
   * Ensure x_mitre_aliases stays in sync on update.
   * If the name changed, the old name alias is replaced by the new one.
   */
  // eslint-disable-next-line no-unused-vars
  async beforeUpdate(_stixId, _stixModified, data, existingDocument, _options) {
    const previousName = existingDocument?.stix?.name ?? null;
    this._normalizeAliases(data, previousName);
  }

  /**
   * Override create to handle type validation for multiple types (malware and tool).
   * SoftwareService handles both 'malware' and 'tool' types, so we need custom validation.
   * We temporarily set this.type to match the incoming data type so BaseService validation passes.
   */
  async create(data, options) {
    // Validate that the type is either malware or tool
    if (data?.stix?.type !== MalwareType && data?.stix?.type !== ToolType) {
      const { InvalidTypeError } = require('../../exceptions');
      throw new InvalidTypeError();
    }

    // Temporarily set this.type to the incoming type for BaseService validation
    const originalType = this.type;
    this.type = data.stix.type;

    try {
      // Call parent create which will trigger beforeCreate hook
      return await super.create(data, options);
    } finally {
      // Restore original type
      this.type = originalType;
    }
  }
}

module.exports = new SoftwareService(null, softwareRepository);
