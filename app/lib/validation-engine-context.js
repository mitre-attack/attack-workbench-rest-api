'use strict';

const { version: adm_version } = require('@mitre-attack/attack-data-model/package.json');
const { attackSpecVersion: attack_spec_version } = require('../../package.json');
// Bump for changes to schema selection, exemption semantics, or issue matching.
const context = Object.freeze({ adm_version, attack_spec_version, evaluator_version: '1' });
const readEngineContext = () => ({ ...context });
const sameEngineContext = (a, b) =>
  Boolean(a && b && Object.keys(context).every((key) => a[key] === b[key]));
function assertEngineContext(active) {
  if (!sameEngineContext(active, context)) {
    throw new Error(
      'Validation engine does not match the active policy. Stop older workers and explicitly initialize the current engine before serving validation.',
    );
  }
}
module.exports = { readEngineContext, sameEngineContext, assertEngineContext };
