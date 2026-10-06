'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const { v4: uuid } = require('uuid');
const repository = require('../repository/graph-write-lock-repository');
const { LifecycleConflictError } = require('../exceptions');
const context = new AsyncLocalStorage();
let pending = Promise.resolve();

exports.isHeld = () => context.getStore()?.active === true;

exports.run = async function run(operation) {
  if (exports.isHeld()) return operation();

  // Queue this process's writes; Mongo's unique _id excludes other workers.
  const previous = pending;
  let releaseQueue;
  pending = new Promise((resolve) => {
    releaseQueue = resolve;
  });
  await previous;
  const owner = { token: uuid(), active: true };
  let acquired = false;
  try {
    try {
      await repository.acquire(owner.token);
      acquired = true;
    } catch (error) {
      if (error.code !== 11000) throw error;
      throw new LifecycleConflictError('Another STIX graph write is in progress', {
        code: 'graph_write_conflict',
      });
    }
    return await context.run(owner, operation);
  } finally {
    owner.active = false;
    try {
      if (acquired) await repository.release(owner.token);
    } finally {
      releaseQueue();
    }
  }
};
