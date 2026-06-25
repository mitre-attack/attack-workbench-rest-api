'use strict';

const openIdClient = require('openid-client');
const retry = require('async-await-retry');

const config = require('../config/config');
const userAccountsService = require('../services/system/user-accounts-service');

let strategyName;
exports.strategyName = function () {
  return strategyName;
};

/**
 * This function takes the user session object and returns the value (the userSessionKey) that will be
 * stored in the express session for this user
 */
exports.serializeUser = function (userSession, done) {
  if (userSession.strategy === 'oidc') {
    const userSessionKey = {
      strategy: 'oidc',
      sessionId: userSession.email,
      username: userSession.name,
      displayName: userSession.displayName,
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
  if (userSessionKey.strategy === 'oidc') {
    makeUserSession(userSessionKey.sessionId, userSessionKey.username, userSessionKey.displayName)
      .then((userSession) => done(null, userSession))
      .catch((err) => done(err));
  } else {
    // Try the next deserializer
    done('pass');
  }
};

exports.getStrategy = async function () {
  // Retry to give the identity provider time to start (when using docker-compose)
  const retryOptions = { interval: 1000 };
  const issuer = await retry(
    openIdClient.Issuer.discover,
    [config.userAuthn.oidc.issuerUrl],
    retryOptions,
  );

  const clientOptions = {
    client_id: config.userAuthn.oidc.clientId,
    client_secret: config.userAuthn.oidc.clientSecret,
    redirect_uris: [`${config.userAuthn.oidc.redirectOrigin}/api/authn/oidc/callback`],
    response_types: ['code'],
  };
  const client = new issuer.Client(clientOptions);

  // oidc strategy for passport
  const strategyOptions = {
    client,
    params: { scope: 'openid email profile' },
  };
  const strategy = new openIdClient.Strategy(strategyOptions, verifyCallback);
  strategyName = strategy.name;

  return strategy;
};

/**
 * This function is called by the strategy after the user has authenticated using the oidc strategy
 * It creates and returns the user session for this user
 */
function verifyCallback(tokenSet, userInfo, done) {
  const claims = tokenSet.claims();

  makeUserSession(claims.email, claims.preferred_username, claims.name)
    .then((userSession) => done(null, userSession))
    .catch((err) => done(err));
}

async function makeUserSession(email, username, displayName) {
  // Create the user session from the user account in the database
  let userSession = await makeRegisteredUserSession(email);
  if (!userSession) {
    // Not in the database, unregistered user
    userSession = makeUnregisteredUserSession(email, username, displayName);
  }

  return userSession;
}

async function makeRegisteredUserSession(email) {
  const userAccount = await userAccountsService.retrieveByEmail(email);

  if (userAccount) {
    const userAccountData = (({ email, status, role, displayName }) => ({
      email,
      status,
      role,
      displayName,
    }))(userAccount);
    const userSession = {
      strategy: 'oidc',
      userAccountId: userAccount.id,
      ...userAccountData,
      name: userAccount.username,
      registered: true,
    };

    return userSession;
  } else {
    return null;
  }
}

function makeUnregisteredUserSession(email, username, displayName) {
  const userSession = {
    strategy: 'oidc',
    email: email,
    role: 'none',
    name: username,
    displayName: displayName,
    registered: false,
  };

  return userSession;
}
