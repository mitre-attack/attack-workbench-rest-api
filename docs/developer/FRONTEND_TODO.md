# Release Tracks Frontend TODO

This developer handoff tracks backend release-track changes that require
corresponding work in the Angular frontend. It is intentionally task-oriented,
but each task also explains why the change matters so that it can be
implemented without reconstructing the backend design history.

The current server contract is defined by:

- [Release-track OpenAPI paths](../../app/api/definitions/paths/release-tracks-paths.yml)
- [Release-track API reference](../user/release-tracks/api-reference.md)
- [Virtual-track guide](../user/release-tracks/virtual-tracks.md)
- [Bruno release-track requests](https://gitlab.mitre.org/attack-strategy/bruno/-/tree/main/workbench/Release%20Tracks?ref_type=heads)
- [`internalattack` Python client](https://gitlab.mitre.org/attack-strategy/internalattack-python)

## Endpoint conventions

Keep these rules in mind while updating the connector:

- Operations shared by standard and virtual tracks do not include a type
  namespace. Snapshot retrieval and release operations are shared.
- New virtual-only operations include `/virtual/` in the path.
- The current OpenAPI document is authoritative. Some older standard-only
  workflow routes, such as `/candidates` and `/staged`, predate the namespace
  convention and do not currently include `/standard/`.
- A release preview is a read-only `GET`. A release commit is a `POST`.

## P0 — Send canonical domains for domain-bearing content

### [ ] Require `x_mitre_domains` in affected reviewed-object forms

The backend no longer suppresses the ATT&CK Data Model error for a missing
`x_mitre_domains` property on campaigns, intrusion sets, detection strategies,
or matrices. Existing latest domainless content is repaired automatically at
server startup, including revoked and deprecated lineages, but new reviewed
revisions must carry their own canonical domain membership.

Update the affected Angular create/edit payloads so the field contains the
object's complete domain union:

```ts
x_mitre_domains: Array<'enterprise-attack' | 'ics-attack' | 'mobile-attack'>;
```

Do not reduce a cross-domain object to the currently selected screen or bundle
domain. For example, one object used by Enterprise and Mobile should persist
`['enterprise-attack', 'mobile-attack']`; both virtual domain filters will
include that same exact revision by set intersection.

Workbench still permits incomplete `work-in-progress` objects under the
existing partial-ADM workflow contract. Before a form advances an affected
object to `awaiting-review` or `reviewed`, require at least one domain and
surface the backend's `x_mitre_domains` validation detail if it is missing.

Done when:

- Campaign, group, detection-strategy, and matrix form models expose canonical
  domain selection.
- Reviewed create and new-revision payloads always include a nonempty domain
  array.
- Multi-select state preserves every selected domain instead of choosing one
  based on route context.
- Validation errors for `x_mitre_domains` are displayed next to the domain
  control.
- Tests cover a cross-domain payload and rejection of a reviewed domainless
  payload.

## P0 — Model draft revision selectors separately from released member pins

### [ ] Preserve `"latest"` in candidate and staged frontend state

Candidate and staged entries no longer always contain an ISO timestamp.
Their `object_modified` field is a revision selector:

```ts
type WorkflowRevisionSelector = string | 'latest';

interface CandidateOrStagedEntry {
  object_ref: string;
  object_modified: WorkflowRevisionSelector;
}
```

Here, `string` should be validated as an ISO timestamp when it is not the
literal `"latest"`. Member and quarantine models should remain stricter:
their `object_modified` value is always an exact ISO timestamp.

When `POST /api/release-tracks/:id/candidates` omits `modified` or sends
`"latest"`, the response preserves `"latest"` instead of replacing it with
the current timestamp. Promotion to staged preserves that selector. The UI
should render it as a moving/latest reference and must not parse it as a date.
An explicitly supplied timestamp remains an exact pin.

Release preview is the freezing boundary. Before a standard release preview is
rendered, the backend resolves every staged `"latest"` selector. Therefore,
`format=workbench` shows exact timestamps in the would-be `members`, and a
committed release always stores exact member revisions. Preview and commit are
separate resolutions; if an object changes between them, the committed member
may legitimately be newer than the previewed one.

Done when:

- Candidate and staged DTOs accept either an ISO timestamp or `"latest"`.
- Member and quarantine DTOs accept exact timestamps only.
- Candidate/staged views display a useful “latest” label without date parsing
  errors.
- Add-candidate flows omit `modified` or send `"latest"` when the operator
  chooses a moving reference, and send an ISO timestamp for an exact pin.
- Candidate-version updates and staged demotions can send `"latest"` as their
  selector.
- Release-preview fixtures show dynamic staged input becoming exact
  would-be members, and committed-release fixtures contain no dynamic members.

## P0 — Surface fail-closed primary revision errors

### [ ] Explain missing primary revisions instead of showing a generic failure

The backend now verifies every exact `(object_ref, object_modified)` primary
reference at request ingress and again before it releases, clones,
materializes, or renders a snapshot. It no longer omits objects that could not
be hydrated.

Two structured error cases are relevant to the UI:

```ts
interface MissingPrimaryRevisions {
  message: string;
  missing_references: Array<{
    object_ref: string;
    object_modified: string;
  }>;
}
```

- HTTP `400` means the current request selected a revision that does not
  exist. Candidate add/version-update flows should keep the dialog open,
  identify the missing selections, and let the operator correct them.
- HTTP `409` means an existing draft or snapshot contains a dangling primary
  reference. Snapshot retrieval, release preview/commit, cloning, virtual
  materialization/quarantine promotion, and bundle export can return this
  response. The UI should identify the affected revisions and explain that an
  operator must repair the track/object data before continuing.

Do not render a partial Workbench snapshot or treat a failed bundle request as
an empty export.

Done when:

- The release-track connector exposes `missing_references` on `400` and `409`
  responses instead of flattening the response to a generic message.
- Candidate forms keep their input state after a `400` and highlight the
  missing revisions.
- Snapshot, release, clone, virtual-materialization, and export views present
  an actionable integrity error for `409`.
- Tests cover multiple missing references and prove no partial snapshot or
  bundle is rendered.

### [ ] Explain immutable-revision and snapshot-graph deletion conflicts

Persisted STIX revisions are globally immutable. Any STIX-changing PUT returns
`409 Conflict` and should direct the operator to POST a new revision. Separately,
a tagged snapshot's opt-in graph manifest holds exact revision pointers. If an
object revision is a protected dependency of an active or linked-pending
manifest, exact-revision or full-lineage DELETE returns `409 Conflict`:

```ts
{
  message: string;
  details?: string;
  snapshot_graph_pins: Array<{
    track_id: string;
    snapshot_modified: string;
    kind: 'root' | 'relationship' | 'secondary' | 'supporting' | 'link_target';
    tier?: 'members' | 'staged' | 'candidates' | 'quarantine';
  }>;
}
```

This can occur from ordinary object-management screens, not only from the
release-track UI. Present it as a versioning constraint: the operator should
create a new object revision, or remove the draft snapshots that no longer
need the old revision. Do not offer a force-delete path; administrator
authorization does not bypass graph integrity.

Candidate and staged workspace metadata remains editable, but STIX content does
not. Relationship corrections are always new POST revisions; schema-v2 graph
manifests point to the exact older relationship revision and never rely on a
frozen clone. Marking definitions remain the narrow frozen-payload exception
because they are unversioned.

Done when:

- Shared object edit/delete error handling recognizes
  `snapshot_graph_pins`.
- The message identifies the affected release track(s) and recommends a new
  revision instead of a blind retry.
- The UI does not expose a force-delete action for graph-protected revisions.

### [ ] Handle persisted mutations whose membership reconciliation failed

A release-track mutation can persist its snapshot before a downstream object
backref write fails. The server now returns HTTP `500` instead of reporting
success and includes:

```ts
{
  message: 'Release-track membership protection could not be reconciled';
  track_id: string;
  reconciliation_id: string;
  details?: string;
}
```

For a release request, the snapshot may already be tagged. Do not
automatically retry the POST: refresh snapshot history first, show the
reconciliation ID, and direct the operator to an administrator if protection
repair is still pending.

Done when:

- The connector preserves `track_id` and `reconciliation_id` from this `500`.
- Release and mutation dialogs explain that persistence may have succeeded
  and do not offer a blind retry.
- The UI refreshes the relevant track before enabling another action.

## P0 — Align the Angular connector with the current routes

### [x] Remove direct snapshot mutation controls and client methods

Persisted snapshot history is now immutable. The backend no longer exposes:

```text
POST /api/release-tracks/:id/contents
POST /api/release-tracks/:id/snapshots/:modified/contents
POST /api/release-tracks/:id/snapshots/:modified/meta
```

Remove the corresponding connector methods, payload types, dialogs, buttons,
and tests. Standard-track content should move through candidates, staged, and
release. Virtual content should move through composition materialization and
quarantine resolution. Metadata can be changed only from the latest snapshot
via `POST /api/release-tracks/:id/meta`, which creates a new draft.

Do not replace removed historical-edit actions with hidden calls or local
state edits. If an operator wants a different result, they should correct the
latest draft, delete it while deletion is still allowed, or create a newer
draft.

Done when:

- No Angular code calls or models any of the three removed routes.
- Snapshot history views are read-only except for supported release, clone,
  and latest-draft deletion actions.
- Standard and virtual editors direct users to their respective supported
  workflows.

Completed 2026-07-30: the Angular connector methods, payload type, and
regression fixtures were removed. No component or menu called these methods,
so no UI control needed to be migrated.

### [ ] Offer deletion only for the latest untagged draft

`DELETE /api/release-tracks/:id/snapshots/:modified` is a narrow “undo latest
draft” operation. The server accepts it only when the selected snapshot is both
untagged and currently latest. Tagged releases and older drafts return `409`
because they are immutable history.

In snapshot history, show Delete only on the latest item when `version == null`.
After a successful delete, refresh both the latest snapshot and the history;
the preceding snapshot becomes current. If a `409` occurs because another
operation created a newer draft, refresh instead of retrying the stale delete.

Done when:

- Tagged and historical rows never offer Delete.
- The confirmation explains that the track will revert to the preceding
  snapshot.
- A stale `409` refreshes the view and preserves history.

### [ ] Add administrator confirmation for full track deletion

Full track deletion is administrator-only and requires the query parameter
`confirm_track_id` to exactly equal the `:id` path parameter:

```text
DELETE /api/release-tracks/:id?confirm_track_id=:id
```

Do not expose this action to editors or team leads. Before sending the request,
show the track name and ID, explain that deletion removes all history, and
require an explicit confirmation interaction. A missing or stale ID returns
`400`; a non-administrator returns `401`.

Done when:

- Route guards and action visibility match the documented authorization
  matrix.
- The connector sends the selected track's exact ID as `confirm_track_id`.
- Dialogs cannot reuse confirmation state after the selected track changes.
- Tests cover administrator success plus editor, missing-confirmation, and
  mismatched-confirmation rejection.

### [ ] Use only the explicit snapshot-retrieval endpoints

The release-track resource path no longer doubles as an implicit request for
the latest snapshot. `GET /api/release-tracks/:id` was removed before the
feature was officially released, so there is no compatibility alias.

Update the frontend to use:

```text
GET /api/release-tracks/:id/snapshots
GET /api/release-tracks/:id/snapshots/latest
GET /api/release-tracks/:id/snapshots/:modified
```

Required work:

- Keep `getLatestSnapshot()` on `/snapshots/latest`.
- Update the integration test that still calls `GET /release-tracks/:id`.
- Remove any fallback that interprets a full snapshot or `version_history` as
  the snapshot-list response.
- Remove the unsupported `releases=only` option from track-list and
  snapshot-retrieval types. Tagged-state filtering now belongs on the snapshot
  history endpoint as `tagged=true`.

Done when:

- No Angular code calls `GET /api/release-tracks/:id`.
- Connector and integration tests assert the three explicit retrieval paths.

### [ ] Move virtual-only operations under `/virtual/`

Virtual composition and materialization are now visibly scoped in the URL:

```text
PUT  /api/release-tracks/:id/virtual/composition
POST /api/release-tracks/:id/virtual/snapshots/create
```

The Angular connector still calls the older `/composition` and
`/snapshots/create` paths. Update those paths and their tests.

Also remove:

```text
GET /api/release-tracks/:id/snapshots/preview
```

That endpoint no longer exists. It recomputed a hypothetical virtual
composition without persisting it, which overlapped confusingly with release
preview. Creating a virtual draft is now an explicit operation. The current
`onDraft()` flow should therefore open a confirmation dialog and call the
create endpoint directly instead of first calling `previewVirtualSnapshot()`.

Done when:

- `updateComposition()` calls `/virtual/composition`.
- `createVirtualSnapshot()` calls `/virtual/snapshots/create`.
- `previewVirtualSnapshot()` and its UI/test fixtures are removed.
- Creating a virtual draft still asks for confirmation, but does not depend on
  a nonexistent preview payload.

## P0 — Replace “bump” with the release contract

### [ ] Rename bump-oriented frontend symbols and user-facing text

“Release” is now the operation name throughout the API. The server has no
`/bump` routes, and retaining bump terminology in Angular makes logs, types,
tests, and UI copy disagree with the public contract.

Suggested renames:

```text
BumpPayload       -> ReleasePayload
previewBump()     -> previewRelease()
bumpByLatest()    -> releaseLatest()
bumpByModified()  -> releaseSnapshot()
bumpRelease()     -> releaseSnapshot()
```

Update comments, test names, log messages, and errors such as “Failed to
preview release track bump” at the same time.

Done when:

- “bump” is absent from the release-track connector, models, components, and
  tests unless it appears in a historical explanation.
- Angular method names distinguish previewing from committing a release.

### [ ] Replace the old release request body

The current frontend `BumpPayload` is obsolete:

```ts
{
  type?: 'major' | 'minor';
  version?: string;
  dry_run?: boolean;
}
```

The release body is now:

```ts
{
  increment?: 'major' | 'minor';
  version?: string; // exact MAJOR.MINOR, for example "14.1"
}
```

The rules are:

- `increment` and `version` are mutually exclusive.
- Supplying both returns `400 Bad Request`.
- Omitting both asks the server for the default minor increment.
- `dry_run` was removed. Use a release-preview representation instead.
- `expected_snapshot_modified` is not required. Choosing `latest` means the
  caller accepts whichever snapshot is latest when the server handles the
  request; choosing `:modified` explicitly pins the target.

Use the same selector in the preview query and the release request body. For
example:

```text
GET  .../release/preview?format=summary&increment=major
POST .../release
Body: { "increment": "major" }
```

Done when:

- Angular never sends `type`, `dry_run`, or
  `expected_snapshot_modified` in a release request.
- The UI can select `major`, `minor`, or an explicitly entered `MAJOR.MINOR`
  version and validates mutual exclusivity before calling the server.

## P0 — Correct the release-preview flow

### [ ] Treat release preview as a `GET` with representation-specific output

Both track types use the same preview routes:

```text
GET /api/release-tracks/:id/snapshots/latest/release/preview
GET /api/release-tracks/:id/snapshots/:modified/release/preview
```

The supported preview formats are:

- `summary` — a before/after delta; this is the default
- `workbench` — the complete snapshot that would be persisted
- `bundle` — the publication-ready STIX bundle
- `filesystemstore` — reserved but currently returns `501 Not Implemented`

The existing Angular flow requests `format=workbench` and then reads summary
fields such as `next_version_minor` and `staged_count`. Those are different
representations and must not be mixed.

Recommended interaction:

1. Ask the operator to choose `major`, `minor`, or an exact version.
2. Request `format=summary` using that selector.
3. Render the returned `version`, `before`, `after`, `changes`, and
   `conflicts`.
4. Optionally let the operator inspect `format=workbench` or `format=bundle`
   using the same selector.
5. Commit the release using the same selector only after confirmation.

The summary contains the planned `version`; it does not return separate
`next_version_minor` and `next_version_major` fields.

Done when:

- The confirmation dialog is driven by a `summary` response.
- Workbench and bundle previews are treated as literal payloads, not deltas.
- The preview and commit always use the same target snapshot and version
  selector.

### [ ] Render standard and virtual summaries differently

Standard and virtual snapshots share the preview endpoint, but their deltas
answer different questions.

For a standard track:

- `before` is the selected draft.
- `after` is the would-be release after staged objects become members.
- Counts are oriented around `members_count`, `staged_count`, and
  `candidates_count`.

For a virtual track:

- `before` is the tagged release immediately preceding the selected draft.
- `after` is the selected, already-materialized virtual draft.
- Counts are oriented around `members_count` and `quarantine_count`.
- `previous_release` identifies the comparison baseline when one exists.
- `changes` can include `new_count`, `updated_count`, `removed_count`, and
  `quarantined_count`.

Virtual release does not promote staged objects because virtual tracks do not
have a staged tier. Avoid showing zero-valued staged/candidate statistics as
though they described the virtual workflow.

Done when:

- Summary rendering branches on the top-level `type`.
- Standard previews explain staged-to-member promotion.
- Virtual previews explain the delta from the preceding tagged release.
- A first virtual release handles `previous_release: null` cleanly.

## P0 — Represent virtual materialization state

### [ ] Show when a virtual draft is awaiting materialization

Saving a new virtual composition now invalidates the preceding materialized
contents. The new latest draft intentionally has:

```json
{
  "type": "virtual",
  "members": [],
  "quarantine": [],
  "composition_resolution": null
}
```

This does not mean that the composition resolved to an empty release. It means
the composition has changed and the operator must explicitly materialize a new
draft with:

```text
POST /api/release-tracks/:id/virtual/snapshots/create
```

Until that succeeds, shared release preview and release commit endpoints return
`409 Conflict`.

Required work:

- Treat `type === 'virtual' && composition_resolution == null` as “awaiting
  materialization.”
- Show an explanatory state rather than an ordinary empty-members view.
- Disable release actions and make “Create Draft” the primary next action.
- After a composition update, refresh both the latest snapshot and history so
  the newly invalidated draft is visible.
- Surface a helpful error when a component track has no tagged snapshots. A
  virtual materialization can only consume tagged `members` from its component
  standard tracks.

Done when:

- Operators cannot accidentally interpret an unmaterialized draft as a valid
  empty virtual release.
- A `409` from preview/release explains that materialization is required
  instead of being swallowed as a null preview.

### [ ] Keep standard workflow controls out of virtual tracks

Virtual membership has one authority: composition materialization followed by
optional quarantine resolution. Hide candidate and staged controls when
`type === 'virtual'`; keep them available for standard tracks on their current
routes.

Done when:

- A virtual-track screen does not offer actions the server will reject because
  they belong to the standard workflow.

## P0 — Consume snapshot history as summaries

### [ ] Type and paginate the snapshot-history response

`GET /api/release-tracks/:id/snapshots` returns a paginated envelope:

```json
{
  "data": [],
  "pagination": {
    "total": 0,
    "limit": 50,
    "offset": 0
  }
}
```

Supported query parameters are:

- `tagged=true` — tagged releases only
- `tagged=false` — untagged drafts only
- omit `tagged` — both; this is the no-filter default
- `limit` — 1 through 200, default 50
- `offset` — zero or greater

The current connector discards `pagination`, accepts no filters, and contains
fallback normalization for older response shapes. Replace that compatibility
logic with the explicit envelope. Otherwise tracks with more than 50
snapshots are silently truncated.

Done when:

- The connector accepts `tagged`, `limit`, and `offset`.
- The component retains pagination metadata and supports paging or loading
  more results.
- There is a clear UI control for all snapshots, releases only, and drafts
  only.

### [ ] Use the type-oriented snapshot summary fields

Snapshot history entries are lightweight summaries, not full snapshots. All
entries include:

```text
id, type, modified, version, name, description, members_count
```

Standard entries additionally include:

```text
staged_count, candidates_count
```

Virtual entries additionally include:

```text
quarantine_count
```

These counts are top-level fields. They are not nested beneath `summary`, and
the history endpoint does not return the tier arrays needed to derive object
deltas. The current `buildSnapshotHistory()` logic therefore reports zero for
several values and should not calculate “Added” or “Modified” by comparing
missing member arrays.

Required work:

- Define a discriminated union keyed by `type: 'standard' | 'virtual'`.
- Read the top-level count fields directly.
- Show standard counts as members/staged/candidates.
- Show virtual counts as members/quarantine.
- If the design still needs per-object added/updated/removed deltas, retrieve
  an appropriate release summary or full snapshots explicitly rather than
  inferring them from the lightweight list response.

Done when:

- Snapshot cards display accurate counts for both track types.
- No history calculation assumes the list response contains `members`,
  `staged`, `candidates`, or `quarantine` arrays.

## P1 — Add the virtual quarantine-resolution workflow

### [ ] Let an operator select an exact quarantined revision

The backend now provides:

```text
POST /api/release-tracks/:id/virtual/quarantine/promote
```

Request body:

```json
{
  "object_ref": "attack-pattern--11111111-1111-4111-8111-111111111111",
  "object_modified": "2024-02-01T10:00:00Z"
}
```

The `(object_ref, object_modified)` pair must exactly match an entry in the
latest virtual snapshot's quarantine tier. On success, the server creates a
new draft, places the selected revision in `members`, removes every
quarantined alternative for that object, and preserves the original snapshot
for history and provenance.

Suggested UI:

- Group quarantine entries by `object_ref`.
- Show every conflicting revision, its modified timestamp, and any available
  source/component context.
- Require the operator to choose one exact revision.
- Confirm that the other alternatives will be removed from the new draft.
- Refresh the latest snapshot and history after success.

Error behavior:

- `400` — malformed body or the target track is not virtual
- `404` — that exact revision is no longer quarantined in the latest snapshot

A `404` is often a stale-screen condition. Refresh the latest snapshot and ask
the operator to review the current alternatives rather than retrying the old
selection automatically.

Done when:

- Each quarantined conflict has an explicit resolution action.
- The request always includes both the STIX ID and exact modified timestamp.
- Successful promotion updates members, quarantine, and snapshot history in
  the UI.

## P1 — Expose implemented virtual component filters

### [ ] Add plural `filters.domains` to component-track editing

Virtual composition can filter the exact revisions contributed by each
component track:

```json
{
  "filters": {
    "object_types": ["intrusion-set", "malware"],
    "domains": ["enterprise", "mobile"]
  }
}
```

Both public domain names (`enterprise`, `ics`, `mobile`) and their STIX names
(`enterprise-attack`, `ics-attack`, `mobile-attack`) are accepted. Prefer the
short public names in Angular controls for consistency.

The key is plural: `domains`. Do not send `filters.domain`; that typo does not
enable filtering. The backend now rejects that typo with `400 Bad Request`.

Objects without domain metadata are excluded when a domain filter is active.
This is expected behavior, not a partial match.

Composition payloads are strict at every nested level. Do not preserve
frontend-only properties in the submitted composition, component, filter, or
deduplication objects. Component selector fields must also follow the selected
strategy:

- `latest_tagged` and `latest_draft` send neither `version` nor `snapshot`.
- `specific_version` sends `version` and omits `snapshot`.
- `specific_snapshot` sends `snapshot` and omits `version`.
- Every component sends a unique, non-negative integer `priority`; lower
  numbers have higher priority.

The server validates component identity during both creation and update.
Referenced tracks must already exist and must be standard tracks, and duplicate
component track IDs are rejected. Do not offer virtual tracks in a component
selector.

Virtual tracks are purely compositional. Do not expose candidate, staged,
direct-member, or `native_members` controls for them. If operators need
aggregate-specific content, direct them to create or select a standard
component track that owns that content.

Done when:

- Each virtual component row can select zero or more domains.
- Saved and reloaded composition preserves `filters.domains`.
- Tests assert the plural key and multi-domain payload shape.
- Changing resolution strategy clears the selector from the previous strategy.
- Every component row requires a priority, and duplicate priorities or track
  selections are blocked before submission.
- Component selectors list standard tracks only.
- Virtual-track forms never submit `native_members` or direct membership
  fields.
- Submitted composition payloads contain only server-supported properties.

## P1 — Treat virtual snapshot members as exact revision pins

### [ ] Remove any lazy-resolution assumptions from virtual snapshot views

Virtual composition is completed when
`POST /api/release-tracks/:id/virtual/snapshots/create` succeeds. The returned
draft directly contains `members`, `quarantine`, and
`composition_resolution`; every tier entry has an exact `object_ref` and
`object_modified` timestamp.

Do not send a `resolve` query parameter and do not expect a
`resolved_content` response wrapper. Shared workbench retrieval returns the
persisted tier arrays directly. A component's `track_latest` policy may move
pins in newer standard-track drafts, but it cannot change a previously
materialized virtual snapshot.

The `latest` path segment selects the newest release-track snapshot; it does
not mean “resolve every member to its latest object revision.” If the track has
not acquired another snapshot, repeated `/snapshots/latest` calls identify the
same primary revision set.

Bundle downloads now replay the relationship/secondary graph captured when
the snapshot was created. The generated bundle-envelope ID may change, but
the object graph for a materialized virtual snapshot is stable.

Done when:

- Virtual views read `members` and `quarantine` directly from the snapshot.
- No connector or model exposes `resolve` or `resolved_content`.
- Member links and comparison keys use both `object_ref` and
  `object_modified`.
- Tests prove that advancing a component after materialization does not change
  the displayed virtual member revision.
- User-facing export guidance distinguishes a stable snapshot object graph
  from the intentionally variable bundle-envelope UUID.

## P1 — Submit mode-correct virtual snapshot schedules

### [ ] Add conditional validation and complete the dates-mode UI

`snapshot_schedule` is virtual-only and now has a strict discriminated
contract:

```ts
type SnapshotSchedule =
  | { mode: 'manual' }
  | { mode: 'cron'; cron: string }
  | { mode: 'dates'; dates: string[] };
```

The modes are mutually exclusive. Do not retain hidden form values when the
mode changes: `manual` sends neither selector, `cron` sends only a valid
five-field cron expression, and `dates` sends only a nonempty array of ISO
timestamps. Standard-track payloads must omit `snapshot_schedule`.

The current dialog already lists `dates`, but it has no date controls and
therefore submits only `{ mode: 'dates' }`, which the server rejects. The cron
control is also not conditionally required, allowing `{ mode: 'cron' }` to be
submitted.

Automatic creation is now active when the backend scheduler is enabled.
Explain that cron and dates use UTC, cron occurrences are not backfilled after
downtime, and due dates are recovered after restart. A component-resolution
failure is retried by the backend; the UI does not need to resubmit the
schedule.

Virtual drafts may include per-snapshot materialization metadata:

```ts
scheduled_materialization?: {
  schedule_mode: 'cron' | 'dates';
  scheduled_for: string;
};
```

Clients may send this strict shape during `POST /api/release-tracks/new` for a
virtual track, `PUT /api/release-tracks/:id/virtual/composition`, and
`POST /api/release-tracks/:id/virtual/snapshots/create`. Include it only when
deliberately attaching the occurrence to the new snapshot; later snapshot
mutations do not inherit it. Standard tracks must omit it. Read it from track
listing, snapshot history, latest snapshot, or timestamp-selected snapshot
responses.

Done when:

- Selecting cron makes a valid cron expression required and clears dates.
- Selecting dates exposes date controls, requires at least one value, emits
  ISO timestamps, and clears cron.
- Selecting manual clears both selector fields.
- Standard-track creation never sends schedule metadata.
- Tests cover all three modes and mode switching.
- User-facing copy explains UTC execution and the difference between cron and
  restart-recoverable dates.
- Virtual create and composition update forms can deliberately submit
  `scheduled_materialization`, and all supported GET representations tolerate
  and preserve it.

## P1 — Align virtual component object-type filters

### [ ] Use the complete canonical Workbench STIX type vocabulary

The backend now validates `composition.component_tracks[].filters.object_types`
against its canonical STIX type registry. When `object_types` is present, it
must be a nonempty array of unique, case-sensitive STIX type names. Omit the
property to include all types; do not send an empty array.

The create dialog already removes the property when the user has no
selections, and `mat-select` naturally prevents duplicates. Its current
hard-coded options are only a subset of the server vocabulary, however. They
omit `identity`, `marking-definition`, `note`, `relationship`,
`x-mitre-collection`, and `x-mitre-data-source`.

Done when:

- Creation and composition editing use the same complete canonical option
  list.
- Clearing all selections removes `object_types` from the submitted filter.
- Unknown values loaded from stale local state are rejected or removed before
  submission.
- Tests cover the complete option list and clearing the filter.

## P1 — Distinguish virtual duplicates from revision conflicts

### [ ] Align resolution metrics and fixtures with deterministic deduplication

Virtual materialization now reports duplicate contributions and revision
conflicts as related but different concepts:

- `composition_resolution.deduplication.duplicates_found` counts STIX object
  IDs contributed by more than one component, even when every component
  supplies the same exact revision.
- `conflicts_resolved` contains only object IDs with genuinely different
  `object_modified` revisions.
- An exact revision shared by multiple components produces one member and is
  never quarantined.
- Each member is attributed to exactly one component. Consequently, the sum of
  `component_snapshots[].objects_contributed` equals
  `composition_resolution.summary.total_objects`.

The current page already displays separate duplicate and conflict counters.
Preserve that distinction instead of assuming the two counts are equal.

Done when:

- Resolution fixtures include an identical revision shared across components
  and a separate object with conflicting revisions.
- Duplicate and conflict counters render their respective backend fields.
- Component contribution counts add up to the resolved member total.
- Quarantine views never show repeated copies of the same exact revision.

## P1 — Model and display immutable virtual release provenance

### [ ] Type `component_versions` and resolve component display names

Virtual release history entries now include:

```ts
component_versions?: Record<string, string | null>;
```

Each key is an immutable component release-track ID and each value is the
tagged component version or `null` for a draft source, frozen in the virtual draft's
`composition_resolution`. The map is present only for virtual releases;
standard release history entries omit it. Component display names are
deliberately not used as keys because names can change or collide.

The `VersionHistoryEntry` interface types this property as
`Record<string, string | null>`. Display null values as **Draft** and pair
each track ID with the matching
`composition_resolution.component_snapshots[].track_name` from the same
released snapshot while retaining the ID as the authoritative identity.

Do not fetch each component's latest release to construct this display. A
component may have advanced after virtual materialization; the embedded map is
the release's immutable provenance and must remain unchanged.

Done when:

- `component_versions` is strongly typed as an optional track-ID-to-version
  map.
- Standard release-history fixtures omit the property.
- Virtual workbench preview and committed-release fixtures include the same
  map.
- Any user-facing labels resolve names from the released snapshot's embedded
  composition metadata and fall back to the track ID.
- Tests prove that a component's newer current release does not replace the
  version shown for an older materialized virtual draft.

## P1 — Separate snapshot and preview output-format types

### [ ] Remove the invalid `snapshot` format and model `summary` correctly

The frontend currently uses one `ExportFormat` enum for endpoints with
different contracts and includes `Snapshot = 'snapshot'`, which the server
rejects.

Use separate types:

```ts
type SnapshotOutputFormat = 'workbench' | 'bundle' | 'filesystemstore';

type ReleasePreviewFormat = 'summary' | 'workbench' | 'bundle' | 'filesystemstore';
```

`filesystemstore` should remain disabled or clearly marked unavailable until
the server implementation exists.

For workbench snapshot retrieval, `include` may select `members`, `staged`,
`candidates`, `quarantine`, or `all`. Ensure virtual inspection can request
quarantine and that the type does not restrict `include` to standard tiers.

Done when:

- Angular cannot send `format=snapshot`.
- `summary` is available only where the release-preview endpoint supports it.
- Virtual workbench retrieval can include quarantine.

## P1 — Update frontend tests around the public contract

### [ ] Replace stale fixtures and add standard/virtual lifecycle coverage

Update connector, component, and integration tests together so old mock shapes
do not keep obsolete behavior alive.

Minimum regression coverage:

- Canonical latest retrieval uses `/snapshots/latest`.
- Snapshot history preserves `{ data, pagination }` and supports `tagged`.
- Release preview uses `GET`, `format=summary`, and query-based version
  selection.
- Release commit uses `{ increment }` or `{ version }`.
- Latest and timestamp-selected releases use the same contract.
- Virtual composition and materialization use `/virtual/` paths.
- The removed virtual snapshot-preview method is absent.
- An unmaterialized virtual draft disables release and explains a `409`.
- Standard and virtual summary fixtures use their respective count fields.
- Quarantine promotion sends an exact object revision and handles stale `404`
  responses.
- The frontend never offers standard-only contents/candidate/staged mutations
  on a virtual track.

## Deterministic bundle cache controls

`GET /api/release-tracks/:id/snapshots` includes the opaque
`graph_manifest_id` on summaries whose tagged snapshot has a materialized
member graph. The History tab should translate that technical state into a
user-oriented bundle cache:

- Show **Bundle cached** with a success indicator when `graph_manifest_id` is
  present.
- Show **Not cached** with a warning icon otherwise. Explain that member-only
  bundle exports are not guaranteed to be deterministic until cached.
- Offer **Cache bundle** only for uncached tagged snapshots and editors. It
  calls `POST /api/release-tracks/:id/snapshots/:modified/graph`.
- Use the existing indeterminate Material spinner while a cache operation is
  in progress. Cached snapshots offer editors a confirmed **Delete cache**
  action backed by `DELETE /api/release-tracks/:id/snapshots/:modified/graph`.
- For cached snapshots, render the accompanying `graph_statistics` in a
  compact **Graph cache** panel: Primary, Secondary, Relationships, and
  Dependencies. Dependencies is the sum of supporting and LinkById entries;
  show `total_count` as the overall cached-item count.
- Refresh snapshot history after cache creation or deletion so server-derived
  state and statistics are visible immediately.
- Drafts remain uncached and must be tagged first. Candidate and staged
  exports remain live even when the member graph is cached.
- Treat `graph_manifest_id` as an opaque read-only signal; never send or
  persist a client-authored value.

“Cache” is deliberately presentation language, not an implementation claim
about HTTP response caching. Tooltips should retain the member-only and
determinism qualifiers so users do not infer broader guarantees.

## Backend changes that do not require Angular API changes

The following changes are useful context but should not create extra connector
work:

- Snapshot bundle exports include bounded secondary objects and their
  relationships. Materialized schema-v2 graphs retain exact revision pointers
  while graphless exports resolve live. A standard draft tier explicitly
  stored as `"latest"` remains dynamic until release.
- Release-track object back-references are reconciled when snapshots change.
  Frontend object refreshes will see the updated membership metadata without a
  new endpoint.
- The server intentionally does not require
  `expected_snapshot_modified`. Do not add a client-side precondition field.
- Virtual release preview and release use the same shared routes as standard
  tracks after materialization; do not create separate virtual release
  endpoints.
