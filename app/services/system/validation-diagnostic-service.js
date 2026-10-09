'use strict';

const { isDeepStrictEqual } = require('util');

const { marker, diagnostics } = require('../../lib/validation-diagnostics');
exports.marker = marker;
exports.diagnostics = diagnostics;

exports.stamp = (data, result, snapshot, publicationToken) => {
  if (!snapshot.engine_context) return;
  data.workspace = data.workspace || {};
  data.workspace.evaluation_context = exports.marker(
    data,
    snapshot,
    publicationToken,
    result.outcome,
  );
  delete data.workspace.validation;
  const diagnostics = exports.diagnostics(result, snapshot);
  if (diagnostics) data.workspace.validation = diagnostics;
};

exports.isCurrent = (data, snapshot) => {
  const marker = data.workspace?.evaluation_context;
  return (
    marker?.policy_revision === snapshot.policy_revision &&
    marker?.evaluation_generation === snapshot.evaluation_generation &&
    isDeepStrictEqual(marker?.engine_context, snapshot.engine_context) &&
    marker.workflow_state === (data.workspace?.workflow?.state || 'reviewed')
  );
};

// Publication delegates the persistence guards to the repository.
exports.publish = (options) =>
  require('../../repository/validation-diagnostics-repository').publish(options);

exports.project = (data, snapshot) => {
  if (data?.workspace) delete data.workspace.evaluation_needed;
  if (!data?.stix || !data.workspace || exports.isCurrent(data, snapshot)) return data;
  // Stale diagnostics are never represented as current. Reconciliation persists
  // the replacement; read projection leaves historical import reports untouched.
  delete data.workspace.validation;
  delete data.workspace.evaluation_context;
  return data;
};
