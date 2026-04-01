# Implementation Approach: Service-to-Service Event-Driven Architecture

## Overview

This document describes an implementation approach for managing cross-document relationships using an event-driven architecture with direct service-to-service communication.

## Architecture: Direction Service-to-Service Communication

### Why This Approach?

1. **Simpler** - No intermediate manager services
2. **More Traceable** - Domain event names clearly show business logic
3. **Better Ownership** - Each service owns its complete document
4. **YAGNI Principle** - Don't build generic infrastructure for 1-2 use cases
5. **Easier to Debug** - Direct communication path is clearer

## Pattern

```
ServiceA (owns Document Type A)
   │
   ├─ beforeCreate: Modify own document before save
   ├─ create: [BaseService saves to database]
   ├─ afterCreate: Emit domain event about what changed
   │
   ↓ EventBus
   │
ServiceB (owns Document Type B)
   │
   ├─ Event Listener: Receives domain event
   └─ Response: Modifies own documents accordingly
```

## Example: Detection Strategies ↔ Analytics

### Scenario

When a detection strategy references analytics via `x_mitre_analytic_refs`:
- Detection strategy needs **outbound** embedded_relationships
- Analytics need **inbound** embedded_relationships
- Analytics' `external_references` need URLs pointing to parent detection strategy

### Implementation

```javascript
// ============================================================================
// DetectionStrategiesService
// ============================================================================

class DetectionStrategiesService extends BaseService {
  /**
   * beforeCreate: Build outbound relationships on detection strategy
   */
  async beforeCreate(data, options) {
    data.workspace.embedded_relationships = [];

    const analyticRefs = data.stix?.x_mitre_analytic_refs || [];

    for (const analyticId of analyticRefs) {
      const analytic = await analyticsRepository.retrieveLatestByStixId(analyticId);
      data.workspace.embedded_relationships.push({
        stix_id: analyticId,
        attack_id: analytic?.workspace?.attack_id,
        direction: 'outbound'
      });
    }
  }

  /**
   * afterCreate: Emit domain event to notify AnalyticsService
   */
  async afterCreate(document, options) {
    const analyticRefs = document.stix?.x_mitre_analytic_refs || [];

    if (analyticRefs.length > 0) {
      await EventBus.emit('x-mitre-detection-strategy::analytics-referenced', {
        detectionStrategyId: document.stix.id,
        detectionStrategy: document.toObject(),
        analyticIds: analyticRefs
      });
    }
  }

  /**
   * beforeUpdate: Detect changes and rebuild outbound relationships
   */
  async beforeUpdate(stixId, stixModified, data, existingDocument) {
    const oldRefs = existingDocument.stix?.x_mitre_analytic_refs || [];
    const newRefs = data.stix?.x_mitre_analytic_refs || [];

    // Store for afterUpdate
    this._addedRefs = newRefs.filter(ref => !oldRefs.includes(ref));
    this._removedRefs = oldRefs.filter(ref => !newRefs.includes(ref));

    // Rebuild outbound relationships
    // ... (same logic as beforeCreate)
  }

  /**
   * afterUpdate: Emit events for added/removed analytics
   */
  async afterUpdate(updatedDocument, previousDocument) {
    if (this._addedRefs?.length > 0) {
      await EventBus.emit('x-mitre-detection-strategy::analytics-referenced', {
        detectionStrategyId: updatedDocument.stix.id,
        detectionStrategy: updatedDocument.toObject(),
        analyticIds: this._addedRefs
      });
    }

    if (this._removedRefs?.length > 0) {
      await EventBus.emit('x-mitre-detection-strategy::analytics-removed', {
        detectionStrategyId: updatedDocument.stix.id,
        analyticIds: this._removedRefs
      });
    }

    delete this._addedRefs;
    delete this._removedRefs;
  }
}

// ============================================================================
// AnalyticsService
// ============================================================================

class AnalyticsService extends BaseService {
  /**
   * Initialize event listeners on app startup
   */
  static initialize() {
    EventBus.on(
      'x-mitre-detection-strategy::analytics-referenced',
      this.handleAnalyticsReferenced.bind(this)
    );

    EventBus.on(
      'x-mitre-detection-strategy::analytics-removed',
      this.handleAnalyticsRemoved.bind(this)
    );
  }

  /**
   * Handle analytics being referenced by a detection strategy
   */
  static async handleAnalyticsReferenced(payload) {
    const { detectionStrategy, analyticIds } = payload;

    for (const analyticId of analyticIds) {
      const analytic = await analyticsRepository.retrieveOneLatestByStixId(analyticId);

      // Add inbound embedded_relationship
      if (!analytic.workspace.embedded_relationships) {
        analytic.workspace.embedded_relationships = [];
      }

      analytic.workspace.embedded_relationships.push({
        stix_id: detectionStrategy.stix.id,
        attack_id: detectionStrategy.workspace?.attack_id,
        direction: 'inbound'
      });

      // Update external_references with URL to parent
      const attackRef = createAttackExternalReference(analytic.toObject());
      if (attackRef) {
        analytic.stix.external_references =
          removeAttackExternalReferences(analytic.stix.external_references);
        analytic.stix.external_references.unshift(attackRef);
      }

      await analyticsRepository.saveDocument(analytic);
    }
  }

  /**
   * Handle analytics being removed from a detection strategy
   */
  static async handleAnalyticsRemoved(payload) {
    const { detectionStrategyId, analyticIds } = payload;

    for (const analyticId of analyticIds) {
      const analytic = await analyticsRepository.retrieveOneLatestByStixId(analyticId);

      // Remove inbound embedded_relationship
      analytic.workspace.embedded_relationships =
        analytic.workspace.embedded_relationships.filter(
          rel => !(rel.stix_id === detectionStrategyId && rel.direction === 'inbound')
        );

      // Remove external_reference (no parent anymore)
      analytic.stix.external_references =
        removeAttackExternalReferences(analytic.stix.external_references);

      await analyticsRepository.saveDocument(analytic);
    }
  }
}
```

## Key Points

### 1. **Each Service Owns Its Documents**
- DetectionStrategiesService modifies `detection-strategy.workspace.embedded_relationships`
- AnalyticsService modifies `analytic.workspace.embedded_relationships`
- AnalyticsService modifies `analytic.stix.external_references`

### 2. **Communication via Domain Events**
- `x-mitre-detection-strategy::analytics-referenced` - Clear what happened
- `x-mitre-detection-strategy::analytics-removed` - Clear what happened
- NOT generic like `embedded-relationships::add-requested`

### 3. **Lifecycle Hooks for Timing**
- `beforeCreate/beforeUpdate` - Modify own document **before** save
- `afterCreate/afterUpdate` - Emit events **after** save
- Event listeners - Modify own documents **in response** to other services

### 4. **Initialization**
- Services with event listeners must call `initialize()` on app startup
- In `app/index.js`:
  ```javascript
  const AnalyticsService = require('./services/analytics-service');
  AnalyticsService.initialize();
  ```

## Benefits

### ✅ Traceability
Logs show clear business flow:
```
DetectionStrategiesService: Emitting 'x-mitre-detection-strategy::analytics-referenced'
AnalyticsService: Handling analytics being referenced
AnalyticsService: Added inbound relationship to analytic x-mitre-analytic--123
AnalyticsService: Updated external_references URL
```

### ✅ Simplicity
- Two services communicating directly
- No intermediate manager/coordinator
- Easy to understand the flow

### ✅ Ownership
- DetectionStrategiesService is responsible for detection strategies
- AnalyticsService is responsible for analytics
- Clear boundaries

### ✅ Flexibility
- Each service can implement domain-specific logic
- No need to fit into generic patterns
- Easy to add validation specific to each type

### ✅ Testability
- Mock EventBus
- Test DetectionStrategiesService emits correct events
- Test AnalyticsService handles events correctly
- Clear test boundaries

## Comparison with Generic Manager Approach

| Aspect | Direct Communication ✅ | Generic Manager ❌ |
|--------|------------------------|-------------------|
| **Event Names** | `detection-strategy::analytics-referenced` | `embedded-relationships::add-requested` |
| **Traceability** | Clear business domain flow | Generic infrastructure flow |
| **Ownership** | Services own their documents | Manager modifies multiple types |
| **Complexity** | 2 services | 3 services (+ manager) |
| **Reusability** | Each pair custom | Generic for all |
| **When to Use** | Known use cases (1-2) | Many similar patterns (5+) |

## Current Status

- ✅ EventBus implemented
- ✅ Lifecycle hooks in BaseService
- ✅ Architecture documented
- 🚧 Refactoring DetectionStrategiesService to emit domain events
- 🚧 Implementing AnalyticsService event listeners
- ⏳ Testing end-to-end

## Next Steps

1. Remove `EmbeddedRelationshipsService` (no longer needed)
2. Refactor `DetectionStrategiesService` to use lifecycle hooks + domain events
3. Implement `AnalyticsService.initialize()` and event handlers
4. Test end-to-end workflows
5. Clean up temporary test listeners
