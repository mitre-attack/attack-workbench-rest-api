# Cross-Service Reads in Event-Driven Architecture

## The Dilemma

When building embedded relationships (denormalized metadata cache), services need information from documents managed by other services. For example:

```javascript
// DetectionStrategiesService needs analytic metadata
data.workspace.embedded_relationships.push({
  stix_id: analyticId,
  attack_id: analytic?.workspace?.attack_id,  // From AnalyticsService
  name: analytic.stix.name,                    // From AnalyticsService
  direction: 'outbound',
});
```

**Question:** Does fetching this metadata violate the event-driven architecture principle?

## Answer: No - Reads Are Different From Writes

### Core Principle Refinement

The event-driven architecture aims to eliminate **cross-service WRITES**, not reads.

| Operation | Allowed? | Rationale |
|-----------|----------|-----------|
| Service A reads from Service B's repository | ✅ YES | Safe, idempotent, necessary for denormalization |
| Service A writes to Service B's repository | ❌ NO | Violates ownership, creates tight coupling |
| Service A emits event → Service B writes to its own repository | ✅ YES | Event-driven pattern, maintains boundaries |

### Why Cross-Service Reads Are Acceptable

1. **Reads don't violate ownership** - AnalyticsService still owns analytics data; DetectionStrategiesService is just observing it

2. **Reads don't create consistency issues** - No competing writes, no transaction boundaries to manage

3. **Reads are necessary for denormalization** - Embedded relationships are a materialized view requiring source data

4. **Reads don't create temporal coupling** - If analytics don't exist yet, handle gracefully with null values

## Design Patterns

### ✅ Pattern: Read During Denormalization

**When to use:** Building cached metadata (embedded_relationships, computed fields)

```javascript
class DetectionStrategiesService extends BaseService {
  async beforeCreate(data) {
    // ALLOWED: Reading analytics metadata to denormalize
    for (const analyticId of data.stix.x_mitre_analytic_refs) {
      try {
        const analytic = await analyticsRepository.retrieveLatestByStixId(analyticId);
        data.workspace.embedded_relationships.push({
          stix_id: analyticId,
          attack_id: analytic?.workspace?.attack_id || null,
          name: analytic.stix.name,
          direction: 'outbound',
        });
      } catch (error) {
        // Handle missing analytics gracefully
        data.workspace.embedded_relationships.push({
          stix_id: analyticId,
          attack_id: null,
          name: null,
          direction: 'outbound',
        });
      }
    }
  }

  async afterCreate(document) {
    // REQUIRED: Emit event so AnalyticsService can update its own documents
    await EventBus.emit('x-mitre-detection-strategy::analytics-referenced', {
      detectionStrategy: document,
      analyticIds: document.stix.x_mitre_analytic_refs
    });
  }
}
```

### ✅ Pattern: Event-Driven Writes

**When to use:** Updating documents managed by another service

```javascript
class AnalyticsService extends BaseService {
  static initializeEventListeners() {
    EventBus.on(
      'x-mitre-detection-strategy::analytics-referenced',
      this.handleAnalyticsReferenced.bind(this)
    );
  }

  static async handleAnalyticsReferenced(payload) {
    const { detectionStrategy, analyticIds } = payload;

    for (const analyticId of analyticIds) {
      // CORRECT: AnalyticsService modifying its own documents
      const analytic = await analyticsRepository.retrieveLatestByStixId(analyticId);

      analytic.workspace.embedded_relationships.push({
        stix_id: detectionStrategy.stix.id,
        attack_id: detectionStrategy.workspace?.attack_id,
        name: detectionStrategy.stix.name,
        direction: 'inbound',
      });

      await analyticsRepository.saveDocument(analytic);
    }
  }
}
```

### ❌ Anti-Pattern: Direct Cross-Service Write

**Never do this:**

```javascript
class DetectionStrategiesService extends BaseService {
  async afterCreate(document) {
    // WRONG: DetectionStrategiesService directly modifying analytics
    for (const analyticId of document.stix.x_mitre_analytic_refs) {
      const analytic = await analyticsRepository.retrieveLatestByStixId(analyticId);

      analytic.workspace.embedded_relationships.push({
        stix_id: document.stix.id,
        direction: 'inbound',
      });

      await analyticsRepository.saveDocument(analytic);  // ❌ WRONG!
    }
  }
}
```

**Why this is wrong:**
- Violates single responsibility (DetectionStrategiesService shouldn't know how to update analytics)
- Creates tight coupling
- Makes testing harder
- Harder to trace who modified what

## When Should You Denormalize?

Denormalization (embedded_relationships) is appropriate when:

1. **UI needs the data frequently** - Avoids N+1 query problems
2. **Data changes infrequently** - Analytics names don't change often
3. **Staleness is acceptable** - If analytic name changes, embedded relationship name will be stale until next update
4. **Read performance matters** - Joining at query time would be too slow

If these don't apply, consider storing only IDs and joining at query time.

## Alternatives Considered

### Alternative 1: No Denormalization (Store Only IDs)

```javascript
// Minimal approach
data.workspace.embedded_relationships.push({
  stix_id: analyticId,
  direction: 'outbound',
});

// Fetch names at query time
const analytics = await Promise.all(
  embeddedRels.map(rel => analyticsRepository.retrieveLatestByStixId(rel.stix_id))
);
```

**Trade-offs:**
- ✅ No cross-service reads needed
- ✅ Always current data
- ❌ Slower API responses (N+1 queries)
- ❌ More complex query logic

### Alternative 2: Event-Based Metadata Request (Over-Engineering)

```javascript
// Request metadata via events
const metadata = await EventBus.emitAndWait('analytic::metadata-requested', {
  analyticIds
});
```

**Trade-offs:**
- ❌ Turns events into synchronous RPC (defeats purpose)
- ❌ Adds latency and complexity
- ❌ Just hiding the read behind an event facade

**Verdict:** Not recommended - you're just wrapping a read with more abstraction

## Recommendations

### For DetectionStrategiesService

1. ✅ **Keep the cross-repository read in `beforeCreate`** - This is correct and necessary
2. ✅ **Emit events in `afterCreate`** - Let AnalyticsService update its own documents
3. ✅ **Handle missing analytics gracefully** - Store null values if analytic doesn't exist

### For Documentation

Update [EVENT_BUS_ARCHITECTURE.md](EVENT_BUS_ARCHITECTURE.md) to clarify:

```markdown
### Cross-Service Communication Rules

**WRITES - Use Events:**
- ❌ Service A MUST NOT directly modify Service B's documents
- ✅ Service A emits event → Service B modifies its own documents

**READS - Direct Repository Access Allowed:**
- ✅ Service A MAY read from Service B's repository
- Use case: Building denormalized metadata caches
- Use case: Validation (checking if referenced document exists)
- Must handle missing documents gracefully

**Example:**
```javascript
// CORRECT: Read to denormalize, emit to write
async beforeCreate(data) {
  const analytic = await analyticsRepository.retrieveLatestByStixId(id); // ✅ READ
  data.workspace.embedded_relationships.push({ name: analytic.stix.name });
}

async afterCreate(document) {
  await EventBus.emit('analytics-referenced', { ... }); // ✅ EVENT FOR WRITES
}
```
```

## Summary

**Your current implementation is correct.** The cross-repository read in `beforeCreate` is:

- ✅ Necessary for building denormalized metadata
- ✅ Safe (read-only operation)
- ✅ Aligned with event-driven architecture (which prohibits cross-service WRITES, not reads)
- ✅ Standard pattern in CQRS and materialized view architectures

**The architecture is not flawed.** The documentation just needs to clarify that:

> "Event-driven architecture eliminates cross-service WRITES (use events instead) but permits cross-service READS when necessary for denormalization and validation."

Remove the comment in lines 39-42 of [detection-strategies-service.js](app/services/detection-strategies-service.js#L39-L42) - this implementation is correct as-is.
