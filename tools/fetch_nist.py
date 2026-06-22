#!/usr/bin/env python3
"""
fetch_nist.py -- Download REAL electron-impact ionization cross sections from the
NIST Electron-Impact Cross Section Database (SRD 107) and convert them into the
Cross-Section Browser JSON schema.

What it fetches
---------------
  TOTAL ionization (BEB model), faithful ASCII tables:
    molecules : GET .../bebcsdwnload_ascii?<formula>   (eV, Angstrom^2)
    atoms     : GET .../bebcsdwnload_ascii?<element>    (only H, He return data;
                NIST returns HTTP 500 for the other listed atoms)

  DIFFERENTIAL ionization (SDCS, dsigma/dW vs ejected-electron energy W),
  available only for H, He, H2:
    POST .../diff.pl  with {mol, T}   (W in eV, dsigma/dW in Angstrom^2/eV)

Everything is downloaded as raw bytes and parsed locally -- no summarization
layer -- so the numbers are exactly what NIST serves. Cross sections are stored
internally in m^2 (total) and m^2/eV (differential) to match the catalog's
canonical units; 1 Angstrom^2 = 1e-20 m^2.

Data are public domain (U.S. Government work). Cite:
  Kim, Y.-K., et al., NIST Electron-Impact Cross Section Database (SRD 107),
  https://dx.doi.org/10.18434/T4KK5C

Usage
-----
    python3 tools/fetch_nist.py data/nist.json
"""

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

BASE = "https://physics.nist.gov/cgi-bin/Ionization/"
INDEX = "https://physics.nist.gov/PhysRefData/Ionization/"
UA = {"User-Agent": "Mozilla/5.0 (Cross-Section Browser research data fetch)"}
A2_TO_M2 = 1.0e-20          # 1 Angstrom^2 in m^2
DELAY = 0.25               # polite pause between requests (s)

# Incident energies (eV) at which to sample the singly differential cross section.
SDCS_T_VALUES = [30, 50, 70, 100, 150, 200, 500, 1000]
SDCS_SPECIES = ["H", "He", "H2"]


# ----------------------------------------------------------------- http
def http_get(url, retries=3):
    for k in range(retries):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30)
            return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code == 500:
                return 500, ""           # NIST-side breakage; don't retry
            time.sleep(0.5 * (k + 1))
        except Exception:
            time.sleep(0.5 * (k + 1))
    return None, ""


def http_post(url, data, retries=3):
    body = urllib.parse.urlencode(data).encode()
    for k in range(retries):
        try:
            req = urllib.request.Request(url, data=body, headers={
                **UA, "Content-Type": "application/x-www-form-urlencoded"})
            r = urllib.request.urlopen(req, timeout=30)
            return r.status, r.read().decode("utf-8", "replace")
        except Exception:
            time.sleep(0.5 * (k + 1))
    return None, ""


def strip_tags(html):
    t = re.sub(r"<script.*?</script>", " ", html, flags=re.S)
    t = re.sub(r"<style.*?</style>", " ", t, flags=re.S)
    t = re.sub(r"<[^>]+>", " ", t)
    return t


def fnum(s):
    """Parse a float, accepting Fortran 'D' exponent notation."""
    try:
        return float(s.replace("D", "E").replace("d", "e"))
    except ValueError:
        return None


# ----------------------------------------------------- species discovery
def get_species_lists():
    _, mol_html = http_get(INDEX + "molTable.html")
    mols = sorted(set(urllib.parse.unquote(x)
                  for x in re.findall(r"table\.pl\?ionization=([^\"&]+)", mol_html)))
    _, atom_html = http_get(INDEX + "atom_index.html")
    atoms = sorted(set(re.findall(r"atom\.php\?element=([A-Za-z]+)", atom_html)))
    return mols, atoms


# --------------------------------------------------------- total parsing
def parse_beb_ascii(text):
    """Parse a bebcsdwnload_ascii payload -> (title, model, [(E_eV, sigma_A2), ...]).

    NIST serves two model variants under the same endpoint: 'BEB (A^2)' for most
    molecules and 'BEQ (A^2)' (the dipole-corrected variant) for atoms / some ions.
    """
    lines = text.splitlines()
    title = lines[0].strip() if lines else ""
    model = "BEB"
    data = []
    started = False
    for ln in lines:
        h = re.search(r"Energy.*\b(BE[BQ])\b.*\(A\^?2\)", ln)
        if h:
            model = h.group(1)
            started = True
            continue
        if not started:
            continue
        m = re.match(r"\s*([-\d.][\d.eED+-]*)\s+([-\d.][\d.eED+-]*)\s*$", ln)
        if m:
            e, s = fnum(m.group(1)), fnum(m.group(2))
            if e is not None and s is not None:
                data.append((e, s))
    return title, model, data


def fetch_total(formula, label_kind):
    """Download + parse one species' BEB total ionization cross section."""
    status, text = http_get(BASE + "bebcsdwnload_ascii?" + urllib.parse.quote(formula, safe=""))
    if status != 200 or not text:
        return None
    title, model, rows = parse_beb_ascii(text)
    if len(rows) < 3:
        return None
    energy = [e for e, _ in rows]
    sigma_m2 = [s * A2_TO_M2 for _, s in rows]
    threshold = energy[0]                       # threshold = lowest orbital B
    return {
        "formula": formula, "title": title, "kind": label_kind, "model": model,
        "energy": energy, "sigma_m2": sigma_m2, "threshold": threshold,
    }


# -------------------------------------------------- differential parsing
def parse_sdcs(html):
    """Parse a diff.pl payload -> (B, Wmax, [(W_eV, dsdw_A2_per_eV), ...])."""
    t = strip_tags(html)
    t = re.sub(r"&#197;", "A", t)               # Angstrom entity
    B = fnum((re.search(r"Ionization Potential B\s*=\s*([\d.DE+-]+)", t) or [None, None])[1]) \
        if re.search(r"Ionization Potential B", t) else None
    wmax_m = re.search(r"Wmax=\s*([\d.DE+-]+)", t)
    wmax = fnum(wmax_m.group(1)) if wmax_m else None

    rows = []
    # Each data line: W  SD(A2/ryd)  SD(A2/eV)  E/R  R/E  Y  -> we want cols 0 and 2
    for m in re.finditer(
        r"([\d.]+[DE][+-]\d+)\s+([\d.]+[DE][+-]\d+)\s+([\d.]+[DE][+-]\d+)"
        r"\s+([\d.]+[DE][+-]\d+)\s+([\d.]+[DE][+-]\d+)\s+([\d.]+[DE][+-]\d+)", t):
        w = fnum(m.group(1))
        sd_ev = fnum(m.group(3))
        if w is not None and sd_ev is not None:
            rows.append((w, sd_ev))
    # de-dupe + sort by W (NIST occasionally injects the Wmax point out of order)
    seen, clean = set(), []
    for w, s in sorted(rows, key=lambda r: r[0]):
        key = round(w, 6)
        if key in seen:
            continue
        seen.add(key)
        clean.append((w, s))
    return B, wmax, clean


def fetch_sdcs(mol, T):
    status, html = http_post(BASE + "diff.pl", {"mol": mol, "T": str(T)})
    if status != 200 or not html:
        return None
    B, wmax, rows = parse_sdcs(html)
    if len(rows) < 3:
        return None
    W = [w for w, _ in rows]
    dsdw_m2 = [s * A2_TO_M2 for _, s in rows]    # A^2/eV -> m^2/eV
    return {"mol": mol, "T": T, "B": B, "wmax": wmax, "W": W, "dsdw_m2_per_eV": dsdw_m2}


# --------------------------------------------------------- record build
def slug(s):
    return re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_")


def total_record(item, idx):
    f = item["formula"]
    e = item["energy"]
    s = item["sigma_m2"]
    model = item.get("model", "BEB")
    return {
        "id": f"NIST__{slug(f)}__Ionization__{idx:03d}",
        "label": f"NIST · {f} · e + {f} -> 2e + {f}+",
        "database": "NIST BEB (SRD 107)",
        "species_banner": f,
        "target": f,
        "projectile": "e",
        "reaction": f"E + {f} -> E + E + {f}+",
        "type": "Ionization",
        "category": "Ionization",
        "family": "Electron",
        "data_kind": "total",
        "threshold_eV": item["threshold"],
        "mass_ratio": None, "ion_mass_amu": None, "ion_mass_ratio": None,
        "stat_weight_ratio": None, "complete_set": True,
        "param_raw": f"{model} model; threshold (lowest orbital binding energy) = {item['threshold']} eV",
        "comment": f"{item['title']}. {model}-model total electron-impact ionization "
                   f"cross section. Source units eV / Angstrom^2 (converted to m^2).",
        "updated": "",
        "columns": "Energy (eV) | Cross section (m2)",
        "x_quantity": "Energy", "x_unit": "eV",
        "y_quantity": "Cross section", "y_unit": "m2",
        "energy_unit": "eV", "cross_section_unit": "m2",
        "source_cross_section_unit": "Angstrom^2",
        "n_points": len(e),
        "energy_min_eV": min(e), "energy_max_eV": max(e),
        "sigma_max_m2": max(s),
        "energy": e, "cross_section": s,
    }


def sdcs_record(item, idx):
    mol, T = item["mol"], item["T"]
    W = item["W"]
    y = item["dsdw_m2_per_eV"]
    return {
        "id": f"NIST__{slug(mol)}__SDCS_T{int(T)}__{idx:03d}",
        "label": f"NIST · {mol} · SDCS dσ/dW @ T={int(T)} eV",
        "database": "NIST BEB SDCS (SRD 107)",
        "species_banner": mol,
        "target": mol,
        "projectile": "e",
        "reaction": f"E({int(T)}eV) + {mol} -> E + E + {mol}+  [dσ/dW]",
        "type": "SDCS",
        "category": "Ionization (differential)",
        "family": "Electron",
        "data_kind": "differential",
        "incident_energy_eV": T,
        "threshold_eV": item.get("B"),
        "wmax_eV": item.get("wmax"),
        "mass_ratio": None, "ion_mass_amu": None, "ion_mass_ratio": None,
        "stat_weight_ratio": None, "complete_set": True,
        "param_raw": f"Incident energy T = {int(T)} eV; ionization potential B = {item.get('B')} eV; "
                     f"Wmax = {item.get('wmax')} eV",
        "comment": f"Singly differential ionization cross section dσ/dW versus ejected-electron "
                   f"energy W, at incident electron energy T = {int(T)} eV. BED/BEB model. "
                   f"Source units eV / (Angstrom^2/eV) (converted to m^2/eV).",
        "updated": "",
        "columns": "Ejected energy W (eV) | dσ/dW (m2/eV)",
        "x_quantity": "Ejected electron energy W", "x_unit": "eV",
        "y_quantity": "dσ/dW", "y_unit": "m2/eV",
        "energy_unit": "eV", "cross_section_unit": "m2/eV",
        "source_cross_section_unit": "Angstrom^2/eV",
        "n_points": len(W),
        "energy_min_eV": min(W), "energy_max_eV": max(W),
        "sigma_max_m2": max(y),
        "energy": W, "cross_section": y,
    }


# ------------------------------------------------------------------ main
def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    dst = sys.argv[1]

    mols, atoms = get_species_lists()
    print(f"Discovered {len(mols)} molecules, {len(atoms)} atoms in NIST tables.")

    processes = []
    failed = []
    idx = 0

    print("\n--- TOTAL ionization (molecules) ---")
    for f in mols:
        item = fetch_total(f, "molecule")
        if item:
            processes.append(total_record(item, idx)); idx += 1
            print(f"  ok  {f:8} {len(item['energy']):3} pts  thr={item['threshold']:.3g} eV")
        else:
            failed.append(("molecule", f))
            print(f"  --  {f:8} (no data / HTTP 500)")
        time.sleep(DELAY)

    print("\n--- TOTAL ionization (atoms) ---")
    for a in atoms:
        item = fetch_total(a, "atom")
        if item:
            processes.append(total_record(item, idx)); idx += 1
            print(f"  ok  {a:8} {len(item['energy']):3} pts  thr={item['threshold']:.3g} eV")
        else:
            failed.append(("atom", a))
            print(f"  --  {a:8} (no data / HTTP 500)")
        time.sleep(DELAY)

    print("\n--- DIFFERENTIAL (SDCS) ---")
    for mol in SDCS_SPECIES:
        for T in SDCS_T_VALUES:
            item = fetch_sdcs(mol, T)
            if item:
                processes.append(sdcs_record(item, idx)); idx += 1
                print(f"  ok  {mol:4} T={T:<5} {len(item['W']):3} pts  Wmax={item.get('wmax')}")
            else:
                failed.append(("sdcs", f"{mol}@T={T}"))
                print(f"  --  {mol:4} T={T:<5} (no data)")
            time.sleep(DELAY)

    species = sorted({p["target"] for p in processes})
    categories = sorted({p["category"] for p in processes})
    databases = sorted({p["database"] for p in processes})

    dataset = {
        "schema": "lxcat-cross-sections/1.0",
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source_file": "NIST SRD 107 (live fetch)",
        "source": "NIST Electron-Impact Cross Section Database (SRD 107), https://dx.doi.org/10.18434/T4KK5C",
        "units": {"energy": "eV", "cross_section": "m2"},
        "databases": [
            {"name": "NIST BEB (SRD 107)",
             "permlink": "https://physics.nist.gov/PhysRefData/Ionization/",
             "description": "Total electron-impact ionization cross sections from the "
                            "Binary-Encounter-Bethe (BEB) model. Kim, Rudd, et al.",
             "contact": "NIST", "how_to_reference": "https://dx.doi.org/10.18434/T4KK5C"},
            {"name": "NIST BEB SDCS (SRD 107)",
             "permlink": "https://physics.nist.gov/PhysRefData/Ionization/",
             "description": "Singly differential ionization cross sections dσ/dW for H, He, H2.",
             "contact": "NIST", "how_to_reference": "https://dx.doi.org/10.18434/T4KK5C"},
        ],
        "facets": {"databases": databases, "species": species, "categories": categories},
        "counts": {"processes": len(processes),
                   "data_points": sum(p["n_points"] for p in processes)},
        "fetch_failures": failed,
        "processes": processes,
    }

    with open(dst, "w", encoding="utf-8") as fh:
        json.dump(dataset, fh, ensure_ascii=False, separators=(",", ":"))

    print(f"\nWrote {dst}")
    print(f"  processes : {len(processes)}  ({sum(p['n_points'] for p in processes)} points)")
    print(f"  total     : {sum(1 for p in processes if p['data_kind']=='total')}")
    print(f"  differential: {sum(1 for p in processes if p['data_kind']=='differential')}")
    print(f"  failures  : {len(failed)} -> {failed}")


if __name__ == "__main__":
    main()
