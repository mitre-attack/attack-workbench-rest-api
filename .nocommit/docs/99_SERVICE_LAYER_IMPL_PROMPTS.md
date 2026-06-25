Service Layer Phased Impl Prompts

The `docs/COLLECTIONS_V2/99_IMPLEMENTATION_PLAN.md` document explains the implementation plan for a new feature called "release tracks". It is exhaustively described in the various markdown files stored in `docs/COLLECTIONS_V2/`. Please start by familiarizing with the feature by reading those files.

I've already implemented the Mongoose schemas/models, DAO/repository modules, controller, router, and OpenAPI spec files. Now I'm working on implementing the service layer, which itself is split into 6 phases due to its complexity. 

I need your help implementing the service layer following the multi-phase plan outlined in `docs/COLLECTIONS_V2/99_SERVICE_LAYER_IMPLEMENTATION_PLAN`. 

Phase 1 through 3 are complete. What's next (per the plan at `docs/COLLECTIONS_V2/99_SERVICE_LAYER_IMPLEMENTATION_PLAN`):

- Phase 4: versioning-service.js + version-utils.js + extend tagSnapshotInPlace
- Phase 5: virtual-track-service.js + deduplication-strategies.js
- Phase 6: export-service.js + ephemeral-service.js

Please commence phase 4.


---

The `docs/COLLECTIONS_V2/99_IMPLEMENTATION_PLAN.md` document explains the implementation plan for a new feature called "release tracks". It is exhaustively described in the various markdown files stored in `docs/COLLECTIONS_V2/`. Please start by familiarizing with the feature by reading those files.

I've already implemented the Mongoose schemas/models, DAO/repository modules, controller, router, and OpenAPI spec files. Now I'm working on implementing the service layer, which itself is split into 6 phases due to its complexity. 

I need your help implementing the service layer following the multi-phase plan outlined in `docs/COLLECTIONS_V2/99_SERVICE_LAYER_IMPLEMENTATION_PLAN`. 

Phase 1 through 4 are complete. What's next (per the plan at `docs/COLLECTIONS_V2/99_SERVICE_LAYER_IMPLEMENTATION_PLAN`):

- Phase 5: virtual-track-service.js + deduplication-strategies.js
- Phase 6: export-service.js + ephemeral-service.js

Please commence phase 5.


---

The `docs/COLLECTIONS_V2/99_IMPLEMENTATION_PLAN.md` document explains the implementation plan for a new feature called "release tracks". It is exhaustively described in the various markdown files stored in `docs/COLLECTIONS_V2/`. Please start by familiarizing with the feature by reading those files.

I've already implemented the Mongoose schemas/models, DAO/repository modules, controller, router, and OpenAPI spec files. Now I'm working on implementing the service layer, which itself is split into 6 phases due to its complexity. 

I need your help implementing the service layer following the multi-phase plan outlined in `docs/COLLECTIONS_V2/99_SERVICE_LAYER_IMPLEMENTATION_PLAN`. 

Phase 1 through 5 are complete. What's next (per the plan at `docs/COLLECTIONS_V2/99_SERVICE_LAYER_IMPLEMENTATION_PLAN`):

- Phase 6: Export + Ephemeral
    - `export-service.js`: Requires cross-service reads to hydrate STIX object refs into full objects. For cross-service operations, please use the existing event-bus architecture (see `docs/EVENT_BUS_ARCHITECTURE.md` and `docs/CROSS_SERVICE_READS_PATTERN.md` for details)
    - `ephemeral-service.js`: Requires querying all STIX repos by domain; orthogonal to core
    - `createTrackFromBundle`: Requires STIX bundle parsing. However, I don't want to rely on the existing collection-bundles infrastructure. Instead, I want to to implement from scratch. The new infrastructure will supplant the existing collection-bundles infrastructure once its been tested, validated, and shipped.
    - Format-aware snapshot retrieval: `queryOptions.format` param ignored until export-service exists

Please commence phase 6.