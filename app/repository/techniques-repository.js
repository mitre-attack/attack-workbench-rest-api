'use strict';

const BaseRepository = require('./_base.repository');
const Technique = require('../models/technique-model');
const { DatabaseError } = require('../exceptions');

class TechniqueRepository extends BaseRepository {
  /**
   * Retrieve the latest version of each technique whose kill_chain_phases contains
   * a phase with the given phase_name (and optionally matching kill_chain_name).
   * Returns plain objects (no _id or internal fields).
   * Used when creating new technique versions to propagate a tactic shortname change.
   *
   * @param {string} phaseName - The phase_name value to filter by
   * @param {string[]} [killChainNames] - If non-empty, only match phases whose
   *   kill_chain_name is in this list (scopes the change to specific domains)
   * @returns {Promise<Array<Object>>} Array of plain technique objects (latest version each)
   */
  async retrieveAllLatestByPhaseName(phaseName, killChainNames = []) {
    try {
      const phaseMatch =
        killChainNames.length > 0
          ? {
              'stix.kill_chain_phases': {
                $elemMatch: {
                  phase_name: phaseName,
                  kill_chain_name: { $in: killChainNames },
                },
              },
            }
          : { 'stix.kill_chain_phases.phase_name': phaseName };

      const aggregation = [
        { $sort: { 'stix.id': 1, 'stix.modified': -1 } },
        { $group: { _id: '$stix.id', document: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$document' } },
        { $match: phaseMatch },
        { $project: { _id: 0, __v: 0, __t: 0 } },
      ];
      return await this.model.aggregate(aggregation).exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  /**
   * Bulk-update the phase_name in kill_chain_phases across all technique versions.
   * Called when a tactic's x_mitre_shortname changes so that connected techniques
   * remain consistent.
   *
   * When killChainNames is provided, only phases whose kill_chain_name is in the
   * list are updated — this prevents cross-domain propagation (e.g. an enterprise
   * tactic rename should not affect mobile techniques).
   *
   * @param {string} oldPhaseName - The previous x_mitre_shortname value
   * @param {string} newPhaseName - The new x_mitre_shortname value
   * @param {string[]} [killChainNames] - If non-empty, restrict updates to phases
   *   whose kill_chain_name is in this list
   * @returns {Promise<import('mongoose').UpdateWriteOpResult>}
   */
  async updatePhaseName(oldPhaseName, newPhaseName, killChainNames = []) {
    try {
      const arrayFilter =
        killChainNames.length > 0
          ? { 'elem.phase_name': oldPhaseName, 'elem.kill_chain_name': { $in: killChainNames } }
          : { 'elem.phase_name': oldPhaseName };

      return await this.model.updateMany(
        { 'stix.kill_chain_phases.phase_name': oldPhaseName },
        { $set: { 'stix.kill_chain_phases.$[elem].phase_name': newPhaseName } },
        { arrayFilters: [arrayFilter] },
      );
    } catch (err) {
      throw new DatabaseError(err);
    }
  }
}

module.exports = new TechniqueRepository(Technique);
