'use strict';

const AnonymousUuidStrategy = require('passport-anonym-uuid');

const systemConfigurationService = require('../services/system/system-configuration-service');

let strategyName;
exports.strategyName = function () {
  return strategyName;
};

/**
 * This function takes the user session object and returns the value (the userSessionKey) that will be
 * stored in the express session for this user
 */
exports.serializeUser = function (userSession, done) {
  if (userSession.strategy === 'anonymId') {
    const userSessionKey = {
      strategy: 'anonymId',
      sessionId: userSession.anonymousUuid,
    };

    done(null, userSessionKey);
  } else {
    // Try the next serializer
    done('pass');
  }
};

/**
 * This function takes the userSessionKey (the value stored in the express session for this user) and
 * returns the user session object
 */
exports.deserializeUser = function (userSessionKey, done) {
  if (userSessionKey.strategy === 'anonymId') {
    makeUserSession(userSessionKey.sessionId)
      .then((userSession) => done(null, userSession))
      .catch((err) => done(err));
  } else {
    // Try the next deserializer
    done('pass');
  }
};

exports.getStrategy = function () {
  const strategy = new AnonymousUuidStrategy(verifyCallback);
  strategyName = strategy.name;

  return strategy;
};

/**
 * This function is called by the strategy after the user has authenticated using the anonymous strategy
 * It creates and returns the user session for this user
 */
function verifyCallback(req, uuid, done) {
  // The anonymous strategy creates a new uuid for each login
  makeUserSession(uuid)
    .then((userSession) => done(null, userSession))
    .catch((err) => done(err));
}

async function makeUserSession(uuid) {
  const anonymousUserAccount = await systemConfigurationService.retrieveAnonymousUserAccount();

  const userAccountData = (({ email, name, status, role }) => ({ email, name, status, role }))(
    anonymousUserAccount,
  );
  const userSession = {
    strategy: 'anonymId',
    userAccountId: anonymousUserAccount.id,
    ...userAccountData,
    registered: true,
    anonymousUuid: uuid,
  };

  return userSession;
}
