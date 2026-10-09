'use strict';

const repository = require('../../repository/validation-policy-repository');
const { readEngineContext, assertEngineContext } = require('../../lib/validation-engine-context');
const { evaluateObject } = require('../../lib/adm-validation');

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

async function loadSnapshot() {
  const policy = await repository.readPolicy();
  if (!policy)
    throw new Error(
      'Validation policy has not been initialized. Run the final database migration or explicit initialization.',
    );
  assertEngineContext(policy.engine_context);
  // JSON conversion isolates nested objects and represents ObjectIds as immutable strings.
  return deepFreeze(
    JSON.parse(
      JSON.stringify({
        rules: policy.rules,
        policy_revision: policy.policy_revision,
        evaluation_generation: policy.evaluation_generation,
        engine_context: policy.engine_context,
      }),
    ),
  );
}

module.exports = {
  initialize: repository.initialize,
  loadSnapshot,
  readEngineContext,
  evaluateObject,
};
