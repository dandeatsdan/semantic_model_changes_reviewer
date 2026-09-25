# Semantic Model Reviewer

A working MVP for reviewing proposed changes between a **reference** and **candidate** Power BI semantic model expressed as PBIP/TMDL.

## Normal workflow

Power BI Desktop saves a PBIP project as a root folder similar to:

```text
Project/
├── Project.Report/
├── Project.SemanticModel/
│   ├── .pbi/
│   ├── definition/
│   │   ├── model.tmdl
│   │   ├── relationships.tmdl
│   │   ├── tables/
│   │   └── ...
│   └── definition.pbism
├── .gitignore
└── Project.pbip
```

The reviewer now accepts that **folder directly**.

For both Reference and Candidate, select either:

1. the whole PBIP project root — recommended;
2. the `.SemanticModel` folder; or
3. the semantic model `definition` folder.

The browser ignores the report, cache and editor files and sends only the TMDL files in the semantic model definition to the backend.

The UI also provides **Use sample data** for both Reference and Candidate so the complete review workflow can be demonstrated without supplying a Power BI model. ZIP upload is no longer part of the application workflow.

If the selected PBIP contains `model.bim` rather than a `definition/` TMDL folder, the app tells you that the model needs to be saved/upgraded using TMDL format.

## What it does

- Select Reference and Candidate PBIP folders directly.
- Locates the semantic model TMDL definition.
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

The UI reuses the visual language from the `portfolio_application` React application:

- deep green `#003600`
- accent green `#8EDF00`
- bright green `#CCFF00`
- warm-grey surfaces and borders
- Inter/Arial typography
- 6px radii and restrained card treatment

Change/review semantics extend the same palette: green for added/approved, amber for modified/needs review, orange-red for removed/rejected.

## Run

Requirement: Node.js 22.5+.

```bash
npm start
```

Then open `http://localhost:5174`.

No `npm install` is required for this MVP because it uses only Node built-ins, including Node's SQLite module.

The optional legacy ZIP fallback also requires the system `unzip` command.

## Synthetic samples

The repo contains synthetic TMDL definitions and sample ZIPs under `samples/`.

Expected comparison: **5 changes — 2 added, 2 modified, 1 removed.**

You can test the folder workflow by selecting:

```text
samples/reference
samples/candidate
```

These are simplified sample folders containing a `definition/` directory. A real PBIP root works the same way; the app finds `<name>.SemanticModel/definition/` automatically.

## Architecture

```text
PBIP project folder
       │
       ├─ browser reads only *.SemanticModel/definition/**/*.tmdl
       │
       ▼
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

The source PBIP folder itself is not copied into the app database. The saved review contains canonical semantic metadata, model fingerprints, change records and review decisions.

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


## Vercel demo

The bundled sample models are intended to make a public Vercel deployment easy to explore without uploading any proprietary semantic model.

On Vercel, the application automatically places its SQLite review database in temporary runtime storage. This is suitable for demonstration only: saved reviews can disappear between function instances, restarts, or deployments.

For durable public/multi-user review persistence, replace the temporary SQLite store with a persistent database such as Neon Postgres. Local VS Code use is unchanged and continues to store reviews in `data/reviews.db`.
