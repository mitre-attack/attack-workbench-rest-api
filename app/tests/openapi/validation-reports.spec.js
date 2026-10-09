'use strict';

const { expect } = require('expect');
const parser = require('@apidevtools/json-schema-ref-parser');
const config = require('../../config/config');

describe('Validation report OpenAPI contracts', () => {
  let document;
  before(async () => {
    document = await parser.dereference(config.openApi.specPath);
  });
  it('declares all optional report parameters together on every supported operation', () => {
    let supported = 0;
    for (const path of Object.values(document.paths)) {
      for (const operation of Object.values(path)) {
        if (!operation.parameters?.some((p) => p.name === 'exemptionReport')) continue;
        supported++;
        const params = operation.parameters.map((p) => p.name);
        expect(params).toEqual(
          expect.arrayContaining([
            'exemptionReport',
            'exemptionStatuses',
            'exemptionRuleIds',
            'exemptionLimit',
          ]),
        );
        for (const name of ['exemptionStatuses', 'exemptionRuleIds', 'exemptionLimit']) {
          const parameter = operation.parameters.find((p) => p.name === name);
          expect(parameter.schema.default).toBeUndefined();
        }
        expect(operation.responses.default).toBeDefined();
      }
    }
    expect(supported).toBeGreaterThan(50);
  });
  it('declares retained report filters without requiring opt-in again and exposes204 headers', () => {
    const retained = document.paths['/api/validation-reports/{reportId}'].get;
    expect(retained.parameters.map((p) => p.name)).toEqual([
      'reportId',
      'exemptionStatuses',
      'exemptionRuleIds',
      'exemptionLimit',
      'exemptionCursor',
    ]);
    expect(retained.responses['410']).toBeDefined();
    const identity = document.paths['/api/config/organization-identity'].post;
    expect(identity.responses['204'].headers['X-Validation-Report-Id']).toBeDefined();
  });
});
