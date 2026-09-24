# Architecture — Semantic Model Reviewer MVP

## Purpose

The application is a semantic change-control workspace for Power BI models. It separates model ingestion from comparison and review governance so the parser can be replaced without disturbing persisted review logic.

## PBIP ingestion

The primary input is now the actual Power BI Project folder rather than a ZIP.

```text
Reference PBIP folder ─┐
                       ├─ browser filters TMDL definition files ─ canonical model
Candidate PBIP folder ─┘
                                                               │
                                                               ▼
                                                       Semantic diff engine
                                                               │
                                                               ▼
                                                       Review workspace
                                                               │
                          ┌────────────────────────────────────┼─────────────────────┐
                          ▼                                    ▼                     ▼
                    SQLite persistence                  Resume review          Export/finalise
```

A standard PBIP root contains sibling `.Report` and `.SemanticModel` folders. The browser folder picker inspects relative paths and includes only files beneath:

`<name>.SemanticModel/definition/**/*.tmdl`

The user may alternatively select the `.SemanticModel` folder or `definition` folder directly.

Other PBIP files are not sent to the backend. This includes report definitions, `.pbip`, `.platform`, editor settings and local cache files.

ZIP parsing remains as an optional fallback.

### Parser adapter

`server/tmdlParser.js` accepts either filesystem TMDL files or browser-supplied path/content entries and maps them to the same canonical semantic model.

Production target: replace this adapter with a .NET/TOM service using `Microsoft.AnalysisServices.Tabular.TmdlSerializer`. Nothing above the canonical snapshot contract should need to change.

### Comparison

`server/compare.js` flattens canonical objects by semantic identity and compares meaningful properties. V1 intentionally treats rename as remove + add.

### Persistence

`server/db.js` uses SQLite and stores:

- review identity/lifecycle
- reference and candidate fingerprints
- canonical reference/candidate snapshots
- every detected change
- review status and comment
- review timestamp

The original PBIP folders are not retained.

### Review lifecycle

```text
In Review
   │
   ├─ Approved / Rejected / Needs Review / Unreviewed per change
   │
   └─ Finalise only when no Unreviewed or Needs Review items remain
                 │
                 ▼
             Finalised
             (read-only)
```

## Next engineering increments

1. Microsoft TOM/TmdlSerializer adapter.
2. Relationships, roles, partitions, calculation groups, perspectives and model properties.
3. Stable identity / lineage-tag based rename detection.
4. Object hash per change and candidate re-upload handling; previous decisions become stale only when the reviewed object changes.
5. Dependency graph and downstream impact analysis.
6. Multi-user persistence/authentication.
7. Git/PR integration and approved changeset generation.
