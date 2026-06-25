# Importing a STIX Bundle

The ATT&CK Workbench REST API can ingest a STIX 2.1 bundle that wraps an
ATT&CK collection (`x-mitre-collection`). The endpoint persists every
object in the bundle, populates ATT&CK Workbench metadata on each one,
and returns a single response document summarizing what happened.

Bundles are imported **as-is**: the `stix` content of every persisted
object matches what was in the bundle, byte-for-byte. Workbench adds
metadata in a separate `workspace` namespace but does not alter the
bundle's STIX fields. This guarantee holds even when Workbench's
hooks would otherwise rewrite fields like `stix.name`,
`stix.aliases`, or `stix.external_references` on a user-driven POST.

## Usage

```
POST /api/collection-bundles
Content-Type: application/json
```

**Request body**: a STIX 2.1 bundle whose `objects` array contains
exactly one `x-mitre-collection` object and any number of
collection-member objects.

### Query parameters

| Parameter | Type | Default | Effect |
|---|---|---|---|
| `previewOnly` | boolean | `false` | Process the bundle and return the would-be import response without persisting anything. |
| `checkOnly` | boolean | `false` | Synonymous with `previewOnly` for backwards compatibility. |
| `validateContents` | boolean | `false` | When `true`, ADM validation is strict — see [Validation modes](#validation-modes). When `false` (default), validation runs but failures are recorded rather than rejected. |
| `forceImport` | repeated string | (none) | Allow import to proceed past specific blocking conditions. Supported values: `attack-spec-version-violations`, `duplicate-collection`. |

## Validation modes

Every object in the bundle is validated against the ATT&CK Data Model
(ADM) schemas during import — provided that ADM validation is enabled
in the deployment (`VALIDATE_WITH_ADM_SCHEMAS`, default `true`).
Objects marked `revoked: true` or `x_mitre_deprecated: true` skip
validation; everything else is checked.

The behavior on validation failure depends on `validateContents`:

### Default mode — `validateContents=false` (or unset)

**Fail-open.** A failing object is still persisted, but two pieces of
state are written so the failure is visible:

1. **On the document itself**, in `workspace.validation`:

   ```jsonc
   "workspace": {
     "validation": {
       "errors": [
         { "message": "type is Invalid literal value", "path": ["type"], "code": "invalid_literal" }
       ],
       "attack_spec_version": "3.3.0",
       "adm_version": "4.11.7",
       "validated_at": "2026-05-14T12:00:00.000Z"
     }
   }
   ```

2. **On the collection's import response**, in
   `workspace.import_categories.errors`, one entry per failing
   object:

   ```jsonc
   {
     "object_ref": "attack-pattern--1234...",
     "object_modified": "2024-10-15T14:00:21.000Z",
     "error_type": "Validation error",
     "error_message": "3 ADM validation error(s): path.x is invalid_type; ...",
     "details": [
       { "message": "x_mitre_platforms is Required", "path": ["x_mitre_platforms"], "code": "invalid_type" },
       { "message": "...", "path": ["..."], "code": "..." }
     ]
   }
   ```

   The `details` array preserves the full Zod issue list so callers
   can act on the failure without fetching every object individually.

Fail-open mode is the default because bundle import is the primary
way that legacy and version-skewed content enters the system; aborting
on every ADM mismatch would make migrations between ATT&CK versions
impossible.

### Strict mode — `validateContents=true`

A failing object is **not** persisted. The entry in
`import_categories.errors` is written exactly as above (with full
`details`), but the document is dropped from the bulk insert. Other
objects in the same bundle continue to be processed. The import as a
whole succeeds; only the failing objects are missing from the database.

Use strict mode when you want the import to be a clean filter: only
objects that pass current ADM validation will be persisted, and the
import response tells you exactly which ones were rejected and why.

## Reading the import response

The response is the persisted `x-mitre-collection` document. Look at
`workspace.import_categories`:

```jsonc
"workspace": {
  "imported": "2026-05-14T12:00:00.000Z",
  "import_categories": {
    "additions":        [ /* stixIds of new objects */ ],
    "changes":          [ /* stixIds where x_mitre_version increased */ ],
    "minor_changes":    [ /* stixIds where only modified changed */ ],
    "revocations":      [ /* stixIds newly revoked in this version */ ],
    "deprecations":     [ /* stixIds newly deprecated in this version */ ],
    "supersedes_user_edits":         [ ],
    "supersedes_collection_changes": [ ],
    "duplicates":       [ /* stixIds whose modified matches an existing version */ ],
    "out_of_date":      [ /* stixIds where existing modified is newer */ ],
    "errors":           [ /* see below */ ]
  },
  "import_references": {
    "additions": [ /* source_names of newly inserted references */ ],
    "changes":   [ /* source_names of updated references */ ],
    "duplicates": [ ]
  }
}
```

### Error types in `import_categories.errors`

| `error_type` | Meaning |
|---|---|
| `Validation error` | The object failed ADM schema validation. The `details` array contains every `{message, path, code}`. In fail-open mode the object is still persisted; in strict mode it is dropped. |
| `Save error` | A persistence failure (e.g. MongoDB duplicate-key race). |
| `Retrieval error` | The bulk pre-fetch for the tier failed; no object in that tier was processed. |
| `Not in contents` | The object exists in the bundle's `objects` array but is missing from the collection's `x_mitre_contents`. It is still persisted; this is a warning. |
| `Missing object` | The object is listed in `x_mitre_contents` but is missing from the bundle. |
| `Unknown object type` | The object's `type` is not one the server knows how to persist. |
| `ATT&CK Spec version violation` | The object's `x_mitre_attack_spec_version` is later than the server supports. Without `forceImport=attack-spec-version-violations`, the entire import aborts when this occurs. |
| `Duplicate collection object` | A second `x-mitre-collection` matching an already-persisted collection was found. Without `forceImport=duplicate-collection`, the import aborts. |

## Re-importing the same bundle

Re-importing a bundle whose collection (`x-mitre-collection`) already
exists at the same `modified` timestamp augments the existing
collection rather than creating a duplicate: the new import's
`import_categories` is appended to `workspace.reimports` and member
objects are upserted version-by-version. Members that match an
existing version exactly (same `modified`) appear in `duplicates`;
members whose `modified` is newer than what's stored appear in
`additions` / `changes` / `minor_changes` as appropriate.

## Performance

For very large bundles (the Enterprise ATT&CK bundle ships ~5,000
objects), the import runs in tier-batched parallel passes — see
[`docs/developer/stix-bundle-import-pipeline.md`](../developer/stix-bundle-import-pipeline.md)
for the implementation detail. Typical wall-clock times on developer
hardware:

| Bundle | Approximate import time |
|---|---|
| Mobile ATT&CK | < 5 seconds |
| ICS ATT&CK | < 5 seconds |
| Enterprise ATT&CK | 20-60 seconds (depending on hardware and Mongo configuration) |

If the request seems hung past a minute, check the server logs for
`Import Bundle Error` entries — most often the cause is a deeper
issue (e.g. a Mongo connection problem) rather than continued
processing.
