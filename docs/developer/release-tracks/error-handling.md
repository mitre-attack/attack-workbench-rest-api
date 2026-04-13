## Error Handling

### AlreadyReleasedError

**Thrown when:** Attempting to bump a snapshot that already has `x_mitre_version` set.

**HTTP Status:** 409 Conflict

**Example:**
```json
{
  "error": "This snapshot has already been tagged as version 1.0"
}
```

**Solution:** Create a new snapshot by modifying the collection, then bump the new snapshot.

### InvalidVersionError

**Thrown when:**
- Explicit version is not valid MAJOR.MINOR format
- Explicit version is not greater than the previous highest version
- Version bump would result in regression

**HTTP Status:** 400 Bad Request

**Examples:**
```json
{
  "error": "Version must be greater than current version 1.5"
}
```

```json
{
  "error": "Invalid version format. Must match pattern: X.Y (e.g., 1.0, 2.3)"
}
```

**Solution:** Provide a valid version that is greater than all previous versions.

### NotFoundError

**Thrown when:** Collection with specified ID does not exist.

**HTTP Status:** 404 Not Found

**Example:**
```json
{
  "error": "Collection not found"
}
```