'use strict';

const superagent = require('superagent');
const authenticationService = require('../services/system/authentication-service');

/**
 * Send an HTTP GET request to the provided URL, including the appropriate Authorization header
 */
exports.get = async function (url) {
  try {
    const tokenString = await authenticationService.getAccessToken();
    const authorizationHeader = `Bearer ${tokenString}`;
    return await superagent.get(url).set('Authorization', authorizationHeader);
  } catch (err) {
    if (Object.values(authenticationService.errors).includes(err.message)) {
      throw new Error(`Authentication Error, ${err.message}`);
    } else {
      throw err;
    }
  }
};

/**
 * Send an HTTP PUT request to the provided URL, including the appropriate Authorization header
 */
exports.put = async function (url, data) {
  try {
    const tokenString = await authenticationService.getAccessToken();
    const authorizationHeader = `Bearer ${tokenString}`;
    return await superagent.put(url).set('Authorization', authorizationHeader).send(data);
  } catch (err) {
    if (Object.values(authenticationService.errors).includes(err.message)) {
      throw new Error(`Authentication Error, ${err.message}`);
    } else {
      throw err;
    }
  }
};

/**
 * Send an HTTP POST request to the provided URL, including the appropriate Authorization header
 */
exports.post = async function (url, data) {
  try {
    const tokenString = await authenticationService.getAccessToken();
    const authorizationHeader = `Bearer ${tokenString}`;
    return await superagent.post(url).set('Authorization', authorizationHeader).send(data);
  } catch (err) {
    if (Object.values(authenticationService.errors).includes(err.message)) {
      throw new Error(`Authentication Error, ${err.message}`);
    } else {
      throw err;
    }
  }
};
