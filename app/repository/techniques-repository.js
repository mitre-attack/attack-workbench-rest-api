'use strict';

const BaseRepository = require('./_base.repository');
const Technique = require('../models/technique-model');
const { DatabaseError } = require('../exceptions');

class TechniqueRepository extends BaseRepository {
  /**
   * Retrieve the latest version of each technique whose kill_chain_phases contains
   * a phase with the given phase_name. Returns plain objects (no _id or internal fields).
   * Used when creating new technique versions to propagate a tactic shortname change.
   *
   * @param {string} phaseName - The phase_name value to filter by
   * @returns {Promise<Array<Object>>} Array of plain technique objects (latest version each)
   */
  async retrieveAllLatestByPhaseName(phaseName) {
    try {
      const aggregation = [
        { $sort: { 'stix.id': 1, 'stix.modified': -1 } },
        { $group: { _id: '$stix.id', document: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$document' } },
        { $match: { 'stix.kill_chain_phases.phase_name': phaseName } },
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
   * @param {string} oldPhaseName - The previous x_mitre_shortname value
   * @param {string} newPhaseName - The new x_mitre_shortname value
   * @returns {Promise<import('mongoose').UpdateWriteOpResult>}
   */
  async updatePhaseName(oldPhaseName, newPhaseName) {
    try {
      return await this.model.updateMany(
        { 'stix.kill_chain_phases.phase_name': oldPhaseName },
        { $set: { 'stix.kill_chain_phases.$[elem].phase_name': newPhaseName } },
        { arrayFilters: [{ 'elem.phase_name': oldPhaseName }] },
      );
    } catch (err) {
      throw new DatabaseError(err);
    }
  }
}

module.exports = new TechniqueRepository(Technique);
