'use strict';

const migrateMongo = require('migrate-mongo');
const config = require('../../config/config');
const logger = require('../logger');

exports.migrateDatabase = async function () {
  global.options = {
    file: './app/lib/migration/migration-config.js',
  };

  // In migrate-mongo v14+, exports are Promises that must be awaited
  const [database, status, up] = await Promise.all([
    migrateMongo.database,
    migrateMongo.status,
    migrateMongo.up,
  ]);

  const { db, client } = await database.connect();
  const migrationStatus = await status(db);

  const actionsPending = Boolean(migrationStatus.find((elem) => elem.appliedAt === 'PENDING'));
  if (actionsPending) {
    if (config.database.migration.enable) {
      logger.info('Starting database migration...');
      const appliedActions = await up(db, client);
      for (const action of appliedActions) {
        logger.info(`Applied migration action: ${action}`);
      }
    } else {
      await client.close();
      throw new Error(
        'One or more database migration actions are pending, but database migrations are disabled',
      );
    }
  } else {
    logger.info('No pending database migration actions found');
  }

  await client.close();
};
