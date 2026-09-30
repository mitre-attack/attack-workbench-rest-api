'use strict';

const { attackDomainSchema } = require('@mitre-attack/attack-data-model/dist/index.cjs');
const { version: admVersion } = require('@mitre-attack/attack-data-model/package.json');
const seed = require('../config/allowed-values.json');
const { getSchema } = require('./validation-schemas');
const { BadRequestError } = require('../exceptions');

const ruleKey = ({ propertyName, domainName }) => JSON.stringify([propertyName, domainName]);
const pairKey = (objectType, propertyName) => JSON.stringify([objectType, propertyName]);
const stixTypes = {
  analytic: ['x-mitre-analytic'],
  technique: ['attack-pattern'],
  software: ['tool', 'malware'],
  'data-source': ['x-mitre-data-source'],
  asset: ['x-mitre-asset'],
  identity: ['identity'],
};

function unwrap(schema) {
  while (schema.type === 'optional') schema = schema.unwrap();
  return schema;
}

// Only the original object/property pairs are configurable. Domains and enum
// choices come from the installed ADM, never from copied vocabulary constants.
const pairs = new Map();
const initialRules = new Map();
for (const { objectType, properties } of seed) {
  for (const { propertyName, domains } of properties) {
    const schemas = stixTypes[objectType].map((type) => {
      const objectSchema = getSchema(type, 'work-in-progress');
      const propertySchema =
        propertyName === 'related_asset_sectors'
          ? unwrap(objectSchema.shape.x_mitre_related_assets).element.shape.related_asset_sectors
          : unwrap(objectSchema.shape[propertyName]);
      return {
        objectSchema,
        propertySchema,
        valueSchema: propertySchema.type === 'array' ? propertySchema.element : propertySchema,
      };
    });
    pairs.set(pairKey(objectType, propertyName), {
      objectType,
      propertyName,
      schemas,
      suggestions: [...new Set(domains.flatMap(({ allowedValues }) => allowedValues))],
    });
    for (const { domainName } of domains) {
      const rule = { propertyName, domainName };
      initialRules.set(ruleKey(rule), rule);
    }
  }
}

function valueIssue(pair, domainName, value) {
  if (!pair) return 'Unsupported object type/property pair.';
  if (
    pair.objectType === 'identity'
      ? domainName !== 'stix'
      : !attackDomainSchema.options.includes(domainName)
  ) {
    return 'Unsupported domain for this object type.';
  }
  for (const { objectSchema, propertySchema, valueSchema } of pair.schemas) {
    const parsed = valueSchema.safeParse(value);
    if (!parsed.success) return parsed.error.issues.map(({ message }) => message).join('; ');
    const fieldValue = propertySchema.type === 'array' ? [value] : value;
    const object =
      pair.propertyName === 'related_asset_sectors'
        ? {
            x_mitre_related_assets: [
              {
                name: 'Related asset',
                description: 'Related asset sector',
                related_asset_sectors: fieldValue,
              },
            ],
          }
        : { [pair.propertyName]: fieldValue };
    if (pair.objectType !== 'identity') object.x_mitre_domains = [domainName];
    const contextual = objectSchema.safeParse(object);
    if (!contextual.success) {
      return contextual.error.issues.map(({ message }) => message).join('; ');
    }
  }
  return null;
}

const definitions = new Map();
for (const pair of pairs.values()) {
  const valueSchema = pair.schemas[0].valueSchema;
  const candidates = valueSchema.options || pair.suggestions;
  const domains = pair.objectType === 'identity' ? ['stix'] : attackDomainSchema.options;
  for (const domainName of domains) {
    const choices = candidates.filter((value) => !valueIssue(pair, domainName, value));
    if (!choices.length) continue;
    const key = ruleKey({ propertyName: pair.propertyName, domainName });
    if (!definitions.has(key)) {
      definitions.set(key, {
        propertyName: pair.propertyName,
        domainName,
        objectTypes: [],
        valueType: valueSchema.options ? 'enum' : 'formatted',
        choices: [],
        description: pair.schemas[0].propertySchema.description || valueSchema.description || '',
      });
    }
    const definition = definitions.get(key);
    definition.objectTypes.push(pair.objectType);
    for (const value of choices) {
      let choice = definition.choices.find((candidate) => candidate.value === value);
      if (!choice) {
        choice = { value, objectTypes: [] };
        definition.choices.push(choice);
      }
      choice.objectTypes.push(pair.objectType);
    }
  }
}

function freeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') freeze(child);
  }
  return Object.freeze(value);
}

const catalog = freeze({ admVersion, rules: [...definitions.values()] });
const seededRules = freeze([...initialRules.values()]);

function requireDefinition(propertyName, domainName) {
  const definition = definitions.get(ruleKey({ propertyName, domainName }));
  if (!definition) throw new BadRequestError({ details: 'Unsupported allowed-values rule.' });
  return definition;
}

function getValueIssue({ objectType, propertyName, domainName, value }) {
  if (typeof value !== 'string' || !value.trim()) return 'Value must be a nonempty string.';
  return valueIssue(pairs.get(pairKey(objectType, propertyName)), domainName, value);
}

function validateValue({ propertyName, domainName, objectTypes, value }) {
  const definition = requireDefinition(propertyName, domainName);
  if (
    !Array.isArray(objectTypes) ||
    !objectTypes.length ||
    new Set(objectTypes).size !== objectTypes.length ||
    objectTypes.some((type) => !definition.objectTypes.includes(type))
  ) {
    throw new BadRequestError({ details: 'Invalid object-type scope.' });
  }
  const trimmed = typeof value === 'string' ? value.trim() : value;
  for (const objectType of objectTypes) {
    const reason = getValueIssue({ objectType, propertyName, domainName, value: trimmed });
    if (reason) throw new BadRequestError({ details: reason });
  }
  return { value: trimmed };
}

module.exports = { catalog, seededRules, ruleKey, requireDefinition, getValueIssue, validateValue };
