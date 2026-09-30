'use strict';

const { z } = require('zod');
const service = require('../services/system/allowed-values-service');
const { BadRequestError } = require('../exceptions');

const optionSchema = z
  .object({
    value: z.string().trim().min(1),
    enabled: z.boolean(),
    objectTypes: z
      .array(z.string().min(1))
      .min(1)
      .refine((types) => new Set(types).size === types.length, {
        message: 'Object types must be distinct.',
      }),
  })
  .strict();
const replaceSchema = z.object({ values: z.array(optionSchema) }).strict();
const ruleSchema = z
  .object({ propertyName: z.string().min(1), domainName: z.string().min(1) })
  .strict();
const createSchema = ruleSchema.extend({ values: z.array(optionSchema) }).strict();
const validateSchema = ruleSchema
  .extend({ value: optionSchema.shape.value, objectTypes: optionSchema.shape.objectTypes })
  .strict();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestError({ details: result.error.issues });
  return result.data;
}

exports.retrieveRules = async function (req, res, next) {
  try {
    return res.status(200).send(await service.retrieveRules());
  } catch (err) {
    return next(err);
  }
};

exports.replaceRule = async function (req, res, next) {
  try {
    const { propertyName, domainName } = parse(ruleSchema, req.params);
    const { values } = parse(replaceSchema, req.body);
    return res.status(200).send(await service.replaceRule(propertyName, domainName, values));
  } catch (err) {
    return next(err);
  }
};

exports.retrieveCatalog = async function (req, res, next) {
  try {
    return res.status(200).send(service.retrieveCatalog());
  } catch (err) {
    return next(err);
  }
};

exports.createRule = async function (req, res, next) {
  try {
    const { propertyName, domainName, values } = parse(createSchema, req.body);
    return res.status(201).send(await service.createRule(propertyName, domainName, values));
  } catch (err) {
    return next(err);
  }
};

exports.validateValue = async function (req, res, next) {
  try {
    return res.status(200).send(service.validateValue(parse(validateSchema, req.body)));
  } catch (err) {
    return next(err);
  }
};
