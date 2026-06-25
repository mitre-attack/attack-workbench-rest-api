const request = require('supertest');
const database = require('./app/lib/database-in-memory');
const databaseConfiguration = require('./app/lib/database-configuration');
const config = require('./app/config/config');
const login = require('./app/tests/shared/login');
const uuid = require('uuid');

async function testMongooseSerialization() {
  console.log('=== Testing Mongoose Serialization Behavior ===\n');

  // Configure validation
  config.validateRequests.withAttackDataModel = true;
  config.validateRequests.withOpenApi = false;

  // Initialize database and app
  await database.initializeConnection();
  await databaseConfiguration.checkSystemConfiguration();
  const app = await require('./app/index').initializeApp();
  const passportCookie = await login.loginAnonymous(app);

  // Create a minimal technique WITHOUT x_mitre_platforms or x_mitre_contributors
  const minimalTechnique = {
    workspace: {
      workflow: {
        state: 'work-in-progress',
      },
    },
    stix: {
      type: 'attack-pattern',
      spec_version: '2.1',
      id: `attack-pattern--${uuid.v4()}`,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      name: 'Test Technique - No Arrays',
      x_mitre_is_subtechnique: false,
      x_mitre_domains: ['enterprise-attack'],
      external_references: [{ external_id: 'T001' }],
      // NOTE: We are deliberately NOT including x_mitre_platforms or x_mitre_contributors
    },
  };

  console.log('1. Sending POST request WITHOUT x_mitre_platforms and x_mitre_contributors:');
  console.log('   Request body includes these fields:', Object.keys(minimalTechnique.stix));
  console.log('   x_mitre_platforms in request:', 'x_mitre_platforms' in minimalTechnique.stix);
  console.log(
    '   x_mitre_contributors in request:',
    'x_mitre_contributors' in minimalTechnique.stix,
  );
  console.log('');

  const postResponse = await request(app)
    .post('/api/techniques')
    .send(minimalTechnique)
    .set('Accept', 'application/json')
    .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`);

  console.log('2. POST Response status:', postResponse.status);
  console.log('');

  if (postResponse.status === 201) {
    const returnedStix = postResponse.body.stix;

    console.log('3. Server Response Analysis:');
    console.log('   Fields in response:', Object.keys(returnedStix));
    console.log('');
    console.log('4. Critical Fields Check:');
    console.log('   x_mitre_platforms in response:', 'x_mitre_platforms' in returnedStix);
    console.log('   x_mitre_platforms value:', JSON.stringify(returnedStix.x_mitre_platforms));
    console.log('   x_mitre_platforms type:', typeof returnedStix.x_mitre_platforms);
    console.log(
      '   x_mitre_platforms Array.isArray:',
      Array.isArray(returnedStix.x_mitre_platforms),
    );
    console.log('');
    console.log('   x_mitre_contributors in response:', 'x_mitre_contributors' in returnedStix);
    console.log(
      '   x_mitre_contributors value:',
      JSON.stringify(returnedStix.x_mitre_contributors),
    );
    console.log('   x_mitre_contributors type:', typeof returnedStix.x_mitre_contributors);
    console.log(
      '   x_mitre_contributors Array.isArray:',
      Array.isArray(returnedStix.x_mitre_contributors),
    );
    console.log('');

    // Now check what happens when we try to PUT with this data
    console.log('5. Testing PUT with the returned object:');
    const putBody = {
      workspace: {
        workflow: {
          state: 'work-in-progress',
        },
      },
      stix: {
        ...returnedStix,
        name: 'Updated Name',
      },
    };

    delete putBody.stix.x_mitre_attack_spec_version;

    console.log(
      '   x_mitre_platforms in PUT body:',
      JSON.stringify(putBody.stix.x_mitre_platforms),
    );
    console.log(
      '   x_mitre_contributors in PUT body:',
      JSON.stringify(putBody.stix.x_mitre_contributors),
    );
    console.log('');

    const putResponse = await request(app)
      .put(`/api/techniques/${returnedStix.id}/modified/${returnedStix.modified}`)
      .send(putBody)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`);

    console.log('   PUT Response status:', putResponse.status);
    if (putResponse.status === 400) {
      console.log('   PUT FAILED with validation errors:');
      console.log('   Errors:', JSON.stringify(putResponse.body.details, null, 2));
    } else {
      console.log('   PUT succeeded (unexpected!)');
    }
  } else {
    console.log('POST failed:', postResponse.body);
  }

  process.exit(0);
}

testMongooseSerialization().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
