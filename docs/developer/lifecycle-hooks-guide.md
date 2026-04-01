# Lifecycle Hooks Pattern Guide

## Overview

The BaseService lifecycle hooks pattern provides a structured way for child services to customize CRUD operations without overriding entire methods. This guide clarifies what the BaseService handles vs what child services should override.

## The Three-Stage Lifecycle

Every CRUD operation follows this pattern:

```
beforeX → X → afterX → emitXEvent
```

## What BaseService Handles (The "X" Stage)

### During `create()`:

**BaseService ALWAYS handles:**

1. **Type validation** - Ensures `data.stix.type` matches service type
2. **ATT&CK ID generation** - Generates and assigns `workspace.attack_id` (if applicable)
3. **ATT&CK ID immutability checks** - Prevents users from manually setting ATT&CK IDs
4. **External references validation** - Ensures users don't manually set ATT&CK external references
5. **External reference generation** - Creates and adds ATT&CK external reference
6. **ATT&CK spec version** - Sets `x_mitre_attack_spec_version`
7. **Workflow metadata** - Records `created_by_user_account`
8. **Default marking definitions** - Applies default TLP markings
9. **Organization identity** - Sets `created_by_ref` and `x_mitre_modified_by_ref`
10. **STIX ID generation** - Generates UUID-based STIX ID if not provided
11. **Database persistence** - Calls `repository.save(data)`

### During `updateFull()`:

**BaseService ALWAYS handles:**

1. **Fetch existing document** - Retrieves document by version
2. **ATT&CK ID immutability checks** - Ensures `workspace.attack_id` hasn't changed
3. **External references validation** - Validates client-provided ATT&CK references match expected values
4. **External reference repair** - Adds missing URLs or entire references if needed
5. **Database persistence** - Calls `repository.updateAndSave()`

### During `delete()`:

**BaseService ALWAYS handles:**

1. **Fetch and delete** - Retrieves and removes document
2. **Database persistence** - Calls `repository.delete()`

## What Child Services Should Override

### Use `beforeX` hooks when you need to:

#### `beforeCreate(data, options)`

**MODIFY DATA before it's saved:**

- ✅ Set default values for STIX properties
- ✅ Validate domain-specific rules
- ✅ Compute derived properties that go INTO the document being created
- ✅ Build `workspace.embedded_relationships` (outbound)
- ✅ Transform user input into canonical format

**Examples:**
```javascript
async beforeCreate(data, options) {
  // Example 1: Set defaults
  if (data.stix.type === 'malware' && typeof data.stix.is_family !== 'boolean') {
    data.stix.is_family = true;
  }

  // Example 2: Build embedded relationships
  const analyticRefs = data.stix?.x_mitre_analytic_refs || [];
  if (analyticRefs.length > 0) {
    const embeddedRels = await EmbeddedRelationshipsManager.buildOutboundRelationships(
      analyticRefs,
      (id) => this.repository.retrieveLatestByStixId(id)
    );
    data.workspace.embedded_relationships.push(...embeddedRels);
  }

  // Example 3: Validate domain rules
  if (data.stix.x_mitre_is_subtechnique && !options.parentTechniqueId) {
    throw new Error('Subtechniques require parentTechniqueId');
  }
}
```

**DO NOT:**
- ❌ Modify OTHER documents (use `afterX` or event listeners)
- ❌ Call `super.beforeCreate()` (it's a no-op)
- ❌ Emit events (BaseService handles this)

#### `beforeUpdate(stixId, stixModified, data, existingDocument)`

**MODIFY DATA before it's saved:**

- ✅ Validate changes are allowed
- ✅ Compare old vs new values to detect changes
- ✅ Update `workspace.embedded_relationships` based on changes
- ✅ Store change detection results in instance variables for use in `afterUpdate`

**Examples:**
```javascript
async beforeUpdate(stixId, stixModified, data, existingDocument) {
  // Example 1: Detect changes
  const oldRefs = existingDocument.stix.x_mitre_analytic_refs || [];
  const newRefs = data.stix?.x_mitre_analytic_refs || [];

  this._addedRefs = newRefs.filter(ref => !oldRefs.includes(ref));
  this._removedRefs = oldRefs.filter(ref => !newRefs.includes(ref));

  // Example 2: Update embedded relationships
  const nonAnalyticRels = (data.workspace.embedded_relationships || []).filter(
    rel => !rel.stix_id?.startsWith('x-mitre-analytic--')
  );
  const analyticRels = await EmbeddedRelationshipsManager.buildOutboundRelationships(
    newRefs,
    (id) => this.repository.retrieveLatestByStixId(id)
  );
  data.workspace.embedded_relationships = [...nonAnalyticRels, ...analyticRels];
}
```

**DO NOT:**
- ❌ Modify OTHER documents
- ❌ Perform async operations that modify database (save those for `afterUpdate`)

### Use `afterX` hooks when you need to:

#### `afterCreate(document, options)`

**SIDE-EFFECTS after document is saved:**

- ✅ Update OTHER documents (e.g., add inbound relationships)
- ✅ Trigger background jobs
- ✅ Send notifications
- ✅ Update caches
- ✅ Perform cleanup

**Examples:**
```javascript
async afterCreate(document, options) {
  // Example: Update related documents
  const analyticRefs = document.stix?.x_mitre_analytic_refs || [];
  if (analyticRefs.length > 0) {
    // Add inbound relationships to analytics
    for (const analyticId of analyticRefs) {
      await EmbeddedRelationshipsManager.addInboundRelationship(
        analyticId,
        document,
        (id) => analyticsRepository.retrieveOneLatestByStixId(id),
        (doc) => analyticsRepository.saveDocument(doc)
      );
    }
  }
}
```

**DO NOT:**
- ❌ Modify the `document` parameter (it's already saved)
- ❌ Return a value (return value is ignored)
- ❌ Throw errors unless you want to fail the entire operation

#### `afterUpdate(updatedDocument, previousDocument)`

**SIDE-EFFECTS after document is saved:**

- ✅ Update OTHER documents based on what changed
- ✅ Propagate changes to related objects
- ✅ Trigger background jobs
- ✅ Update derived properties in other documents

**Examples:**
```javascript
async afterUpdate(updatedDocument, previousDocument) {
  // Use instance variables from beforeUpdate
  if (this._addedRefs?.length > 0) {
    for (const analyticId of this._addedRefs) {
      await EmbeddedRelationshipsManager.addInboundRelationship(
        analyticId,
        updatedDocument,
        (id) => analyticsRepository.retrieveOneLatestByStixId(id),
        (doc) => analyticsRepository.saveDocument(doc)
      );
    }
  }

  if (this._removedRefs?.length > 0) {
    for (const analyticId of this._removedRefs) {
      await EmbeddedRelationshipsManager.removeInboundRelationship(
        analyticId,
        updatedDocument.stix.id,
        (id) => analyticsRepository.retrieveOneLatestByStixId(id),
        (doc) => analyticsRepository.saveDocument(doc)
      );
    }
  }

  // Clean up instance variables
  delete this._addedRefs;
  delete this._removedRefs;
}
```

### Use Event Listeners when you need to:

**REACT to changes in OTHER documents:**

- ✅ Update derived properties when dependencies change
- ✅ Maintain consistency across document boundaries
- ✅ Decouple cross-service dependencies

**Examples:**
```javascript
// In AnalyticsService initialization
class AnalyticsService extends BaseService {
  static initialize() {
    const EventBus = require('../lib/event-bus');
    const EventConstants = require('../lib/event-constants');

    EventBus.on(
      EventConstants.EMBEDDED_RELATIONSHIP_ADDED,
      this.handleEmbeddedRelationshipAdded.bind(this)
    );

    EventBus.on(
      EventConstants.EMBEDDED_RELATIONSHIP_REMOVED,
      this.handleEmbeddedRelationshipRemoved.bind(this)
    );
  }

  static async handleEmbeddedRelationshipAdded(payload) {
    const { targetId, target } = payload;

    // Only handle analytics
    if (!targetId.startsWith('x-mitre-analytic--')) {
      return;
    }

    // Rebuild external_references with updated URL
    // ...
  }
}
```

## Services That Should Be Refactored

Based on analysis of existing code, here are services that currently override `create()` or `updateFull()` and should be evaluated for migration to lifecycle hooks:

### High Priority (Embedded Relationships)

1. **DetectionStrategiesService** ⚠️ ALREADY PARTIALLY MIGRATED
   - Currently: Overrides `create()` and `updateFull()`
   - Should: Use `beforeCreate/afterCreate` and `beforeUpdate/afterUpdate`
   - Reason: Manages embedded relationships with analytics

2. **AnalyticsService** ⚠️ ALREADY PARTIALLY MIGRATED
   - Currently: Overrides `updateFull()`
   - Should: Use `beforeUpdate` + event listeners for relationship changes
   - Reason: External references depend on parent detection strategy

### Medium Priority (Domain-Specific Defaults)

3. **SoftwareService**
   - Currently: Overrides `create()` to set `is_family` defaults for malware vs tools
   - Should: Use `beforeCreate()` to set defaults
   - Pattern:
     ```javascript
     async beforeCreate(data, options) {
       if (data.stix.type === 'malware' && typeof data.stix.is_family !== 'boolean') {
         data.stix.is_family = true;
       }
       if (data.stix.type === 'tool' && data.stix.is_family !== undefined) {
         throw new PropertyNotAllowedError();
       }
     }
     ```

4. **CollectionsService**
   - Currently: Overrides `create()` and `updateFull()` for custom logic
   - Should: Analyze and potentially use lifecycle hooks
   - Needs investigation: What custom logic does it have?

5. **CollectionIndexesService**
   - Currently: Overrides methods for indexing logic
   - Should: Investigate if this can use `afterCreate/afterUpdate` + events

### Low Priority (Non-SDO Services)

6. **IdentitiesService** - System object, may need special handling
7. **MarkingDefinitionsService** - System object, may need special handling
8. **ReferencesService** - Not a STIX object, different pattern
9. **TeamsService** - Not a STIX object, different pattern
10. **UserAccountsService** - Not a STIX object, different pattern

## Migration Checklist

For each service being migrated:

- [ ] Identify what happens BEFORE database save → Move to `beforeX`
- [ ] Identify what modifies the document being saved → Move to `beforeX`
- [ ] Identify what happens AFTER database save → Move to `afterX`
- [ ] Identify what modifies OTHER documents → Move to `afterX` or event listeners
- [ ] Remove the `async create()` or `async updateFull()` override
- [ ] Test that all functionality still works
- [ ] Verify events are emitted correctly
- [ ] Check that error handling is preserved

## Anti-Patterns to Avoid

### ❌ DON'T override the main CRUD method

```javascript
// BAD
async create(data, options) {
  // Custom logic
  data.stix.custom_field = 'value';

  // Call parent
  const doc = await super.create(data, options);

  // More custom logic
  await this.updateRelatedDocuments(doc);

  return doc;
}
```

### ✅ DO use lifecycle hooks

```javascript
// GOOD
async beforeCreate(data, options) {
  // Modify data before save
  data.stix.custom_field = 'value';
}

async afterCreate(document, options) {
  // Side effects after save
  await this.updateRelatedDocuments(document);
}
```

### ❌ DON'T modify other documents in `beforeX`

```javascript
// BAD - modifying other documents before save
async beforeCreate(data, options) {
  await otherRepository.updateSomething(); // ❌ Too early!
}
```

### ✅ DO modify other documents in `afterX`

```javascript
// GOOD - side effects happen after save
async afterCreate(document, options) {
  await otherRepository.updateSomething(); // ✅ Safe!
}
```

### ❌ DON'T emit events manually

```javascript
// BAD
async afterCreate(document, options) {
  await EventBus.emit('custom-event', { ... });
  await EventBus.emit(`${this.type}.created`, { ... }); // ❌ BaseService does this!
}
```

### ✅ DO let BaseService emit CRUD events

```javascript
// GOOD - BaseService automatically emits CRUD events
// Only emit specialized domain events if needed
async afterCreate(document, options) {
  if (someSpecialCondition) {
    await EventBus.emit(EventConstants.DETECTION_STRATEGY_ANALYTICS_CHANGED, {
      stixId: document.stix.id,
      addedRefs: [...],
      document
    });
  }
}
```

## Benefits of This Pattern

1. **Separation of Concerns** - BaseService handles infrastructure, child services handle domain logic
2. **Consistency** - All services follow the same pattern
3. **Testability** - Easy to test hooks in isolation
4. **Maintainability** - Clear boundaries between responsibilities
5. **Event-Driven** - Natural integration with EventBus
6. **Debuggability** - Lifecycle stages are explicit and logged
