# Cross-Section Browser

A simple, dependency-free web app for browsing, plotting, and exporting
electron- and ion-collision **cross-section data** for import into PIC-MCC and
Boltzmann-solver codes.

It ships with a curated private catalog assembled from public sources
(**LXCat** and **NIST SRD 107**), covering both **total** cross sections and
**differential** (SDCS) data. The UI lets you filter by database / species /
process type, preview curves on a log-log plot, and export any selection as
analysis-ready files.

## Quick start

```bash
cd crossbrowser
python3 -m http.server 8000
# then open http://localhost:8000
```

No build step, no internet, no dependencies — plain HTML/CSS/JS.

## Using it

1. **Filter / search** the process table (top controls).
2. **Click rows** to select them — selected curves plot live on the right and
   their metadata shows below the plot.
3. Pick an **export format** and **units** in the bottom bar, then **Export**.

> Total cross sections (σ, m²) and differential SDCS (dσ/dW, m²/eV) have
> different units, so the plot only co-draws curves of the same kind as the
> focused one; it tells you how many were hidden. Both kinds can still be
> selected and exported together.

## What's in the catalog

| Source | Database | Content | Count |
|---|---|---|---|
| LXCat | Morgan | electron–neutral (elastic/effective/excitation/ionization) | 28 |
| LXCat | Phelps | ion–neutral momentum transfer (backscat/isotropic) | 7 |
| NIST SRD 107 | BEB | total electron-impact ionization (93 molecules + H, He, H₂⁺) | 96 |
| NIST SRD 107 | BEB SDCS | **differential** dσ/dW for H & He at 8 incident energies | 16 |
| NIST SRD 107 | BE-scaled excitation | electron-impact excitation of H, He, Li (dipole transitions) | 24 |

**171 processes / ~12,850 data points.** Internal canonical units are eV and m²
(differential: eV and m²/eV); NIST Å² and 10⁻¹⁶ cm² values are converted on
import (1 Å² = 1 × 10⁻²⁰ m²; 1 × 10⁻¹⁶ cm² = 1 × 10⁻²⁰ m²).

## Export formats

| Format | Output | Best for |
|---|---|---|
| **WarpX cross-section files** (`.zip`) | per-process `xsec/*.dat` (2-column eV, m², **uniform energy grid**) + `inputs_mcc_snippet.txt` + `README.txt` | direct import into WarpX `BackgroundMCCCollisions` |
| **CSV + JSON sidecar** (`.zip`) | one `<id>.csv` (2-column) + one `<id>.json` metadata per process, plus `manifest.json` & `README.txt` | generic PIC-MCC import with full metadata |
| **Standard text** (`.txt` / `.zip`) | total → canonical **LXCat blocks**; differential → **NIST-style SDCS blocks**; original metadata preserved | cross-code compatibility (BOLSIG+, VSim, Magboltz…) |
| **HDF5 bundle** (`.zip` → `.h5`) | selection JSON + `build_hdf5.py` builder; run it for a self-describing `.h5` (group per process, x/y datasets + metadata attrs) | HDF5-based pipelines (e.g. PICLas), Python/MATLAB/Julia |
| **Combined long CSV** (`.zip`) | one stacked `*_combined.csv` (generic x/y + `data_kind` columns) + `*_metadata.json` | loading everything as one table |

CSV files use `#`-comment headers (skipped by `numpy.loadtxt` / `pandas
read_csv(comment='#')`). Optional unit conversion covers energy (eV / keV / J)
and cross section (m² / cm² / Å²). For differential data the ejected-electron
energy W stays in eV and only the area part of dσ/dW is converted (→ e.g.
cm²/eV). The WarpX, Standard-text and HDF5 formats use canonical eV / m²
(and m²/eV) regardless of the unit selectors, for portability.

**WarpX note:** WarpX requires *equally-spaced* energies, so each curve is
resampled onto a uniform grid by linear interpolation (well within WarpX's
`sanityCheckEnergyGrid` tolerance of `|gap − dE| < dE/100`). Excitation and
ionization `.dat` entries get a `.energy` (threshold); ionization also needs a
product `.species`, left as a `<placeholder>` to fill per run. Differential
SDCS is omitted (WarpX MCC uses total cross sections).

**HDF5 note:** a browser cannot write binary HDF5 without a heavy library, so
the bundle ships the data plus a small, dependency-light `build_hdf5.py` (needs
`h5py` + `numpy`). Run `python3 build_hdf5.py <selection>.json -o out.h5`. The
same tool also packs the whole catalog:
`python3 tools/build_hdf5.py data/cross_sections.json data/nist.json -o crossbrowser.h5`.

### Why CSV + JSON?

For a PIC-MCC code the cross section itself is a 2-column `(E, σ)` table — CSV is
the most portable thing to import. But the *physics* that must travel with it
(threshold, process type, target/projectile, mass ratio, units, source) does not
fit two columns, so it lives in a sidecar JSON. The LXCat text option is offered
because several plasma codes ingest that format directly.

## Repository layout

```
index.html                 UI shell
css/style.css              styling
js/zip.js                  minimal STORE-only ZIP writer + CRC-32 (no deps)
js/plot.js                 canvas log-log plotter (axis labels per data kind)
js/export.js               builders: WarpX / CSV+JSON / standard-txt / HDF5 / combined
js/app.js                  controller: load, filter, select, plot, export
data/manifest.json         catalog of datasets to load (the extensibility seam)
data/cross_sections.json   LXCat dataset (generated from source/)
data/nist.json             NIST SRD 107 dataset (ionization total + SDCS + excitation)
tools/parse_lxcat.py       LXCat .txt  -> JSON parser
tools/fetch_nist.py        NIST SRD 107 live fetch -> JSON (ionization, SDCS, excitation)
tools/build_hdf5.py        catalog/selection JSON -> HDF5 (needs h5py + numpy)
source/Cross section.txt   original LXCat download, kept for provenance
```

## Data sources & provenance

- **LXCat** (`www.lxcat.net`), Morgan and Phelps databases, downloaded 22 Jun
  2026. See per-database descriptions in `data/cross_sections.json`.
- **NIST Electron-Impact Cross Section Database, SRD 107**
  (`physics.nist.gov/PhysRefData/Ionization/`). Total ionization via the
  Binary-Encounter-Bethe (BEB / BEQ) model; differential SDCS via the BED model;
  excitation via BE/BEf-scaled plane-wave Born (Stone, Kim & Desclaux, *J. Res.
  NIST* **107**, 327 (2002)). Fetched live by `tools/fetch_nist.py`; public
  domain (U.S. Government work). Cite: https://dx.doi.org/10.18434/T4KK5C

All NIST numbers are downloaded as **raw ASCII / SDCS tables and parsed locally**
(no summarization), so values are exactly what NIST serves. Spot-checked against
known physics: ionization thresholds (CO₂ 13.77, O₂ 12.07, H₂O 12.61, H 13.61,
He 24.59 eV), SDCS peaking at W=0 with Wₘₐₓ=(T−B)/2, H 1s→2p Lyman-α excitation
and the strong Li 2s→2p resonance line. Known NIST-side gaps: 8 listed atoms
return HTTP 500; H₂ SDCS uses a separate endpoint — both are logged in
`fetch_failures` and the fetcher comments.

Please cite the original databases per their reference requirements.

## Extending the database

The browser loads every dataset listed in `data/manifest.json`. To add more:

- **From LXCat**: drop a `.txt` into `source/` and run
  `python3 tools/parse_lxcat.py source/your.txt data/your.json`.
- **From NIST**: re-run `python3 tools/fetch_nist.py data/nist.json`
  (e.g. after NIST fixes the atom endpoints, or to add more SDCS incident
  energies — edit `SDCS_T_VALUES`).
- Then add an entry under `sources` in `data/manifest.json`.

Each process carries a `data_kind` field (`"total"` or `"differential"`) plus
generic `x_quantity` / `x_unit` / `y_quantity` / `y_unit`, so new data shapes
(e.g. angle-resolved differential cross sections) can be added with the same
plumbing.
