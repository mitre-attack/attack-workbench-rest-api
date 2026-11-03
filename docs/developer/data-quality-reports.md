# Data quality report query design

## Duplicate relationships: September 2026 memory failure

The Data Quality dashboard's Duplicate Relationships function calls
`GET /api/reports/parallel-relationships`. Previously,
`RelationshipsRepository.retrieveParallelRelationships()` called
`retrieveAll({ versions: 'latest', lookupRefs: true })`. That aggregation joined
**every revision** of each source and target object to **every active latest
relationship**. Awaiting `.exec()` materialized the entire expanded result in
Node. Only then did JavaScript group relationships and discard singleton groups;
the reports service subsequently discarded historical endpoint revisions.

This means a small final report can require a very large intermediate heap.
The endpoint history is repeated for each incident relationship, including
relationships that will never appear in the report. Large descriptions and
workspace backrefs further increase each repeated document's size. Concurrent
dashboard reports can add to the process's overall memory demand.

The supplied container log shows V8 exhausting its roughly 4 GB heap. It does
not identify the allocating JavaScript frame, and no production heap snapshot
or database reproduction was available. The code path and synthetic regression
establish a concrete amplification mechanism consistent with that failure,
not a measurement of the exact production allocation.

## Query implementation

1. Sort by STIX ID and descending modified time, project compact selection
   fields, and choose one latest relationship revision per ID.
2. Exclude revoked/deprecated latest revisions. Filtering earlier would
   incorrectly resurrect an older active revision.
3. Group by source, relationship type, and target, retaining MongoDB IDs and
   counts. Discard groups with fewer than two distinct relationship IDs.
4. Unwind matching IDs and retrieve only those full relationship documents.
5. Join each endpoint with a descending modified sort and limit of one.
   Existing `(stix.id, stix.modified descending)` indexes support latest-revision
   access; the relationship hydration lookup uses the existing `_id` index.
6. Consume the aggregation with a 100-document cursor and explicit cursor
   cleanup. Allow disk use for eligible MongoDB aggregation stages.

The repository preserves the existing arrays of endpoint matches (now at most
one entry each), so identity enrichment and the public JSON map stay compatible.
Missing endpoints still preserve findings. Results retain ascending relationship
STIX-ID ordering. No OpenAPI, Bruno, or frontend contract change is required.

MongoDB documents the pipeline form of
[`$lookup`](https://www.mongodb.com/docs/manual/reference/operator/aggregation/lookup/)
and the top-N optimization for
[`$sort` followed by `$limit`](https://www.mongodb.com/docs/manual/reference/operator/aggregation/sort/).

## Evidence and limits

`app/tests/api/reports/parallel-relationships.spec.js` exercises real MongoDB
aggregation and the HTTP endpoint with ADM validation enabled. Its synthetic
history fixture contains 102 latest active relationships, only two duplicates,
and 41 revisions of their shared source, with 8 KiB descriptions on 40 revisions.
The previous query returned 38,162,701 serialized bytes; the replacement returned
23,131 bytes (about 1,650 times smaller). This measures JSON query-result volume,
not peak heap or elapsed time. The test also covers newest relationship selection,
revoked/deprecated latest revisions, singleton exclusion, and missing endpoints.

Database cursor batching is **not HTTP streaming**. The service still retains
all actual duplicate findings, and Express serializes the complete JSON map.
Memory therefore still scales with the real report size. A very large individual
duplicate group also grows MongoDB's grouped ID array; allowing disk use does not
remove all aggregation or BSON size limits.

If real duplicate output itself is excessive, introduce bounded pagination of
group summaries with relationship details loaded on expansion, coordinated with
the frontend and OpenAPI/Bruno contracts. Incremental NDJSON is another option,
but requires response backpressure, disconnect cancellation, error semantics,
and a frontend streaming parser; the existing Angular JSON request waits for a
complete response. Merely streaming the current query or increasing Node's heap
would leave its unnecessary history fan-out intact.

## Release-track coverage

`GET /api/reports/release-track-coverage` uses the existing report authentication
and visitor/read-only-service authorization. The service reuses
`DOMAIN_BEARING_TYPES` as the explicit supported SDO allowlist: `attack-pattern`,
`campaign`, `course-of-action`, `intrusion-set`, `malware`, `tool`,
`x-mitre-analytic`, `x-mitre-asset`, `x-mitre-data-component`,
`x-mitre-data-source`, `x-mitre-detection-strategy`, `x-mitre-matrix`, and
`x-mitre-tactic`. Unlike the domain-consistency report, coverage deliberately
includes revoked and deprecated latest revisions. It does not require an
ATT&CK ID, a domain value, or an active workflow state.

`AttackObjectsRepository.retrieveReleaseTrackCoverage()` performs a single
aggregation over `attackObjects`:

1. Match the supported types and sort by `(stix.id, stix.modified descending)`,
   following the existing latest-revision index and convention.
2. Project only compact identifying fields and two booleans: whether
   `workspace.release_tracks` has BSON type `missing`, and whether it is an
   array with nonzero length. `$isArray` guards `$size`; null and non-array
   values are not membership.
3. Group by STIX ID, retaining the first compact revision and the maximum
   `stix.modified` with nonempty membership (or null if none). There is no
   `$push` of histories, full-document hydration, or identity enrichment.
4. Keep objects with no recorded membership, or a missing latest membership
   key. If membership exists somewhere and the latest key is missing, that
   membership necessarily belongs to an older revision. Explicit empty/null
   latest values are not untracked-latest findings.
5. Sort findings by STIX ID. An indexed self-lookup for each untracked finding
   reads only revisions of that ID at or after the last enrolled timestamp,
   ordered by modified ascending. It groups to one compact enrolled revision
   and a count of strictly later revisions; those later revisions necessarily
   have no nonempty membership. Never-enrolled findings have no lookup match.
   The existing unique `(stix.id, stix.modified descending)` index supports the
   equality/range lookup and reverse date ordering; no new index is required.
6. Consume a 100-document cursor with explicit cleanup and disk use enabled
   for eligible aggregation stages. Partition compact findings into the two
   mutually exclusive arrays. The service deduplicates membership track IDs
   and makes one projected registry read (`track_id`, `name`) for all findings,
   not one network request per finding or revision. It attaches current names
   when available and adds counts directly from the arrays.

The base public object projection is
`{ stix: { id, type, name?, created?, modified?, x_mitre_version? },
workspace: { attack_id? } }`. Missing ATT&CK IDs leave an empty workspace
object. Untracked findings additionally contain `last_enrolled_revision` with
`modified`, optional `x_mitre_version`, and all `release_tracks` on that one
revision, projected to `id`, `type`, `tier`, `status`, and optional current
registry `name`. Deleted/missing/unnamed registry entries retain their
membership ID; consumers display that ID rather than dropping the finding.
No historical embedded names, unrelated membership fields, or internal
classification flags are returned. `unenrolled_revision_count` counts stored
revisions strictly newer than the last enrolled revision, including missing,
empty, or null membership; re-enrollment resets the count, excluding older
gaps. Never-enrolled findings contain only the base projection.

Current backrefs only establish **recorded** membership; removing all backrefs
can make a formerly enrolled object appear in Never Enrolled Objects. This is
not an audit-history API.

The database still scans stored revisions, but grouping state retains one
compact latest revision and one date per object, then one compact enrolled
revision with its memberships and one count per lookup, rather than a history
array. Node memory and the final HTTP response remain proportional to actual
findings and their last-enrolled memberships; cursor batching is not HTTP
streaming. No `$facet` assembles the entire report into a single BSON document,
avoiding that additional report-size limit.

`app/tests/api/reports/release-track-coverage.spec.js` covers latest selection,
multiple enrollment revisions/tracks, reset counts, missing/empty/null
distinctions, current/renamed/deleted/unnamed registry entries, optional latest
metadata, membership restoration, all supported types, inactive revisions,
excluded object types, compact output, missing ATT&CK IDs, deterministic
ordering, and read-only behavior. Enrollment and `track_latest`
synchronization are unchanged.
