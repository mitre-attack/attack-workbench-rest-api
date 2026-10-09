'use strict';

const mongoose = require('mongoose');

const ValidationBypassRule = require('../models/validation-bypass-rule-model');
const { DuplicateIdError, DatabaseError } = require('../exceptions');

class ValidationBypassesRepository {
  constructor(model) {
    this.model = model;
  }

  async retrieveAll(options) {
    const aggregation = [{ $sort: { stixType: 1 } }];

    const totalCount = await this.model.aggregate(aggregation).count('totalCount').exec();

    if (options.offset) {
      aggregation.push({ $skip: options.offset });
    } else {
      aggregation.push({ $skip: 0 });
    }

    if (options.limit) {
      aggregation.push({ $limit: options.limit });
    }

    const documents = await this.model.aggregate(aggregation).exec();

    return [
      {
        totalCount: [{ totalCount: totalCount[0]?.totalCount || 0 }],
        documents: documents,
      },
    ];
  }

  async save(data) {
    const document = new this.model(data);
    try {
      return await document.save();
    } catch (err) {
      if (err.name === 'MongoServerError' && err.code === 11000) {
        throw new DuplicateIdError({
          details:
            'A validation bypass rule with this fieldPath, errorCode, and stixType already exists.',
        });
      } else {
        throw new DatabaseError(err);
      }
    }
  }

  /**
   * Insert a rule if no rule with the same (fieldPath, errorCode, stixType)
   * key exists. Unlike save(), this does not rely on the unique index to
   * reject duplicates — on a fresh database the index may still be building
   * in the background, which would let a duplicate insert through. Used by
   * the startup seeding paths (identity/namespace/static rules), which must
   * be idempotent.
   *
   * @param {Object} data - The rule to insert
   * @returns {Promise<{created: boolean}>} created is false if the rule already existed
   */
  async upsertRule(data) {
    try {
      const existing = await this.model
        .findOneAndUpdate(
          { fieldPath: data.fieldPath, errorCode: data.errorCode, stixType: data.stixType },
          { $setOnInsert: data },
          { upsert: true, new: false, runValidators: true },
        )
        .lean()
        .exec();
      return { created: existing === null };
    } catch (err) {
      if (err.name === 'MongoServerError' && err.code === 11000) {
        // Concurrent upsert with the same key — the rule exists
        return { created: false };
      }
      throw new DatabaseError(err);
    }
  }

  async retrieveById(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return null;
    }

    try {
      return await this.model.findById(id).lean().exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async updateById(id, data) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return null;
    }

    const updateData = { ...data };
    delete updateData._id;
    delete updateData.__v;

    try {
      return await this.model
        .findByIdAndUpdate(id, { $set: updateData }, { new: true, runValidators: true })
        .lean()
        .exec();
    } catch (err) {
      if (err.name === 'MongoServerError' && err.code === 11000) {
        throw new DuplicateIdError({
          details:
            'A validation bypass rule with this fieldPath, errorCode, and stixType already exists.',
        });
      } else {
        throw new DatabaseError(err);
      }
    }
  }

  async deleteById(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return null;
    }

    try {
      return await this.model.findByIdAndDelete(id).exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async deleteAutoCreated() {
    try {
      return await this.model.deleteMany({ autoCreated: true }).exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async deleteByReason(reason) {
    try {
      return await this.model.deleteMany({ autoCreated: true, autoCreatedReason: reason }).exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async findAll() {
    try {
      return await this.model.find({}).lean().exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }
}

const policyRepository = require('./validation-policy-repository');
const { normalizeRule, selectorKey } = require('../lib/validation-policy-rules');
const { assertEngineContext } = require('../lib/validation-engine-context');
const { BadRequestError } = require('../exceptions');
const legacy = new ValidationBypassesRepository(ValidationBypassRule);

function withId(data, id) {
  const rule = normalizeRule(data);
  if (id) rule._id = new mongoose.Types.ObjectId(String(id));
  else rule._id = new mongoose.Types.ObjectId();
  return rule;
}

async function mutateOrLegacy(mutate, fallback) {
  const result = await policyRepository.mutateRules(mutate);
  return result ? result.value : fallback();
}

const facade = {
  model: ValidationBypassRule,
  async findAll() {
    const policy = await policyRepository.readPolicy();
    if (!policy) return legacy.findAll();
    assertEngineContext(policy.engine_context);
    return policy.rules;
  },
  async retrieveAll(options = {}) {
    const policy = await policyRepository.readPolicy();
    if (!policy) return legacy.retrieveAll(options);
    assertEngineContext(policy.engine_context);
    const sorted = policy.rules
      .slice()
      .sort((a, b) => (a.stixType || '').localeCompare(b.stixType || ''));
    const offset = options.offset || 0;
    const documents = options.limit
      ? sorted.slice(offset, offset + options.limit)
      : sorted.slice(offset);
    return [{ totalCount: [{ totalCount: sorted.length }], documents }];
  },
  async retrieveById(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    const normalizedId = new mongoose.Types.ObjectId(id).toHexString();
    return (await facade.findAll()).find((rule) => String(rule._id) === normalizedId) || null;
  },
  async save(data) {
    const rule = withId(data);
    return mutateOrLegacy(
      (rules) => ({ rules: [...rules, rule], value: rule }),
      () => {
        if (rule.kind === 'object-exemption')
          throw new BadRequestError({
            details: 'Initialize the canonical validation policy before creating exemptions.',
          });
        return legacy.save(rule);
      },
    );
  },
  async upsertRule(data) {
    const rule = withId(data);
    return mutateOrLegacy(
      (rules) => {
        if (rules.some((existing) => selectorKey(existing) === selectorKey(rule)))
          return { rules, value: { created: false } };
        return { rules: [...rules, rule], value: { created: true } };
      },
      () => legacy.upsertRule(rule),
    );
  },
  async updateById(id, data) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    const normalizedId = new mongoose.Types.ObjectId(id).toHexString();
    const validated = normalizeRule(data);
    return mutateOrLegacy(
      (rules) => {
        const current = rules.find((rule) => String(rule._id) === normalizedId);
        if (!current) return { rules, value: null };
        // Preserve legacy PATCH-like optional field behavior within a rule kind.
        const sameKind = (current.kind || 'error-bypass') === (validated.kind || 'error-bypass');
        const updated = withId(sameKind ? { ...current, ...data } : data, normalizedId);
        return { rules: rules.map((rule) => (rule === current ? updated : rule)), value: updated };
      },
      // Validation above must not turn omitted options into legacy $set defaults.
      () => legacy.updateById(normalizedId, data),
    );
  },
  async deleteById(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    const normalizedId = new mongoose.Types.ObjectId(id).toHexString();
    return mutateOrLegacy(
      (rules) => ({
        rules: rules.filter((rule) => String(rule._id) !== normalizedId),
        value: rules.find((rule) => String(rule._id) === normalizedId) || null,
      }),
      () => legacy.deleteById(normalizedId),
    );
  },
  async deleteAutoCreated() {
    return mutateOrLegacy(
      (rules) => ({
        rules: rules.filter((rule) => !rule.autoCreated),
        value: { deletedCount: rules.filter((rule) => rule.autoCreated).length },
      }),
      () => legacy.deleteAutoCreated(),
    );
  },
  async deleteByReason(reason) {
    return facade.replaceGeneratedGroup(reason, []);
  },
  async replaceGeneratedGroup(reason, data) {
    const replacements = data.map((rule) =>
      withId({ ...rule, autoCreated: true, autoCreatedReason: reason }),
    );
    return mutateOrLegacy(
      (rules) => {
        const old = rules.filter((rule) => rule.autoCreated && rule.autoCreatedReason === reason);
        const retained = rules.filter((rule) => !old.includes(rule));
        const desired = replacements
          .map((rule) => {
            const previous = old.find((item) => selectorKey(item) === selectorKey(rule));
            return previous
              ? {
                  ...rule,
                  _id: previous._id,
                  ...(previous.__v === undefined ? {} : { __v: previous.__v }),
                }
              : rule;
          })
          .filter((rule) => !retained.some((item) => selectorKey(item) === selectorKey(rule)));
        return {
          rules: [
            ...rules.flatMap((rule) => {
              if (!old.includes(rule)) return [rule];
              const replacement = desired.find((item) => String(item._id) === String(rule._id));
              return replacement ? [replacement] : [];
            }),
            ...desired.filter((rule) => !old.some((item) => String(item._id) === String(rule._id))),
          ],
          value: {
            deletedCount: old.length,
            created: desired.filter(
              (rule) => !old.some((item) => String(item._id) === String(rule._id)),
            ).length,
          },
        };
      },
      async () => {
        const removed = await legacy.deleteByReason(reason);
        let created = 0;
        for (const rule of replacements) if ((await legacy.upsertRule(rule)).created) created++;
        return { ...removed, created };
      },
    );
  },
};

module.exports = facade;
