You're picking up a mechanical test-migration effort in the `attack-workbench-rest-api` repo. Read `ADM-test-migration-handoff.md` at the repo root first — it has the full context, the per-directory workflow, a playbook of the common ADM validation fixes, and a checklist of remaining directories.

**Task:** Enable ATT&CK Data Model (ADM) request validation across the remaining `app/tests/api/` regression suites, one directory at a time, alphabetically, starting with `groups`. For each directory: flip each spec's `config.validateRequests.withAttackDataModel` from `false` to `true` (for pagination specs, pass `validateWithAdm: true` in the `PaginationTests` options instead), make the seeded request payloads ADM-compliant per the playbook, get the suite green, lint+format, and make one commit per directory (`test(<dir>): run <dir> suites with ADM validation enabled`, plain message body listing the fixture fixes, no AI-attribution footer).

Work on the existing `fix/adm-validation-logging` branch. Run a single spec with `npm run test:file -- <path>` and a directory with `npm run test:file -- --recursive app/tests/api/<dir>`. The server logs full ADM failure detail at `[WARN] Bad request: %s` — read the `details` array to see exactly which field/rule failed.

**Skip for now** (do last, they behave differently): `attack-objects`, `collection-bundles`, `collection-indexes`.

Do the directories in order, committing each before moving to the next. Stop and ask if a spec needs a behavior change beyond fixture compliance, or if a directory turns out not to involve STIX-object creation at all.
