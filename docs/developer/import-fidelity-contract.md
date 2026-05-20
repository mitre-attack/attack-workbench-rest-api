# Import-Fidelity Contract

When a STIX bundle is imported, the persisted objects must be
**byte-faithful** to the bundle's `stix` content. Workbench may
populate its private `workspace` metadata on each document, but
must not deviate any field under `stix`.

This document defines the contract, explains why it exists, and
tells you how to author hooks, event listeners, and any new code
that runs during a bundle import.

For the broader bundle-import pipeline, see
[`stix-bundle-import-pipeline.md`](./stix-bundle-import-pipeline.md).

## Why the contract exists

Workbench has a richer object model than raw STIX. Lifecycle hooks
and event listeners legitimately normalize and enrich STIX fields
on user-driven flows. A few examples that ship today:

| Service | Hook / listener | Stix mutation |
|---|---|---|
| AnalyticsService | `beforeCreate` | Stamps `stix.name = "Analytic <AN-id>"` |
| AnalyticsService | `handleAnalyticsReferenced` listener | Rewrites `stix.external_references` to embed a URL to the parent detection strategy |
| CampaignsService | `beforeCreate` | Forces `stix.aliases[0]` to equal `stix.name` |
| GroupsService | `beforeCreate` | Same alias normalization as campaigns |
| SoftwareService | `beforeCreate` | Defaults `stix.is_family = true` for malware; normalizes `stix.x_mitre_aliases` |

All five are correct on POST/PUT, where Workbench is the authority
on the object's display values. None of them are correct during an
import: the bundle is the source of truth for `stix.*`, and a
silent rewrite breaks round-trip fidelity and obscures the
provenance of the imported content.

The framework therefore enforces a hard rule:

> **During an import (`options.import === true`), `stix.*` is
> read-only. Workspace fields are still mutable.**

## How the contract is enforced

[`app/lib/import-safety.js`](../../app/lib/import-safety.js) exports
`deepFreezeStix(doc)`. It calls `Object.freeze` on `doc.stix` and on
the immediate children (nested objects, nested arrays, and the
array elements). In Node strict mode (`'use strict'` at the top of
every service file), an attempted write to any frozen property
throws `TypeError` immediately, pointing at the violating line.

The framework calls `deepFreezeStix` at every point where untrusted
code (a hook, a listener) is about to run during an import:

| Location | When |
|---|---|
| `BaseService._createFromImport` | Before `beforeCreate(composed, options)` and before `afterCreate(doc, options)` / `emitCreatedEvent(doc, options)`. |
| `collection-bundles-service/import-bundle.js` (compose worker) | Before each call to `service.beforeCreate(composed, composeOptions)`. |
| `collection-bundles-service/import-bundle.js` (post-insert worker) | Before each call to `service.afterCreate(doc, composeOptions)` and `service.emitCreatedEvent(doc, composeOptions)`. |

Listeners that fetch a related document and mutate it then call
`deepFreezeStix(fetchedDoc)` themselves on entry when their
incoming payload indicates an import is in progress. The pattern
is one line:

```js
if (payload.options?.import) deepFreezeStix(fetchedDoc);
```

The freeze is invisible to non-import paths: `deepFreezeStix` is
only called when the framework or a listener has confirmed
`options.import === true`.

### Why deep, not shallow

`Object.freeze` is shallow. Common stix mutations target nested
structures:

- `analytic.stix.external_references.unshift(...)` (rewrites an array)
- `analytic.stix.external_references[0].external_id = '...'` (mutates an array element)

A shallow freeze would let both succeed silently. `deepFreezeStix`
walks one level into objects and arrays (including array elements)
to cover the cases STIX content actually exhibits. Reads remain
unaffected at any depth.

### Why freeze instead of clone-and-restore

A snapshot-and-restore approach (clone `stix` before each hook,
restore after) would also enforce fidelity, but it requires the
framework to know which side effects to undo and risks leaving
half-written state when a hook mutates nested objects. A freeze
fails closed at the violating line, points the developer at
exactly the code that needs a gate, and adds zero runtime
overhead after the freeze is applied.

## Author rules — writing hooks and listeners

The contract translates into one rule for hook authors:

> Workspace mutations are always allowed. Wrap any `stix.*`
> mutation in `if (!options?.import) { ... }`.

A correctly-shaped `beforeCreate` looks like this:

```js
async beforeCreate(data, options) {
  // Workspace mutations — always allowed.
  data.workspace = data.workspace || {};
  data.workspace.embedded_relationships = buildOutboundRels(data);

  // STIX mutations — gated. The framework freezes data.stix
  // during import, so a missing gate throws a TypeError pointing
  // at the line below on the first import test.
  if (!options?.import) {
    data.stix.name = deriveNameFromAttackId(data.workspace.attack_id);
  }
}
```

And a correctly-shaped listener:

```js
static async handleAnalyticsReferenced(payload) {
  const { detectionStrategy, analyticIds, options } = payload;

  for (const analyticId of analyticIds) {
    const analytic = await analyticsRepository.retrieveLatestByStixId(analyticId);
    if (!analytic) continue;

    // Import-fidelity guard. The framework freezes the doc the
    // emitter saw, but listeners fetch their own related docs —
    // so each listener takes responsibility for freezing what
    // it fetched.
    if (options?.import) deepFreezeStix(analytic);

    // Workspace mutations — always allowed.
    addInboundEmbeddedRelationship(analytic, detectionStrategy);

    // STIX mutations — gated, just like in beforeCreate.
    if (!options?.import) {
      refreshExternalReferencesUrl(analytic, detectionStrategy);
    }

    await analyticsRepository.saveDocument(analytic);
  }
}
```

## Forwarding `options` to listeners

Listeners can only honor the contract if the originating service
forwards its create-options into the emitted event payload. The
three afterCreate emit sites that drive metadata cascades all do
this:

- `DetectionStrategiesService.afterCreate(document, options)`
  passes `options` into every `'x-mitre-detection-strategy::*'`
  emit.
- `AnalyticsService.afterCreate(createdDocument, options)`
  passes `options` into `'x-mitre-analytic::data-components-referenced'`.
- `DataComponentsService.afterCreate(createdDocument, options)`
  passes `options` into `'x-mitre-data-component::data-source-*'`.

If you add a new domain event that may fire during import, do the
same — include `options` in the payload.

## Adding a new hook or listener

Checklist for an author adding code that runs during a bundle
import:

1. **Default to workspace.** If your work can be expressed as
   workspace metadata (an embedded relationship, a derived index,
   a denormalized cache), keep it under `workspace.*` — no gate
   needed.

2. **Gate stix writes.** If you genuinely need to mutate
   `stix.*`, wrap the block in `if (!options?.import) { ... }`.
   Forgetting the gate will not silently break things: the next
   import test will crash with a TypeError pointing at your line.

3. **Listeners freeze what they fetch.** If your listener fetches
   a related document via a repository and may write to its
   `stix.*`, add `if (options?.import) deepFreezeStix(fetched);`
   at the top of the per-document block.

4. **Emit `options` in event payloads.** If your service emits a
   domain event from `afterCreate` / `afterUpdate`, include
   `options` in the payload so downstream listeners can see when
   an import is in progress.

5. **Test it.** Round-trip a bundle through import — export, hash
   the persisted `stix` content of a sample of objects, compare
   to the bundle. If you forgot a gate, you'll have crashed on
   the import attempt before you ever reach the comparison.

## Files

| Path | Role |
|---|---|
| [`app/lib/import-safety.js`](../../app/lib/import-safety.js) | `deepFreezeStix` helper and contract documentation. |
| [`app/services/meta-classes/base.service.js`](../../app/services/meta-classes/base.service.js) | Framework-level freeze in `_createFromImport`. |
| [`app/services/stix/collection-bundles-service/import-bundle.js`](../../app/services/stix/collection-bundles-service/import-bundle.js) | Framework-level freeze in the bulk pipeline. |
| [`app/services/stix/analytics-service.js`](../../app/services/stix/analytics-service.js) | Example of both forms of gate (`beforeCreate` and listener). |
| [`app/services/stix/detection-strategies-service.js`](../../app/services/stix/detection-strategies-service.js) | Example of forwarding `options` into event payloads. |
