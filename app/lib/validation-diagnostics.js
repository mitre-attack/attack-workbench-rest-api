'use strict';

exports.marker = (data, snapshot, publicationToken, outcome) => ({
  policy_revision: snapshot.policy_revision,
  evaluation_generation: snapshot.evaluation_generation,
  engine_context: snapshot.engine_context,
  workflow_state: data.workspace?.workflow?.state || 'reviewed',
  schema_mode: data.workspace?.workflow?.state === 'work-in-progress' ? 'partial' : 'full',
  publication_token: publicationToken,
  outcome,
});
exports.diagnostics = (result, snapshot) =>
  result.errors.length
    ? {
        errors: result.errors.map(({ message, path, code }) => ({
          message,
          path: path.map(String),
          code,
        })),
        adm_version: snapshot.engine_context.adm_version,
        attack_spec_version: snapshot.engine_context.attack_spec_version,
        validated_at: new Date(),
      }
    : undefined;
