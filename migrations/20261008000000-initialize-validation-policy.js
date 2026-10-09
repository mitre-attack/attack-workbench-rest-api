'use strict';

// This MUST remain after migrations that mutate the legacy validationbypassrules
// collection. Stop old API writers before running the designated upgrader.
module.exports = {
  async up(db) {
    // migrate-mongo and Mongoose can use different BSON major versions. Construct
    // destination IDs using the migration driver's own BSON implementation.
    const { createRequire } = require('module');
    const migrationRequire = createRequire(require.resolve('migrate-mongo'));
    const { ObjectId } = migrationRequire('mongodb');
    await require('../app/services/system/validation-policy-service').initialize({
      db,
      ObjectId,
      activateEngine: true,
    });
  },
  async down() {
    throw new Error(
      'Canonical validation policy cutover cannot be rolled back automatically. Restore a stopped-server database backup.',
    );
  },
};
