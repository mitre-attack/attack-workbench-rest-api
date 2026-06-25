#!/usr/bin/env node

'use strict';

const superagent = require('superagent');
const setCookieParser = require('set-cookie-parser');

let passportCookie;
async function login(url) {
  const res = await superagent.get(url);
  const cookies = setCookieParser(res);
  // The cookie name may be 'connect.sid' or 'connect.XXXXXXXX.sid' depending on hostname
  passportCookie = cookies.find((c) => c.name.startsWith('connect.') && c.name.endsWith('.sid'));
}

function post(url, data) {
  return superagent
    .post(url)
    .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
    .send(data);
}

async function initializeData() {
  // Read the collection index v1 from the file
  const collectionIndexJson = require('./mock-data/collection-index-v1.json');

  // Create the collection index object, including a subscription to the Blue collection
  const collectionIndex = {
    collection_index: collectionIndexJson,
    workspace: {
      remote_url: 'http://localhost/collection-indexes/collection-index.json',
      update_policy: {
        automatic: true,
        interval: 30,
        last_retrieval: new Date().toISOString(),
        subscriptions: [collectionIndexJson.collections[0].id],
      },
    },
  };

  // Log into the Workbench REST API
  const loginUrl = 'http://localhost:8080/api/authn/anonymous/login';
  await login(loginUrl);

  // Import the collection index v1 into the database
  const postCollectionIndexesUrl = 'http://localhost:3000/api/collection-indexes';
  await post(postCollectionIndexesUrl, collectionIndex);
}

initializeData()
  .then(() => {
    console.log('initializeData() - Terminating normally');
    process.exit();
  })
  .catch((err) => {
    console.log('initializeData() - Error: ' + err);
    process.exit(1);
  });
