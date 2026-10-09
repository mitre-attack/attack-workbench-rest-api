# ATT&CK Workbench REST API

This glossary defines the shared domain vocabulary for the ATT&CK Workbench REST API. Terms are grouped by topic and expanded as concepts across the repository are clarified.

## Language

### Object lifecycle

**Retired revision**:
An object revision marked revoked, deprecated, or both. Retirement belongs to the revision; the deprecation of an object type is a separate concept.
_Avoid_: Deprecated type, retired type

**Active revision**:
An object revision marked neither revoked nor deprecated.

### ADM validation

**Object exemption**:
A configurable rule that excludes matching object revisions from ADM validation. An exemption does not assert that the revision conforms to ADM or exempt it from other Workbench requirements.
_Avoid_: ADM-valid object, validation success

**ADM error bypass**:
A configurable rule that suppresses a specific ADM validation error or converts it to a warning.
_Avoid_: Object exemption

**Validation policy**:
An instance's collection of object exemptions and ADM error bypasses governing how ADM validation applies to object revisions.

**Exemption report**:
An optional account of which object exemptions applied to the revisions evaluated by an operation. A consumer's reporting preferences change the information presented, not the validation policy applied.
_Avoid_: Validation warning

**Validation reconciliation**:
Reevaluation of existing revisions' current ADM diagnostics after a validation policy change. It does not revoke past review decisions or alter published release content.
