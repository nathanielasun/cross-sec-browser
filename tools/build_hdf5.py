#!/usr/bin/env python3
"""
build_hdf5.py -- Pack Cross-Section Browser catalog / selection JSON into a single
HDF5 file with metadata, for PIC-MCC codes (e.g. PICLas) and analysis in
Python/MATLAB/Julia.

Layout
------
  /                         file-level attributes (schema, source, n_processes)
  /<process_id>            one group per process
      x        1D float64   energy [eV]  (total)  |  ejected energy W [eV] (SDCS)
      y        1D float64   cross section [m^2]    |  dsigma/dW [m^2/eV]     (SDCS)
      <attrs>  full metadata (database, reaction, type, threshold, units, ...)

Each x/y dataset also carries `quantity` and `unit` attributes, so the file is
self-describing.

Usage
-----
    python3 tools/build_hdf5.py data/cross_sections.json data/nist.json -o crossbrowser.h5
    python3 tools/build_hdf5.py my_selection_hdf5_input.json -o my.h5
"""

import argparse
import json
import sys

try:
    import h5py
    import numpy as np
except ImportError:
    sys.exit("build_hdf5.py needs h5py + numpy:  pip install h5py numpy")

# Scalar/string metadata copied onto each process group (when present).
META_KEYS = [
    "label", "database", "target", "projectile", "reaction", "type", "category",
    "family", "data_kind", "threshold_eV", "incident_energy_eV", "wmax_eV",
    "mass_ratio", "ion_mass_amu", "ion_mass_ratio", "stat_weight_ratio",
    "complete_set", "param_raw", "comment", "updated",
    "x_quantity", "x_unit", "y_quantity", "y_unit",
    "energy_unit", "cross_section_unit", "source_cross_section_unit",
    "n_points", "energy_min_eV", "energy_max_eV", "sigma_max_m2", "_source",
]


def load_processes(paths):
    procs = []
    for p in paths:
        with open(p, "r", encoding="utf-8") as fh:
            d = json.load(fh)
        if isinstance(d, list):
            procs += d
        else:
            procs += d.get("processes", [])
    return procs


def set_attr(obj, key, val):
    if val is None:
        return
    if isinstance(val, bool):
        obj.attrs[key] = bool(val)
    elif isinstance(val, (int, float)):
        obj.attrs[key] = val
    else:
        obj.attrs[key] = str(val)


def main():
    ap = argparse.ArgumentParser(description="Pack cross-section JSON into HDF5.")
    ap.add_argument("inputs", nargs="+", help="catalog/selection JSON file(s)")
    ap.add_argument("-o", "--output", default="cross_sections.h5")
    args = ap.parse_args()

    procs = load_processes(args.inputs)
    if not procs:
        sys.exit("No processes found in inputs.")

    seen = {}
    with h5py.File(args.output, "w") as f:
        f.attrs["schema"] = "cross-section-hdf5/1.0"
        f.attrs["source"] = "Cross-Section Browser export"
        f.attrs["n_processes"] = len(procs)
        f.attrs["note"] = (
            "One group per process. Datasets: x = energy [eV] (total) or ejected "
            "electron energy W [eV] (differential); y = cross section [m^2] (total) "
            "or dsigma/dW [m^2/eV] (differential). See per-group/per-dataset attrs."
        )
        for p in procs:
            gid = p["id"]
            seen[gid] = seen.get(gid, 0) + 1
            if seen[gid] > 1:
                gid = f"{gid}__{seen[gid]}"      # guard against dup ids across files
            g = f.create_group(gid)
            diff = p.get("data_kind") == "differential"
            x = np.asarray(p["energy"], dtype="float64")
            y = np.asarray(p["cross_section"], dtype="float64")
            dx = g.create_dataset("x", data=x)
            dy = g.create_dataset("y", data=y)
            dx.attrs["quantity"] = p.get("x_quantity", "Ejected electron energy W" if diff else "Energy")
            dx.attrs["unit"] = p.get("x_unit", "eV")
            dy.attrs["quantity"] = p.get("y_quantity", "dsigma/dW" if diff else "Cross section")
            dy.attrs["unit"] = p.get("y_unit", "m2/eV" if diff else "m2")
            for k in META_KEYS:
                if k in p:
                    set_attr(g, k, p[k])

    print(f"Wrote {args.output}: {len(procs)} process groups "
          f"({sum(len(p['energy']) for p in procs)} data points).")


if __name__ == "__main__":
    main()
