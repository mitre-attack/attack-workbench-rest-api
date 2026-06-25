'use strict';

const os = require('os');
const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');

const AUTOMATION_RUN_SCHEMA_VERSION = 1;
const AUTOMATION_RUNS_COLLECTION = 'automationRuns';
const AUTOMATION_RUN_ITEMS_COLLECTION = 'automationRunItems';

async function ensureIndexes(db) {
  await Promise.all([
    db.collection(AUTOMATION_RUNS_COLLECTION).createIndex({ run_id: 1 }, { unique: true }),
    db.collection(AUTOMATION_RUNS_COLLECTION).createIndex({ automation_type: 1, started_at: -1 }),
    db.collection(AUTOMATION_RUNS_COLLECTION).createIndex({ name: 1, started_at: -1 }),
    db.collection(AUTOMATION_RUN_ITEMS_COLLECTION).createIndex({ run_id: 1, sequence: 1 }),
    db.collection(AUTOMATION_RUN_ITEMS_COLLECTION).createIndex({ run_id: 1, status: 1 }),
    db
      .collection(AUTOMATION_RUN_ITEMS_COLLECTION)
      .createIndex({ 'target.stix_id': 1, recorded_at: -1 }, { sparse: true }),
  ]);
}

function serializeError(error) {
  if (!error) return null;

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

class AutomationRunRecorder {
  constructor(db, options) {
    this.db = db;
    this.runId = options.runId || uuidv4();
    this.automationType = options.automationType;
    this.name = options.name;
    this.trigger = options.trigger || {};
    this.scope = options.scope || {};
    this.metadata = options.metadata || {};
    this.startedAt = new Date();
    this.sequence = 0;
    this.runsCollection = db.collection(AUTOMATION_RUNS_COLLECTION);
    this.itemsCollection = db.collection(AUTOMATION_RUN_ITEMS_COLLECTION);
  }

  async start() {
    await ensureIndexes(this.db);

    await this.runsCollection.insertOne({
      schema_version: AUTOMATION_RUN_SCHEMA_VERSION,
      run_id: this.runId,
      automation_type: this.automationType,
      name: this.name,
      status: 'running',
      started_at: this.startedAt,
      finished_at: null,
      trigger: this.trigger,
      scope: this.scope,
      runtime: {
        hostname: os.hostname(),
        pid: process.pid,
        node_version: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      metadata: this.metadata,
      counts: {},
      warnings: {},
      verification: {},
      summary: null,
      error_summary: null,
      items: {
        collection: AUTOMATION_RUN_ITEMS_COLLECTION,
      },
    });

    return this;
  }

  async recordItem(item) {
    this.sequence += 1;

    await this.itemsCollection.insertOne({
      schema_version: AUTOMATION_RUN_SCHEMA_VERSION,
      run_id: this.runId,
      automation_type: this.automationType,
      name: this.name,
      recorded_at: new Date(),
      sequence: this.sequence,
      ...item,
    });
  }

  async finish({ status, counts, warnings, verification, summary, errorSummary }) {
    await this.runsCollection.updateOne(
      { run_id: this.runId },
      {
        $set: {
          status,
          finished_at: new Date(),
          counts: counts || {},
          warnings: warnings || {},
          verification: verification || {},
          summary: summary || null,
          error_summary: errorSummary || null,
        },
      },
    );
  }

  log(level, message, details) {
    const prefix = `[${this.automationType}:${this.name}][${this.runId}]`;
    const formattedMessage = details
      ? `${prefix} ${message} ${JSON.stringify(details)}`
      : `${prefix} ${message}`;

    if (typeof logger[level] === 'function') {
      logger[level](formattedMessage);
    } else {
      logger.info(formattedMessage);
    }
  }
}

async function createAutomationRunRecorder(db, options) {
  const recorder = new AutomationRunRecorder(db, options);
  return recorder.start();
}

module.exports = {
  AUTOMATION_RUN_SCHEMA_VERSION,
  AUTOMATION_RUNS_COLLECTION,
  AUTOMATION_RUN_ITEMS_COLLECTION,
  createAutomationRunRecorder,
  serializeError,
};
