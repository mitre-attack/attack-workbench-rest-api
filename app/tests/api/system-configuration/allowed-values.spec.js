'use strict';

const request = require('supertest');
const { expect } = require('expect');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');
const AllowedValuesConfiguration = require('../../../models/allowed-values-configuration-model');
const UserAccount = require('../../../models/user-account-model');
const service = require('../../../services/system/allowed-values-service');
const systemConfigurationService = require('../../../services/system/system-configuration-service');
const seed = require('../../../config/allowed-values.json');
const ValidationBypassRule = require('../../../models/validation-bypass-rule-model');

const base = '/api/config/allowed-values';
const rules = `${base}/rules`;
const platformRule = { propertyName: 'x_mitre_platforms', domainName: 'ics-attack' };
const enterpriseRule = { propertyName: 'x_mitre_platforms', domainName: 'enterprise-attack' };
const ruleKey = ({ propertyName, domainName }) => JSON.stringify([propertyName, domainName]);
const ruleUrl = ({ propertyName, domainName }) => `${rules}/${propertyName}/${domainName}`;
const sameRule = (left, right) => ruleKey(left) === ruleKey(right);
const expectedCatalog = [];
for (const { objectType, properties } of seed) {
  for (const { propertyName, domains } of properties) {
    for (const { domainName } of domains) {
      let rule = expectedCatalog.find((item) => sameRule(item, { propertyName, domainName }));
      if (!rule) {
        rule = { propertyName, domainName, objectTypes: [] };
        expectedCatalog.push(rule);
      }
      rule.objectTypes.push(objectType);
    }
  }
}
// The original configured groups also admit asset platforms in the other
// domains under the installed ADM, without seeding any new choices.
for (const rule of expectedCatalog) {
  if (rule.propertyName === 'x_mitre_platforms' && rule.domainName !== 'ics-attack') {
    rule.objectTypes.push('asset');
  }
}
const expectedNested = structuredClone(seed);
expectedNested
  .find(({ objectType }) => objectType === 'asset')
  .properties.find(({ propertyName }) => propertyName === 'x_mitre_platforms')
  .domains.push(
    { domainName: 'enterprise-attack', allowedValues: [] },
    { domainName: 'mobile-attack', allowedValues: [] },
  );

function choices(nested, rule, objectType) {
  return nested
    .find((item) => item.objectType === objectType)
    .properties.find((item) => item.propertyName === rule.propertyName)
    .domains.find((item) => item.domainName === rule.domainName).allowedValues;
}

function scopedValues(listing) {
  return listing
    .flatMap(({ propertyName, domainName, values }) =>
      values.flatMap(({ value, enabled, objectTypes }) =>
        objectTypes.map((objectType) =>
          JSON.stringify([objectType, propertyName, domainName, value, enabled]),
        ),
      ),
    )
    .sort();
}

const seededValues = seed
  .flatMap(({ objectType, properties }) =>
    properties.flatMap(({ propertyName, domains }) =>
      domains.flatMap(({ domainName, allowedValues }) =>
        allowedValues.map((value) =>
          JSON.stringify([objectType, propertyName, domainName, value, true]),
        ),
      ),
    ),
  )
  .sort();

describe('Runtime allowed values API', function () {
  let app;
  let cookie;
  let anonymousUser;
  let originalSeedPath;
  let originalBasicAuthn;

  function api(method, url, body, status = 200) {
    const call = request(app)[method](url).set('Cookie', cookie);
    if (body !== undefined) call.send(body);
    return call.expect(status);
  }

  async function getRule(rule) {
    return (await api('get', rules)).body.find((item) => sameRule(item, rule));
  }

  before(async function () {
    originalSeedPath = config.configurationFiles.allowedValues;
    originalBasicAuthn = { ...config.serviceAuthn.basicApikey };
    config.serviceAuthn.basicApikey.enable = true;
    config.serviceAuthn.basicApikey.serviceAccounts = [
      {
        name: 'allowed-values-reader',
        apikey: 'allowed-values-test-key',
        serviceRole: 'read-only',
      },
    ];
    config.configurationFiles.allowedValues = path.resolve(
      __dirname,
      '../../../config/allowed-values.json',
    );
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();
    config.validateRequests.withAttackDataModel = true;
    config.validateRequests.withOpenApi = true;
    app = await require('../../../index').initializeApp();
    const passportCookie = await login.loginAnonymous(app);
    cookie = `${passportCookie.name}=${passportCookie.value}`;
    anonymousUser = await systemConfigurationService.retrieveAnonymousUserAccount();
  });

  beforeEach(async function () {
    await UserAccount.updateOne({ id: anonymousUser.id }, { $set: { role: 'admin' } });
    await AllowedValuesConfiguration.deleteMany({});
    await service.initialize();
  });

  after(async function () {
    config.configurationFiles.allowedValues = originalSeedPath;
    Object.assign(config.serviceAuthn.basicApikey, originalBasicAuthn);
    await database.closeConnection();
  });

  it('groups the catalog uniquely without changing any seeded choice or object-type scope', async function () {
    await AllowedValuesConfiguration.deleteMany({});
    await Promise.all(Array.from({ length: 8 }, () => service.initialize()));
    expect((await api('get', base)).body).toEqual(expectedNested);
    const listing = (await api('get', rules)).body;
    expect(
      listing.map(({ propertyName, domainName, objectTypes }) => ({
        propertyName,
        domainName,
        objectTypes,
      })),
    ).toEqual(expectedCatalog);
    expect(new Set(listing.map(ruleKey)).size).toBe(expectedCatalog.length);
    expect(scopedValues(listing)).toEqual(seededValues);
    expect(listing.every(({ invalidValues }) => invalidValues.length === 0)).toBe(true);
    for (const rule of listing) {
      expect(
        new Set(rule.values.map(({ value, enabled }) => JSON.stringify([value, enabled]))).size,
      ).toBe(rule.values.length);
    }
    const ics = listing.find((item) => sameRule(item, platformRule));
    expect(ics.objectTypes).toContain('data-source');
    expect(ics.values.find((option) => option.value === 'None').objectTypes).toEqual([
      'analytic',
      'technique',
    ]);
    expect(ics.values.some((option) => option.objectTypes.includes('data-source'))).toBe(false);
  });

  it('uses the configured seed once and keeps cleared rules and their complete catalog on restart', async function () {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'allowed-values-'));
    const configuredPath = config.configurationFiles.allowedValues;
    try {
      const customPath = path.join(directory, 'seed.json');
      await fs.writeFile(
        customPath,
        JSON.stringify([
          {
            objectType: 'data-source',
            properties: [
              {
                propertyName: platformRule.propertyName,
                domains: [{ domainName: platformRule.domainName, allowedValues: ['Linux'] }],
              },
            ],
          },
        ]),
      );
      config.configurationFiles.allowedValues = customPath;
      await AllowedValuesConfiguration.deleteMany({});
      await service.initialize();
      const listing = (await api('get', rules)).body;
      expect(scopedValues(listing)).toEqual([
        JSON.stringify([
          'data-source',
          platformRule.propertyName,
          platformRule.domainName,
          'Linux',
          true,
        ]),
      ]);
      expect(
        listing.map(({ propertyName, domainName, objectTypes }) => ({
          propertyName,
          domainName,
          objectTypes,
        })),
      ).toEqual(expectedCatalog);
      const cleared = (await api('put', ruleUrl(platformRule), { values: [] })).body;
      expect(cleared).toEqual({
        ...listing.find((item) => sameRule(item, platformRule)),
        values: [],
      });
      await Promise.all(Array.from({ length: 8 }, () => service.initialize()));
      const after = (await api('get', rules)).body;
      expect(after).toEqual(
        expectedCatalog.map((rule) => ({ ...rule, values: [], invalidValues: [] })),
      );
      for (const objectType of cleared.objectTypes) {
        expect(choices((await api('get', base)).body, platformRule, objectType)).toEqual([]);
      }
    } finally {
      config.configurationFiles.allowedValues = configuredPath;
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('adds, toggles and removes options for multiple object types without broadening other scopes', async function () {
    const initial = (await api('get', rules)).body;
    const rule = initial.find((item) => sameRule(item, platformRule));
    const option = {
      value: 'Network Devices',
      enabled: true,
      objectTypes: ['technique', 'data-source'],
    };
    let values = [...rule.values, { ...option, value: `  ${option.value}  ` }];
    let updated = (await api('put', ruleUrl(rule), { values })).body;
    expect(updated).toEqual({ ...rule, values: [...rule.values, option] });
    for (const objectType of option.objectTypes) {
      expect(choices((await api('get', base)).body, rule, objectType)).toContain(option.value);
    }
    expect(choices((await api('get', base)).body, rule, 'analytic')).not.toContain(option.value);
    expect(
      await systemConfigurationService.retrieveAllowedValuesForTypePropertyDomain(
        'data-source',
        rule.propertyName,
        rule.domainName,
      ),
    ).toEqual({ domainName: rule.domainName, allowedValues: [option.value] });

    values = updated.values.map((item) =>
      item.value === option.value ? { ...item, enabled: false } : item,
    );
    updated = (await api('put', ruleUrl(rule), { values })).body;
    expect(updated.values).toContainEqual({ ...option, enabled: false });
    for (const objectType of option.objectTypes) {
      expect(choices((await api('get', base)).body, rule, objectType)).not.toContain(option.value);
    }
    values = updated.values.map((item) =>
      item.value === option.value ? { ...item, enabled: true } : item,
    );
    await api('put', ruleUrl(rule), { values });
    expect(choices((await api('get', base)).body, rule, 'data-source')).toEqual([option.value]);
    values = values.filter((item) => item.value !== option.value);
    await api('put', ruleUrl(rule), { values });
    expect(await getRule(rule)).toEqual(rule);
    expect(choices((await api('get', base)).body, rule, 'data-source')).toEqual([]);
    expect((await api('get', rules)).body.filter((item) => !sameRule(item, rule))).toEqual(
      initial.filter((item) => !sameRule(item, rule)),
    );
  });

  it('preserves already persisted removals and mixed enabled variants through grouping, save and restart', async function () {
    await AllowedValuesConfiguration.updateOne(
      { _id: 'allowed-values' },
      {
        $pull: { values: { ...enterpriseRule, objectType: 'technique', value: 'Linux' } },
      },
    );
    await AllowedValuesConfiguration.updateOne(
      {
        _id: 'allowed-values',
        values: { $elemMatch: { ...enterpriseRule, objectType: 'technique', value: 'Windows' } },
      },
      { $set: { 'values.$.enabled': false } },
    );
    const grouped = await getRule(enterpriseRule);
    expect(grouped.values.find((option) => option.value === 'Linux').objectTypes).not.toContain(
      'technique',
    );
    expect(grouped.values).toContainEqual({
      value: 'Windows',
      enabled: false,
      objectTypes: ['technique'],
    });
    expect(
      grouped.values.find((option) => option.value === 'Windows' && option.enabled).objectTypes,
    ).not.toContain('technique');
    expect((await api('put', ruleUrl(grouped), { values: grouped.values })).body).toEqual(grouped);
    await Promise.all(Array.from({ length: 8 }, () => service.initialize()));
    await databaseConfiguration.checkSystemConfiguration();
    expect(await getRule(grouped)).toEqual(grouped);
    const nested = (await api('get', base)).body;
    expect(choices(nested, grouped, 'technique')).not.toContain('Linux');
    expect(choices(nested, grouped, 'technique')).not.toContain('Windows');
    expect(choices(nested, grouped, 'analytic')).toContain('Linux');
    expect(choices(nested, grouped, 'analytic')).toContain('Windows');
  });

  it('coalesces equal disjoint variants but keeps differing enabled states distinct', async function () {
    const values = [
      { value: 'Windows', enabled: true, objectTypes: ['analytic'] },
      { value: 'Windows', enabled: true, objectTypes: ['technique'] },
      { value: 'Windows', enabled: false, objectTypes: ['software'] },
    ];
    const updated = (await api('put', ruleUrl(platformRule), { values })).body;
    expect(updated.values).toEqual([
      { value: 'Windows', enabled: true, objectTypes: ['analytic', 'technique'] },
      { value: 'Windows', enabled: false, objectTypes: ['software'] },
    ]);
    expect(await getRule(platformRule)).toEqual(updated);
    const nested = (await api('get', base)).body;
    expect(choices(nested, platformRule, 'analytic')).toEqual(['Windows']);
    expect(choices(nested, platformRule, 'technique')).toEqual(['Windows']);
    expect(choices(nested, platformRule, 'software')).toEqual([]);
    expect(choices(nested, platformRule, 'data-source')).toEqual([]);
  });

  it('rejects unsupported rules, invalid bodies and invalid scopes without partially replacing any values', async function () {
    const before = (await api('get', rules)).body;
    const option = { value: 'Windows', enabled: true, objectTypes: ['technique'] };
    for (const body of [
      {},
      { values: null },
      { values: [option], extra: true },
      { values: [option, { ...option, value: '   ' }] },
      { values: [option, { ...option, value: 123 }] },
      { values: [option, { value: 'Other', objectTypes: ['technique'] }] },
      { values: [option, { ...option, enabled: 'false' }] },
      { values: [option, { ...option, enabled: null }] },
      { values: [option, { ...option, objectTypes: [] }] },
      { values: [option, { ...option, objectTypes: ['arbitrary-object'] }] },
      { values: [option, { ...option, objectTypes: ['identity'] }] },
      { values: [option, { ...option, objectTypes: ['technique', 'technique'] }] },
      { values: [option, { ...option, objectTypes: ['technique', null] }] },
      { values: [option, { ...option, extra: true }] },
    ]) {
      await api('put', ruleUrl(platformRule), body, 400);
    }
    for (const rule of [
      { ...platformRule, propertyName: 'arbitrary-property' },
      { ...platformRule, domainName: 'stix' },
    ]) {
      await api('put', ruleUrl(rule), { values: [] }, 400);
    }
    expect((await api('get', rules)).body).toEqual(before);
    expect((await api('get', base)).body).toEqual(expectedNested);
  });

  it('rejects overlapping duplicate values after trimming regardless of enabled state', async function () {
    const before = (await api('get', rules)).body;
    for (const enabled of [true, false]) {
      await api(
        'put',
        ruleUrl(platformRule),
        {
          values: [
            { value: 'Windows', enabled: true, objectTypes: ['analytic', 'technique'] },
            { value: ' Windows ', enabled, objectTypes: ['technique', 'software'] },
          ],
        },
        409,
      );
    }
    expect((await api('get', rules)).body).toEqual(before);
  });

  it('atomically retains concurrent replacements of different rules and every untouched rule', async function () {
    const before = (await api('get', rules)).body;
    const targets = before.filter((rule) => rule.propertyName === 'x_mitre_platforms');
    const replacements = targets.map((rule) => ({
      ...rule,
      values: [{ value: 'Windows', enabled: true, objectTypes: rule.objectTypes }],
    }));
    const responses = await Promise.all(
      replacements.map((rule) => api('put', ruleUrl(rule), { values: rule.values })),
    );
    expect(responses.map((response) => response.body)).toEqual(replacements);
    expect((await api('get', rules)).body).toEqual(
      before.map((rule) => replacements.find((replacement) => sameRule(replacement, rule)) || rule),
    );
    const nested = (await api('get', base)).body;
    for (const rule of replacements) {
      for (const objectType of rule.objectTypes) {
        expect(choices(nested, rule, objectType)).toEqual(['Windows']);
      }
    }
  });

  it('offers ADM-supported new scopes without expanding the original object/property whitelist', async function () {
    const catalog = (await api('get', `${base}/catalog`)).body;
    expect(catalog.admVersion).toBe(
      require('@mitre-attack/attack-data-model/package.json').version,
    );
    for (const definition of catalog.rules) {
      for (const objectType of definition.objectTypes) {
        expect(
          seed
            .find((item) => item.objectType === objectType)
            .properties.map((item) => item.propertyName),
        ).toContain(definition.propertyName);
      }
    }
    expect(catalog.rules).toContainEqual(
      expect.objectContaining({
        propertyName: 'x_mitre_sectors',
        domainName: 'enterprise-attack',
        objectTypes: ['asset'],
        valueType: 'enum',
        choices: expect.arrayContaining([{ value: 'Electric', objectTypes: ['asset'] }]),
      }),
    );
    expect(
      catalog.rules.some(
        (item) =>
          item.propertyName === 'x_mitre_effective_permissions' &&
          item.domainName === 'mobile-attack',
      ),
    ).toBe(false);
    expect(
      catalog.rules
        .find((item) => item.propertyName === 'x_mitre_effective_permissions')
        .choices.map(({ value }) => value),
    ).not.toContain('Remote Desktop Users');
    expect(
      catalog.rules.find((item) => item.propertyName === 'x_mitre_data_sources').valueType,
    ).toBe('formatted');
    expect(
      catalog.rules
        .filter((item) => item.objectTypes.includes('identity'))
        .every((item) => item.domainName === 'stix'),
    ).toBe(true);
  });

  it('creates a new property/domain atomically and retains an empty configuration across restart', async function () {
    const newRule = { propertyName: 'x_mitre_sectors', domainName: 'enterprise-attack' };
    await api('put', ruleUrl(newRule), { values: [] }, 404);
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app)
          .post(rules)
          .set('Cookie', cookie)
          .send({ ...newRule, values: [] }),
      ),
    );
    expect(responses.map(({ status }) => status).sort()).toEqual([
      201, 409, 409, 409, 409, 409, 409, 409,
    ]);
    const created = responses.find(({ status }) => status === 201).body;
    expect(created).toEqual({ ...newRule, objectTypes: ['asset'], values: [], invalidValues: [] });
    await Promise.all(Array.from({ length: 8 }, () => service.initialize()));
    expect(await getRule(newRule)).toEqual(created);
    expect(choices((await api('get', base)).body, newRule, 'asset')).toEqual([]);
    const option = { value: 'Electric', enabled: true, objectTypes: ['asset'] };
    await api('put', ruleUrl(newRule), { values: [option] });
    expect(choices((await api('get', base)).body, newRule, 'asset')).toEqual(['Electric']);
  });

  it('validates formatted choices without mutation and applies the same checks to final writes', async function () {
    const rule = { propertyName: 'x_mitre_data_sources', domainName: 'enterprise-attack' };
    const input = { ...rule, objectTypes: ['technique'], value: '  Custom Sensor: Custom Event  ' };
    const before = (await api('get', rules)).body;
    expect((await api('post', `${base}/validate`, input)).body).toEqual({
      value: 'Custom Sensor: Custom Event',
    });
    expect((await api('get', rules)).body).toEqual(before);
    for (const value of [
      'Missing separator',
      'Source:',
      ': Component',
      'Source: Component: Extra',
    ]) {
      await api('post', `${base}/validate`, { ...input, value }, 400);
      await api(
        'post',
        rules,
        { ...rule, values: [{ value, enabled: false, objectTypes: ['technique'] }] },
        400,
      );
    }
    const created = (
      await api(
        'post',
        rules,
        {
          ...rule,
          values: [{ value: input.value, enabled: true, objectTypes: input.objectTypes }],
        },
        201,
      )
    ).body;
    expect(created.values).toEqual([
      { value: 'Custom Sensor: Custom Event', enabled: true, objectTypes: ['technique'] },
    ]);
    await api(
      'put',
      ruleUrl(rule),
      { values: [{ value: 'Bad', enabled: false, objectTypes: ['technique'] }] },
      400,
    );
    expect(await getRule(rule)).toEqual(created);
    expect(choices((await api('get', base)).body, rule, 'technique')).toEqual([
      'Custom Sensor: Custom Event',
    ]);
  });

  it('rejects enum and domain incompatibilities even when disabled, bypassed, or general ADM validation is off', async function () {
    const before = (await api('get', rules)).body;
    const bypass = await ValidationBypassRule.create({
      fieldPath: ['x_mitre_platforms', '0'],
      errorCode: 'invalid_value',
      stixType: 'attack-pattern',
      suppressError: true,
    });
    const original = config.validateRequests.withAttackDataModel;
    try {
      config.validateRequests.withAttackDataModel = false;
      for (const enabled of [true, false]) {
        await api(
          'put',
          ruleUrl(enterpriseRule),
          {
            values: [{ value: 'Custom Platform', enabled, objectTypes: ['technique'] }],
          },
          400,
        );
      }
      await api(
        'post',
        `${base}/validate`,
        {
          ...enterpriseRule,
          objectTypes: ['technique'],
          value: 'Custom Platform',
        },
        400,
      );
      for (const input of [
        {
          propertyName: 'x_mitre_effective_permissions',
          domainName: 'mobile-attack',
          value: 'User',
        },
        {
          propertyName: 'x_mitre_tactic_type',
          domainName: 'enterprise-attack',
          value: 'Post-Adversary Device Access',
        },
        {
          propertyName: 'x_mitre_data_sources',
          domainName: 'mobile-attack',
          value: 'Source: Component',
        },
      ]) {
        await api('post', `${base}/validate`, { ...input, objectTypes: ['technique'] }, 400);
        await api(
          'post',
          rules,
          { propertyName: input.propertyName, domainName: input.domainName, values: [] },
          400,
        );
      }
      await api(
        'post',
        rules,
        {
          propertyName: 'x_mitre_sectors',
          domainName: 'enterprise-attack',
          values: [{ value: 'Electric', enabled: true, objectTypes: ['technique'] }],
        },
        400,
      );
      const relatedRule = {
        propertyName: 'related_asset_sectors',
        domainName: 'enterprise-attack',
      };
      await api(
        'post',
        rules,
        {
          ...relatedRule,
          values: [{ value: 'Invented sector', enabled: false, objectTypes: ['asset'] }],
        },
        400,
      );
      expect((await api('get', rules)).body).toEqual(before);
      await api(
        'post',
        rules,
        { ...relatedRule, values: [{ value: 'Electric', enabled: true, objectTypes: ['asset'] }] },
        201,
      );
      expect(choices((await api('get', base)).body, relatedRule, 'asset')).toEqual(['Electric']);
    } finally {
      config.validateRequests.withAttackDataModel = original;
      await ValidationBypassRule.deleteOne({ _id: bypass._id });
    }
  });

  it('migrates old configuration keys without restoring removals and quarantines invalid legacy values', async function () {
    await AllowedValuesConfiguration.updateOne(
      { _id: 'allowed-values' },
      {
        $unset: { rules: '' },
        $pull: { values: { ...enterpriseRule, objectType: 'technique', value: 'Linux' } },
      },
    );
    await AllowedValuesConfiguration.updateOne(
      { _id: 'allowed-values' },
      {
        $push: {
          values: {
            ...enterpriseRule,
            objectType: 'technique',
            value: 'Legacy Platform',
            enabled: true,
          },
        },
      },
    );
    const configuredPath = config.configurationFiles.allowedValues;
    const originalValidation = config.validateRequests.withAttackDataModel;
    try {
      config.configurationFiles.allowedValues = '/no-longer-present/seed.json';
      config.validateRequests.withAttackDataModel = false;
      await Promise.all(Array.from({ length: 8 }, () => service.initialize()));
      const rule = await getRule(enterpriseRule);
      expect(rule.invalidValues).toEqual([
        expect.objectContaining({
          value: 'Legacy Platform',
          enabled: true,
          objectTypes: ['technique'],
          reason: expect.any(String),
        }),
      ]);
      expect(rule.values.some(({ value }) => value === 'Legacy Platform')).toBe(false);
      const nested = (await api('get', base)).body;
      expect(choices(nested, enterpriseRule, 'technique')).not.toContain('Legacy Platform');
      expect(choices(nested, enterpriseRule, 'technique')).not.toContain('Linux');
      expect(choices(nested, enterpriseRule, 'analytic')).toContain('Linux');
      const raw = await AllowedValuesConfiguration.findById('allowed-values').lean();
      expect(raw.values.some(({ value }) => value === 'Legacy Platform')).toBe(true);
      expect(new Set(raw.rules.map(ruleKey)).size).toBe(expectedCatalog.length);
      await api('put', ruleUrl(rule), { values: rule.values });
      expect((await getRule(rule)).invalidValues).toEqual([]);
      expect(
        (await AllowedValuesConfiguration.findById('allowed-values').lean()).values.some(
          ({ value }) => value === 'Legacy Platform',
        ),
      ).toBe(false);
    } finally {
      config.configurationFiles.allowedValues = configuredPath;
      config.validateRequests.withAttackDataModel = originalValidation;
    }
  });

  it('rejects a fresh custom seed containing an ADM-invalid value without partially initializing', async function () {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'allowed-values-invalid-'));
    const configuredPath = config.configurationFiles.allowedValues;
    try {
      config.configurationFiles.allowedValues = path.join(directory, 'seed.json');
      await fs.writeFile(
        config.configurationFiles.allowedValues,
        JSON.stringify([
          {
            objectType: 'technique',
            properties: [
              {
                propertyName: 'x_mitre_platforms',
                domains: [
                  {
                    domainName: 'enterprise-attack',
                    allowedValues: ['Windows', 'Custom Platform'],
                  },
                ],
              },
            ],
          },
        ]),
      );
      await AllowedValuesConfiguration.deleteMany({});
      await expect(service.initialize()).rejects.toMatchObject({ name: 'BadRequestError' });
      expect(await AllowedValuesConfiguration.countDocuments()).toBe(0);
    } finally {
      config.configurationFiles.allowedValues = configuredPath;
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps dropdown access for nonadmins but denies rule listing and replacement', async function () {
    const before = (await api('get', rules)).body;
    try {
      for (const role of ['visitor', 'editor', 'team_lead']) {
        await UserAccount.updateOne({ id: anonymousUser.id }, { $set: { role } });
        expect((await api('get', base)).body).toEqual(expectedNested);
        await api('get', rules, undefined, 401);
        await api('put', ruleUrl(platformRule), { values: [] }, 401);
        await api('get', `${base}/catalog`, undefined, 401);
        await api(
          'post',
          rules,
          { propertyName: 'x_mitre_sectors', domainName: 'enterprise-attack', values: [] },
          401,
        );
        await api(
          'post',
          `${base}/validate`,
          { ...platformRule, value: 'Windows', objectTypes: ['technique'] },
          401,
        );
      }
    } finally {
      await UserAccount.updateOne({ id: anonymousUser.id }, { $set: { role: 'admin' } });
    }
    await request(app).get(rules).expect(401);
    await request(app).put(ruleUrl(platformRule)).send({ values: [] }).expect(401);
    expect((await api('get', rules)).body).toEqual(before);
  });

  it('retains read-only service dropdown access without granting administrator operations', async function () {
    const before = (await api('get', rules)).body;
    const serviceRequest = (method, url) =>
      request(app)[method](url).auth('allowed-values-reader', 'allowed-values-test-key');
    expect((await serviceRequest('get', base).expect(200)).body).toEqual(expectedNested);
    await serviceRequest('get', rules).expect(401);
    await serviceRequest('put', ruleUrl(platformRule)).send({ values: [] }).expect(401);
    await serviceRequest('get', `${base}/catalog`).expect(401);
    await serviceRequest('post', rules)
      .send({ propertyName: 'x_mitre_sectors', domainName: 'enterprise-attack', values: [] })
      .expect(401);
    await serviceRequest('post', `${base}/validate`)
      .send({ ...platformRule, value: 'Windows', objectTypes: ['technique'] })
      .expect(401);
    expect((await api('get', rules)).body).toEqual(before);
  });
});
