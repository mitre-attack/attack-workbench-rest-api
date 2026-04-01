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

Most ATT&CK object types should be updated by creating a new object with a new `modified` timestamp (POST request). The Collection Index is different and should be updated by modifying (overwriting) the current object (PUT request).

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