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

The defaults below include the subsequent frontend-feedback refinements:

| Decision                     | Recommended behavior                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Scope                        | Virtual tracks only; leave standard rolling drafts and rollback sources unchanged                                               |
| Retention triggers           | One-shot manual materialization policy or persistent cron-schedule policy, both disabled by default                             |
| Suggested starting threshold | 10; positive integer, minimum 1; no zero-as-delete-all behavior                                                                 |
| Counted drafts               | All virtual drafts, including manual, scheduled, composition/configuration/metadata and quarantine-resolution drafts            |
| Tagged snapshots             | Never count against N and never delete                                                                                          |
| Policy changes               | Saved cron schedule updates create no content draft/deletion; manual policies last one request                                  |
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

## Feature A: trigger-scoped count-based retention

Frontend feedback replaced the original global policy with two distinct choices:

- **Ad-hoc:** optional `draft_retention: { max_drafts: N }` on
  `POST /api/release-tracks/:id/virtual/snapshots/create`. It applies only to this
  materialization, is off by default, and never changes/inherits recurring policy.
- **Recurring:** optional `snapshot_schedule.draft_retention` within the cron
  schedule, saved through `PUT /api/release-tracks/:id/virtual/schedule` or initial
  virtual-track creation. Only trusted scheduler cron execution applies it.

Positive safe integers are accepted; missing/null limits disable cleanup.
Manual/dates schedule shapes reject retention fields. Metadata, configuration,
composition and quarantine writes do not invoke retention. Both policies still
count all untagged snapshots across the track, not separate cause pools.

Supplying an ad-hoc policy or changing a cron limit requires an administrator.
Editors can preserve the policy while editing cron timing or switch away from
recurring mode. Schedule-only saves create no draft or immediate deletion.

Materialization locks its target before reading its source, chooses the policy
from the trusted trigger, and creates durable bounded intent before saving.
After successful persistence it removes eligible older drafts, preserving the
newest N, tagged snapshots, and source/receipt protections. Shared manifests and
registry counters are repaired through the existing cleanup path.

Intent records preserve `source`, `max_drafts`, and the original cutoff. Manual
retry retains its immutable request limit independently of later schedule edits;
recurring retry also respects the current applicable cron policy. Disabling or
leaving recurring mode stops additional recurring selection. Legacy intents with
no trigger/limit may repair already-deleted storage but cannot select more rows.

The earlier global field/endpoint are removed, with no compatibility alias.
Stored legacy global values are inert rather than silently adopted as new
destructive policies. The existing deletion guardrails and squash behavior remain.

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

Virtual-track history now offers **Drafts only**, **Releases only**, and **All
releases** (the default). All releases includes both states. Use exact server
tagged filtering with no pinned-draft injection, and retain the 25-item paginator.
The small summary reports filtered tagged/draft/total counts across matching
pages, including zero results, rather than registry-wide totals or page length.

Refresh lightweight history and cleanup status every 30 seconds while Releases
is visible, plus immediately on entry/focus/visibility return. Pause during
editing, dialogs, mutations and active requests; preserve filter/page/scroll and
clamp an emptied page. Tear down timers/listeners and cancel stale requests.
Unfiltered server latest identities control Latest markers and latest-only
actions. Keep standard-track source-draft hiding behavior unchanged.

The **Create Draft** dialog offers a fresh, off-by-default ad-hoc policy.
Saved recurring policy controls appear only for **Recurring** mode and follow
**Edit Config**, **Cancel**, and **Save Config**. Center the history controls,
refresh authoritative counts with stale-response protection, and omit the
redundant pinned label. Completed cleanup uses a floating dismissible notification;
pending/failed cleanup remains discoverable with cleanup-only retry.

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

Initial lifecycle verification completed: 1,143 backend tests across all `npm test` stages and
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

Trigger-policy feedback verification: all 1,149 backend tests and 132 focused
frontend tests passed, together with backend and changed-source frontend lint.
The real browser/API flow verified centered controls, no redundant pinned text,
manual counter growth (4 to 5), one-shot cleanup and fresh-dialog reset, floating
notification dismissal without refresh resurrection, Edit Config gating/Cancel,
and schedule-only saving without a new snapshot. Actual cron execution reduced
five drafts to its saved limit of three; a separate ad-hoc limit of one left that
saved recurring limit unchanged.
