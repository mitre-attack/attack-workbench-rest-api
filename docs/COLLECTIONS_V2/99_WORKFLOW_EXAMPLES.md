## Workflow Examples

### Example 1: Standard Release Cycle

```bash
# 1. Create initial collection
POST /api/release-tracks/new
{ "name": "My Release", ... }
# Creates: snapshot 1, x_mitre_version: null

# 2. Update contents
POST /api/release-tracks/release--123/contents
{ "x_mitre_contents": [...] }
# Creates: snapshot 2, x_mitre_version: null

# 3. Update metadata
POST /api/release-tracks/release--123/meta
{ "description": "Updated description" }
# Creates: snapshot 3, x_mitre_version: null

# 4. Ready for first release - tag as v1.0
POST /api/release-tracks/release--123/bump
{ "type": "major" }
# Updates: snapshot 3, x_mitre_version: "1.0" (IN-PLACE)

# 5. Continue development
POST /api/release-tracks/release--123/contents
{ "x_mitre_contents": [...] }
# Creates: snapshot 4, x_mitre_version: null

# 6. Minor release
POST /api/release-tracks/release--123/bump
{ "type": "minor" }
# Updates: snapshot 4, x_mitre_version: "1.1" (IN-PLACE)

# 7. More changes
POST /api/release-tracks/release--123/contents
{ "x_mitre_contents": [...] }
# Creates: snapshot 5, x_mitre_version: null

# 8. Another minor release
POST /api/release-tracks/release--123/bump
{ "type": "minor" }
# Updates: snapshot 5, x_mitre_version: "1.2" (IN-PLACE)
```

**Resulting Timeline:**
```
snapshot 1: modified: T1, x_mitre_version: null
snapshot 2: modified: T2, x_mitre_version: null
snapshot 3: modified: T3, x_mitre_version: "1.0" ← RELEASE
snapshot 4: modified: T4, x_mitre_version: "1.1" ← RELEASE
snapshot 5: modified: T5, x_mitre_version: "1.2" ← RELEASE
```

### Example 2: Selective Release Tagging

```bash
# Create several snapshots
POST /api/collections/collection--456/contents  # snapshot 1
POST /api/collections/collection--456/contents  # snapshot 2
POST /api/collections/collection--456/contents  # snapshot 3
POST /api/collections/collection--456/contents  # snapshot 4
POST /api/collections/collection--456/contents  # snapshot 5

# Only tag snapshots 2 and 5 as releases
POST /api/collections/collection--456/modified/<snapshot-2-timestamp>/bump
{ "version": "1.0" }

POST /api/collections/collection--456/bump  # Latest = snapshot 5
{ "version": "1.1" }
```

**Resulting Timeline:**
```
snapshot 1: x_mitre_version: null (skipped)
snapshot 2: x_mitre_version: "1.0" ← RELEASE
snapshot 3: x_mitre_version: null (skipped)
snapshot 4: x_mitre_version: null (skipped)
snapshot 5: x_mitre_version: "1.1" ← RELEASE
```

This mirrors Git's ability to tag any commit, not just the latest.

### Example 3: Handling Already-Released Snapshots

```bash
# Tag latest snapshot
POST /api/collections/collection--789/bump
{ "version": "1.0" }
# Success: snapshot tagged as v1.0

# Attempt to bump the same snapshot again
POST /api/collections/collection--789/bump
{ "version": "1.1" }
# Error: AlreadyReleasedError - "This snapshot has already been tagged as version 1.0"

# Solution: Make a change first (creates new snapshot)
POST /api/collections/collection--789/contents
{ "x_mitre_contents": [...] }
# Creates new snapshot

# Now bump the new snapshot
POST /api/collections/collection--789/bump
{ "version": "1.1" }
# Success: new snapshot tagged as v1.1
```
