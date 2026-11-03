# Data Quality Reports

Read-only analytical endpoints under `/api/reports` that surface content
problems for editors to fix at the source. All require the visitor role or
higher. The Workbench frontend renders them on the dashboard's **Data
Quality** page.

## Missing LinkById references

```
GET /api/reports/link-by-id/missing?type=attack-pattern
```

Objects and relationships whose description mentions `attack.mitre.org`
directly instead of using a `(LinkById: ID)` reference. `type` narrows the
result to one STIX type (`relationship` for relationships only).

## Parallel relationships

```
GET /api/reports/parallel-relationships
```

Latest active (not revoked or deprecated) relationship revisions grouped by
`source_ref--relationship_type--target_ref` where more than one relationship
shares the key — likely duplicates. The
response is a map from that key to the array of relationships, each carrying
its latest `source_object` and `target_object`. Missing endpoints do not remove
a duplicate finding; the corresponding endpoint property is omitted. Historical
revisions of one relationship do not count as separate duplicates.

The report filters duplicates in the database before retrieving endpoint
details, and loads only the latest endpoint revisions. The response remains
a single JSON map, with no pagination or incremental delivery.

## Domain consistency

```
GET /api/reports/domain-consistency
```

Release-track bundles never discover objects through relationships: a
relationship ships only when both of its endpoints are members of the same
track (see [Output Formats](release-tracks/output-formats.md)). Content whose
endpoints can never be members of the same domain track is therefore
unpublishable, and this report lists it:

- `cross_domain_relationships` — latest revisions of active (not revoked, not
  deprecated) relationships whose source and target objects share no
  `x_mitre_domains` value. Each entry is the relationship document plus the
  latest `source_object` and `target_object` and their `source_domains` and
  `target_domains`. Endpoints are evaluated at their latest revision, so
  adding the missing domain in a new revision of the object clears the
  finding. A relationship whose endpoint is missing or declares no domain is
  not listed here.
- `objects_without_domains` — latest revisions of active domain-bearing ATT&CK
  objects (techniques, tactics, groups, software, mitigations, campaigns,
  data sources, data components, assets, matrices, detection strategies,
  analytics) that declare no domain.
- `summary` — counts of both lists.

```json
{
  "cross_domain_relationships": [
    {
      "stix": { "id": "relationship--...", "relationship_type": "uses", "...": "..." },
      "source_object": { "stix": { "id": "intrusion-set--...", "...": "..." } },
      "target_object": { "stix": { "id": "attack-pattern--...", "...": "..." } },
      "source_domains": ["enterprise-attack"],
      "target_domains": ["mobile-attack"]
    }
  ],
  "objects_without_domains": [{ "stix": { "id": "attack-pattern--...", "...": "..." } }],
  "summary": { "cross_domain_relationship_count": 1, "objects_without_domains_count": 1 }
}
```

Fix a finding by revising the object with the domain it belongs to, or by
deprecating the relationship.

## Release-track coverage

```
GET /api/reports/release-track-coverage
```

The **Untracked Latest Revisions** and **Never Enrolled Objects** dashboards
share this read-only report. Each object is evaluated across its stored
revisions, with the greatest `stix.modified` defining the latest revision.

- `untracked_latest_revisions` — the latest revision is **missing the
  `workspace.release_tracks` key**, while at least one older stored revision
  has a nonempty membership array. A latest value of `[]` or `null` does not
  qualify, even when an older revision has membership.
- `never_enrolled_objects` — no stored revision has a nonempty
  `workspace.release_tracks` array. Missing, empty, and null values alone are
  not membership. “Never enrolled” means **no recorded membership**: current
  backrefs cannot prove enrollment never existed and was subsequently removed.
- `summary` — counts of both lists.

Both lists include revoked and deprecated objects and are unique and sorted
by STIX ID. Supported objects are techniques (including sub-techniques),
tactics, groups, malware, tools, mitigations, campaigns, data sources, data
components, assets, matrices, detection strategies, and analytics. Relationships,
identities, notes, marking definitions, and projected collections are excluded.
Objects do not need an ATT&CK ID to appear.

```json
{
  "untracked_latest_revisions": [
    {
      "stix": {
        "id": "attack-pattern--...",
        "type": "attack-pattern",
        "name": "Example technique",
        "modified": "2026-11-03T00:00:00.000Z"
      },
      "workspace": { "attack_id": "T1234" }
    }
  ],
  "never_enrolled_objects": [],
  "summary": {
    "untracked_latest_revision_count": 1,
    "never_enrolled_object_count": 0
  }
}
```

Entries contain only `stix.id`, `stix.type`, optional `stix.name` and
`stix.modified`, and optional `workspace.attack_id`; `workspace` is always an
object. The report does not load descriptions, full histories, or track details.
It is one JSON response without pagination.

Review membership in the appropriate release track before making changes.
Reading either dashboard does not enroll anything or change `track_latest`.
Enabling `track_latest` does not retroactively enroll a latest revision that
already exists. A missing backref on that revision does not by itself prevent
future revisions from being tracked: synchronization can discover the object
by STIX ID in the track's latest standard snapshot, subject to enrollment
policy. The report is a coverage finding, not a diagnosis that future tracking
is broken.
