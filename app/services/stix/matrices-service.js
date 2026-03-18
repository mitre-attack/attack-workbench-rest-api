'use strict';

const { BaseService } = require('../meta-classes');
const matrixRepository = require('../../repository/matrix-repository');
const { Matrix: MatrixType } = require('../../lib/types');
const tacticsService = require('./tactics-service');
const logger = require('../../lib/logger');
const { TacticsServiceError, MissingParameterError } = require('../../exceptions');

class MatrixService extends BaseService {
  constructor(type, repository) {
    super(type, repository);
  }

  // Custom methods specific to MatrixService should be specified below

  async retrieveTechniquesForMatrix(stixId, modified) {
    if (!stixId) {
      throw new MissingParameterError('stixId');
    }

    if (!modified) {
      throw new MissingParameterError('modified');
    }

    const matrix = await matrixRepository.retrieveOneByVersion(stixId, modified);
    if (!matrix) {
      return null;
    }

    const options = { versions: 'latest', offset: 0, limit: 0 };
    const tacticsTechniques = {};

    for (const tacticId of matrix.stix.tactic_refs) {
      let tactics, techniques;
      try {
        tactics = await tacticsService.retrieveById(tacticId, options);
        if (tactics && tactics.length) {
          techniques = await tacticsService.retrieveTechniquesForTactic(
            tacticId,
            tactics[0].stix.modified,
            options,
          );
        }
      } catch (err) {
        logger.error(err);
        throw new TacticsServiceError(err);
      }

      if (tactics && tactics.length) {
        const tactic = tactics[0];
        const parentTechniques = [];
        const subtechniques = [];

        for (const technique of techniques) {
          if (!technique.stix.x_mitre_is_subtechnique) {
            parentTechniques.push(technique);
          } else {
            subtechniques.push(technique);
          }
        }

        for (const parentTechnique of parentTechniques) {
          parentTechnique.subtechniques = [];
          for (const subtechnique of subtechniques) {
            if (
              subtechnique.workspace.attack_id?.split('.')[0] ===
              parentTechnique.workspace.attack_id
            ) {
              parentTechnique.subtechniques.push(subtechnique);
            }
          }
        }
        tactic.techniques = parentTechniques;
        tacticsTechniques[tactic.stix.name] = tactic;
      }
    }
    return tacticsTechniques;
  }
}

module.exports = new MatrixService(MatrixType, matrixRepository);
