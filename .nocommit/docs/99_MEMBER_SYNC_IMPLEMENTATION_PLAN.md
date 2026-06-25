# Member Sync Strategies — Implementation Plan

> **Purpose**: Implementation guide for the Member Sync Strategies feature documented in [08_MEMBER_SYNC_STRATEGIES.md](./08_MEMBER_SYNC_STRATEGIES.md). This plan follows the architecture established in [99_SERVICE_LAYER_IMPLEMENTATION_PLAN.md](./99_SERVICE_LAYER_IMPLEMENTATION_PLAN.md).

---

## Status Tracker

| Phase | Description | Status |
|-------|-------------|--------|
| A | Schema Updates (Mongoose + Zod + Defaults) | TODO |
| B | Member Sync Service (Core Logic) | TODO |
| C | Event Integration (STIX Object Hooks) | TODO |
| D | Testing & Verification | TODO |

---

## Architecture Integration

### Where Member Sync Fits

```
Controller
    └─▶ release-tracks-service.js  (Facade)
            ├─▶ snapshot-service.js           ← Phase 1 (existing)
            ├─▶ standard-track-service.js     ← Phase 2 (existing)
            ├─▶ workflow-service.js            ← Phase 3 (existing)
            ├─▶ versioning-service.js          ← Phase 4 (existing)
            ├─▶ virtual-track-service.js       ← Phase 5 (existing)
            └─▶ member-sync-service.js         ← NEW (this plan)

STIX Object Services (techniques, groups, malware, etc.)
    └─▶ EventBus.emit('stix-object::modified')
            └─▶ member-sync-service.handleObjectModified()
```

### Design Decision: Dedicated Service vs. Workflow Extension

**Choice**: Create a new `member-sync-service.js` rather than extending `workflow-service.js`.

**Rationale**:
1. **Single Responsibility**: Workflow service handles candidacy thresholds and auto-promotion. Member sync is a distinct concern (event-driven enrollment from external modifications).
2. **Event-Driven Nature**: Member sync listens to STIX object events, while workflow service operates on release track events.
3. **Testability**: A dedicated service can be tested in isolation with mocked events.
4. **Future Flexibility**: Member sync may evolve independently (e.g., per-object exclusions, batch processing).

### Dependencies

```
member-sync-service.js
    ├─▶ registryRepo          (find tracks where object is a member)
    ├─▶ dynamicRepo           (read/write snapshots)
    ├─▶ snapshotService       (cloneSnapshot helper)
    ├─▶ workflowService       (auto-promotion after enrollment)
    └─▶ EventBus              (subscribe to stix-object events)
```

---

## Phase A: Schema Updates

### Scope

Update all schema layers to support the `member_sync` configuration:
1. Mongoose schema (database storage)
2. Zod schemas (request/response validation)
3. Default configuration in `createTrack()`

### A.1: Mongoose Schema Update

**File**: `app/models/release-tracks/release-track-snapshot-schema.js`

Add `member_sync` to the `config` subdocument:

```javascript
config: {
  // Existing fields...
  candidacy_threshold: {
    type: String,
    enum: ['work-in-progress', 'awaiting-review', 'reviewed'],
    default: 'reviewed'
  },
  auto_promote: {
    type: Boolean,
    default: true
  },
  promotion_conflicts: {
    candidates_to_staged: {
      type: String,
      enum: ['always_overwrite', 'always_reject', 'prefer_latest'],
      default: 'prefer_latest'
    },
    staged_to_members: {
      type: String,
      enum: ['always_overwrite', 'always_reject', 'prefer_latest', 'abort'],
      default: 'abort'
    }
  },

  // NEW: Member Sync Configuration
  member_sync: {
    strategy: {
      type: String,
      enum: ['track_latest', 'manual'],
      default: 'track_latest'
    },
    supplant: {
      behavior: {
        type: String,
        enum: ['replace', 'queue', 'ignore'],
        default: 'replace'
      },
      status_policy: {
        type: String,
        enum: ['reset', 'preserve'],
        default: 'reset'
      }
    }
  }
}
```

### A.2: Zod Schema Updates

**File**: `app/lib/release-tracks/release-track-schemas.js`

Add validation schemas for member sync configuration:

```javascript
// Member sync supplant behavior
const memberSyncSupplantBehaviorSchema = z.enum(['replace', 'queue', 'ignore']);

// Member sync status policy
const memberSyncStatusPolicySchema = z.enum(['reset', 'preserve']);

// Member sync strategy
const memberSyncStrategySchema = z.enum(['track_latest', 'manual']);

// Complete member sync config
const memberSyncConfigSchema = z.object({
  strategy: memberSyncStrategySchema.optional(),
  supplant: z.object({
    behavior: memberSyncSupplantBehaviorSchema.optional(),
    status_policy: memberSyncStatusPolicySchema.optional()
  }).optional()
}).optional();

// Update the track config schema to include member_sync
const trackConfigSchema = z.object({
  candidacy_threshold: z.enum(['work-in-progress', 'awaiting-review', 'reviewed']).optional(),
  auto_promote: z.boolean().optional(),
  promotion_conflicts: z.object({
    candidates_to_staged: z.enum(['always_overwrite', 'always_reject', 'prefer_latest']).optional(),
    staged_to_members: z.enum(['always_overwrite', 'always_reject', 'prefer_latest', 'abort']).optional()
  }).optional(),
  member_sync: memberSyncConfigSchema  // NEW
});

// Export for use in validators
module.exports = {
  // ... existing exports
  memberSyncConfigSchema,
  memberSyncStrategySchema,
  memberSyncSupplantBehaviorSchema,
  memberSyncStatusPolicySchema
};
```

### A.3: Default Configuration

**File**: `app/services/release-tracks/snapshot-service.js`

In `createTrack()`, set explicit defaults for member sync:

```javascript
exports.createTrack = async function(data) {
  // ... existing code ...

  const initialSnapshot = {
    // ... existing fields ...
    config: {
      candidacy_threshold: 'reviewed',
      auto_promote: true,
      promotion_conflicts: {
        candidates_to_staged: 'prefer_latest',
        staged_to_members: 'abort'
      },
      // NEW: Default member sync config
      member_sync: {
        strategy: 'track_latest',
        supplant: {
          behavior: 'replace',
          status_policy: 'reset'
        }
      }
    }
  };

  // ... rest of function ...
};
```

The Mongoose schema defaults (defined in A.1) will also apply if `config.member_sync` is not explicitly provided.

### A.4: Verification (Phase A)

```bash
# Unit tests for Zod schemas
npm test -- --grep "member_sync schema"

# Verify Mongoose schema accepts new config
# Create a track and check config is populated
curl -X POST http://localhost:3000/api/release-tracks/new \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Track","type":"standard"}'

# Verify config includes member_sync with defaults
curl http://localhost:3000/api/release-tracks/<track-id>/config
```

---

## Phase B: Member Sync Service

### Scope

Implement the core member sync logic in a dedicated service that:
1. Determines if/how to enroll a new object revision
2. Handles supplant behavior (replace/queue/ignore)
3. Applies status policy (reset/preserve)
4. Creates new draft snapshots

### B.1: New File: `app/services/release-tracks/member-sync-service.js`

**Dependencies**:
```javascript
'use strict';

const registryRepo = require('../../repository/release-tracks/release-track-registry.repository');
const dynamicRepo = require('../../repository/release-tracks/release-track-dynamic.repository');
const snapshotService = require('./snapshot-service');
const workflowService = require('./workflow-service');
const logger = require('../../lib/logger');
```

### B.2: Core Method: `handleObjectModified()`

This is the main entry point, called when a STIX object is created or modified.

```javascript
/**
 * Handle a STIX object modification event.
 * Identifies release tracks where the object is a member and applies
 * the configured member sync strategy.
 *
 * @param {Object} event - The modification event
 * @param {string} event.objectRef - The STIX ID of the modified object
 * @param {Date} event.newModified - The new modified timestamp
 * @param {Date} event.oldModified - The previous modified timestamp (if update)
 * @param {string} event.modifiedBy - User who made the modification
 * @returns {Promise<Object[]>} Array of affected release track snapshots
 */
exports.handleObjectModified = async function(event) {
  const { objectRef, newModified, modifiedBy } = event;

  // 1. Find all release tracks where this object is in members
  const affectedTracks = await findTracksWithObjectInMembers(objectRef);

  if (affectedTracks.length === 0) {
    logger.debug(`[member-sync] No release tracks contain ${objectRef} in members`);
    return [];
  }

  logger.debug(`[member-sync] Found ${affectedTracks.length} tracks with ${objectRef} in members`);

  // 2. Process each track according to its member_sync config
  const results = [];
  for (const trackInfo of affectedTracks) {
    try {
      const result = await processMemberSync(trackInfo.trackId, {
        objectRef,
        newModified,
        modifiedBy
      });
      if (result) results.push(result);
    } catch (err) {
      logger.error(`[member-sync] Error processing track ${trackInfo.trackId}: ${err.message}`);
      // Continue processing other tracks; don't let one failure stop all
    }
  }

  return results;
};
```

### B.3: Helper: `findTracksWithObjectInMembers()`

Query all release tracks to find where the object is a member.

```javascript
/**
 * Find all release tracks where the given object is in the members array.
 *
 * @param {string} objectRef - The STIX ID to search for
 * @returns {Promise<Array<{trackId: string, memberEntry: Object}>>}
 */
async function findTracksWithObjectInMembers(objectRef) {
  // Get all track IDs from registry
  const allTracks = await registryRepo.findAll({ limit: 10000 });
  const results = [];

  for (const trackInfo of allTracks.data) {
    // Skip virtual tracks (they don't have the same member sync semantics)
    if (trackInfo.type === 'virtual') continue;

    const snapshot = await dynamicRepo.getLatestSnapshot(trackInfo.track_id);
    if (!snapshot) continue;

    // Check if object is in members
    const memberEntry = snapshot.members?.find(m => m.object_ref === objectRef);
    if (memberEntry) {
      results.push({
        trackId: trackInfo.track_id,
        memberEntry,
        snapshot
      });
    }
  }

  return results;
}
```

**Performance Note**: This naive approach queries all tracks. For large deployments, consider:
1. Adding a reverse index (`workspace.referenced_by` on objects as noted in the design doc)
2. Caching track membership
3. Using MongoDB aggregation with `$lookup`

For MVP, the naive approach is acceptable given expected track counts.

### B.4: Core Logic: `processMemberSync()`

Apply the configured strategy to a single release track.

```javascript
/**
 * Process member sync for a single release track.
 *
 * @param {string} trackId
 * @param {Object} event
 * @returns {Promise<Object|null>} New snapshot if changes made, null otherwise
 */
async function processMemberSync(trackId, event) {
  const { objectRef, newModified, modifiedBy } = event;

  // Get latest snapshot with defaults applied
  const snapshot = await snapshotService.getLatestSnapshot(trackId);
  const config = snapshot.config.member_sync;

  // Check strategy
  if (config.strategy === 'manual') {
    logger.debug(`[member-sync] Track ${trackId} uses manual strategy, skipping auto-enrollment`);
    return null;
  }

  // strategy === 'track_latest'
  // Check if object already exists in candidates or staged
  const existingInCandidates = snapshot.candidates?.find(c => c.object_ref === objectRef);
  const existingInStaged = snapshot.staged?.find(s => s.object_ref === objectRef);
  const existingEntry = existingInStaged || existingInCandidates;
  const existingTier = existingInStaged ? 'staged' : (existingInCandidates ? 'candidates' : null);

  // Determine action based on supplant.behavior
  let action = null;
  if (!existingEntry) {
    // No existing entry → simple enrollment
    action = { type: 'enroll', tier: 'candidates' };
  } else {
    // Existing entry → apply supplant behavior
    switch (config.supplant.behavior) {
      case 'replace':
        action = {
          type: 'replace',
          removeTier: existingTier,
          removeEntry: existingEntry,
          targetTier: config.supplant.status_policy === 'preserve' ? existingTier : 'candidates'
        };
        break;
      case 'queue':
        action = { type: 'enroll', tier: 'candidates' };
        break;
      case 'ignore':
        logger.debug(`[member-sync] Track ${trackId}: ignoring ${objectRef} (existing entry in ${existingTier})`);
        return null;
    }
  }

  if (!action) return null;

  // Build the new candidate/staged entry
  const now = new Date();
  const newEntry = {
    object_ref: objectRef,
    object_modified: new Date(newModified),
    object_added_at: now,
    object_added_by: modifiedBy || 'system'
  };

  // Determine status
  if (action.type === 'replace' && config.supplant.status_policy === 'preserve') {
    newEntry.object_status = action.removeEntry.object_status;
    if (action.removeEntry.object_staged_at) {
      newEntry.object_staged_at = now;
      newEntry.object_staged_by = modifiedBy || 'system';
    }
  } else {
    newEntry.object_status = 'work-in-progress';
  }

  // Build updated tier arrays
  let newCandidates = [...(snapshot.candidates || [])];
  let newStaged = [...(snapshot.staged || [])];

  // Remove old entry if replacing
  if (action.type === 'replace') {
    if (action.removeTier === 'candidates') {
      newCandidates = newCandidates.filter(c =>
        !(c.object_ref === objectRef &&
          c.object_modified.getTime() === action.removeEntry.object_modified.getTime())
      );
    } else if (action.removeTier === 'staged') {
      newStaged = newStaged.filter(s =>
        !(s.object_ref === objectRef &&
          s.object_modified.getTime() === action.removeEntry.object_modified.getTime())
      );
    }
  }

  // Add new entry to target tier
  const targetTier = action.targetTier || action.tier;
  if (targetTier === 'staged') {
    newStaged.push(newEntry);
  } else {
    newCandidates.push(newEntry);
  }

  // Clone snapshot with updated tiers
  const newSnapshot = await snapshotService.cloneSnapshot(trackId, snapshot, {
    candidates: newCandidates,
    staged: newStaged
  });

  logger.info(`[member-sync] Track ${trackId}: ${action.type} ${objectRef} → ${targetTier}`);

  // Check if auto-promotion should occur (new entry in candidates that meets threshold)
  if (targetTier === 'candidates' && snapshot.config.auto_promote) {
    const promoted = await workflowService.evaluateAutoPromotion(trackId, newSnapshot);
    if (promoted) {
      logger.info(`[member-sync] Track ${trackId}: auto-promoted ${objectRef} to staged`);
      return promoted;
    }
  }

  return newSnapshot;
}
```

### B.5: Facade Wiring

**File**: `app/services/release-tracks/release-tracks-service.js`

Add export for the member sync handler (used by event integration):

```javascript
const memberSyncService = require('./member-sync-service');

// Expose for event handlers
exports.handleObjectModified = memberSyncService.handleObjectModified;
```

### B.6: Verification (Phase B)

Unit tests for member-sync-service:

```javascript
// app/tests/unit/services/release-tracks/member-sync-service.spec.js

describe('member-sync-service', () => {
  describe('handleObjectModified', () => {
    it('should auto-enroll when strategy is track_latest', async () => {
      // Setup: create track with track_latest config
      // Modify object
      // Assert: new snapshot has object in candidates
    });

    it('should not enroll when strategy is manual', async () => {
      // Setup: create track with manual config
      // Modify object
      // Assert: no new snapshot created
    });

    it('should replace existing candidate when behavior is replace', async () => {
      // Setup: track with existing candidate entry
      // Modify object (new version)
      // Assert: old version removed, new version added
    });

    it('should queue alongside existing when behavior is queue', async () => {
      // Setup: track with existing candidate entry
      // Modify object
      // Assert: both versions present
    });

    it('should ignore when existing entry and behavior is ignore', async () => {
      // Setup: track with existing candidate entry
      // Modify object
      // Assert: no change
    });

    it('should reset status when status_policy is reset', async () => {
      // Setup: track with reviewed entry in staged
      // Modify object with replace + reset
      // Assert: new entry is work-in-progress in candidates
    });

    it('should preserve status when status_policy is preserve', async () => {
      // Setup: track with reviewed entry in staged
      // Modify object with replace + preserve
      // Assert: new entry is reviewed in staged
    });
  });
});
```

---

## Phase C: Event Integration

### Scope

Connect the member sync service to STIX object modification events so that sync happens automatically when objects are created or updated.

### C.1: Identify Event Sources

STIX objects can be modified via:
1. Direct CRUD endpoints (`POST /api/techniques`, `PUT /api/techniques/:id`, etc.)
2. Bundle imports (`POST /api/collection-bundles`)
3. Other internal operations

The existing codebase uses an EventBus pattern (see `app/lib/event-constants.js`). We need to:
1. Identify where STIX modifications occur
2. Emit events with the required data
3. Subscribe to these events in member-sync-service

### C.2: Add Event Constants

**File**: `app/lib/event-constants.js`

Add new event constant:

```javascript
module.exports = {
  // ... existing constants ...

  // STIX Object Events (for member sync)
  STIX_OBJECT_CREATED: 'stix-object::created',
  STIX_OBJECT_MODIFIED: 'stix-object::modified',
  STIX_OBJECT_DELETED: 'stix-object::deleted'
};
```

### C.3: Emit Events from STIX Services

The STIX object services (techniques, groups, malware, etc.) need to emit events when objects are created or modified. This requires modifications to the base service layer or individual services.

**Option A**: Modify each STIX service individually (tedious but explicit)
**Option B**: Add a post-save hook at the repository layer (cleaner)

**Recommended**: Option B with a dedicated event emitter utility.

**File**: Create `app/lib/stix-object-events.js`

```javascript
'use strict';

const EventEmitter = require('events');
const eventConstants = require('./event-constants');
const logger = require('./logger');

const stixObjectEvents = new EventEmitter();

/**
 * Emit a STIX object modification event.
 * Called after STIX objects are created or updated.
 *
 * @param {Object} params
 * @param {string} params.objectRef - STIX ID of the object
 * @param {Date} params.newModified - New modified timestamp
 * @param {Date} [params.oldModified] - Previous modified timestamp (for updates)
 * @param {string} [params.modifiedBy] - User who made the change
 * @param {string} params.eventType - 'created' or 'modified'
 */
exports.emitObjectModified = function(params) {
  const event = {
    objectRef: params.objectRef,
    newModified: params.newModified,
    oldModified: params.oldModified,
    modifiedBy: params.modifiedBy,
    timestamp: new Date()
  };

  const eventName = params.eventType === 'created'
    ? eventConstants.STIX_OBJECT_CREATED
    : eventConstants.STIX_OBJECT_MODIFIED;

  logger.debug(`[stix-events] Emitting ${eventName} for ${params.objectRef}`);
  stixObjectEvents.emit(eventName, event);

  // Also emit generic 'modified' for member sync (handles both create and update)
  stixObjectEvents.emit(eventConstants.STIX_OBJECT_MODIFIED, event);
};

/**
 * Subscribe to STIX object modification events.
 */
exports.onObjectModified = function(handler) {
  stixObjectEvents.on(eventConstants.STIX_OBJECT_MODIFIED, handler);
};

exports.emitter = stixObjectEvents;
```

### C.4: Integrate Event Emission into STIX Services

This is the most invasive change. Each STIX service that creates/updates objects needs to emit events.

**Example**: `app/services/techniques-service.js`

```javascript
const stixObjectEvents = require('../lib/stix-object-events');

// In the create/update methods, after saving:
exports.create = async function(data, options) {
  // ... existing creation logic ...
  const savedObject = await techniquesRepository.save(technique);

  // Emit event for member sync
  stixObjectEvents.emitObjectModified({
    objectRef: savedObject.stix.id,
    newModified: new Date(savedObject.stix.modified),
    modifiedBy: options.userAccountId,
    eventType: 'created'
  });

  return savedObject;
};

exports.updateFull = async function(id, modified, data, options) {
  // ... existing update logic ...
  const savedObject = await techniquesRepository.save(technique);

  stixObjectEvents.emitObjectModified({
    objectRef: savedObject.stix.id,
    newModified: new Date(savedObject.stix.modified),
    oldModified: modified,
    modifiedBy: options.userAccountId,
    eventType: 'modified'
  });

  return savedObject;
};
```

**Alternative**: Use Mongoose middleware (post-save hooks) on the base schema to emit events automatically. This is cleaner but requires schema-level changes.

### C.5: Subscribe in Member Sync Service

**File**: `app/services/release-tracks/member-sync-service.js`

Add initialization function to subscribe to events:

```javascript
const stixObjectEvents = require('../../lib/stix-object-events');

/**
 * Initialize the member sync service.
 * Subscribes to STIX object modification events.
 * Should be called once during application startup.
 */
exports.initialize = function() {
  stixObjectEvents.onObjectModified(async (event) => {
    try {
      await exports.handleObjectModified(event);
    } catch (err) {
      logger.error(`[member-sync] Error handling object modification: ${err.message}`, err);
    }
  });

  logger.info('[member-sync] Member sync service initialized');
};
```

### C.6: Application Startup

**File**: `app/index.js` or `app/server.js` (wherever initialization happens)

```javascript
const memberSyncService = require('./services/release-tracks/member-sync-service');

// During application startup
memberSyncService.initialize();
```

### C.7: Verification (Phase C)

Integration tests:

```javascript
// app/tests/integration/member-sync.spec.js

describe('Member Sync Integration', () => {
  it('should auto-enroll when object in members is modified', async () => {
    // 1. Create a release track with track_latest config
    // 2. Add an object to members (via bump/release)
    // 3. Modify the object via the STIX endpoint
    // 4. Verify new snapshot has object in candidates
  });

  it('should handle bulk import with multiple member objects', async () => {
    // 1. Create release track with multiple members
    // 2. Import bundle that updates several members
    // 3. Verify all updated members appear in candidates
  });
});
```

---

## Phase D: Testing & Verification

### D.1: Unit Tests

| File | Tests |
|------|-------|
| `app/tests/unit/services/release-tracks/member-sync-service.spec.js` | All strategy/behavior combinations |
| `app/tests/unit/lib/stix-object-events.spec.js` | Event emission and subscription |

### D.2: Integration Tests

| File | Tests |
|------|-------|
| `app/tests/integration/release-tracks/member-sync.spec.js` | End-to-end flows |
| `app/tests/api/release-tracks/config.spec.js` | API for updating member_sync config |

### D.3: Manual Verification

```bash
# 1. Create a release track
curl -X POST http://localhost:3000/api/release-tracks/new \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Track","type":"standard"}'

# 2. Add a technique as a candidate and release it
# (This requires the full workflow: add candidates, review, stage, bump)

# 3. Verify config shows track_latest
curl http://localhost:3000/api/release-tracks/<track-id>/config

# 4. Modify the technique
curl -X PUT http://localhost:3000/api/techniques/<technique-id> \
  -H 'Content-Type: application/json' \
  -d '{"name":"Updated Technique", ...}'

# 5. Check that the new version appears in candidates
curl http://localhost:3000/api/release-tracks/<track-id>/candidates

# 6. Test ignore behavior: Update config to use 'ignore'
curl -X PUT http://localhost:3000/api/release-tracks/<track-id>/config \
  -H 'Content-Type: application/json' \
  -d '{"member_sync":{"supplant":{"behavior":"ignore"}}}'

# 7. Modify technique again
# 8. Verify no new entry added (ignore in effect)
```

---

## Files Summary

| File | Phase | Action |
|------|-------|--------|
| `app/models/release-tracks/release-track-snapshot-schema.js` | A | **Modify** (add member_sync to config) |
| `app/lib/release-tracks/release-track-schemas.js` | A | **Modify** (add Zod schemas) |
| `app/services/release-tracks/snapshot-service.js` | A | **Modify** (set defaults on create) |
| `app/services/release-tracks/member-sync-service.js` | B | **Create** |
| `app/services/release-tracks/release-tracks-service.js` | B | **Modify** (wire member sync export) |
| `app/lib/event-constants.js` | C | **Modify** (add STIX object events) |
| `app/lib/stix-object-events.js` | C | **Create** |
| `app/services/*.js` (STIX services) | C | **Modify** (emit events on create/update) |
| `app/index.js` or `app/server.js` | C | **Modify** (initialize member sync) |

---

## Implementation Notes

### Performance Considerations

1. **Track Scanning**: The naive `findTracksWithObjectInMembers()` scans all tracks. For deployments with many tracks:
   - Add a reverse index (deferred in design doc)
   - Cache membership maps
   - Use MongoDB aggregation

2. **Event Processing**: STIX object modifications should not block on member sync completion. Consider:
   - Asynchronous processing (fire-and-forget)
   - Queue-based processing for high-volume scenarios

3. **Snapshot Creation**: Each auto-enrollment creates a new snapshot. For bulk imports:
   - Batch multiple enrollments into a single snapshot
   - Process at end of import transaction

### Edge Cases

1. **Object in Multiple Tracks**: When an object is a member of multiple tracks, each track is processed independently according to its own config.

2. **Virtual Tracks**: Member sync does not apply to virtual tracks (they pull from component track members at snapshot creation time).

3. **Concurrent Modifications**: If the same object is modified multiple times in rapid succession, each modification triggers member sync. The snapshot system handles concurrency (each creates a new snapshot).

4. **Circular Events**: Member sync creates new snapshots, but these should not trigger additional STIX object events (no risk of infinite loops since we're modifying release tracks, not STIX objects).

---

## Dependencies on Other Phases

| This Phase | Depends On |
|------------|------------|
| A (Schema) | None |
| B (Service) | A (Schema), Phase 1 (snapshot-service), Phase 3 (workflow-service for auto-promotion) |
| C (Events) | B (Service), existing STIX services |
| D (Testing) | A, B, C complete |

**Note**: Phase B depends on `workflow-service.evaluateAutoPromotion()` from Phase 3 of the main implementation plan. If Phase 3 is not yet complete, the auto-promotion call in member-sync-service can be stubbed or the feature can be implemented without auto-promotion initially.
