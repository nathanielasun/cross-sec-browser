# Krypton / Fluorine / KrF cross-section data — acquisition map

Result of a multi-source web hunt (2026-06) for electron-impact Krypton data,
KrF-excimer pair-bonding reactions, and Fluorine chemistry. 14 source families
were searched; 103 candidate datasets catalogued. Everything below is either
**integrated** (re-fetched verbatim and parsed locally, with provenance) or
**located** (where to get it + how). No cross-section number in this project is
modelled, recalled, or fabricated — only transcribed from a cited source.

## Integrated now (54 processes across 5 files, in `data/`)

> Update: beyond the original 21 σ(E) processes, the catalog now also carries the
> full CollisionDB ionization ladders, **F₂ photoabsorption σ(λ)**, and the
> **KrF\* excimer rate coefficients k(T)** — added as two new data kinds
> (`photoabsorption`, `rate_2body`/`rate_3body`) that plot on their own axes and
> are excluded from WarpX/LXCat σ-exports. Files: `lxcat_kr_f2.json`,
> `amdis_kr_f.json`, `f2_photoabsorption.json`, `krf_rates.json`.

### `data/krf_rates.json` — KrF\* excimer kinetics, rate coefficients k(T)

From **Table II of K.S. Jancaitis, LLNL UCRL-53465 (1983)** — transcribed from the
**rendered PDF page images** (the OCR text layer was too garbled to trust) and
**independently re-read by a second agent** (both agree; the A-factor exponent is
`+0.5`, i.e. √(T/300), not the OCR's "−5"). 15 reactions:

- **Formation (2-body harpoon — the pair-bonding reactions):** `Kr*+F₂→KrF*+F`,
  `Kr**+F₂→KrF*+F` (7.6×10⁻¹⁰·A); `Kr₂*+F₂→KrF*+Kr+F` (3.0×10⁻¹⁰·A); `Kr+F₂*→KrF*+F` (7.6×10⁻¹⁰·A)
- **Quenching (2-body):** `KrF*+F₂→Kr+3F` (1.0×10⁻⁹·A); `KrF*+Kr→2Kr+F` (7.4×10⁻¹³·A);
  `KrF*+He→Kr+F+He` (2×10⁻¹²·A); `KrF*+e⁻→Kr+F+e⁻` (2×10⁻⁷)
- **Quenching (3-body, cm⁶/s):** `KrF*+Kr+M→Kr₂F*+M` (5.8×10⁻³¹·A); `KrF*+Ar+M→ArKrF*+M` (7.6×10⁻³²·A)
- **Kr₂F\* quenching** and **Penning** (`Kr+F*(3p)→Kr⁺+F+e⁻`, etc.)

`k(T)=k_R·(T_g/300)^0.5` (constant for electron-collision rows), tabulated on a
200–3000 K grid by evaluating the source's own form; verbatim k_R / exponent /
buffer-gas R factors live in each record's `param_raw`.

> The ion-ion recombination `Kr⁺+F⁻→KrF*` and `Kr₂⁺+F⁻→KrF*+Kr` are computed in the
> source by the **Flannery–Yang** method (no closed-form k), so they are documented
> but not tabulated as curves.

### `data/f2_photoabsorption.json` — F₂ + hν → 2F, σ(λ)

Four measurements from the **MPI-Mainz UV/VIS Spectral Atlas** (Keller-Rudek et al.,
ESSD 5, 365 (2013)): Arguello (1995), Holland & Lyman (1987), Makeev (1975),
Steunenberg & Vogel (1956). B–X continuum, peak σ ≈ 2.3×10⁻²⁴ m² near 285 nm.
σ(λ) in nm/m² — photon data, its own data kind.

### Original σ(E) sets (21 processes)

### `data/lxcat_kr_f2.json` — LXCat GREPHE/LAPLACE export (mirror: `lindsayad/pythonForBolos/LXCat-June2013.txt`)

| Target | Processes | Source | Units |
|---|---|---|---|
| **Kr** | elastic MT; 5 excitations (thr 9.915 / 10.033 / 10.563 / 10.644 / 11.30 eV); ionization (thr 14.0 eV) | **SIGLO** db, digitized from H. Date, Y. Sakai & H. Tagashira, *J. Phys. D* **22**, 1478 (1989) | eV / m² |
| **F₂** | dissociative attachment (F⁻+F); effective MT; 4 vibrational (V1–V4); 2 dissociation (a³Πu 3.16 eV, A¹Πu 4.34 eV → 2F); 2 electronic (C¹ 11.57 eV, H¹ 13.08 eV); ionization (thr 15.69 eV) | **Morgan** db, W.L. Morgan, *Plasma Chem. Plasma Process.* **12**, 449 (1992) | eV / m² |

This directly answers the primary ask: **E + Kr → Kr\* + E′** (5 excitation
channels) and **Kr ionization**. F₂ DEA (`e + F₂ → F⁻ + F`) is the dominant
negative-ion / F-atom source in KrF lasers.

> ⚠ **Caveats preserved in the record `comment` fields:**
> - **F₂ dissociative attachment** has a very large zero-energy value (8×10⁻¹⁹ m²);
>   verify the low-energy magnitude against a primary source (Chantry; Christophorou)
>   before quantitative use.
> - Kr curves are **digitized**; a few near-duplicate energy points exist. (E,σ)
>   pairs are sorted by energy (values unchanged).
> - Re-pull from `lxcat.net` directly for canonical citation dates; this came from
>   a 2013 third-party GitHub mirror (values verified byte-for-byte against it).

### `data/amdis_kr_f.json` — IAEA AMDIS CollisionDB (`db-amdis.org`)

Semi-empirical **BELI recommended ionization fits** (from ALADDIN), 17 eV–20 keV:

| qid | Reaction | Threshold | Underlying ref |
|---|---|---|---|
| D108525 | e + Kr → Kr⁺ + 2e | 14.0 eV | CLM-R294 (1989) / Bell et al. lineage, 10 % unc |
| D108526 | e + Kr⁺ → Kr²⁺ + 2e | 24.6 eV | CLM-R294 (1989), 10 % unc |
| D111129 | e + F → F⁺ + 2e | 17.4 eV | Lennon et al., *JPCRD* **17**, 1285 (1988), 25 % unc |

> ⚠ **F⁺ ionization (D111129) has a ~3.3× discontinuity at ~84 eV** — the boundary
> between Lennon's "first region" (20 % error) and "second region" (70 % error)
> fits. Prefer the ≤73 eV region, or a different source above ~84 eV. Flagged in
> the record `comment`.

The catalog now holds **two independent Kr ionization curves** (SIGLO digitized
poster + AMDIS BELI fit) for cross-comparison.

## Available — needs interactive download (you must pull these; the UI can't)

**LXCat** (`www.lxcat.net` → *Cross sections → Download*) is the richest Kr source.
Steps: category **Electrons**, pick database, species **Kr**, select process(es),
**Retrieve data**, export **txt**, then `python3 tools/parse_lxcat.py <file> data/<out>.json`
and add a manifest entry. The downloaded `.txt` header carries the retrieval date
required for citation.

| Database | Kr content | Why |
|---|---|---|
| **BSR** (Zatsarinny–Bartschat B-spline R-matrix) | high-resolution **excitation** (5s/5s′/5p manifolds), elastic, ionization | gold-standard energy-resolved Kr excitation σ(E) — best upgrade over the SIGLO set |
| **Biagi** (Magboltz) / **Biagi-v7.1** | complete set incl. **ionization** | most authoritative swarm/PIC ionization; v7.1 is a frozen transcription |
| **Hayashi** | complete set (NIFS recommended) incl. ionization | independent recommended compilation |
| **Phelps** | Kr⁺ + Kr ion-neutral (if present) | heavy-particle transport for the Kr⁺ species |

Other interactive nodes confirmed to hold Kr/F: **NIFS** numeric DB
(`dbshino.nifs.ac.jp`, free registration), **BEAMDB** Belgrade (`servo.aob.rs/emol/`,
Kr **elastic differential** cross sections via VAMDC/XSAMS), **VAMDC** portal,
**Quantemol-DB**.

## Available — directly fetchable, now integrated ✓

- **F₂ photoabsorption σ(λ)** — integrated as `data/f2_photoabsorption.json` (new
  `photoabsorption` data kind).
- **CollisionDB full charge-state sequences** — integrated: `amdis_kr_f.json` now
  holds the complete Kr (Kr→Kr⁴⁺) and F (F→F⁹⁺) ionization ladders.

## The KrF "pair-bonding" reactions — rate coefficients k(T), now integrated ✓

The two-body harpoon and three-body recombination/quenching channels that form and
destroy KrF\* are **rate coefficients k(T) (cm³/s, cm⁶/s)**, not energy-resolved
cross sections. They are now ingested as `data/krf_rates.json` (see above) from
**K.S. Jancaitis, UCRL-53465 (1983), Table II** (`osti.gov/servlets/purl/5271749`).
Related kinetics models for cross-checking: Rokni/Jacob/Mangano; Greene & Brau;
Hokazono; Kannari/Obara.

Other located-but-not-σ(E) or paywalled items:
- Kr 4p⁵5s excitation **angle-differential ratios** (Sakaamini et al., *Atoms* 2021,
  9(3), 61) — dimensionless ratios for theory benchmarking, **not** ingestible as σ.
- **Kr⁺ + Kr charge exchange** (Hause, Prince & Beiting, *JAP* **113**, 163301 (2013) —
  also Kr₂⁺+Kr); needed for ion transport. Paywalled / digitize.
- **e + Kr\*** stepwise ionization from metastables (Hyman, *PRA* **20**, 855 (1979));
  excitation from metastables (Zatsarinny/Bartschat *PRA* **87**, 012704). Paywalled.

## Storage format: keep `.json` (do **not** migrate to `.jsonl`)

`js/app.js` `load()` does one `JSON.parse` per file and a **load-all-then-filter**
model — every process (with full `energy[]`/`cross_section[]`) is held in memory and
faceted/filtered/plotted client-side. JSONL's only real advantages (append-without-
rewrite, streaming parse) are unusable here: the writer tools regenerate whole files,
and the browser needs all processes before first paint. JSONL would also force a
hand-rolled `r.text()+split('\n')+JSON.parse` path and relocation of top-level
metadata (`databases`/`source`/`counts`) that `load()`/`renderStats()` read — added
fragility for zero capability gain at this scale (~1–3 MB even at thousands of
processes). The one genuine JSONL win — per-line git diffs — is obtained more cheaply
by **pretty-printing** the JSON (`json.dump(..., indent=2)`); the new files here are
already written that way. (Optional: re-emit the older minified `cross_sections.json`
/ `nist.json` with `indent=2` for the same diffability.)
