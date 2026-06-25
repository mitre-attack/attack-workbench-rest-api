'use strict';

/**
 * Remove the `revoked` field from all relationship documents.
 *
 * Relationships are never revoked in ATT&CK — they are only deprecated.
 * Approximately half of existing relationship documents carry a legacy
 * `stix.revoked` field (always set to `false`). Its presence is a
 * historical artifact and serves no purpose. This migration strips it
 * from the entire collection for data consistency.
 */

module.exports = {
  async up(db) {
    const collection = db.collection('relationships');

    const result = await collection.updateMany(
      { 'stix.revoked': { $exists: true } },
      { $unset: { 'stix.revoked': '' } },
    );

    console.log(`Removed revoked from ${result.modifiedCount} relationship document(s)`);
  },

  async down() {
    // Cannot distinguish which documents originally had the field.
    console.log('down migration is a no-op: original revoked values cannot be restored');
  },
};
