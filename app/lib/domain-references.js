'use strict';

const _ = require('lodash');
const { LifecycleConflictError } = require('../exceptions');
const excluded = new Set([
  'created_by_ref',
  'x_mitre_modified_by_ref',
  'object_marking_refs',
  'granular_markings',
  'marking_ref',
  'x_mitre_contents',
  'external_references',
]);
const isReference = (key) => /_refs?$/.test(key);

function references(stix) {
  if (!stix || stix.type === 'relationship' || stix.type === 'marking-definition') return [];
  const found = [];
  function visit(value, path = '', reference = false) {
    if (value?.toObject) value = value.toObject();
    if (typeof value === 'string') {
      if (reference && /^[a-z][a-z0-9-]*--[0-9a-f-]+$/i.test(value)) {
        found.push({ source_ref: stix.id, target_ref: value, path });
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`, reference));
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (!excluded.has(key)) visit(child, path ? `${path}.${key}` : key, isReference(key));
      }
    }
  }
  visit(stix);
  return found;
}

function addedReferences(stix, previous) {
  function signature(ref, object) {
    // Include the containing record's metadata (log-source name/channel),
    // ignoring only array position so reordering is not a new reference.
    const recordPath = ref.path.match(/^(.*\[\d+\])\./)?.[1];
    const record = recordPath ? _.get(object, recordPath) : null;
    return {
      path: ref.path.replace(/\[\d+\]/g, '[]'),
      target: ref.target_ref,
      record: record?.toObject ? record.toObject() : record,
    };
  }
  const retained = references(previous).map((ref) => signature(ref, previous));
  return references(stix).filter((ref) => {
    const candidate = signature(ref, stix);
    const index = retained.findIndex((existing) => _.isEqual(existing, candidate));
    if (index < 0) return true;
    retained.splice(index, 1);
    return false;
  });
}

function substitute(stix, from, to) {
  const result = _.cloneDeep(stix);
  for (const ref of references(stix)) {
    if (ref.target_ref === from) _.set(result, ref.path, to);
  }
  const arrays = new Set();
  for (const ref of references(result)) {
    for (const match of ref.path.matchAll(/\[\d+\]/g)) arrays.add(ref.path.slice(0, match.index));
  }
  for (const path of [...arrays].sort((a, b) => b.length - a.length)) {
    _.set(result, path, _.uniqWith(_.get(result, path), _.isEqual));
  }
  return result;
}

// Union only reference-bearing properties, preserving the whole containing
// array entry (notably analytic log-source name and channel).
function mergeOutgoing(target, source, from, to) {
  const incoming = substitute(source, from, to);
  const result = _.cloneDeep(target);
  const paths = references(incoming).map((ref) => ref.path);
  const carriesReference = (path) =>
    paths.some((p) => p === path || p.startsWith(`${path}.`) || p.startsWith(`${path}[`));
  function merge(existing, addition, path) {
    if (existing === undefined) return _.cloneDeep(addition);
    if (Array.isArray(addition) && Array.isArray(existing)) {
      const union = _.cloneDeep(existing);
      for (const item of addition) {
        if (!union.some((other) => _.isEqual(other, item))) union.push(_.cloneDeep(item));
      }
      return union;
    }
    if (_.isPlainObject(addition) && _.isPlainObject(existing)) {
      const merged = _.cloneDeep(existing);
      for (const [key, value] of Object.entries(addition)) {
        const childPath = `${path}.${key}`;
        if (carriesReference(childPath)) merged[key] = merge(merged[key], value, childPath);
      }
      return merged;
    }
    if (_.isEqual(existing, addition)) return existing;
    throw new LifecycleConflictError('Replacement has a conflicting embedded reference', {
      code: 'embedded_reference_conflict',
      path,
      source_ref: from,
      target_ref: to,
    });
  }
  for (const [key, value] of Object.entries(incoming)) {
    if (carriesReference(key)) result[key] = merge(result[key], value, key);
  }
  return result;
}

module.exports = { references, addedReferences, substitute, mergeOutgoing };
