'use strict';

const { z } = require('zod');
const { STIX_SCHEMAS } = require('./validation-schemas');
const { BadRequestError, DuplicateIdError } = require('../exceptions');
const BypassRuleReasons = require('./bypass-rule-constants');

const supportedStixTypes = Object.freeze(Object.keys(STIX_SCHEMAS).sort());
const metadata = {
  _id: z.any().optional(),
  __v: z.number().optional(),
  autoCreated: z.boolean().default(false),
  autoCreatedReason: z.enum(Object.values(BypassRuleReasons)).nullable().default(null),
  triggerEvent: z.string().nullable().default(null),
};
const errorBypassSchema = z
  .object({
    ...metadata,
    kind: z.literal('error-bypass').optional(),
    fieldPath: z.array(z.union([z.string(), z.number()])).transform((path) => path.map(String)),
    errorCode: z.string().min(1),
    stixType: z.string().min(1),
    suppressError: z.boolean().default(true),
    warningMessage: z.string().nullable().default(null),
  })
  .strict();
const objectExemptionSchema = z
  .object({
    ...metadata,
    kind: z.literal('object-exemption'),
    name: z.string().trim().min(1).max(200),
    enabled: z.boolean(),
    retirementStatus: z.enum(['revoked', 'deprecated']),
    stixTypes: z.union([
      z.literal('all'),
      z
        .array(z.enum(supportedStixTypes))
        .min(1)
        .transform((types) => [...new Set(types)].sort()),
    ]),
  })
  .strict();
const ruleSchema = z.union([errorBypassSchema, objectExemptionSchema]);

function normalizeRule(data) {
  const parsed = ruleSchema.safeParse(data);
  if (!parsed.success) {
    throw new BadRequestError({
      details: parsed.error.issues.map((issue) => issue.message).join('; '),
    });
  }
  return parsed.data;
}

function selectorKey(rule) {
  return rule.kind === 'object-exemption'
    ? JSON.stringify(['object-exemption', rule.retirementStatus, rule.stixTypes])
    : JSON.stringify(['error-bypass', rule.fieldPath.map(String), rule.errorCode, rule.stixType]);
}

function assertUniqueRules(rules) {
  const selectors = new Set();
  const ids = new Set();
  for (const rule of rules) {
    const key = selectorKey(rule);
    const id = String(rule._id);
    if (selectors.has(key) || ids.has(id)) {
      throw new DuplicateIdError({
        details: 'A validation rule with this selector or id already exists.',
      });
    }
    selectors.add(key);
    ids.add(id);
  }
}

module.exports = { supportedStixTypes, ruleSchema, normalizeRule, selectorKey, assertUniqueRules };
