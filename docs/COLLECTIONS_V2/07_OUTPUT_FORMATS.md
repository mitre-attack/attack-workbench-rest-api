## Output Formats

Release tracks (or rather, each snapshot) can serialize/export to multiple formats via query parameter:

```
GET /api/release-tracks/:id?format=<format>
```

### Format: `bundle` (Default)

Standard STIX 2.1 bundle format:

```json
{
  "type": "bundle",
  "id": "bundle--...",
  "objects": [
    {
      "type": "x-mitre-collection",
      "id": "x-mitre-collection--123",
      "x_mitre_version": "1.1",
      "x_mitre_contents": ["attack-pattern--aaa", "malware--bbb"],
      "name": "ATT&CK Enterprise"
    },
    {
      "type": "attack-pattern",
      "id": "attack-pattern--aaa",
      "name": "Technique A",
      // ... STIX properties only, no workflow info
    }
  ]
}
```

**Characteristics:**
- STIX 2.1 compliant
- Only includes `stix.*` properties
- No workflow states, no workspace data
- Suitable for external publication

### Format: `filesystemstore`

STIX FileSystemStore structure (directory tree):

```
collection-123/
  x-mitre-collection/
    x-mitre-collection--123.json
  attack-pattern/
    attack-pattern--aaa.json
    attack-pattern--bbb.json
  malware/
    malware--xxx.json
```

**Response:**
```json
{
  "format": "filesystemstore",
  "structure": {
    "x-mitre-collection": [
      {
        "filename": "x-mitre-collection--123.json",
        "content": { /* STIX object */ }
      }
    ],
    "attack-pattern": [
      {
        "filename": "attack-pattern--aaa.json",
        "content": { /* STIX object */ }
      }
    ]
  }
}
```

> **NOTE**: The `filesystemstore` is still a *concept* that will need additional refinement before it can be implemented. We will need to figure out an optimal way to return JSON files to the user. Optionally, we can attempt to generate an archive and serialize it over the wire, though this may be slow and error prone. Additionally, we can allow users to specify an output path via S3, FTP, etc. 

### Format: `workbench` (Custom)

Workbench-optimized format with full metadata:

```json
{
  "collection": {
    "id": "x-mitre-collection--123",
    "version": "1.1",
    "name": "ATT&CK Enterprise",
    "modified": "2024-01-15T16:20:00Z"
  },
  "objects": [
    {
      "stix": { /* Full STIX object */ },
      "workspace": {
        "workflow": {
          "status": "reviewed",
          "reviewed_by": "admin@example.com",
          "reviewed_at": "2024-01-14T10:00:00Z"
        }
      },
      "metadata": {
        "collection_tier": "released",  // "released" | "staged" | "candidate"
        "object_type": "attack-pattern",
        "object_name": "Technique A"
      }
    }
  ],
  "summary": {
    "released_count": 2,
    "staged_count": 1,
    "candidate_count": 1
  }
}
```

**Characteristics:**
- Includes workflow states
- Includes workspace metadata
- Optimized for Workbench UI consumption
- Shows which tier each object belongs to

> **NOTE**: The response `workbench` object above is just an example. This is not a prescriptive, final draft. The concept is desribed here to illustrate that we can serve information to the frontend in formats more suitable for UI rendering; we are not beholden to exclusively serving content in STIX-compatible formats. 

### Format Usage

```bash
# Standard STIX bundle for publication
GET /api/release-tracks/:id?format=bundle

# FileSystemStore export
GET /api/release-tracks/:id?format=filesystemstore

# Workbench UI with workflow metadata
GET /api/release-tracks/:id?format=workbench

# Dry run with detailed preview
GET /api/release-tracks/:id/bump/preview?format=workbench
```