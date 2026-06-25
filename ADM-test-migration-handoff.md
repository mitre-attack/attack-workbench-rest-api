# Handoff: Enable ADM validation across the regression test suites

## Goal

The REST API can validate incoming objects against the ATT&CK Data Model (ADM)
Zod schemas when `config.validateRequests.withAttackDataModel` is `true`. Most
regression specs were written against looser, pre-ADM payloads and still run with
that flag `false`, so the strict validation path is untested.

Your job: go directory-by-directory through `app/tests/api/`, flip each spec to
run **with ADM validation enabled**, make the seeded request payloads
ADM-compliant, and confirm the suite still passes. One commit per directory.

This is mechanical, repetitive work. A playbook of the common fixes is below —
most directories need only a handful of them.

## Branch & continuation

- Work on the existing branch **`fix/adm-validation-logging`** (forked from `next`).
- A draft PR is already open against `next`.
- Already migrated (do not redo): `techniques`, `analytics`, `assets`,
  `campaigns`, `collections`, `data-components`, `data-sources`,
  `detection-strategies`, plus a logging fix and a fixture-inlining commit.
- Continue **alphabetically**. Next up is `groups`.

## The per-directory workflow (repeat for each)

1. List the specs: `ls app/tests/api/<dir>/`.
2. For each `*.spec.js` (and any `*-spec.js` — note the inconsistent naming),
   find the ADM toggle: `grep -n withAttackDataModel app/tests/api/<dir>/*`.
3. Flip `config.validateRequests.withAttackDataModel = false` → `true`. Leave
   `withOpenApi` as it is. Update the stale `// Disable ADM validation` comment to
   `// Enable ADM validation; the request payloads in this spec are ADM-compliant`.
   - **Pagination specs are special** — see below.
4. Run the spec: `npm run test:file -- app/tests/api/<dir>/<file>.spec.js`.
5. Read the failures. The logger prints full ADM detail at `[WARN] Bad request: %s`
   with a `details` array naming the exact field + rule. Fix the fixture(s) per the
   playbook. Re-run. Iterate until green.
6. When all specs in the directory pass, run the whole directory:
   `npm run test:file -- --recursive app/tests/api/<dir>`.
7. Lint + format the changed files:
   `npx eslint app/tests/api/<dir>/` and `npx prettier app/tests/api/<dir>/ --check`
   (use `--write` if needed).
8. Commit (one per directory):
   `git add app/tests/api/<dir>/...` then
   `git commit -m "test(<dir>): run <dir> suites with ADM validation enabled"`
   with a short body describing the fixture fixes. **Match the existing commit
   style — plain messages, no AI-attribution footer.** A pre-commit hook runs
   prettier/eslint/lockfile-check automatically.

## Pagination specs (special case)

Pagination specs delegate to the shared `PaginationTests` class
(`app/tests/shared/pagination.js`) and have no `before()` of their own. Do **not**
add a config toggle. Instead pass the flag through the options object:

```js
const options = {
  prefix: '...',
  baseUrl: '/api/...',
  label: '...',
  // The seeded fixture is ADM-compliant; pin validation on so this suite does
  // not inherit the flag from whichever spec ran before it.
  validateWithAdm: true,
};
```

`PaginationTests` already honors `options.validateWithAdm` (added during the
techniques migration) and sets the config in its own `before()`.

## ADM fix playbook (the common failures)

Validation runs on the **server-composed** object, after the server fills in
`id`, the ATT&CK `external_references[0]`, `created_by_ref`,
`x_mitre_modified_by_ref`, and `x_mitre_attack_spec_version`. So a payload only
needs to be valid *after* composition. Workflow state drives strictness:
`work-in-progress` → **partial** schema (lenient; may omit required fields);
`awaiting-review`/`reviewed`/absent → **full** schema (strict). `status` defaults
to `reviewed` when `workspace.workflow.state` is absent.

| Symptom (from the `details` array) | Fix |
| --- | --- |
| `x_mitre_platforms.N ... Platform must be one of: ...` | Enum is **case-sensitive**: `'windows'` → `'Windows'`; `'platform-1'` → a real value (`Linux`, `macOS`, `Windows`, `Android`, `Network`, `Office Suite`, …). Domain does **not** constrain platform. |
| `kill_chain_phases.N.kill_chain_name ... expected one of "mitre-attack"\|"mitre-mobile-attack"\|"mitre-ics-attack"` | Use `mitre-attack` (or the mobile/ics variant). |
| `phase_name ...` | Lowercase, hyphenated tactic shortname, e.g. `execution`, `impact`. |
| `x_mitre_impact_type.N ... must be one of: Availability, Integrity` | Use a valid value **and** include the `impact` tactic in `kill_chain_phases` (enterprise-only refinement). If the field isn't asserted by any test, just delete it. |
| `x_mitre_sectors / related_asset_sectors ... Sector must be one of: ...` | Enum: `Electric`, `Water and Wastewater`, `Manufacturing`, `Rail`, `Maritime`, `General`. |
| `x_mitre_collection_layers ...` | Enum: `Cloud Control Plane`, `Host`, `Report`, `Container`, `Device`, `OSINT`, `Network`. |
| `x_mitre_data_sources.N ... pattern '<Data Source Name>: <Data Component Name>'` | Deprecated `z.custom` field. Use `'Name: Component'` format, or (if not asserted) delete it. |
| `id ... invalid UUIDv4 format` / `must comply with format 'type--UUIDv4'` | Hardcoded STIX ids must be `type--<valid uuidv4>`. **Valid v4**: 13th hex digit (version) = `4`, 17th (variant) = `8/9/a/b`. Keep ids consistent across every place they're referenced (definition + embedded refs + literal assertions). For "non-existent ref → 404" tests, use a **valid-format-but-absent** UUID so ADM (400) doesn't preempt the intended 404. |
| `x_mitre_version ... expected string, received undefined` | Full schema requires `x_mitre_version` (e.g. `'1.0'`). |
| `x_mitre_domains ... expected array, received undefined` | Full schema requires `x_mitre_domains` (e.g. `['enterprise-attack']`). WIP omits it fine. |
| `... Unrecognized key: "description"` | `x-mitre-detection-strategy` has **no** `description` field — remove it. (Schemas are `.strict()`; analytics/most SDOs *do* allow `description`.) |
| `x_mitre_analytic_refs ... Too small / At least one` | Detection-strategy requires ≥1 analytic ref. Either reference a real created analytic, or for "no refs" omit the field (don't send `[]`). |
| `x_mitre_log_source_references ... Too small` | Omit the field entirely to mean "none"; it must be non-empty when present. |
| `x_mitre_contents ... At least one` + missing `x_mitre_version` (collections) | Collection full schema needs `x_mitre_version` and ≥1 `x_mitre_contents` entry. |

**Do not** assert that server-controlled fields echo what you sent. The server
overwrites/strips: `workspace.attack_id`, the ATT&CK `external_references[0]`,
`x_mitre_attack_spec_version`, `revoked`, and (on create) `created_by_ref` /
`x_mitre_modified_by_ref`. If an existing assertion expects a specific
server-controlled value, assert the server's *rule* instead (e.g. "`attack_id`
matches `T####`"), not the literal you sent.

## Where to find schema truth

- Selector used by the validator: `getSchema()` in
  `app/lib/validation-schemas.js`.
- Compiled schemas: `node_modules/@mitre-attack/attack-data-model/dist/index.cjs`.
- Readable source (checked out locally):
  `/Users/ssica/Development/attack/attack-data-model/src/schemas/` — the
  per-type files under `sdo/` and the cross-field rules in
  `refinements/index.ts`. Enum lists and required fields live in the type's
  `*.schema.ts`.
- Quick UUID sanity check:
  `node -e "const {validate,version}=require('uuid'); const u='...'; console.log(validate(u)&&version(u)===4)"`

## Gotchas

- **Flakiness:** the suite has intermittent cross-spec state leakage (shared
  in-memory DB). An occasional failure at delete-all / "expect empty array"
  assertions usually clears on re-run. Don't chase it; re-run once.
- **Collections route returns 500, not 400, on ADM failure** — its create path
  doesn't map `ValidationError` to 400 and the details bypass the `Bad request: %s`
  log. If `details` aren't logged, validate the composed object directly against
  `getSchema(type, status)` in a scratch script.
- **Non-STIX specs:** some directories operate on non-STIX/system objects
  (`teams`, `user-accounts`, `session`, parts of `system-configuration`,
  `identities`). For those, `getSchema()` returns `null` and ADM never runs, so
  flipping the flag is a harmless no-op — flip it for consistency, confirm green,
  move on. If a spec clearly has nothing to do with STIX object creation, it's
  fine to leave it unchanged; note it in the commit body.
- **Naming inconsistency:** some files are `<thing>-spec.js` instead of
  `<thing>.spec.js`, and some pagination files use `-` vs `.`. Mocha's
  `--recursive` loads all `.js` files so they still run; leave renames out of this
  effort.

## Remaining work (alphabetical; one commit each)

Vanilla CRUD suites — do these in order:

- [ ] `groups` — `groups.spec.js`, `groups-input-validation.spec.js`, `groups.query.spec.js`, `groups-pagination.spec.js` (pagination → `validateWithAdm` option)
- [ ] `identities` — `identities.spec.js` (likely non-STIX no-op; verify)
- [ ] `marking-definitions` — `marking-definitions.spec.js`
- [ ] `matrices` — `matrices.spec.js` (matrix ATT&CK external_id is the domain name, not an auto ID)
- [ ] `mitigations` — `mitigations.spec.js`, `mitigations-pagination.spec.js` (pagination → `validateWithAdm` option)
- [ ] `notes` — `notes.spec.js` (workspace object; may be a no-op)
- [ ] `recent-activity` — `recent-activity.spec.js` (bundle-seeded; may be involved)
- [ ] `references` — `references.spec.js` (workspace object; may be a no-op)
- [ ] `relationships` — `relationships.spec.js`, `relationships-pagination.spec.js` (pagination → `validateWithAdm` option)
- [ ] `reports` — `reports.spec.js`
- [ ] `session` — `session.spec.js` (non-STIX; likely no-op)
- [ ] `software` — `software.spec.js`, `software-pagination.spec.js` (`malware`/`tool`; pagination → `validateWithAdm` option)
- [ ] `stix-bundles` — `stix-bundles.spec.js` (bundle-seeded; may be involved)
- [ ] `system-configuration` — `system-configuration.spec.js`, `create-object-identity.spec.js`
- [ ] `tactics` — `tactics.spec.js`, `tactics.techniques.spec.js` (the latter is bundle-import seeded)
- [ ] `teams` — `teams.spec.js`, `teams-invalid.spec.js` (non-STIX; likely no-op)
- [ ] `user-accounts` — `user-accounts.spec.js`, `user-accounts-invalid.spec.js` (non-STIX; likely no-op)

**Defer to the very end** (non-vanilla; import-path / bundle-validation heavy —
ADM is recorded-not-rejected there, so they behave differently):

- [ ] `attack-objects`
- [ ] `collection-bundles`
- [ ] `collection-indexes`

## Definition of done (per directory)

- Every spec in the directory sets/pins `withAttackDataModel = true` (or
  `validateWithAdm: true` for pagination).
- `npm run test:file -- --recursive app/tests/api/<dir>` is green.
- eslint + prettier clean.
- One commit, `test(<dir>): ...`, with a body listing the fixture fixes.
