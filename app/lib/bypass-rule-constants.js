'use strict';

/**
 * Central enumeration of auto-created bypass rule reasons.
 * Used to distinguish bypass rules created by different system events,
 * enabling targeted cleanup without affecting rules from other triggers.
 */
module.exports = Object.freeze({
  NAMESPACE: 'namespace',
  IDENTITY: 'identity',
});
