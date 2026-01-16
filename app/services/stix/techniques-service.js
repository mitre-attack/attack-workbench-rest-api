'use strict';

const config = require('../../config/config');
const { BaseService } = require('../meta-classes');
const techniquesRepository = require('../../repository/techniques-repository');

const { Technique: TechniqueType } = require('../../lib/types');
const { BadlyFormattedParameterError, MissingParameterError } = require('../../exceptions');

class TechniquesService extends BaseService {
  static tacticsService = null;

  static tacticMatchesTechnique(technique) {
    return function (tactic) {
      // A tactic matches if the technique has a kill chain phase such that:
      //   1. The phase's kill_chain_name matches one of the tactic's kill chain names (which are derived from the tactic's x_mitre_domains)
      //   2. The phase's phase_name matches the tactic's x_mitre_shortname

      // Convert the tactic's domain names to kill chain names
      const tacticKillChainNames = tactic.stix.x_mitre_domains.map(
        (domain) => config.domainToKillChainMap[domain],
      );
      return technique.stix.kill_chain_phases.some(
        (phase) =>
          phase.phase_name === tactic.stix.x_mitre_shortname &&
          tacticKillChainNames.includes(phase.kill_chain_name),
      );
    };
  }

  static getPageOfData(data, options) {
    const startPos = options.offset;
    const endPos =
      options.limit === 0 ? data.length : Math.min(options.offset + options.limit, data.length);

    return data.slice(startPos, endPos);
  }

  async retrieveTacticsForTechnique(stixId, modified, options) {
    // Late binding to avoid circular dependency between modules
    if (!TechniquesService.tacticsService) {
      TechniquesService.tacticsService = require('./tactics-service');
    }

    // Retrieve the tactics associated with the technique (the technique identified by stixId and modified date)
    if (!stixId) {
      throw new MissingParameterError('stixId');
    }

    if (!modified) {
      throw new MissingParameterError('modified');
    }

    try {
      const technique = await this.repository.retrieveOneByVersion(stixId, modified);
      if (!technique) {
        // Note: document is null if not found
        return null;
      } else {
        const allTactics = await TechniquesService.tacticsService.retrieveAll({});
        const filteredTactics = allTactics.filter(
          TechniquesService.tacticMatchesTechnique(technique),
        );
        const pagedResults = TechniquesService.getPageOfData(filteredTactics, options);

        if (options.includePagination) {
          const returnValue = {
            pagination: {
              total: pagedResults.length,
              offset: options.offset,
              limit: options.limit,
            },
            data: pagedResults,
          };
          return returnValue;
        } else {
          return pagedResults;
        }
      }
    } catch (err) {
      if (err.name === 'CastError') {
        throw new BadlyFormattedParameterError();
      } else {
        throw err;
      }
    }
  }
}

module.exports = new TechniquesService(TechniqueType, techniquesRepository);
