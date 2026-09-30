# ATT&CK Workbench REST API — Agent Guide

Node.js/Express + MongoDB (Mongoose) REST API for managing ATT&CK objects
(STIX 2.x). Part of the multi-repo ATT&CK Workbench ecosystem.

## Related repositories and local environment

Machine-specific absolute paths live in `AGENTS.local.md` at the repo root
(gitignored). If it does not exist, copy `AGENTS.local.example.md` to
`AGENTS.local.md` and fill in the values — or ask the developer. Consult it
before searching the filesystem for any of the resources below.

- **Sibling Workbench repos** — conventionally cloned side-by-side under one
  parent directory: `attack-workbench-frontend` (Angular UI that consumes this
  API), `attack-workbench-deployment` (Docker Compose configs),
  `attack-workbench-taxii-server`. Use them when you need consumer or
  deployment context.
- **ADM (ATT&CK Data Model)** — the installed
  `@mitre-attack/attack-data-model` package determines runtime validation.
  Consult its Zod schemas when authoring payloads and regression tests.
  A local source checkout is useful for investigation; check its version
  against the installed package before treating its shapes as current.
- **Bruno API collection** — manual smoke-test requests maintained outside
  this repo (see Bruno section below).

## Read the docs first

Before designing or coding, read the relevant docs — they explain the API
surface, system design, and adopted patterns. Do not re-derive them from code:

- `docs/README.md` — index of all documentation
- `docs/user/**` — endpoint behavior and workflows (describes *what is*)
- `docs/developer/**` — architecture and patterns (describes *why and how*),
  notably: `data-model.md`, `event-bus-architecture.md`,
  `cross-service-reads-pattern.md`, `service-exception-middleware.md`,
  `crud-regression-test-taxonomy.md`, and `release-tracks/`
- `CONTRIBUTING.md` — branching and commit conventions

## Architecture

Layered request pipeline; keep new code in the matching layer:

```
app/routes/*-routes.js        Express routers + authn/authz middleware.
                              Auto-mounted by routes/index.js (any *-routes.js).
app/controllers/              Parse & validate requests (Zod), delegate to a
                              service, forward errors via next(). No business logic.
app/services/                 Business logic. meta-classes/base.service.js is the
                              generic CRUD base (create pipeline: strip
                              server-controlled fields → generate ATT&CK ID →
                              compose → ADM-validate → save). Facade pattern for
                              multi-service domains (e.g. release-tracks-service.js).
app/repository/               Mongo access; _base.repository.js is the generic base.
app/models/                   Mongoose schemas. STIX documents have the shape
                              { workspace: {...}, stix: {...} }.
```

Key mechanics:

- **Validation is layered**: (1) `express-openapi-validator` against
  `app/api/definitions/openapi.yml` (+ `paths/*.yml`, `components/*.yml`);
  (2) Zod request schemas in controllers (newer endpoints validate bodies/query
  in Zod, with the OpenAPI schema kept loose); (3) ADM validation of the
  composed STIX object (`config.validateRequests.withAttackDataModel`).
  `work-in-progress` objects use ADM *partial* schemas (fields may be omitted,
  but present fields must be valid); all other workflow states use full schemas.
  Validation-bypass rules (`/api/config/validation-bypasses`) can suppress
  specific ADM errors.
- **Every query parameter must be declared in the OpenAPI paths YAML** or the
  validator rejects the request. Comma-separated list params need
  `allowReserved: true` and a loose `oneOf` string/array schema, with real
  validation in Zod.
- **Server-controlled fields**: on create, the server strips client-supplied
  ATT&CK external references and `workspace.attack_id` (then generates them),
  strips `revoked` and `x_mitre_attack_spec_version`, and stamps
  `created_by_ref` with the organization identity.
- **Event-driven architecture**: cross-service *writes* must go through the
  EventBus (`app/lib/event-bus.js`); direct repository *reads* across services
  are permitted (see `cross-service-reads-pattern.md`).
- **Errors**: throw typed exceptions from `app/exceptions`; centralized
  handlers in `app/lib/error-handler.js` map them to HTTP responses.
- **Config**: convict-based, `app/config/config.js`, env-var driven.

## Commands

```bash
npm run lint                              # eslint (includes prettier rules)
npm run format                            # prettier + eslint --fix
npm run test:file -- <path/to/spec.js>    # one spec file
npm run test:api                          # all API regression tests (~1-2 min)
npm test                                  # full suite: openapi + config + api + middleware
```

Tests use `mongodb-memory-server` — no external MongoDB or env setup needed.

## Task workflow

1. **Keep working notes local**: use the gitignored root `TODO.md` for plans
   and `FRONTEND_TODO.md` for temporary frontend handoffs. Create them only
   when needed; a fresh clone need not contain either file. Never stage or
   force-add them, recreate planning logs under `docs/`, or link published
   documentation to local notes. Other scratch artifacts (scripts, datasets,
   session notes) belong in `.nocommit/` (gitignored).
2. **Definition of done** — a task is complete only when it includes:
   - implementation,
   - regression tests (see below),
   - test verification, strictly in this order: run the relevant spec files
     with `npm run test:file -- <path>` while iterating, then run the **full**
     `npm test` suite — all of it must pass before the task is done,
   - OpenAPI spec updates for any API-surface change,
   - documentation of current behavior in `docs/user/**` and `docs/admin/**`,
     and contracts/design decisions in `docs/developer/**`; keep task checklists,
     execution transcripts, test-run tallies, and proposed commit messages in
     local notes or the final response, not tracked documentation,
   - Bruno collection updates for any API-surface change,
   - a proposed conventional commit message.
3. **Commits**: conventional commits are enforced (commitlint +
   semantic-release; see `CONTRIBUTING.md`). Propose the message (type(scope):
   imperative subject + body); do not run `git commit` unless asked. Put
   unrelated fixes discovered along the way in their own commit.

## Writing regression tests

Follow the existing pattern in `app/tests/api/<area>/*.spec.js` (mocha +
supertest + expect; see `docs/developer/crud-regression-test-taxonomy.md`):

- `before()`: `database.initializeConnection()` →
  `databaseConfiguration.checkSystemConfiguration()` → set
  `config.validateRequests` flags → `initializeApp()` → `login.loginAnonymous()`.
- **Always enable ADM validation** (`config.validateRequests.withAttackDataModel
  = true`) and make payloads ADM-valid — check the ADM Zod sources when unsure.
  Common traps: `kill_chain_phases[].kill_chain_name` must be
  `mitre-attack` / `mitre-mobile-attack` / `mitre-ics-attack`;
  `x_mitre_platforms` must use real platform names (e.g. `Windows`).
- Account for server-controlled fields: read generated values
  (`workspace.attack_id`, `stix.created_by_ref`, ATT&CK external refs) from the
  POST response rather than asserting on what you sent. To simulate states the
  API won't accept on create (`revoked`, missing ATT&CK ID), update the
  document directly via the Mongoose model.
- Startup seeds four static marking definitions (e.g. TLP:WHITE
  `marking-definition--613f2e26-407d-48c7-9eca-b8e91df99dc9`) and a placeholder
  organization identity; the MITRE identity is *not* seeded.

## Bruno smoke tests

The Bruno collection (location in `AGENTS.local.md`) mirrors the API for
manual testing — one `.bru` file per request, grouped in folders, environments
in `environments/`. When changing the API surface, update the affected `.bru`
files: keep the `url` line consistent with enabled `params:query` entries, add
new optional params as disabled toggles (`~name: value`), and document
parameter semantics in the `docs { }` block.

## Gotchas

- Database migrations support stable-release upgrade paths. Alpha and beta
  databases are ephemeral and should be reset or recreated rather than carried
  forward by permanent nightly-only migration scripts.
- STIX version rules: the bundle envelope carries `spec_version` only in STIX
  2.0 (2.1 removed it; each 2.1 *object* declares its own `spec_version`).
  Marking definitions have no `stix.modified`.
- `p-limit` is not a dependency and recent versions are ESM-only — use a small
  inline concurrency runner instead.
- Legacy endpoints under deprecation (e.g. `GET /api/stix-bundles`) are
  replaced by release-tracks equivalents — check
  `docs/developer/release-tracks/bundle-export.md` before extending them.
- Release-track bundle export has one content path: replay the snapshot's
  sealed content manifest (`docs/developer/release-tracks/sealed-content-manifests.md`).
  Never add live relationship discovery, secondary-SDO expansion, or a
  deletable "graph cache" to release-track exports; drafts inherit their
  predecessor's manifest and only member-changing writes seal a new one. The
  `x-mitre-collection` object is a projection, not a stored object.
- A virtual track's `snapshot_schedule` is live registry configuration, not
  historical snapshot state. Schedule changes must update the registry without
  cloning a draft; Workbench snapshot responses project the current schedule.
- Historic full-suite flake (fixed 2026-07-10): per-spec-file mongod
  restarts hit "Port already in use", failing a random file's `before` hook
  (visible as `loginAnonymous` 404s). `database-in-memory.js` now reuses one
  mongod across spec files and the mocha scripts use `--exit`. If roaming
  single-file failures reappear, re-run that spec file in isolation before
  treating them as real, and check mongod startup errors at the top of the
  run output.

## Maintaining this guide

Treat this file like code. At the end of a task, consider whether a durable,
non-obvious lesson was learned (a validation trap, a pattern decision, a
workflow correction) and propose adding it here; prune entries that are stale
or no longer earn their token cost — this file is loaded into every agent
session. Machine-specific paths never belong in this file; they go in
`AGENTS.local.md`.
