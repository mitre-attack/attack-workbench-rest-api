Please read the specification and concept documentation for the "release tracks" feature, which is actively in development, at `docs/COLLECTIONS_V2/`. Once you have a lay of the land, focus on helping me remove the `include_candidates_in_snapshots` property from the release-track schema, and update the application code and documentation accordingly. 

Context: 
We don't need to statefully track retrieval/export filter properties in the release-track config. It makes more sense to treat such filters as stateless query parameters that users can set during export operations. In other words, when users retrieve a release-track snapshot (draft or release), they should be able to specify or constrain the resultant snapshot to their liking.

There are several ways the user can export a release-track snapshot via simple Get/Retreive operations:

- Get Latest Snapshot: `GET /api/release-tracks/:id`
- Get Specific Snapshot: `GET /api/release-tracks/:id/snapshots/:modified`

Such retrieval endpoints should support two query parmeters:

- `include`: Allows users to filter/specify which tiers of objects will be included in the output:
  - If unset, only `members` are included
  - If `include=candidates`, then members and candidates are included
  - If `include=staged`, then members and staged are included
  - If `include=all`, then members,staged, and candidates are included

- `format`: Allows users to specify the output structure (DTO shape)
  - `bundle` (default): produces a standard STIX 2.1 bundle
  - `filesystemstore`: STIX FileSystemStore directory structure (will be implemented in a future release)
  - `workbench`: Custom format with workflow metadata for UI. This is meant to structure the data in as convenient a way as possible for the frontend to hydrate/render the content

Importantly, the `include` filter should NOT be supported by bump dry-runs operations (`POST /api/release-tracks/:id/bump` with `dry_run: true` in `req.body`), nor bump preview operations (`GET /api/release-tracks/:id/bump/preview`). Bump dry-runs and bump previews are meant to show the user what *will* happen when a bump occurs; filters will only confuse the user because they allow the user to ad-hoc transform the resultant release snapshot even though that ad-hoc transformation will not actually be reflected in the final release snapshot.

Please start by updating the specification and concept documentation in `docs/COLLECTIONS_V2/`. This folder contains the source of truth for how the release tracks feature operates.

Once the documentation reflects what we want, please familiarize yourself with the software design/architecture. The source code is located in the `app/` folder. Additionally, the following documentation files may help contextualize some critical aspects of the software design:

- `docs/EVENT_BUS_ARCHITECTURE.md`
- `docs/CROSS_SERVICE_READS_PATTERN.md`
- `docs/LIFECYCLE_HOOKS_GUIDE.md`
- `docs/COLLECTIONS_V2/99_IMPLEMENTATION_PLAN.md`
- `docs/COLLECTIONS_V2/99_SERVICE_LAYER_IMPLEMENTATION_PLAN.md`

Finally, once you fully understand the state of the software and have an implementation plan for removing `include_candidates_in_snapshots` from the release track schema and tightening up support for the `include` and `format` query parameters, you may commence the refactor.