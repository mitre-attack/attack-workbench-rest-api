'use strict';

const service = require('../services/validation-reports-service');
const { BadRequestError } = require('../exceptions');
const namespaces = new Set([
  'techniques',
  'tactics',
  'groups',
  'campaigns',
  'software',
  'mitigations',
  'matrices',
  'identities',
  'marking-definitions',
  'data-sources',
  'data-components',
  'assets',
  'analytics',
  'detection-strategies',
  'relationships',
  'notes',
  'collections',
  'collection-bundles',
  'release-tracks',
]);
exports.prepare = (req, snapshot) => {
  const path = `${req.baseUrl}${req.path}`;
  if (path.startsWith('/api/validation-reports/')) return null;
  const options = service.options(req.query, snapshot);
  if (!options) return null;
  const namespace = path.split('/')[2];
  const supported =
    (['POST', 'PUT'].includes(req.method) && namespaces.has(namespace)) ||
    (req.method === 'POST' && /^\/api\/config\/organization-(identity|namespace)$/.test(path)) ||
    (req.method === 'GET' && /^\/api\/release-tracks\/.+\/release\/preview$/.test(path));
  if (!supported)
    throw new BadRequestError({
      message:
        'Exemption reports are available on object writes, imports and release validation operations.',
    });
  return service.createCollector(snapshot, options);
};
exports.install = (req, res, collector) => {
  let finishing,
    sending = false;
  res.exemptionReport = (succeeded) => {
    if (!finishing)
      finishing = collector.finish(req, succeeded, { retain: res.statusCode === 204 });
    return finishing;
  };
  const json = res.json,
    send = res.send;
  function deliver(body, method) {
    if (
      sending ||
      !req.validationReportAuthorization ||
      res.statusCode === 401 ||
      res.statusCode === 403
    )
      return method.call(res, body);
    res
      .exemptionReport(res.statusCode < 400)
      .then((report) => {
        if (res.statusCode === 204) {
          const exposed = [
            'X-Validation-Report-Id',
            'X-Validation-Report-Availability',
            'X-Validation-Report-State',
            'X-Validation-Report-Policy-Revision',
            'X-Validation-Report-Exempt-Revisions',
            'X-Validation-Report-Rule-Applications',
          ];
          res.set(
            'Access-Control-Expose-Headers',
            [res.get('Access-Control-Expose-Headers'), ...exposed].filter(Boolean).join(', '),
          );
          res.set('X-Validation-Report-Availability', report.availability);
          res.set('X-Validation-Report-State', report.state);
          res.set('X-Validation-Report-Policy-Revision', String(report.policyRevision));
          res.set('X-Validation-Report-Exempt-Revisions', String(report.reportedExemptRevisions));
          res.set('X-Validation-Report-Rule-Applications', String(report.ruleApplications));
          if (report.reportId) res.set('X-Validation-Report-Id', report.reportId);
          sending = true;
          send.call(res);
          sending = false;
          return;
        }
        const plain = body?.toObject ? body.toObject() : body;
        const augmented =
          plain && typeof plain === 'object' && !Array.isArray(plain) && !Buffer.isBuffer(plain)
            ? { ...plain, exemptionReport: report }
            : { result: plain, exemptionReport: report };
        sending = true;
        json.call(res, augmented);
        sending = false;
      })
      .catch(() => {
        // Report delivery must never turn a completed core write into a reported write failure.
        if (res.statusCode === 204) {
          res.set('X-Validation-Report-Availability', 'unavailable');
          res.set('Access-Control-Expose-Headers', 'X-Validation-Report-Availability');
          sending = true;
          send.call(res);
          sending = false;
          return;
        }
        sending = true;
        json.call(res, {
          result: body,
          exemptionReport: {
            availability: 'unavailable',
            availabilityMessage:
              'Exemption reporting is unavailable; the operation result is preserved.',
          },
        });
        sending = false;
      });
    return res;
  }
  res.json = (body) => deliver(body, json);
  res.send = (body) => deliver(body, send);
};
