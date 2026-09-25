# Release Track TODOs

## Duplicate relationship report memory (2026-09-10)

- [x] Trace dashboard request and identify historical endpoint fan-out.
- [x] Filter duplicates in MongoDB before hydrating relationships and latest endpoints.
- [x] Add regressions for history, lifecycle filters, missing endpoints, and bounded query output.
- [x] Run focused specs, full npm test, and lint; document findings and limits.

Verification: focused report + relationship specs 38 passing; full `npm test`
passes (OpenAPI 2, config 22, API 1051, middleware 29, scheduler 10); lint
and `git diff --check` pass. Synthetic query output falls from 38,162,701 to
23,131 serialized bytes; production peak heap has not been measured. See
[data-quality report design](data-quality-reports.md) for the analysis.
No API contract change or frontend/Bruno update is needed.

Proposed commit: `fix(reports): reduce duplicate relationship report memory use`

Body: Filter duplicate groups in MongoDB before fetching full relationships,
limit endpoint lookups to their latest revisions, and consume results through
a batched cursor. Add history and lifecycle regressions and document remaining
response-size limits.

Proposed AGENTS.md lesson: Analytical reports should filter findings before
joining full documents, and latest-endpoint lookups should limit revisions in
MongoDB rather than discarding history after materialization.


## Snapshot card header hierarchy

- [x] Give snapshot identity and status labels their own full-width header area.
- [x] Move controls below metadata; remove redundant draft copy and style tagged timestamps as metadata pills.
- [x] Verify template regressions, responsive layouts, frontend suite, lint, and build.

Accepted lifecycle work committed without a breaking marker: backend e9fd8562,
frontend 880c49e0, Bruno a9b8a97. Other provenance changes remain uncommitted.

UI verification: component spec 87 passing; full frontend suite 168 files /
428 tests passing. Changed-file lint, formatting, and production build pass
(existing bundle/style budget warnings remain). Isolated Angular-rendered
headers with compiled styles were visually checked in headless Chrome at
1400, 900, 390, and 320px: Latest stays in the title row, controls remain below
metadata, and neither draft nor tagged header overflows. Timestamp pills use
existing MITRE theme tokens with readable light/dark foregrounds.

Backend lifecycle assertion verification: 20 passing; full suite passes
(OpenAPI 2, config 22, API 1048, middleware 29, scheduler 10), and lint passes.
A transient content-manifest HTTP 404 passed in isolation (10 tests) and on
the complete rerun. No unrelated test-harness changes were made.

Header refinements approved for commit on 2026-09-10:
`fix(release-tracks): clarify snapshot card headers`
Body: Separate snapshot identity and status from controls, remove redundant
draft subtitles, and present snapshot/tagging timestamps as metadata pills.

## Separate tagging, conversion to draft, and draft deletion

- [x] Preserve creation provenance while separating conversion and deletion in the API.
- [x] Keep admin confirmation, latest/sole-snapshot, dependency, and release-lock guards.
- [x] Add distinct frontend Convert to draft and Delete draft controls.
- [x] Update regressions, OpenAPI, user/developer docs, and Bruno requests.
- [x] Run focused tests, full backend/frontend suites, lint, and build.

Verification (Node 24): backend focused group 76 passing; full `npm test`
passes (OpenAPI 2, config 22, API 1048, middleware 29, scheduler 10).
The first full run identified two obsolete DELETE-confirmation expectations,
which now assert draft-only rejection. Unrelated HTTP/authentication failures
passed in isolation and in the complete rerun. Backend lint passes.
Frontend focused tests 108 passing; all 168 files / 425 tests pass, changed-file
lint passes, and production build succeeds with existing size-budget warnings.
Logic-specialist review: ROBUST for the scoped state transitions, dependency
checks, preserved-source protection, publication cleanup, and release-lock use.
Both main beta checkouts retain the other agent's uncommitted provenance work.
No commits were created; Bruno conversion/deletion requests are updated.

Accepted commit: `feat(release-tracks): separate draft conversion from snapshot deletion`

Body: Add an explicitly confirmed release-to-draft endpoint and matching UI
control. Restore guarded draft deletion while preserving source drafts,
composition provenance, dependency checks, and release serialization.

Snapshot DELETE is draft-only. Convert tagged releases with
POST /release-tracks/:id/snapshots/:modified/draft and a confirm_version body
before attempting a separate eligible-draft DELETE.

## Snapshot creation provenance and user attribution (2026-09-09)

- [x] Inspect beta and carry forward the prior uncommitted creation-cause work.
- [x] Persist immutable creation cause and invoking user, including standard release creation.
- [x] Return safe user display metadata with snapshot GETs and history; show initials avatars.
- [x] Cover user changes, automation, legacy records, tagging, and spoofing with regressions.
- [x] Update OpenAPI, user/developer documentation, and Bruno requests.
- [x] Run focused tests, full suites, lint, and frontend build.

Verification: backend provenance/release/quarantine group 32 passing; final
provenance spec 7 passing. Complete backend suite under Node 24 passes:
OpenAPI 2, config 22, API 1044, middleware 29, scheduler 10. Backend lint
passes. First full-run transient HTTP failures passed in isolation (100)
and on the complete rerun. Frontend focused tests 97 passing; complete suite
168 files / 420 tests passing, changed-file lint and production build pass.
The existing save-dialog timing failure passed in isolation and on full rerun;
existing bundle/style budget warnings remain. Production build required
execution outside the sandbox. No test-harness changes were made.

Work is in both main beta checkouts, preserving the newer rollback/composition
provenance work and unrelated local files. Commit preparation (2026-09-10)
excludes unrelated working-tree changes, including shared-document formatting.

Commit messages:

- Backend: `feat(release-tracks): record snapshot creation provenance`
  Body: Persist creation causes and invoking users, distinguish standard
  release creation, and expose safe creator metadata through snapshot GETs.
- Frontend: `feat(release-tracks): show snapshot causes and creator avatars`
  Body: Display snapshot-local creator names and initials, with explicit
  automation and historical-attribution fallbacks on Releases cards.
- Bruno: `docs(release-tracks): document snapshot creation attribution`
  Body: Describe creation cause and actor fields on snapshot GET requests.

## Merge scheduling and rollback branches into local beta (2026-09-09)

- [x] Inspect all worktrees and confirm scheduling branches are already merged.
- [x] Merge rollback branches and preserve both features in documentation conflicts.
- [x] Run focused backend/frontend regressions, then full suites and lint/build checks.
- [x] Complete local merge commits and verify both feature tips are ancestors of beta.

Verification: backend focused group 84 passing; full `npm test` under Node 24
passes (OpenAPI 2, config 22, API 1037, middleware 29, scheduler 10), and
backend lint passes. One initial full-run HTTP 404 passed in isolation (23)
and in the complete rerun. Frontend focused group 100 passing; all 168 test
files / 416 tests, changed-file lint, and production build pass. The build
required execution outside the sandbox; existing bundle/style budget warnings
remain. Only documentation conflicted; both sides' behavior and records are
preserved. Scheduling branches were already ancestors of beta; uncommitted
work in the scheduling worktrees and existing untracked files are untouched.

Merge messages: `chore(release-tracks): merge rollback support into beta`
(backend) and `chore(release-tracks): merge rollback controls into beta`
(frontend).

## Virtual release-track schedule configuration

- [x] Fix schedule saves submitting unsupported deduplication fields: remove
      preferred tier/status controls and compare composition to its initial
      editable state, including normalized priorities and defaults.
- [x] Verify server-shaped schedule-only save and strategy-change regressions,
      full frontend tests, and production build.
      Focused: 94 passing; full: 167 files / 410 tests passing; production build
      and changed-file lint pass. Backend schema rejects precisely
      `tier_resolution`/`status_resolution` and accepts the corrected payload.
      Proposed commit: `fix(release-tracks): avoid invalid composition updates`.
      Body: Remove unsupported deduplication controls and compare the edited
      composition to its initial form state so schedule-only saves skip cloning.

- [x] Add controlled natural-language schedule autocomplete with hourly and
      15/30-minute presets and guided customization.
- [x] Verify autocomplete regressions, full frontend suite, and production build.
      Focused tests: 94 passing; full frontend: 167 files / 410 tests passing;
      production build, changed-file lint, formatting, and diff checks pass.
      Proposed commit: `feat(release-tracks): autocomplete schedule presets`.
      Body: Map selected schedule phrases to deterministic UTC cron expressions
      and support hourly and 15/30-minute guided customization.

- [x] Review persisted schedule validation, storage, scheduler execution, and
      existing regression coverage.
- [x] Add an authenticated virtual-track schedule update endpoint with strict
      validation and persistence.
- [x] Add backend regression tests, OpenAPI documentation, user/developer
      documentation, and Bruno coverage.
- [x] Add a controlled frontend schedule editor for manual, recurring cron,
      and explicit-date schedules, without free-text cron entry.
- [x] Add frontend connector/component regressions and usage documentation.
- [x] Run focused checks, then the complete backend and frontend suites.
- [x] Propose conventional commit messages without committing.

Verification (2026-09-09):

- Backend focused schedule/API and scheduler specs: 19 passing; OpenAPI: 2
  passing; changed-file ESLint clean.
- Backend complete `npm test`: OpenAPI 2, config 22, API 1024, middleware 29,
  and scheduler 10 passing.
- Frontend focused component/connector specs: 92 passing; complete suite: 167
  files and 408 tests passing; application TypeScript and production build
  pass; changed-file ESLint has no errors.
- Proposed commits: `feat(release-tracks): add virtual schedule updates`,
  `feat(release-tracks): add guided snapshot scheduling`, and
  `docs(release-tracks): add virtual schedule request`.

## Snapshot-scoped virtual composition provenance

- [x] Return each virtual snapshot's immutable `composition_resolution` from
      snapshot history and declare it in OpenAPI.
- [x] Add backend regression coverage and update user/API documentation plus
      the Bruno snapshot-history request.
- [x] Move the frontend Composition Resolution view from HEAD into each
      virtual snapshot's Releases card, including exact component version,
      snapshot timestamp, strategy, filters, and contribution counts.
- [x] Add frontend regression coverage and update frontend documentation.
- [x] Replace the dense seven-column provenance table with a responsive
      component list whose identifiers wrap within their own regions and whose
      counts use independently wrapping metric labels.
- [x] Run focused backend/frontend specs, then each repository's complete
      required verification suite; propose conventional commit messages.

Verification (2026-09-09):

- REST API: snapshot-history spec 7 passing; OpenAPI 2 passing; lint clean;
  full `npm test` under Node 24 clean (2 OpenAPI, 22 config, 1020 API,
  29 middleware, 10 scheduler). Node 22 full-suite attempts reproduced the
  documented roaming HTTP-response flake; every affected spec passed alone.
- Frontend: release-track page spec 71 passing; full `npm test` 404 passing;
  application TypeScript compilation clean; changed-file ESLint clean;
  production build clean with existing bundle/style budget warnings. The
  repository-wide lint command still reports pre-existing errors outside the
  changed files.
- Proposed commits: REST API `feat(release-tracks): expose virtual snapshot
  provenance`; frontend `feat(release-tracks): scope composition provenance to
  snapshots`; Bruno `docs(release-tracks): document snapshot composition
  provenance`.

Post-merge review (2026-09-09): no blocking findings; live registry scheduling
and historical composition provenance remain separate. Reverified with Node 24:
7 focused backend tests, 77 focused frontend tests, full backend suite
(2 OpenAPI, 22 config, 1024 API, 29 middleware, 10 scheduler), and all 411
frontend tests passed. Backend lint, changed-file frontend lint, and the
frontend production build passed (bundle/style budget warnings remain).

## Preserve pre-release drafts and protect virtual dependencies

- [x] Change standard-track release commit from in-place tagging to creation
      of a new tagged snapshot while retaining the exact source draft.
- [x] Prevent rolling-draft cleanup from pruning drafts retained as the source
      of a tagged standard release.
- [x] Block release deletion when any persisted virtual snapshot resolved the
      exact standard release snapshot, for implicit or explicit composition.
- [x] Add a post-hoc release-version update that preserves the snapshot and
      validates the replacement against adjacent release versions.
- [x] Reconcile release catalogues, copied version ledgers, bundle hashes,
      audit records, and current-snapshot backrefs for both operations.
- [x] Update OpenAPI, user/developer/operator docs, and Bruno requests.
- [x] Add ADM-valid API regressions and run focused specs, then full `npm test`.
- [x] Update the frontend release controls, wording, connector, and tests.
- [x] Propose conventional commit messages without committing.

## Rollback / retag review follow-up

- [x] Coordinate component release locks with virtual materialization.
- [x] Publish retag hashes atomically with the version and repair derived state on retry.
- [x] Expose preserved source pointers in snapshot history.
- [x] Validate deletion confirmation and capture audit identity under the release lock.
- [x] Add concurrency, failure-recovery, history, and exact-download hash regressions.
- [x] Update OpenAPI, user/developer docs, and Bruno smoke requests.
- [x] Run focused specs, full npm test, and lint; propose a commit without committing.

Verification: focused backend group 32 passing, final destructive/retag spec
16 passing; full `npm test` passes (OpenAPI 2, config 22, API 1033,
middleware 29, scheduler 10). Backend lint and frontend page/connector tests
(90) pass. An initial unrelated technique-conversion 404 passed in isolation
(24) and on the final full run; no unrelated source changes were made.

Proposed commit: `fix(release-tracks): make rollback and retag concurrency-safe`

Coordinate materialization with component release locks, publish retag hashes
atomically, repair derived state on retry, expose preserved draft pointers,
and validate destructive confirmation under the audit lock.

## Sealed snapshot content manifests (Problem 1)

Design: [release-tracks/sealed-content-manifests.md](release-tracks/sealed-content-manifests.md).
Decisions confirmed by the developer on 2026-09-02: drop the relationship
advancement cascade, revert the frontend related-object reset to PUT, keep the
collection object in every STIX 2.1 bundle including drafts, track-scope
publication metadata with inherit-from-global as the default, collection
`modified` = snapshot `modified`, bundle `id` changes per snapshot while the
collection `id` is constant per track, and production-grade migration.

### Backend (branch `beta`)

- [x] Model: manifest gains `sealed_at`, `seal_reason`; snapshot gains
      `content_manifest_id` (renamed from `graph_manifest_id`), `publication`,
      `bundle_id`; `config.publication` with inherit/explicit identity and
      markings plus optional `collection_id` and `created`; remove top-level
      `object_marking_refs`.
- [x] Content manifest service (renamed from graph-manifest-service): seal
      over exact members with ID-closed relationship selection, supporting and
      link-target entries, no `secondary`, no predecessor carry-forward;
      reference-counted discard; legacy schema-v1 reader retained.
- [x] Snapshot service: seal when `members` is written (create track, clone
      with members override), inherit otherwise; prune drafts without
      discarding shared manifests; notes editable on drafts only; remove
      graph create/delete.
- [x] Versioning service: standard commit seals over planned members inside
      the guarded tag update; virtual commit reuses the materialization seal;
      freeze `publication`, generate `bundle_id`, store hashes; preview
      reports relationship additions, removals, and stale authored endpoints.
- [x] Publication resolution: shared resolver for identity and markings
      (track override or global), collection id and created overrides,
      immutability after first release, config GET returns resolved values.
- [x] Export: single replay path; drafts may add live `include` tiers through
      the same closure rule; tagged + `include` is 400; collection object
      always present in 2.1, absent in 2.0; drafts omit `x_mitre_version`;
      remove `includeToc`; bundle id stored for tagged, UUIDv5 for drafts.
- [x] Relationships: remove `handleEndpointRevisionCreated` and its
      subscriptions; keep create-time endpoint pinning; drop the exact-endpoint
      repository query if unused.
- [x] Routes/controller/OpenAPI: remove graph create/delete; reconstruct
      accepts `replace_manifest_id`; rename response fields
      (`content_manifest_id`, `content_statistics`); publication config
      schema; remove `includeToc` and top-level marking refs.
- [x] Migration: rename field, seal unsealed tagged snapshots as baseline
      reconstructions, drafts inherit or seal, migrate track marking refs into
      `config.publication`, freeze `publication` and `bundle_id` on tagged
      snapshots, recompute hashes, drop frozen `collection` entries; make the
      2026-07-30 migration's manifest backfill a no-op; dry-run preview
      script; regression spec.
- [x] Tests: content-manifest lifecycle spec (replaces opt-in-graphs),
      bundle spec updates, no-cascade relationship spec, publication config
      spec, migration spec, virtual/history/description spec updates; run
      focused specs then full `npm test`.
- [x] Docs: bundle-export.md, entities.md, implementation-notes.md, user
      output-formats/versioning/api-reference/terminology, relationships doc.
- [x] Bruno: remove graph create/delete requests, update reconstruct,
      config, snapshot export, and track creation requests.
- [x] Propose conventional commit messages.

### Frontend (feature branch off `beta`)

- [x] Revert relationship save to update related objects with PUT.
- [x] Remove bundle cache controls, cache status, and cache statistics; show
      content statistics, hashes, and bundle id on tagged snapshots.
- [x] Publication section in track configuration: identity and markings with
      inherit toggle and resolved-value display; collection id and created
      overrides editable until first release.
- [x] Release preview: relationship inventory summary and stale-endpoint
      warnings.
- [x] Snapshot notes read-only after release; field renames in classes,
      connector, and specs; docs update; focused and full frontend
      verification.

Verification (2026-09-02):

- Backend focused specs pass: content manifests 10, publication config 3,
  manifest migrations 5, bundle export 19, snapshot descriptions 7, snapshot
  history 7, virtual graph integrity 3, release planning 23, endpoint pins 3,
  release tracks 3, attack objects, collection bundles, reconciliation.
- Three complete `npm test` runs: 1009/1012/1010 API cases passing with the
  documented roaming shared-server failures only (attack-objects count,
  collection-bundles 400, reconciliation 400, analytics ECONNRESET, groups
  timeout); every affected spec passes in isolation. OpenAPI, config,
  middleware, and scheduler suites pass. `npm run lint` is clean for the
  changed files (pre-existing findings remain in untouched migrations and
  `scripts/loadBundle.js`).
- Restored-production trial (2026-09-02): the first run crashed on
  `release-track--4bf296be…`, one of eight unregistered collections left by
  the first v19.1 bootstrap, whose members reference six technique revisions
  replaced by the platform-ordering repair. The migration now migrates
  registered tracks only, reports orphans, discards their manifests, and names
  the failing snapshot, step, and missing references on any other error.
- The crashed API container kept restarting (`restart: unless-stopped`, 23
  restarts) on the old image, re-running the unfixed migration and re-creating
  the four orphan manifests each time; the rebuilt image's idempotent run
  discards them again. Stop or rebuild the container before judging the
  database state.
- After the fix, a dry run against the restore reported 6 tracks, 21
  snapshots, 7 seals, 1 shared manifest, 4 renames, and 7 orphan collections;
  applying it sealed and froze exactly that, recomputed 7 hash sets, and a
  second apply changed nothing. Every released snapshot's stored STIX 2.1
  hash matches a fresh export and every draft exports with the version key
  omitted.
- Design record: `docs/developer/release-tracks/sealed-content-manifests.md`.
- Follow-up for the developer's v19.1 bootstrap tooling (`.nocommit/`): read
  `content_manifest_id` instead of `graph_manifest_id`, and replace the
  delete-then-reconstruct recovery with a single reconstruct request naming
  `replace_manifest_id`.
- Frontend (branch `feat/sealed-content-manifests`): focused specs pass
  (page 53, connector, relationship, preview dialog); the complete vitest
  suite passes (166 files, 379 tests); `tsc --noEmit`, ESLint on changed
  files, and the production `ng build` succeed.
- Proposed REST commit: `feat(release-tracks): seal snapshot content manifests`.
  Proposed frontend commit: `feat(release-tracks): surface sealed content and
publication settings`.

### Review follow-ups (2026-09-02)

- [x] Fix the virtual-track config editor crash: the connector's identity and
      marking getters return functions that must be invoked as methods.
- [x] Rename the History tab to Releases; drop the per-snapshot "Sealed" chip
      (every snapshot is sealed, so it carried no information) and label the
      statistics section "Content".
- [x] Restore release deletion: administrators may delete the track's most
      recent release with a typed version confirmation (`confirm_version`);
      the ledger entry is retracted from every remaining snapshot, the manifest
      is discarded when unreferenced, the registry is reconciled, and a
      `delete_release` audit event is recorded. Frontend button on tagged
      release cards for administrators.
- [x] Data-model review (KISS): rename manifest storage to
      `releaseTrackContentManifest*` with `release-track-content-manifest--`
      ids; drop `resolver_version` and `baseline_reconstruction` in favour of a
      required `seal_reason`; remove the dead `config.include_secondary_objects`
      block and its frontend section; keep `releaseTrackReconciliations` as an
      outstanding-work queue (completed records are deleted, so it is normally
      empty); keep `releaseTrackAuditEvents` (now used by both destructive
      actions) and document every collection in `entities.md`.
- [x] Migration extended in place (unreleased): collection rename, id rewrite,
      header normalization, dead-config removal, completed-reconciliation
      cleanup; dry run stays accurate before the rename.
      Verification (2026-09-02, review follow-ups):

- Backend focused specs pass: manifest migrations 5, destructive authorization
  3, content manifests 10, snapshot history 7, virtual graph integrity 3,
  reconciliation durability 2, releases by object 8, snapshot immutability 2,
  backrefs 24; OpenAPI validation passes.
- Restored production database: dry run reports 131,534 legacy manifest
  documents to move and 17 headers to normalize; apply completes, all 21
  snapshots export with matching hashes, storage now lists only
  `releaseTrackContentManifests`, `releaseTrackContentManifestEntries`,
  `releaseTrackRegistry`, `releaseTrackReconciliations` (empty), and
  `releaseTrackAuditEvents`; a second dry run reports nothing left to do.
- Frontend: focused page and connector specs pass (71); complete suite
  381 tests with one unrelated save-dialog flake that passes alone; `tsc`,
  ESLint, Prettier, and the production build are clean.
- [ ] Recommendation, not implemented: `version_history` is copied into every
      snapshot document although only the tagged snapshot's own entry is read
      (`tagMetadataForSnapshot`) and the registry's `tagged_releases` is the
      catalogue. Storing the entry only on the tagged snapshot would remove the
      duplication but touches release planning, cloning, and the frontend
      history view; defer to a dedicated slice.

## Remove nightly-only migration compatibility

- [x] Remove regression code that imports the retired beta bundle-integrity
      migration.
- [x] Remove canonical-domain correction logic used only to carry flawed beta
      migration output forward.
- [x] Remove current documentation for the retired nightly migrations and
      document the alpha/beta database reset policy.
- [x] Run the focused migration and current graph-invariant regression specs.
- [x] Run the complete `npm test` suite and propose a conventional commit
      message without committing.

Verification (2026-08-18):

- Focused canonical-domain, deterministic-graph, opt-in-graph, and bundle
  regressions pass (39); ESLint and whitespace checks also pass.
- Four complete `npm test` attempts reached 1001-1009 passing API tests but
  each encountered the documented roaming shared-server failure (HTTP parse
  error, transient 404, `ECONNRESET`, or socket hang-up). Every affected spec
  passes independently, including techniques conversion (24), software
  pagination (13), the grouped release-track cases (15), and change capture
  (10). OpenAPI (2) and configuration (22) passed on every complete attempt.
- Proposed commit: `chore(migrations): remove nightly compatibility remnants`.

## Frontend and REST API build information

- [x] Source REST API build metadata from the Docker/runtime build variables,
      with package/default fallbacks for non-Docker development.
- [x] Extend the public system-version endpoint and OpenAPI contract with the
      REST API name, release version, Git commit, and build date.
- [x] Generate matching frontend metadata into production build artifacts and
      display frontend plus REST API versions in the navigation footer.
- [x] Add REST API and frontend regressions for metadata loading, fallbacks,
      endpoint access, and rendering.
- [x] Update REST API user/developer/admin docs, frontend docs, and the Bruno
      collection for the expanded API response.
- [x] Run focused checks followed by the complete REST API and frontend test
      suites, then propose conventional commit messages without committing.

Verification (2026-08-07):

- REST API focused system-version (19), configuration (22), and OpenAPI (2)
  regressions pass; ESLint and whitespace checks also pass.
- The clean complete REST API suite passes: OpenAPI 2, configuration 22, API
  1012, middleware 29, and scheduler 10. An earlier run's documented roaming
  `ECONNRESET` passed in isolation before the clean rerun.
- The complete frontend suite passes: 166 files and 385 tests. Focused service,
  footer, and navigation tests (22), ESLint, Prettier, the metadata generator,
  and a production build with release-like metadata also pass.
- Proposed REST API commit: `feat(config): expose REST API build information`.
  Proposed frontend commit: `feat(shell): display component build versions`.

## Targeted v19.1 source-graph recovery

- [x] Add a read-only preflight that targets one exact tagged virtual snapshot,
      reconstructs its canonical v19.1 pointer plan, and requires every prior
      immutable baseline repair to already exist.
- [x] Add a separately confirmed apply mode that replaces only the target
      snapshot's graph manifest and refuses track replacement or STIX writes.
- [x] Verify the snapshot members, source-pointer hydration, manifest
      attestation, and final emitted bundle against the canonical source.
- [x] Tag future public v19.1 virtual baselines as `19.1` while retaining the
      internal standard-track baseline tag.
- [x] Add operator documentation and regression coverage for safety,
      idempotence, and the incorrect ordinary-manifest recovery scenario.
- [x] Run focused Python checks followed by the complete `npm test` suite.
- [x] Propose a conventional commit message without committing unless asked.

Verification (2026-08-05):

- Bootstrap regressions pass: 42 cases covering graph-only no-write preflight,
  guarded replacement, missing-repair fail-closed behavior, manifest races,
  and the public `19.1` virtual tag. Ruff, Python compilation, and diff
  whitespace checks pass.
- The clean complete REST suite passes under repository-pinned Node 22.14.0:
  OpenAPI 2, config 21, API 1012, middleware 29, and scheduler 10.
- Earlier complete runs encountered the documented roaming shared-server
  failures; each affected bundle, pagination, backref, virtual-graph, and notes
  spec passed independently before the clean run.
- Proposed commit: `fix(release-tracks): add targeted v19.1 graph recovery`.

## Deterministic graph collection identity repair

- [x] Reproduce the incorrect graph collection creator, STIX 2.0 TOC
      inclusion, and persisted cross-manifest collection-ID drift.
- [x] Resolve graph collection `created_by_ref` from the configured
      organization identity and enforce one collection ID per release track.
- [x] Exclude `x-mitre-collection` from STIX 2.0 snapshot bundles and hashes.
- [x] Add a rerunnable forward migration that repairs existing graph
      collection entries and recomputes tagged-snapshot bundle hashes.
- [x] Update release-track user, developer, and administrator documentation.
- [x] Run focused regression specs.
- [x] Complete an all-green `npm test` run without the documented roaming
      in-memory MongoDB/server flake.
- [x] Propose a conventional commit message without committing unless asked.

Verification (2026-08-05):

- Focused graph, migration, snapshot, ephemeral, virtual, and legacy bundle
  specs pass, including exact SHA-256 comparisons against downloaded bundles
  and a rerun proving the repair migration is idempotent.
- ESLint and `git diff --check` pass.
- Full-suite attempts reached 1009 passing/3 failures, 1000/5, and repeatedly
  1011/1. Each failure roamed to an unrelated spec as a transient 400/404,
  `ECONNRESET`, or socket hangup; every affected spec passes in isolation,
  including under the repository-pinned Node 22.14.0 runtime.
- The developer subsequently confirmed a complete all-green test run.
- Proposed commit: `fix(release-tracks): repair deterministic bundle integrity`.

## Stateful snapshot collection objects and bundle hashes

- [x] Persist one frozen `x-mitre-collection` entry in every graph manifest,
      with a track-stable ID, first-manifest `created`, and current-manifest
      `modified` timestamp.
- [x] Replay the frozen collection entry and a manifest-stable bundle envelope
      ID for deterministic STIX 2.0 and STIX 2.1 downloads.
- [x] Generate SHA-256 hashes from the exact pretty-printed download bytes and
      store both hashes on graph-backed snapshots with their manifest ID.
- [x] Reject snapshot-note edits while a graph exists so the frozen collection
      and hashes remain immutable; require deletion and regeneration to edit.
- [x] Expose hashes through snapshot responses/OpenAPI and update REST docs,
      Bruno coverage, and regression tests.
- [x] Replace frontend bundle prefetch/hashing with server-provided hashes,
      preserving copy controls and exact download serialization.
- [x] Run focused and complete REST/frontend verification and propose
      conventional commit messages without committing unless asked.

Verification (2026-08-04):

- Focused REST graph, description, history, and bundle specs pass, including
  exact SHA-256 comparisons against both downloaded bundle serializations.
- The complete REST `npm test` suite passes after the repository's documented
  roaming harness failures were confirmed in isolation and rerun.
- The complete frontend suite passes: 165 files and 381 tests. Targeted
  TypeScript, ESLint, and Prettier checks also pass.
- Cached-note regression coverage proves the API returns 409 without changing
  either bundle hash, then permits editing after graph deletion and freezes the
  revised notes when the graph is recreated.
- Repeated complete REST runs encountered the documented roaming harness
  failures in unrelated specs (transient 400/404/ECONNRESET responses); every
  affected spec passes when rerun in isolation.
- Proposed REST commit: `feat(release-tracks): persist snapshot bundle hashes`.
  Proposed frontend commit: `feat(release-tracks): display snapshot bundle hashes`.

## Relationship review-state revision safety

- [x] Reproduce the relationship-save source/target workflow reset and prove it
      currently uses in-place PUT updates.
- [x] Reset related SDO workflow state through POST-created revisions so graph-
      pinned revisions remain immutable.
- [x] Add frontend regression coverage for request method, WIP transition, and
      sequential relationship/source/target saves.
- [x] Update frontend workflow documentation and run focused plus complete
      frontend verification.
- [x] Propose a conventional commit message without committing unless asked.

Verification (2026-08-04):

- The focused relationship revision regression passes: 1 case proving ordered
  relationship/source/target POSTs, WIP resets, and no related-object PUTs.
- The complete frontend suite passes: 164 files and 377 tests. The production
  Angular build succeeds with existing bundle/style budget warnings.
- Prettier and the new regression's ESLint check pass. The legacy relationship
  class retains its existing unrelated lint findings; the changed transport
  line introduces none.
- Proposed frontend commit: `fix(relationships): revise related objects on save`.

## Snapshot collection descriptions and bounded release versions

- [x] Map each snapshot's user-authored description onto emitted
      `x-mitre-collection.description` while preserving the track description
      as the fallback for snapshots without notes.
- [x] Add backend regressions for bundle and graph-backed bundle exports using
      snapshot descriptions.
- [x] Calculate relative and explicit release versions between the nearest
      earlier and later tagged snapshots, with exclusive chronological bounds.
- [x] Add regression coverage for mixed explicit/relative tags, retroactive
      releases, invalid boundary values, and exact-version uniqueness.
- [x] Wire exact `MAJOR.MINOR` release selection into the Angular release
      preview dialog and connector flow with component/page tests.
- [x] Update OpenAPI, user/developer docs, and Bruno release requests.
- [x] Run focused backend and frontend tests, then the complete backend
      `npm test` suite and the relevant frontend verification commands.
- [x] Propose conventional commit messages for both repositories.

Verification (2026-08-04):

- Focused backend release and bundle specs pass (23 and 18 cases), including
  mixed explicit/relative tags, retroactive bounds, concurrent release locking,
  and snapshot-description export.
- Backend lint, OpenAPI/config validation, middleware (29 cases), scheduler
  (10 cases), and every isolated full-suite failure pass. Four complete
  `npm test` attempts reached 1007-1008 passing API cases before the documented
  shared-server flake roamed to a different unrelated spec on each run; the
  isolated targets pass under both Node 22 and Node 24.
- The complete frontend suite passes (163 files, 376 tests), targeted ESLint and
  Prettier checks pass, and the production build succeeds with existing budget
  warnings.
- Proposed backend commit: `feat(release-tracks): bound snapshot publication
versions`. Proposed frontend commit: `feat(release-tracks): tag snapshots
with exact versions`.

## Frontend graph cache lifecycle controls

- [x] Replace the static cache-materialization hourglass with the existing
      Angular Material indeterminate spinner.
- [x] Add an editor-only, confirmed delete action for cached snapshot graphs,
      including progress and success/error feedback.
- [x] Add connector/component regressions, update frontend behavior notes, and
      run focused plus complete frontend verification.

Verification (2026-08-03):

- Focused Angular connector/component regressions pass: 68 tests. The complete
  frontend suite passes: 162 files and 366 tests.
- Targeted ESLint and Prettier checks pass. The production Angular build passes
  with the local persistent cache temporarily disabled to avoid the documented
  environment-specific native crash; `angular.json` was restored afterward.
- Proposed frontend commit: `feat(release-tracks): manage snapshot bundle
caches`.

## Source-attested v19.1 graph reconstruction

- [x] Add fail-closed regressions for canonical-domain migration when exact
      collection TOC provenance is unavailable; never infer Enterprise from
      missing evidence.
- [x] Add an administrator-only schema-v2 source reconstruction endpoint that
      validates a closed pointer plan against tagged snapshot members and
      persisted exact revisions.
- [x] Build v19.1 source plans without importing bundles, inferring legacy SRO
      endpoint revisions from the unique objects emitted in each source bundle.
- [x] Validate the complete source plan against MongoDB before tagging, then
      attach it atomically and require a final bundle comparison.
- [x] Update OpenAPI, Bruno, operator/developer documentation, and bootstrap
      recovery guidance.
- [x] Run focused migration, reconstruction, and bootstrap regressions; then
      lint and the complete `npm test` suite.

Verification (2026-08-03):

- Canonical-domain migration regressions pass: 9 cases. Unmapped domainless
  objects remain unchanged, are reported, and keep the legacy bypasses active.
- Source reconstruction regressions pass: 5 cases. They prove exact historical
  relationship and endpoint revisions replay after their live lineages advance,
  reject incomplete pointer plans, and enforce source-attestation idempotence.
- Bootstrap regressions pass: 33 cases. Source bundles are never imported;
  30,649 emitted-object pointers and 54 non-emitted LinkById dependency
  pointers are hydrated from MongoDB before tagging. The largest
  reconstruction request remains below the 50 MiB API request limit and
  outside the 16 MiB per-document BSON limit.
- The clean complete REST suite passes: OpenAPI 2, config 21, API 995,
  middleware 29, and scheduler 10. Four roaming harness failures in the first
  run passed independently (13, 24, 25, and 4 cases) before the clean rerun.
- Repository ESLint, Python Ruff, Python bytecode compilation, and diff
  whitespace validation pass.
- Proposed commit: `fix(release-tracks): attest v19.1 snapshot graphs`.

### Historical relationship hydration follow-up

- [x] Reproduce the 21,025 missing Enterprise revisions against the restored
      production-shaped database and classify payload differences.
- [x] Hydrate relationship pointers from the dedicated MongoDB collection and
      render LinkById fields through the same deterministic export semantics.
- [x] Add regressions that fail on relationship content drift while accepting
      exact persisted timestamps and export-only LinkById rendering.
- [x] Update bootstrap documentation and run focused plus complete verification.

Verification (2026-08-03):

- The 21,025 failures are exactly the Enterprise relationship count. Every
  sampled exact timestamp exists in MongoDB's dedicated `relationships`
  collection; the bootstrap had incorrectly queried `attackObjects` for all
  pointer kinds.
- All 24,552 v19.1 relationships were audited read-only. Of those, 5,624 raw
  payloads already match exactly and 18,928 differ only because exports render
  persisted `(LinkById: ...)` tags as Markdown links.
- A production-shaped preflight reconstructs Enterprise (25,851 graph entries),
  ICS (2,201), and Mobile (2,651) with zero missing, changed, or additional
  emitted objects. The 54 entries beyond the 30,649 emitted objects are exact,
  non-emitted cross-domain LinkById dependencies.
- Bootstrap regressions pass: 33 cases. Focused source-graph regressions pass:
  5 cases. The clean complete REST suite passes: OpenAPI 2, config 21, API 995,
  middleware 29, and scheduler 10.
- A separate test-only correction serializes a Mongoose snapshot date before
  placing it in a graph URL; its isolated virtual-graph-integrity spec passes:
  3 cases.
- Proposed implementation commit: `fix(release-tracks): hydrate historical
relationship graphs`. Proposed test-only commit: `test(release-tracks):
serialize snapshot timestamps in graph URLs`.

### Production bootstrap replacement recovery

- [x] Reproduce the production preflight failure against the restored database.
- [x] Keep dynamic `latest` workflow selectors out of exact historical-pin
      compatibility comparisons.
- [x] Add an explicit, confirmed option to replace only the six exact-name
      bootstrap tracks, deleting virtual tracks before their standard inputs.
- [x] Repair six persisted v19.1 technique revisions whose platform arrays
      contain the correct values in a different order from the source bundles.
- [x] Run the corrected preflight against the restored production database and
      complete focused script verification.

Verification (2026-08-04):

- The restored-production preflight completes without treating nine dynamic
  `latest` candidates as timestamps and inventories all six existing tracks for
  replacement.
- It identifies 297 immutable baseline repairs: 291 canonical-domain revisions
  and six `x_mitre_platforms` ordering revisions.
- Two replacement applies complete successfully. The second reuses all 297
  semantic repair revisions, proving restart safety, and all three final bundle
  comparisons report `identical_excluding_collection: true` with member counts
  Enterprise 4,815, ICS 503, and Mobile 743.
- Bootstrap regressions pass: 36 cases. Python Ruff and the read-only production
  preflight pass.

### Closed-member deterministic relationship graphs

- [x] Reproduce exact-revision leakage when a relationship endpoint pins a
      different revision of an existing snapshot member.
- [x] Replace ID-frontier secondary expansion with indexed exact-endpoint
      relationship selection requiring both endpoint revisions in `members`.
- [x] Select only the latest relationship revision for each exact endpoint
      pair, with a later revoked or deprecated revision suppressing older
      active history.
- [x] Seed the v19.1 transition from the preceding source-attested manifest so
      historical relationships without truthful stored endpoint pins remain
      available while their exact member endpoints survive.
- [x] Keep schema-v2 relationships pointer-only and reject duplicate emitted
      STIX revisions or inconsistent relationship lineages.
- [x] Update release-track documentation and add regression coverage for
      closed membership, predecessor carry-forward, relationship advancement,
      and mutation protection.
- [x] Run focused release-track specs followed by the complete `npm test`
      suite.

Verification (2026-08-04):

- Closed-member graph regressions pass: 9 opt-in graph cases and 17 bundle
  cases.
- The complete release-track directory passes with 187 cases after two roaming
  harness failures were rerun successfully in isolation (27 cases).
- Lint and the complete `npm test` suite pass, including OpenAPI,
  configuration, API, middleware, and scheduler suites.

## Snapshot-history graph cache statistics

- [x] Add regression coverage for exact manifest-kind counts on cached
      snapshot summaries and omission on uncached snapshots.
- [x] Aggregate graph cache statistics for every manifest on a history page in
      one indexed query and expose the typed summary through OpenAPI.
- [x] Show CTI-oriented Primary, Secondary, Relationships, and Dependencies
      statistics for cached snapshots in the frontend History tab.
- [x] Update release-track user/developer documentation and run focused plus
      complete backend/frontend verification.

Verification (2026-08-03):

- Focused snapshot-history regressions pass: 7 REST cases and 65 Angular
  connector/component cases. OpenAPI validation passes.
- The complete frontend suite passes: 162 files and 363 tests. The Angular
  build passes with the local persistent cache temporarily disabled to avoid
  the environment-specific native cache crash; `angular.json` was restored.
- The complete REST suite passes: OpenAPI 2, config 21, API 994, middleware 29,
  and scheduler 10. A documented roaming backref setup flake passed all 24
  cases in isolation before the clean complete rerun.
- REST lint and targeted frontend ESLint/Prettier checks pass. The performance
  audit is `PERFORMANT`: one indexed aggregate covers every manifest on the
  bounded history page, with no per-snapshot query.
- Proposed REST commit: `feat(release-tracks): expose graph cache statistics`.
- Proposed frontend commit: `feat(release-tracks): show graph cache statistics`.

## v19.1 bootstrap graph lifecycle and canonical-domain correction

- [x] Add regressions proving canonical domains come from exact collection TOC
      membership, not secondary bundle appearance or projected payload fields.
- [x] Correct the startup canonical-domain backfill and add a forward migration
      for already-created domain-only successor revisions.
- [x] Replace the bootstrap's custom schema-v1 draft manifest writes with the
      supported tagged-snapshot schema-v2 graph endpoint.
- [x] Make bootstrap resume and final verification require a persisted graph
      and a post-graph v19.1 bundle comparison with no drift override.
- [x] Update the bootstrap runbook and canonical-domain documentation with the
      corrected provenance contract and recovery behavior.
- [x] Run focused migration/bootstrap/release-track regressions, then lint and
      the complete `npm test` suite.

Verification (2026-08-03):

- The local official v19.1 source audit finds exactly nine payload/TOC domain
  mismatches, all campaigns; corrected virtual membership is Enterprise 4,815,
  ICS 503, and Mobile 743.
- Canonical-domain migration regressions pass: 9 cases. Bootstrap regressions
  pass: 29 cases, including pointer-only graph validation and semantic drift
  rejection for relationships advanced by domain repairs.
- The complete `npm test` suite, repository ESLint, targeted migration ESLint,
  Python Ruff, Python bytecode compilation, and diff whitespace checks pass.
- Proposed commit: `fix(release-tracks): correct v19.1 bootstrap provenance`.

## Opt-in deterministic member graphs and rolling drafts

- [x] Add regressions for immutable versioned STIX payloads, pointer-only
      relationship manifests, and legacy frozen-manifest replay.
- [x] Add tagged-snapshot graph create/delete endpoints and make graphless
      bundle exports resolve live while persisted graphs cover members only.
- [x] Stop automatic graph generation during snapshot cloning and release;
      retain only the latest standard-track draft after a durable replacement.
- [x] Bound graph construction to relationship lineages that touch the
      selected member frontier and batch exact-revision hydration.
- [x] Update OpenAPI, user/developer documentation, and Bruno requests for the
      opt-in determinism and immutable-revision contracts.
- [x] Run focused regression specs, then the complete `npm test` suite and
      review the final performance/architecture diff.

Verification (2026-08-03):

- Opt-in graph regressions pass: graphless release, tagged-only graph
  creation/deletion, schema-v2 pointers, frozen marking definitions,
  correction by POST, live graphless replay, and rolling-draft truncation.
- Release-track regressions pass: 176 cases. Immutable CRUD regressions pass:
  378 cases. The migration regression preserves schema-v1 frozen replay.
- The complete `npm test` suite passes: OpenAPI 2, config 21, API 993,
  middleware 29, and scheduler 10.
- Repository lint and diff whitespace validation pass.
- Proposed commit: `feat(release-tracks): make deterministic graphs opt in`.

### Frontend deterministic bundle cache controls

- [x] Expose `graph_manifest_id` in lightweight snapshot-history summaries so
      the UI can render cache state without per-snapshot requests.
- [x] Add the frontend connector and History-tab cache state, warning
      tooltips, editor action, progress state, and success/error feedback.
- [x] Add focused REST and Angular regressions for summary propagation,
      connector routing, cache-state mapping, and materialization.
- [x] Run formatting, lint, builds, and the complete frontend/backend suites;
      record the final verification and proposed commits.

Verification (2026-08-03):

- Focused Angular connector/component regressions pass: 65 tests. The focused
  REST snapshot-history regression passes: 7 tests.
- The complete frontend suite passes: 162 files and 363 tests. The Angular
  build passes with the local persistent cache temporarily disabled to avoid
  an environment-specific native `lmdb` crash; no cache setting was committed.
- The complete REST suite passes: OpenAPI 2, config 21, API 993, middleware 29,
  and scheduler 10. REST lint passes.
- Changed frontend sources pass Prettier, targeted ESLint, and diff whitespace
  checks. Repository-wide frontend lint remains red on 254 pre-existing
  errors; the shared release-track API type retains one pre-existing
  index-signature violation.
- Proposed frontend commit: `feat(release-tracks): add deterministic bundle
cache controls`.

## Frontend canonical-domain preservation

- [x] Inventory every frontend model and object view corresponding to the
      canonical-domain migration's `TARGET_TYPES`.
- [x] Add a regression contract proving every target type preserves
      `x_mitre_domains` through deserialize/serialize.
- [x] Add domain model support and editable domain fields to the missing
      campaign, intrusion-set, detection-strategy, and matrix views.
- [x] Document the frontend domain-editing contract and run focused tests,
      lint/format checks, and the complete frontend test suite.

Verification (2026-08-03):

- Canonical-domain model and view contracts pass: 25 cases covering every
  migration target type.
- Complete frontend suite passes: 158 files and 323 tests.
- Angular build and targeted ESLint/Prettier checks for every changed source
  file pass.
- Repository-wide lint remains red on 256 pre-existing errors outside this
  change; no new lint errors remain in the hotfix files.
- Proposed frontend commit: `fix(stix): preserve canonical domains in
editors`.

## C0028 campaign revision / released virtual-snapshot investigation

- [x] Trace the submitted campaign payload through REST create handling and ADM
      citation validation against the authoritative ADM source.
- [x] Reproduce the reported 400 response and isolate whether the defect is in
      the payload, frontend transformation, REST API, or ADM.
- [x] Document the supported repair path and, as a fallback, enumerate every
      database invariant/provenance record a manual repair would have to keep
      consistent.
- [x] Record evidence, recommended regressions/fix scope, and a proposed
      conventional commit message without mutating production data.

Investigation (2026-08-03):

- The reported request cites `Booz Allen Hamilton` in both campaign temporal
  citation fields but sends only the `mitre-attack` external reference. ADM
  4.11.7 correctly reports both missing-reference refinements. Adding the
  released Booz Allen reference makes the composed campaign pass the WIP ADM
  schema.
- The Angular `Campaign` model does not deserialize or serialize
  `x_mitre_domains`, and the campaign view exposes no domain editor. The
  reported request consequently also omits the intended canonical-domain
  correction. This is a frontend payload defect, not an ADM defect.
- The supplied database record is a `releaseTrackGraphManifestEntries` root
  with an operationally frozen payload, not the authoritative campaign entity
  in `attackObjects`. Editing it would rewrite an immutable released artifact
  while retaining the old revision key and object timestamp.
- Supported hotfix: dry-run and then POST a new C0028 revision containing the
  Booz Allen external reference and
  `x_mitre_domains: ["enterprise-attack", "ics-attack"]`; let created-event
  relationship advancement and standard-track member sync create the next
  candidate/draft, then release the component track and materialize/tag a new
  virtual snapshot. Do not alter the already-tagged virtual snapshot.
- Recommended regressions: frontend campaign/group round-trip coverage for
  canonical domains; campaign save coverage that retains temporal citation
  references; backend campaign regression proving a missing cited source is
  rejected and the corrected revision succeeds with ADM validation enabled.
- Proposed implementation commit: `fix(campaigns): preserve domains and cited
references in revisions`.

Verification (2026-08-03):

- Direct ADM schema reproduction returns the two production error paths for
  the reported composed STIX object and succeeds after adding the cited
  reference and canonical domains in work-in-progress, awaiting-review, and
  reviewed states.
- Existing campaign API regression passes: 21 cases. Its placeholder
  organization identity causes an earlier suppressible ADM issue, so it does
  not currently exercise the citation refinement and needs the targeted
  regression above.

Follow-up frontend citation-loss investigation (2026-08-03):

- REST `BaseService.create()` removes only ATT&CK-owned external references,
  preserves every submitted user reference, regenerates the canonical ATT&CK
  reference, and validates that composed object. It deliberately does not
  merge omitted user references from the previous revision.
- Angular initially retains the C0028 `Booz Allen Hamilton` reference when it
  deserializes the GET response. `StixObject.base_validate()` first sends a
  valid dry-run payload, then calls the mutating `ExternalReferences.validate()`
  with only `description` and `aliases` as campaign citation fields.
- That incomplete field list treats the temporal citation reference as unused
  and removes it before the real save POST. Commit `4f04ac70` added server
  dry-run validation and explicitly removed `first_seen_citation` and
  `last_seen_citation` from this field list, creating a time-of-check/time-of-use
  mismatch. `ExternalReferences.parseObjectCitations()` still has the correct
  campaign field list.
- Minimum repair: restore both temporal citation fields to campaign reference
  validation. Durable repair: centralize the field list and complete all
  reference synchronization before the server dry run so validation and save
  serialize the same object state.

## STIX 2.0 virtual snapshot bundles

- [x] Add a virtual-track regression proving materialized snapshots emit STIX
      2.0 bundles when `stixVersion=2.0` and remain STIX 2.1 by default.
- [x] Align the virtual snapshot OpenAPI, user documentation, and Bruno request
      with the explicit STIX-version contract.
- [x] Run the focused regression followed by the complete `npm test` suite,
      review the final diff, and propose a conventional commit message.

Verification (2026-07-30):

- Virtual STIX-version bundle regression passes: 2 cases.
- Existing snapshot-bundle regression passes: 17 cases.
- Backend lint, Prettier, and diff whitespace validation pass.
- One aggregate attempt exposed the documented roaming References search 404;
  the affected spec passed all 17 cases in isolation.
- The clean complete suite passes: OpenAPI 2, config 21, API 989, middleware
  29, and scheduler 10.

## Client-managed virtual scheduled materialization

- [x] Add API regressions proving virtual-track POST and composition PUT
      requests persist `scheduled_materialization`.
- [x] Validate the client-supplied shape at controller, service, and Mongoose
      boundaries and reject it for standard tracks.
- [x] Expose the value through track listing, snapshot history, latest
      snapshot, and timestamp-selected snapshot GET responses.
- [x] Align OpenAPI, user/developer documentation, frontend guidance, and
      Bruno requests with the client-managed contract.
- [x] Run the focused regression spec followed by the complete `npm test`
      suite, review the final diff, and propose a conventional commit message.

Verification (2026-07-30):

- Focused scheduler and scheduled-materialization API regressions pass: 13
  cases.
- Previously roaming group-query and virtual-deduplication failures pass in
  isolation: 14 cases.
- The complete `npm test` suite passes, including OpenAPI, configuration, API,
  middleware, and scheduler stages.
- Backend lint and diff whitespace validation pass.

## Caller-supplied configuration on track creation

- [x] Add a regression proving `POST /api/release-tracks/new` accepts and
      persists supported `config` options on the initial snapshot.
- [x] Reuse the release-track config validation contract in the create request
      and pass the validated config through the snapshot creation service.
- [x] Update OpenAPI guidance, user documentation, and the Bruno request.
- [ ] Run the focused regression and the complete `npm test` suite.

Verification (2026-07-30):

- Focused release-track API regression passes: 3 cases.
- Backend lint and OpenAPI validation pass.
- The complete suite was run and reached API 975 passing with four failures
  in unrelated, pre-existing work: three canonical-domain migration failures
  and one roaming virtual-composition failure.
- The virtual-composition spec passes in isolation. The in-progress
  canonical-domain migration spec still has three isolated failures, so a
  clean aggregate run remains outstanding.

## Embedded canonical-domain migration and enforcement

- [x] Batch the canonical-domain migration so active revisions use bounded
      service-layer concurrency and verification/audit records avoid
      unnecessary per-object database round trips.
- [x] Replace the v19.1 object manifest with persisted canonical collection
      provenance and scan the latest revision of all 13 domain-bearing ATT&CK
      types, irrespective of active, deprecated, or revoked state.
- [x] Let the native migration driver generate inactive-clone `_id` values so
      Mongoose BSON 6 values are never passed to MongoDB driver/BSON 7 writes.
- [x] Serialize concurrent release-track member-sync mutations per track so
      batched reposts cannot overwrite candidates created by sibling workers.
- [x] Add batch-size, audit-sequence, shared-track concurrency, and
      idempotency regressions; update operator documentation and rerun the
      focused and complete test suites.
- [x] Add an idempotent startup migration that reposts every active latest
      domainless object through its normal service create lifecycle.
- [x] Include deprecated and revoked latest revisions as immutable direct
      clones, preserving lifecycle state and creating a new `modified`
      revision without relying on inactive-content POST guardrails.
- [x] Initialize release-track member synchronization during the migration so
      newly created revisions follow ordinary track-driven candidacy behavior.
- [x] Remove static `x_mitre_domains` validation bypasses and delete their
      already-persisted database copies during migration.
- [x] Default a latest domainless object that cannot be mapped to canonical
      collection provenance to `["enterprise-attack"]`, and audit the fallback.
- [x] Add migration, idempotency, inactive-state, member-sync, and ADM
      enforcement regressions.
- [x] Update migration and domain-contract documentation, then run focused
      tests, lint, and the complete `npm test` suite.

Verification (2026-07-30):

- Release-agnostic canonical-domain migration regression: 8 passing, covering
  all 13 domain-bearing types and the MongoDB 7/Mongoose MongoDB 6 driver
  boundary.
- Focused virtual-domain and bundle regressions: 23 passing.
- Backend and migration lint plus diff checks pass.
- Complete suite passes: OpenAPI 2, config 21, API 982, middleware 29, and
  scheduler 10.
- Existing release-track change-capture regression: 13 passing.
- Batch-related lint and formatting checks pass.
- Two complete-suite runs reached 977 and 975 API passes respectively. The
  remaining failures were the documented roaming HTTP/Mongo test-harness
  failures in unrelated specs; every affected spec, including virtual
  determinism, passes in isolation.
- Focused canonical-domain migration, virtual-filter, and bundle regressions:
  110 passing.
- Application and migration lint plus diff checks pass.
- The pre-batching clean full-suite baseline was OpenAPI 2, config 21, API 978,
  middleware 29, and scheduler 10.

## ATT&CK v19.1 canonical domain repair

- [x] Add a dry-run/apply operational migration that derives canonical
      `x_mitre_domains` values from object presence across the Enterprise, ICS,
      and Mobile v19.1 collection TOCs.
- [x] Repost each affected latest active object through its normal create
      endpoint so the repair creates a new revision and triggers ordinary
      release-track member synchronization.
- [x] Preserve canonical multi-domain arrays during legacy and ephemeral bundle
      export instead of narrowing them to the requested bundle domain.
- [x] Keep virtual `filters.domains` matching inclusive: any matching canonical
      domain includes an object, while no matching domain excludes it.
- [x] Document the canonical-domain contract and the required follow-up
      standard-track release after the repair creates new candidate revisions.
- [x] Run focused migration and API regressions, then lint, OpenAPI validation,
      and the complete `npm test` suite.

Verification (2026-07-30):

- Migration/bootstrap Python regressions: 20 passing.
- Focused bundle and virtual-domain API regressions: 23 passing.
- Lint and diff checks pass.
- Complete server suite passes: OpenAPI 2, config 21, API 973, middleware 29,
  and scheduler 10.

## Bootstrap hotfix — ATT&CK-branded track names

- [x] Permit ampersands in release-track names at the request and persistence
      validation boundaries.
- [x] Add an API regression using the production bootstrap name
      `Enterprise ATT&CK`.
- [x] Align OpenAPI and developer naming documentation with the accepted
      contract.

## Production-readiness branch — `fix/release-tracks-production-readiness`

This branch implements the prioritized findings in
`.nocommit/project-review-release-tracks/15-recommendations.md`. Each numbered
recommendation is kept as a separate conventional commit so the merge request
can be reviewed or reverted item by item.

### Current implementation slice — Immutable snapshot history

- [x] Remove direct latest and historical snapshot member-replacement
      endpoints (`POST /:id/contents` and
      `POST /:id/snapshots/:modified/contents`) from routes, controllers,
      services, validation, and OpenAPI.
- [x] Remove historical metadata rewriting
      (`POST /:id/snapshots/:modified/meta`); retain latest metadata updates,
      which create a new draft snapshot.
- [x] Permit snapshot deletion only for the latest untagged draft and return a
      typed `409 Conflict` for tagged or historical snapshots.
- [x] Replace test setup that depended on direct member replacement with
      supported bootstrap/candidate/promotion/release workflows, and add
      regressions for the removed endpoints and deletion boundary.
- [x] Update user/developer/admin documentation and the Angular, Python, and
      Bruno clients so no downstream surface suggests that persisted snapshot
      history can be rewritten.
- [x] Run focused server/client checks, then the complete server `npm test`
      suite, and record the results.

Verification (2026-07-30):

- Server: focused release-track regression files, OpenAPI validation, lint,
  and the complete `npm test` suite passed.
- Angular: connector regression tests, changed-file formatting/lint checks,
  and the complete frontend test suite passed.
- `internalattack`: release-track regression tests, changed-file Ruff checks,
  and the complete Python test suite passed.
- Bruno: the release-track collection no longer contains the removed mutation
  requests, and its modified request files pass scoped whitespace validation.

### P0.1 — Enforce release version uniqueness

- [x] Add a unique partial index for tagged `version` strings in every dynamic
      release-track snapshot collection.
- [x] Convert duplicate-version races into a typed `409 Conflict` that
      identifies the track and requested version.
- [x] Add a regression that releases two distinct drafts concurrently with the
      same version and proves exactly one succeeds.
- [x] Adopt the pre-release reset policy for collections created with the
      former non-unique index. No shared deployment retains beta release-track
      data, so this change deliberately does not establish a permanent
      migration contract for local development state.
- [x] Update release-version documentation and run focused, middleware, and
      lint verification.
- [ ] Obtain one clean aggregate `npm test` run for the migration cleanup. Three
      attempts exposed the repository's roaming cross-spec isolation failure;
      every affected spec passed immediately in isolation.

Original implementation verification (2026-07-30):

- The deterministic concurrent-release, middleware, and isolated
  roaming-failure group passes.
- The required clean full suite passes: OpenAPI 2, config 21, API 947,
  middleware 25, and scheduler 10.
- New dynamic track collections create the unique partial index before their
  initial snapshot is persisted. Existing personal development tracks created
  under the former beta schema are reset or recreated.

Pre-release migration cleanup verification (2026-07-30):

- Release planning and concurrent-version coverage passes all 20 cases.
- Error middleware passes all 9 cases; lint and diff checks pass.
- Aggregate attempts failed in different, unrelated modules: user accounts,
  groups, releases-by-object, and tagged-content immutability. Those modules
  pass in isolation (9, 23, 8, and 1 cases respectively), confirming no
  reproducible migration-cleanup regression.

### P0.2 — Make primary release membership fail closed

- [x] Add one shared batch hydrator that resolves dynamic selectors, validates
      every exact `(object_ref, object_modified)` pair, and reports all missing
      primary revisions without swallowing repository failures.
- [x] Reject nonexistent exact candidate pins, candidate pin updates, the
      then-supported direct member replacement requests, track cloning, and
      virtual materialization before snapshot persistence. Direct replacement
      was subsequently removed by the immutable-history slice.
- [x] Revalidate existing and promoted members at release-preview and
      release-commit boundaries; return a typed `409 Conflict` for corrupt stored
      drafts.
- [x] Abort bundle import before creating a track when any authoritative
      primary object failed to import or cannot be hydrated.
- [x] Abort bundle/workbench export when selected primary revisions cannot be
      hydrated; return every missing reference instead of a partial result.
- [x] Add ingress, partial-import, deleted-staged-revision, virtual
      materialization, and incomplete-export regressions.
- [x] Update user/developer documentation and run focused, lint, OpenAPI, and
      complete-suite verification.

Verification result (2026-07-30):

- The shared integrity, release, export, virtual determinism/quarantine, and
  middleware regression group passes (54); the complete release-track API
  regression group passes (143).
- OpenAPI validation (2) and backend lint pass.
- The required full suite passes: OpenAPI 2, config 21, API 955, middleware
  27, and scheduler 10.
- Bruno documents the structured `400`/`409` integrity response on companion
  branch `fix/release-tracks-production-readiness`.

### Remaining prioritized recommendations

### P0.3 — Make tagged-content immutability authoritative and durable

- [x] Guard object revision update/delete and delete-all by querying tagged
      snapshot membership, even when `workspace.release_tracks` is missing or
      stale.
- [x] Make release-track backref reconciliation failures propagate to the
      triggering request so a release is never reported as fully successful when
      protection writes failed.
- [x] Persist every reconciliation attempt and its terminal outcome so
      process crashes and partial listener failures remain operator-visible.
- [x] Provide an idempotent repair command for failed/pending reconciliation
      records and a full-scan mode for legacy drift.
- [x] Add failure-injection, missing-backref, repair, and historical-release
      regressions; update user/developer/admin documentation.
- [x] Run focused, lint, OpenAPI, and complete-suite verification.

Verification result (2026-07-30):

- Lint and OpenAPI validation pass.
- The complete release-track API group passes (146), including
  failure-injection, repair, and authoritative historical-membership
  regressions. Scheduler/date/cron integration (15) and middleware (11)
  focused groups pass.
- Repeated complete-suite runs execute all 958 API cases and consistently
  pass the release-track cases. The repository's documented roaming
  Supertest transport flake still moves among unrelated isolated-pass cases
  (socket resets, transient status mismatches, or timeouts). Dynamic
  release-track models are now evicted between dropped test databases and the
  Mongoose connection is reused, reducing the API run from roughly six
  minutes to roughly one minute; the remaining unrelated transport flake is
  tracked separately from this completed integrity change.

### P0.4 — Correct destructive authorization and add durable audit records

This records the earlier beta contract. The immutable-history slice later
removed both member-replacement routes and their audit action types; durable
auditing now applies only to full-track deletion.

- [x] Require administrator authorization for full track deletion and both
      direct member-replacement routes.
- [x] Require an exact `confirm_track_id` precondition on each destructive
      request so stale or accidental UI actions fail before persistence.
- [x] Persist a durable, actor-attributed audit event before each operation
      and record completion or failure without hiding partial persistence.
- [x] Add an authorization matrix and operator-facing audit documentation.
- [x] Update OpenAPI, frontend tasks, and Bruno requests for the confirmation
      contract.
- [x] Add admin/editor, missing/mismatched confirmation, success/failure
      audit, lint, OpenAPI, focused, and complete-suite verification.

Verification result (2026-07-30):

- Lint and OpenAPI validation pass.
- The focused authorization/audit and middleware group passes (11). The
  complete release-track and virtual-scheduler group passes all 148 relevant
  cases; one roaming setup 404 passed immediately in isolation (8).
- The required clean full suite passes: OpenAPI 2, config 21, API 960,
  middleware 29, and scheduler 10.
- The `internalattack` focused release-track suite passes (33), its complete
  suite passes (246), and changed-file Ruff checks pass.

- [ ] P0.5 — Complete the Angular contract migration and end-to-end smoke gate.
- [ ] P0.6 — Finish scheduled-materialization fencing, retry bounds, and
      operator intervention.
- [ ] P0.7 — Establish and enforce a safe storage operating envelope.
- [ ] P0.8 — Harden deployment, database readiness, backup/restore, rollback,
      and post-deploy verification.
- [ ] Address P1 recommendations in documented criticality order.

## Current implementation slice — Deterministic snapshot bundle graphs

This slice replaces export-time relationship and secondary-object discovery
with a frozen graph manifest for every persisted release-track snapshot. The
manifest is authoritative for bundle replay and for protecting every exact
revision on which that bundle depends.

### Shared graph resolution

- [x] Extract the bounded ATT&CK graph-selection rules from the mutable
      `stix-bundles-service` singleton into a request-local resolver.
- [x] Preserve the existing one-hop and named special-case behavior for
      `detects`, `attributed-to`, `revoked-by`, detection strategies, analytics,
      and required supporting objects without introducing unrestricted graph
      traversal.
- [x] Make the legacy/ephemeral exporter and release-track snapshot capture
      use thin adapters around the same resolver.
- [x] Add parity and concurrent-request regression coverage before changing
      release-track persistence.

### Revision-pinned relationships

- [x] Store server-controlled exact source and target revision pins under
      `workspace.relationship_endpoints`; do not add non-ADM fields to emitted
      STIX payloads.
- [x] Resolve endpoint revisions when relationships are created, including
      bundle-import and automated relationship-creation paths, and fail closed
      when an exact endpoint cannot be established.
- [x] Create new SRO revisions when a referenced SDO advances instead of
      mutating an existing `(stix.id, stix.modified)` revision.
- [x] Reject in-place source, target, and relationship-type changes.
      Description-only corrections remain allowed because manifests freeze the
      relationship STIX payload used by existing snapshots.

### Snapshot graph manifests

- [x] Persist an exact, tier-aware manifest for every newly created standard
      and virtual snapshot. Include primary roots, relationships, secondary
      objects, identities, marking definitions, and LinkById render dependencies.
- [x] Store manifest entries in one indexed collection so exact revision
      hydration and mutation-protection checks do not scan dynamic snapshot
      collections.
- [x] Make snapshot capture fail closed and concurrency-safe. Complete
      manifests are linked before activation; linked pending manifests remain
      replayable and self-activate after an interrupted write.
- [x] Replace a standard draft's manifest from the resolved release plan in
      the same conditional tag update, so staged `"latest"` selectors become
      exact released members without creating a second snapshot timestamp.
- [x] Replay `format=bundle` entirely from the frozen manifest, with no live
      relationship, secondary, supporting-object, or LinkById discovery. The
      deliberate exception is an explicitly included standard draft tier whose
      stored selector is `"latest"`; that tier remains dynamic until release.

### Mutation and deletion protection

- [x] Centralize exact graph-pin checks in the shared object service layer.
- [x] Return `409 Conflict` when a PUT or exact-revision delete would mutate
      an emitted revision referenced by any active or pending manifest.
- [x] Reject lineage deletion when any revision in the lineage is manifest
      referenced; administrator authorization must not bypass graph integrity.
- [x] Remove protection entries when their owning snapshot or track is
      deleted, with idempotent reconciliation for interrupted cleanup.

### Migration, documentation, and verification

- [x] Add a dry-run-capable, idempotent migration that resolves endpoint pins
      for the latest revision of each relationship directly from the underlying
      collections. Do not write through `view.relationships.latest`.
- [x] Backfill existing snapshots with manifests reconstructed from the graph
      visible at migration time and label them as baseline reconstructions rather
      than historically exact captures.
- [x] Add regression coverage for newer SDO/SRO revisions, relationship
      deprecation, missing dependencies, PUT/delete guards, standard and virtual
      snapshots, query-tier filtering, migration reruns, and concurrent capture.
- [x] Update OpenAPI error contracts, user/developer/admin documentation,
      frontend guidance, `internalattack`, and Bruno where the observable contract
      changes. No request route or parameter changed, so generated clients and
      Bruno request definitions require no transport change.
- [x] Run focused specs while iterating, then lint, OpenAPI validation, and the
      complete `npm test` suite.

### Production-shaped migration repair

- [x] Scope legacy endpoint pinning to active latest relationships, matching
      the relationship set eligible for deterministic snapshot graphs.
- [x] Preserve fail-closed behavior for active dangling relationships while
      allowing deprecated or revoked dangling history to remain untouched.
- [x] Surface actionable missing-endpoint diagnostics in the migration preview
      and startup failure.
- [x] Establish manifest indexes independently of whether relationship pin
      updates happen to be required.
- [x] Add production-shaped migration regressions and update the operator
      documentation.

Verification result (2026-07-30):

- The focused migration spec passes all 4 cases.
- A read-only preview against the restored production database scans 24,818
  active relationship revisions without encountering the 118 dangling
  endpoints confined to deprecated relationship history.
- Lint, formatting, diff checks, and the complete `npm test` suite pass; the
  API suite passes all 972 cases.

- [x] Propose conventional commits split by independently reviewable
      architectural slice; do not commit until requested.

Verification result (2026-07-30):

- The focused deterministic-graph group passes all 101 cases; the final
  compatibility group for relationship pagination, reports, and collection
  imports passes all 27 cases.
- Lint, formatting, OpenAPI validation, and diff checks pass.
- The required clean full suite passes: OpenAPI 2, config 21, API 971,
  middleware 29, and scheduler 10.

## Current implementation slice — Scheduler regression and virtual schedule coverage

- [x] Repair the legacy collection-index scheduler spec so it imports the
      refactored `sync-collection-indexes-task` module without auto-registering
      background jobs during the test.
- [x] Add virtual-track coverage proving reconciliation registers scheduled
      cron jobs in UTC and removes jobs for tracks that no longer exist.
- [x] Add date-schedule boundary coverage for multiple due dates and future
      dates.
- [x] Add crash-window recovery coverage for a scheduled virtual snapshot that
      was persisted before its occurrence ledger reached `completed`.
- [x] Add stale-claim recovery coverage and document any remaining
      multi-process lease/fencing limitation.
- [x] Run the legacy scheduler spec, the virtual scheduler spec, the aggregate
      scheduler suite, lint, and the complete `npm test` suite.
- [x] Record the coverage conclusion and propose a conventional commit message.

Coverage conclusion (2026-07-30):

- Functional coverage is sufficient for the current `manual`, `cron`, and
  `dates` contracts. It exercises UTC cron registration and cleanup, duplicate
  delivery, multiple due and future dates, missed-date recovery, retryable
  component failures, expired claims, and recovery after snapshot persistence.
- Scheduler regressions now run under the default `npm test` and Cobertura
  coverage gates instead of requiring a separate developer-only command.
- Remaining production hardening is explicitly tracked below; it does not
  change the single-worker schedule contract covered by this slice.

Verification result (2026-07-30):

- The deterministic legacy collection-index scheduler spec passes (2), the
  expanded virtual scheduler spec passes (8), and the aggregate scheduler
  suite passes (10).
- Backend lint passes. The required clean full suite passes: OpenAPI 2,
  config 21, API 945, middleware 24, and scheduler 10.
- Three roaming API-suite failures seen during earlier runs passed together in
  isolation (23) before the clean full-suite run.

### Remaining scheduled-materialization hardening

- [ ] Add an owner token (fencing token) to occurrence claims, make terminal
      updates conditional on the active token, and renew leases for work that may
      exceed the claim duration. Add a true multi-worker regression proving that
      an expired worker cannot overwrite the succeeding worker's result.
- [ ] Decide and document an operator policy for permanent failures. If
      indefinite one-minute retries are not acceptable, add bounded exponential
      backoff plus a terminal/dead-letter state and operator-visible recovery
      controls.

## Current implementation slice — Deterministic standard releases

- [x] Preserve `modified: "latest"` and omitted candidate selectors as dynamic
      references through the candidate and staged tiers; preserve explicit
      timestamps as exact revision pins.
- [x] Resolve every dynamic staged reference to the actual latest
      `stix.modified` timestamp during standard release planning, before conflict
      detection, preview rendering, or commit.
- [x] Ensure tagged members contain exact revisions only and that preview and
      commit use the same release-planning rules.
- [x] Make dynamic candidate/staged references safe in tier comparison,
      Workbench enrichment, bundle rendering, back-reference reconciliation, and
      member-sync paths.
- [x] Add regression coverage for dynamic and explicit candidate promotion,
      release-time resolution after a newer revision is created, historical
      release targeting, conflict handling, and member immutability.
- [x] Update OpenAPI, user/developer documentation, frontend guidance,
      `internalattack`, and Bruno as required by the corrected contract.
- [x] Run focused tests, lint, OpenAPI validation, and the complete `npm test`
      suite.
- [x] Apply logic review, inspect the final diff, and propose conventional
      commit messages.

Verification result (2026-07-30):

- The combined release, back-reference, change-capture, bundle,
  tier-invariant, and virtual-determinism regression group passes (81); the
  strengthened release-planning spec passes (19).
- OpenAPI validation passes (2), backend lint passes, and the required clean
  full suite passes with routine logs suppressed (OpenAPI 2, config 21, API
  945, middleware 24).
- The focused `internalattack` release-track suite passes (30), its complete
  suite passes (247), and changed-file Ruff checks pass.
- Relevant REST API, `internalattack`, and Bruno diffs pass whitespace checks.

## Virtual release tracks

This section records the 2026-07-29 documentation-to-implementation audit of
virtual release tracks. Items are ordered by integrity risk and implementation
dependency. A checked item must include regression coverage and any necessary
OpenAPI, user/developer documentation, client, and Bruno updates.

The completed P0 implementation and verification records remain in the dated
sections below. The following items constitute the active virtual-track
completion backlog.

### P1 — Composition validation and deterministic resolution

- [x] Make request validation strict so misspelled keys such as
      `filters.domain` return 400 instead of silently disabling filtering.
- [x] Validate component selectors according to `resolution_strategy`:
  - `specific_version` requires `version` and rejects `snapshot`;
  - `specific_snapshot` requires `snapshot` and rejects `version`;
  - `latest_tagged` rejects both selector fields.
- [x] Make `priority` consistently required in Zod, Mongoose, OpenAPI, docs,
      and examples; reject duplicate priorities at the request boundary.
- [x] Validate component existence, standard-track type, duplicate track IDs,
      and duplicate priorities when a virtual track is initially created, not only
      when composition is later updated or materialized.
- [x] Validate `snapshot_schedule` by mode:
  - `manual` rejects `cron` and `dates`;
  - `cron` requires `cron` and rejects `dates`;
  - `dates` requires at least one date and rejects `cron`.
- [x] Constrain or document accepted `filters.object_types` values and add
      direct regression coverage for exact-revision filtering.

### P1 — Deduplication correctness

- [x] Treat the same exact object revision contributed by multiple components
      as one duplicate, not a conflicting revision.
- [x] Ensure the `quarantine` strategy only quarantines genuinely different
      revisions of the same object.
- [x] Attribute each surviving revision to one deterministic component so
      `objects_contributed` totals cannot exceed `summary.total_objects`.
- [x] Add dedicated tests for all four strategies:
      `prioritize_latest_object`, `prioritize_latest_snapshot`,
      `prioritize_higher_priority`, and `quarantine`.

### P1 — Release provenance

- [x] Populate virtual release `version_history[].component_versions` from the
      materialized snapshot's immutable `composition_resolution`.
- [x] Define and test the provenance shape in Mongoose, OpenAPI, and user and
      developer documentation.

### P2 — Scheduled materialization

- [x] Connect virtual `snapshot_schedule` metadata to the existing task
      scheduler. This is required for virtual-track completion, not an optional
      future enhancement.
- [x] Implement `cron` execution so each matching schedule occurrence
      materializes a new virtual draft through the same lifecycle and validation
      used by `POST /api/release-tracks/:id/virtual/snapshots/create`.
- [x] Implement `dates` execution so every configured timestamp materializes
      exactly one virtual draft, including deterministic handling for restart
      recovery, missed timestamps, and duplicate-delivery prevention.
- [x] Preserve `manual` semantics: store no executable schedule and create
      drafts only through the explicit virtual snapshot-creation endpoint.
- [x] Define failure behavior when a component has no matching tagged
      snapshot, including automation-run audit records and retry policy.
- [x] Add scheduler integration tests for both `cron` and `dates`, including
      successful execution, restart recovery, idempotency, component-resolution
      failure, and retry behavior.
- [x] Add operational documentation covering scheduler activation, UTC
      interpretation, observability, failures, and retries.

### Current implementation slice — Scheduled virtual materialization

- [x] Add a scheduler reconciliation task for persisted virtual-track
      `cron` and `dates` schedules while preserving explicit-only `manual` mode.
- [x] Persist schedule occurrences and claim them atomically so multiple
      scheduler instances cannot concurrently process the same occurrence.
- [x] Make snapshot persistence idempotent by recording the scheduled
      occurrence on the resulting virtual draft.
- [x] Recover missed `dates` occurrences and failed `cron` or `dates`
      occurrences during reconciliation.
- [x] Record every materialization attempt in the automation-run audit trail.
- [x] Add scheduler integration coverage for success, restart recovery,
      duplicate delivery, component failure, and retry.
- [x] Update OpenAPI, user/developer/operations documentation, frontend
      guidance, and Bruno.
- [x] Run focused scheduler tests, lint, and the complete `npm test` suite.
- [x] Review the final diff and propose conventional commit messages.

Verification result (2026-07-29):

- The focused scheduler integration spec passes (4), OpenAPI validation
  passes (2), and backend lint passes.
- The first complete run encountered five unrelated roaming failures after
  933 API tests passed. Each affected spec passed in isolation.
- The required clean `npm test` rerun passes (OpenAPI 2, config 21, API 938,
  middleware 24).
- Proposed REST API commit:

  ```text
  feat(release-tracks): schedule virtual snapshot materialization

  Execute persisted cron and date schedules through the existing virtual
  snapshot lifecycle. Add durable occurrence claims, restart-safe
  idempotency, automation-run auditing, retry behavior, scheduled snapshot
  provenance, and aligned API and operations documentation.
  ```

- Proposed companion Bruno commit:

  ```text
  docs(release-tracks): document scheduled materialization

  Describe UTC cron and date execution, restart recovery, idempotency,
  and retry behavior for virtual snapshot schedules.
  ```

### P2 — Contract decisions

- [x] Virtual tracks cannot compose virtual tracks. Components must be
      standard tracks; revisit nesting only if a concrete future use case requires
      it.
- [x] Do not implement the documented native-members/hybrid model. Virtual
      tracks are purely compositional; content that is not already represented
      belongs in a dedicated standard component track.
- [x] Do not implement `resolve=true` or `resolved_content`. Virtual
      composition is resolved eagerly into exact object revisions when a draft is
      materialized; retrieval must never re-resolve a persisted snapshot.
- [x] Do not implement caching or component-release notifications without
      measured scale or an approved operator workflow. Persisted snapshots already
      avoid composition recomputation, and no notification recipient, channel, or
      expected action has been defined.

### Current implementation slice — Deterministic virtual membership

- [x] Resolve the `latest` request shorthand to the actual latest
      `stix.modified` value before standard-track contents are persisted.
- [x] Defensively lock any unresolved component member to an exact revision
      during virtual materialization, while preserving exact revisions already
      frozen into tagged component snapshots.
- [x] Add regression coverage proving that component `track_latest` behavior
      cannot move a materialized virtual member and repeated snapshot retrieval
      returns the same exact revision set.
- [x] Remove `resolve=true` and `resolved_content` from the documented
      retrieval contract.
- [x] Initially document the distinction between deterministic primary
      membership and the then-dynamic bundle graph; the later deterministic graph
      manifest slice below supersedes that accepted limitation.
- [x] Update OpenAPI, frontend guidance, and Bruno where the clarified
      contract affects consumers.
- [x] Run focused tests, lint, OpenAPI validation, and the complete `npm test`
      suite.
- [x] Apply logic review, inspect the final diff, and propose conventional
      commit messages.

Verification result (2026-07-29):

- The dedicated virtual-determinism spec passes (2), and the combined
  determinism, release-track lifecycle, and virtual-domain regression group
  passes (4).
- OpenAPI validation passes (2), backend lint passes, and the complete
  `npm test` suite passes (OpenAPI 2, config 21, API 941, middleware 24).
- Logic review result: `ROBUST`. Request-time `latest` resolution, immutable
  tagged component pins, legacy unresolved-member locking, invalid-date
  rejection, and repeated-reference resolution were covered without finding a
  remaining correctness defect.
- Proposed commits:

  ```text
  fix(release-tracks): enforce pure virtual composition

  Require virtual components to be standard tracks and reject unsupported
  native-member input across the API contract and documentation.
  ```

  ```text
  fix(release-tracks): freeze virtual member revisions

  Resolve latest member shorthand before persistence, lock virtual composition
  to exact revisions, and document the bundle graph consistency boundary.
  ```

  ```text
  docs(release-tracks): clarify snapshot determinism

  Document exact virtual member pins and the snapshot graph consistency
  boundary in the Bruno collection.
  ```

### Future architecture — Deterministic bundle graphs

- [x] Design version-controlled STIX Relationship Objects whose source and
      target references identify exact `(object_id, object_modified)` revisions
      rather than an entire STIX object provenance chain.
- [x] Evaluate cloning every affected SRO when a new SDO revision is created,
      including atomicity, fan-out, concurrency, migration, and rollback behavior.
- [x] Avoid cloning SROs per snapshot by recording exact endpoint metadata on
      each SRO revision and storing compact manifest references plus a frozen SRO
      payload where description-only PUT compatibility requires it.
- [x] Define and persist an export manifest that pins every secondary object,
      supporting object, and relationship revision required to reproduce a bundle.
- [x] Document the resulting guarantee: the emitted object graph is
      deterministic, while the generated bundle-envelope UUID is not byte-stable.

### Current implementation slice — Pure standard-track composition

- [x] Make standard component tracks a positive service-layer requirement,
      preserving rejection during both virtual-track creation and composition
      replacement.
- [x] Reject unsupported top-level creation properties such as
      `native_members` instead of silently stripping them.
- [x] Add regression coverage for virtual-track nesting on both creation and
      composition update, and for attempted native-member creation.
- [x] Remove nesting and hybrid/native-member claims from OpenAPI, user and
      developer documentation, frontend guidance, and Bruno.
- [x] Run the focused virtual-composition spec, lint, and complete `npm test`
      suite.
- [x] Review the final diff and propose conventional commit messages.

Verification result (2026-07-29):

- The focused virtual-composition validation spec passes (6), OpenAPI
  validation passes (2), and backend lint passes.
- The first complete run encountered six unrelated roaming failures after
  910 API tests passed. All affected specs passed in isolation.
- The required clean `npm test` rerun passes in full, including OpenAPI,
  configuration, API, and middleware suites.
- Architecture review result: the positive standard-track allowlist and strict
  creation schema keep the contract explicit without adding a parallel
  composition path or new abstraction.
- Proposed REST API commit:

  ```text
  fix(release-tracks): enforce pure virtual composition

  Require every virtual component to be a standard track during creation and
  composition updates. Reject unsupported native-member input and align
  OpenAPI, documentation, frontend guidance, and regression coverage.
  ```

- Proposed companion Bruno commit:

  ```text
  docs(release-tracks): clarify pure virtual composition

  Document standard-only components, rejected virtual nesting, and the absence
  of native virtual members.
  ```

### Documentation corrections

- [ ] Replace `stix.type = "virtual"` with the top-level snapshot
      `type: "virtual"`.
- [ ] Remove the nonexistent snapshot-level `snapshot_id`; retain
      `version_history[].snapshot_id`.
- [ ] Correct response envelopes and the virtual-create response example.
- [ ] Align `composition_resolution` examples with fields actually generated,
      or implement the documented `by_type`, `by_tier`, and native statistics.
- [ ] Align documented error envelopes with centralized error-handler output.
- [x] Include required `priority` values in every composition example.
- [x] Clearly distinguish configured composition from a materialized draft and
      document scheduler activation, timing, recovery, and retry behavior.

### Verified complete

- [x] Composition changes invalidate inherited materialized contents and
      require explicit rematerialization before release.
- [x] Generic contents replacement rejects virtual tracks.
- [x] Exact-revision quarantine resolution is available at
      `POST /api/release-tracks/:id/virtual/quarantine/promote`.
- [x] `filters.domains` hydrates and evaluates exact pinned revisions.
- [x] Public domain names and STIX `*-attack` names are normalized.
- [x] Multiple domain values are supported.
- [x] Objects without domain metadata are excluded when a domain filter is set.
- [x] Primary Enterprise, ICS, and Mobile matrices use their ATT&CK external ID
      as the established domain fallback.
- [x] Virtual tracks resolve only tagged snapshots and consume only component
      `members`.
- [x] Virtual tracks maintain independent draft/release history and use the
      shared snapshot retrieval and release endpoints after materialization.

### Current implementation slice — Strict composition contracts

- [x] Add API regression coverage for unknown composition/filter keys on both
      virtual-track creation and composition update.
- [x] Require the selector appropriate to each `resolution_strategy` and
      reject selectors that do not apply to that strategy.
- [x] Make the composition, component, filter, and deduplication request
      objects strict without changing persisted response shapes.
- [x] Update OpenAPI, user/developer documentation, and Bruno examples.
- [x] Run the focused regression spec, then lint and the complete `npm test`
      suite.
- [x] Review the final diff and propose a conventional commit message.

Verification result (2026-07-29):

- The focused virtual-composition contract spec passes (3), OpenAPI validation
  passes (2), and backend lint passes.
- The first complete run encountered one roaming 404 in the new spec after 917
  API tests passed. The spec passed both in isolation (3) and alongside its
  preceding snapshot-history spec (10).
- The required clean `npm test` rerun passes (OpenAPI 2, config 21, API 918,
  middleware 24).
- Proposed commit:

  ```text
  fix(release-tracks): validate virtual composition contracts

  Reject unknown composition properties and enforce strategy-specific
  component selectors across virtual-track creation and updates. Align
  OpenAPI, documentation, frontend guidance, and Bruno examples.
  ```

### Current implementation slice — Component identity and priority validation

- [x] Add creation and composition-update regression coverage for required
      priorities, duplicate priorities, and duplicate component track IDs.
- [x] Reject missing component tracks and virtual component tracks before an
      initial virtual track is persisted.
- [x] Make component priority required and non-negative across Zod, Mongoose,
      OpenAPI, user/developer documentation, and Bruno examples.
- [x] Keep service-layer component validation as a defense for non-HTTP
      callers while moving deterministic duplicates to request validation.
- [x] Run the focused regression specs, then lint and the complete `npm test`
      suite.
- [x] Review the final diff and propose a conventional commit message.

Verification result (2026-07-29):

- The focused release-track regression group passes (22), the isolated
  backrefs spec passes (23), OpenAPI validation passes (2), and backend lint
  passes.
- The first complete run encountered one unrelated shared-suite failure in the
  backrefs manual-sync case after 919 API tests passed. The affected spec
  passed in isolation (23).
- The required clean `npm test` rerun passes (OpenAPI 2, config 21, API 920,
  middleware 24).
- Proposed commit:

  ```text
  fix(release-tracks): validate virtual component identities

  Require unique component priorities and track IDs, validate referenced
  standard tracks before initial virtual-track persistence, and align request,
  persistence, OpenAPI, documentation, and frontend contracts.
  ```

- Proposed companion Bruno commit:

  ```text
  docs(release-tracks): document component priority constraints

  Document required unique priorities and standard component references for
  virtual-track creation and composition updates.
  ```

### Current implementation slice — Snapshot schedule contracts

- [x] Add creation regressions for valid and invalid `manual`, `cron`, and
      `dates` schedule payloads.
- [x] Enforce a strict mode-discriminated request contract:
  - `manual` accepts only `mode`;
  - `cron` requires `cron` and rejects `dates`;
  - `dates` requires at least one date and rejects `cron`.
- [x] Reject `snapshot_schedule` on standard-track creation instead of silently
      dropping it.
- [x] Repeat schedule invariants at the service and Mongoose boundaries for
      non-HTTP callers.
- [x] Align OpenAPI, user/developer documentation, frontend guidance, the
      `internalattack` test fixture, and Bruno.
- [x] Run focused regression specs, lint, and the complete `npm test` suite.
- [x] Review the final diff and propose conventional commit messages.

Verification result (2026-07-29):

- The focused schedule-contract spec passes (7), the focused virtual-track
  regression group passes (29), OpenAPI validation passes (2), and backend
  lint passes.
- The required complete `npm test` suite passes (OpenAPI 2, config 21, API
  927, middleware 24).
- The `internalattack` focused release-track suite passes (30), and its
  complete suite passes (247).
- Proposed REST API commit:

  ```text
  fix(release-tracks): validate virtual snapshot schedules

  Enforce strict mode-specific virtual snapshot schedules across request,
  service, persistence, OpenAPI, documentation, and frontend contracts.
  Reject schedule metadata for standard tracks.
  ```

- Proposed companion Bruno commit:

  ```text
  docs(release-tracks): document snapshot schedule modes

  Document the strict manual, cron, and dates schedule payloads and clarify
  that automated execution is not yet implemented.
  ```

- Proposed companion `internalattack` commit:

  ```text
  test(release-tracks): align virtual composition fixture

  Include the required component priority in virtual-track creation coverage.
  ```

### Current implementation slice — Object-type filter contracts

- [x] Define `filters.object_types` against the canonical Workbench STIX type
      vocabulary instead of accepting arbitrary strings.
- [x] Reject empty arrays, duplicate values, malformed values, and unsupported
      object types on both virtual-track creation and composition update.
- [x] Repeat the accepted-value constraint at the Mongoose persistence
      boundary.
- [x] Add direct materialization coverage proving that object-type filtering
      preserves the exact revision pinned by the tagged component snapshot rather
      than resolving the latest database revision.
- [x] Align OpenAPI, user/developer documentation, frontend guidance, and
      Bruno; verify whether `internalattack` needs a typed client change.
- [x] Run focused regression specs, lint, and the complete `npm test` suite.
- [x] Review the final diff and propose conventional commit messages.

Verification result (2026-07-29):

- The dedicated object-type contract and exact-revision materialization spec
  passes (5); the combined virtual composition, domain, schedule, and
  object-type filter group passes (18).
- OpenAPI validation passes (2), backend lint passes, and the required clean
  `npm test` run passes (OpenAPI 2, config 21, API 923, middleware 24).
- Earlier complete runs encountered unrelated shared-suite flakes in user
  account startup, analytics socket handling, and campaign/group HTTP
  handling. The affected specs pass in isolation (14, 12, and 44
  respectively).
- `internalattack` already accepts composition filters as a mapping, so this
  contract clarification does not require a typed client change.
- Proposed REST API commit:

  ```text
  fix(release-tracks): validate virtual object type filters

  Constrain virtual component object-type filters to the canonical Workbench
  STIX vocabulary across request, service, persistence, OpenAPI, and
  documentation boundaries. Preserve exact component snapshot revisions.
  ```

- Proposed Bruno commit:

  ```text
  docs(release-tracks): document object type filters

  Document canonical virtual component object-type values, omission semantics,
  and exact-revision behavior.
  ```

### Current implementation slice — Deterministic virtual deduplication

- [x] Add materialization regressions for all four deduplication strategies
      using both an exact revision shared by multiple components and genuinely
      different revisions of the same STIX object.
- [x] Collapse repeated contributions of the same `(object_ref,
object_modified)` revision before applying conflict resolution.
- [x] Count an object contributed by multiple components once in
      `duplicates_found`, but include it in `conflicts_resolved` only when multiple
      distinct revisions remain after exact-revision collapse.
- [x] Choose one deterministic source component for every surviving revision:
      use the active strategy's ordering and use component priority as the stable
      tie-breaker.
- [x] Quarantine one entry per distinct conflicting revision and leave an
      identical revision shared by multiple components in `members`.
- [x] Derive `objects_contributed` from explicit survivor attribution so its
      component total equals `summary.total_objects`.
- [x] Align OpenAPI, user/developer documentation, frontend guidance, Bruno,
      and `internalattack` if the clarified response semantics require downstream
      changes.
- [x] Run focused regression specs, lint, and the complete `npm test` suite.
- [x] Review the final diff and propose conventional commit messages.

Verification result (2026-07-29):

- The dedicated four-strategy deduplication spec passes (4); the combined
  deduplication, quarantine, and back-reference release-track group passes
  (29).
- OpenAPI validation passes (2), backend lint passes, and the required clean
  `npm test` run passes (OpenAPI 2, config 21, API 936, middleware 24).
- An earlier complete run encountered unrelated shared-suite 404, 400, and
  connection-reset failures in Recent Activity, References, and Ephemeral
  Bundle tests. Those three specs pass together in isolation (30).
- `internalattack` exposes the resolution response as an untyped mapping, so
  the clarified metric semantics do not require a Python client change.
- Performance review result: `PERFORMANT`. The implementation replaces the
  prior input-to-output nested survivor scan with linear source attribution;
  no database, blocking, or resource-management regression was found.
- Proposed REST API commit:

  ```text
  fix(release-tracks): deduplicate virtual revisions deterministically

  Collapse exact component revision duplicates before resolving conflicts,
  attribute every surviving member to one deterministic source, and quarantine
  only genuinely different revisions.
  ```

- Proposed Bruno commit:

  ```text
  docs(release-tracks): clarify virtual deduplication

  Document exact-revision collapse, genuine conflict handling, and deterministic
  component contribution accounting.
  ```

### Current implementation slice — Virtual release provenance

- [x] Add release preview and commit regressions proving that virtual
      `version_history[].component_versions` comes from the selected draft's
      immutable `composition_resolution`, even if a component is released again
      before the virtual draft is tagged.
- [x] Define `component_versions` as an optional object keyed by immutable
      component track ID with tagged `MAJOR.MINOR` version values.
- [x] Populate provenance only for virtual release history entries and leave
      standard release history unchanged.
- [x] Enforce the provenance value shape at the Mongoose persistence boundary
      and describe it in OpenAPI.
- [x] Align user/developer documentation, frontend guidance, Bruno, and
      `internalattack` if the response contract requires downstream changes.
- [x] Run focused regression specs, lint, and the complete `npm test` suite.
- [x] Apply logic and performance review checklists, inspect the final diff,
      and propose conventional commit messages.

Verification result (2026-07-29):

- The focused release-planning and commit spec passes (16), including
  workbench preview, in-place release persistence, standard-track omission,
  immutable component advancement, and invalid Mongoose key/value cases.
- OpenAPI validation passes (2), backend lint passes, and the required clean
  `npm test` run passes (OpenAPI 2, config 21, API 938, middleware 24).
- An earlier complete run encountered unrelated roaming 404s in Attack Objects
  pagination and References after 936 API tests passed. The affected specs pass
  together in isolation (30).
- `internalattack` returns release preview and commit responses as raw mappings,
  so the additive history field requires no Python client change.
- Logic review result: `ROBUST`. Preview and commit both derive provenance from
  the selected persisted draft, malformed map keys/values are rejected, and
  standard release history remains unchanged.
- Performance review result: `PERFORMANT`. Provenance construction is a linear
  in-memory pass over already-loaded component resolution metadata and adds no
  database reads, blocking work, or resource lifecycle.
- Proposed REST API commit:

  ```text
  fix(release-tracks): record virtual release provenance

  Persist immutable component track versions from the materialized virtual
  draft in release history, validate the provenance map, and align API,
  documentation, frontend, and regression contracts.
  ```

- Proposed Bruno commit:

  ```text
  docs(release-tracks): document virtual release provenance

  Describe the track-ID-keyed component version map returned by virtual release
  previews and commits.
  ```

### Tracker consolidation

- [x] Consolidate the virtual-track completion backlog into this section.
- [x] Preserve completed implementation evidence in the dated records below.
- [x] Move the downstream Angular handoff to
      `docs/developer/FRONTEND_TODO.md`.
- [x] Remove the superseded root-level tracker files.

## Document downstream frontend work

- [x] Inventory the current release-track API contract and recent endpoint,
      terminology, lifecycle, validation, and response-shape changes.
- [x] Inspect the Angular release-track consumers so the handoff identifies
      concrete downstream work instead of restating backend implementation notes.
- [x] Create `docs/developer/FRONTEND_TODO.md` with task-oriented guidance,
      contextual explanations, and acceptance criteria.
- [x] Cross-check the handoff against OpenAPI, user/developer documentation,
      Bruno, and the `internalattack` client.
- [x] Review formatting and the final diff.

Verification result (2026-07-29):

- The handoff was cross-checked against the current OpenAPI paths, release-track
  documentation, Bruno requests, `internalattack` methods, and Angular
  release-track consumers.
- `git diff --check` passes.
- Proposed commit:

  ```text
  docs(release-tracks): track required frontend updates

  Document the route, request, response, lifecycle, and terminology changes
  that the Angular release-track client must adopt.
  ```

## Implement virtual quarantine resolution

- [x] Add end-to-end regression coverage for exact-revision quarantine
      promotion, snapshot immutability, back-reference reconciliation, validation,
      and virtual-track type enforcement.
- [x] Add `POST /api/release-tracks/:id/virtual/quarantine/promote`.
- [x] Promote the selected revision to members in a new draft and remove all
      quarantined alternatives for the same object.
- [x] Preserve the immutable composition-resolution record and historical
      materialized snapshot.
- [x] Update OpenAPI, user/developer documentation, and Bruno.
- [x] Run focused regression specs, then lint and the complete `npm test` suite.
- [x] Review the final diff and propose a conventional commit message.

Verification result (2026-07-29):

- Focused quarantine, release, back-reference, and virtual-domain specs pass
  (40); backend lint passes.
- The first complete run encountered six unrelated shared-suite failures in
  collection bundles, data-component pagination, and user accounts. All three
  specs passed in isolation (30, 13, and 14 tests respectively).
- The required clean `npm test` rerun passes (OpenAPI 2, config 21, API 915,
  middleware 24).
- The `internalattack` focused release-track suite passes (30), its complete
  suite passes (247), and changed-file Ruff and pre-commit checks pass.
- Proposed commit:

  ```text
  feat(release-tracks): resolve virtual quarantine conflicts

  Add an explicitly virtual-scoped endpoint for selecting an exact
  quarantined revision into a new draft. Preserve materialization provenance,
  reconcile back-references, and update supported clients and documentation.
  ```

## Harden virtual materialization lifecycle

- [x] Record the complete virtual-track audit in the dedicated virtual release
      tracks section of this file.
- [x] Add regression coverage for stale composition state, unmaterialized
      release attempts, and virtual use of standard contents endpoints.
- [x] Clear inherited materialized state when virtual composition changes.
- [x] Require a materialized virtual draft for release preview and commit.
- [x] Restrict generic contents replacement to standard tracks.
- [x] Update OpenAPI, user/developer documentation, and Bruno.
- [x] Run focused regression specs, then the complete `npm test` suite.
- [x] Review the final diff and propose a conventional commit message.

Verification result (2026-07-29):

- Focused release, back-reference, release-by-object, and virtual-domain specs
  pass (46); backend lint passes.
- The complete suite passes (OpenAPI 2, config 21, API 913, middleware 24).
- Proposed commit:

  ```text
  fix(release-tracks): enforce virtual materialization lifecycle

  Invalidate materialized contents when composition changes and reject release
  planning until the virtual draft is rematerialized. Restrict direct contents
  replacement to standard tracks and document the remaining virtual-track work.
  ```

## Consolidate virtual draft creation and shared release previews

- [x] Move virtual-only composition and draft-creation operations under an
      explicit `/virtual` capability namespace.
- [x] Remove the standalone virtual snapshot-preview endpoint without an
      alias.
- [x] Enhance shared virtual release summaries to compare the persisted draft
      with its preceding tagged release without recomputing composition.
- [x] Add regression coverage for route removal, type enforcement, latest and
      historical virtual previews, and release-preview non-persistence.
- [x] Update OpenAPI, user/developer documentation, Bruno, and the
      `internalattack` Python client.
- [x] Run focused regression specs, then the complete `npm test` suite.
- [x] Review the final diff and propose a conventional commit message.

Verification result (2026-07-29):

- Focused release, back-reference, release-by-object, and virtual-domain specs
  pass; backend lint passes.
- The first complete run encountered two unrelated full-suite flakes in Assets
  and Campaigns; both passed in isolation. The required second complete
  `npm test` run passed.
- The `internalattack` focused suite passes (29), its complete suite passes
  (246), and changed-file Ruff and pre-commit checks pass.
- Proposed commit:
  `feat(release-tracks): clarify virtual draft and release lifecycle`

## Bootstrap faster-release core, defense, and virtual tracks

- [x] Reconcile the clarified ownership partition with the current release-track
      and virtual-composition API.
- [x] Add regression coverage for functional virtual domain filters and
      relationship-complete snapshot bundle exports.
- [x] Implement virtual `filters.domains` using the established ATT&CK domain
      inference rules.
- [x] Reuse/extract existing bundle relationship logic so snapshot
      `format=bundle` exports dynamically include valid secondary relationships.
- [x] Inventory and report any additional release-track no-op placeholders.
- [x] Update user/developer docs and OpenAPI for the effective contract change;
      Bruno has no new or changed request parameter to mirror.
- [x] Run focused release-track regression specs, then the complete `npm test`
      suite.
- [x] Scan all three ATT&CK v19.1 bundles and construct a disjoint exact-revision
      partition for Enterprise Core, ICS Core, Mobile Core, and Defense.
- [x] Assign the shared identity and marking definitions to Enterprise Core
      using the representations supported by release-track snapshots.
- [x] Preflight exact track names and refuse conflicting duplicate tracks.
- [x] Create and verify the four v19.1-pinned standard tracks.
- [x] Create and verify the three domain-filtered virtual track definitions.
- [x] Verify that every in-scope v19.1 object is owned by exactly one standard
      track and record intentional relationship/collection exclusions. CTI owns
      `course-of-action`; ICS Core owns `x-mitre-asset`.
- [x] Defer materializing virtual snapshots until the component standard tracks
      have tagged releases; no release/tag action was authorized in this bootstrap.
- [x] Review the final repository diff and propose a conventional commit
      message.

Operational result (2026-07-28):

- Standard tracks: Enterprise Core
  (`release-track--48be5319-2f98-435a-ba36-5533236a991a`, 875 members),
  ICS Core (`release-track--73147f31-2598-42a3-9cb4-125d458c4490`, 149),
  Mobile Core (`release-track--ae6df6f6-3856-4d54-af40-22db856baa2d`, 206),
  Defense (`release-track--84cb1147-9dba-445f-948e-6eecc51fa7e8`, 3,151),
  and CTI (`release-track--469b126a-6081-462e-8b4c-709cdbb4eac4`, 1,575).
- CTI now includes 60 campaigns, 358 courses of action, 194 intrusion sets,
  866 malware objects, and 97 tools, pinned to the latest database revisions.
- Virtual definitions: Enterprise
  (`release-track--a42a6f32-80c6-43a7-b1e7-26ef0814d0cb`), ICS
  (`release-track--83ede842-58c8-42ce-a3fb-c38c5dd0e74c`), and Mobile
  (`release-track--05615c60-bca8-4074-b8d3-b537eed52d30`). Each composes all
  five standard tracks with `latest_tagged`, `prioritize_latest_object`, and
  its domain filter.
- Verified 5,928 unique v19.1 owned object IDs form a disjoint partition;
  relationships remain indirect, collections are generated at export, and
  marking definitions are supporting metadata.
- Focused domain-filter and bundle-export specs pass (1 and 15 tests);
  lint passes; the complete suite passes (OpenAPI 2, config 21, API 909,
  middleware 24).
- Proposed commit:
  `feat(release-tracks): filter virtual tracks and export relationships`

## Bootstrap CTI faster-release tracks

- [x] Read the local environment mapping and release-track documentation.
- [x] Inspect the internalattack release-track client and reference script.
- [x] Scan the ATT&CK v19.1 ICS and Mobile bundles and report every object type.
- [x] Preflight the production-mirroring Workbench API and existing tracks.
- [x] Create the CTI standard track with the latest intrusion-set, malware,
      tool, and campaign revisions as members.
- [x] Verify the persisted CTI snapshot, object-type coverage, exact latest
      revision pins, and counts.
- [x] Record operational results and propose a conventional commit message for
      the committable scratchpad update.

Operational result (2026-07-28):

- Created standard track `CTI`
  (`release-track--469b126a-6081-462e-8b4c-709cdbb4eac4`).
- Initially pinned 1,217 exact latest revisions as members: 60 campaigns, 194
  intrusion sets, 866 malware objects, and 97 tools. The clarified ownership
  bootstrap subsequently added 358 courses of action for 1,575 total members.
- Verified the persisted snapshot, registry count, and all 1,575 member
  backrefs; candidates and staged are empty.
- Proposed commit: `docs(release-tracks): record CTI bootstrap run`

## Harden release version selection

- [x] Reject simultaneous `increment` and `version` selectors inside the
      release planner, even when controller validation is bypassed.
- [x] Add regression coverage for planner-level mutual exclusivity.
- [x] Make exact, incremental, default, and ambiguous selection behavior
      explicit in OpenAPI, user/developer docs, and Bruno.
- [x] Run the focused release-track spec, lint, and complete `npm test` suite.
      The focused release spec passes (10 tests), lint passes, and the complete
      backend suite passes (OpenAPI: 2, config: 21, API: 907, middleware: 24).
      Targeted frontend Prettier and ESLint pass; TypeScript remains blocked by
      the checkout's existing Angular dependency-resolution and unrelated type
      errors.
- [x] Review the final diff and propose a conventional commit message.

## Release command and unified previews

- [x] Replace bump routes and symbols with explicit release operations for
      latest and historical snapshots.
- [x] Implement one pure release planner shared by summary, workbench, bundle,
      and commit paths.
- [x] Remove `dry_run`, rename version `type` to `increment`, and reject
      conflicting version-selection inputs.
- [x] Keep release targeting semantics explicit: `latest` resolves at request
      time, while `:modified` pins a specific snapshot; no client precondition is
      required.
- [x] Add regression coverage for preview parity, non-persistence, conflicts,
      formats, validation, historical releases, and removed bump routes.
- [x] Update OpenAPI, user/developer documentation, Bruno, and frontend
      consumers.
- [x] Run focused tests and frontend checks, then the complete `npm test`
      backend suite.
      Focused release-track suites pass (49 tests), and the affected backref suite
      passes again in isolation (23 tests). The complete backend suite passes on
      retry. Targeted frontend formatting and ESLint pass; frontend Vitest and
      TypeScript startup remain blocked by the checkout's existing
      ESM/dependency-resolution errors.
- [x] Review the final diff and propose a conventional commit message.

## Remove implicit latest-snapshot route

- [x] Remove `GET /api/release-tracks/:id` while preserving track deletion.
- [x] Make `/snapshots/latest` canonical across OpenAPI, tests, docs, Bruno,
      and the frontend consumer.
- [x] Add regression coverage proving the removed method returns 405.
- [x] Run focused regression specs followed by the complete `npm test` suite.
      The focused suites pass. The aggregate run reached 894 passing with three
      unrelated documented roaming failures; all three affected specs pass
      together in isolation (51 passing).
- [x] Review the final diff and propose a conventional commit message.

## Snapshot history collection endpoint

- [x] Add `GET /api/release-tracks/:id/snapshots` with strict tagged filtering
      and pagination, plus an explicit `/snapshots/latest` alias.
- [x] Return lightweight, type-oriented summaries: standard snapshots include
      member/staged/candidate counts; virtual snapshots include member/quarantine
      counts.
- [x] Add regression coverage for defaults, filters, pagination, validation,
      track types, and not-found behavior.
- [x] Update OpenAPI, user/developer documentation, and Bruno requests.
- [x] Run the focused regression spec followed by the complete `npm test`
      suite.
- [x] Review the final diff and propose a conventional commit message.

## Regression Tests

- [ ] Implement regression tests

- [x] **Investigate the recurring full-suite flake.** Two root causes found and fixed (2026-07-10) in `app/lib/database-in-memory.js`:
  1. _Port collision_: every spec file stopped and restarted the `mongodb-memory-server` instance, and a fresh mongod would intermittently fail with `Port already in use` — breaking that file's `before` hook (surfacing as `loginAnonymous` 404s) and cascading failures through the file. Fixed by reusing one mongod for all spec files in the process (`closeConnection` drops the database and disconnects but keeps the server running) plus `--exit` on the mocha scripts.
  2. _Vanishing unique indexes_: dropping the database between spec files also drops its indexes, and mongoose's per-model `init()` is memoized per process — so the `stix.id + stix.modified` unique index was intermittently missing for later files, letting duplicate-POST tests (and dependent count tests) fail in roaming pairs. Fixed by explicitly awaiting `createIndexes()` for all registered models after each reconnect.

  Residual: rare (≈1 per run under heavy machine load) single-test failures of a different character (a count assertion, a 20s timeout in a pagination GET) still appear occasionally and pass in isolation — likely load-related; keep observing before chasing further.

## Release-track cross-tier revision uniqueness

- [x] Read the release-track user and developer documentation and identify the
      intended exact-revision invariant.
- [x] Trace every standard/virtual tier ingress and transition path.
- [x] Add regression coverage proving one `(stix.id, stix.modified)` revision
      cannot occupy multiple tiers while different revisions of one ID can.
- [x] Enforce the invariant for candidate adds, promotions, demotions, bulk
      status transitions, release bumps, member sync, and quarantine workflows.
- [x] Update user/developer documentation (and OpenAPI/Bruno only if the API
      contract changes).
- [x] Run focused specs and the complete `npm test` suite. The task-specific
      and constituent suites pass; repeated aggregate runs each encountered one
      unrelated roaming API failure that passed immediately in isolation.
- [x] Review the final diff and propose a conventional commit message.

## Snapshot Output Format

**TASK Summary**: Implement support for the `bundle` output format for snapshots

`bundle` refers to a STIX 2.1 bundle that contains all of the objects in the snapshot. The bundle should be emitted as a JSON object with the following structure:

```json
{
  "type": "bundle",
  "id": "bundle--<UUID>",
  "spec_version": "2.0", // omit if STIX 2.1, include for STIX 2.0
  "objects": [
    // All objects in the snapshot
  ]
}
```

The following release-track snapshot retrieval endpoints support `include` and
`format` query parameters:

- `GET /api/release-tracks/:id/snapshots/latest` (get latest snapshot)
- `GET /api/release-tracks/:id/snapshots/:modified` (get specific snapshot)

> [!Note]
> The ephemeral bundle endpoint (`GET /api/release-tracks/ephemeral/{domain}`) supports `format`, but not tier `include`, because it does not read from a persisted release-track snapshot. Rather, it "blindly" includes all objects in the domain.

**Include Parameter** (controls which tiers are returned):

```
GET /api/release-tracks/:id/snapshots/latest                            # Default: all tiers
GET /api/release-tracks/:id/snapshots/latest?include=members            # Members tier only
GET /api/release-tracks/:id/snapshots/latest?include=staged             # Members and staged tiers
GET /api/release-tracks/:id/snapshots/latest?include=candidates         # Members and candidates tiers
GET /api/release-tracks/:id/snapshots/latest?include=quarantine         # Members and quarantine tiers
GET /api/release-tracks/:id/snapshots/latest?include=all                # All tiers
```

**Format Parameter** (controls output format):

```
GET /api/release-tracks/:id/snapshots/latest?format=workbench           # Workbench snapshot with metadata (default)
GET /api/release-tracks/:id/snapshots/latest?format=bundle              # Standard STIX 2.1 bundle
GET /api/release-tracks/:id/snapshots/latest?format=filesystemstore     # Not implemented; returns 501
```

**Combined Example:**

```
GET /api/release-tracks/:id/snapshots/latest?include=all&format=workbench
```

> [!Note]
> The `workbench` format is the default output format and is already implemented. The `bundle` format is a new output format that needs to be implemented. The `filesystemstore` format is not implemented and will return a 501 error if requested.

### Replacing the legacy `GET /api/stix-bundles` endpoint

Importantly, the release track retrieval method with `format=bundle` as well as the ephemeral bundle endpoint will supplant the `GET /api/stix-bundles/` endpoint defined in `stix-bundles-routes.js`. The `stix-bundles` endpoint will be deprecated and removed in a future release. We thus need to inspect the `stix-bundles-controller.js` module and identify any logic that needs to be preserved with respect to preserving existing functionality in the new endpoints.

The `stix-bundles` endpoint currently supports generating a `x-mitre-collection` object that is emitted in the bundle. We need to ensure that this functionality is preserved in the new endpoints. Users specify how the `x-mitre-collection` object is generated via the `includeCollectionObject`, `collectionObjectVersion`, `collectionObjectModified`, and `collectionAttackSpecVersion` query parameters. We can simplify this functionality in the new endpoints:

- `collectionObjectVersion` can just default to `v0.1` to signify that the collection was generated ephemerally and is not connected to a particular release track.
- `collectionObjectModified` can default to the current timestamp.
- `collectionAttackSpecVersion` can default to the global default attack spec version (tracked in `config.js` and exposed via `app.attackSpecVersion`).
- The `includeCollectionObject` parameter can be renamed to `includeToc` to signify that the user wants to include a table of contents object in the bundle (which is what the `x-mitre-collection` object effectively is; moreover, the term, "collection", is oversaturated in the context of STIX and Workbench, so this renaming will help reduce confusion). The `includeToc` parameter can default to `true`.

Here is how each of the other query parameters should be handled/mapped to the newer ephemeral bundle retrieval endpoint (`/api/release-tracks/ephemeral/{domain}`):

- `includeNotes` can be **removed**. We originally implemented notes in Workbench such that they could be included in emitted STIX bundles because we treat notes as STIX objects. However, this concept never really took off, and we have decided to treat notes as second-class Workbench-native objects that are not STIX objects, and thus cannot be included in emitted STIX bundles.
- `includeMissingAttackId` should be **preserved** as `includeObjectsWithMissingAttackId`. This parameter allows users to control whether or not objects without ATT&CK IDs are included in the emitted bundle. It defaults to `false`.
- `stixVersion` should be **preserved**. This parameter allows users to control which STIX version is used in the emitted bundle (`2.0` or `2.1`). It defaults to `2.1`.
- `useLegacyMethod` should be **removed**. The `stix-bundles-service.js` module has a legacy method for generating STIX bundles that we no longer use. The new endpoints should not support this legacy method, and thus this parameter can be removed.
- `includeDataSources` should be **removed**. For context, Data Sources are officially considered a deprecated concept in ATT&CK as of ATT&CK Spec v3.3.0. They were marked as either deprecated or revoked in the corresponding ATT&CK content release (v18.0). Because we already have `includeDeprecated` and `includeRevoked` query parameters, we can remove `includeDataSources` and instead rely on the `includeDeprecated` and `includeRevoked` query parameters to control whether or not deprecated/revoked Data Sources are included in the emitted bundle. This will simplify the API and reduce confusion.
- `state` can be **removed**. The `state` parameter was originally implemented to allow users to control which objects are included based on their workflow status (`work-in-progress`, `awaiting-review`, `reviewed`). Before the introduction of release tracks, workflow status was globally scoped. Now, with release tracks, workflow status is scoped to a release track. The ephemeral bundle endpoint is domain scoped, not release-track scoped, and thus it does not have a concept of workflow status. The `state` parameter can be removed from the new endpoints.

### Updates to the release-track retrieval endpoints

For release track retrieval requests that include the `format=bundle` query parameter, the following query parameters must be supported:

- `include: ['candidate', 'staged']`: If specified, the value must be equal to an array of at least one value. The parameter acts as a filter, allowing users to specify whether release-track candidates and/or staged objects should be included in the bundle. If the `include` parameter is omitted, only members should be included.
- `state: ['work-in-progress', 'awaiting-review']`: If specified, the value must be equal to an array of at least one value. Notably, objects marked as `"reviewed"` are always included (by nature of all members being included —— all members are inherently "reviewed"), irrespective of this query parameter. The parameter acts as a union filter that logically combines with `include`. In other words, when `include` and `state` are both specified, `include` is applied first, then `state` is applied to the remaining `include`-filtered subset. (i.e., Of the candidates and/or staged objects that are ready to be included in the emitted bundle, only include the ones that are marked as "work-in-progress", "awaiting-review", or either).
- `stixVersion` should be **preserved**. This parameter allows users to control which STIX version is used in the emitted bundle (`2.0` or `2.1`). It defaults to `2.1`.

### Fixing the /bump/preview endpoint

Currently there exists support for the `format` query parameter on the `GET /api/release-tracks/:id/bump/preview` endpoint. It's not actually functional (has no impact on the response body) and should be removed.

### In Summary:

- [x] Read the existing release track user + developer documentation in `docs/user/release-tracks/` and `docs/developer/release-tracks/`, respectively.
- [x] Review the new `GET /api/release-tracks/ephemeral/:domain` endpoint implementation as well as the legacy `GET /api/stix-bundles` endpoint.
- [x] Implement support for the `format=bundle` query parameter in the following two endpoints:
  - `GET /api/release-tracks/:id/snapshots/latest` (get latest snapshot)
  - `GET /api/release-tracks/:id/snapshots/:modified` (get specific snapshot)
- [x] Ensure that all required logic (query parameters) is/are implemented in the new endpoints as outlined above.
- [x] Implement regression tests for the new functionality (`release-tracks-bundle.spec.js`, `ephemeral-bundle.spec.js`)
- [x] Update the aforementioned user + developer documentation. The user documentation should simply describe how the behavior _is_ while the developer documentation should described _why_ and _how_, and additionally cover what has been described here: explaining what _was_ and how the functionality has evolved from before the introduction of release tracks to after. (See `docs/developer/release-tracks/bundle-export.md`.)
- [] Remove support for the `query` parameter on the `GET /api/release-tracks/:id/bump/preview` endpoint

## Bidirectional References

- [x] Implement bidirectional refs between objects and snapshots. Users should be able to get individual objects via standard getters (e.g., `GET /api/techniques/:id`) and see which snapshots they are part of in the object's metadata.

> **Implemented** as `workspace.release_tracks` (`[{ id, tier, status }]`, tiers `members`/`staged`/`candidates`/`quarantine` — matching the snapshot tier array names; the sketch below predates the rename of `phase` → `tier`), maintained via snapshot-driven reconciliation over the `release-track::contents-changed` EventBus event. See `docs/developer/release-tracks/backref-reconciliation.md` (why/how) and `docs/user/release-tracks/object-backrefs.md` (behavior). Regression tests: `app/tests/api/release-tracks/release-tracks-backrefs.spec.js`.

Currently, it is impossible to delineate which release tracks (if any) an object belongs to _from the object's perspective_. By "the object's perspective", I mean from a given STIX object document in the `attackObjects` Mongo collection —— you cannot look at a document in the `attackObjects` collection and see which release track(s) the object is a part of. Instead, you must scan all existing release tracks for the object's `stix.id` value in either the `candidates`, `staged`, `members`, or `quarantine` list.

This is easily correctable. When an object is either added or removed from a release track, the object document should be updated. We just need to include a small piece of metadata in the STIX object's document. Fortunately, we already have a pattern in place for tracking metadata: `workspace`. Moreover, we actually have an equivalent bidirectional ref tracker in place for the release tracks' predecessor: Workbench collections. They are/were tracked in each object's `workspace.collection` field. So, we may be able to copy/mimic this existing workflow.

I am imagining STIX object documents containing backwards pointers to their containing release track(s) looking something like this:

```yaml
# A Technique document
workspace:
    release_tracks:
        - id: String
          phase: String; Options: ['candidate', 'staged', 'member']
          status: String; Options: ['work-in-progress', 'awaiting-review', or 'reviewed']
stix: # ...
```

For example:

```yaml
workspace:
  release_tracks:
    - id: 'release-track--3a0e2537-1153-4b16-8ff5-1993f2d9cd7d'
      phase: 'candidate'
      status: 'work-in-progress'
stix: # ...
```

The `phase` and `status` fields will need to change for the appropriate `release_tracks` list element when user moves the object between the candidate, staged, and member phases; and when the object's status changes. We can make use of the event bus architecture here, following the same pattern that some services (like `detection-strategies-service.js` and `analytics-service.js`) use to track embedded relationships between two objects. Similarly, the release tracks service would just need to fire off an event that each of the STIX services listen; and when heard, they set the `workspace.release_tracks` field for the relevant STIX object document(s) accordingly.

## Release-Track Change Capture (in-place mutation hardening)

Object CRUD paths can mutate or destroy revisions that release tracks pin, without the track ever hearing about it. Design decisions locked in 2026-07-10. The `workspace.release_tracks` backrefs make every guard below a cheap document-local check (no track scanning).

- [x] **Reject revision re-keying on PUT.** `updateFull` merged body `stix.id`/`stix.modified` over the stored document, so a PUT could silently re-key a revision and strand any track pins. Now returns 400 when the body identity fields differ from the path parameters. Re-keying must go through POST (a new revision), which member sync captures. Tests: `app/tests/api/base-services/update-identity-guard.spec.js`.

- [x] **Capture in-place PUTs of pinned revisions.** Implemented 2026-07-13: `BaseService.updateFull` rejects (409, `MemberPinnedRevisionError`) when the revision is pinned in any track's `members` tier — released content is immutable in place; POST a new revision instead. `staged`/`candidates`-pinned revisions ride the `::updated` → revision-sync path and are marked with the server-assigned **`modified-in-place`** status (content changed with no revision history to diff — reviewers are told _that_ something changed, not _what_; the marker is cleared via the review endpoint). Placement is centralized in the **workflow gate** (`app/lib/release-tracks/workflow-gate.js`): tier is decided against `candidacy_threshold`/`auto_promote` (`modified-in-place` ranks with `work-in-progress`), so permissive tracks keep in-place-edited staged entries staged while strict tracks demote them for re-review — and threshold-qualifying placements land directly in `staged` in a single snapshot (no more candidates bounce). Covers in-place deprecation (`x_mitre_deprecated` via PUT). The member-sync misfire (same-key duplicate cross-tier enrollment) is fixed by skipping enrollment of already-pinned revisions and skipping no-op snapshot clones. Future: an in-document changelog of in-place modifications would let the marker say _what_ changed. Tests: `app/tests/api/release-tracks/release-tracks-change-capture.spec.js`.

- [x] **DELETE of tracked objects.** Implemented 2026-07-13 with a simplified decision: DELETE (single version or all versions) is _rejected_ (409) when a revision is `members`-pinned, with guidance to retire the object via a new `x_mitre_deprecated` revision instead — members-pinned revisions are immutable and must never be deleted. (The earlier auto-convert-to-deprecation idea was dropped in favor of explicit rejection.) `candidates`/`staged`-pinned deletes remain allowed unless the same revision is also a frozen graph dependency. The deterministic-graph slice extended the guard to secondary/supporting revisions and to `CollectionsService`'s custom exact, lineage, and `deleteAllContents` paths. Legacy delete controllers use the service-exception middleware (`next(err)`) so the 409 maps correctly.

- [x] **Revoke must reach member sync.** Implemented 2026-07-13: member sync subscribes to the 11 per-type `::revoked` events via a payload adapter (`handleStixObjectRevokedEvent`), so the revoked revision (`revoked: true`) is enrolled as a candidate in member tracks and candidate/staged pins move to it — treated exactly like any new revision. The revoke response's primary document carries the resulting backrefs. Member sync is not extended to relationships; the bounded `revoked-by` edge is captured in each new snapshot's graph manifest and replayed from there.

- [x] **Technique conversion should reach revision sync.** Implemented 2026-07-13 with the adapter approach (same pattern as `handleStixObjectRevokedEvent`): the `TECHNIQUE_CONVERTED_TO_SUBTECHNIQUE` / `SUBTECHNIQUE_CONVERTED_TO_TECHNIQUE` event payloads now carry the converted revision (`document`) and acting user, and member sync subscribes via `handleStixObjectConvertedEvent`, treating the conversion as a `new-revision` trigger through the workflow gate — candidate/staged pins move to the converted revision, member tracks enroll it as a candidate. The conversion responses refresh `workspace.release_tracks` after event processing (read-your-own-writes). Tests: conversion cases in `release-tracks-change-capture.spec.js` and the updated clone-strip test in `release-tracks-backrefs.spec.js`.

## Get Releases By Object

- [x] Implement `GET /api/release-tracks/objects/:objectRef/releases` so a
      caller can retrieve every tagged snapshot whose `members` tier directly
      contains the supplied STIX ID, across all object revisions and release
      tracks.

### Design

The existing `workspace.release_tracks` backrefs cannot answer this query:
they intentionally describe only each track's latest snapshot. A release that
historically contained an object must still be returned after a later snapshot
removes it. Conversely, copying all tagged snapshots into a new global MongoDB
collection would duplicate the existing per-track source data and undermine
the collection-per-track storage boundary.

Use `releaseTrackRegistry` as a compact global forward catalogue instead. Its
single document per track gains a server-maintained `tagged_releases` array:

```javascript
tagged_releases: [
  {
    snapshot_modified: Date, // (track_id, snapshot_modified) identifies the snapshot
    version: String,
    tagged_at: Date,
    tagged_by: String,
  },
];
```

`tagged_release_count` is derived from `tagged_releases.length`. The actual
snapshot — including the authoritative `members` pins — remains in the track's
dynamic collection. Tagging reconciles this registry projection from the
source snapshots rather than incrementally appending, so retries and
retroactive tagging are idempotent and self-healing. A migration backfills
existing tracks.

The endpoint is stateless but necessarily fan-outs: read registry documents
with tagged releases, then issue one bounded-concurrency query per eligible
track using all of that track's tagged `snapshot_modified` values. Flatten,
sort deterministically, and paginate the matches. Registry references reduce
the search to tagged snapshots, but they are a forward index (track → release),
not an inverted object → release index; eliminating the per-track fan-out would
require a separate denormalized membership index and is deliberately out of
scope.

Add a partial multikey index to every dynamic track collection for
`members.object_ref`, limited to snapshots whose `version` is a string. Drafts
therefore incur no index cost, and draft squashing does not affect the lookup.

### Semantics

- Match the STIX ID across all revisions; return the pinned `object_modified`
  for each release.
- Include standard and virtual tracks by default; optional `type` filtering.
- Include only direct `members` entries from tagged snapshots. Do not include
  candidates, staged/quarantined entries, or secondary objects added during
  bundle export.
- Support `order=asc|desc` by `snapshot_modified`, plus `limit` and `offset`.
- Return 200 with an empty result for a valid STIX ID with no tagged releases;
  malformed IDs return 400.
- Ascending order describes first _published/tagged_ appearance, not the time
  the object first entered an untagged draft.

### Checklist

- [x] Registry schema/repository: add `tagged_releases`, reconciliation, and
      derived count/latest-version maintenance.
- [x] Dynamic snapshot schema/repository: add the tagged-member partial index
      and a projected `findTaggedSnapshotsContainingObject` query.
- [x] Versioning: reconcile registry metadata after tagging and validate
      version progression against track-wide tagged releases rather than a
      potentially stale historical snapshot's embedded `version_history`.
- [x] API: route, controller Zod validation, facade/service orchestration,
      deterministic pagination, and OpenAPI contract.
- [x] Migration: backfill registry tagged-release refs and ensure the new index
      on all existing dynamic track collections.
- [x] Regression tests: multiple tracks/releases/revisions, removal after an
      earlier release, retroactive tag, virtual track, draft/non-member exclusion,
      filtering/order/pagination, empty/malformed input, and backfill behavior.
- [x] User/developer docs and Bruno request.
- [ ] Verification: targeted spec first, then the complete `npm test` suite.
  - Targeted endpoint spec: 8 passing; release-track directory: 69 passing;
    lint, OpenAPI validation, and middleware suite pass.
  - `npm test` was attempted three times on 2026-07-16. Each API run reached
    861-880 passing but hit different roaming failures in unrelated legacy
    specs (collection-bundle timeout, missing anonymous-session cookie, and
    transient version lookups). Every failed file passed when rerun in
    isolation. A clean full-suite run is still required before this task meets
    the repository definition of done.

## Snapshot Retention (Squash on Tag)

- [ ] Implement draft-snapshot squashing so release cycles don't accumulate
      unbounded snapshot storage. Design captured 2026-07-15; assessed as sound —
      see analysis below.

### Why

Every mutation clones the full snapshot document (`cloneSnapshot` in
`snapshot-service.js`): metadata edits, config edits, tier operations, and —
critically — every member-sync enrollment. Each snapshot embeds the complete
`members`/`staged`/`candidates` arrays (~100–150 bytes BSON per pin entry).

At ATT&CK scale (~10k–20k tracked objects), each snapshot document is
~1–3 MB. A release cycle where 10% of a 10k-object track is edited produces
~1,000 member-sync snapshots ≈ 1–3 GB of drafts per track per cycle — nearly
all of it intermediate states nobody will ever read again. Storage per cycle
is O(edits × track_size); the per-write clone is the root cause, but squashing
at the tag checkpoint caps the steady state without touching the write path.

Mitigating facts (verified in code):

- Bulk endpoints already exist: `addCandidates`, `promoteCandidates`,
  `reviewCandidates`, `demoteStaged` all take arrays and produce **one**
  snapshot per call. Initial population of a track is 3 snapshots (create →
  bulk-add → bulk-promote), plus an in-place tag (tagging via
  `tagSnapshotInPlace` creates **zero** snapshots). The N-snapshot trap is
  calling the bulk endpoints once per object — document this loudly in user
  docs, but no code change needed there.
- `::created` events for brand-new objects are no-ops for member sync
  (`findTracksReferencingObject` only matches already-tracked `stix.id`s).
  The O(N²) trap is bulk _re-imports/updates_ of already-tracked objects
  (e.g. re-importing a modified 20k-object bundle → 20k snapshots × MBs each).
- `version_history` is embedded in and carried forward by every clone, so the
  release ledger survives squashing — tagged snapshots and the latest draft
  always hold the full history.
- Backref reconciliation (`emitContentsChanged`) only ever reads the **latest**
  snapshot; deleting non-latest drafts requires no backref work.

### Semantics

"Squash" = bulk-delete draft snapshots (`version == null`) older than a
boundary, preserving: all tagged snapshots, the boundary snapshot, and always
the latest snapshot. Like `git rebase --squash`ing the commits behind a tag.

1. **Squash-on-tag (opt-in):** `POST /api/release-tracks/:id/bump` (and
   `.../snapshots/:modified/bump`) accept `squash: boolean` (default `false`).
   After a successful tag of snapshot S, delete all snapshots matching
   `{ id, version: null, modified: { $lt: S.modified } }`. Drafts newer than S
   (work already underway toward the next release) survive. Response gains
   `squashed_count`.
2. **Standalone maintenance endpoint** (recovery from bulk-operation
   accidents, no tag required): `POST /api/release-tracks/:id/snapshots/squash`
   with optional `before` (ISO timestamp; defaults to the latest tagged
   snapshot's `modified`; if no tagged release exists and `before` is omitted,
   400). Same delete filter; never deletes the latest snapshot even if it is
   an untagged draft and `before` post-dates it.
3. **Concurrency safety:** the filter can't race member sync — concurrent
   clones get `modified = now`, which is always ≥ the boundary, so they are
   never matched. Tag-then-squash need not be atomic: a crash between the two
   just leaves drafts behind (retryable via the maintenance endpoint).
4. After deletion: one `syncRegistryCounters(trackId)` call; **no**
   `emitContentsChanged` (latest snapshot unchanged by construction). Add a
   repo-level `deleteDraftSnapshotsBefore(trackId, boundary)` (`deleteMany`)
   rather than looping `deleteSnapshot` (which emits per-delete events).

### Drawbacks accepted (documented trade-offs, not blockers)

- **Provenance loss.** Intermediate drafts are the only record of the journey:
  who added/staged what when (`object_added_by`, `object_staged_at`), status
  transitions, `modified-in-place` markers that were later cleared. Promotion
  strips staged metadata from member entries, so after squash only the final
  state remains. This is exactly git-squash semantics and is why the flag is
  opt-in, but teams that need review audit trails must not squash (or we later
  add a roll-up audit record — see Future).
- **Retro-tagging is foreclosed.** `bumpByModified` can no longer tag a
  squashed draft. Consistent by construction: squashing is the declaration
  that intermediates don't matter. Note the "undo/move the tag" worry is
  already moot — versions are immutable once set, re-tagging throws
  `AlreadyReleasedError`, and no untag endpoint exists. The genuine loss is
  forensic/DR, mitigated only by Mongo backups.
- **Virtual tracks: excluded from v1.** Their scheduled snapshots
  (`snapshot_schedule`) exist precisely to build a periodic history;
  squash-on-tag would destroy the thing the schedule creates. Reject
  (or no-op with a warning) squash on virtual tracks until there's a
  considered retention policy for them.

### Alternatives considered

- _Amend-in-place_ (member sync mutates the latest draft instead of cloning):
  attacks the root cause but breaks the "every modification is a new
  snapshot" invariant, complicates concurrent reads, and silently degrades
  the audit trail for everyone. Rejected for now.
- _Delta/structural-sharing storage_: large refactor of the snapshot store;
  revisit only if squash proves insufficient.
- _TTL/retention config_ (e.g. `config.retention.auto_squash_on_tag`,
  max-draft-age): natural follow-on once manual squash exists.

### Checklist

- [ ] Repo: `deleteDraftSnapshotsBefore(trackId, boundary)` in
      `release-track-dynamic.repository.js` (deleteMany on
      `{ id, version: null, modified: { $lt: boundary } }`, excluding the latest
      snapshot's `modified`).
- [ ] Service: squash logic in `versioning-service.js` (`squash` option on
      `_doBump`) + standalone squash operation (probably `snapshot-service.js`);
      reject for virtual tracks; return `squashed_count`.
- [ ] Controller/routes: `squash` in the Zod bump body schema; new
      `POST /api/release-tracks/:id/snapshots/squash` route with Zod-validated
      optional `before`.
- [ ] OpenAPI: bump request body + new squash path.
- [ ] Regression tests (`release-tracks-squash.spec.js`): squash-on-tag
      deletes only pre-tag drafts; tagged snapshots survive; drafts newer than
      the tagged snapshot survive; latest-draft never deleted by maintenance
      squash; registry counters resync; backrefs untouched; virtual track
      rejected; no-tagged-release + no `before` → 400; idempotent re-squash.
- [ ] Docs: `docs/user/release-tracks/versioning.md` (squash behavior +
      the bulk-endpoints-vs-per-object-loop warning for initial population),
      `docs/developer/release-tracks/` (why, trade-offs, provenance loss).
- [ ] Bruno: bump `.bru` gains `~squash` toggle; new squash request file.

### Future (not in scope)

- Roll-up audit record written at squash time (compact per-object journey
  summary appended to the version_history entry or a side collection) to
  soften the provenance loss.
- Retention config for auto-squash and for virtual-track snapshot history.
- Coalescing/debouncing member-sync snapshots during bulk update storms
  (the re-import O(N²) trap) — e.g. a bulk-import context that suspends
  per-object snapshotting and emits one consolidated snapshot at the end.

## Small Fixes

- [x] **Composition schema mismatch: `priority`.** Resolved 2026-07-29 by
      requiring a unique, non-negative integer priority in request validation,
      persistence, OpenAPI, documentation, and Bruno examples.

- [x] **Restrict `deleteSnapshot` to the latest untagged draft.**
      `DELETE /api/release-tracks/:id/snapshots/:modified` now returns `409`
      for tagged releases and historical drafts, preserving immutable history.
      Completed by the immutable-history slice.

- [ ] **`syncRegistryCounters` scales with snapshot count.** It fetches _all_ snapshots (`getAllSnapshots` with projection) on every clone to recount — O(snapshot_count) reads per write, on the hottest path (member sync). Fine post-squash; consider a count query or incremental counters if draft accumulation between tags is large.

## Diffing Endpoint

- [ ] Implement object diffing endpoints for snapshots. Users should be able to effectively preview changes to objects before tier transitions (candidates, staged, members).

### Idea 1 - Diffing endpoint specifically for release tracks

In this approach, we would implement a workflow-driven diffing endpoint that is specific to release tracks. The endpoint would allow users to diff objects in the candidate snapshot against their previous revisions in the staged or member snapshots.

```
GET /api/release-tracks/:id/candidates/:objectRef/diff
GET /api/release-tracks/:id/staged/:objectRef/diff
```

If `:objectRef` is a reference to an object that is not part of the candidate snapshot, the endpoint should return a 404 error. If it is part of the candidate snapshot, the endpoint should return a diff between the object in the candidate snapshot and the object in the next lifecycle stage.

To clarify, snapshot objects transition linearly and unidirectionally through the following tier transitions: Candidate -> Staged -> Member

An object exists as a set of one or more revisions. An object is identified by its `stix.id` field, whereas an object revision is identified by its `stix.id` and `stix.modified` fields.

A revision can exist in exactly one tier at a time.

- If a revision exists in the candidate snapshot, it will not exist in the staged or member snapshots.
- If it exists in the staged snapshot, it will not exist in the candidate or member snapshots.
- If it exists in the member snapshot, it will not exist in the candidate or staged snapshots.

If a revision exists in the candidate snapshot, it will not exist in the staged or member snapshots. However, a _previous_ revision may exist in the staged or member tiers (though it is not guaranteed). Because the tier transitions are unidirectional, revisions must be temporally ordered as it relates to how they are distributed across the tiers. It should not be possible for a newer revision to exist in a previous tier. For example, if a revision exists in the candidate snapshot, it is not possible for a newer revision to exist in the staged or member snapshots.

This rigidity allows us to implement a diffing endpoint that is specific to release tracks. The diffing endpoint should return a diff between the candidate revision and the next lifecycle stage revision (staged or member).

So, if an object exists in the candidate snapshot, and another/previous revision of it exists in the members state, the diff endpoint should return a diff between the candidate revision and the member revision. If no previous revision exists in the members state, the diff endpoint should return a diff between the candidate revision and an empty object.

As another example, if an object exists in the staged tier, the `GET /api/release-tracks/:id/staged/:objectRef/diff` endpoint should return a diff between it and the previous revision that exists in the member tier. If no previous revision exists in the member state, the diff endpoint should return a diff between the candidate revision and an empty object.

Member revisions are considered immutable and thus cannot be diffed from. Hence, there is no `GET /api/release-tracks/:id/members/:objectRef/diff` endpoint.

There is one edge case that needs special consideration. If a revision exists as a candidate, a previous revision exists as a member, but no previous revision exists in the staged tier, the diff endpoint now becomes unclear: If the candidate transitions to the next tier, one could argue that the diff should be between the candidate revision and an empty object (since no previous revision exists in the staged tier). However, one could also argue that the diff should be between the candidate revision and the previous member revision. I think the most intuitive approach is to return a diff between the candidate revision and the previous member revision. This is because the candidate revision will eventually transition to the staged tier, and it is more intuitive to compare it against the most recent revision that exists in the next lifecycle stage (member) rather than an empty object.

To stick with the example, if a revision exists as a candidate, a previous revision exists as staged, and a previous revision exists as a member, the `GET /api/release-tracks/:id/candidates/:objectRef/diff` diff endpoint should return a diff between the candidate revision and the previous staged revision. This is because the candidate revision will eventually transition to the staged tier, and it is more intuitive to compare it against the most recent revision that exists in the next lifecycle stage (staged) rather than an empty object. Similarly, the `GET /api/release-tracks/:id/staged/:objectRef/diff` diff endpoint should return a diff between the staged revision and the previous member revision. This is because the staged revision will eventually transition to the member tier.

### Idea 2 - Diffing endpoint for all objects (not just release tracks)

Type-centric:

```
GET /api/:type/:id/diff
GET /api/:type/:id/modified/:modified/diff
```

Type-agnostic:

Embed the

```
GET /api/attack-objects/:id/diff
GET /api/attack-objects/:id/modified/:modified/diff
{
    "compareTo": {
        "type": "attack-pattern",
        "id": "attack-pattern--1234",
        "modified": "2024-02-01T00:00:00.000Z",
    }
}
```

Set up a diffing endpoint that is type-agnostic and allows users to compare any two revisions of an object. The endpoint should accept a request body that specifies the `compareTo` revision, and the endpoint should return a diff between the current revision and the specified `compareTo` revision.

```
GET /api/compare
{
    "compareFrom": {
        "type": "attack-pattern",
        "id": "attack-pattern--1234",
        "modified": "2024-01-01T00:00:00.000Z",
    },
    "compareTo": {
        "type": "attack-pattern",
        "id": "attack-pattern--1234",
        "modified": "2024-02-01T00:00:00.000Z",
    }
}
```

## Repurposing the `note` object

- [ ] Implement support for tracking notes on snapshot objects (can be candidates, staged, or members). Notes should be stored in a separate Mongo collection and linked to the snapshot object via a reference field. Users should be able to add, edit, and delete notes via the API. Notably, we already have a notes service that can be leveraged for this purpose. However, it needs some modifications. The service was originally implemented with STIX in mind. The idea was to treat/represent notes as STIX objects and enable users to include them in emitted STIX bundles. However, the concept never really took off. We should modify the service to treat notes as second-class objects that are entirely separate from STIX, but rather as Workbench-native objects. Notes should be capable of being linked/attached to snapshot objects (candidates, staged, or members) as well as to objects independent of snapshots (documents in the `attackObjects` collection).

Make a new Mongo collection called `notes` to store notes. Each note should have the following fields:

```json
{
  "_id": "ObjectId",
  "content": "string",
  "created_by": "string",
  "last_modified_by": "string",
  "created_at": "Date",
  "modified_at": "Date",
  "snapshot_object_id": "ObjectId", // Reference to the snapshot object (if applicable)
  "object_id": "ObjectId" // Reference to the attack object (if applicable)
}
```

Notes will NOT be version controlled. If they are edited or deleted, the changes will be reflected immediately in the database, and recovery and undo functionality will not be supported.

Links/references between notes and snapshot objects will be one-to-many. A single snapshot object can have multiple notes attached to it, but a note can only be linked to one snapshot object at a time. Similarly, links/references between notes and attack objects will also be one-to-many. These should be bidirectionally tracked, meaning that if a note is linked to an attack object, the attack object should have a reference to the note in its metadata, and vice versa.

```json
// attackObjects collection
{
  "_id": "ObjectId",
  "workspace": {
    "notes": ["ObjectId"] // Array of references to notes linked to this attack object
  },
  "stix": "StixObject"
}
```

## Deterministic v19.1 virtual-track bootstrap graph

- [x] Preserve the materialized virtual snapshot graph when previewing and committing a release.
- [x] Enforce virtual component-domain filters throughout graph traversal, including secondary objects.
- [x] Prevent `LinkById` rendering from selecting revoked or deprecated ATT&CK-ID collisions.
- [x] Seed virtual snapshot graph manifests from the canonical v19.1 bundles in the bootstrap script.
- [x] Make bootstrap bundle comparisons detect duplicate revisions and explain unexpected drift.
- [x] Add regression coverage and document the deterministic-primary/non-deterministic-graph boundary.
- [x] Run focused tests and the complete `npm test` suite.
- [x] Delete and recreate only the Enterprise ATT&CK virtual track, then assess its emitted bundle against v19.1.

Verification (2026-07-30):

- The clean complete server suite passes: OpenAPI 2, config 21, API 992,
  middleware 29, and scheduler 10.
- Focused graph-integrity regressions pass (3), the affected release-track
  group passes (40), and the bootstrap regression suite passes (23).
- The guarded bootstrap completed without accepting unexplained bundle drift;
  all three standard and virtual baselines are tagged `1.0`.
- Enterprise contains 4,815 exact members, zero quarantine entries, and a
  25,842-object publication graph excluding its generated collection. It has
  no missing, additional, or duplicate STIX IDs; type counts and all 25,841
  adjusted TOC pins match canonical v19.1.
- The 312 raw payload differences consist only of the expected canonical-domain
  repairs and domain-array ordering. After those agreed normalizations, zero
  payloads differ.

## Snapshot descriptions

- [x] Persist a bounded, snapshot-local description separately from release-track metadata.
- [x] Allow editors to set the description while materializing or tagging a snapshot and edit it later without changing snapshot identity or contents.
- [x] Return descriptions in snapshot history and Workbench snapshot responses.
- [x] Document the API and update the Bruno collection.
- [x] Add frontend creation, display, edit, clear, and feedback flows.
- [x] Add backend and frontend regression coverage.
- [x] Run focused tests and the complete backend and frontend verification suites.

## Release-track UX and API follow-ups (2026-09-03)

Raised after testing the sealed-manifest work on a restored production
database.

- [x] Remove bundle `include`/`state`: bundles always replay the sealed
      manifest; `format=bundle` rejects `include` (400). Frontend Export
      Latest no longer sends `include=all` for bundles.
- [x] Workbench tier entries carry `type` and `x_mitre_version` so the
      release preview no longer downloads the whole object catalogue.
- [x] Release preview computes relationship changes without loading supporting
      objects and LinkById targets.
- [x] Track URL aliases (unique slug per track resolving to the track ID on
      every `:id` route; set at creation or via `/meta`).
- [x] Inter-domain relationship report: `GET /api/reports/domain-consistency`
      (active SROs whose endpoints share no domain; domain-bearing SDOs
      lacking domains) and a Data Quality page section.
- [x] Frontend: Delete release only on the most recent release; Preview &
      Release in-progress state.
- [x] Frontend: draft-then-tag flow (header keeps only Create Draft; tagging
      from draft cards), DETAILS tab renamed Board, track deletion in a CONFIG
      danger zone.

## Draft components in virtual tracks (2026-09-22)

- [x] Add strict `latest_draft` resolution of the active standard draft's
      members only, without falling back to tagged or historical snapshots.
- [x] Preserve exact source timestamps and nullable draft versions in
      composition resolution and virtual release history.
- [x] Retain virtual-referenced source drafts during pruning and serialize
      standard clone writes with materialization using the release lock.
- [x] Expose per-component draft/tagged selection in frontend creation and
      configuration; render draft provenance without inventing a version.
- [x] Verify the real frontend/API flow, focused regressions, and the full
      backend test suite; update API documentation and Bruno request notes.

## Virtual draft retention and release-time squash (2026-09-23)

Approved plan: [Draft lifecycle](release-tracks/draft-lifecycle-plan.md).
Safety rationale: [Deletion guardrails](release-tracks/deletion-guardrails.md).

- [x] Prepare both feature branches from `next`, preserving draft composition
      and the frontend save-dialog regression fix.
- [x] Preserve the plain-language deletion guardrails explanation and link
      redundant documentation to it.
- [x] Serialize virtual target lifecycle operations and preserve durable
      scheduler materialization receipts after snapshot deletion.
- [x] Implement guarded, auditable, recoverable historical-draft cleanup and
      reference-safe manifest deletion.
- [x] Add disabled-by-default, administrator-managed draft-count retention.
- [x] Add previewed, fingerprint-confirmed release-time draft squash and
      cleanup-only status/retry.
- [x] Add frontend retention controls and paginated virtual history.
- [x] Add explicit squash consent and partial-outcome recovery feedback.
- [x] Verify API/scheduler regressions and the complete backend suite.
- [x] Exercise retention, squash, pagination and recovery on the real frontend.

## Published versus preview composition

- [x] Prepare isolated worktrees on `next` and agree on `latest_tagged` versus
      `latest_preview`, retaining version and snapshot pinning.
- [x] Share standard release membership planning with virtual preview
      composition, including exact staged resolution and conflict policies.
- [x] Resolve the newest standard snapshot regardless of draft/tagged state,
      without publishing or mutating the source.
- [x] Replace active `latest_draft` input with `latest_preview`; preserve
      historical provenance and require explicit replacement of retired rules.
- [x] Update frontend selection, help and provenance labels.
- [x] Verify staged additions/replacements, conflict parity, frozen revisions,
      unchanged source state, and tagged-source preview in API and real UI.
- [x] Update public/developer documentation and Bruno examples; run the full
      backend suite and affected frontend tests.

Verification: all 1,124 backend tests and 125 focused frontend tests passed.
Backend lint and changed frontend file lint passed. The backend suite used a
temporary loopback-family adapter for the local Supertest/listener collision;
test selection and assertions were unchanged. Browser/API smoke checks proved
that a source with zero members, one staged object and one candidate contributes
only the staged object, without changing its snapshots, tiers or release history.
Virtual tagging left that source untagged; later staged revisions left the
existing virtual release frozen; a tagged newest source also composed correctly.

## Virtual draft lifecycle feedback

- [x] Make completed cleanup feedback floating and dismissible without adding
      a notification-center subsystem.
- [x] Refresh authoritative total snapshot counts after draft creation.
- [x] Center history filters and refresh controls above the cards.
- [x] Remove the redundant "Current draft (pinned)" label.
- [x] Gate persistent retention editing behind Edit Config and preserve Cancel.
- [x] Replace global retention with one-shot Create Draft policy and saved
      Recurring-schedule policy; unrelated writes never trigger retention.
- [x] Verify affected regressions and the real frontend/API workflow.

## Upstream integration and history views (2026-09-25)

- [x] Merge upstream `next` into both feature branches, retaining local
      uncommitted retention feedback and upstream preview/priority behavior.
- [x] Offer Drafts only, Releases only, and All releases with exact filtering.
- [x] Replace the manual refresh button with visible-history polling and
      focus/visibility refresh, preserving page selection and edit state.
- [x] Report filtered tagged, draft, and total counts across matching pages.
- [x] Verify upstream integration regressions and the live browser workflow.

Merged backend `a69abef9` and frontend `592c087c` from upstream `next`, preserving
the local trigger-specific retention feedback. Full backend verification passed
1,158 tests; 161 focused frontend tests passed. Browser checks covered all three
views, zero results, query-wide counts across pages, periodic external-create
refresh, focus/tab-entry refresh and preservation of page selection/unsaved edits.
