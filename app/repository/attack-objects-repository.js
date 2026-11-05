'use strict';

const BaseRepository = require('./_base.repository');
const AttackObject = require('../models/attack-object-model');
const { lastUpdatedByQueryHelper } = require('../lib/request-parameter-helper');
const {
  MissingParameterError,
  BadlyFormattedParameterError,
  DuplicateIdError,
  DatabaseError,
} = require('../exceptions');
const regexValidator = require('../lib/regex');

class AttackObjectsRepository extends BaseRepository {
  async retrieveLatestGraphObjects() {
    return this.model
      .aggregate([
        { $sort: { 'stix.id': 1, 'stix.modified': -1 } },
        { $group: { _id: '$stix.id', document: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$document' } },
        { $project: { _id: 0, __v: 0, __t: 0 } },
      ])
      .exec();
  }

  /**
   * Classify latest SDO revisions using membership recorded on any stored revision.
   * Keep bounded grouping state; look up only the last enrollment and later count.
   */
  async retrieveReleaseTrackCoverage(types) {
    const aggregation = [
      { $match: { 'stix.type': { $in: types } } },
      { $sort: { 'stix.id': 1, 'stix.modified': -1 } },
      {
        $project: {
          _id: 0,
          'stix.id': 1,
          'stix.type': 1,
          'stix.name': 1,
          'stix.created': 1,
          'stix.x_mitre_version': 1,
          'stix.modified': 1,
          'workspace.attack_id': 1,
          membershipMissing: { $eq: [{ $type: '$workspace.release_tracks' }, 'missing'] },
          hasMembership: {
            $cond: [
              { $isArray: '$workspace.release_tracks' },
              { $gt: [{ $size: '$workspace.release_tracks' }, 0] },
              false,
            ],
          },
        },
      },
      {
        $group: {
          _id: '$stix.id',
          latest: { $first: '$$ROOT' },
          lastEnrolledModified: {
            $max: { $cond: ['$hasMembership', '$stix.modified', null] },
          },
        },
      },
      {
        $match: {
          $or: [{ lastEnrolledModified: null }, { 'latest.membershipMissing': true }],
        },
      },
      { $sort: { _id: 1 } },
      {
        $lookup: {
          from: this.model.collection.name,
          let: { objectId: '$_id', enrolledModified: '$lastEnrolledModified' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $ne: ['$$enrolledModified', null] },
                    { $eq: ['$stix.id', '$$objectId'] },
                    { $gte: ['$stix.modified', '$$enrolledModified'] },
                  ],
                },
              },
            },
            // The compound ID/modified index also supports this reverse scan.
            { $sort: { 'stix.modified': 1 } },
            {
              $project: {
                _id: 0,
                modified: '$stix.modified',
                x_mitre_version: '$stix.x_mitre_version',
                release_tracks: {
                  $map: {
                    input: {
                      $cond: [
                        { $eq: ['$stix.modified', '$$enrolledModified'] },
                        '$workspace.release_tracks',
                        [],
                      ],
                    },
                    as: 'track',
                    in: {
                      id: '$$track.id',
                      type: '$$track.type',
                      tier: '$$track.tier',
                      status: '$$track.status',
                    },
                  },
                },
              },
            },
            {
              $group: {
                _id: null,
                last_enrolled_revision: { $first: '$$ROOT' },
                // No revision after the maximum enrolled date has membership.
                unenrolled_revision_count: {
                  $sum: { $cond: [{ $gt: ['$modified', '$$enrolledModified'] }, 1, 0] },
                },
              },
            },
            { $project: { _id: 0 } },
          ],
          as: 'enrollment',
        },
      },
      {
        $project: {
          _id: 0,
          stix: '$latest.stix',
          workspace: { $ifNull: ['$latest.workspace', {}] },
          enrollment: { $arrayElemAt: ['$enrollment', 0] },
        },
      },
    ];

    const cursor = this.model.aggregate(aggregation).allowDiskUse(true).cursor({ batchSize: 100 });
    const results = { untracked_latest_revisions: [], never_enrolled_objects: [] };
    try {
      for await (const { stix, workspace, enrollment } of cursor) {
        if (enrollment) {
          results.untracked_latest_revisions.push({ stix, workspace, ...enrollment });
        } else {
          results.never_enrolled_objects.push({ stix, workspace });
        }
      }
    } finally {
      await cursor.close();
    }
    return results;
  }

  async retrieveAll(options) {
    // Build the query
    const query = {};
    if (typeof options.attackId !== 'undefined') {
      if (Array.isArray(options.attackId)) {
        query['workspace.attack_id'] = { $in: options.attackId };
      } else {
        query['workspace.attack_id'] = options.attackId;
      }
    }
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

    if (typeof options.lastUpdatedBy !== 'undefined') {
      query['workspace.workflow.created_by_user_account'] = lastUpdatedByQueryHelper(
        options.lastUpdatedBy,
      );
    }

    // Build the aggregation
    const aggregation = [];
    if (options.versions === 'latest') {
      // - Group the documents by stix.id, sorted by stix.modified
      // - Use the first document in each group (according to the value of stix.modified)
      aggregation.push({ $sort: { 'stix.id': 1, 'stix.modified': -1 } });
      aggregation.push({ $group: { _id: '$stix.id', document: { $first: '$$ROOT' } } });
      aggregation.push({ $replaceRoot: { newRoot: '$document' } });
    }

    // - Then apply query, skip and limit options
    aggregation.push({ $sort: { 'stix.id': 1 } });
    aggregation.push({ $match: query });

    if (typeof options.search !== 'undefined') {
      options.search = regexValidator.sanitizeRegex(options.search);
      const match = {
        $match: {
          $or: [
            { 'workspace.attack_id': { $regex: options.search, $options: 'i' } },
            { 'stix.name': { $regex: options.search, $options: 'i' } },
            { 'stix.description': { $regex: options.search, $options: 'i' } },
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
  }

  async retrieveAllWithAttackURLInDescription() {
    const aggregation = [
      { $sort: { 'stix.id': 1, 'stix.modified': -1 } },
      { $group: { _id: '$stix.id', document: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$document' } },
      { $sort: { 'stix.id': 1 } },
      {
        $match: {
          'stix.revoked': { $in: [null, false] },
          'stix.x_mitre_deprecated': { $in: [null, false] },
          'stix.description': { $regex: 'attack.mitre.org', $options: 'i' },
        },
      },
    ];

    const documents = await this.model.aggregate(aggregation).exec();

    return documents;
  }

  // A lean variant of BaseService.retrieveOneByVersion
  // TODO merge the two methods by supporting method argument 'lean=false' that toggles .lean() on/off
  async retrieveOneByVersionLean(stixId, modified) {
    try {
      return await this.model
        .findOne({ 'stix.id': stixId, 'stix.modified': modified })
        .lean()
        .exec();
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
   * Retrieve all latest versions of objects whose created_by_ref or x_mitre_modified_by_ref
   * matches any of the provided identity refs. Used for organization identity propagation.
   * @param {string[]} identityRefs - Array of identity STIX IDs (the provenance chain)
   * @returns {Promise<Object[]>} Array of plain objects (latest version per stix.id)
   */
  async retrieveAllLatestByOrgIdentityRefs(identityRefs) {
    try {
      const aggregation = [
        { $sort: { 'stix.id': 1, 'stix.modified': -1 } },
        { $group: { _id: '$stix.id', document: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$document' } },
        {
          $match: {
            $or: [
              { 'stix.created_by_ref': { $in: identityRefs } },
              { 'stix.x_mitre_modified_by_ref': { $in: identityRefs } },
            ],
          },
        },
      ];
      return await this.model.aggregate(aggregation).exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  /**
   * Retrieve latest, active objects whose created_by_ref or x_mitre_modified_by_ref matches
   * the provided identity ref.
   * @param {string} identityRef - Identity STIX ID
   * @returns {Promise<Object[]>} Array of matching latest active objects
   */
  async retrieveAllLatestActiveByIdentityRef(identityRef) {
    try {
      const aggregation = [
        { $sort: { 'stix.id': 1, 'stix.modified': -1 } },
        { $group: { _id: '$stix.id', document: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$document' } },
        {
          $match: {
            'stix.revoked': { $in: [null, false] },
            'stix.x_mitre_deprecated': { $in: [null, false] },
            $or: [
              { 'stix.created_by_ref': identityRef },
              { 'stix.x_mitre_modified_by_ref': identityRef },
            ],
          },
        },
        { $project: { _id: 0, __v: 0, __t: 0 } },
      ];
      return await this.model.aggregate(aggregation).exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async findByIdAndDelete(documentId) {
    try {
      return await this.model.findByIdAndDelete(documentId).exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }

  async findByIdAndUpdate(documentId, update) {
    try {
      if (!update) {
        throw new MissingParameterError('update');
      }
      return await this.model.findByIdAndUpdate(documentId, update).exec();
    } catch (err) {
      throw new DatabaseError(err);
    }
  }
}

module.exports = new AttackObjectsRepository(AttackObject);
