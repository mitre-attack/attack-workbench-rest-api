# Cross-Service Communication Pattern

## Core Principle

All cross-service communication — both reads and writes — MUST go through the EventBus.

| Operation | Allowed? | Pattern |
|-----------|----------|---------|
| Service A reads from Service B's repository | ❌ NO | Use events instead |
| Service A writes to Service B's repository | ❌ NO | Use events instead |
| Service A emits event → Service B reads/writes its own data and returns results | ✅ YES | Event-driven pattern |

## Why Cross-Service Reads Are No Longer Permitted

Previously, direct cross-service reads were allowed because `EventBus.emit()` discarded
handler return values, making it impossible to request data from another service over the bus.

With the updated EventBus (commit `9b62521`), `emit()` now collects and returns fulfilled
handler values via `Promise.allSettled`. This means any service can request data from another
service by emitting an event and receiving the result — eliminating the need for the
cross-service reads exception.

**Benefits of routing reads through events:**

1. **Uniform boundary enforcement** — one rule (use events) instead of two (events for writes, direct access for reads)
2. **Traceability** — all cross-service interactions are visible in the event log
3. **Decoupling** — services don't import each other's repositories or modules
4. **Testability** — event handlers are easier to mock than scattered repository imports

## Design Patterns

### ✅ Pattern: Request Data via Event

**When to use:** A service needs data owned by another service (validation, denormalization, etc.)

```javascript
// BaseService needs to check validation bypass rules (owned by ValidationBypassesService)
const EventBus = require('../../lib/event-bus');
const Events = require('../../lib/event-constants');

const results = await EventBus.emit(Events.VALIDATION_BYPASS_CHECK_REQUESTED, {
  errors: allErrors,
  stixType,
});

const filteredErrors = results?.[0] ?? allErrors;
```

The owning service registers a handler that returns the requested data:

```javascript
class ValidationBypassesService {
  static initializeEventListeners() {
    const EventBus = require('../../lib/event-bus');
    const Events = require('../../lib/event-constants');

    EventBus.on(
      Events.VALIDATION_BYPASS_CHECK_REQUESTED,
      ValidationBypassesService.handleBypassCheckRequested.bind(ValidationBypassesService),
    );
  }

  static async handleBypassCheckRequested(payload) {
    const { errors, stixType } = payload;
    // ... filter errors using own repository ...
    return nonBypassedErrors;
  }
}
```

### ✅ Pattern: Denormalize via Event

**When to use:** Building cached metadata (embedded_relationships, computed fields)

```javascript
class DetectionStrategiesService extends BaseService {
  async beforeCreate(data, options) {
    // Request analytic metadata via event
    const results = await EventBus.emit('x-mitre-analytic::metadata-requested', {
      analyticIds: data.stix.x_mitre_analytic_refs,
    });

    const analyticsMetadata = results?.[0] ?? [];
    for (const meta of analyticsMetadata) {
      data.workspace.embedded_relationships.push({
        stix_id: meta.stixId,
        attack_id: meta.attackId,
        name: meta.name,
        direction: 'outbound',
      });
    }
  }

  async afterCreate(document, options) {
    // Emit event so AnalyticsService can update its own documents
    await EventBus.emit('x-mitre-detection-strategy::analytics-referenced', {
      detectionStrategy: document,
      analyticIds: document.stix.x_mitre_analytic_refs,
    });
  }
}
```

### ❌ Anti-Pattern: Direct Cross-Service Import

**Never do this:**

```javascript
class BaseService {
  async validateComposedObject(data) {
    // WRONG: Direct import of another service
    const validationBypassesService = require('../system/validation-bypasses-service');
    const bypassed = await validationBypassesService.isErrorBypassed(error, stixType);
  }
}
```

**Why this is wrong:**
- Creates a hidden dependency between services
- Not visible in the event log
- Harder to test (must mock the imported module)
- Violates the single communication channel principle

### ❌ Anti-Pattern: Direct Cross-Service Repository Read

**Never do this:**

```javascript
class DetectionStrategiesService extends BaseService {
  async beforeCreate(data) {
    // WRONG: Directly reading from another service's repository
    const analytic = await analyticsRepository.retrieveLatestByStixId(analyticId);
  }
}
```

## Event Return Value Convention

When emitting an event that expects a return value:

1. **Single handler expected** — access `results[0]`
2. **Always provide a fallback** — use `results?.[0] ?? fallback` in case no handler is registered
3. **Handler returns data directly** — no wrapper objects needed; the EventBus filters out `null`/`undefined` results

## Migration Checklist

When converting a cross-service read to the event-driven pattern:

1. Define a new event constant in `app/lib/event-constants.js`
2. Register an event handler in the owning service's `initializeEventListeners()`
3. Have the handler return the requested data
4. Replace the direct import/read with `EventBus.emit()` and use the returned value
5. Add a fallback for when no handler is registered (defensive coding)
