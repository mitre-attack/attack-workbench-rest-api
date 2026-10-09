'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const policy = require('./validation-policy-service');
const repository = require('../../repository/validation-policy-repository');
const storage = require('../../lib/validation-operation-context');
const legacy = new AsyncLocalStorage();

// Only historical migrations may opt into absence of canonical storage.
exports.runLegacyMigration = (operation) => legacy.run(true, operation);
exports.current = () => storage.getStore();
exports.run = async function run(operation, { snapshot, collector } = {}) {
  if (storage.getStore()) return operation(storage.getStore());
  const explicitSnapshot = Boolean(snapshot);
  if (!snapshot) {
    if (legacy.getStore() && !(await repository.readPolicy())) {
      snapshot = {
        rules: await require('../../repository/validation-bypasses-repository').findAll(),
      };
    } else {
      snapshot = await policy.loadSnapshot();
    }
  }
  const publicationToken = snapshot.engine_context
    ? await repository.allocatePublicationToken(snapshot)
    : null;
  if (snapshot.engine_context && publicationToken === null) {
    if (explicitSnapshot) throw new Error('The supplied validation snapshot has been superseded');
    // An edit raced snapshot acquisition; no revision has been evaluated yet.
    return exports.run(operation, { collector });
  }
  return storage.run({ snapshot, publicationToken, collector }, () =>
    operation(storage.getStore()),
  );
};

// Task 3 can install a collector at the outer operation boundary. Each callback
// receives the exact input and immutable operation snapshot, including failures.
exports.collect = async (data, result, { phase = 'evaluation' } = {}) => {
  const context = storage.getStore();
  if (context?.collector)
    await context.collector({ data, result, snapshot: context.snapshot, phase });
};
exports.wrap = (fn) =>
  function (...args) {
    return exports.run(() => fn.apply(this, args));
  };
exports.wrapExports = (object) => {
  for (const [key, value] of Object.entries(object)) {
    if (typeof value === 'function' && value.constructor.name === 'AsyncFunction') {
      object[key] = exports.wrap(value);
    }
  }
};
