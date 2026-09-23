# Virtual draft retention and release-time squash

Status: implemented and verified. Work is on
`feat/virtual-track-draft-retention` in both repositories, created from local
`next` with the prior draft-composition commits preserved:

- REST API: `b1acfaad` — `feat(release-tracks): support draft components in virtual tracks`
- Frontend: `60b3ac93` — `feat(release-tracks): expose draft component selection`

The frontend's subsequent save-dialog timing regression fix is also preserved.

## Recommendation

Both features are viable. Implement them as two selection policies using one
internal, guarded historical-draft cleanup operation. Keep normal latest-draft
DELETE semantics unchanged. Add a compact history view independently of storage
retention: hiding drafts is reversible; deleting them is not.

The following defaults were approved for implementation:

| Decision                     | Recommended behavior                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Scope                        | Virtual tracks only; leave standard rolling drafts and rollback sources unchanged                                               |
| Automatic retention          | Disabled by default; when enabled, retain the newest N untagged snapshots                                                       |
| Suggested starting threshold | 10; positive integer, minimum 1; no zero-as-delete-all behavior                                                                 |
| Counted drafts               | All virtual drafts, including manual, scheduled, composition/configuration/metadata and quarantine-resolution drafts            |
| Tagged snapshots             | Never count against N and never delete                                                                                          |
| Policy changes               | Live registry metadata; no content draft and no immediate deletion; apply on the next successful draft creation                 |
| New track clones             | Retention disabled rather than inheriting a destructive policy silently                                                         |
| Release-time squash          | Explicit, unchecked opt-in on each virtual release                                                                              |
| First-release squash         | Delete all eligible drafts strictly before the selected snapshot                                                                |
| Protected snapshots          | Skip and report; safety overrides the configured count                                                                          |
| Authorization                | Existing application administrators configure retention and opt into bulk squash; ordinary tagging permissions remain unchanged |

There is no track-specific administrator/ACL model today. A new per-track role
system is outside this proposal. Extending these controls to existing team leads
or editors is a product decision, not a reason to introduce ACL infrastructure.

## Baseline implementation findings

- `snapshot-service.cloneSnapshot` locks and prunes standard tracks, but retains
  virtual history (`app/services/release-tracks/snapshot-service.js:427-521`).
- Virtual materialization locks its standard components, not its virtual target
  (`app/services/release-tracks/virtual-track-service.js:523-600`). Other virtual
  creation paths include composition updates, quarantine promotion, and shared
  metadata/configuration updates. Schedule updates and snapshot notes do not
  create drafts.
- Public snapshot DELETE refuses historical drafts and reverts latest membership
  to the predecessor (`snapshot-service.js:999-1045`). It is not a suitable
  implementation of retention or squash.
- Virtual tagging keeps the selected snapshot's timestamp, members, manifest and
  composition provenance. Historical tagging is supported. The existing release
  planner finds the preceding tag by snapshot `modified`, not `tagged_at` or
  highest version (`versioning-service.js:121-347`; existing retroactive release
  cases in `app/tests/api/release-tracks/release-tracks-release.spec.js`).
- Scheduled recovery looks for the persisted scheduled snapshot before retrying.
  The occurrence is marked complete only after materialization and audit finish
  (`app/scheduler/virtual-track-snapshots-task.js:104-158`). Deleting the recovery
  snapshot without a durable receipt can cause a completed occurrence to run again.
- Manifests can be shared by snapshots. `content-manifest-service` provides
  reference-aware deletion and orphan repair. Its current concurrent deletion of
  entries and header can strand entries if only header deletion succeeds
  (`app/services/release-tracks/content-manifest-service.js:341-398`).
- The frontend connector requests 200 history summaries; the page ignores
  pagination metadata and renders every returned item. Older history beyond that
  page is not navigable through these controls
  (`release-tracks.service.ts:223-245`, `release-track-page.component.ts:1058-1081`,
  `release-track-page.component.html:545-570` in the frontend repository).

## Feature A: automatic count-based retention

### Contract

Proposed registry field:

```json
{ "draft_retention": { "max_drafts": 10 } }
```

Missing configuration or `max_drafts: null` means disabled. Reject zero, negative,
fractional and nonnumeric values. Reject configuration on standard tracks.

Expose an optional field on virtual-track creation and a dedicated endpoint:

```text
PUT /api/release-tracks/:id/virtual/draft-retention
{ "max_drafts": 10 }
```

Use the existing registry-backed schedule-update pattern. Return current policy
in track/configuration responses as live metadata, not historical content; do not
add it to bundles, sealed manifests, or copied version histories. Policy-only
saves must not create a configuration draft accidentally in the frontend.

### Selection and application

1. Lock the target before reading the source snapshot or its manifest.
2. Create and durably persist the new draft and its manifest; complete required
   latest-membership reconciliation. Failed creation never deletes old history.
3. Read the current policy. Select untagged snapshots newest-first by `modified`.
4. Keep the newest N, including the newly created/current latest draft. Select
   older eligible drafts for cleanup, across the whole history, not per release
   interval. Tags do not consume the count.
5. Preserve source/dependency protections and scheduled snapshots whose durable
   non-replay receipt cannot be secured. Report any protected excess above N.
6. Delete eligible historical snapshots in bounded batches; remove only manifests
   with no surviving references; repair registry counts once per batch/operation.

Example: 12 drafts and 3 releases with N=10 removes the oldest 2 eligible drafts
and retains all 3 releases. A protected old draft can make the retained total
exceed 10. Manual notes and quarantine alternatives are not implicitly exempt:
if all-draft retention is approved, the configuration warning must say that their
historical snapshots can be permanently removed too.

Run the policy after every successful virtual draft-creation path, not just cron
materialization. Keeping only scheduled drafts bounded would leave other virtual
history unbounded and would need a separate, explicitly named policy.

## Feature B: opt-in release-time squash

This is history deletion, not a merge of contents. Do not combine members,
quarantine choices, notes, manifests or provenance into a new synthetic snapshot.
The reviewed release remains the exact artifact being tagged.

For selected virtual draft R and preceding tagged snapshot P, eligible drafts D
satisfy:

```text
D.version == null
P.modified < D.modified < R.modified
```

If P does not exist, omit the lower bound. Always retain R, all tags, and every
snapshot at or after R. Historical tagging therefore cannot remove newer drafts
or a later release. An active draft means the latest snapshot when untagged, not
an arbitrary older untagged snapshot remaining after the target is tagged.

Example:

```text
v1.0 -> draft A -> draft B -> selected R -> newer draft -> v3.0
```

Tagging R with squash removes A/B only. It preserves v1.0, R, the newer draft and
v3.0. Use snapshot chronology, never wall-clock tagging order or semantic-version
magnitude, to determine these boundaries.

### API and UI

- Extend the existing strict release payload with `squash_drafts: boolean`, false
  by default. Reject true for standard tracks and unauthorized actors before
  tagging. Keep existing increment/version and notes behavior.
- Extend the virtual release summary preview with a `draft_squash` section:
  boundaries, eligible count, protected count/reasons, and a preview fingerprint.
  Use the same selector as commit; preview performs no deletion.
- Recommend requiring that fingerprint for destructive opt-in. Under the target
  lock, recompute eligibility; return 409 and request a fresh preview if the
  reviewed boundary/candidate set changed. This avoids silently expanding what
  the user approved. Ordinary tagging remains unaffected.
- In the preview dialog, show an unchecked **Delete earlier drafts after tagging**
  checkbox, the count and preceding release boundary (or “since track creation”),
  and an irreversible-deletion warning. Do not imply content merging.
- Submit to the previewed exact `:modified` endpoint, not a moving `latest` target.
- Commit and finish release publication/artifacts before deleting any old drafts.
  A failure before successful release completion deletes no squash candidates.
- Return the normal snapshot response plus operation-only `draft_cleanup` status,
  counts and audit operation ID. Do not put mutable cleanup progress in the
  released snapshot's content or history fields.

Converting the newest virtual release back to a draft still preserves that
snapshot and its content. It does not resurrect squashed earlier drafts.

## Shared prerequisites and safeguards

The rationale and failure examples are documented in
[Deletion Guardrails](deletion-guardrails.md). That document is the canonical
plain-language explanation of scheduler receipts, target-track serialization,
and recoverable cleanup; do not duplicate that explanation here.

Implementation requirements specific to this plan:

- Acquire the virtual target lock before source reads; hold standard component
  locks in sorted order during materialization. Cover every creation path and
  whole-track deletion; avoid nested non-reentrant acquisition. Use bounded
  cleanup batches and verify lock ownership before destructive writes.
- Preserve monotonic scheduled-occurrence receipts, including legacy and
  API-supplied occurrence metadata. Receipt-only recovery must never rematerialize
  deleted results, and stale workers must not reopen completed work.
- Persist bounded audit-backed cleanup intent before deletion. Bind squash to
  its original release event and non-expanding interval. Expose cleanup-only
  status/retry, independently of normal release POST.
- Reference-check shared manifests, make entry/header deletion retryable, repair
  registry counts without rolling back latest membership, and never delete STIX
  objects or component snapshots as a side effect.

## Frontend history changes

For virtual tracks, default to **Releases + current draft**. Load tagged summaries
through the existing `tagged=true` server filter and use the already loaded latest
snapshot for the current-draft card. Offer **Drafts** and **All snapshots** views,
with a 25-item paginator using existing `limit`, `offset`, and `pagination.total`.

Use server totals/registry metadata, not the loaded page length, for counts.
Refresh/reset pagination after creation, tagging or cleanup; handle an emptied
page and a draft disappearing under an active user with an explanatory refresh
message. Counts and “Latest” status must not be inferred from filtered array
position. Keep standard-track source-draft hiding behavior unchanged.

Add a virtual Config **Draft retention** control with disabled/unlimited and
positive count states, administrator authorization, and an explicit deletion
warning. Display protected excess or deferred cleanup without suggesting tags
were removed. Cleanup response errors must distinguish a successful release
from unsuccessful cleanup and offer retry instead of a second tag attempt.

## Implementation sequence on the same feature branches

1. **Shared lifecycle safety:** target-lock coverage, guarded historical cleanup,
   recoverable shared-manifest cleanup, durable intent/status/repair, scheduler
   receipt preservation and non-replay checks. Keep both policies disabled until
   these prerequisites are verified.
2. **Automatic retention:** registry field, strict API/authorization, creation
   integration, config read/write projection and documentation/Bruno updates.
3. **Release-time squash:** pure interval selection, preview/fingerprint, opt-in
   release commit, audit-bound cleanup-only recovery and OpenAPI documentation.
4. **Frontend:** retention configuration, virtual history filters/pagination,
   opt-in preview control and partial-outcome handling. These consume the agreed
   backend schemas; avoid a parallel alternative frontend contract.
5. **Verification:** focused API and scheduler regressions, real-browser flows
   against isolated data, then the full backend suite and affected frontend
   tests. Commit backend/frontend behavior as separate `feat(release-tracks)`
   changes; use appropriately scoped commits for prerequisite fixes.

## Acceptance checks for implementation

- Disabled retention and omitted/false squash preserve existing history.
- N=1 and N=10 behave correctly with interleaved releases and every draft cause;
  invalid settings fail, policy-only save creates no draft, new clones are safe.
- All tagged snapshots, current/target snapshots and protected sources survive.
- First-release and historical-release squash respect strict boundaries, including
  tagging order different from snapshot chronology; stale preview refreshes.
- Surviving release exports/hashes, manifests, provenance and latest backrefs are
  unchanged; unreferenced manifest entries really disappear; STIX objects remain.
- A scheduled result pruned before/after occurrence completion is never recreated
  after restart, duplicate delivery, stale-worker failure or explicit API retry.
- Fault injection after draft/tag persistence, during deletes, manifest cleanup,
  counter repair and audit completion converges via cleanup-only recovery without
  a duplicate release or a widened deletion interval.
- Concurrent materialization/configuration/tagging/rollback/deletion either
  serializes or reports 409; no tagged row or live shared manifest is deleted.
- Authorization is enforced in the service, not only hidden frontend controls.
- Real UI checks cover many drafts, more than one page of tags, default compact
  view, policy save, unchecked squash default, clear deletion counts, disappearing
  drafts and a committed release with deferred cleanup.

## Initial evaluation

Read the implementation, request contracts and existing regression scenarios;
no retention/squash implementation was changed and no database cleanup ran.
Executed an in-memory model of the proposed selectors covering count thresholds,
interleaved tags, historical and first releases, newer drafts, and protected
snapshots. All six scenario groups passed. This validates the proposed boundary
rules only, not MongoDB locking, scheduler durability, or production behavior.

## Execution evidence

The approved defaults are implemented. Browser verification against an isolated
API demonstrated compact history, 25-item draft pagination, policy-only saves,
31 drafts reduced to 10 while preserving a tag, first-release squash, and
cleanup-only repair after an injected manifest-deletion failure. The release's
bundle hashes remained unchanged through repair. A regression also verifies
that a successful repair clears the previous failure from its response.

Focused lifecycle/scheduler and frontend regressions exercise the API contracts,
fault recovery, authorization and UI transitions. See the
[implementation backlog](../TODO.md#virtual-draft-retention-and-release-time-squash-2026-09-23)
for verification completion. Public behavior is documented in the
[API reference](../../user/release-tracks/api-reference.md#virtual-draft-retention);
the explanation requested during planning is preserved in
[Deletion Guardrails](deletion-guardrails.md).

Verification completed: 1,143 backend tests across all `npm test` stages and
143 focused frontend tests passed. Backend lint and changed frontend source lint
passed. Real-browser checks also covered 26 tagged releases across two pages,
with the current draft pinned and global counts unchanged between pages.

The local test environment exposed a Supertest transport issue: it hardcodes an
IPv4 client URL even when the ephemeral listener uses IPv6, occasionally reaching
an unrelated local listener. Full-suite verification used a temporary adapter
matching the listener's address family, without changing test selection,
assertions, or production code. That diagnostic tooling was removed afterward.
Repository-wide frontend lint still reports existing errors in untouched files;
the changed lifecycle files pass their scoped lint check.
