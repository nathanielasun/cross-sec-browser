# Cross-Section Browser

A simple, dependency-free web app for browsing, plotting, and exporting
electron- and ion-collision **cross-section data** for import into PIC-MCC and
Boltzmann-solver codes.

The data originates from [LXCat](https://www.lxcat.net) (Morgan & Phelps
databases) and is normalized into a structured JSON catalog. The UI lets you
filter by database / species / process type, preview curves on a log-log plot,
and export any selection as analysis-ready files.

## Quick start

```bash
cd crossbrowser
python3 -m http.server 8000
# then open http://localhost:8000
```

No build step, no internet, no dependencies — it is plain HTML/CSS/JS.

## Using it

1. **Filter / search** the process table (top controls).
2. **Click rows** to select them — selected curves plot live on the right and
   their metadata shows below the plot.
3. Pick an **export format** and **units** in the bottom bar, then **Export**.

## Export formats

| Format | Output | Best for |
|---|---|---|
| **CSV + JSON sidecar** (`.zip`) | one `<id>.csv` (2-column E, σ) + one `<id>.json` metadata per process, plus `manifest.json` & `README.txt` | the requested default; clean PIC-MCC import |
| **Combined long CSV** (`.zip`) | one stacked `*_combined.csv` + `*_metadata.json` | loading everything as a single table |
| **LXCat text** (`.txt`) | the selection re-emitted in canonical LXCat block format | tools that already read LXCat natively |

CSV files use `#`-comment headers (skipped by `numpy.loadtxt` / `pandas
read_csv(comment='#')`) so the data rows load directly. Optional unit conversion
covers energy (eV / keV / J) and cross section (m² / cm² / Å²); the LXCat export
stays in canonical eV / m².

### Why CSV + JSON?

For a PIC-MCC code the cross section itself is just a 2-column `(E, σ)` table —
CSV is the most portable thing to import. But the *physics* that must travel
with it (threshold energy, process type, target/projectile, mass ratio, units,
source/reference) does not fit two columns, so it lives in a sidecar JSON. This
keeps the numeric table trivially loadable while preserving full provenance. The
LXCat text option is offered because several plasma codes ingest that format
directly.

## Repository layout

```
index.html              UI shell
css/style.css           styling
js/zip.js               minimal STORE-only ZIP writer + CRC-32 (no deps)
js/plot.js              canvas log-log plotter
js/export.js            CSV / JSON / LXCat / combined builders
js/app.js               controller: load, filter, select, plot, export
data/manifest.json      catalog of datasets to load (the extensibility seam)
data/cross_sections.json structured dataset (generated from source)
tools/parse_lxcat.py    LXCat .txt -> JSON parser (re-runnable, documented)
source/Cross section.txt original LXCat download, kept for provenance
```

## Extending the database

The browser loads every dataset listed in `data/manifest.json`. To add more
data: produce a JSON file with the same `processes[]` schema (the simplest path
is to drop an LXCat `.txt` into `source/` and run
`python3 tools/parse_lxcat.py source/your.txt data/your.json`), then add an
entry to `data/manifest.json`. The catalog also carries a `data_kind` field
(`"total"` today) so differential cross sections can be added alongside.

## Data provenance

Generated from an LXCat download (`www.lxcat.net`, 22 Jun 2026), Morgan and
Phelps databases. Please cite the original databases per their reference
requirements (see the per-database descriptions in `data/cross_sections.json`).
