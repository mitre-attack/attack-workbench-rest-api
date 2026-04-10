'use strict';

/**
 * Remove the `x_mitre_version` field from all relationship documents.
 *
 * The ATT&CK specification no longer permits `x_mitre_version` on SROs.
 * Legacy relationship documents that still carry this field will fail ADM
 * validation when users attempt to update them through the standard POST
 * workflow. This migration retroactively strips the field so those documents
 * pass validation.
 *
 * All relationships are updated (including deprecated ones) to ensure data
 * consistency across the collection — the field is spec-invalid regardless of
 * lifecycle state.
 */

module.exports = {
  async up(db) {
    const collection = db.collection('relationships');

    const result = await collection.updateMany(
      { 'stix.x_mitre_version': { $exists: true } },
      { $unset: { 'stix.x_mitre_version': '' } },
    );

    console.log(`Removed x_mitre_version from ${result.modifiedCount} relationship document(s)`);
  },

  async down() {
    // Cannot restore original x_mitre_version values — they are not tracked elsewhere.
    console.log('down migration is a no-op: original x_mitre_version values cannot be restored');
  },
};
