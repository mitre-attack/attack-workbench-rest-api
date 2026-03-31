'use strict';

const { BaseService } = require('../meta-classes');
const groupsRepository = require('../../repository/groups-repository');
const { Group: GroupType } = require('../../lib/types');

class GroupsService extends BaseService {
  /**
   * Ensure aliases[0] is always the object's own name.
   *
   * - If no aliases exist, sets aliases to [name].
   * - If aliases exist, removes any prior occurrence of the current (and optionally
   *   previous) name, then prepends the current name at index 0.
   *
   * @param {Object} data - The group object data (mutated in place)
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
   * @param {Object} data - The group object data
   * @param {Object} _options - Creation options (unused)
   */
  // eslint-disable-next-line no-unused-vars
  async beforeCreate(data, _options) {
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

module.exports = new GroupsService(GroupType, groupsRepository);
