'use strict';

const mongoose = require('mongoose');
const AllowedValuesConfiguration = require('../models/allowed-values-configuration-model');
const {
  DatabaseError,
  SystemConfigurationNotFound,
  DuplicateIdError,
  NotFoundError,
} = require('../exceptions');

const configurationId = 'allowed-values';

class AllowedValuesRepository {
  constructor(model) {
    this.model = model;
  }

  async initialize(values, rules) {
    try {
      await this.model.updateOne(
        { _id: configurationId },
        { $setOnInsert: { values, rules } },
        { upsert: true, runValidators: true },
      );
    } catch (err) {
      // The built-in _id index arbitrates concurrent first-time initialization.
      if (err.code !== 11000) throw new DatabaseError(err);
    }
  }

  async migrateRules(seededRules) {
    try {
      // Derive keys from the current persisted rows inside MongoDB. The predicate
      // makes the upgrade idempotent without resurrecting deleted options.
      await this.model.updateOne({ _id: configurationId, rules: { $exists: false } }, [
        {
          $set: {
            rules: {
              $setUnion: [
                { $literal: seededRules },
                {
                  $map: {
                    input: '$values',
                    as: 'row',
                    in: { propertyName: '$$row.propertyName', domainName: '$$row.domainName' },
                  },
                },
              ],
            },
          },
        },
      ]);
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async retrieveConfiguration({ optional = false } = {}) {
    let document;
    try {
      document = await this.model.findById(configurationId).lean().exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
    if (!document && !optional) throw new SystemConfigurationNotFound();
    return document;
  }

  async saveRule(propertyName, domainName, rows, { create = false } = {}) {
    const rule = { propertyName, domainName };
    const values = rows.map((row) => ({ _id: new mongoose.Types.ObjectId(), ...row }));
    let document;
    try {
      // Both membership and replacement are evaluated against the current
      // document, preserving different-group saves and arbitrating creation.
      document = await this.model
        .findOneAndUpdate(
          {
            _id: configurationId,
            rules: create ? { $not: { $elemMatch: rule } } : { $elemMatch: rule },
          },
          [
            {
              $set: {
                ...(create ? { rules: { $concatArrays: ['$rules', { $literal: [rule] }] } } : {}),
                values: {
                  $concatArrays: [
                    {
                      $filter: {
                        input: '$values',
                        as: 'row',
                        cond: {
                          $not: [
                            {
                              $and: [
                                { $eq: ['$$row.propertyName', { $literal: propertyName }] },
                                { $eq: ['$$row.domainName', { $literal: domainName }] },
                              ],
                            },
                          ],
                        },
                      },
                    },
                    { $literal: values },
                  ],
                },
              },
            },
          ],
          { new: true },
        )
        .lean()
        .exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
    if (!document) {
      if (create)
        throw new DuplicateIdError({ details: 'This allowed-values rule already exists.' });
      throw new NotFoundError({ details: 'This allowed-values rule has not been configured.' });
    }
    return document;
  }
}

module.exports = new AllowedValuesRepository(AllowedValuesConfiguration);
