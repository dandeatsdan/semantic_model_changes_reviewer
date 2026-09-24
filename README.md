# Semantic Model Reviewer

A working MVP for reviewing proposed changes between a **reference** and **candidate** Power BI semantic model expressed as PBIP/TMDL.

## What it does

- Upload a reference semantic-model ZIP and candidate semantic-model ZIP.
- Locates a `definition/` TMDL folder inside each ZIP.
- Builds a canonical snapshot of tables, columns and measures.
- Detects **Added**, **Modified** and **Removed** objects.
- Creates a persistent review workspace in SQLite.
- Review every change as **Approved**, **Rejected**, **Needs Review** or **Unreviewed**.
- Autosaves decisions and reviewer comments.
- Reopen in-progress reviews.
- Prevents finalisation while unresolved items remain.
- Finalised reviews become read-only.
- Export the review as JSON, CSV or a standalone HTML review report.

## Design language

The UI intentionally reuses the visual language from the `portfolio_application` React application:

- deep green `#003600`
- accent green `#8EDF00`
- bright green `#CCFF00`
- warm-grey surfaces and borders
- Inter/Arial typography
- 6px radii and restrained card treatment

Change/review semantics extend the same palette: green for added/approved, amber for modified/needs review, orange-red for removed/rejected.

## Run

Requirements: Node.js 22.5+ and the system `unzip` command.

```bash
npm start
```

Then open `http://localhost:5174`.

No `npm install` is required for this MVP because it uses only Node built-ins, including Node's SQLite module.

## Try it with the supplied samples

Create the two ZIPs:

```bash
cd samples/reference && zip -qr ../reference-model.zip .
cd ../candidate && zip -qr ../candidate-model.zip .
```

Upload `samples/reference-model.zip` as Reference and `samples/candidate-model.zip` as Candidate.

Expected comparison: 5 changes — 2 added, 2 modified, 1 removed.

## Architecture

```text
PBIP/TMDL ZIP
      ↓
Temporary extraction
      ↓
TMDL parser adapter
      ↓
Canonical semantic model
      ↓
Semantic comparison engine
      ↓
Review workspace + SQLite
      ↓
Decision / comment / finalisation / export
```

The upload ZIPs themselves are not retained. The saved review contains canonical semantic metadata, model fingerprints, change records and review decisions.

## Important MVP limitation

The current parser is deliberately a **lightweight TMDL adapter** for the first vertical slice. It currently focuses on tables, columns and measures and is intended to prove the product workflow end-to-end.

For production use, replace `server/tmdlParser.js` with a Microsoft Tabular Object Model adapter using `Microsoft.AnalysisServices.Tabular.TmdlSerializer`. The comparison and review layers are intentionally isolated from parsing so that swap does not require redesigning the app.

Other current limitations:

- no sophisticated rename detection (rename may appear as remove + add)
- no relationships, calculation groups, roles, perspectives or partitions yet
- no dependency/impact analysis yet
- single-user/local SQLite persistence
- no authentication
- no direct model deployment/promotion

## Roadmap

1. **Semantic model diff** — current MVP
2. **Review workflow** — current MVP
3. Microsoft TOM/TMDL production parser
4. Relationship, role, partition, calculation-group and perspective comparison
5. Rename detection using lineage tags / stable identity where available
6. Dependency and downstream impact analysis
7. Candidate re-upload with stale-approval detection using object hashes
8. Git / pull-request integration
9. Approved changeset generation
10. Controlled semantic-model promotion

## Repository structure

```text
public/                 browser UI
server/
  server.js             HTTP/API and temporary ZIP processing
  tmdlParser.js         parser adapter
  compare.js            semantic diff engine
  db.js                 SQLite review persistence
samples/                synthetic reference/candidate TMDL
tests/                  Node test suite
data/                   local review database (ignored by Git)
```
