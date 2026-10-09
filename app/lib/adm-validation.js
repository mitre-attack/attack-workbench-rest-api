'use strict';

const { getSchema } = require('./validation-schemas');
const { ValidationError } = require('../exceptions');

function serializeDates(value) {
  if (value && typeof value.toObject === 'function') return serializeDates(value.toObject());
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeDates);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeDates(item)]),
    );
  }
  return value;
}

function matchErrorBypass(error, stixType, rules) {
  const path = JSON.stringify(error.path.map(String));
  return rules.find(
    (rule) =>
      rule.kind !== 'object-exemption' &&
      (rule.suppressError || rule.warningMessage) &&
      (rule.stixType === 'all' || rule.stixType === stixType) &&
      rule.errorCode === error.code &&
      JSON.stringify(rule.fieldPath.map(String)) === path,
  );
}

/** Pure evaluation of one composed {stix, workspace} revision using one snapshot. */
function evaluateObject(data, snapshot, { enabled = true } = {}) {
  const result = { outcome: 'valid', errors: [], warnings: [], matchingExemptions: [] };
  if (!enabled) return { ...result, outcome: 'disabled' };
  const stix = data.stix || {};
  const rules = snapshot.rules;
  const matchingExemptions = rules
    .filter(
      (rule) =>
        rule.kind === 'object-exemption' &&
        rule.enabled === true &&
        (rule.retirementStatus === 'revoked'
          ? stix.revoked === true
          : stix.x_mitre_deprecated === true) &&
        (rule.stixTypes === 'all' || rule.stixTypes.includes(stix.type)),
    )
    .map((rule) => ({
      id: String(rule._id),
      name: rule.name,
      retirementStatus: rule.retirementStatus,
    }));
  if (matchingExemptions.length) return { ...result, outcome: 'exempt', matchingExemptions };
  const schema = getSchema(stix.type, data.workspace?.workflow?.state || 'reviewed');
  if (!schema) return { ...result, outcome: 'unsupported' };
  const parsed = schema.safeParse(serializeDates(stix));
  if (parsed.success) return result;
  for (const issue of parsed.error.issues) {
    const error = {
      message: `${issue.path.join('.')} is ${issue.message}`,
      path: issue.path,
      code: issue.code,
      input: issue.input,
    };
    const rule = matchErrorBypass(error, stix.type, rules);
    if (!rule) result.errors.push(error);
    else if (rule.warningMessage)
      result.warnings.push({ message: rule.warningMessage, path: error.path, code: error.code });
  }
  if (result.errors.length) result.outcome = 'invalid';
  return result;
}

/** Reject an ADM result while preserving the existing error and warning response. */
function assertNoAdmErrors({ errors, warnings }) {
  if (errors.length)
    throw new ValidationError('ADM validation failed', { details: errors, warnings });
}

module.exports = { evaluateObject, matchErrorBypass, serializeDates, assertNoAdmErrors };
