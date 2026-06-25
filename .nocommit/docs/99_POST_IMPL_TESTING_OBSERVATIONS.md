# Observations

```httpie
echo '{
  "from": "work-in-progress",
  "to": "awaiting-review",
  "object_refs": [
    "attack-pattern--008b8f56-6107-48be-aa9f-746f927dbb61",
    "attack-pattern--063b5b92-5361-481a-9c3f-95492ed9a2d8"
  ]
}' |  \
  http POST http://localhost:3000/api/release-tracks/release-track--e4e3b098-5755-4525-814b-26fc16beab87/candidates/review \
  authorization:'Basic dGF4aWktc2VydmVyOnNlY3JldC1zcXVpcnJlbA==' \
  content-type:application/json \
  cookie:'{{AUTH_COOKIES}}'
```

The 'Bulk transition candidate workflow status' endpoint (and possibly others) will blindly create new release-track snapshots/documents even when no objects (members, staged, candidates) are modified.
We should change the behavior to only create a new document when something actually changes.
A new snapshot/document should NOT be created if no keys/properties are modified. Thus, no new snapshots should be identical.

Additionally, when a new snapshot/document is created, a summary of the change should be captured in `version_history`.
The first element in the `version_history` list should explain what triggered the document to be created. 
The purpose is to minimize guesswork in generating delta descriptions between snapshots. For instance, a developer may be trying to ascertain how a release track evolved over time; and without the proposed change summary, the developer would have to compute document diffs for each successive pair of snapshots that exists for a given release track.
A given snapshot's `version_history` should thus describe every operation, since the release track's inception, that has been made up to the given snapshot, constituting a causal events chain, or histogram, of how the snapshot came to be.   

---

**RESOLVED:**

When I trigger the tag/bump operation for a snapshot which contains a conflict that blocks the release from occurring, the response body only shows the first error that triggered a conflict. Here is an example response body:
```json
{
  "track_id": "release-track--e4e3b098-5755-4525-814b-26fc16beab87",
  "snapshot_modified": "2026-02-03T19:20:04.591Z",
  "is_already_tagged": false,
  "current_version": null,
  "next_version_minor": "19.1",
  "next_version_major": "20.0",
  "staged_count": 3,
  "members_count": 2,
  "candidates_count": 0,
  "conflict_error": "Conflict on attack-pattern--008b8f56-6107-48be-aa9f-746f927dbb61: abort policy prevents promotion"
}
```
In the above response body, we see 1 object that prevents promotion:
```
"conflict_error": "Conflict on attack-pattern--008b8f56-6107-48be-aa9f-746f927dbb61: abort policy prevents promotion"
```
But there are potentially many conflicts! For example, consider the following snapshot (represented here as a Mongo Document):
```
{
  "_id": {
    "$oid": "69824a64ee981bdd17cefc7a"
  },
  "id": "release-track--e4e3b098-5755-4525-814b-26fc16beab87",
  "type": "standard",
  "modified": {
    "$date": "2026-02-03T19:20:04.591Z"
  },
  "version": null,
  "name": "Updated Track Name",
  "description": "Updated description",
  "created": {
    "$date": "2026-02-03T16:05:44.429Z"
  },
  "created_by_ref": "identity--69d554cd-8ce0-41d0-8aef-502a821525f1",
  "members": [
    {
      "object_ref": "attack-pattern--008b8f56-6107-48be-aa9f-746f927dbb61",
      "object_modified": {
        "$date": "2025-04-15T19:58:01.218Z"
      }
    },
    {
      "object_ref": "attack-pattern--063b5b92-5361-481a-9c3f-95492ed9a2d8",
      "object_modified": {
        "$date": "2025-04-15T19:58:03.170Z"
      }
    }
  ],
  "staged": [
    {
      "object_ref": "attack-pattern--008b8f56-6107-48be-aa9f-746f927dbb61",
      "object_modified": {
        "$date": "2025-04-15T19:58:01.218Z"
      },
      "object_status": "work-in-progress",
      "object_staged_at": {
        "$date": "2026-02-03T19:20:04.591Z"
      },
      "object_staged_by": "identity--69d554cd-8ce0-41d0-8aef-502a821525f1"
    },
    {
      "object_ref": "attack-pattern--063b5b92-5361-481a-9c3f-95492ed9a2d8",
      "object_modified": {
        "$date": "2025-04-15T19:58:03.170Z"
      },
      "object_status": "work-in-progress",
      "object_staged_at": {
        "$date": "2026-02-03T19:20:04.591Z"
      },
      "object_staged_by": "identity--69d554cd-8ce0-41d0-8aef-502a821525f1"
    },
    {
      "object_ref": "attack-pattern--097924ce-a9a9-4039-8591-e0deedfb8722",
      "object_modified": {
        "$date": "2025-04-16T21:26:10.077Z"
      },
      "object_status": "work-in-progress",
      "object_staged_at": {
        "$date": "2026-02-03T19:20:04.591Z"
      },
      "object_staged_by": "identity--69d554cd-8ce0-41d0-8aef-502a821525f1"
    }
  ],
  "candidates": [],
  "config": {
    "candidacy_threshold": "reviewed",
    "auto_promote": true,
    "promotion_conflicts": {
      "candidates_to_staged": "prefer_latest",
      "staged_to_members": "abort"
    }
  },
  "version_history": [
    {
      "version": "19.0",
      "tagged_at": {
        "$date": "2026-02-03T18:26:11.653Z"
      },
      "tagged_by": "identity--69d554cd-8ce0-41d0-8aef-502a821525f1",
      "snapshot_id": {
        "$date": "2026-02-03T17:16:02.895Z"
      },
      "summary": {
        "members_count": 2,
        "promoted_count": 2,
        "staged_count": 2,
        "candidate_count": 0
      }
    }
  ],
  "__v": 0
}
```

The response body correctly shows that STIX object "attack-pattern--008b8f56-6107-48be-aa9f-746f927dbb61" is in conflict with the `config.promotion_conflicts.staged_to_members` policy. But it fails to show the sme for STIX object "attack-pattern--063b5b92-5361-481a-9c3f-95492ed9a2d8".

The response body should contain a comprehensive list of all conflicts that prevent promotion, not just the first one that the service detected.

To resolve this:

1. First read all of the concept/specification documentation for the "release track" feature in `docs/COLLECTIONS_V2/*.md`. Determine the optimal place to document this new behavior. Do we need to update any data structures in `06_ENTITIES.md`? Do we need to amend any intended conflict resolution behavior at `05_RELEASE_WORKFLOW.md#4-abort-taggingrelease-operations-only`? Importantly, before we modify the code, we must ensure that the concept documentation, which is the ultimate source of truth, is up-to-date.
2. Make the appropriate changes to the code base. For an overview of the release-track service architecture, see `docs/COLLECTIONS_V2/99_IMPLEMENTATION_PLAN.md`.

---

**OBSERVATION**:

There might appear to be a bug in the bulk status transition endpoint -- but it's not!

```{{host}}/api/release-tracks/:id/candidates/review```

When you transition all candidates with object status `work-in-progress` to `reviewed` in a release track whose `config.candidacy_threshold` is `reviewed` and `config.auto_promote` is `true`, the operation will succeed and, unintuitively, trigger TWO document creations in the database.

The first document that is created fulfills the endpoint operation. All target candidates have statuses changed from `work-in-progress` to `reviewed`. But importantly, they're still candidates!

The second document that is created fulfills the auto-promotion configuration. Because the objects surpassed the candidacy threshold, the system will automatically promote them from `candidates` to `staged`. This coincides with yet another document creation.

Importantly, the second document is the one that gets returned to the user in the response body.

---

During development period (before STIX freeze):

```json5
{
  "candidacy_threshold": "awaiting-review",
  "auto_promote": true,

  "promotion_conflicts": {
    "candidates_to_staged": "prefer_latest",
    "staged_to_members": "abort"
  }
}
```

This will allow developers to continually push and update which objects are staged for the next release. Objects only get staged for the upcomign release if and when its marked as `reviewed`. 

Notably, the "release track owner" (concept not implemented yet) may make the `candidacy_threshold` more or less permissive. For example, it can be set to `awaiting-review` to allow objects that have not undergone a full review to still be queued up for the next release; or it can be set to `reviewed` to restrict the "staged" zone to *only* include objects that have beenf fully reviewed.

Once the team is approximately 1 month out from the release, the colloquial "STIX freeze" period begins. During this period, the team should be more restrictive about which changes can be queued up for the imminent release. Thus, I recommend the following release track config:

```json5
{
  "candidacy_threshold": "reviewed",
  "auto_promote": false,

  "promotion_conflicts": {
    "candidates_to_staged": "abort",
    "staged_to_members": "abort"
  }
}
```

What changed:

1. `candidacy_threshold` was changed from `awaiting-review` to `reviewed`
2. `auto_promote` was disabled
3. `promotion_conflicts.candidates_to_staged` was set to `abort`

This change will block `candidates` from moving into `staged`.

For last minute changes that need to get included in `staged`, users will need to set `promotion_conflicts.candidates_to_staged` to something other than `abort`. Additionally they should either:
(1) use the "Promote Candidates" endpoint (`{{host}}/api/release-tracks/:id/candidates/promote`) to manually promote candidates to staged... 
-OR-
(2) ...enable `auto_promote`, BUT be cautious/avoid marking candidates as `reviewed` during the STIX freeze, lest they be included in the release.


---

**DOCUMENTED IN [08_MEMBER_SYNC_STRATEGIES.md](./08_MEMBER_SYNC_STRATEGIES.md)**:
(but not implemented yet)

I want to make a change to how object candidacy is managed. At present, there are two "modes" for adding a candidate. Both are via the 'Add Candidates' endpoint (`POST {{host}}/api/release-tracks/:id/candidates`).

You can either add specific object versions via object `id` and `modified` keys, or you can add the latest version of an object, irrespective of its `modified` key. A request body might resemble the following:
```json5
{
  "object_refs": [
    // a static reference to a specific object revision
    {
     "id": "attack-pattern--008b8f56-6107-48be-aa9f-746f927dbb61",
      "modified": "$date"
    },
    // a dynamic reference to the latest object revision
    {
        "id": "attack-pattern--063b5b92-5361-481a-9c3f-95492ed9a2d8",
        "modified": "latest"
    },
    // a dynamic reference to the latest object revision
    "attack-pattern--097924ce-a9a9-4039-8591-e0deedfb8722"
  ]
}
```
The latest revision of any given object can be dyanmically referenced by either passing it's `id` as a string literal element, or by setting `modified` to `latest`, e.g.,`{ id, modified: "latest" }`.

The problem with this approach is that it fails to account for what happens after a release occurs: When a release occurs, all `staged` objects are merged into `members`, and `staged` is emptied. Users continue making revisions to `members`, but because `staged` has been emptied, there are no more dynamic references ensuring that future revisions get pulled in to the next release. Thus, users must remember to "queue up" their object revisions by hitting the 'Add Candidates' endpoint for each object they edit after the previous release. Intuitively, a user might expect that once an object is included in a release track's `members` list, all future revisions will automatically get queued up in `candidates`! Unfortunately, this is not the case.

Thus, I would like to modify the system to support different "sync strategies" for object references in release tracks. Let's talk through various dimensions of the sync strategy, grounded with some mock/pseudo structures. 

Here is the initial state:

```yaml
# We have one object with 2 revisions stored in the database:
objects:
    - id: attack-pattern1
      modified: 2025-01-01 # We'll refer to this revision as v25
    - id: attack-pattern1
      modified: 2026-01-01 # We'll refer to this revision as v26
# We have one release track:
release-track1:
    # The release track has 1 snapshot:
    snapshots:
        # The following snapshot is a release snapshot. In it, attack-pattern1 version-2025 (hereinafter "v25" ) has been released
        - type: release
          candidates: []
          staged: []
          members:
            - obj_ref: attack-pattern1
              obj_modified: 2025-01-01
```

We need to first consider: what happens when v26 is created?

A. Automatically add the v26 revision to `candidates` (resulting in a new draft snapshot)
B. Do nothing (i.e., expect the user to manually add v26 to `candidates`)

Option A would yield a new draft snapshot like the following:

```yaml
# We have one release track:
release-track1:
    # The release track has 2 snapshots:
    snapshots:
        # The following snapshot is a release snapshot. In it, attack-pattern1 version-2025 (hereinafter "v25" ) has been released
        - type: release
          candidates: []
          staged: []
          members:
            - obj_ref: attack-pattern1
              obj_modified: 2025-01-01
        - type: draft
          candidates:
            - obj_ref: attack-pattern1
              obj_modified: 2026-01-01
          staged: []
          members:
            - obj_ref: attack-pattern1
              obj_modified: 2025-01-01
```

We also need to consider the scenario where a revision already exists in `candidates` or `staged` at the time a new object revision is created:

```yaml
# We have one object with 3 revisions stored in the database:
objects:
    - id: attack-pattern1
      modified: 2025-01-01 # We'll refer to this revision as v25
    - id: attack-pattern1
      modified: 2026-01-01 # We'll refer to this revision as v26
    - id: attack-pattern1
      modified: 2027-01-01 # We'll refer to this revision as v27
# We have one release track:
release-track1:
    # The release track has 2 snapshots:
    snapshots:
        # The following snapshot is a release snapshot. In it, v25 has been released
        - type: release
          candidates: []
          staged: []
          members:
            - obj_ref: attack-pattern1
              obj_modified: 2025-01-01
        # The following snapshot is a draft snapshot. In it, v26 has been reviewed and auto-promoted to `staged`
        - type: draft
          candidates: []
          staged:
            - obj_ref: attack-pattern1
              obj_modified: 2026-01-01
              obj_status: 'reviewed'
          members:
            - obj_ref: attack-pattern1
              obj_modified: 2025-01-01
```

We again need to consider what should happen when v27 is created? The dimensions of consideration are:

1. Should v26 supplant v27 or not?
2. If v27 supplants v26, should it be added to `candidates` or `staged`?
3. If v27 supplants v26, should it be marked as `work-in-progress` (status reset) or `reviewed` (status preserved)?

Tangential to these considerations is:

1. How do we map the aforementioned dimensions to configuration options?
2. Where do we map such configuration options? If we store them on each object ref (in `candidates`, `staged`, and `members`), then we have maximum flexibility, but perhaps too much overhead. If we configure these options globally for the entire release track, we have minimal flexibility, but optimal predictability and ease of use.

Please reason through this problem and propose a comprehensive solution. Don't worry about the code for now. The main priority is to settle on the desired functionality and document it in `docs/COLLECTIONS_V2/`. We'll deal with coding/implementation after we've fully planned the change.