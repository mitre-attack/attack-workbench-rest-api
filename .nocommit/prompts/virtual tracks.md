Virtual tracks sync from candidate tracks. Candidate tracks are just standard (non-virtual) release tracks.

Virtual tracks must target a specific tier for each candidate track. Virtual tracks can sync from a candidate tracks `members`, `staged` or `candidates` list, but not a combination.

Virtual tracks must each define a resolution policy to handle deduplication, which is to say: users must specify how virtual tracks should handle objects that exist in multiple candidate tracks. Here are some possible ideas:

1. Prioritize newer object: Keep the newest version of the object, as defined by the object's `modified` timestamp.
2. Prioritize newer snapshot: Keep whichever version of the object came from the newest snapshot, as defined by the snapshot's `modified` timestamp. Note that this strategy makes it possible to sync older copies of an object!
3. Prioritize candidate priority: Keep whichever version of the object came from the higher priority candidate track. This would entail making it possible for users to specify which candidate tracks should be prioritized; for example:
```
  composition: {
    component_tracks: [
      {
        track_id: "release-track--uuid-1",
        resolution_strategy: "latest_tagged",
        priority: 1,
        filters: {
          object_types: ["intrusion-set"],
          // Additional filters...
        }
      },
      {
        track_id: "release-track--uuid-2",
        resolution_strategy: "latest_tagged",
        priority: 2,
        filters: {
          object_types: ["attack-pattern"]
        }
      }
    ],
```
4. Quarantine: Don't include either permutation. Instead, store both versions of the object as `candidates` in the virtual track. This will give the users the opportunity to review and decide which one to promote.

The last point brings up another important topic about the promotion process. There are three tiers of membership:

- `members`: cannot include duplicate objects. Cannot include multiple versions of the same object, as defined by the objects' `(id, modified)` pair.
- `staged`: same thing as members
- `candidates`: Cannot include duplicate objects. CAN include multiple versions of the same object. 

We need to define what happens if the release track tries to promote an conflicting object from `candidates` to `staged`:
  - **Always overwrite**: This mode preserves the incoming object. 
  - **Prefer reject**: This mode rejects the incoming object/preserves the incumbent object.
  
An additional setting/mode is supported when objects are being promoted from `staged` to `members`; recall that this particular promotion path can only be done when a snapshot is being tagged/released (i.e., `POST /api/release-tracks/:id/bump`). Importantly, once a snapshot is tagged/released, it becomes immutable. Therefore, we need to provide additional guardrails to ensure that the release process goes smoothly. Thus, in addition to the two aforementioned settings (`always-overwrite` and `always-reject`), an additional "abort" setting is supported for the release/tagging operation: 
  - **Abort**: If there is a conflict between an incumbent object in `members` and an incoming object, reject/abort the entire release/tagging operation. An immutable snapshot will not be created. Notify the user what caused the failure.

---

On second thought, I think we need to make some modifications:

DEDUPLICATION POLICY/STRATEGY FOR VIRTUAL TRACK SYNCING:

Virtual tracks may only sync/pull from each candidate track's `members` list. Given that virtual tracks may only sync from tagged/release snapshots, this makes perfect sense.

Virtual tracks support two object tiers: `members` and `quarantine`. 
    - `quarantine` is for objects that couldn't be reconciled during the sync/pull operation (i.e., duplicate objects). 
    - `members` contains everything that was synced from the release track's candidate tracks.

During a sync operation, conflicts may occur -- it's possible that a virtual track contains an object with conflicts with an object in one of its candidate tracks. In such situations, virutal track sync dictate how to proceed. They are defined as follows:

  1. **Prioritize latest object**: Keep the newest version of the object, as defined by the object's `modified` timestamp.
  2. **Prioritize latest snapshot**: Keep whichever version of the object came from the newest snapshot, as defined by the snapshot's `modified` timestamp. Note that this strategy makes it possible to sync older copies of an object!
  3. **Prioritize higher priority**: Keep whichever version of the object came from the candidate track with the higher priority. When a candidate track is added to a virtual track, the user must specify a numerical value specifying its priority. Candidate tracks may not have the same priority level. For example:
  ```javascript
    composition: {
      component_tracks: [
        {
          track_id: "release-track--uuid-1",
          resolution_strategy: "latest_tagged",
          priority: 1,
          filters: {
            object_types: ["intrusion-set"],
            // Additional filters...
          }
        },
        {
          track_id: "release-track--uuid-2",
          resolution_strategy: "latest_tagged",
          priority: 2,
          filters: {
            object_types: ["attack-pattern"]
          }
        }
      ],
  ```
  1. Quarantine: Don't include either permutation. Instead, store both versions of the object in the virtual track's `quarantine`. This will give the users the opportunity to review and decide which one to promote. The objects will remain in quarantine until manual user intervention occurs.

DEDUPLICATION POLICY/STRATEGY FOR PROMOTIONS IN STANDARD TRACKS:

A promotion constitutes moving an object from `candidates` to `staged` or from `staged` to `members`. Promotions can occur in three ways:

  - **Manually** via REST API endpoint
  - Via **auto-promotion** policy (e.g., an object transitions from `work-in-progress` to `awaiting-review` and the release track's `candidacy_threshold` is set to `awaiting-review`, therefore auto-promotion will promote the object to `staged`).
  - Via **tagging/release/bump operations**

The following policies can be used to reconcile promotion conflicts in standard tracks for any of the 3 aforementioned situations:

  - **Always overwrite**: This mode preserves the incoming object.
  - **Always reject**: This mode rejects the incoming object/preserves the incumbent object. The rejected object is kept in `candidates`.
  - **Prefer latest**: The object with the newer `modified` timestamp is kept.
  - **Abort**: If there is a conflict between an incumbent object in `members` and an incoming object, reject/abort the entire release/tagging operation. An immutable snapshot will not be created. Notify the user what caused the failure.

