'use strict';

const AbstractRepository = require('./_abstract.repository');
const _ = require('lodash');
const regexValidator = require('../lib/regex');
const { lastUpdatedByQueryHelper } = require('../lib/request-parameter-helper');
const {
  DatabaseError,
  DuplicateIdError,
  BadlyFormattedParameterError,
  MissingParameterError,
} = require('../exceptions');

const logger = require('../lib/logger');

class BaseRepository extends AbstractRepository {
  constructor(model) {
    super();
    this.model = model;
  }

  async retrieveAll(options) {
    try {
      // Build the query
      const query = {};

      // Build the query
      if (!options.includeRevoked) {
        query['stix.revoked'] = { $in: [null, false] };
      }
      if (!options.includeDeprecated) {
        query['stix.x_mitre_deprecated'] = { $in: [null, false] };
      }
      if (typeof options.state !== 'undefined') {
        if (Array.isArray(options.state)) {
          query['workspace.workflow.state'] = { $in: options.state };
        } else {
          query['workspace.workflow.state'] = options.state;
        }
      }
      if (typeof options.domain !== 'undefined') {
        if (Array.isArray(options.domain)) {
          query['stix.x_mitre_domains'] = { $in: options.domain };
        } else {
          query['stix.x_mitre_domains'] = options.domain;
        }
      }
      if (typeof options.platform !== 'undefined') {
        if (Array.isArray(options.platform)) {
          query['stix.x_mitre_platforms'] = { $in: options.platform };
        } else {
          query['stix.x_mitre_platforms'] = options.platform;
        }
      }
      if (typeof options.lastUpdatedBy !== 'undefined') {
        query['workspace.workflow.created_by_user_account'] = lastUpdatedByQueryHelper(
          options.lastUpdatedBy,
        );
      }

      // Build the aggregation
      // - Group the documents by stix.id, sorted by stix.modified
      // - Use the first document in each group (according to the value of stix.modified)
      // - Then apply query, skip and limit options
      const aggregation = [
        { $sort: { 'stix.id': 1, 'stix.modified': -1 } },
        { $group: { _id: '$stix.id', document: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$document' } },
        { $sort: { 'stix.id': 1 } },
        { $match: query },
      ];

      if (typeof options.search !== 'undefined') {
        options.search = regexValidator.sanitizeRegex(options.search);
        const match = {
          $match: {
            $or: [
              { 'stix.name': { $regex: options.search, $options: 'i' } },
              { 'stix.description': { $regex: options.search, $options: 'i' } },
              { 'workspace.attack_id': { $regex: options.search, $options: 'i' } },
            ],
          },
        };
        aggregation.push(match);
      }

      // Get the total count of documents, pre-limit
      const totalCount = await this.model.aggregate(aggregation).count('totalCount').exec();

      if (options.offset) {
        aggregation.push({ $skip: options.offset });
      } else {
        aggregation.push({ $skip: 0 });
      }

      if (options.limit) {
        aggregation.push({ $limit: options.limit });
      }

      // Retrieve the documents
      const documents = await this.model.aggregate(aggregation).exec();

      // Return data in the format previously given by $facet
      return [
        {
          totalCount: [{ totalCount: totalCount[0]?.totalCount || 0 }],
          documents: documents,
        },
      ];
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  // New specialized method for STIX bundle generation
  async retrieveAllByDomain(domain, options) {
    if (!domain) {
      throw new MissingParameterError('domain');
    }

    try {
      // This is critical because the bundle export functionality requires precise filtering
      const query = {
        'stix.x_mitre_domains': domain, // Domain filtering is mandatory here
      };

      // Bundle export requires these to be specifically filtered as null or false
      // while the generic method just applies the filter if the option is set
      if (!options.includeRevoked) {
        query['stix.revoked'] = { $in: [null, false] };
      }
      if (!options.includeDeprecated) {
        query['stix.x_mitre_deprecated'] = { $in: [null, false] };
      }

      if (typeof options.state !== 'undefined') {
        query['workspace.workflow.state'] = Array.isArray(options.state)
          ? { $in: options.state }
          : options.state;
      }

      // Order of operations is critical here for correct bundle generation
      const aggregation = [
        // Sort by STIX ID and modified date first
        { $sort: { 'stix.id': 1, 'stix.modified': -1 } },
        // Group to get latest version of each object
        { $group: { _id: '$stix.id', document: { $first: '$$ROOT' } } },
        // Replace root to flatten the document
        { $replaceRoot: { newRoot: '$document' } },
        // Final sort by STIX ID
        { $sort: { 'stix.id': 1 } },
        // Apply our domain-specific query
        { $match: query },
      ];

      // Bundle export needs ALL matching documents, not a paginated subset
      const documents = await this.model.aggregate(aggregation).exec();

      // No pagination metadata needed, just the raw documents
      return documents;
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async retrieveOneById(stixId) {
    try {
      return await this.model.findOne({ 'stix.id': stixId }).exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async retrieveLatestByStixId(stixId) {
    try {
      return await this.model.findOne({ 'stix.id': stixId }).sort('-stix.modified').exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async retrieveAllById(stixId) {
    try {
      return await this.model.find({ 'stix.id': stixId }).sort('-stix.modified').lean().exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async retrieveLatestByStixIdLean(stixId) {
    try {
      return await this.model.findOne({ 'stix.id': stixId }).sort('-stix.modified').lean().exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async retrieveOneByVersion(stixId, modified) {
    try {
      return await this.model.findOne({ 'stix.id': stixId, 'stix.modified': modified }).exec();
    } catch (err) {
      if (err.name === 'CastError') {
        throw new BadlyFormattedParameterError({ parameterName: 'stixId' });
      } else if (err.name === 'MongoServerError' && err.code === 11000) {
        throw new DuplicateIdError();
      }
      throw new DatabaseError(err);
    }
  }

  /**
   * Stream documents by their STIX ID and modified timestamp pairs
   * @param {Array<{object_ref: string, object_modified: string}>} xMitreContents - Array of x_mitre_contents elements
   * @yields {Object} Individual documents as they're retrieved
   * @throws {BadlyFormattedParameterError} If stixId format is invalid
   * @throws {DatabaseError} For other database errors
   */
  async *streamManyByIdAndModified(xMitreContents) {
    const BATCH_SIZE = 500; // Smaller batches for streaming

    for (let i = 0; i < xMitreContents.length; i += BATCH_SIZE) {
      const batch = xMitreContents.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(xMitreContents.length / BATCH_SIZE);

      logger.debug(`[STREAM] Processing batch ${batchNum}/${totalBatches}`);

      // Stream documents from this batch
      yield* this._streamBatch(batch);
    }
  }

  async *_streamBatch(xMitreContents) {
    const startTime = Date.now();

    try {
      const conditions = xMitreContents.map(({ object_ref, object_modified }) => ({
        'stix.id': object_ref,
        'stix.modified': object_modified,
      }));

      // Use cursor for true streaming
      const cursor = this.model.find({ $or: conditions }).lean().cursor();

      let count = 0;
      for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
        yield doc;
        count++;
      }

      const queryTime = Date.now() - startTime;
      logger.debug(`[STREAM] Batch streamed ${count} documents in ${queryTime}ms`);
    } catch (err) {
      logger.error(err);
      if (err.name === 'CastError') {
        throw new BadlyFormattedParameterError({ parameterName: 'stixId' });
      }
      throw new DatabaseError(err);
    }
  }

  /**
   * Retrieve multiple documents by their STIX ID and modified timestamp pairs
   * @param {Array<{stixId: string, object_modified: string}>} xMitreContents - Array of STIX ID and modified timestamp pairs
   * @returns {Promise<Array<Object>>} Array of matching documents
   * @throws {BadlyFormattedParameterError} If stixId format is invalid
   * @throws {DatabaseError} For other database errors
   */
  async findManyByIdAndModified(xMitreContents) {
    const BATCH_SIZE = 1000; // Tune based on testing

    // 1000 --> 5.71s
    // 2000 --> 5.43s
    // 5000 --> 5.84s

    if (xMitreContents.length <= BATCH_SIZE) {
      return this._retrieveBatch(xMitreContents);
    }

    // Process in batches SEQUENTIALLY to control memory usage
    const results = [];
    const totalBatches = Math.ceil(xMitreContents.length / BATCH_SIZE);

    logger.debug(`[PROFILE] Processing ${xMitreContents.length} items in ${totalBatches} batches`);

    for (let i = 0; i < xMitreContents.length; i += BATCH_SIZE) {
      const batch = xMitreContents.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;

      logger.debug(`[PROFILE] Processing batch ${batchNum}/${totalBatches}`);
      const batchResults = await this._retrieveBatch(batch);
      results.push(...batchResults);

      // Force garbage collection hint between batches
      if (global.gc) {
        global.gc();
      }
    }

    return results;
  }

  async _retrieveBatch(xMitreContents) {
    const startTime = Date.now();

    try {
      const conditions = xMitreContents.map(({ object_ref, object_modified }) => ({
        'stix.id': object_ref,
        'stix.modified': object_modified,
      }));

      const documents = await this.model.find({ $or: conditions }).lean().exec();

      const queryTime = Date.now() - startTime;
      logger.debug(
        `[PROFILE] Batch query completed in ${queryTime}ms for ${xMitreContents.length} items, returned ${documents.length} documents`,
      );

      return documents;
    } catch (err) {
      logger.error(err);
      if (err.name === 'CastError') {
        throw new BadlyFormattedParameterError({ parameterName: 'stixId' });
      }
      throw new DatabaseError(err);
    }
  }

  createNewDocument(data) {
    return new this.model(data);
  }

  async saveDocument(document) {
    try {
      return await document.save();
    } catch (err) {
      if (err.name === 'MongoServerError' && err.code === 11000) {
        throw new DuplicateIdError({
          details: `Document with id '${document.stix.id}' already exists.`,
        });
      }
      throw new DatabaseError(err);
    }
  }

  async save(data) {
    try {
      const document = new this.model(data);
      return await document.save();
    } catch (err) {
      logger.error(`A database error occurred: ${err.message}`);
      if (err.name === 'MongoServerError' && err.code === 11000) {
        throw new DuplicateIdError({
          details: `Document with id '${data.stix.id}' already exists.`,
        });
      }
      throw new DatabaseError(err);
    }
  }

  async updateAndSave(document, data) {
    try {
      // TODO validate that document is valid mongoose object first
      _.merge(document, data);
      return await document.save();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async findOneAndDelete(stixId, modified) {
    try {
      return await this.model
        .findOneAndDelete({ 'stix.id': stixId, 'stix.modified': modified })
        .exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async deleteMany(stixId) {
    try {
      return await this.model.deleteMany({ 'stix.id': stixId }).exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }
}

module.exports = BaseRepository;
