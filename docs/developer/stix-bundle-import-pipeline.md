# STIX Bundle Import Pipeline

This document describes the internal pipeline that runs when a
client POSTs to `/api/collection-bundles`. For user-facing
documentation of the endpoint's behavior and response shape, see
[`docs/user/stix-bundle-import.md`](../user/stix-bundle-import.md).

For the rules that govern hook and listener behavior during import
(why bundle `stix` content stays byte-faithful through the
pipeline), see [`import-fidelity-contract.md`](./import-fidelity-contract.md).

## Entry points

```
HTTP request
  → app/controllers/collection-bundles-controller.js:importBundle
    → app/services/stix/collection-bundles-service/index.js
      → app/services/stix/collection-bundles-service/import-bundle.js (this pipeline)
```

The controller reads query parameters (`previewOnly`,
`validateContents`, `forceImport`) into an `options` object and
hands the entire bundle and options to `importBundle`.

## Pipeline stages

```
┌────────────────────────────────────────────────────────────────┐
│ 1. Initialize per-import state                                 │
│    - importedCollection skeleton (workspace.import_categories) │
│    - contentsMap from collection.x_mitre_contents              │
│    - referenceMap                                              │
└────────────────────────────────────────────────────────────────┘
                              │
┌────────────────────────────────────────────────────────────────┐
│ 2. Check for duplicate collection                              │
│    - Same stixId + same modified → existing collection         │
│    - forceImport=duplicate-collection: warn, attach a reimport │
│    - Otherwise: throw, abort                                   │
└────────────────────────────────────────────────────────────────┘
                              │
┌────────────────────────────────────────────────────────────────┐
│ 3. processObjects                                              │
│    - Sort objects by dependency order                          │
│    - Group consecutive same-type objects into TIERS            │
│    - For each tier sequentially: processTier(type, objects)    │
│    - Then: report contents-map orphans as "Missing object"     │
└────────────────────────────────────────────────────────────────┘
                              │
┌────────────────────────────────────────────────────────────────┐
│ 4. importReferences (sequential)                               │
│    - Insert or update each unique external_reference           │
└────────────────────────────────────────────────────────────────┘
                              │
┌────────────────────────────────────────────────────────────────┐
│ 5. saveCollection                                              │
│    - Persist x-mitre-collection itself (or append reimport)    │
└────────────────────────────────────────────────────────────────┘
```

## Dependency-ordered tiers

`sortObjectsByDependencies` returns the bundle's objects in this
order (lower numbers persist first):

| Tier | STIX type | Rationale |
|---|---|---|
| 0 | `marking-definition` | No outbound refs to other types |
| 1 | `identity` | No outbound refs to other types |
| 2 | `x-mitre-data-source` | Data components reference these |
| 3 | `x-mitre-data-component` | Analytics reference these |
| 4 | `x-mitre-analytic` | Detection strategies reference these |
| 5 | `x-mitre-detection-strategy` | (depends on analytics) |
| 6 | `attack-pattern` (techniques) | SDOs in general |
| 7 | `x-mitre-tactic` | |
| 8 | `course-of-action` (mitigations) | |
| 9 | `intrusion-set` (groups) | |
| 10 | `campaign` | |
| 11 | `malware` | |
| 12 | `tool` | |
| 13 | `x-mitre-asset` | |
| 14 | `x-mitre-matrix` | |
| 15 | `relationship` | SROs last so their endpoints exist |
| 16 | `note` | |
| 17 | `x-mitre-collection` | The bundle's own collection (skipped here; persisted separately) |

Sort is stable, so within a tier order matches the bundle's order.

## `processTier` — what runs inside one tier

For each tier (objects of a single STIX type, in dependency order):

```
┌────────────────────────────────────────────────────────────────┐
│ A. Synchronous eligibility filter (single pass over tier)      │
│    - contents-map drain (warn on bundle-object-not-in-contents)│
│    - ATT&CK spec-version gate (throws or skips per forceImport)│
│    → eligible[]                                                │
└────────────────────────────────────────────────────────────────┘
                              │
┌────────────────────────────────────────────────────────────────┐
│ B. Bulk pre-fetch existing versions                            │
│    repository.retrieveAllByStixIds(eligible.map(o => o.id))    │
│    → Map<stixId, Array<existingVersion>>                       │
│    One DB query for the entire tier, replacing N retrieveById  │
│    calls from the legacy per-object loop.                      │
└────────────────────────────────────────────────────────────────┘
                              │
┌────────────────────────────────────────────────────────────────┐
│ C. Parallel compose & validate (bounded concurrency, cap 25)   │
│    For each eligible object:                                   │
│    - checkForDuplicate vs pre-fetched versions                 │
│    - categorizeObject (additions/changes/etc.)                 │
│    - processExternalReferences                                 │
│    - service.composeForImport (Zod + workspace.attack_id +     │
│                                fail-open workspace.validation) │
│    - deepFreezeStix(composed) — import-fidelity guard          │
│    - service.beforeCreate(composed, options)                   │
│    - record any validation errors into                         │
│      importedCollection.workspace.import_categories.errors     │
│    - push composed doc into composedToInsert[]                 │
└────────────────────────────────────────────────────────────────┘
                              │
┌────────────────────────────────────────────────────────────────┐
│ D. Bulk insert (one MongoDB insertMany per tier)               │
│    repository.saveMany(composedToInsert)                       │
│    → { inserted: [...], errors: [...writeErrors] }             │
│    writeErrors (ordered:false) → import_categories.errors      │
└────────────────────────────────────────────────────────────────┘
                              │
┌────────────────────────────────────────────────────────────────┐
│ E. Parallel post-insert lifecycle (bounded concurrency, cap 25)│
│    For each inserted doc:                                      │
│    - deepFreezeStix(doc) — import-fidelity guard               │
│    - service.afterCreate(doc, options)                         │
│    - service.emitCreatedEvent(doc, options)                    │
│    afterCreate emits domain events (e.g.                       │
│      'x-mitre-detection-strategy::analytics-referenced')       │
│    that drive INBOUND workspace.embedded_relationships         │
│    population on referenced docs in earlier-finished tiers.    │
└────────────────────────────────────────────────────────────────┘
```

The order of tiers matters because the post-insert listener
cascade in stage E may modify documents from earlier tiers
(e.g. analytics that were persisted in tier 4 receive inbound
embedded_relationships when detection strategies in tier 5 are
processed).

## Concurrency primitives

`runWithConcurrency(items, limit, task)` in `import-bundle.js` is a
small worker-pool helper used in stages C and E. It pulls from a
shared index so each worker fetches the next available item rather
than partitioning ahead of time, which keeps utilization high even
when per-item cost varies (a worker that finishes a cheap doc
immediately picks up the next one).

We do not pull in `p-limit`: it is not a direct dependency of this
project, and recent versions are ESM-only, which doesn't fit a
CommonJS codebase. The helper is small enough to keep inline.

## Bulk persistence primitives

Both new repository methods live on `_base.repository.js` and are
inherited by every concrete repository:

- **`retrieveAllByStixIds(stixIds)`** — single `find({ 'stix.id':
  { $in: ids } })` followed by an in-memory bucket by stixId.
  Returns `Map<stixId, Array<version>>` with versions sorted
  newest-first (matching `retrieveAllById`'s order).

- **`saveMany(dataArr, { ordered })`** — wraps
  `Model.insertMany(dataArr, { ordered: false })`. Returns
  `{ inserted, errors }` where `errors` is a normalized
  `{ index, message, code }` per failed document. `ordered: false`
  ensures one bad document does not abort the rest of the tier.

Both are only invoked from the bundle-import path. The
single-object create/update paths continue to use
`repository.save(data)` and `repository.retrieveLatestByStixId`.

## Error model

The pipeline never throws for per-object failures (except the
ATT&CK spec-version violation without forceImport, which is
considered fatal). Every recoverable error is appended to
`importedCollection.workspace.import_categories.errors` with a
typed `error_type` and as much context as is available. See the
[user doc](../user/stix-bundle-import.md#error-types-in-import_categorieserrors)
for the full error-type taxonomy.

ADM validation errors are recorded in **both** branches:

- `validateContents=true` (strict): the doc is dropped from the
  bulk insert; one entry with full `details` is written.
- `validateContents=false` (fail-open, default): the doc is still
  persisted with `workspace.validation` attached; an entry with
  full `details` is **also** written so the import response
  surfaces the failure up front.

Both branches use `error_type: 'Validation error'` and include
the complete Zod issue list in the entry's `details` field.

## Performance characteristics

The pipeline scales primarily with two factors:

1. **Number of objects in the bundle.** The MongoDB round-trips
   are dominated by per-tier reads and writes, both of which are
   O(1) queries per tier regardless of the number of objects in
   it. The total round-trip count is ~`2 * number_of_tiers`.

2. **Cost of the listener cascade.** Each `afterCreate` that emits
   a domain event triggers a listener that fetches and updates the
   referenced documents. This is currently O(refs) per source
   object — if 10 analytics reference one data component, that
   data component is fetched and saved 10 times. Consolidating
   listener writes per target is a future optimization.

On developer hardware, an Enterprise bundle import that previously
took 5+ minutes completes in 20-60 seconds depending on local
Mongo and CPU.

## Files

| Path | Role |
|---|---|
| [`app/services/stix/collection-bundles-service/import-bundle.js`](../../app/services/stix/collection-bundles-service/import-bundle.js) | The pipeline itself. `processObjects`, `processTier`, `runWithConcurrency`. |
| [`app/services/stix/collection-bundles-service/bundle-helpers.js`](../../app/services/stix/collection-bundles-service/bundle-helpers.js) | Constants for `importErrors`, `forceImportParameters`, `errors`. |
| [`app/services/meta-classes/base.service.js`](../../app/services/meta-classes/base.service.js) | `composeForImport` (validation + workspace fields) and `_createFromImport` (single-object path). |
| [`app/repository/_base.repository.js`](../../app/repository/_base.repository.js) | `retrieveAllByStixIds` and `saveMany`. |
| [`app/lib/validation-schemas.js`](../../app/lib/validation-schemas.js) | ADM schema selection with cached `.partial()` for WIP objects. |
| [`app/lib/import-safety.js`](../../app/lib/import-safety.js) | `deepFreezeStix` enforcement helper. |
