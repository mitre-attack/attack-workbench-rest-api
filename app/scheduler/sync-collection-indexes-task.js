'use strict';

const schedule = require('node-schedule');
const collectionIndexesService = require('../services/stix/collection-indexes-service');
const collectionsService = require('../services/stix/collections-service');
const collectionBundlesService = require('../services/stix/collection-bundles-service');
const {
  MissingParameterError,
  NotFoundError,
  BadRequestError,
  HostNotFoundError,
  ConnectionRefusedError,
  HTTPError,
} = require('../exceptions');

const logger = require('../lib/logger');
const config = require('../config/config');

const superagent = require('superagent');

const scheduledSubscriptions = new Map();

async function retrieveByUrl(url) {
  if (!url) {
    throw new MissingParameterError('url');
  }

  try {
    const res = await superagent.get(url).accept('application/json');
    return JSON.parse(res.text);
  } catch (err) {
    if (err.response && err.response.notFound) {
      throw new NotFoundError(err);
    } else if (err.response && err.response.badRequest) {
      throw new BadRequestError(err);
    } else if (err.code === 'ENOTFOUND') {
      throw new HostNotFoundError(err);
    } else if (err.code === 'ECONNREFUSED') {
      throw new ConnectionRefusedError(err);
    } else {
      throw new HTTPError(err);
    }
  }
}

const runCheckCollectionIndexes = async function () {
  const updatedCollections = [];
  logger.info('[sync-collection-indexes] Scheduler running...');

  let collectionIndexes;
  try {
    collectionIndexes = await collectionIndexesService.retrieveAll({ offset: 0, limit: 0 });
  } catch (err) {
    logger.error('[sync-collection-indexes] Unable to get existing collection indexes: ' + err);
  }

  for (const collectionIndex of collectionIndexes) {
    if (collectionIndex.collection_index && collectionIndex.workspace.update_policy.automatic) {
      let lastRetrieval;
      const now = Date.now();
      if (collectionIndex.workspace.update_policy.last_retrieval) {
        lastRetrieval = new Date(collectionIndex.workspace.update_policy.last_retrieval);
      }
      // Is it time to retrieve the collection index from the remote URL?
      if (
        !lastRetrieval ||
        now - lastRetrieval > 1000 * collectionIndex.workspace.update_policy.interval
      ) {
        logger.info(
          `[sync-collection-indexes] Checking collection index: ${collectionIndex.collection_index.name} (${collectionIndex.collection_index.id})`,
        );
        logger.verbose(
          '[sync-collection-indexes] Retrieving collection index from remote url ' +
            collectionIndex.workspace.remote_url,
        );

        let remoteCollectionIndex;
        try {
          remoteCollectionIndex = await retrieveByUrl(collectionIndex.workspace.remote_url);
        } catch (err) {
          logger.error(
            '[sync-collection-indexes] Unable to retrieve collection index from remote url. ' + err,
          );
        }

        const remoteTimestamp = new Date(remoteCollectionIndex.modified);
        const existingTimestamp = new Date(collectionIndex.collection_index.modified);
        if (remoteTimestamp > existingTimestamp) {
          logger.info(
            '[sync-collection-indexes] The retrieved collection index is newer. Updating collection index in workbench.',
          );
          collectionIndex.collection_index = remoteCollectionIndex;
          collectionIndex.workspace.update_policy.last_retrieval = new Date(now).toISOString();

          let savedCollectionIndex;
          try {
            savedCollectionIndex = await collectionIndexesService.updateFull(
              collectionIndex.collection_index.id,
              collectionIndex,
            );
          } catch (err) {
            logger.error(
              '[sync-collection-indexes] Unable to update collection index in workbench. ' + err,
            );
            return updatedCollections;
          }

          // Check subscribed collections
          if (scheduledSubscriptions.has(savedCollectionIndex.collection_index.id)) {
            logger.info(
              `[sync-collection-indexes] Subscriptions for collection index ${savedCollectionIndex.collection_index.id} are already being checked`,
            );
          } else {
            logger.verbose(
              `[sync-collection-indexes] Checking Subscriptions for collection index ${savedCollectionIndex.collection_index.id}`,
            );
            scheduledSubscriptions.set(savedCollectionIndex.collection_index.id, true);
            try {
              await subscriptionHandler(savedCollectionIndex);
              updatedCollections.push(collectionIndex.collection_index.id);
              scheduledSubscriptions.delete(savedCollectionIndex.collection_index.id);
            } catch (err) {
              logger.error(
                '[sync-collection-indexes] Error checking subscriptions in collection index. ' +
                  err,
              );
              return updatedCollections;
            }
          }
        } else {
          logger.verbose('[sync-collection-indexes] The retrieved collection index is not newer.');
          collectionIndex.workspace.update_policy.last_retrieval = new Date(now).toISOString();
          try {
            await collectionIndexesService.updateFull(
              collectionIndex.collection_index.id,
              collectionIndex,
            );
          } catch (err) {
            logger.error(
              '[sync-collection-indexes] Unable to update collection index in workbench. ' + err,
            );
            return updatedCollections;
          }

          // Check subscribed collections
          if (scheduledSubscriptions.has(collectionIndex.collection_index.id)) {
            logger.info(
              `[sync-collection-indexes] Subscriptions for collection index ${collectionIndex.collection_index.id} are already being checked`,
            );
          } else {
            logger.info(
              `[sync-collection-indexes] Checking Subscriptions for collection index ${collectionIndex.collection_index.id}`,
            );
            scheduledSubscriptions.set(collectionIndex.collection_index.id, true);
            try {
              await subscriptionHandler(collectionIndex);
              updatedCollections.push(collectionIndex.collection_index.id);
              scheduledSubscriptions.delete(collectionIndex.collection_index.id);
            } catch (err) {
              logger.error(
                '[sync-collection-indexes] Error checking subscriptions in collection index. ' +
                  err,
              );
              return updatedCollections;
            }
          }
        }
      }
    }
  }
  return updatedCollections;
};

exports.runCheckCollectionIndexes = runCheckCollectionIndexes;

async function subscriptionHandler(collectionIndex) {
  // Check each subscription in the collection index
  for (const collectionId of collectionIndex.workspace.update_policy.subscriptions) {
    const collections = await collectionsService.retrieveById(collectionId, { versions: 'latest' });
    // Get the corresponding collection info from the collection index
    // collectionInfo.versions is a list of versions that are available to be imported
    const collectionInfo = collectionIndex.collection_index.collections.find(
      (item) => item.id === collectionId,
    );
    if (!collectionInfo || collectionInfo.versions.length === 0) {
      // No versions available to import
      continue;
    }

    // Order both lists of collection versions, latest version first
    collections.sort((a, b) => b.stix.modified.getTime() - a.stix.modified.getTime());
    collectionInfo.versions.sort((a, b) => b.modified.getTime() - a.modified.getTime());

    if (
      collections.length === 0 ||
      collections[0].stix.modified < collectionInfo.versions[0].modified
    ) {
      // Latest version in collection index is later than latest version in the Workbench data store,
      // so we should import it
      logger.info(
        `[sync-collection-indexes] Retrieving collection bundle from remote url ${collectionInfo.versions[0].url}`,
      );

      let collectionBundle;
      try {
        collectionBundle = await retrieveByUrl(collectionInfo.versions[0].url);
      } catch (err) {
        throw new Error('Unable to retrieve updated collection bundle. ' + err);
      }
      logger.info(
        `[sync-collection-indexes] Downloaded updated collection bundle with id ${collectionBundle.id}`,
      );

      // Find the x-mitre-collection objects
      const collections = collectionBundle.objects.filter(
        (object) => object.type === 'x-mitre-collection',
      );

      // The bundle must have an x-mitre-collection object
      if (collections.length === 0) {
        throw new Error(
          'Unable to import collection bundle. Collection bundle is missing x-mitre-collection object.',
        );
      } else if (collections.length > 1) {
        throw new Error(
          'Unable to import collection bundle. Collection bundle has more than one x-mitre-collection object.',
        );
      }

      // The collection must have an id.
      if (collections.length > 0 && !collections[0].id) {
        throw new Error(
          'Unable to import collection bundle. Badly formatted collection in bundle, x-mitre-collection missing id.',
        );
      }

      const importOptions = {
        previewOnly: false,
        forceImportParameters: [],
      };
      try {
        const importedCollection = await collectionBundlesService.importBundle(
          collections[0],
          collectionBundle,
          importOptions,
        );
        logger.info(
          `[sync-collection-indexes] Imported collection bundle with x-mitre-collection id ${importedCollection.stix.id}`,
        );
      } catch (err) {
        throw new Error(
          'Unable to import collection bundle into ATT&CK Workbench database. ' + err,
        );
      }
    }
  }
}

/**
 * Initialize and schedule this task
 */
function initializeTask() {
  const cronPattern = config.scheduler.syncCollectionIndexesCron;

  logger.info(`[sync-collection-indexes] Scheduling task with cron pattern: ${cronPattern}`);

  schedule.scheduleJob(cronPattern, async () => {
    try {
      await runCheckCollectionIndexes();
    } catch (err) {
      logger.error(`[sync-collection-indexes] Task execution failed: ${err.message}`);
    }
  });

  logger.info(`[sync-collection-indexes] Task scheduled successfully`);
}

if (config.scheduler.enableScheduler) {
  initializeTask();
}
