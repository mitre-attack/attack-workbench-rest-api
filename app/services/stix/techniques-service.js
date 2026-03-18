'use strict';

const config = require('../../config/config');
const { BaseService } = require('../meta-classes');
const techniquesRepository = require('../../repository/techniques-repository');

const { Technique: TechniqueType } = require('../../lib/types');
const { BadlyFormattedParameterError, MissingParameterError } = require('../../exceptions');
const EventBus = require('../../lib/event-bus');
const EventConstants = require('../../lib/event-constants');
const logger = require('../../lib/logger');

/**
 * Service for managing techniques and sub-techniques
 *
 * Event listeners:
 * - x-mitre-tactic::shortname-changed - Updates kill_chain_phases.phase_name on all
 *   technique documents when a tactic's x_mitre_shortname changes
 */
class TechniquesService extends BaseService {
  /**
   * Initialize event listeners.
   * Called once on module load.
   */
  static initializeEventListeners() {
    EventBus.on(
      EventConstants.TACTIC_SHORTNAME_CHANGED,
      TechniquesService.handleTacticShortnameChanged.bind(TechniquesService),
    );

    logger.info('TechniquesService: Event listeners initialized');
  }

  /**
   * Handle a tactic x_mitre_shortname change by updating all technique documents
   * whose kill_chain_phases contain the old phase_name.
   *
   * @param {Object} payload - Event payload
   * @param {string} payload.tacticId - STIX ID of the updated tactic
   * @param {string} payload.oldShortname - Previous x_mitre_shortname value
   * @param {string} payload.newShortname - New x_mitre_shortname value
   */
  static async handleTacticShortnameChanged(payload) {
    const { tacticId, oldShortname, newShortname, createNewVersion } = payload;

    logger.info(
      `TechniquesService: Propagating tactic shortname change '${oldShortname}' -> '${newShortname}' via ${createNewVersion ? 'new technique versions' : 'in-place update'}`,
      { tacticId },
    );

    if (createNewVersion) {
      await TechniquesService._propagateShortnameViaNewVersions(
        tacticId,
        oldShortname,
        newShortname,
      );
    } else {
      await TechniquesService._propagateShortnameInPlace(tacticId, oldShortname, newShortname);
    }
  }

  /**
   * Propagate a shortname change by creating a new version of each connected technique.
   * Used when the tactic shortname changed via a create (POST) operation, keeping the
   * technique history intact by appending rather than editing in-place.
   *
   * @param {string} tacticId - STIX ID of the updated tactic (for logging)
   * @param {string} oldShortname - Previous x_mitre_shortname value
   * @param {string} newShortname - New x_mitre_shortname value
   */
  static async _propagateShortnameViaNewVersions(tacticId, oldShortname, newShortname) {
    const techniques = await techniquesRepository.retrieveAllLatestByPhaseName(oldShortname);

    logger.info(
      `TechniquesService: Creating new versions for ${techniques.length} technique(s) due to tactic shortname change`,
      { tacticId, oldShortname, newShortname },
    );

    for (const technique of techniques) {
      try {
        // Clone stix shallowly — only kill_chain_phases needs to change
        const newVersion = {
          ...technique,
          stix: {
            ...technique.stix,
            modified: new Date().toISOString(),
            kill_chain_phases: (technique.stix.kill_chain_phases || []).map((phase) =>
              phase.phase_name === oldShortname
                ? { ...phase, phase_name: newShortname }
                : { ...phase },
            ),
          },
        };

        await techniquesRepository.save(newVersion);

        logger.info(
          `TechniquesService: Created new version of technique ${technique.stix.id} with updated phase_name`,
          { tacticId, oldShortname, newShortname },
        );
      } catch (error) {
        logger.error(
          `TechniquesService: Error creating new version of technique ${technique.stix?.id}:`,
          error,
        );
      }
    }
  }

  /**
   * Propagate a shortname change by updating all technique documents in-place.
   * Used when the tactic shortname changed via an update (PUT) operation.
   *
   * @param {string} tacticId - STIX ID of the updated tactic (for logging)
   * @param {string} oldShortname - Previous x_mitre_shortname value
   * @param {string} newShortname - New x_mitre_shortname value
   */
  static async _propagateShortnameInPlace(tacticId, oldShortname, newShortname) {
    try {
      const result = await techniquesRepository.updatePhaseName(oldShortname, newShortname);
      logger.info(
        `TechniquesService: Updated ${result.modifiedCount} technique document(s) in-place for tactic shortname change`,
        { tacticId, oldShortname, newShortname },
      );
    } catch (error) {
      logger.error(
        `TechniquesService: Error updating techniques in-place for tactic shortname change '${oldShortname}' -> '${newShortname}':`,
        error,
      );
    }
  }

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

TechniquesService.initializeEventListeners();

module.exports = new TechniquesService(TechniqueType, techniquesRepository);
