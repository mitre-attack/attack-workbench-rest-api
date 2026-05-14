'use strict';

const semver = require('semver');

const {
  errors,
  importErrors,
  forceImportParameters,
  makeKey,
  makeKeyFromObject,
  defaultAttackSpecVersion,
  toEpoch,
} = require('./bundle-helpers');

const logger = require('../../../lib/logger');
const config = require('../../../config/config');
const types = require('../../../lib/types');
const { deepFreezeStix } = require('../../../lib/import-safety');

// Bounded concurrency for the compose-and-validate phase. Each task runs Zod
// validation and a small amount of synchronous work, so we cap concurrency
// to avoid pinning the event loop on extremely large bundles.
const COMPOSE_CONCURRENCY = 25;

/**
 * Run `task` against every item in `items` with at most `limit` in flight.
 * Inline replacement for p-limit so we don't pull a new dependency (and
 * avoid the ESM-only issue in recent p-limit versions).
 */
async function runWithConcurrency(items, limit, task) {
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await task(items[i], i);
    }
  }
  const workerCount = Math.min(limit, items.length);
  const workers = [];
  for (let i = 0; i < workerCount; i++) workers.push(worker());
  await Promise.all(workers);
}

const collectionsService = require('../collections-service');
const referencesService = require('../../system/references-service');

const Collection = require('../../../models/collection-model');

// Service mapping object using the type constants
const serviceMap = {
  [types.Technique]: require('../techniques-service'),
  [types.Tactic]: require('../tactics-service'),
  [types.Group]: require('../groups-service'),
  [types.Campaign]: require('../campaigns-service'),
  [types.Mitigation]: require('../mitigations-service'),
  [types.Matrix]: require('../matrices-service'),
  [types.Relationship]: require('../relationships-service'),
  [types.MarkingDefinition]: require('../marking-definitions-service'),
  [types.Identity]: require('../identities-service'),
  [types.Note]: require('../../system/notes-service'),
  [types.DataSource]: require('../data-sources-service'),
  [types.DataComponent]: require('../data-components-service'),
  [types.Asset]: require('../assets-service'),
  [types.Analytic]: require('../analytics-service'),
  [types.DetectionStrategy]: require('../detection-strategies-service'),
};

// Handle special cases that share a service
const softwareTypes = [types.Malware, types.Tool];
softwareTypes.forEach((type) => {
  serviceMap[type] = require('../software-service');
});

/**
 * Maps STIX object types to their corresponding services
 * @param {string} type - STIX object type
 * @returns {Object|null} Service for the given type or null if not found
 */
const getServiceForType = (type) => serviceMap[type] || null;

/**
 * Checks if a STIX object is a duplicate of existing objects
 * @param {Object} importObject - Object being imported
 * @param {Array} existingObjects - Array of existing objects
 * @returns {boolean} True if object is a duplicate
 */
function checkForDuplicate(importObject, existingObjects) {
  if (importObject.type === 'marking-definition') {
    return existingObjects.some(
      (object) => toEpoch(object.stix.created) === toEpoch(importObject.created),
    );
  }
  return existingObjects.some(
    (object) => toEpoch(object.stix.modified) === toEpoch(importObject.modified),
  );
}

/**
 * Categorizes an object as addition, change, revocation, etc.
 * @param {Object} importObject - Object being imported
 * @param {Array} existingObjects - Array of existing objects
 * @param {Object} importedCollection - Collection being imported
 */
function categorizeObject(importObject, existingObjects, importedCollection) {
  if (existingObjects.length === 0) {
    importedCollection.workspace.import_categories.additions.push(importObject.id);
    return;
  }

  const latestExistingObject = existingObjects[0];

  if (importObject.revoked && !latestExistingObject.stix.revoked) {
    importedCollection.workspace.import_categories.revocations.push(importObject.id);
  } else if (importObject.x_mitre_deprecated && !latestExistingObject.stix.x_mitre_deprecated) {
    importedCollection.workspace.import_categories.deprecations.push(importObject.id);
  } else if (toEpoch(latestExistingObject.stix.modified) < toEpoch(importObject.modified)) {
    if (latestExistingObject.stix.x_mitre_version < importObject.x_mitre_version) {
      importedCollection.workspace.import_categories.changes.push(importObject.id);
    } else if (latestExistingObject.stix.x_mitre_version === importObject.x_mitre_version) {
      importedCollection.workspace.import_categories.minor_changes.push(importObject.id);
    }
  } else {
    importedCollection.workspace.import_categories.out_of_date.push(importObject.id);
  }
}

/**
 * Processes external references from a STIX object
 * @param {Object} importObject - Object being imported
 * @param {Map} importReferences - Map of references being imported
 * @param {Object} referenceImportResults - Reference import statistics
 */
function processExternalReferences(importObject, importReferences, referenceImportResults) {
  if (!importObject.external_references?.length) return;

  for (const externalReference of importObject.external_references) {
    if (
      !externalReference.source_name ||
      !externalReference.description ||
      externalReference.external_id
    ) {
      continue;
    }

    // Check if reference is an alias
    const isAlias = checkIfAlias(importObject, externalReference.source_name);
    if (isAlias) {
      referenceImportResults.aliasReferences++;
      continue;
    }

    if (importReferences.has(externalReference.source_name)) {
      referenceImportResults.duplicateReferences++;
    } else {
      referenceImportResults.uniqueReferences++;
      importReferences.set(externalReference.source_name, externalReference);
    }
  }
}

/**
 * Checks if a source name is an alias for the object
 * @param {Object} importObject - STIX object
 * @param {string} sourceName - Source name to check
 * @returns {boolean} True if source name is an alias
 */
function checkIfAlias(importObject, sourceName) {
  if (importObject.type === 'intrusion-set') {
    return importObject.aliases?.includes(sourceName);
  }
  if (importObject.type === 'malware' || importObject.type === 'tool') {
    return importObject.x_mitre_aliases?.includes(sourceName);
  }
  return false;
}

/**
 * Records an unknown-object-type error against the imported collection.
 * @param {Object} importObject - The unknown STIX object
 * @param {Object} importedCollection - Collection being imported
 */
function recordUnknownTypeError(importObject, importedCollection) {
  const importError = {
    object_ref: importObject.id,
    object_modified: importObject.modified,
    error_type: importErrors.unknownObjectType,
    error_message: `Unknown object type: ${importObject.type}`,
  };
  logger.verbose(
    `Import Bundle Error: Unknown object type. id=${importObject.id}, modified=${importObject.modified}, type=${importObject.type}`,
  );
  importedCollection.workspace.import_categories.errors.push(importError);
}

/**
 * Process one tier of same-type STIX objects: contents-map check, spec-version
 * gate, bulk pre-fetch of existing versions, parallel compose-and-validate,
 * then a single bulk insert.
 *
 * Tier-based grouping is sound because `sortObjectsByDependencies` returns a
 * stable sort that keeps every type together — and types appear in dependency
 * order (data-source before data-component, etc.). Each tier persists fully
 * before the next tier begins.
 *
 * @param {string} type - STIX type for this tier
 * @param {Array<Object>} objects - STIX objects of this type
 * @param {Object} ctx - Shared import context
 */
async function processTier(type, objects, ctx) {
  const {
    options,
    importedCollection,
    contentsMap,
    collectionReference,
    importReferences,
    referenceImportResults,
  } = ctx;

  // Filter the tier: drain contents-map, gate on ATT&CK spec version, and
  // record per-object errors. The result is the set of objects eligible for
  // compose-and-insert.
  const eligible = [];
  for (const importObject of objects) {
    if (
      !contentsMap.delete(makeKeyFromObject(importObject)) &&
      importObject.type !== types.Collection
    ) {
      const importError = {
        object_ref: importObject.id,
        object_modified: importObject.modified,
        error_type: importErrors.notInContents,
        error_message:
          'Warning: Object in bundle but not in x_mitre_contents. Object will be saved in database.',
      };
      logger.verbose(
        `Import Bundle Warning: Object not in x_mitre_contents. id=${importObject.id}, modified=${importObject.modified}`,
      );
      importedCollection.workspace.import_categories.errors.push(importError);
    }

    if (importObject.type !== 'marking-definition') {
      const objectAttackSpecVersion =
        importObject.x_mitre_attack_spec_version ?? defaultAttackSpecVersion;
      if (semver.gt(objectAttackSpecVersion, config.app.attackSpecVersion)) {
        const importError = {
          object_ref: importObject.id,
          object_modified: importObject.modified,
          error_type: importErrors.attackSpecVersionViolation,
          error_message: 'Error: Object x_mitre_attack_spec_version later than system.',
        };
        logger.verbose(
          `Import Bundle Error: Object's x_mitre_attack_spec_version later than system. id=${importObject.id}, modified=${importObject.modified}`,
        );
        importedCollection.workspace.import_categories.errors.push(importError);

        if (
          !options.forceImportParameters?.includes(
            forceImportParameters.attackSpecVersionViolations,
          )
        ) {
          throw new Error(errors.attackSpecVersionViolation);
        }
        continue;
      }
    }
    eligible.push(importObject);
  }

  const service = getServiceForType(type);

  // Unknown / unsupported types: record per-object errors but continue the import.
  // Collection objects (the bundle itself) are deliberately skipped.
  if (!service) {
    if (type === types.Collection) return;
    for (const importObject of eligible) {
      recordUnknownTypeError(importObject, importedCollection);
    }
    return;
  }

  // Pre-fetch every existing version of every stixId in this tier in ONE query.
  // Replaces N calls to service.retrieveById from the old per-object loop.
  let existingByStixId;
  try {
    const ids = eligible.map((o) => o.id);
    existingByStixId = await service.repository.retrieveAllByStixIds(ids);
  } catch (err) {
    logger.error(err);
    for (const importObject of eligible) {
      const importError = {
        object_ref: importObject.id,
        object_modified: importObject.modified,
        error_type: importErrors.retrievalError,
      };
      logger.verbose(
        `Import Bundle Error: Unable to retrieve objects with matching STIX id. id=${importObject.id}, modified=${importObject.modified}`,
      );
      importedCollection.workspace.import_categories.errors.push(importError);
    }
    return;
  }

  // Compose-and-validate in parallel with bounded concurrency. Each task runs
  // the duplicate check, categorization, external-references collection,
  // Zod validation via `composeForImport`, and the service's `beforeCreate`
  // hook (which populates outbound `workspace.embedded_relationships` on the
  // doc being saved). Composed docs are accumulated into a single array for
  // bulk insert.
  const composedToInsert = [];
  const composeOptions = {
    import: true,
    validateContents: options.validateContents,
  };

  await runWithConcurrency(eligible, COMPOSE_CONCURRENCY, async (importObject) => {
    const existing = existingByStixId.get(importObject.id) || [];

    if (checkForDuplicate(importObject, existing)) {
      importedCollection.workspace.import_categories.duplicates.push(importObject.id);
      return;
    }

    categorizeObject(importObject, existing, importedCollection);
    processExternalReferences(importObject, importReferences, referenceImportResults);

    if (options.previewOnly) return;

    const stagingDoc = {
      workspace: {
        collections: [collectionReference],
      },
      stix: importObject,
    };

    try {
      const {
        data: composed,
        throwIfValidating,
        validationErrors,
      } = await service.composeForImport(stagingDoc, composeOptions);

      // Strict-mode validation failure (`validateContents=true`). Surface the
      // full ADM error list, not just the wrapper message — without `details`
      // the caller has no way to act on the failure other than re-running the
      // import with logs at debug level. Drop the doc from the bulk insert.
      if (throwIfValidating) {
        const importError = {
          object_ref: importObject.id,
          object_modified: importObject.modified,
          error_type: importErrors.validationError,
          error_message: `${validationErrors.length} ADM validation error(s)`,
          details: validationErrors.map((e) => ({
            message: e.message,
            path: e.path,
            code: e.code,
          })),
        };
        logger.verbose(
          `Import Bundle Error: Validation failed. id=${importObject.id}, ${throwIfValidating.message}`,
        );
        importedCollection.workspace.import_categories.errors.push(importError);
        return;
      }

      // Fail-open validation failures (`validateContents=false`, the default).
      // The object IS persisted with the error list attached to its own
      // `workspace.validation`, but a clean import response would otherwise
      // give the caller no signal that anything was wrong. We mirror the
      // per-object errors into `import_categories.errors` so the response
      // surfaces them up front. One taxonomy entry per object regardless of
      // how many issues that object had — the full per-issue list lives in
      // `details` so the caller can drill down without querying each doc.
      if (validationErrors.length > 0) {
        const firstFew = validationErrors
          .slice(0, 3)
          .map((e) => e.message)
          .join('; ');
        const summary =
          validationErrors.length > 3
            ? `${firstFew}; ...and ${validationErrors.length - 3} more`
            : firstFew;
        importedCollection.workspace.import_categories.errors.push({
          object_ref: importObject.id,
          object_modified: importObject.modified,
          error_type: importErrors.validationError,
          error_message: `${validationErrors.length} ADM validation error(s): ${summary}`,
          details: validationErrors.map((e) => ({
            message: e.message,
            path: e.path,
            code: e.code,
          })),
        });
      }

      // Run the service's beforeCreate hook so outbound embedded_relationships
      // and any other pre-persist data shaping are present on the doc when
      // saveMany writes it. Failures here are recorded as save errors and the
      // doc is dropped from the bulk insert.
      //
      // Import-fidelity guard: freeze stix before invoking the hook so any
      // forgotten `if (!options.import)` gate inside the service crashes
      // loudly with a TypeError instead of silently mutating bundle content.
      // See app/lib/import-safety.js for the full contract.
      deepFreezeStix(composed);
      try {
        await service.beforeCreate(composed, composeOptions);
      } catch (hookErr) {
        const importError = {
          object_ref: importObject.id,
          object_modified: importObject.modified,
          error_type: importErrors.saveError,
          error_message: hookErr.message,
        };
        logger.verbose(
          `Import Bundle Error: beforeCreate hook failed. id=${importObject.id}, ${hookErr.message}`,
        );
        importedCollection.workspace.import_categories.errors.push(importError);
        return;
      }

      composedToInsert.push(composed);
    } catch (err) {
      const importError = {
        object_ref: importObject.id,
        object_modified: importObject.modified,
        error_type: importErrors.saveError,
        error_message: err.message,
      };
      logger.verbose(
        `Import Bundle Error: Unable to compose object. id=${importObject.id}, modified=${importObject.modified}, ${err.message}`,
      );
      importedCollection.workspace.import_categories.errors.push(importError);
    }
  });

  if (composedToInsert.length === 0) return;

  // Bulk insert. `saveMany` uses MongoDB `insertMany` with `ordered:false`,
  // so individual document failures (e.g., duplicate-id races) are returned
  // per-doc and folded into the import errors below — they don't abort the
  // remaining inserts.
  const { inserted, errors: insertErrors } = await service.repository.saveMany(composedToInsert);
  for (const wErr of insertErrors) {
    const failedDoc = typeof wErr.index === 'number' ? composedToInsert[wErr.index] : undefined;
    const importError = {
      object_ref: failedDoc?.stix?.id,
      object_modified: failedDoc?.stix?.modified,
      error_type: importErrors.saveError,
      error_message: wErr.message,
    };
    logger.verbose(
      `Import Bundle Error: Unable to save object. id=${importError.object_ref}, modified=${importError.object_modified}, ${wErr.message}`,
    );
    importedCollection.workspace.import_categories.errors.push(importError);
  }

  // Post-insert lifecycle: run `afterCreate` and emit the `{type}::created`
  // event for each successfully inserted doc. These fire cross-service domain
  // events that maintain INBOUND `workspace.embedded_relationships` on
  // referenced documents (e.g., DetectionStrategy → Analytic, Analytic →
  // DataComponent, DataComponent → DataSource). Skipping them would leave
  // the frontend unable to navigate inbound relationships.
  //
  // Run in parallel with bounded concurrency; per-doc hook failures are
  // logged but never abort the import.
  await runWithConcurrency(inserted, COMPOSE_CONCURRENCY, async (doc) => {
    // Import-fidelity guard for the post-insert lifecycle. afterCreate and
    // the listeners that subscribe to the emitted `{type}::created` event
    // are allowed to populate workspace metadata on referenced documents
    // but must not deviate this freshly saved document's stix from the
    // bundle. Freezing forces violations to crash here rather than
    // silently corrupting the imported content. See app/lib/import-safety.js.
    deepFreezeStix(doc);
    try {
      await service.afterCreate(doc, composeOptions);
    } catch (err) {
      logger.warn(`Import Bundle: afterCreate failed for ${doc?.stix?.id}: ${err.message}`);
    }
    try {
      await service.emitCreatedEvent(doc, composeOptions);
    } catch (err) {
      logger.warn(`Import Bundle: emitCreatedEvent failed for ${doc?.stix?.id}: ${err.message}`);
    }
  });
}

/**
 * Sort objects to ensure dependencies are created before objects that reference them
 * Dependency order:
 * 1. Data sources must be created before data components
 * 2. Data components must be created before analytics
 * 3. Analytics must be created before detection strategies
 * @param {Array} objects - Array of STIX objects to sort
 * @returns {Array} Sorted array of STIX objects
 */
function sortObjectsByDependencies(objects) {
  // Define dependency order (lower numbers are created first)
  const typeOrder = {
    [types.MarkingDefinition]: 0,
    [types.Identity]: 1,
    [types.DataSource]: 2, // Must come before data components
    [types.DataComponent]: 3, // Must come before analytics
    [types.Analytic]: 4, // Must come before detection strategies
    [types.DetectionStrategy]: 5,
    [types.Technique]: 6,
    [types.Tactic]: 7,
    [types.Mitigation]: 8,
    [types.Group]: 9,
    [types.Campaign]: 10,
    [types.Malware]: 11,
    [types.Tool]: 12,
    [types.Asset]: 13,
    [types.Matrix]: 14,
    [types.Relationship]: 15, // Relationships last
    [types.Note]: 16,
    [types.Collection]: 17,
  };

  return objects.slice().sort((a, b) => {
    const orderA = typeOrder[a.type] ?? 100; // Unknown types go last
    const orderB = typeOrder[b.type] ?? 100;
    return orderA - orderB;
  });
}

/**
 * Process all objects in the bundle, batched by STIX type in dependency order.
 *
 * Each type tier runs sequentially (so e.g. data-sources finish before
 * data-components start), but objects within a tier are composed in parallel
 * and persisted with a single bulk `insertMany`. This replaces the previous
 * per-object sequential loop that did a DB read + DB write + lifecycle hooks
 * + event emission per imported object — the dominant cost in large bundles.
 *
 * @param {Array} objects - Array of STIX objects to process
 * @param {Object} options - Import options
 * @param {Object} importedCollection - Collection being imported
 * @param {Map} contentsMap - Map of objects in x_mitre_contents
 * @param {Object} collectionReference - Reference to the collection
 * @param {Map} importReferences - Map of references being imported
 * @param {Object} referenceImportResults - Tracking of reference import stats
 */
async function processObjects(
  objects,
  options,
  importedCollection,
  contentsMap,
  collectionReference,
  importReferences,
  referenceImportResults,
) {
  const sortedObjects = sortObjectsByDependencies(objects);

  // Group consecutive same-type objects into tiers. The sort above places
  // every type contiguously and in dependency order, so a single pass over
  // the sorted list is enough.
  const tiers = [];
  let currentTier = null;
  for (const obj of sortedObjects) {
    if (!currentTier || currentTier.type !== obj.type) {
      currentTier = { type: obj.type, objects: [] };
      tiers.push(currentTier);
    }
    currentTier.objects.push(obj);
  }

  const ctx = {
    options,
    importedCollection,
    contentsMap,
    collectionReference,
    importReferences,
    referenceImportResults,
  };

  for (const tier of tiers) {
    await processTier(tier.type, tier.objects, ctx);
  }

  // Check for objects in x_mitre_contents but not in bundle
  for (const entry of contentsMap.values()) {
    const importError = {
      object_ref: entry.object_ref,
      object_modified: entry.object_modified,
      error_type: importErrors.missingObject,
      error_message: 'Object listed in x_mitre_contents, but not in bundle',
    };
    logger.verbose(
      `Import Bundle Error: Object in x_mitre_contents but not in bundle. id=${entry.object_ref}, modified=${entry.object_modified}`,
    );
    importedCollection.workspace.import_categories.errors.push(importError);
  }
}

/**
 * Import references found in the bundle
 * @param {Map} importReferences - Map of references to import
 * @param {Object} options - Import options
 * @param {Object} importedCollection - Collection being imported
 */
async function importReferences(importReferences, options, importedCollection) {
  const references = await referencesService.retrieveAll({});
  const existingReferences = new Map(references.map((item) => [item.source_name, item]));

  for (const importReference of importReferences.values()) {
    if (existingReferences.has(importReference.source_name)) {
      // Update existing reference
      importedCollection.workspace.import_references.changes.push(importReference.source_name);
      if (!options.previewOnly) {
        await referencesService.update(importReference);
      }
    } else {
      // Create new reference
      importedCollection.workspace.import_references.additions.push(importReference.source_name);
      if (!options.previewOnly) {
        await referencesService.create(importReference);
      }
    }
  }
}

/**
 * Save the collection after import
 * @param {Object} importedCollection - Collection to save
 * @param {Object} duplicateCollection - Existing duplicate collection if any
 * @param {Object} options - Import options
 * @returns {Promise<Object>} Saved collection
 */
async function saveCollection(importedCollection, duplicateCollection, options) {
  if (duplicateCollection) {
    // Add reimport results to existing collection
    const reimport = {
      imported: new Date().toISOString(),
      import_categories: importedCollection.workspace.import_categories,
      import_references: importedCollection.workspace.import_references,
    };

    if (!duplicateCollection.workspace.reimports) {
      duplicateCollection.workspace.reimports = [];
    }
    duplicateCollection.workspace.reimports.push(reimport);

    if (!options.previewOnly) {
      return Collection.findByIdAndUpdate(duplicateCollection._id, duplicateCollection, {
        new: true,
        lean: true,
      });
    }
    return importedCollection;
  }

  // Create new collection
  if (!options.previewOnly) {
    try {
      const result = await collectionsService.create(importedCollection, {
        addObjectsToCollection: false,
        import: true,
      });
      return result.savedCollection;
    } catch (err) {
      if (err.name === 'MongoServerError' && err.code === 11000) {
        throw new Error(errors.duplicateCollection);
      }
      throw err;
    }
  }
  return importedCollection;
}

/**
 * Checks for a duplicate collection
 * @param {Object} importedCollection - Collection being imported
 * @param {Object} options - Import options
 * @returns {Promise<Object|null>} Duplicate collection if found
 */
async function checkDuplicateCollection(importedCollection, options) {
  const collections = await collectionsService.retrieveById(importedCollection.stix.id, {
    versions: 'all',
  });

  const duplicateCollection = collections.find(
    (collection) => toEpoch(collection.stix.modified) === toEpoch(importedCollection.stix.modified),
  );

  if (duplicateCollection) {
    if (options.forceImportParameters?.includes(forceImportParameters.duplicateCollection)) {
      const importError = {
        object_ref: importedCollection.stix.id,
        object_modified: importedCollection.stix.modified,
        error_type: importErrors.duplicateCollection,
        error_message: 'Warning: Duplicate x-mitre-collection object.',
      };
      logger.verbose(
        'Import Bundle Warning: Duplicate x-mitre-collection object. Continuing import due to forceImport parameter.',
      );
      importedCollection.workspace.import_categories.errors.push(importError);
      return duplicateCollection;
    }
    throw new Error(errors.duplicateCollection);
  }
  return null;
}

/**
 * Import a STIX bundle into the system
 * @param {Object} collection - The collection to import
 * @param {Object} data - The bundle data containing STIX objects
 * @param {Object} options - Import options
 * @returns {Promise<Object>} The imported collection
 */
module.exports = async function importBundle(collection, data, options) {
  const referenceImportResults = {
    uniqueReferences: 0,
    duplicateReferences: 0,
    aliasReferences: 0,
  };

  const collectionReference = {
    collection_ref: collection.id,
    collection_modified: collection.modified,
  };

  const importedCollection = {
    workspace: {
      imported: new Date().toISOString(),
      exported: [],
      import_categories: {
        additions: [],
        changes: [],
        minor_changes: [],
        revocations: [],
        deprecations: [],
        supersedes_user_edits: [],
        supersedes_collection_changes: [],
        duplicates: [],
        out_of_date: [],
        errors: [],
      },
      import_references: {
        additions: [],
        changes: [],
        duplicates: [],
      },
    },
    stix: collection,
  };

  const contentsMap = new Map();
  for (const entry of collection.x_mitre_contents) {
    contentsMap.set(makeKey(entry.object_ref, entry.object_modified), entry);
  }

  const referenceMap = new Map();
  // Check for duplicate collection
  const duplicateCollection = await checkDuplicateCollection(importedCollection, options);

  // Process all objects in bundle
  await processObjects(
    data.objects,
    options,
    importedCollection,
    contentsMap,
    collectionReference,
    referenceMap,
    referenceImportResults,
  );

  // Import references
  await importReferences(referenceMap, options, importedCollection);

  // Save collection
  return await saveCollection(importedCollection, duplicateCollection, options);
};
