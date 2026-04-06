'use strict';

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

  async retrieveById(id) {
    try {
      return await this.model.findById(id).lean().exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async deleteById(id) {
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

  async findAll() {
    try {
      return await this.model.find({}).lean().exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }
}

module.exports = new ValidationBypassesRepository(ValidationBypassRule);
