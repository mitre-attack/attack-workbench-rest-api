'use strict';

const request = require('superagent');
const crypto = require('crypto');
const jwtDecoder = require('jwt-decode');

const logger = require('../../lib/logger');
const config = require('../../config/config');

const errors = {
  serviceNotFound: 'Service not found',
  invalidChallengeHash: 'Invalid challenge hash',
  invalidToken: 'Invalid token',
  noMechanismConfigured: 'No authentication mechanism configured',
  invalidOidcCredentials: 'Invalid OIDC credentials',
  connectionRefused: 'OIDC Provider Connection refused',
};
exports.errors = errors;

// The access token, plus associated information
let tokenData;

/**
 * Is the token current? The token must exist and not be expired or about to expire.
 */
function tokenIsCurrent(tokenType) {
  if (!tokenData || tokenData.type !== tokenType) {
    return false;
  } else {
    // Add cushion: reauthenticate if less than 1 second until expiration
    const cushion = 1000; // milliseconds
    const now = Date.now();
    return tokenData.exp * 1000 >= now + cushion;
  }
}

/**
 * Get the challenge string (nonce) from the REST API service
 */
async function getApikeyChallengeFromServer() {
  try {
    const challengeResponse = await request.get(
      `${config.workbench.restApiBaseUrl}/api/authn/service/apikey-challenge?serviceName=${config.workbench.authn.apikey.serviceName}`,
    );
    return challengeResponse.body.challenge;
  } catch (err) {
    if (err.status === 404 && err.response.text === 'Service not found') {
      throw new Error(errors.serviceNotFound);
    } else {
      throw err;
    }
  }
}

/**
 * Compute the HMAC-SHA256 hash of the challenge string using the configured API Key.
 */
function makeChallengeHash(nonce) {
  const hmac = crypto.createHmac('sha256', config.workbench.authn.apikey.apikey);
  hmac.update(nonce);
  return hmac.digest('hex');
}

/**
 * Send the computed challenge hash to the REST API service and receive the access token.
 */
async function getApikeyAccessTokenFromServer(challengeHash) {
  try {
    const tokenResponse = await request
      .get(
        `${config.workbench.restApiBaseUrl}/api/authn/service/apikey-token?serviceName=${config.workbench.authn.apikey.serviceName}`,
      )
      .set('Authorization', `Apikey ${challengeHash}`);

    const accessToken = tokenResponse.body.access_token;
    let decodedToken;
    try {
      decodedToken = jwtDecoder(accessToken);
    } catch (err) {
      logger.error(err.message);
      throw new Error(`${errors.invalidToken} - ${err}`);
    }

    return {
      accessToken,
      service: decodedToken.serviceName,
      exp: decodedToken.exp,
      type: 'apikey',
    };
  } catch (err) {
    if (err.status === 404 && err.response.text === 'Service not found') {
      throw new Error(errors.serviceNotFound);
    } else if (err.status === 400 && err.response.text === 'Invalid challenge hash') {
      throw new Error(errors.invalidChallengeHash);
    } else {
      throw err;
    }
  }
}

/**
 * Get the access token from the OIDC Identity Provider
 */
async function getClientCredentialsAccessTokenFromServer() {
  let accessToken;
  try {
    const body = {
      client_id: config.workbench.authn.oidcClientCredentials.clientId,
      client_secret: config.workbench.authn.oidcClientCredentials.clientSecret,
      grant_type: 'client_credentials',
    };

    // Some OIDC Identity Providers require scope
    if (config.workbench.authn.oidcClientCredentials.scope) {
      body.scope = config.workbench.authn.oidcClientCredentials.scope;
    }

    const res = await request
      .post(config.workbench.authn.oidcClientCredentials.tokenUrl)
      .type('form')
      .send(body);
    accessToken = res.body.access_token;
  } catch (err) {
    if (err.status === 401) {
      throw new Error(errors.invalidOidcCredentials);
    } else if (
      err.status === 400 &&
      err?.response?.body.error_description === 'Invalid client credentials'
    ) {
      throw new Error(errors.invalidOidcCredentials);
    } else if (err.code === 'ECONNREFUSED') {
      throw new Error(errors.connectionRefused, { cause: err });
    } else {
      throw err;
    }
  }
  let decodedToken;
  try {
    decodedToken = jwtDecoder(accessToken);
  } catch (err) {
    logger.error(err.message);
    throw new Error(`${errors.invalidToken} - ${err}`);
  }

  return {
    accessToken,
    service: decodedToken.serviceName,
    exp: decodedToken.exp,
    type: 'client-credentials',
  };
}

/**
 * Get the API Key access token, using the cached value if it is current.
 */
async function getApikeyAccessToken() {
  if (!tokenIsCurrent('apikey')) {
    const nonce = await getApikeyChallengeFromServer();
    const challengeHash = makeChallengeHash(nonce);
    tokenData = await getApikeyAccessTokenFromServer(challengeHash);
  }

  return tokenData.accessToken;
}

/**
 * Get the client credentials access token, using the cached value if it is current.
 */
async function getClientCredentialsAccessToken() {
  if (!tokenIsCurrent('client-credentials')) {
    tokenData = await getClientCredentialsAccessTokenFromServer();
  }

  return tokenData.accessToken;
}

/**
 * Get the access token that can be used to access the REST API service
 */
exports.getAccessToken = function () {
  if (config.workbench.authn.mechanism === 'apikey') {
    return getApikeyAccessToken();
  } else if (config.workbench.authn.mechanism === 'client-credentials') {
    return getClientCredentialsAccessToken();
  } else {
    throw new Error(errors.noMechanismConfigured);
  }
};

// Invalidate the cached token and force a new authentication with the service
exports.invalidateToken = function () {
  tokenData = undefined;
};
