# Architecture — Semantic Model Reviewer MVP

## Purpose

The application is a semantic change-control workspace for Power BI models. It separates model ingestion from comparison and review governance so the parser can be replaced without disturbing persisted review logic.

## Current vertical slice

```text
Reference PBIP/TMDL ZIP ─┐
                         ├─ Temporary extraction ─ TMDL adapter ─ Canonical snapshots
Candidate PBIP/TMDL ZIP ─┘                                      │
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

### Ingestion

`server/server.js` accepts a raw ZIP upload, extracts it to a temporary directory, locates a `definition/` folder and removes the temporary files after parsing.

### Parser adapter

`server/tmdlParser.js` currently implements a lightweight TMDL reader for tables, columns and measures. Its output is a canonical JavaScript object independent of file layout.

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

Uploaded source ZIPs are not retained.

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
