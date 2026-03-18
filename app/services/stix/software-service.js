'use strict';

const { PropertyNotAllowedError } = require('../../exceptions');

const { BaseService } = require('../meta-classes');
const softwareRepository = require('../../repository/software-repository');

const { Malware: MalwareType, Tool: ToolType } = require('../../lib/types');

class SoftwareService extends BaseService {
  /**
   * Set domain-specific defaults before creating a software object.
   * - For malware: `is_family` defaults to true
   * - For tools: `is_family` is not allowed
   *
   * @param {Object} data - The software object data
   * @param {Object} _options - Creation options (unused)
   */
  // eslint-disable-next-line no-unused-vars
  async beforeCreate(data, _options) {
    // Set is_family default for malware
    if (data.stix && data.stix.type === MalwareType && typeof data.stix.is_family !== 'boolean') {
      data.stix.is_family = true;
    }
    // Validate that is_family is not set for tools
    else if (data.stix && data.stix.type === ToolType && data.stix.is_family !== undefined) {
      throw new PropertyNotAllowedError('is_family is not allowed for tool objects');
    }
  }

  /**
   * Override create to handle type validation for multiple types (malware and tool).
   * SoftwareService handles both 'malware' and 'tool' types, so we need custom validation.
   * We temporarily set this.type to match the incoming data type so BaseService validation passes.
   */
  async create(data, options) {
    // Validate that the type is either malware or tool
    if (data?.stix?.type !== MalwareType && data?.stix?.type !== ToolType) {
      const { InvalidTypeError } = require('../../exceptions');
      throw new InvalidTypeError();
    }

    // Temporarily set this.type to the incoming type for BaseService validation
    const originalType = this.type;
    this.type = data.stix.type;

    try {
      // Call parent create which will trigger beforeCreate hook
      return await super.create(data, options);
    } finally {
      // Restore original type
      this.type = originalType;
    }
  }
}

module.exports = new SoftwareService(null, softwareRepository);
