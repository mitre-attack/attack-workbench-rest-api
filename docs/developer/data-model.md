# ATT&CK Workbench Data Model

This document provides technical reference information about the data models used in the ATT&CK Workbench REST API.

## Supported Object Types

The ATT&CK Workbench database supports the following ATT&CK object types (with the corresponding STIX types where applicable):

- Collection (x-mitre-collection)
- Matrix (x-mitre-matrix)
- Technique (attack-pattern)
- Group (intrusion-set)
- Software (malware or tool)
- Mitigation (course-of-action)
- Tactic (x-mitre-tactic)
- Data Source (x-mitre-data-source)
- Data Component (x-mitre-data-component)
- Identity (identity)
- Marking Definition (marking-definition)
- Relationship (relationship)
- Collection Index

## Object Versioning and Updates

Persisted STIX revisions are immutable. Change STIX content by creating a new
revision with the same `stix.id` and a newer `stix.modified` timestamp through
POST. PUT on a versioned STIX endpoint is limited to non-exported `workspace`
metadata and returns 409 if the submitted `stix` payload differs from the
stored revision. The Collection Index is not a versioned STIX document and
continues to use overwrite-style PUT.

## Canonical Domain Membership

`stix.x_mitre_domains` is authoritative object data for domain-bearing ATT&CK
objects. Cross-domain content has one revision containing the complete domain
union, such as `["enterprise-attack", "mobile-attack"]`; Workbench does not
store separate domain-narrowed copies of that revision.

ADM validation requires the property before a domain-bearing object leaves the
partial `work-in-progress` workflow. New installations do not seed a
missing-domain bypass. A legacy persisted bypass may remain temporarily when
the migration finds domainless content with no authoritative TOC provenance.
Migration
`20260730230000-backfill-canonical-x-mitre-domains.js` creates replacement
latest revisions for all domainless lineages without rewriting historical
revisions. Domain unions come from persisted canonical collection provenance;
specifically, exact `(object_ref, object_modified)` membership in canonical
collection `x_mitre_contents` TOCs. Broad `workspace.collections` appearance
backrefs are not authoritative because legacy imports also attached them to
secondary graph objects. Unmappable content is left unchanged and reported;
the migration retains legacy validation bypasses rather than fabricate
Enterprise membership. See the
[operator guide](../admin/canonical-domain-migration.md).

## Database Structure

### attackObjects Collection

Most objects are stored in the `attackObjects` collection. This includes objects of the types listed above, except for the Collection Index object.

Objects in the `attackObjects` collection follow a consistent pattern, though each type has a number of properties that are specific to that type:

- The `stix` property holds a STIX formatted object and contains the data that is eligible to be exported
- The `workspace` property holds data used within the workspace to manage the object

### Unique Identifiers

For most objects, the combination of `stix.id` and `stix.modified` uniquely identifies an instance of an object. The `stix.modified` property distinguishes versions of the `stix.id` object.

The `_id` property also uniquely identifies an object, but is not used outside of the MongoDB database. `_id` is necessary because there is no natural property that uniquely identifies an object by itself. `stix.id` is only unique when combined with `stix.modified`.

### Mongoose Discriminator

Objects of multiple types are stored in the `attackObjects` collection. This is done to facilitate simpler lookup of objects that may be of different types, for example, an object that is the `src_ref` or `target_ref` of a `relationship` object.

The Mongoose discriminator capability supports storing multiple object types in a single collection, while still using a schema that is specific to each object type.

The `__t` property is created and managed by Mongoose to distinguish between the different types of objects stored in the `attackObjects` collection.

### Runtime Allowed Values Configuration

`AllowedValuesConfiguration` is a singleton MongoDB document with
`_id: "allowed-values"`. It stores property/domain `rules` keys separately from
value rows, so a configured group can remain empty. Each row has an ObjectId,
object type, property, domain, value, and enabled state. This is application
configuration, not STIX content or object history.

#### Catalog and file dependencies

`app/lib/allowed-values-catalog.js` builds the catalog when its module loads:

- The bundled `app/config/allowed-values.json` registers the supported
  object/property pairs and initial rule keys. Its values supply suggestions
  for non-enum fields.
- `getSchema` in `app/lib/validation-schemas.js` supplies the installed ADM
  partial object schemas. The catalog reads enum choices from Zod and checks
  each candidate in its object-type/domain context. Software must satisfy both
  tool and malware schemas; related-asset sectors use their nested context.
- Data-source/component strings use ADM's custom validator. Seed suggestions
  are examples, not an exhaustive list of permissible strings.
- `admVersion` comes from the installed ADM package's `package.json`, alongside
  the schemas used for validation. `/catalog` returns both the version and
  definitions; the frontend displays that version and uses those definitions.

The catalog is immutable for the process lifetime. Upgrading the installed
package requires restarting the backend to rebuild it; reload the UI to fetch
the new catalog. Runtime settings are read from MongoDB, not cached with it.

The bundled JSON remains a dependency on an initialized database:
`retrieveAllowedValues` also uses its object/property/domain layout and ordering
to construct the nested dropdown response. `ALLOWED_VALUES_PATH` overrides only
the file read for initial values, not these bundled metadata uses. Do not remove
the bundled file on the assumption that seeding is its only role.

#### Initialization and writes

`checkSystemConfiguration` calls the Allowed Values service during startup.
If the singleton is absent, the service reads the configured seed file,
validates all scopes and values, and inserts the configuration with atomic
`$setOnInsert`. Existing configuration is not reseeded. For legacy documents
missing rule keys, an aggregation update combines initial keys with persisted
row scopes while retaining the rows.

Creation requires an absent rule key and adds its key and values in one update.
Replacement requires an existing key and filters/replaces that group's rows
inside MongoDB. Concurrent saves to different groups retain both changes;
duplicate creation has one winner. No multi-document transactions are required.

Every option, including disabled options, must pass ADM field and contextual
validation before a write. Duplicate object-type/value combinations are rejected.
General STIX validation flags and Validation Bypasses do not participate in
these checks. `/validate` offers the same candidate check without persistence;
create and update still validate their own requests.

#### Reads and invalid legacy settings

`projectRules` groups saved rows by property/domain, combining equal value/state
pairs across object types. On every read it separates compliant `values` from
`invalidValues`, which carry rejection reasons. The dropdown response excludes
invalid or disabled rows.

This is the entire quarantine mechanism: no rows are moved, no quarantine flag
is stored, and no stored enabled flag is changed. An ADM upgrade can therefore
change how a retained row is classified. The admin editor omits invalid rows
from its replacement payload and warns before saving; that save removes them.
Existing STIX objects are not modified.

#### Extending supported choices

For an existing enum property, a new ADM enum member is discovered from the
upgraded backend package; it does not also need a JSON entry. Add it to the seed
only if new configurations should enable it by default. Existing databases still
need an administrator to enable new, unconfigured choices. Formatted values can
be added without a library change when the current ADM validator accepts them.

A new property/object-type pair is different: register it in Workbench, confirm
the schema mapping and editor support, and retain ADM validation. The admin
workflow does not create arbitrary schema properties. See the
[operator procedures](../admin/configuration.md#allowed-values) for initialization,
adding values, ADM upgrades, and API usage.

## Sample Objects

### Technique Object Example

```json
{
    "_id": ObjectId("5fb1b9d8e1af0600177092ec"),
    "__t": "Technique",
    "stix": {
            "id": "attack-pattern--15dbf668-795c-41e6-8219-f0447c0e64ce",
            "type": "attack-pattern",
            "name": "Permission Groups Discovery",
            "created": "2017-05-31T21:30:55.471Z",
            "modified": "2020-10-08T17:36:01.675Z",
            "created_by_ref": "identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5",
            "description": "Adversaries may attempt to find group and permission settings. This information can help adversaries determine which user accounts and groups are available, the membership of users in particular groups, and which users and groups have elevated permissions.",
            "spec_version": "2.1",
            "external_references": [
                {
                    "source_name": "mitre-attack",
                    "external_id": "T1069",
                    "url": "https://attack.mitre.org/techniques/T1069"
                },
                {
                    "external_id": "CAPEC-576",
                    "source_name": "capec",
                    "url": "https://capec.mitre.org/data/definitions/576.html"
                }
            ],
            "object_marking_refs": [
                "marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168"
            ],
            "kill_chain_phases": [
                {
                    "kill_chain_name": "mitre-attack",
                    "phase_name": "discovery"
                }
            ],
            "x_mitre_is_subtechnique": false,
            "x_mitre_contributors": [
                "Microsoft Threat Intelligence Center (MSTIC)"
            ],
            "x_mitre_platforms": [
                "Linux",
                "macOS",
                "Windows",
                "Office 365",
                "Azure AD",
                "AWS",
                "GCP",
                "Azure",
                "SaaS"
            ],
            "x_mitre_permissions_required": [
                "User"
            ],
            "x_mitre_detection": "System and network discovery techniques normally occur throughout an operation as an adversary learns the environment. Data and events should not be viewed in isolation, but as part of a chain of behavior that could lead to other activities, such as Lateral Movement, based on the information obtained.\n\nMonitor processes and command-line arguments for actions that could be taken to gather system and network information. Remote access tools with built-in features may interact directly with the Windows API to gather information. Information may also be acquired through Windows system management tools such as [Windows Management Instrumentation](https://attack.mitre.org/techniques/T1047) and [PowerShell](https://attack.mitre.org/techniques/T1059/001).",
            "x_mitre_data_sources": [
                "Stackdriver logs",
                "GCP audit logs",
                "AWS CloudTrail logs",
                "Azure activity logs",
                "Office 365 account logs",
                "API monitoring",
                "Process monitoring",
                "Process command-line parameters"
            ],
            "x_mitre_version": "2.2"
    },
    "workspace": {
        "domains": ["attack-enterprise"]
    }
}
```

## Object References and LinkById

The REST API supports linking between objects using a reference mechanism called LinkById.

### LinkById Format

When one object references another, it uses the format `(LinkById: ref)` where `ref` is the external ID of the referenced object. This is stored in the database as part of the object's text properties (typically the description).

Additionally, an external reference is added to the object with:

- `source_name`: the external ID of the referenced object
- `url`: the URL of the referenced object
- `description`: the name of the referenced object

### Example of LinkById

Object containing the LinkById to another object:

```js
{
  stix: {
    name: 'Initial Object';
    description: 'This is a reference to another object (LinkById: S0565).';
    external_references: [
      {
        source_name: 'mitre-attack',
        url: 'https://attack.mitre.org/techniques/T9901',
        external_id: 'T9901',
      },
      {
        source_name: 'S0565',
        url: 'https://attack.mitre.org/software/S0565',
        description: 'Referenced Object',
      },
    ];
  }
}
```

### Export Behavior

When exporting objects, LinkById references are converted to Markdown links in the format `[description](url)`, making them human-readable in exported content.
