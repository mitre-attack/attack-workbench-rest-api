'use strict';

const config = require('../../config/config');
const { BaseService } = require('../meta-classes');
const tacticsRepository = require('../../repository/tactics-repository');
const { Tactic: TacticType } = require('../../lib/types');
const techniquesService = require('./techniques-service');
const { BadlyFormattedParameterError, MissingParameterError } = require('../../exceptions');

class TacticsService extends BaseService {
  static techniquesService = null;

  static techniqueMatchesTactic(tactic) {
    return function (technique) {
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

  async retrieveTechniquesForTactic(stixId, modified, options) {
    // Retrieve the techniques associated with the tactic (the tactic identified by stixId and modified date)
    if (!stixId) {
      throw new MissingParameterError('stixId');
    }

    if (!modified) {
      throw new MissingParameterError('modified');
    }

    try {
      const tactic = await this.repository.retrieveOneByVersion(stixId, modified);

      // Note: document is null if not found
      if (!tactic) {
        return null;
      } else {
        const allTechniques = await techniquesService.retrieveAll({});
        const filteredTechniques = allTechniques.filter(
          TacticsService.techniqueMatchesTactic(tactic),
        );
        const pagedResults = TacticsService.getPageOfData(filteredTechniques, options);

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
        throw new BadlyFormattedParameterError({ parameterName: 'stixId' });
      } else {
        throw err;
      }
    }
  }
}

module.exports = new TacticsService(TacticType, tacticsRepository);
