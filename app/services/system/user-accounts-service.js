'use strict';

const uuid = require('uuid');
const logger = require('../../lib/logger');
const teamsRepository = require('../../repository/teams-repository');
const userAccountsRepository = require('../../repository/user-accounts-repository');
const Exceptions = require('../../exceptions');

class UserAccountsService {
  constructor(type, repository) {
    this.type = type;
    this.repository = repository;
  }

  static addEffectiveRole(userAccount) {
    // Initially, this forces all pending and inactive accounts to have the role 'none'.
    // TBD: Make the role configurable
    if (userAccount?.status === 'pending' || userAccount?.status === 'inactive') {
      userAccount.role = 'none';
    }
  }

  static userAccountAsIdentity(userAccount) {
    return {
      type: 'identity',
      spec_version: '2.1',
      id: userAccount.id,
      created: userAccount.created,
      modified: userAccount.modified,
      name: userAccount.displayName,
      identity_class: 'individual',
    };
  }

  async retrieveAll(options) {
    const results = await this.repository.retrieveAll(options);

    const userAccounts = results[0].documents;
    userAccounts.forEach((userAccount) => {
      UserAccountsService.addEffectiveRole(userAccount);
      if (options.includeStixIdentity) {
        userAccount.identity = UserAccountsService.userAccountAsIdentity(userAccount);
      }
    });

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
        data: userAccounts,
      };
      return paginatedResults;
    } else {
      return userAccounts;
    }
  }

  async retrieveById(userAccountId, options) {
    try {
      if (!userAccountId) {
        throw new Exceptions.MissingParameterError('userAccountId');
      }

      const userAccount = await this.repository.retrieveOneById(userAccountId);
      if (!userAccount) {
        return null; // Document not found
      }

      UserAccountsService.addEffectiveRole(userAccount);

      if (options.includeStixIdentity) {
        userAccount.identity = UserAccountsService.userAccountAsIdentity(userAccount);
      }

      return userAccount;
    } catch (err) {
      if (err.name === 'CastError') {
        throw new Exceptions.BadlyFormattedParameterError('userId');
      } else {
        throw err;
      }
    }
  }

  async retrieveByEmail(email) {
    if (!email) {
      throw new Exceptions.MissingParameterError('email');
    }

    try {
      const userAccount = await this.repository.retrieveOneByEmail(email);
      UserAccountsService.addEffectiveRole(userAccount);

      return userAccount;
    } catch (err) {
      if (err.name === 'CastError') {
        throw new Exceptions.BadlyFormattedParameterError('email');
      } else {
        throw err;
      }
    }
  }

  async create(data) {
    // Check for a duplicate email
    if (data.email) {
      // Note: We could try to insert the new document without this check and allow Mongoose to throw a duplicate
      // index error. But the Error that's thrown doesn't allow us to distinguish between a duplicate id (which is
      // unexpected and may indicate a deeper problem) and a duplicate email (which is likely a client error).
      // So we perform this check here to catch the duplicate email and then treat the duplicate index as a server
      // error if it occurs.
      const userAccount = await this.repository.retrieveOneByEmail(data.email);
      if (userAccount) {
        throw new Exceptions.DuplicateIdError();
      }
    }

    // Create the document
    const userAccount = await this.repository.createNewDocument(data);

    // Create a unique id for this user
    // This should usually be undefined. It will only be defined when migrating user accounts from another system.
    if (!userAccount.id) {
      userAccount.id = `identity--${uuid.v4()}`;
    }

    // Add a timestamp recording when the user account was first created
    // This should usually be undefined. It will only be defined when migrating user accounts from another system.
    if (!userAccount.created) {
      userAccount.created = new Date().toISOString();
    }

    // Add a timestamp recording when the user account was last modified
    if (!userAccount.modified) {
      userAccount.modified = userAccount.created;
    }

    // Save the document in the database
    try {
      const savedUserAccount = await this.repository.saveDocument(userAccount);
      UserAccountsService.addEffectiveRole(savedUserAccount);

      return savedUserAccount;
    } catch (err) {
      if (err.name === 'MongoServerError' && err.code === 11000) {
        throw new Exceptions.DuplicateIdError();
      } else {
        throw err;
      }
    }
  }

  async updateFull(userAccountId, data) {
    if (!userAccountId) {
      throw new Exceptions.MissingParameterError('userAccountId');
    }

    return await this.repository.updateById(userAccountId, data);
  }

  async delete(userAccountId) {
    if (!userAccountId) {
      throw new Exceptions.MissingParameterError('userAccountId');
    }

    const userAccount = await this.repository.findOneAndDelete(userAccountId);
    return userAccount;
  }

  async getLatest(userAccountId) {
    const userAccount = await this.repository.retrieveOneById(userAccountId);
    UserAccountsService.addEffectiveRole(userAccount);

    return userAccount;
  }

  async addCreatedByUserAccount(attackObject) {
    if (attackObject?.workspace?.workflow?.created_by_user_account) {
      try {
        attackObject.created_by_user_account = await this.getLatest(
          attackObject.workspace.workflow.created_by_user_account,
        );
      } catch (err) {
        // Ignore lookup errors
        logger.warn(err.message);
      }
    }
  }

  async addCreatedByUserAccountToAll(attackObjects) {
    for (const attackObject of attackObjects) {
      await this.addCreatedByUserAccount(attackObject);
    }
  }

  static async retrieveTeamsByUserId(userAccountId, options) {
    if (!userAccountId) {
      throw new Exceptions.MissingParameterError('userAccountId');
    }

    const results = await teamsRepository.retrieveByUserId(userAccountId, options);
    const teams = results[0].documents;

    if (options.includePagination) {
      let derivedTotalCount = 0;

      if (results[0].totalCount.length > 0) {
        derivedTotalCount = results[0].totalCount[0].totalCount;
      }

      const returnValue = {
        pagination: {
          total: derivedTotalCount,
          offset: options.offset,
          limit: options.limit,
        },
        data: teams,
      };

      return returnValue;
    } else {
      return teams;
    }
  }
}

module.exports = new UserAccountsService(null, userAccountsRepository);
