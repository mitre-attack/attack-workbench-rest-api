# Implementation Notes

## Database Indexes

```javascript
// Collection candidates lookup
db.collections.createIndex({ 'workspace.candidates.object_ref': 1 });
db.collections.createIndex({ 'workspace.candidates.status': 1 });

// Object collection membership
db.objects.createIndex({ 'workspace.collections.candidates': 1 });
db.objects.createIndex({ 'workspace.collections.staged': 1 });
db.objects.createIndex({ 'workspace.workflow.status': 1 });
```

## Validation Rules

- **Same object version** can only be in one tier per collection (candidates OR staged OR released)
- **Different versions** of same object CAN exist in multiple tiers simultaneously
- Status transitions must be valid: WIP → Awaiting → Reviewed (no backwards transitions)
- Candidacy threshold must be valid enum value
- Object version must exist before adding as candidate (validate `stix.id` and `stix.modified` exist)
- Version pin (`object_modified`) is immutable once set for a tier entry

## Performance Considerations

- Bulk operations should use batch updates
- Event handlers should be async and non-blocking
- Large collections (>10k objects) may need pagination
- Consider caching for `bump/preview` on large collections

## Integrating with the Event-Driven Architecture

### Events Published

```javascript
// When object status changes within a collection (collection-scoped)
eventBus.emit('release-track:status-changed', {
  collectionId: 'x-mitre-collection--123',
  objectId: 'attack-pattern--eee',
  objectModified: '2024-01-12T09:00:00Z',  // Version pin
  oldStatus: 'work-in-progress',
  newStatus: 'awaiting-review',
  changedBy: 'user@example.com',
  changedAt: '2024-01-15T10:00:00Z'
});

// When object version is added to collection candidates
eventBus.emit('release-track:candidate-added', {
  collectionId: 'x-mitre-collection--123',
  objectId: 'attack-pattern--eee',
  objectModified: '2024-01-12T09:00:00Z',  // Version pin
  status: 'work-in-progress',
  addedBy: 'user@example.com'
});

// When object is promoted to staged
eventBus.emit('release-track:object-staged', {
  collectionId: 'x-mitre-collection--123',
  objectId: 'attack-pattern--ddd',
  objectModified: '2024-01-14T10:00:00Z',  // Version pin
  status: 'reviewed',
  promotedBy: 'auto' // or user email
});

// When collection is bumped
eventBus.emit('release-track:released', {
  collectionId: 'x-mitre-collection--123',
  version: '1.2',
  promotedCount: 1,
  promotedObjects: [
    {
      objectId: 'attack-pattern--ddd',
      objectModified: '2024-01-14T10:00:00Z'  // Version included in release
    }
  ],
  releasedBy: 'admin@example.com'
});
```

### Event Handlers

```javascript
// Auto-promote on status change (collection-scoped)
eventBus.on('release-track:status-changed', async (event) => {
  if (event.newStatus === 'reviewed') {
    const collection = await Collection.findById(event.collectionId);

    if (collection.workspace.config.auto_promote) {
      // Move this specific version from candidates to staged
      await promoteToStaged(
        collection,
        event.objectId,
        event.objectModified  // Preserve version pin
      );
    }
  }
});

// Update object's referenced_by tracking
eventBus.on('release-track:object-staged', async (event) => {
  // Update the specific object version
  await updateObject(
    { 'stix.id': event.objectId, 'stix.modified': event.objectModified },
    {
      $set: {
        'workspace.referenced_by.$[elem].tier': 'staged',
        'workspace.referenced_by.$[elem].status': event.status
      }
    },
    {
      arrayFilters: [
        {
          'elem.collection_id': event.collectionId,
          'elem.tier': 'candidates'
        }
      ]
    }
  );
});
```
