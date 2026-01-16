# STIX Versioning and Embedded Relationships

## Overview

This document explains how STIX versioning works in the ATT&CK Workbench REST API, and how it interacts with the embedded relationships feature. Understanding these concepts is critical for developers working with the event-driven architecture.

---

## STIX Versioning: POST vs PUT

The ATT&CK Workbench implements STIX 2.1 versioning semantics with two distinct update mechanisms:

### POST - Creating New Versions (Versioned History)

**Endpoint:** `POST /api/{type}`

**Behavior:**
- Creates a **new Mongoose document** in the database
- Used when `stix.id` already exists but `stix.modified` is different
- Builds a **temporal version chain** of immutable snapshots
- Each version is a complete, independent document
- Versions are linked by sharing the same `stix.id`

**Example:**
```javascript
// First version
POST /api/data-components
{
  stix: {
    id: "x-mitre-data-component--123",
    modified: "2024-01-01T00:00:00.000Z",
    name: "Process Creation"
  }
}

// Second version (creates NEW document)
POST /api/data-components
{
  stix: {
    id: "x-mitre-data-component--123",  // Same ID
    modified: "2024-02-01T00:00:00.000Z", // Different modified
    name: "Process Creation Events"      // Updated content
  }
}
```

**Result:** Two separate Mongoose documents in the database:
1. Document with `modified: "2024-01-01T00:00:00.000Z"` (unchanged)
2. Document with `modified: "2024-02-01T00:00:00.000Z"` (new)

**Use Case:**
- **Primary update mechanism** in the Workbench frontend
- Preserves complete edit history
- Enables rollback to previous versions
- Supports audit trails and compliance requirements

**Lifecycle Hooks Triggered:**
- `beforeCreate`
- `afterCreate`
- `emitCreatedEvent`

---

### PUT - Editing Existing Snapshots (In-Place Modification)

**Endpoint:** `PUT /api/{type}/{id}/modified/{modified}`

**Behavior:**
- **Updates an existing Mongoose document** in-place
- Targets a specific version by `stix.id` AND `stix.modified`
- Uses `_.merge()` to apply changes to the document
- Increments Mongoose `__v` field (optimistic locking counter)
- No new document created - modifies the snapshot directly

**Example:**
```javascript
// Update the 2024-01-01 version in-place
PUT /api/data-components/x-mitre-data-component--123/modified/2024-01-01T00:00:00.000Z
{
  stix: {
    description: "Updated description"
  }
}
```

**Result:** The existing document is modified:
- Same `_id` in MongoDB
- Same `stix.modified` timestamp
- `__v` incremented from 0 to 1
- Content updated via `_.merge(document, data)`

**Use Case:**
- **Rarely used** in practice
- Useful for fixing typos in historical snapshots
- Administrative corrections without creating new versions

**Lifecycle Hooks Triggered:**
- `beforeUpdate`
- `afterUpdate`
- `emitUpdatedEvent`

**Important Note on `_.merge()` Behavior:**
- Lodash `_.merge()` performs a **deep merge**
- Properties present in the target but **omitted** from the source are **NOT deleted**
- To remove a property, you must **explicitly set it to `null`**

```javascript
// This does NOT remove x_mitre_data_source_ref:
PUT /api/data-components/{id}/modified/{modified}
{
  stix: {
    name: "New Name"
    // x_mitre_data_source_ref omitted
  }
}

// This DOES remove x_mitre_data_source_ref:
PUT /api/data-components/{id}/modified/{modified}
{
  stix: {
    name: "New Name",
    x_mitre_data_source_ref: null  // Explicitly set to null
  }
}
```

---

## Querying Versions

### Get Latest Version
```javascript
GET /api/data-components/{id}?versions=latest
// Returns the single latest version
```

### Get All Versions
```javascript
GET /api/data-components/{id}?versions=all
// Returns array of all versions, ordered by modified date
```

### Get Specific Version
```javascript
GET /api/data-components/{id}/modified/{modified}
// Returns a specific snapshot
```

---

## Embedded Relationships and Versioning

### The Design Choice

Embedded relationships are stored **directly on the STIX documents** under `workspace.embedded_relationships`:

```javascript
{
  stix: { /* STIX properties */ },
  workspace: {
    attack_id: "DS0029",
    embedded_relationships: [
      {
        stix_id: "x-mitre-data-source--abc",
        attack_id: "DS0001",  // Immutable, safe to denormalize
        direction: "outbound"
        // Note: 'name' is NOT stored - fetched on read if needed
      },
      {
        stix_id: "x-mitre-analytic--def",
        attack_id: "DA-0001",  // Immutable, safe to denormalize
        direction: "inbound"
        // Note: 'name' is NOT stored - fetched on read if needed
      }
    ]
  }
}
```

**What's Stored:**
- ✅ `stix_id` (required) - Reference to the related object
- ✅ `attack_id` (optional) - Immutable, server-generated identifier
- ✅ `direction` (required) - 'inbound' or 'outbound'
- ❌ `name` - NOT stored (mutable, must be fetched on read)

**Why Not Store Names:**
- Names are **mutable** - users can change them via PUT/POST operations
- Storing them would create **data staleness** issues
- Would require **event propagation** to keep in sync across all references
- MongoDB warns against **unbounded arrays** with duplicated mutable data

**Benefits:**
- ✅ **Minimal storage** - Only essential relationship data
- ✅ **Always current data** - Names fetched fresh when needed
- ✅ **No sync complexity** - No events needed for name changes
- ✅ **Smaller documents** - Reduces risk of hitting 16MB BSON limit
- ✅ **attack_id denormalization** - Safe because it's immutable

**Trade-offs:**
- ⚠️ **Additional queries for names** - Must fetch referenced docs when names are needed
- ❌ **No relationship versioning** - Only latest version tracked
- ❌ **Temporal inconsistency** - Old snapshots may have "broken" references

### Special Case: Fetching Names On-Demand

When names are needed for embedded relationships (e.g., for display in the frontend), services implement on-demand name lookup:

**Example: AnalyticsService with `includeEmbeddedRelationships=true`**

```javascript
async populateEmbeddedRelationshipNames(analytics) {
  const detectionStrategiesRepository = require('../../repository/detection-strategies-repository');

  for (const analytic of analytics) {
    if (!analytic.workspace?.embedded_relationships) continue;

    for (const rel of analytic.workspace.embedded_relationships) {
      if (rel.direction === 'inbound' && rel.stix_id?.startsWith('x-mitre-detection-strategy--')) {
        try {
          const detectionStrategy = await detectionStrategiesRepository.retrieveLatestByStixId(rel.stix_id);
          if (detectionStrategy) {
            rel.name = detectionStrategy.stix.name; // Transient property, not persisted
          } else {
            rel.name = null;
          }
        } catch (error) {
          logger.error(`AnalyticsService: Error fetching detection strategy ${rel.stix_id}:`, error);
          rel.name = null;
        }
      }
    }
  }
}
```

**Key Points:**
- Names are added as **transient properties** to the embedded relationship objects
- Names are **never saved** to the database
- Names are **always fresh** - fetched from the latest version of the referenced object
- This pattern is used sparingly, only when the frontend explicitly needs names

---

## The Temporal Consistency Problem

### The Scenario

Consider this sequence of operations:

1. **POST** a new data source: `DS1`
   - Creates: 1 document for DS1
   - `DS1.workspace.embedded_relationships = []`

2. **POST** a new data component: `DC1` (version 1)
   - Creates: 1 document for DC1 v1
   - `DC1.workspace.embedded_relationships = []`

3. **POST** an update for `DC1` that references `DS1` (version 2)
   - Creates: NEW document for DC1 v2
   - Modifies: Existing DS1 document (in-place)
   - Result:
     - DC1 v1: `embedded_relationships = []` (unchanged)
     - DC1 v2: `embedded_relationships = [outbound → DS1]` (new)
     - DS1: `embedded_relationships = [inbound ← DC1]` (modified, `__v` = 1)

4. **POST** another update for `DC1` that removes the reference (version 3)
   - Creates: NEW document for DC1 v3
   - Modifies: Existing DS1 document (in-place)
   - Result:
     - DC1 v1: `embedded_relationships = []` (unchanged)
     - DC1 v2: `embedded_relationships = [outbound → DS1]` (unchanged)
     - DC1 v3: `embedded_relationships = []` (new)
     - DS1: `embedded_relationships = []` (modified, `__v` = 2)

### The Temporal Mismatch

After step 4:
- **DC1 v2 (historical snapshot)** says: "I reference DS1"
- **DS1 (current state)** says: "No data components reference me"

This is a **temporal coupling problem**:
- Data components are **versioned** (immutable snapshots)
- Data sources are **non-versioned** for relationships (mutable state)

---

## Is This a Problem?

### Short Answer: **Acceptable for Most Use Cases**

The design prioritizes **operational performance** over **historical queryability**, which is the right trade-off for a knowledge base editing tool where users primarily work with current state.

### When It's NOT a Problem (99% of Use Cases)

#### 1. Latest Version Queries
```javascript
// User queries: "Give me DC1"
GET /api/data-components/x-mitre-data-component--123

// Returns: Latest snapshot (v3)
// embedded_relationships = []  ✅ Correct

// User queries: "Give me DS1"
GET /api/data-sources/x-mitre-data-source--456

// Returns: Current state
// embedded_relationships = []  ✅ Correct
```
**Both are in harmony** ✅

#### 2. Historical Queries for Single Object
```javascript
// "What did DC1 look like on 2024-01-15?"
GET /api/data-components/x-mitre-data-component--123/modified/2024-01-15T...

// Returns: Snapshot from that date
// Shows DC1 referenced DS1, which is factually correct ✅
```

#### 3. Audit Trail / Change History
```javascript
// "When did DC1 start referencing DS1?"
GET /api/data-components/x-mitre-data-component--123?versions=all

// Can determine exactly when x_mitre_data_source_ref was added ✅
```

### When It IS a Problem (Rare Cases)

#### 1. Historical "Point-in-Time" Queries Across Objects
```javascript
// "Show me DS1 as it existed on 2024-01-15,
//  including which data components referenced it"
```

**Problem:** DS1 doesn't have relationship snapshots, so you can't reconstruct its `embedded_relationships` at that point in time ❌

**Workaround:** Query all DC1 snapshots from that date and reconstruct (expensive)

#### 2. Bidirectional Navigation from Old Snapshots

**Scenario:**
- User views DC1 v2 (historical snapshot from 2024-01-15)
- User clicks "Show parent data source"
- DS1 loads with current state

**Problem:**
- DC1 v2 says: "I reference DS1"
- DS1 (current) says: "No data components reference me"
- Confusing user experience ❌

**Mitigation:** UI should clearly indicate "viewing historical snapshot"

#### 3. Rollback Scenarios

**Scenario:** User wants to "roll back" to DC1 v2

**Problem:**
- DC1 gets restored
- DS1's `embedded_relationships` are out of sync
- Would need to emit events to rebuild DS1's relationships ❌

**Mitigation:** Rollback operations would need to trigger relationship recalculation

---

## Why This Design Was Chosen

### Performance Requirements

The ATT&CK knowledge base contains:
- ~700 techniques
- ~200 groups
- ~700 software
- ~30 data sources
- ~100+ data components
- Thousands of relationships

**If relationships were in a separate collection:**
- Every "get data source with components" query requires a join
- Displaying the knowledge base matrix becomes expensive
- API response times degrade

**With embedded relationships:**
- Single document lookup
- Immutable metadata (attack_id) is denormalized for fast access
- Mutable data (names) fetched on-demand when needed
- Fast reads for the common case (latest version)

### Acceptable Trade-offs

1. **Historical relationship queries are rare**
   - Users primarily work with latest versions
   - Historical analysis is edge case, can be expensive

2. **Relationship history is preserved in DC snapshots**
   - Can reconstruct if needed, just slower
   - The data isn't lost, just requires more work to query

3. **Temporal inconsistency is documented**
   - UI can indicate historical snapshot viewing
   - Users understand they're looking at a point-in-time view

4. **No event sourcing requirements**
   - System doesn't rely on event replay to rebuild state
   - Events are for coordination, not source of truth

---

## Implementation Details

### How Events Handle Versioning

When a new version of DC1 is created via POST:

**In `DataComponentsService.beforeCreate()`:**
```javascript
// Check if this is a new version
let previousVersion = null;
if (data.stix?.id) {
  try {
    previousVersion = await dataComponentsRepository.retrieveLatestByStixId(data.stix.id);
  } catch {
    // First version, no previous
  }
}

// Compare old vs new
const oldDataSourceRef = previousVersion?.stix?.x_mitre_data_source_ref;
const newDataSourceRef = data.stix?.x_mitre_data_source_ref;

// Detect changes
if (oldDataSourceRef && !newDataSourceRef) {
  this._removedDataSourceRef = oldDataSourceRef;  // Reference removed
}
```

**In `DataComponentsService.afterCreate()`:**
```javascript
// Emit removed event for old reference
if (this._removedDataSourceRef) {
  await EventBus.emit('x-mitre-data-component::data-source-removed', {
    dataComponentId: createdDocument.stix.id,
    dataSourceId: this._removedDataSourceRef
  });
}
```

**In `DataSourcesService` event listener:**
```javascript
static async handleDataSourceRemoved(payload) {
  const { dataComponentId, dataSourceId } = payload;

  // Update DS1 (in-place)
  const dataSource = await dataSourcesRepository.retrieveLatestByStixId(dataSourceId);

  // Remove inbound relationship
  dataSource.workspace.embedded_relationships =
    dataSource.workspace.embedded_relationships.filter(
      rel => !(rel.stix_id === dataComponentId && rel.direction === 'inbound')
    );

  await dataSourcesRepository.saveDocument(dataSource);
}
```

This ensures that:
- DC1 v3 has correct `embedded_relationships = []`
- DS1 has correct `embedded_relationships = []`
- Both latest versions are in harmony ✅

---

## Potential Improvements (If Needed)

### Option 1: Accept the Limitation (Recommended)

**Actions:**
1. Document this behavior clearly (this document!)
2. Add UI indicators when viewing historical snapshots
3. Provide a "reconstruct relationships at point-in-time" utility if needed

**Pros:**
- No code changes needed
- Keeps performance benefits
- Works for 99% of use cases

**Cons:**
- Historical bidirectional queries are expensive

### Option 2: Snapshot Embedded Relationships Separately

Create a separate collection to track relationship history:

```javascript
// New collection: embedded_relationships_history
{
  source_id: "x-mitre-data-component--123",
  source_modified: "2024-01-15T...",
  target_id: "x-mitre-data-source--456",
  direction: "outbound",
  created_at: "2024-01-15T...",
  deleted_at: null  // or timestamp when removed
}
```

**Pros:**
- Full historical tracking
- Can reconstruct any point-in-time state
- Bidirectional queries at any date

**Cons:**
- More storage
- More complex queries
- Adds another collection to maintain

### Option 3: Version Data Sources Too

Make data sources fully versioned like data components.

**Pros:**
- Perfect temporal consistency
- Every snapshot has matching embedded relationships

**Cons:**
- MUCH more storage (DS1 duplicated on every DC1 change)
- More complex queries (need to find "right" version)
- Breaking change to existing architecture

### Option 4: Hybrid - Snapshot Only on Relationship Changes

Only create DS1 snapshots when its `embedded_relationships` actually change.

**Pros:**
- Less storage than full versioning
- Preserves relationship history

**Cons:**
- Still adds complexity
- Harder to implement correctly

---

## Best Practices

### For API Consumers

1. **Use POST for updates** (default in Workbench frontend)
   - Creates proper version history
   - Enables rollback
   - Triggers correct lifecycle hooks

2. **Use PUT sparingly**
   - Only for administrative corrections
   - Be aware of `_.merge()` behavior
   - Explicitly set fields to `null` to remove them

3. **Query latest versions by default**
   - `GET /api/data-components/{id}?versions=latest`
   - This is what users see in the UI

4. **Indicate historical snapshots in UI**
   - Show banner: "Viewing historical version from 2024-01-15"
   - Warn that relationships reflect current state, not historical

### For Service Developers

1. **Implement both lifecycle hooks**
   - `beforeCreate` / `afterCreate` for POST operations (versioning)
   - `beforeUpdate` / `afterUpdate` for PUT operations (in-place edits)

2. **Detect version changes in `beforeCreate`**
   - Fetch previous latest version
   - Compare old vs new values
   - Store change tracking in instance variables

3. **Emit events for both added and removed relationships**
   - Don't assume POST only adds relationships
   - New versions can remove relationships too

4. **Handle "no previous version" case**
   - First version creation is valid
   - Emit "referenced" events for initial state

5. **Never store mutable data in embedded_relationships**
   - Only store: `stix_id` (required), `attack_id` (immutable), `direction` (required)
   - Never store: `name` or other mutable properties
   - Implement on-demand name lookup only if the frontend requires it
   - Use transient properties that are never persisted to the database

---

## Summary

**The current design is acceptable** because:

✅ ATT&CK Workbench primarily operates on "latest versions"
✅ Historical snapshots show accurate outbound relationships
✅ Historical state can be reconstructed if needed (just expensive)
✅ Performance benefits outweigh historical query complexity
✅ True point-in-time consistency is rarely needed

The design prioritizes **operational performance** over **historical queryability**, which is the right trade-off for a knowledge base editing tool.

If you find yourself frequently needing complete historical relationship graphs, consider implementing Option 2 (separate relationship history collection). But for now, this is a **reasonable and well-documented design choice**.

---

## Related Documentation

- [EVENT_BUS_ARCHITECTURE.md](EVENT_BUS_ARCHITECTURE.md) - Event-driven architecture patterns
- [LIFECYCLE_HOOKS_GUIDE.md](LIFECYCLE_HOOKS_GUIDE.md) - Service lifecycle hooks
- [STIX 2.1 Specification](https://docs.oasis-open.org/cti/stix/v2.1/stix-v2.1.html) - Official STIX standard
