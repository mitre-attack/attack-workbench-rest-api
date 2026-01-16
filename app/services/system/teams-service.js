'use strict';

const regexValidator = require('../../lib/regex');
const UserAccount = require('../../models/user-account-model');
const userAccountsService = require('./user-accounts-service');
const {
  MissingParameterError,
  BadlyFormattedParameterError,
  NotFoundError,
  DuplicateIdError,
} = require('../../exceptions');
const teamsRepository = require('../../repository/teams-repository');
const uuid = require('uuid');

class TeamsService {
  constructor(type, repository) {
    this.type = type;
    this.repository = repository;
  }

  async retrieveAll(options) {
    const results = await this.repository.retrieveAll(options);

    const teams = results[0].documents;

    if (options.includePagination) {
      let derivedTotalCount = 0;
      if (results[0].totalCount.length > 0) {
        derivedTotalCount = results[0].totalCount[0].totalCount;
      }
      const paginatedResults = {
        pagination: {
          total: derivedTotalCount,
          offset: options.offset,
          limit: options.limit,
        },
        data: teams,
      };
      return paginatedResults;
    } else {
      return teams;
    }
  }

  async retrieveById(teamId) {
    return await this.repository.retrieveById(teamId);
  }

  async create(data) {
    // Create the document
    const team = await this.repository.createNewDocument(data);

    // Create a unique id for this user
    // This should usually be undefined. It will only be defined when migrating teams from another system.
    if (!team.id) {
      team.id = `identity--${uuid.v4()}`;
    }

    // Add a timestamp recording when the team was first created
    // This should usually be undefined. It will only be defined when migrating teams from another system.
    if (!team.created) {
      team.created = new Date().toISOString();
    }

    // Add a timestamp recording when the team was last modified
    if (!team.modified) {
      team.modified = team.created;
    }

    // Save the document in the database
    try {
      return await this.repository.constructor.saveDocument(team);
    } catch (err) {
      if (err.name === 'MongoServerError' && err.code === 11000) {
        throw new DuplicateIdError();
      } else {
        throw err;
      }
    }
  }

  async updateFull(teamId, data) {
    return await this.repository.updateFull(teamId, data);
  }

  async delete(teamId) {
    if (!teamId) {
      throw new MissingParameterError('teamId');
    }

    const team = await this.repository.model.findOneAndDelete({ id: teamId });
    //Note: userAccount is null if not found
    return team;
  }

  async retrieveAllUsers(teamId, options) {
    if (!teamId) {
      throw new MissingParameterError('teamId');
    }

    try {
      const team = await this.repository.model.findOne({ id: teamId }).lean().exec();
      if (!team) {
        throw new NotFoundError();
      }
      const matchQuery = { id: { $in: team.userIDs } };
      const aggregation = [{ $sort: { username: 1 } }, { $match: matchQuery }];
      if (typeof options.search !== 'undefined') {
        options.search = regexValidator.sanitizeRegex(options.search);
        const match = {
          $match: {
            $or: [
              { username: { $regex: options.search, $options: 'i' } },
              { email: { $regex: options.search, $options: 'i' } },
              { displayName: { $regex: options.search, $options: 'i' } },
            ],
          },
        };
        aggregation.push(match);
      }
      // Get the total count of documents, pre-limit
      const totalCount = await UserAccount.aggregate(aggregation).count('totalCount').exec();

      if (options.offset) {
        aggregation.push({ $skip: options.offset });
      } else {
        aggregation.push({ $skip: 0 });
      }

      if (options.limit) {
        aggregation.push({ $limit: options.limit });
      }

      // Retrieve the documents
      const documents = await UserAccount.aggregate(aggregation).exec();

      const results = [
        {
          totalCount: [{ totalCount: totalCount[0]?.totalCount || 0 }],
          documents: documents,
        },
      ];

      try {
        const userAccounts = results[0].documents;
        userAccounts.forEach((userAccount) => {
          userAccountsService.constructor.addEffectiveRole(userAccount);
          if (options.includeStixIdentity) {
            userAccount.identity =
              userAccountsService.constructor.userAccountAsIdentity(userAccount);
          }
        });

        if (options.includePagination) {
          const returnValue = {
            pagination: {
              total: results[0].totalCount[0].totalCount,
              offset: options.offset,
              limit: options.limit,
            },
            data: userAccounts,
          };
          return returnValue;
        } else {
          return userAccounts;
        }
      } catch (err) {
        if (err.name === 'CastError') {
          throw new BadlyFormattedParameterError('teamId');
        } else {
          throw err;
        }
      }
    } catch (err) {
      if (err.name === 'CastError') {
        throw new BadlyFormattedParameterError('teamId');
      } else {
        throw err;
      }
    }
  }
}

module.exports = new TeamsService(null, teamsRepository);
