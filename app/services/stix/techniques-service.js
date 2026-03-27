'use strict';

const config = require('../../config/config');
const { BaseService } = require('../meta-classes');
const techniquesRepository = require('../../repository/techniques-repository');

const { Technique: TechniqueType } = require('../../lib/types');
const {
  BadlyFormattedParameterError,
  BadRequestError,
  MissingParameterError,
  NotFoundError,
} = require('../../exceptions');
const attackIdGenerator = require('../../lib/attack-id-generator');
const {
  buildAttackExternalReference,
  removeAttackExternalReferences,
} = require('../../lib/external-reference-builder');
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

  // ============================
  // Subtechnique Conversion
  // ============================

  /**
   * Convert a technique to a subtechnique.
   *
   * Generates a new subtechnique-format ATT&CK ID (e.g., T1234.001) under the
   * specified parent, updates x_mitre_is_subtechnique, rebuilds the ATT&CK
   * external reference, and persists the result as a new version.
   *
   * @param {string} stixId - STIX ID of the technique to convert
   * @param {Object} data - Request body
   * @param {string} data.parentTechniqueAttackId - Parent technique ATT&CK ID (e.g., T1234)
   * @param {Object} [options] - Options
   * @param {string} [options.userAccountId] - Authenticated user's account ID
   * @returns {Object} The newly created subtechnique version
   */
  async convertToSubtechnique(stixId, data, options = {}) {
    // Lazy-load to avoid circular dependency
    const relationshipsRepository = require('../../repository/relationships-repository');

    if (!stixId) {
      throw new MissingParameterError('stixId');
    }
    if (!data?.parentTechniqueAttackId) {
      throw new MissingParameterError('parentTechniqueAttackId');
    }
    if (!/^T\d{4}$/.test(data.parentTechniqueAttackId)) {
      throw new BadRequestError({
        details: `Invalid parent technique ATT&CK ID format: ${data.parentTechniqueAttackId}. Must be T####.`,
      });
    }

    const technique = await this.repository.retrieveLatestByStixId(stixId);
    if (!technique) {
      throw new NotFoundError({ details: `Technique with stixId ${stixId} not found` });
    }
    if (technique.stix.x_mitre_is_subtechnique === true) {
      throw new BadRequestError({
        details: `Technique ${stixId} is already a subtechnique`,
      });
    }
    if (technique.stix.revoked === true) {
      throw new BadRequestError({
        details: `Cannot convert a revoked technique`,
      });
    }

    // Check if this technique has child subtechniques (via subtechnique-of SROs).
    // Cross-service READ is permitted per architecture guidelines.
    // If children exist, block the conversion — the user must rehome them first.
    const childRelationships = await relationshipsRepository.retrieveAll({
      targetRef: stixId,
      relationshipType: 'subtechnique-of',
      versions: 'latest',
      includeRevoked: false,
      includeDeprecated: false,
    });
    if (childRelationships.length > 0) {
      throw new BadRequestError({
        details:
          `Technique ${stixId} has ${childRelationships.length} subtechnique(s). ` +
          `Rehome or remove the subtechnique-of relationships before converting this technique to a subtechnique.`,
      });
    }

    // Generate new subtechnique ATT&CK ID
    const newAttackId = await attackIdGenerator.generateAttackId(
      'attack-pattern',
      this.repository,
      true,
      data.parentTechniqueAttackId,
    );

    // Build new version
    const newVersion = technique.toObject ? technique.toObject() : { ...technique };
    delete newVersion._id;
    delete newVersion.__v;
    delete newVersion.__t;

    newVersion.stix.x_mitre_is_subtechnique = true;
    newVersion.stix.modified = new Date().toISOString();
    newVersion.workspace = newVersion.workspace || {};
    newVersion.workspace.attack_id = newAttackId;

    // Rebuild external references: replace ATT&CK ref with the new one
    const userRefs = removeAttackExternalReferences(newVersion.stix.external_references);
    const newAttackRef = buildAttackExternalReference(newAttackId, 'attack-pattern', {
      isSubtechnique: true,
    });
    newVersion.stix.external_references = newAttackRef ? [newAttackRef, ...userRefs] : userRefs;

    if (options.userAccountId) {
      newVersion.workspace.workflow = newVersion.workspace.workflow || {};
      newVersion.workspace.workflow.created_by_user_account = options.userAccountId;
    }

    const savedDocument = await this.repository.save(newVersion);

    logger.info(
      `Converted technique ${stixId} to subtechnique: ${technique.workspace?.attack_id} -> ${newAttackId}`,
    );

    // Emit domain event for cross-service coordination
    await EventBus.emit(EventConstants.TECHNIQUE_CONVERTED_TO_SUBTECHNIQUE, {
      stixId,
      document: savedDocument.toObject ? savedDocument.toObject() : savedDocument,
      previousAttackId: technique.workspace?.attack_id,
      newAttackId,
      parentTechniqueAttackId: data.parentTechniqueAttackId,
    });

    return savedDocument.toObject ? savedDocument.toObject() : savedDocument;
  }

  /**
   * Convert a subtechnique to a technique.
   *
   * Generates a new technique-format ATT&CK ID (e.g., T1235), updates
   * x_mitre_is_subtechnique, rebuilds the ATT&CK external reference, and
   * persists the result as a new version.
   *
   * @param {string} stixId - STIX ID of the subtechnique to convert
   * @param {Object} [options] - Options
   * @param {string} [options.userAccountId] - Authenticated user's account ID
   * @returns {Object} The newly created technique version
   */
  async convertToTechnique(stixId, options = {}) {
    if (!stixId) {
      throw new MissingParameterError('stixId');
    }

    const technique = await this.repository.retrieveLatestByStixId(stixId);
    if (!technique) {
      throw new NotFoundError({ details: `Technique with stixId ${stixId} not found` });
    }
    if (technique.stix.x_mitre_is_subtechnique !== true) {
      throw new BadRequestError({
        details: `Technique ${stixId} is not a subtechnique`,
      });
    }
    if (technique.stix.revoked === true) {
      throw new BadRequestError({
        details: `Cannot convert a revoked technique`,
      });
    }

    // Generate new technique ATT&CK ID
    const newAttackId = await attackIdGenerator.generateAttackId(
      'attack-pattern',
      this.repository,
      false,
    );

    // Build new version
    const newVersion = technique.toObject ? technique.toObject() : { ...technique };
    delete newVersion._id;
    delete newVersion.__v;
    delete newVersion.__t;

    newVersion.stix.x_mitre_is_subtechnique = false;
    newVersion.stix.modified = new Date().toISOString();
    newVersion.workspace = newVersion.workspace || {};
    newVersion.workspace.attack_id = newAttackId;

    // Rebuild external references: replace ATT&CK ref with the new one
    const userRefs = removeAttackExternalReferences(newVersion.stix.external_references);
    const newAttackRef = buildAttackExternalReference(newAttackId, 'attack-pattern', {
      isSubtechnique: false,
    });
    newVersion.stix.external_references = newAttackRef ? [newAttackRef, ...userRefs] : userRefs;

    if (options.userAccountId) {
      newVersion.workspace.workflow = newVersion.workspace.workflow || {};
      newVersion.workspace.workflow.created_by_user_account = options.userAccountId;
    }

    const savedDocument = await this.repository.save(newVersion);

    logger.info(
      `Converted subtechnique ${stixId} to technique: ${technique.workspace?.attack_id} -> ${newAttackId}`,
    );

    // Emit domain event — RelationshipsService listens to deprecate subtechnique-of SROs
    await EventBus.emit(EventConstants.SUBTECHNIQUE_CONVERTED_TO_TECHNIQUE, {
      stixId,
      document: savedDocument.toObject ? savedDocument.toObject() : savedDocument,
      previousAttackId: technique.workspace?.attack_id,
      newAttackId,
    });

    return savedDocument.toObject ? savedDocument.toObject() : savedDocument;
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
