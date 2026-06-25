'use strict';

const config = require('../../config/config');
const { BaseService } = require('../meta-classes');
const tacticsRepository = require('../../repository/tactics-repository');
const { Tactic: TacticType } = require('../../lib/types');
const techniquesService = require('./techniques-service');
const { BadlyFormattedParameterError, MissingParameterError } = require('../../exceptions');
const EventBus = require('../../lib/event-bus');
const EventConstants = require('../../lib/event-constants');
const logger = require('../../lib/logger');

/**
 * Service for managing tactics
 *
 * Lifecycle hooks:
 * - beforeUpdate: Detects changes to x_mitre_shortname and stores old/new values
 * - afterUpdate: Emits domain event when shortname changes so TechniquesService can
 *   update kill_chain_phases.phase_name on all connected techniques
 *
 * Events emitted (listened to by TechniquesService):
 * - x-mitre-tactic::shortname-changed
 */
class TacticsService extends BaseService {
  static techniquesService = null;

  static techniqueMatchesTactic(tactic) {
    return function (technique) {
      // A tactic matches if the technique has a kill chain phase such that:
      //   1. The phase's kill_chain_name matches one of the tactic's kill chain names (which are derived from the tactic's x_mitre_domains)
      //   2. The phase's phase_name matches the tactic's x_mitre_shortname
      // Convert the tactic's domain names to kill chain names
      if (!tactic.stix.x_mitre_domains?.length) {
        return false;
      }
      const tacticKillChainNames = tactic.stix.x_mitre_domains.map(
        (domain) => config.domainToKillChainMap[domain],
      );
      return technique.stix.kill_chain_phases?.some(
        (phase) =>
          phase.phase_name === tactic.stix.x_mitre_shortname &&
          tacticKillChainNames.includes(phase.kill_chain_name),
      );
    };
  }

  /**
   * Detect shortname changes when creating a new version of an existing tactic.
   * Compares against the current latest version; stores the change so afterCreate
   * can emit the domain event.
   */
  // eslint-disable-next-line no-unused-vars
  async beforeCreate(data, options) {
    if (!data.stix?.id) {
      return; // Brand-new tactic — no previous version to compare against
    }

    try {
      const previousVersion = await tacticsRepository.retrieveLatestByStixId(data.stix.id);
      if (!previousVersion) return;

      const oldShortname = previousVersion.stix?.x_mitre_shortname;
      const newShortname = data.stix?.x_mitre_shortname;

      if (oldShortname && newShortname && oldShortname !== newShortname) {
        this._shortnameChangeViaCreate = { oldShortname, newShortname };
      }
    } catch {
      logger.debug(`TacticsService: No previous version found for tactic ${data.stix.id}`);
    }
  }

  /**
   * Emit a domain event when a new tactic version has a changed x_mitre_shortname.
   * TechniquesService will create new technique versions to propagate the change.
   */
  // eslint-disable-next-line no-unused-vars
  async afterCreate(document, options) {
    if (this._shortnameChangeViaCreate) {
      const { oldShortname, newShortname } = this._shortnameChangeViaCreate;

      logger.info(
        `TacticsService: New tactic version with x_mitre_shortname change '${oldShortname}' -> '${newShortname}', emitting event`,
        { tacticId: document.stix.id },
      );

      await EventBus.emit(EventConstants.TACTIC_SHORTNAME_CHANGED, {
        tacticId: document.stix.id,
        oldShortname,
        newShortname,
        domains: document.stix.x_mitre_domains || [],
        createNewVersion: true,
      });

      delete this._shortnameChangeViaCreate;
    }
  }

  /**
   * Detect changes to x_mitre_shortname before the update is persisted.
   * Stores the old/new values so afterUpdate can emit the domain event.
   */
  // eslint-disable-next-line no-unused-vars
  async beforeUpdate(stixId, stixModified, data, existingDocument, options) {
    const oldShortname = existingDocument.stix?.x_mitre_shortname;
    const newShortname = data.stix?.x_mitre_shortname;

    if (oldShortname && newShortname && oldShortname !== newShortname) {
      this._shortnameChange = { oldShortname, newShortname };
    }
  }

  /**
   * Emit a domain event when x_mitre_shortname changed so TechniquesService can
   * update kill_chain_phases.phase_name on all connected techniques.
   */
  async afterUpdate(updatedDocument) {
    if (this._shortnameChange) {
      const { oldShortname, newShortname } = this._shortnameChange;

      logger.info(
        `TacticsService: x_mitre_shortname changed '${oldShortname}' -> '${newShortname}', emitting event`,
        { tacticId: updatedDocument.stix.id },
      );

      await EventBus.emit(EventConstants.TACTIC_SHORTNAME_CHANGED, {
        tacticId: updatedDocument.stix.id,
        oldShortname,
        newShortname,
        domains: updatedDocument.stix.x_mitre_domains || [],
      });

      delete this._shortnameChange;
    }
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
