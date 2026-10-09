'use strict';

const crypto = require('crypto');
const config = require('../config/config');
const repository = require('../repository/validation-reports-repository');
const { BadRequestError } = require('../exceptions');
const TTL = 24 * 60 * 60 * 1000;
let reportKey, keyDatabase, loadingKey;
const key = () => reportKey;
async function initializeKey() {
  const database = require('mongoose').connection.db;
  if (keyDatabase !== database) {
    keyDatabase = database;
    reportKey = undefined;
    loadingKey = undefined;
  }
  if (!reportKey) {
    if (!loadingKey)
      loadingKey = repository.loadKey().catch((err) => {
        loadingKey = undefined;
        throw err;
      });
    reportKey = await loadingKey;
  }
}
const bad = (message) => {
  throw new BadRequestError({ message });
};

exports.principal = (user) => {
  if (!user) return null;
  if (user.service) {
    if (user.serviceName && ['basic', 'bearer'].includes(user.strategy))
      return {
        kind: 'service',
        serviceName: user.serviceName,
        realm: user.strategy === 'basic' ? 'basic-apikey' : 'challenge-apikey',
      };
    if (user.clientId && user.strategy === 'bearer')
      return {
        kind: 'service',
        clientId: user.clientId,
        realm: `oidc-client:${config.serviceAuthn.oidcClientCredentials.jwksUri}`,
      };
    return null;
  }
  return user.userAccountId
    ? {
        kind: 'human',
        userAccountId: String(user.userAccountId),
        realm:
          user.strategy === 'oidc'
            ? `oidc:${config.userAuthn.oidc.issuerUrl}`
            : String(user.strategy),
      }
    : null;
};

function list(value, name, normalize = (v) => v) {
  if (value === undefined) return [];
  const items = (Array.isArray(value) ? value : [value]).flatMap((v) => {
    if (typeof v !== 'string') bad(`${name} must be a comma-separated list.`);
    return v.split(',').map((item) => item.trim());
  });
  if (!items.length || items.some((item) => !item)) bad(`${name} must contain nonempty choices.`);
  return [...new Set(items.map(normalize))].sort();
}
exports.options = (query, snapshot, { retained = false } = {}) => {
  const mode = retained ? 'details' : query.exemptionReport;
  if (!retained && mode === undefined) {
    if (
      ['exemptionStatuses', 'exemptionRuleIds', 'exemptionLimit', 'exemptionCursor'].some(
        (k) => query[k] !== undefined,
      )
    )
      bad('Request exemptionReport=summary or details before selecting report filters.');
    return null;
  }
  if (!['summary', 'details'].includes(mode)) bad('exemptionReport must be summary or details.');
  if (!retained && query.exemptionCursor !== undefined)
    bad('Use exemptionCursor only when retrieving a retained report.');
  const statuses = list(query.exemptionStatuses, 'exemptionStatuses');
  if (statuses.some((s) => !['revoked', 'deprecated'].includes(s)))
    bad('exemptionStatuses accepts only revoked and deprecated.');
  const ruleIds = list(query.exemptionRuleIds, 'exemptionRuleIds', (v) => v.toLowerCase());
  const known = new Set(
    snapshot.rules.filter((r) => r.kind === 'object-exemption').map((r) => String(r._id)),
  );
  if (ruleIds.some((id) => !/^[a-f0-9]{24}$/.test(id) || !known.has(id)))
    bad('exemptionRuleIds must identify object exemption rules in this operation policy snapshot.');
  const rawLimit = query.exemptionLimit ?? 50;
  if (
    !/^\d+$/.test(String(rawLimit)) ||
    Array.isArray(rawLimit) ||
    Number(rawLimit) < 1 ||
    Number(rawLimit) > 100
  )
    bad('exemptionLimit must be a positive integer from 1 to 100.');
  return { mode, statuses, ruleIds, limit: Number(rawLimit), cursor: query.exemptionCursor };
};

// Encrypted authenticated IDs retain the access/expiry claims after Mongo TTL deletion.
// The separate durable key survives API restarts and is never sent to callers.
function seal(claims) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), nonce);
  const content = Buffer.concat([cipher.update(JSON.stringify(claims)), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), content]).toString('base64url');
}
exports.claims = async (reportId) => {
  await initializeKey();
  try {
    if (
      typeof reportId !== 'string' ||
      reportId.length > 4096 ||
      !/^[A-Za-z0-9_-]+$/.test(reportId)
    )
      throw new Error();
    const data = Buffer.from(reportId, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString(),
    );
  } catch {
    return null;
  }
};
const filterKey = (options) => JSON.stringify([options.statuses, options.ruleIds]);
function cursor(reportId, options, offset) {
  const body = Buffer.from(
    JSON.stringify({ reportId, filters: filterKey(options), offset }),
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', key()).update(body).digest('base64url');
  return `${body}.${signature}`;
}
function offsetFor(reportId, options) {
  if (options.cursor === undefined) return 0;
  try {
    if (typeof options.cursor !== 'string' || options.cursor.length > 8192) throw new Error();
    const [body, signature, extra] = options.cursor.split('.');
    const expected = crypto.createHmac('sha256', key()).update(body).digest('base64url');
    if (
      extra ||
      !signature ||
      signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      throw new Error();
    const value = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (
      value.reportId !== reportId ||
      value.filters !== filterKey(options) ||
      !Number.isSafeInteger(value.offset) ||
      value.offset < 0
    )
      throw new Error();
    return value.offset;
  } catch {
    bad('exemptionCursor is invalid or belongs to a different report or filter selection.');
  }
}
function summary(rows) {
  const revisions = new Set(),
    rules = new Map(),
    byStatus = { revoked: 0, deprecated: 0 };
  for (const row of rows) {
    revisions.add(JSON.stringify([row.object_ref, row.object_modified]));
    byStatus[row.retirementStatus]++;
    const rule = rules.get(row.ruleId) || {
      ruleId: row.ruleId,
      ruleName: row.ruleName,
      retirementStatus: row.retirementStatus,
      count: 0,
    };
    rule.count++;
    rules.set(row.ruleId, rule);
  }
  return {
    reportedExemptRevisions: revisions.size,
    ruleApplications: rows.length,
    byRule: [...rules.values()].sort((a, b) => a.ruleId.localeCompare(b.ruleId)),
    byStatus,
  };
}
const matches = (row, options) =>
  (!options.statuses.length || options.statuses.includes(row.retirementStatus)) &&
  (!options.ruleIds.length || options.ruleIds.includes(row.ruleId));
const pageFields = (reportId, options, offset, count) => {
  const hasMore = offset + options.limit < count;
  return {
    hasMore,
    truncated: hasMore,
    nextCursor: hasMore && reportId ? cursor(reportId, options, offset + options.limit) : null,
  };
};
exports.createCollector = (snapshot, options) => {
  const revisions = new Map(),
    applications = new Map();
  return {
    collect({ data, result, phase }) {
      const object_ref = String(data.stix.id);
      // ADM can reject malformed timestamps; reporting must preserve that result.
      const modified = data.stix.modified;
      const date =
        typeof modified === 'string' || modified instanceof Date ? new Date(modified) : null;
      const object_modified = date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
      const revision = JSON.stringify([object_ref, object_modified]);
      const previous = revisions.get(revision);
      if (!previous || phase === 'evaluation')
        revisions.set(revision, { outcome: result.outcome, phase });
      for (const match of result.matchingExemptions) {
        const row = {
          object_ref,
          object_modified,
          ruleId: String(match.id),
          ruleName: String(match.name),
          retirementStatus: match.retirementStatus,
          phase,
        };
        const id = JSON.stringify([object_ref, object_modified, row.ruleId]);
        if (!applications.has(id) || phase === 'evaluation') applications.set(id, row);
      }
    },
    async finish(req, succeeded, { retain = false } = {}) {
      const evaluatedScope = {
        revisions: revisions.size,
        byOutcome: {},
        preflightOnlyRevisions: 0,
      };
      for (const visit of revisions.values()) {
        evaluatedScope.byOutcome[visit.outcome] =
          (evaluatedScope.byOutcome[visit.outcome] || 0) + 1;
        if (visit.phase === 'preflight') evaluatedScope.preflightOnlyRevisions++;
      }
      const rows = [...applications.values()],
        selected = rows.filter((row) => matches(row, options));
      const response = {
        policyRevision: snapshot.policy_revision,
        state: succeeded ? 'completed' : 'partial',
        evaluatedScope,
        filters: { statuses: options.statuses, ruleIds: options.ruleIds },
        ...summary(selected),
      };
      if (options.mode === 'summary' && !retain) return response;
      const owner = exports.principal(req.user);
      const expiresAt = new Date(Date.now() + TTL);
      const report = {
        _id: crypto.randomUUID(),
        owner,
        authorization: req.validationReportAuthorization,
        operation: { method: req.method, path: req.route?.path || req.path },
        snapshot: {
          policy_revision: snapshot.policy_revision,
          rules: snapshot.rules.filter((r) => r.kind === 'object-exemption'),
        },
        state: response.state,
        evaluatedScope,
        expiresAt,
      };
      let reportId = null;
      try {
        if (!owner || !report.authorization)
          throw new Error('Missing authenticated report principal');
        await initializeKey();
        await repository.save(report, rows);
        reportId = seal({
          id: report._id,
          owner,
          authorization: report.authorization,
          expiresAt: expiresAt.getTime(),
        });
        response.availability = 'retained';
      } catch {
        response.availability = 'unavailable';
        response.availabilityMessage =
          'The operation result is preserved, but its exemption report could not be retained.';
      }
      return {
        ...response,
        reportId,
        expiresAt: reportId ? expiresAt.toISOString() : null,
        details: selected.slice(0, options.limit),
        ...pageFields(reportId, options, 0, selected.length),
      };
    },
  };
};
exports.retrieve = async (reportId, query, claims) => {
  if (claims.expiresAt <= Date.now())
    return { status: 410, body: { message: 'This validation report expired after 24 hours.' } };
  const report = await repository.retrieve(claims.id);
  if (!report || report.state === 'building')
    return { status: 404, body: { message: 'Validation report is unavailable.' } };
  if (new Date(report.expiresAt).getTime() <= Date.now())
    return { status: 410, body: { message: 'This validation report expired after 24 hours.' } };
  const options = exports.options(query, report.snapshot, { retained: true });
  const offset = offsetFor(reportId, options);
  const [counts, reportedExemptRevisions, details] = await Promise.all([
    repository.summary(claims.id, options),
    repository.revisionCount(claims.id, options),
    repository.page(claims.id, options, offset, options.limit),
  ]);
  const byRule = counts
    .map((row) => ({ ...row._id, count: row.count }))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  const ruleApplications = counts.reduce((count, row) => count + row.count, 0);
  const byStatus = { revoked: 0, deprecated: 0 };
  for (const row of counts) byStatus[row._id.retirementStatus] += row.count;
  if (offset > ruleApplications) bad('exemptionCursor points beyond the report selection.');
  return {
    status: 200,
    body: {
      reportId,
      availability: 'retained',
      policyRevision: report.snapshot.policy_revision,
      state: report.state,
      evaluatedScope: report.evaluatedScope,
      expiresAt: report.expiresAt.toISOString(),
      filters: { statuses: options.statuses, ruleIds: options.ruleIds },
      reportedExemptRevisions,
      ruleApplications,
      byRule,
      byStatus,
      details,
      ...pageFields(reportId, options, offset, ruleApplications),
    },
  };
};
