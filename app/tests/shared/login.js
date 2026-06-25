'use strict';

const request = require('supertest');
const setCookieParser = require('set-cookie-parser');

exports.loginAnonymous = async function (app) {
  const res = await request(app)
    .get('/api/authn/anonymous/login')
    .set('Accept', 'application/json')
    .expect(200);

  // Save the cookie for later tests
  const cookies = setCookieParser(res);
  // The cookie name may be 'connect.sid' or 'connect.XXXXXXXX.sid' depending on hostname
  // Look for any cookie that matches the pattern connect*.sid
  const passportCookie = cookies.find(
    (c) => c.name.startsWith('connect.') && c.name.endsWith('.sid'),
  );

  return passportCookie;
};
