# CRUD Regression Test Taxonomy

## Overview

Almost every ATT&CK object type (techniques, tactics, groups, software, mitigations,
assets, data sources, data components, campaigns, …) is served by a thin
`*-service.js` that extends [`BaseService`](../../app/services/meta-classes/base.service.js).
The HTTP controllers are equally thin. This means the **business logic exercised by
the regression suites is overwhelmingly shared**: the create/update/delete behavior
lives in `BaseService`, and each per-type suite is, in effect, re-testing the same
pipeline with a different `stix.type`.

This document does two things:

1. Maps the POST execution stack so we know exactly what behavior each suite is
   (or should be) exercising.
2. Defines a **taxonomy of evaluations** — a checklist of shared behaviors — so that
   when we refactor a suite to run with ADM validation on, we converge on a common,
   consistent set of test cases instead of re-deriving them per type.

The taxonomy is the starting contract. Type-specific behavior (e.g. subtechnique
conversion, matrix external IDs) layers on top of it.

## Execution stack: `POST /api/techniques`

Techniques are representative — `TechniquesService` does **not** override `create`,
so the whole path is `BaseService` logic shared by nearly every type.

```
techniques-controller.js  exports.create
  └─ techniquesService.create(req.body, options)        // options: { import, userAccountId, parentTechniqueId, dryRun }
       └─ BaseService.create(data, options)             // app/services/meta-classes/base.service.js
            1. ANALYZE REQUEST
            2. COMPOSE OBJECT
            3. SET SERVER-CONTROLLED FIELDS
            4. LIFECYCLE HOOKS  (beforeCreate)
            5. VALIDATE WITH ADM (validateComposedObject → getSchema)
            6. PERSIST          (repository.save → afterCreate → emit event)
  └─ 201 + created object   |   200 + composed object (dryRun)   |   409 DuplicateId   |   400 ADM/validation
```

### What each stage does (and which fields it touches)

| Stage | Behavior | Key fields |
| --- | --- | --- |
| 1. Analyze | Reject if `stix.type !== service.type`. Look up existing versions by `stix.id` to decide **new object vs. new version** and whether to reuse the ATT&CK ID. | `stix.type`, `stix.id` |
| 2. Compose | `stripServerControlledFields` → strip empty strings → normalize dates → **generate or reuse the ATT&CK ID** → build and prepend the ATT&CK external reference. | `workspace.attack_id`, `external_references[0]`, `revoked`, `x_mitre_attack_spec_version` |
| 3. Set server fields | Set spec version; set `stix.id`/`created` (new object) or carry `revoked` forward (new version); default `modified`/`spec_version`; set identity refs; apply default markings; record `created_by_user_account`. | `stix.id`, `created`, `modified`, `created_by_ref`, `x_mitre_modified_by_ref`, `object_marking_refs`, `workspace.workflow` |
| 4. Hooks | `beforeCreate` — per-type transforms (most types: no-op). | (varies) |
| 5. Validate | `validateComposedObject` runs ADM `getSchema(type, status)` on the **composed** `stix`. WIP → partial schema; otherwise full schema. 400 on failure. | all |
| 6. Persist | `repository.save` (409 on duplicate `id`+`modified`), `afterCreate`, emit `created` event. `dryRun` returns the composed object with `200` and skips persistence. | all |

> Validation runs on the **server-composed** object, not the raw request body. A test
> only needs to send a body that is valid *after* the server fills in `id`,
> `external_references`, `created_by_ref`, etc. This is why work-in-progress payloads
> can omit `stix.id` and the ATT&CK reference and still pass.

## Field provenance model

The single most important concept for refactoring tests is knowing **who owns each
field**. Three categories:

### Server-controlled (client values are stripped / overwritten — do not assert that what you sent comes back)

| Field | Behavior | Source |
| --- | --- | --- |
| `workspace.attack_id` | Stripped, then generated (new) or reused (new version). | `stripServerControlledFields`, `attackIdGenerator` |
| `external_references[0]` (the `mitre-attack` ref) | Any client-supplied ATT&CK ref is filtered out; server prepends the canonical one. `external_references[0].external_id` always mirrors `workspace.attack_id`. | `stripServerControlledFields`, `createAttackExternalReference` |
| `x_mitre_attack_spec_version` | Always stripped, then set to `config.app.attackSpecVersion`. | `ALWAYS_STRIPPED_STIX_FIELDS` |
| `revoked` | Always stripped, then `false` (new) or carried forward (new version). | `ALWAYS_STRIPPED_STIX_FIELDS` |
| `created_by_ref` | Overwritten with the org identity **on new objects** (preserved on new versions). | step 3 |
| `x_mitre_modified_by_ref` | Overwritten with the org identity (new and new version). | step 3 |
| `workspace.validation` | Stripped on every create/update. | `stripServerControlledFields` |
| `workspace.workflow.created_by_user_account` | Set from the authenticated user. | step 3 |

### Hybrid (client may supply; server defaults when omitted)

| Field | Provided | Omitted |
| --- | --- | --- |
| `stix.id` | Honored verbatim (and, if it already exists, makes this a **new version**). | Generated as `${type}--${uuidv4}`. |
| `stix.created` | Honored. | Defaulted to "now" **for new objects only**; on a new version it is taken from the request as-is. |
| `stix.modified` | Honored. | Defaulted to "now" (new objects and new versions). |
| `stix.spec_version` | Honored. | Defaulted to `'2.1'`. |
| `object_marking_refs` | Honored. | Default marking definitions applied. |

### Client-controlled (round-trip faithfully; safe to assert equality)

Everything else: `name`, `description`, `kill_chain_phases`, `x_mitre_platforms`,
`x_mitre_domains`, `x_mitre_detection`, user-provided non-ATT&CK `external_references`,
`workspace.workflow.state`, etc. These must be ADM-valid but are stored as sent.

## The taxonomy

Each category below is a shared behavior that should be evaluated by (nearly) every
SDO suite. IDs are stable handles for cross-referencing during the refactor.

### A. Request shape & type

- **A1 — Empty body rejected.** `POST` with `{}` → 400.
- **A2 — Type mismatch rejected.** `stix.type` not matching the endpoint → 400 (`InvalidTypeError`).
- **A3 — ADM validation enforced.** A body that is ADM-invalid after composition → 400, and the
  response/server log carries the per-field `details` (see the validation logging fix).

### B. STIX identity (`stix.id`)

- **B1 — Generated when omitted.** Response `stix.id` is defined and matches `${type}--<uuidv4>`.
- **B2 — Honored when provided.** A client-supplied `stix.id` is returned unchanged.
- **B3 — Duplicate `(id, modified)` rejected.** Re-POST of the same id+modified → 409.

### C. Timestamps (`stix.created`, `stix.modified`)

- **C1 — `modified` generated when omitted.**
- **C2 — `created`/`modified` honored when provided.**
- **C3 — New version bumps `modified`.** Same `stix.id`, different `modified` → second version
  created (`versions=all` returns N, default GET returns latest by `modified`).
- **C4 — `created` is stable across versions** (client carries it forward; server does not rewrite it on a new version).

### D. ATT&CK ID idempotency (`workspace.attack_id` ↔ `external_references[0].external_id`)

- **D1 — Generated for a new object** in the correct format for the type (`T####`, `TA####`, `G####`, …).
- **D2 — Mirrored into `external_references[0].external_id`** with `source_name: 'mitre-attack'`.
- **D3 — User cannot set it.** A client-supplied `workspace.attack_id` or `mitre-attack`
  external reference is stripped; the server value wins.
- **D4 — Reused across revisions.** A new version of an existing `stix.id` keeps the original
  `attack_id` regardless of what the client sends (omit / keep / change → same result).
- **D5 — Searchable by ATT&CK ID.** `GET ?search=<attack_id>` returns the object.

### E. Server-controlled STIX fields

- **E1 — `x_mitre_attack_spec_version`** equals `config.app.attackSpecVersion` regardless of input.
- **E2 — `revoked`** is `false` on a new object; **carried forward** on a new version; never settable by the client.
- **E3 — `created_by_ref` / `x_mitre_modified_by_ref`** set to the org identity (not the client's value) on create.
- **E4 — Default marking definitions** applied when `object_marking_refs` is omitted.

### F. Workspace / workflow

- **F1 — `created_by_user_account`** recorded from the authenticated session.
- **F2 — `workspace.attack_id`/`workspace.validation`** never accepted from the client.
- **F3 — Workflow state drives validation strictness.** `work-in-progress` → partial schema
  (drafts may omit fields); `awaiting-review`/`reviewed` → full schema.

### G. Lifecycle & retrieval (the existing CRUD coverage, restated)

- **G1 — Create → 201**, returns the composed object.
- **G2 — Retrieve** by collection, by id, by id+modified; latest-version semantics.
- **G3 — Update (PUT)** returns 200; preserves server-controlled fields from the stored doc
  (`attack_id`, `revoked`, `x_mitre_is_subtechnique`, spec version).
- **G4 — Delete** by id+modified (one version) and by id (all versions).
- **G5 — `dryRun=true`** returns 200 + composed object and **persists nothing** (subsequent GET is empty).

### H. Negative / not-found

- **H1 — GET/DELETE unknown id** → 404.
- **H2 — Malformed parameters** → 400.

## How `PUT` (update) differs from `POST`

`updateFull` reuses the same strip/normalize helpers but **composes server-controlled
fields from the stored document** rather than generating them:

- `attack_id`, `revoked`, `x_mitre_attack_spec_version`, and the ATT&CK
  `external_references[0]` are taken from the existing document.
- `x_mitre_is_subtechnique` is preserved from the stored doc (changing it requires the
  dedicated conversion endpoints, not the generic update path).
- `workspace.validation` is cleared once validation passes.

So categories **D, E** apply to PUT as "carried forward from the stored doc" rather than
"generated".

## Applicability matrix

| Category | SDOs (technique, tactic, group, software, mitigation, asset, …) | Matrices | Marking definitions / Identities | Relationships |
| --- | --- | --- | --- | --- |
| A, B, C, G, H | ✅ | ✅ | ✅ | ✅ |
| D (ATT&CK ID) | ✅ | ⚠️ external_id is the domain name, not an auto ID | ❌ no ATT&CK ID | ❌ |
| E1, E2 | ✅ | ✅ | partial | partial |
| E3 (identity refs) | ✅ | ✅ | ⚠️ identities created during bootstrap | ✅ |
| F3 (WIP vs full) | ✅ | ✅ | ✅ (simple schema) | ✅ |

Types in the ⚠️/❌ columns get the shared categories that apply plus a small set of
type-specific cases; they should **not** re-implement the categories that don't apply.

## Test suite organization

A per-type capability (techniques, tactics, …) is covered by **several spec files split
by behavior**, not one monolith. Using `app/tests/api/techniques/` as the model:

| Spec | Scope | Taxonomy categories |
| --- | --- | --- |
| `<type>.spec.js` | Core CRUD lifecycle | A, B, C, E, F, G, H |
| `<type>-pagination.spec.js` | Pagination (offset/limit/`includePagination`) | G2 (read) |
| `<type>.query.spec.js` | GET filter parameters (`search`, `state`, `includeRevoked`, domains, …) | G2 (read) |
| `<type>.convert.spec.js` | Type-specific endpoints (e.g. sub/technique conversion) | type-specific |
| `<type>.tactics.spec.js` | Type-specific relationship endpoints | type-specific |
| `<type>.revoke.spec.js` | Revoke workflow | type-specific |

**This decomposition is correct and should be preserved.** Each file is cohesive, names
its failures clearly, and can be run alone. The decomposition is not the problem; the
inconsistencies within it are. When refactoring, fix these and **do not** collapse files:

- **One fixture per type.** Today each spec defines its own `initialObjectData` and they
  have drifted. Converge on a single shared ADM-compliant baseline per type (see the
  refactor steps below) so an ADM rule change is fixed in one place, not six.
- **Consistent naming.** Use `.` separators (`<type>.pagination.spec.js`), not a mix of
  `-` and `.`.
- **Put search/filter tests in `.query`**, not in the core CRUD spec.

### Bootstrapping styles (choose deliberately)

Three ways a suite gets the database into a known state are in use. All are legitimate;
the choice should be intentional:

1. **HTTP-driven** (`request(app).post(...)`) — exercises the *full* stack: OpenAPI request
   validation → controller → service → ADM validation → persistence. Use this when the
   behavior under test **is** the HTTP contract (the core CRUD spec, convert, revoke).
2. **Service-driven** (`service.create(...)`) — seeds state by calling the service directly.
   Faster and less verbose, but **bypasses the controller and OpenAPI request-validation
   middleware**. ADM validation still runs (it lives in `BaseService.create`), so seeded
   fixtures must still be ADM-compliant. Use this to set up *preconditions* for tests whose
   real subject is reads/queries (`query`, `pagination`).
3. **Bundle-import** (collection bundle JSON via the import path) — seeds many related
   objects at once. Use for relationship/graph-shaped fixtures (`tactics`).

> Refactor consequence: because service-driven and bundle-import seeding still run ADM
> validation, the `query`, `pagination`, and `tactics` fixtures need the **same**
> compliance fixes as the core spec — they are not exempt just because they skip HTTP.

## Test independence

The industry baseline is **F.I.R.S.T.**: Fast, **Independent**, Repeatable,
Self-validating, Timely. "Independent" means a test establishes its own preconditions and
passes regardless of execution order or what ran before it.

The distinction that matters in practice is **what** a test depends on:

- Depending on a **`before`/`beforeEach` hook** for shared state — ✅ good. The dependency
  is explicit and re-established on every run; tests within the block stay order-independent.
- Depending on a **previous `it` block having executed** — ⚠️ fragile. Mocha runs in
  definition order and never randomizes, so it works, but you cannot run a single `it` in
  isolation (`it.only`), and a failure mid-chain cascades into misleading downstream
  failures.

**The one sanctioned exception** is a deliberately **sequential CRUD/E2E narrative**
(create → read → update → new version → delete) where per-test bootstrapping would be
wasteful and the *flow itself* is the thing under test. This is idiomatic for integration
suites — provided it is **deliberate and contained**:

- keep it in a single `describe` with its own database lifecycle (`before`/`after`),
- comment it as an intentional sequential flow,
- keep the chain short; pull shared preconditions into `before` rather than relying on a
  sibling `it` wherever practical.

### Policy

- **Core CRUD spec** (`<type>.spec.js`): a sequential narrative is acceptable — label it as
  such. Everything else should be hook-seeded and order-independent.
- **Feature specs** (`query`, `pagination`, `convert`, `tactics`, `revoke`): seed shared
  state in `before`/`beforeEach`; individual `it` blocks must not depend on a sibling `it`.
- **Never** rely on cross-*file* state. Each spec owns its database lifecycle.

## Using this during the refactor

For each suite we convert to ADM-on:

1. Build a single ADM-compliant `initialObjectData` for the type (state at rest, fully
   composed — see [`techniques.spec.js`](../../app/tests/api/techniques/techniques.spec.js)).
2. Walk the taxonomy and confirm the suite exercises each applicable category, adding the
   missing ones (the `stix.id`/`created`/`modified` provided-vs-omitted cases and the
   ATT&CK-ID idempotency cases **D3/D4** are the ones most commonly absent today).
3. Do **not** assert that server-controlled fields echo the client's input — assert the
   server's rule instead (e.g. "`attack_id` is defined and matches `T####`", not
   "`attack_id === 'T9999'`").

Once the taxonomy is encoded once (ideally as shared assertion helpers in
`app/tests/shared/`), each per-type suite shrinks to: a valid baseline object + the
type-specific deltas.
