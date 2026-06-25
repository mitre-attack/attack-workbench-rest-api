'use strict';

const campaignsRepository = require('../../repository/campaigns-repository');
const { BaseService } = require('../meta-classes');
const { Campaign: CampaignType } = require('../../lib/types');

class CampaignService extends BaseService {
  /**
   * Ensure aliases[0] is always the object's own name.
   *
   * - If no aliases exist, sets aliases to [name].
   * - If aliases exist, removes any prior occurrence of the current (and optionally
   *   previous) name, then prepends the current name at index 0.
   *
   * @param {Object} data - The campaign object data (mutated in place)
   * @param {string|null} [previousName=null] - The old name to strip on rename
   */
  _normalizeAliases(data, previousName = null) {
    const name = data.stix?.name;
    if (!name) return;

    let aliases = Array.isArray(data.stix.aliases) ? data.stix.aliases : [];

    // Remove current name (avoid duplicate) and previous name (if renamed)
    aliases = aliases.filter(
      (alias) => alias !== name && (previousName === null || alias !== previousName),
    );

    aliases.unshift(name);
    data.stix.aliases = aliases;
  }

  /**
   * Ensures aliases[0] matches the object name
   *
   * @param {Object} data - The campaign object data
   * @param {Object} [options] - Creation options
   */
  async beforeCreate(data, options) {
    // Import-fidelity contract: skip the alias normalization on the import
    // path. The normalization rewrites `stix.aliases` (rearranging entries
    // and prepending `stix.name`), which is correct for user-driven flows
    // but deviates the persisted analytic from the bundle source-of-truth.
    // `data.stix` is frozen during import-mode hooks (app/lib/import-safety.js),
    // so a missing gate here would throw a TypeError at the assignment in
    // `_normalizeAliases`.
    if (options?.import) return;
    this._normalizeAliases(data);
  }

  /**
   * Ensure aliases stays in sync on update.
   * If the name changed, the old name alias is replaced by the new one.
   */
  // eslint-disable-next-line no-unused-vars
  async beforeUpdate(_stixId, _stixModified, data, existingDocument, _options) {
    const previousName = existingDocument?.stix?.name ?? null;
    this._normalizeAliases(data, previousName);
  }
}

module.exports = new CampaignService(CampaignType, campaignsRepository);
