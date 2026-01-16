'use strict';

module.exports.forceImportParameters = {
  attackSpecVersionViolations: 'attack-spec-version-violations',
  duplicateCollection: 'duplicate-collection',
};

module.exports.errors = {
  duplicateCollection: 'Duplicate collection',
  notFound: 'Collection not found',
  attackSpecVersionViolation: 'ATT&CK Spec version violation',
};

module.exports.validationErrors = {
  duplicateObjectInBundle: 'Duplicate object in bundle',
  invalidAttackSpecVersion: 'Invalid ATT&CK Spec version',
};

module.exports.importErrors = {
  duplicateCollection: 'Duplicate collection object',
  retrievalError: 'Retrieval error',
  unknownObjectType: 'Unknown object type',
  notInContents: 'Not in contents', // object in bundle but not in x_mitre_contents
  missingObject: 'Missing object', // object in x_mitre_contents but not in bundle
  saveError: 'Save error',
  attackSpecVersionViolation: 'ATT&CK Spec version violation',
};

module.exports.defaultAttackSpecVersion = '2.0.0';

/**
 * Creates a unique key for a STIX object based on its ID and modified/created date
 * @param {string} stixId - The STIX object ID
 * @param {string} modified - The modified/created timestamp
 * @returns {string} A unique key combining the ID and timestamp
 */
module.exports.makeKey = function (stixId, modified) {
  return stixId + '/' + modified;
};

/**
 * Creates a unique key from a STIX object, handling special case for marking definitions
 * @param {Object} stixObject - The STIX object
 * @returns {string} A unique key for the object
 */
module.exports.makeKeyFromObject = function (stixObject) {
  if (stixObject.type === 'marking-definition') {
    return exports.makeKey(stixObject.id, stixObject.created);
  } else {
    return exports.makeKey(stixObject.id, stixObject.modified);
  }
};

/**
 * Convert the date to seconds past the epoch
 * @param {Date|string} date - Date to convert
 * @returns {number} Epoch time in milliseconds
 */
module.exports.toEpoch = function (date) {
  if (date instanceof Date) {
    return date.getTime();
  } else {
    return Date.parse(date);
  }
};
