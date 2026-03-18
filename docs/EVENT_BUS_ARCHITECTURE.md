# Event Bus Architecture Design

## Overview

This document defines the event-driven architecture for managing cross-document dependencies and derived properties in the ATT&CK Workbench REST API.

## Core Principles

### 1. Lifecycle Hooks Pattern

Each CRUD operation has exactly **three lifecycle stages**:

```
beforeX → X → afterX → emitXEvent
```

For example:
- `beforeCreate` → `create` → `afterCreate` → `emitCreatedEvent`
- `beforeUpdate` → `update` → `afterUpdate` → `emitUpdatedEvent`
- `beforeDelete` → `delete` → `afterDelete` → `emitDeletedEvent`

**Execution Order:**

1. **`beforeX` hook** - Child service can modify data before persistence
2. **`X` operation** - BaseService persists the Mongoose document to database
3. **`afterX` hook** - Child service can perform side-effects after persistence
4. **`emitXEvent` method** - BaseService emits event to EventBus for cross-service coordination

**Key Rules:**

- The terms "before" and "after" refer explicitly to **database persistence**
- Child services override `beforeX` and `afterX` hooks, NOT the main operation
- BaseService orchestrates the execution order automatically
- Child services do NOT call other lifecycle hooks explicitly
- Side-effects that modify OTHER documents belong in `afterX` hooks or in event listeners

### 2. Service-to-Service Communication via Domain Events

**Architecture Pattern:**

```
ServiceA (modifies its own documents)
   ↓ emits domain event
EventBus
   ↓ delivers to listeners
ServiceB (modifies its own documents in response)
```

**Each service:**
- ✅ **Owns its complete document** (both `stix` and `workspace` fields)
- ✅ **Only modifies documents of its own type**
- ✅ **Emits domain events** when changes affect other services
- ✅ **Listens to domain events** from other services and responds

**Cross-Service Communication Rules:**

| Operation | Allowed? | Pattern |
|-----------|----------|---------|
| Cross-service WRITES | ❌ NO | Use events instead |
| Cross-service READS | ✅ YES | Direct repository access permitted for denormalization and validation |

**WRITES - Use Events:**
- ❌ Service A MUST NOT directly modify Service B's documents
- ✅ Service A emits event → Service B modifies its own documents
- Rationale: Maintains ownership boundaries, enables loose coupling

**READS - Direct Repository Access:**
- ✅ Service A MAY read from Service B's repository
- Use cases: Building denormalized metadata (embedded_relationships), validation
- Must handle missing documents gracefully (null values, try/catch)
- Rationale: Reads are safe, idempotent, and necessary for materialized views

**Example:**
```javascript
// DetectionStrategiesService
async beforeCreate(data) {
  // ✅ ALLOWED: Read from analytics repository to build denormalized metadata
  const analytic = await analyticsRepository.retrieveLatestByStixId(analyticId);
  data.workspace.embedded_relationships.push({
    stix_id: analyticId,
    name: analytic.stix.name,  // Denormalized data from read
  });
}

async afterCreate(document) {
  // ✅ REQUIRED: Emit event so AnalyticsService can update its own documents
  await EventBus.emit('analytics-referenced', { ... });
}
```

**No Generic Manager Services:**
- ❌ No `EmbeddedRelationshipsManager` - services handle their own relationships
- ❌ No `ExternalReferencesManager` - services handle their own references
- ✅ Services communicate directly via domain-specific events

### 3. Separation of Concerns

Each STIX document has two top-level keys:
- `stix` - STIX 2.1 specification fields
- `workspace` - ATT&CK Workbench metadata

**Ownership Model:**

| Component | Responsibility | Authority |
|-----------|---------------|-----------|
| **SDO Services** (e.g., DetectionStrategiesService, AnalyticsService) | Manage both `stix` and `workspace` fields for their own document type | Full authority over own document properties |
| **Cross-Service Communication** | Via domain events on EventBus | Services request actions, don't directly modify other documents |

**Rationale:**

- **SDO services own their complete document** - both `stix` and `workspace` fields
- **Cross-document coordination** happens via events, not direct method calls
- **Each service is responsible** for maintaining its own metadata, including `workspace.embedded_relationships`
- **Keep it simple** - direct service-to-service communication is easier to trace than generic managers

### 4. Event Bus Messaging

**Event Naming Convention:**

```
<subject>::<action>[.<detail>]
```

Where:
- `subject` = The entity type (lowercase STIX type, hyphenated for custom types)
- `action` = Past tense verb describing what happened
- `detail` = Optional qualifier for specialized events

**Examples:**
- `x-mitre-detection-strategy::created` - Base CRUD event
- `x-mitre-detection-strategy::analytics-referenced` - Domain event
- `x-mitre-detection-strategy::analytics-removed` - Domain event
- `x-mitre-analytic::parent-changed` - Domain event

**Event Payload Structure:**

```javascript
{
  // Core identifiers
  stixId: 'x-mitre-detection-strategy--...',
  stixModified: '2024-01-15T10:30:00.000Z',

  // The affected document (plain object)
  document: { ... },

  // Domain-specific context
  analyticIds: [...],  // For analytics-referenced events

  // Additional context
  options: { ... }
}
```

## Event Catalog

### Core CRUD Events (Emitted by BaseService)

| Event | When Emitted | Payload | Use Cases |
|-------|--------------|---------|-----------|
| `{type}::created` | After `afterCreate` hook | `{ stixId, document, type, options }` | Audit logging, notifications |
| `{type}::updated` | After `afterUpdate` hook | `{ stixId, stixModified, document, previousDocument, type }` | Track changes, propagate updates |
| `{type}::deleted` | After `afterDelete` hook | `{ stixId, document, options }` | Cleanup, cascade deletes |

Where `{type}` is the STIX type (e.g., `attack-pattern`, `x-mitre-analytic`, `x-mitre-detection-strategy`).

### Domain Events (Emitted by SDO Services)

| Event | Emitted By | When | Payload | Listeners |
|-------|------------|------|---------|-----------|
| `x-mitre-detection-strategy::analytics-referenced` | DetectionStrategiesService | When detection strategy references analytics (create/update) | `{ detectionStrategyId, detectionStrategy, analyticIds }` | AnalyticsService |
| `x-mitre-detection-strategy::analytics-removed` | DetectionStrategiesService | When analytics removed from detection strategy | `{ detectionStrategyId, analyticIds }` | AnalyticsService |
| `x-mitre-analytic::parent-changed` | AnalyticsService | When analytic's parent detection strategy changes | `{ analyticId, oldParentId, newParentId, analytic }` | (Future: for cascading updates) |

## Workflow Examples

### Workflow 1: Create Detection Strategy with Analytics

**User Action:** `POST /api/detection-strategies` with `x_mitre_analytic_refs: ['x-mitre-analytic--123']`

**Execution Flow:**

1. **DetectionStrategiesService.beforeCreate(data, options)**
   - Initialize `data.workspace.embedded_relationships = []`
   - For each analytic ref, build outbound embedded_relationship:
     ```javascript
     {
       stix_id: 'x-mitre-analytic--123',
       attack_id: 'DA-0001',  // fetched from analytic
       direction: 'outbound'
     }
     ```
   - Add to `data.workspace.embedded_relationships`

2. **BaseService.create()** - Persist document to database

3. **DetectionStrategiesService.afterCreate(document, options)**
   - Emit domain event: `x-mitre-detection-strategy::analytics-referenced`
     ```javascript
     {
       detectionStrategyId: 'x-mitre-detection-strategy--abc',
       detectionStrategy: { ... },
       analyticIds: ['x-mitre-analytic--123']
     }
     ```

4. **BaseService.emitCreatedEvent()** - Emit `x-mitre-detection-strategy::created`

5. **AnalyticsService** listener receives `analytics-referenced` event
   - For each analyticId:
     - Fetch the analytic document
     - Add inbound embedded_relationship:
       ```javascript
       {
         stix_id: 'x-mitre-detection-strategy--abc',
         attack_id: 'DS0001',
         direction: 'inbound'
       }
       ```
     - Update analytic's `external_references` with URL: `https://attack.mitre.org/detectionstrategies/DS0001#DA-0001`
     - Save the analytic

### Workflow 2: Update Detection Strategy - Add Analytic

**User Action:** `PUT /api/detection-strategies/{id}/{modified}`
- Change `x_mitre_analytic_refs` from `[]` to `['x-mitre-analytic--123']`

**Execution Flow:**

1. **DetectionStrategiesService.beforeUpdate(stixId, stixModified, data, existingDocument)**
   - Detect change: `oldRefs = []`, `newRefs = ['x-mitre-analytic--123']`
   - Store: `this._addedAnalyticRefs = ['x-mitre-analytic--123']`
   - Rebuild outbound embedded_relationships for new refs
   - Update `data.workspace.embedded_relationships`

2. **BaseService.updateFull()** - Persist document to database

3. **DetectionStrategiesService.afterUpdate(updatedDocument, previousDocument)**
   - If `_addedAnalyticRefs` not empty:
     - Emit `x-mitre-detection-strategy::analytics-referenced`
   - Clean up: `delete this._addedAnalyticRefs`

4. **BaseService.emitUpdatedEvent()** - Emit `x-mitre-detection-strategy::updated`

5. **AnalyticsService** listener receives event and updates analytics

### Workflow 3: Update Detection Strategy - Remove Analytic

**User Action:** `PUT /api/detection-strategies/{id}/{modified}`
- Change `x_mitre_analytic_refs` from `['x-mitre-analytic--123']` to `[]`

**Execution Flow:**

1. **DetectionStrategiesService.beforeUpdate(...)**
   - Detect change: `removedRefs = ['x-mitre-analytic--123']`
   - Store: `this._removedAnalyticRefs = ['x-mitre-analytic--123']`
   - Rebuild outbound embedded_relationships (now empty)

2. **BaseService.updateFull()** - Persist document

3. **DetectionStrategiesService.afterUpdate(...)**
   - If `_removedAnalyticRefs` not empty:
     - Emit `x-mitre-detection-strategy::analytics-removed`
       ```javascript
       {
         detectionStrategyId: 'x-mitre-detection-strategy--abc',
         analyticIds: ['x-mitre-analytic--123']
       }
       ```
   - Clean up: `delete this._removedAnalyticRefs`

4. **AnalyticsService** listener receives event
   - For each analyticId:
     - Fetch the analytic
     - Remove inbound embedded_relationship with `stix_id: 'x-mitre-detection-strategy--abc'`
     - Remove ATT&CK external reference (no parent)
     - Save the analytic

## Implementation Guidelines

### For SDO Services

**DO:**
- Override `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate` as needed
- Manage both `stix` and `workspace` fields for your own document type
- Emit domain events when changes affect other services
- Listen to domain events from other services
- Only modify documents of your own type

**DON'T:**
- Override the main CRUD methods (`create`, `updateFull`, `delete`)
- Directly modify documents managed by other services
- Access repositories for other document types just to read - use events
- Implement cross-document logic without events

**Example Service Structure:**

```javascript
class DetectionStrategiesService extends BaseService {
  // Build outbound relationships before save
  async beforeCreate(data, options) {
    // Modify data.workspace.embedded_relationships
  }

  // Emit domain event after save
  async afterCreate(document, options) {
    if (document.stix.x_mitre_analytic_refs?.length > 0) {
      await EventBus.emit('x-mitre-detection-strategy::analytics-referenced', {
        detectionStrategyId: document.stix.id,
        detectionStrategy: document.toObject(),
        analyticIds: document.stix.x_mitre_analytic_refs
      });
    }
  }

  // Similar pattern for beforeUpdate/afterUpdate
}
```

### For Event Listeners

**DO:**
- Initialize listeners in a static `initializeEventListeners()` method
- Handle events asynchronously
- Modify only documents of your own type
- Log errors and continue (don't throw)
- Emit follow-up events if needed

**DON'T:**
- Emit CRUD events (those come from BaseService)
- Assume event ordering
- Perform blocking operations
- Throw errors that would break the event chain

**Example Event Listener:**

```javascript
class AnalyticsService extends BaseService {
  static initializeEventListeners() {
    const EventBus = require('../lib/event-bus');

    EventBus.on(
      'x-mitre-detection-strategy::analytics-referenced',
      this.handleAnalyticsReferenced.bind(this)
    );

    EventBus.on(
      'x-mitre-detection-strategy::analytics-removed',
      this.handleAnalyticsRemoved.bind(this)
    );

    logger.info('AnalyticsService: Event listeners initialized');
  }

  static async handleAnalyticsReferenced(payload) {
    const { detectionStrategy, analyticIds } = payload;

    for (const analyticId of analyticIds) {
      try {
        const analytic = await analyticsRepository.retrieveOneLatestByStixId(analyticId);

        // Add inbound relationship
        if (!analytic.workspace.embedded_relationships) {
          analytic.workspace.embedded_relationships = [];
        }
        analytic.workspace.embedded_relationships.push({
          stix_id: detectionStrategy.stix.id,
          attack_id: detectionStrategy.workspace?.attack_id,
          direction: 'inbound'
        });

        // Update external_references
        // ... rebuild with new URL ...

        await analyticsRepository.saveDocument(analytic);
      } catch (error) {
        logger.error(`Error handling analytics-referenced for ${analyticId}:`, error);
        // Continue processing other analytics
      }
    }
  }
}
```

### Event Bus Best Practices

**DO:**
- Use descriptive domain event names
- Include all relevant context in event payloads
- Use `await` for event emissions to ensure completion before response
- Log events at appropriate levels
- Handle Promise rejections in event handlers

**DON'T:**
- Emit events from within event handlers (can cause cycles)
- Include sensitive data in event payloads
- Rely on handler execution order
- Use events for synchronous validation (use lifecycle hooks)

## EventBus Implementation

Our EventBus extends Node.js's native `EventEmitter` with additional features:

1. **Built on Node.js Standard Library** - Leverages `events.EventEmitter` for reliability
2. **Async/Await Support** - Overrides `emit()` to handle async listeners with `Promise.allSettled`
3. **Logging & Debugging** - Logs all event registrations and emissions
4. **Event Audit Trail** - Maintains circular buffer of recent events for debugging
5. **Singleton Pattern** - Single shared bus instance across the application
6. **Increased Max Listeners** - Set to 50 to accommodate multiple services subscribing to common events

The implementation is minimal - we only add what's necessary beyond the standard EventEmitter.

## Architecture Benefits

### 1. **Traceability**
- Domain event names clearly show what's happening in the business logic
- Logs show: "DetectionStrategiesService referenced analytics" → "AnalyticsService handling reference"
- Easy to follow the flow through the system

### 2. **Ownership & Responsibility**
- Each service owns its complete document (stix + workspace)
- Clear boundaries: DetectionStrategiesService modifies detection strategies, AnalyticsService modifies analytics
- No shared generic services that modify multiple document types

### 3. **Simplicity**
- Direct service-to-service communication via events
- No intermediate manager/coordinator services
- Fewer moving parts to understand

### 4. **Maintainability**
- Changes to relationship logic are localized in the relevant services
- Event names document the domain interactions
- Easy to add new relationship types without infrastructure changes

### 5. **Flexibility**
- Each service can implement domain-specific logic
- Validation rules specific to each document type
- No need to fit into generic patterns

## Design Decisions

### 1. **Direct Service-to-Service Communication**
   - ✅ DetectionStrategiesService emits `analytics-referenced` event
   - ✅ AnalyticsService listens and responds
   - ❌ No generic `EmbeddedRelationshipsManager` intermediary
   - **Rationale:** Simpler, more traceable, respects service ownership

### 2. **Domain Events over Generic Events**
   - ✅ `x-mitre-detection-strategy::analytics-referenced` (clear business meaning)
   - ❌ `embedded-relationships::add-requested` (generic infrastructure)
   - **Rationale:** Domain events tell the story of what happened in business terms

### 3. **Services Own Complete Documents**
   - ✅ Each service manages both `stix` and `workspace` fields
   - ✅ Services only modify their own document types
   - ❌ No shared services that modify workspace across document types
   - **Rationale:** Clear ownership, single source of truth per document type

### 4. **YAGNI - Only Build What's Needed**
   - We have 1-2 embedded relationship use cases
   - Generic infrastructure would be over-engineering
   - If we need more patterns later, we can extract commonalities then
   - **Rationale:** Optimize for the current reality, not hypothetical future

### 5. **Request/Response Blocking**
   - Services `await` event emissions
   - All event handlers complete before HTTP response
   - Ensures data consistency from user's perspective
   - **Rationale:** REST API semantics - operations complete before response

## Migration Status

### Completed ✅
- EventBus implementation (based on Node.js EventEmitter)
- Lifecycle hooks in BaseService (beforeX, afterX patterns)
- Event constants enumeration
- Architecture documentation

### In Progress 🚧
- Refactoring DetectionStrategiesService to emit domain events
- Implementing AnalyticsService event listeners

### Remaining
- End-to-end testing
- Remove temporary test listeners
- Update other services if they need similar patterns
