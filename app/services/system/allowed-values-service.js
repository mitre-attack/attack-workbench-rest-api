'use strict';

const fs = require('fs/promises');
const config = require('../../config/config');
const seed = require('../../config/allowed-values.json');
const repository = require('../../repository/allowed-values-repository');
const { BadRequestError, DuplicateIdError } = require('../../exceptions');
const {
  catalog,
  seededRules,
  ruleKey,
  requireDefinition,
  getValueIssue,
  validateValue,
} = require('../../lib/allowed-values-catalog');

function projectRules({ rules, values }) {
  const grouped = new Map(
    rules.map((rule) => {
      const definition = catalog.rules.find((candidate) => ruleKey(candidate) === ruleKey(rule));
      return [
        ruleKey(rule),
        {
          ...rule,
          objectTypes: definition?.objectTypes || [],
          options: new Map(),
          invalid: new Map(),
        },
      ];
    }),
  );
  for (const { objectType, propertyName, domainName, value, enabled } of values) {
    const rule = grouped.get(ruleKey({ propertyName, domainName }));
    if (!rule) continue;
    const reason = getValueIssue({ objectType, propertyName, domainName, value });
    const options = reason ? rule.invalid : rule.options;
    const key = JSON.stringify([value, enabled, reason]);
    if (!options.has(key)) {
      options.set(key, { value, enabled, objectTypes: [], ...(reason ? { reason } : {}) });
    }
    const option = options.get(key);
    if (!option.objectTypes.includes(objectType)) option.objectTypes.push(objectType);
  }
  return [...grouped.values()].map(({ options, invalid, ...rule }) => ({
    ...rule,
    values: [...options.values()],
    invalidValues: [...invalid.values()],
  }));
}

class AllowedValuesService {
  async initialize() {
    if (await repository.retrieveConfiguration({ optional: true })) {
      // Legacy values are quarantined on reads, not deleted or allowed to prevent
      // startup. The seed file is relevant only when initializing a new database.
      await repository.migrateRules(seededRules);
      return;
    }
    const configuredSeed = JSON.parse(
      await fs.readFile(config.configurationFiles.allowedValues, 'utf8'),
    );
    const values = [];
    const seen = new Set();
    const rules = new Map(seededRules.map((rule) => [ruleKey(rule), rule]));
    if (!Array.isArray(configuredSeed))
      throw new BadRequestError({ details: 'Invalid allowed-values seed.' });
    for (const { objectType, properties } of configuredSeed) {
      for (const { propertyName, domains } of properties) {
        for (const { domainName, allowedValues } of domains) {
          const definition = requireDefinition(propertyName, domainName);
          if (!definition.objectTypes.includes(objectType) || !Array.isArray(allowedValues)) {
            throw new BadRequestError({ details: 'Invalid allowed-values seed scope.' });
          }
          const field = { objectType, propertyName, domainName };
          rules.set(ruleKey(field), { propertyName, domainName });
          for (const rawValue of allowedValues) {
            const { value } = validateValue({
              propertyName,
              domainName,
              objectTypes: [objectType],
              value: rawValue,
            });
            const key = JSON.stringify([objectType, propertyName, domainName, value]);
            if (!seen.has(key)) {
              values.push({ ...field, value, enabled: true });
              seen.add(key);
            }
          }
        }
      }
    }
    await repository.initialize(values, [...rules.values()]);
    await repository.migrateRules(seededRules);
  }

  retrieveCatalog() {
    return catalog;
  }

  validateValue(input) {
    return validateValue(input);
  }

  async retrieveRules() {
    return projectRules(await repository.retrieveConfiguration());
  }

  async retrieveAllowedValues() {
    const configuration = await repository.retrieveConfiguration();
    const configuredKeys = new Set(configuration.rules.map(ruleKey));
    const rules = catalog.rules.filter((rule) => configuredKeys.has(ruleKey(rule)));
    const valuesByField = new Map();
    for (const row of configuration.values) {
      if (!row.enabled || !configuredKeys.has(ruleKey(row)) || getValueIssue(row)) continue;
      const key = JSON.stringify([row.objectType, row.propertyName, row.domainName]);
      if (!valuesByField.has(key)) valuesByField.set(key, []);
      valuesByField.get(key).push(row.value);
    }
    // Preserve the original nested ordering and empty scopes, while including
    // ADM-supported domains explicitly added by administrators.
    return seed.map(({ objectType, properties }) => ({
      objectType,
      properties: properties.map(({ propertyName, domains }) => {
        const domainNames = new Set(domains.map(({ domainName }) => domainName));
        for (const rule of rules) {
          if (rule.propertyName === propertyName && rule.objectTypes.includes(objectType)) {
            domainNames.add(rule.domainName);
          }
        }
        return {
          propertyName,
          domains: [...domainNames].map((domainName) => ({
            domainName,
            allowedValues:
              valuesByField.get(JSON.stringify([objectType, propertyName, domainName])) || [],
          })),
        };
      }),
    }));
  }

  async saveRule(propertyName, domainName, values, options) {
    requireDefinition(propertyName, domainName);
    const seen = new Set();
    const rows = [];
    for (const option of values) {
      const { value } = validateValue({ propertyName, domainName, ...option });
      if (typeof option.enabled !== 'boolean')
        throw new BadRequestError({ details: 'Enabled must be boolean.' });
      for (const objectType of option.objectTypes) {
        const tupleValue = JSON.stringify([objectType, value]);
        if (seen.has(tupleValue)) {
          throw new DuplicateIdError({
            details: 'A value may appear only once per object type within a rule.',
          });
        }
        seen.add(tupleValue);
        rows.push({ objectType, propertyName, domainName, value, enabled: option.enabled });
      }
    }
    const updated = await repository.saveRule(propertyName, domainName, rows, options);
    return projectRules(updated).find(
      (rule) => ruleKey(rule) === ruleKey({ propertyName, domainName }),
    );
  }

  createRule(propertyName, domainName, values) {
    return this.saveRule(propertyName, domainName, values, { create: true });
  }

  replaceRule(propertyName, domainName, values) {
    return this.saveRule(propertyName, domainName, values);
  }
}

module.exports = new AllowedValuesService();
