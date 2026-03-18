'use strict';

const {
  stixTypeToAttackIdMapping,
  attackIdExamples,
  createAttackIdSchema,
} = require('@mitre-attack/attack-data-model');
const { InvalidTypeError, DuplicateIdError } = require('../exceptions');
const logger = require('./logger');
const config = require('../config/config');

/**
 * Determines if a given ATT&CK object type requires an ATT&CK ID.
 * @param {string} objectType - The ATT&CK object type to check
 * @returns {boolean} True if the object type requires an ATT&CK ID
 */
function requiresAttackId(objectType) {
  return objectType in stixTypeToAttackIdMapping;
}
exports.requiresAttackId = requiresAttackId;

/**
 * Get the type prefix for an ATT&CK ID type
 * @param {string} attackIdType - The ATT&CK ID type (e.g., 'technique', 'tactic')
 * @returns {string} The type prefix (e.g., 'T', 'TA', 'G')
 * @private
 */
function getTypePrefix(attackIdType) {
  // Extract the prefix from the example format (e.g., "T####" -> "T")
  const example = attackIdExamples[attackIdType];
  return example.split('#')[0];
}

/**
 * Extract ATT&CK ID from STIX external_references (if present)
 * @param {object} stix - The STIX object
 * @returns {string|null} The external ATT&CK ID or null if not found
 */
function extractAttackIdFromExternalReferences(stix) {
  if (!stix.external_references || stix.external_references.length === 0) {
    return null;
  }

  const attackRef = stix.external_references.find(
    (ref) =>
      ref.source_name && config.attackSourceNames.includes(ref.source_name) && ref.external_id,
  );

  return attackRef ? attackRef.external_id : null;
}
exports.extractAttackIdFromExternalReferences = extractAttackIdFromExternalReferences;

/**
 * Check if an ATT&CK ID is available (not already in use)
 * @param {string} attackId - The ATT&CK ID to check
 * @param {object} repository - The repository for querying existing objects
 * @returns {Promise<boolean>} True if the ID is available, false if already in use
 */
async function isAttackIdAvailable(attackId, repository) {
  const allObjects = await repository.retrieveAll({});
  return !allObjects.some((obj) => obj.workspace?.attack_id === attackId);
}
exports.isAttackIdAvailable = isAttackIdAvailable;

/**
 * Validate that an ATT&CK ID matches the expected format for a STIX type
 * @param {string} attackId - The ATT&CK ID to validate
 * @param {string} stixType - The STIX type
 * @returns {boolean} True if valid, false otherwise
 */
function validateAttackIdFormat(attackId, stixType) {
  const schema = createAttackIdSchema(stixType);
  const result = schema.safeParse(attackId);
  return result.success;
}
exports.validateAttackIdFormat = validateAttackIdFormat;

/**
 * Validate an ATT&CK ID provided by the client
 * @param {string} attackId - The ATT&CK ID to validate
 * @param {string} stixType - The STIX type
 * @param {object} repository - The repository for querying existing objects
 * @returns {Promise<string>} The validated ATT&CK ID
 * @throws {Error} If the ID is invalid or already in use
 * @private
 */
async function validateAttackId(attackId, stixType, repository) {
  // Validate format
  if (!validateAttackIdFormat(attackId, stixType)) {
    throw new Error(`Invalid ATT&CK ID format: ${attackId} for STIX type ${stixType}`);
  }

  // Check availability
  const available = await isAttackIdAvailable(attackId, repository);
  if (!available) {
    throw new DuplicateIdError(`ATT&CK ID ${attackId} is already in use`);
  }

  logger.debug(`Validated client-provided ATT&CK ID: ${attackId}`);
  return attackId;
}

/**
 * Generate a new ATT&CK ID for an object
 *
 * This function generates unique ATT&CK IDs by finding the highest existing ID
 * in the workspace.attack_id field for the given type and incrementing it.
 *
 * @param {string} stixType - The STIX type of the object (e.g., 'attack-pattern', 'intrusion-set', 'x-mitre-tactic')
 * @param {object} repository - The repository for querying existing objects of this type
 * @param {boolean} isSubtechnique - Whether to generate a subtechnique ID (only valid for attack-pattern)
 * @param {string} parentTechniqueAttackId - Parent technique ATT&CK ID (required if isSubtechnique is true)
 * @returns {Promise<string>} The generated ATT&CK ID
 *
 * @example
 * const tacticId = await generateAttackId('x-mitre-tactic', tacticsRepository, false);
 * // Returns: "TA0042"
 *
 * @example
 * const techniqueId = await generateAttackId('attack-pattern', techniquesRepository, false);
 * // Returns: "T1234"
 *
 * @example
 * const subtechniqueId = await generateAttackId('attack-pattern', techniquesRepository, true, 'T1234');
 * // Returns: "T1234.001"
 */
async function generateAttackId(
  stixType,
  repository,
  isSubtechnique = false,
  parentTechniqueAttackId = null,
) {
  // Validate that the STIX type supports ATT&CK IDs
  if (!(stixType in stixTypeToAttackIdMapping)) {
    throw new InvalidTypeError(`STIX type '${stixType}' does not support ATT&CK ID generation`);
  }

  // Handle subtechnique generation
  if (isSubtechnique) {
    if (stixType !== 'attack-pattern') {
      throw new Error('Subtechniques are only valid for attack-pattern STIX type');
    }
    if (!parentTechniqueAttackId) {
      throw new Error('Parent technique ATT&CK ID is required for subtechnique generation');
    }

    // Validate parent ID format (must be T####)
    if (!/^T\d{4}$/.test(parentTechniqueAttackId)) {
      throw new Error(
        `Invalid parent technique ATT&CK ID format: ${parentTechniqueAttackId}. Must be T####`,
      );
    }

    logger.debug(`Generating subtechnique ID for parent: ${parentTechniqueAttackId}`);

    // Get all existing techniques
    const results = await repository.retrieveAll({
      includeRevoked: true,
      includeDeprecated: true,
    });
    const allTechniques = results[0]?.documents || [];

    // Find all subtechniques for this parent
    const existingSubtechniqueNumbers = allTechniques
      .filter((tech) => {
        if (!tech.stix.x_mitre_is_subtechnique) return false;

        const attackId = tech.workspace?.attack_id;
        if (!attackId) return false;

        // Check if this subtechnique belongs to our parent
        return attackId.startsWith(`${parentTechniqueAttackId}.`);
      })
      .map((tech) => {
        const attackId = tech.workspace.attack_id;
        // Extract the 3-digit subtechnique number (e.g., "001" from "T1234.001")
        const match = attackId.match(/\.(\d{3})$/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter((num) => num > 0);

    logger.debug(
      `Found ${existingSubtechniqueNumbers.length} existing subtechniques for ${parentTechniqueAttackId}`,
    );

    // Get next available subtechnique number
    const nextNum =
      existingSubtechniqueNumbers.length > 0 ? Math.max(...existingSubtechniqueNumbers) + 1 : 1;

    // Construct new subtechnique ID (e.g., "T1234.001")
    const generatedId = `${parentTechniqueAttackId}.${nextNum.toString().padStart(3, '0')}`;

    logger.debug(`Generated subtechnique ID: ${generatedId}`);

    return generatedId;
  }

  // Regular (non-subtechnique) ID generation
  const attackIdType = stixTypeToAttackIdMapping[stixType];
  const typePrefix = getTypePrefix(attackIdType);

  logger.debug(`Generating ATT&CK ID for STIX type: ${stixType}, prefix: ${typePrefix}`);

  // Get all existing objects of this type
  // Repository returns: [{ totalCount: [...], documents: [...] }]
  const results = await repository.retrieveAll({});
  const allObjects = results[0]?.documents || [];

  logger.debug(`Retrieved ${allObjects.length} objects from repository`);

  // Extract numeric IDs from workspace.attack_id that match our type prefix
  const existingIds = allObjects
    .map((obj) => {
      const attackId = obj.workspace?.attack_id;
      if (!attackId || !attackId.startsWith(typePrefix)) {
        return null;
      }

      // Remove prefix and any decimal parts (for subtechniques)
      const idWithoutPrefix = attackId.replace(typePrefix, '').replace(/\.(\d{3})$/, '');

      const numericPart = parseInt(idWithoutPrefix, 10);
      return isNaN(numericPart) ? null : numericPart;
    })
    .filter((id) => id !== null);

  logger.debug(`Found ${existingIds.length} existing IDs with prefix ${typePrefix}`);

  // Calculate next available ID (start at 1 if none exist)
  const nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;

  // Construct new ID with proper padding (e.g., "G0042", "TA0001", "T1234")
  const generatedId = `${typePrefix}${nextId.toString().padStart(4, '0')}`;

  logger.debug(`Generated ATT&CK ID: ${generatedId}`);

  return generatedId;
}
exports.generateAttackId = generateAttackId;

/**
 * Check if ATT&CK ID is present in workspace/STIX object and validate it
 *
 * @param {object} data - The object data with workspace and stix properties
 * @param {string} stixType - The STIX type of the object
 * @param {object} repository - The repository for querying existing objects
 * @returns {Promise<boolean>} True if ID is present and valid, false if not present
 * @throws {Error} If ID is present but invalid or if workspace.attack_id conflicts with external_id
 *
 * @example
 * // No ID present - returns false
 * const hasId = await attackIdInWorkspaceStixObject({ stix: {}, workspace: {} }, 'x-mitre-tactic', repository);
 * // Returns: false
 *
 * @example
 * // Valid ID present - returns true
 * const hasId = await attackIdInWorkspaceStixObject(
 *   { stix: {}, workspace: { attack_id: 'TA9999' } },
 *   'x-mitre-tactic',
 *   repository
 * );
 * // Returns: true (if TA9999 is valid and available)
 *
 * @example
 * // Invalid ID present - throws error
 * const hasId = await attackIdInWorkspaceStixObject(
 *   { stix: {}, workspace: { attack_id: 'INVALID' } },
 *   'x-mitre-tactic',
 *   repository
 * );
 * // Throws: Error (invalid format)
 */
async function hasValidAttackId(data, stixType, repository) {
  const workspaceAttackId = data.workspace?.attack_id;
  const externalId = extractAttackIdFromExternalReferences(data.stix);

  // No ATT&CK ID present in workspace
  if (!workspaceAttackId) {
    return false;
  }

  // ATT&CK ID present - validate it
  // First check if both workspace and external IDs are present
  if (externalId && workspaceAttackId !== externalId) {
    throw new Error(
      `Conflicting ATT&CK IDs: workspace.attack_id (${workspaceAttackId}) does not match external_references[0].external_id (${externalId})`,
    );
  }

  // Validate format and availability
  await validateAttackId(workspaceAttackId, stixType, repository);

  return true;
}
exports.hasValidAttackId = hasValidAttackId;
