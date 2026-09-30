# Snapshot creation causes

`creation_cause` is immutable, server-controlled metadata on each snapshot.
It identifies the operation that persisted that snapshot, not the operation
that later tagged it. The authoritative enum is
`app/lib/release-tracks/snapshot-creation-causes.js`; the frontend mirrors its
wire values and maps them to readable labels on Releases cards.

## Causes shared by standard and virtual tracks

| Value                   | Operation                                                 |
| ----------------------- | --------------------------------------------------------- |
| `track_created`         | Create a track and its initial empty draft                |
| `track_cloned`          | Copy a track from its latest or a selected snapshot       |
| `metadata_updated`      | Write track name or description                           |
| `configuration_updated` | Write track configuration, including publication settings |

## Standard-track causes

| Value                       | Operation                                                                 |
| --------------------------- | ------------------------------------------------------------------------- |
| `bundle_imported`           | Create a track from a STIX bundle, including a metadata-only import       |
| `release_tagged`            | Create a standard release snapshot, preserving its source draft           |
| `candidates_added`          | Add candidate pins; includes normalization-only writes in that operation  |
| `candidate_removed`         | Remove a candidate                                                        |
| `candidates_reviewed`       | Change candidate workflow status                                          |
| `candidates_promoted`       | Explicitly promote candidates to staged                                   |
| `candidate_version_updated` | Change a candidate's revision selector                                    |
| `staged_demoted`            | Move staged entries back to candidates                                    |
| `candidates_auto_promoted`  | Automatically promote qualifying candidates after add/review              |
| `member_synced`             | Synchronize an object change into a track according to member-sync policy |

Member sync includes newly created revisions, in-place changes to pinned
objects, revocations, and technique conversions. It can enroll, replace, or
queue pins. These are one snapshot-producing operation category. Events that
produce no write do not receive a new creation cause.

## Virtual-track causes

| Value                 | Operation                                                      |
| --------------------- | -------------------------------------------------------------- |
| `composition_updated` | Replace composition and reset materialized content             |
| `manual_snapshot`     | Explicitly materialize the composition                         |
| `scheduled_snapshot`  | Materialize with scheduled occurrence metadata (cron or dates) |
| `quarantine_promoted` | Resolve a quarantined revision into members                    |

The existing API also accepts scheduled occurrence metadata on explicit
materialization requests. Such requests receive `scheduled_snapshot`; this
field describes the materialization mode, not proof of scheduler identity.
Track creation and composition updates retain their own operation causes even
when their requests carry scheduled occurrence metadata.

## Persistence and response behavior

Creation and track-copy entry points set their own causes. Every production
caller of `cloneSnapshot` supplies a cause through its internal options; the
helper replaces inherited provenance after applying overrides. Client request
fields cannot select the cause. The Mongoose enum validates persisted values
and makes the field immutable. Snapshot latest/timestamp Workbench GETs and
paginated snapshot history expose the value. STIX bundle exports omit it.

Historical documents without provenance return `unknown`, displayed as
"Creation cause unavailable". No migration guesses old causes from current
content. New documents persist a value; low-level callers without explicit
provenance use `unknown` rather than inheriting a misleading source cause.

Virtual tagging, release rollback/retagging, editing draft notes, alias-only updates, manifest reconstruction,
deleting snapshots, and replacing registry-backed schedules do not themselves
create new snapshots. A subsequent operation may do so. In particular, the
frontend's Save Config flow saves the virtual schedule and then writes
publication configuration. That config write creates a draft labelled
"Configuration updated", even if the supplied config equals its prior value.
An actual scheduled materialization is labelled "Scheduled snapshot".

Standard tracks retain their latest rolling draft plus release sources and
drafts referenced by virtual provenance. This is provenance for each surviving
snapshot, not a complete event log. If auto-promotion
immediately replaces a candidate-add/review draft, the surviving snapshot is
labelled "Candidates automatically promoted". Tagged snapshots retain their
creation cause throughout their lifetime. Standard release creation persists a
separate snapshot labelled "Release tagged"; its retained source draft keeps
its earlier provenance. Rollback restores an existing source, so does not
invent a new creation cause or actor.

## Invoking user

`creation_actor` is an immutable snapshot-local object. Trusted invocation
context supplies `{ kind: 'user', user_account_id }`, system jobs use
`{ kind: 'system' }`, and unclassified/internal or historical writes use
`{ kind: 'unknown' }`. Creation, copying, and cloning replace any inherited
actor after overrides, independently of the original track's `created_by_ref`.
Request bodies cannot choose attribution. Member-sync events use the invoking
user in event options, never an object's historical creator. Auto-promotion
passes through the user who initiated add/review; the scheduler supplies no
user and is attributed to the system. An explicit HTTP materialization with
scheduled metadata still records the authenticated human.

Workbench GETs and history resolve distinct user IDs once per response through
the facade's existing user-enrichment path. Only ID, username, and display
name fields are exposed, not email, roles, or authentication metadata. Names
reflect the current account; missing accounts retain their persisted IDs.
The frontend uses the existing initials avatar and full display name for
users, "Automated" for system jobs, and "Creator unavailable" for unknown
attribution. No historical backfill guesses users from inherited track data.
