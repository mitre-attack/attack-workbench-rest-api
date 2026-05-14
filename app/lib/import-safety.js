'use strict';

/**
 * Import-safety primitives.
 *
 * STIX-bundle import has a strict invariant: when a bundle is imported, the
 * persisted objects must be byte-faithful to the bundle's `stix` content. The
 * import path is allowed to populate Workbench-private metadata (everything
 * under `workspace`), but it must NEVER alter the imported `stix` fields,
 * because the bundle is the source of truth and round-trip fidelity matters
 * for re-imports and downstream consumers.
 *
 * However, the lifecycle hooks and event listeners that fire during a normal
 * create/update — `beforeCreate`, `afterCreate`, and the cross-service
 * listeners on domain events — were not originally written with import
 * fidelity in mind. Several of them mutate `stix.*` as part of their normal
 * work (e.g. AnalyticsService.beforeCreate stamps `stix.name` from the
 * ATT&CK ID; AnalyticsService.handleAnalyticsReferenced rewrites
 * `stix.external_references` to embed a URL to the parent detection
 * strategy). Those mutations are correct for user-driven POST/PUT flows but
 * are incorrect for an import.
 *
 * Rather than rely on convention ("remember to gate every stix write behind
 * `if (!options.import) { ... }`"), we enforce the contract structurally:
 * before invoking any hook or listener in import mode, the framework calls
 * `deepFreezeStix(doc)`. In Node strict mode (`'use strict'` at the top of
 * every service file), an attempted assignment to a frozen property throws
 * a `TypeError`. That makes a missing import gate fail loudly at the
 * violating line on the first import test, instead of silently corrupting
 * bundle content.
 *
 * The local rule for hook/listener authors becomes:
 *
 *   1. Workspace mutations are always allowed.
 *   2. If you need to mutate `stix.*`, wrap the block in
 *      `if (!options.import) { ... }` (or `if (!payload.options?.import)`
 *      inside a listener). The framework guarantees that `options.import`
 *      is the only state where stix is frozen, so a missing gate produces
 *      an immediate TypeError pointing at the offending line.
 *
 * Read freely from frozen stix — only writes are blocked.
 */

/**
 * Deep-freezes the `stix` field of a document so any attempt to write to
 * `doc.stix.*`, including writes through nested arrays/objects (e.g.
 * `doc.stix.external_references.unshift(...)`), throws a `TypeError`.
 *
 * `Object.freeze` is shallow on its own, so we walk the immediate children
 * (one level into nested objects/arrays) and freeze them as well. Two
 * levels is sufficient for STIX in practice: the deepest commonly mutated
 * paths are array elements (e.g. `stix.external_references[i]` or
 * `stix.kill_chain_phases[i]`), which the loop covers.
 *
 * Safe to call multiple times — `Object.isFrozen` short-circuits.
 * Safe to call on Mongoose documents: only the underlying `_doc.stix`
 * subtree is frozen; Mongoose's wrapper accessors remain functional, and
 * Mongoose does not mutate the source object when constructing new
 * documents during save/insertMany.
 *
 * @param {Object} doc - A document of the shape `{ stix, workspace }`, or
 *   a Mongoose document with the same shape. No-op if `doc` or `doc.stix`
 *   is missing.
 */
function deepFreezeStix(doc) {
  const stix = doc?.stix;
  if (!stix || typeof stix !== 'object' || Object.isFrozen(stix)) return;

  Object.freeze(stix);

  for (const value of Object.values(stix)) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) continue;
    Object.freeze(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && !Object.isFrozen(item)) {
          Object.freeze(item);
        }
      }
    }
  }
}

module.exports = {
  deepFreezeStix,
};
