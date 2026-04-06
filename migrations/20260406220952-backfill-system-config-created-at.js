'use strict';

/**
 * Backfill the `created_at` field on existing system configuration documents.
 *
 * Previously, the system configuration collection contained a single document
 * that was updated in-place. With the move to versioned config documents, each
 * document needs a `created_at` timestamp to enable sorting by recency.
 *
 * This migration sets `created_at` to the current time on any document that
 * does not already have it.
 */
module.exports = {
  async up(db) {
    const result = await db
      .collection('systemconfigurations')
      .updateMany({ created_at: { $exists: false } }, { $set: { created_at: new Date() } });
    console.log(
      `Backfilled created_at on ${result.modifiedCount} system configuration document(s)`,
    );
  },

  async down(db) {
    await db.collection('systemconfigurations').updateMany({}, { $unset: { created_at: '' } });
  },
};
