#!/usr/bin/env python3
"""
parse_lxcat.py  --  Convert an LXCat cross-section .txt export into a structured
JSON dataset consumed by the Cross-Section Browser web app.

LXCat (www.lxcat.net) text export layout
-----------------------------------------
The file begins with a format-documentation preamble, followed by one or more
DATABASE sections.  Each database has a header (DATABASE/PERMLINK/DESCRIPTION/
CONTACT/...), then species banners ("****** Ar ******") and collision-process
blocks.  A process block looks like:

    EXCITATION                 <- (optional) bare type keyword   [Morgan only]
    O -> O(1D)                 <- (optional) bare reaction        [Morgan only]
     1.968000e+0               <- (optional) bare threshold/mass  [Morgan only]
    SPECIES: e / O             <- projectile / target
    PROCESS: E + O -> E + O(1D), Excitation
    PARAM.:  E = 1.968 eV, complete set
    COMMENT: ...               <- zero or more
    UPDATED: 2010-08-03 13:00:22
    COLUMNS: Energy (eV) | Cross section (m2)
    -----------------------------
     <energy_eV>\t<cross_section_m2>
     ...
    -----------------------------

Phelps ion-neutral blocks omit the three bare lines and start at SPECIES:.

Parsing strategy
----------------
Every block — in both databases — ends in a dashed data table and carries a
PROCESS: line and a PARAM.: line.  So we anchor on the dashed tables and read
the structured header lines (SPECIES/PROCESS/PARAM/COMMENT/UPDATED) that precede
each table.  This is robust to the Morgan/Phelps structural differences.

Usage
-----
    python3 tools/parse_lxcat.py "source/Cross section.txt" data/cross_sections.json
"""

import json
import re
import sys
from datetime import datetime, timezone

# Collision-type keywords that may appear as a bare line in Morgan blocks.
TYPE_KEYWORDS = {
    "ELASTIC", "EFFECTIVE", "EXCITATION", "IONIZATION",
    "ATTACHMENT", "ROTATION", "VIBRATION",
}

# Regexes for the structured header lines.
RE_DASHES = re.compile(r"^\s*-{5,}\s*$")          # data-table delimiter
RE_SEPARATOR = re.compile(r"^\s*[x*]{5,}\s*$")    # x/*-rule between sections
RE_BANNER = re.compile(r"^\s*\*{3,}(.*?)\*{3,}\s*$")  # ***** species *****
RE_FLOAT = r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?"
RE_DATA_ROW = re.compile(r"^\s*(" + RE_FLOAT + r")\s+(" + RE_FLOAT + r")\s*$")
RE_LONE_FLOAT = re.compile(r"^\s*" + RE_FLOAT + r"\s*$")   # LXCat 3rd line (threshold/mass)


def fnum(text):
    """Parse a float, returning None on failure."""
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def parse_param(param):
    """Pull physics quantities out of a PARAM.: string.

    Handles the observed variants:
      m/M = 0.000039157, complete set          (elastic / effective)
      E = 14.549 eV, complete set              (excitation / ionization)
      Mi = 39.948, Mi/M = 1, complete set      (ion-neutral)
    """
    out = {
        "threshold_eV": None,   # energy loss / threshold (inelastic)
        "mass_ratio": None,     # m/M  (electron mass / target mass)
        "ion_mass_amu": None,   # Mi   (projectile-ion mass)
        "ion_mass_ratio": None, # Mi/M (ion mass / target mass)
        "stat_weight_ratio": None,
        "complete_set": False,
    }
    if not param:
        return out

    m = re.search(r"\bE\s*=\s*(" + RE_FLOAT + r")\s*eV", param)
    if m:
        out["threshold_eV"] = fnum(m.group(1))
    m = re.search(r"\bm/M\s*=\s*(" + RE_FLOAT + r")", param)
    if m:
        out["mass_ratio"] = fnum(m.group(1))
    m = re.search(r"\bMi/M\s*=\s*(" + RE_FLOAT + r")", param)
    if m:
        out["ion_mass_ratio"] = fnum(m.group(1))
    m = re.search(r"\bMi\s*=\s*(" + RE_FLOAT + r")", param)
    if m:
        out["ion_mass_amu"] = fnum(m.group(1))
    # statistical-weight ratio sometimes given as "g2/g1 = ..."
    m = re.search(r"\bg2?/g1?\s*=\s*(" + RE_FLOAT + r")", param)
    if m:
        out["stat_weight_ratio"] = fnum(m.group(1))
    out["complete_set"] = "complete set" in param.lower()
    return out


def classify(proc_type, reaction, comment):
    """Map the raw process type onto (category, family, projectile-kind)."""
    t = (proc_type or "").strip().lower()
    text = f"{reaction} {comment}".lower()

    if t in ("backscat", "isotropic"):
        family = "Ion-neutral"
        category = "Ion " + proc_type.strip().capitalize()
    elif t == "elastic":
        family, category = "Electron", "Elastic"
    elif t == "effective":
        family, category = "Electron", "Effective"
    elif t == "ionization":
        family, category = "Electron", "Ionization"
    elif t == "attachment":
        family, category = "Electron", "Attachment"
    elif t == "excitation":
        family = "Electron"
        if "rotational" in text or re.search(r"\(j\d", text):
            category = "Excitation (rotational)"
        elif "vibrational" in text or "vibexc" in text or re.search(r"\(v\d", text):
            category = "Excitation (vibrational)"
        else:
            category = "Excitation (electronic)"
    else:
        family, category = "Other", proc_type.strip().title() or "Unknown"
    return category, family


def slugify(text):
    return re.sub(r"[^A-Za-z0-9]+", "_", text).strip("_")


def build_record(header_lines, database, banner, energy, sigma, index):
    """Assemble one process record from accumulated header lines + data table."""
    fields = {"comments": []}
    bare_keyword = None
    bare_reaction = None
    bare_threshold = None

    for ln in header_lines:
        s = ln.strip()
        if not s:
            continue
        upper = s.upper()
        if upper in TYPE_KEYWORDS:
            bare_keyword = upper
        elif s.startswith("SPECIES:"):
            fields["species_line"] = s[len("SPECIES:"):].strip()
        elif s.startswith("PROCESS:"):
            fields["process_line"] = s[len("PROCESS:"):].strip()
        elif s.startswith("PARAM."):
            fields["param"] = s.split(":", 1)[1].strip() if ":" in s else ""
        elif s.startswith("COMMENT:"):
            fields["comments"].append(s[len("COMMENT:"):].strip())
        elif s.startswith("UPDATED:"):
            fields["updated"] = s[len("UPDATED:"):].strip()
        elif s.startswith("COLUMNS:"):
            fields["columns"] = s[len("COLUMNS:"):].strip()
        elif "->" in s and bare_reaction is None:
            bare_reaction = s
        elif bare_threshold is None and RE_LONE_FLOAT.match(s):
            # lone float (LXCat 3rd line) = bare threshold (inelastic) / mass ratio (elastic)
            bare_threshold = fnum(s)

    process_line = fields.get("process_line", "")
    species_line = fields.get("species_line", "")

    # Reaction + type come from the PROCESS line: "<reaction>, <Type>"
    if "," in process_line:
        reaction, proc_type = process_line.rsplit(",", 1)
        reaction, proc_type = reaction.strip(), proc_type.strip()
    else:
        reaction, proc_type = process_line.strip(), (bare_keyword or "").title()

    # Projectile / target from SPECIES line "e / O" or "Ar^+ / Ar"
    if "/" in species_line:
        projectile, target = [p.strip() for p in species_line.split("/", 1)]
    else:
        projectile, target = "", species_line.strip()

    comment = " ".join(fields["comments"]).strip()
    param = fields.get("param", "")
    phys = parse_param(param)
    category, family = classify(proc_type, reaction, comment)

    # Threshold fallback: bare line (Morgan) when PARAM lacks an explicit E=.
    threshold = phys["threshold_eV"]
    if threshold is None and bare_threshold is not None and family == "Electron" \
            and category not in ("Elastic", "Effective"):
        threshold = bare_threshold

    target_label = target or (banner or "?")
    label = f"{database.split()[0]} · {target_label} · {reaction or proc_type}"
    pid = f"{slugify(database.split()[0])}__{slugify(target_label)}__{slugify(proc_type)}__{index:02d}"

    e_list = [e for e in energy]
    s_list = [s for s in sigma]

    return {
        "id": pid,
        "label": label,
        "database": database,
        "species_banner": banner,
        "target": target_label,
        "projectile": projectile,
        "reaction": reaction,
        "type": proc_type,            # raw LXCat type token
        "category": category,         # normalized category for filtering
        "family": family,             # Electron / Ion-neutral / Other
        "threshold_eV": threshold,
        "mass_ratio": phys["mass_ratio"],
        "ion_mass_amu": phys["ion_mass_amu"],
        "ion_mass_ratio": phys["ion_mass_ratio"],
        "stat_weight_ratio": phys["stat_weight_ratio"],
        "complete_set": phys["complete_set"],
        "param_raw": param,
        "comment": comment,
        "updated": fields.get("updated", ""),
        "columns": fields.get("columns", "Energy (eV) | Cross section (m2)"),
        "energy_unit": "eV",
        "cross_section_unit": "m2",
        "n_points": len(e_list),
        "energy_min_eV": min(e_list) if e_list else None,
        "energy_max_eV": max(e_list) if e_list else None,
        "sigma_max_m2": max(s_list) if s_list else None,
        "energy": e_list,
        "cross_section": s_list,
    }


def parse_database_meta(lines):
    """Extract per-database descriptive metadata (name, permlink, description...)."""
    dbs = {}
    current = None
    key = None
    for raw in lines:
        s = raw.rstrip("\n")
        st = s.strip()
        m = re.match(r"^([A-Z][A-Z ]+?):\s*(.*)$", s)
        if s.startswith("DATABASE:"):
            current = s[len("DATABASE:"):].strip()
            dbs[current] = {"name": current, "permlink": "", "description": "",
                            "contact": "", "how_to_reference": ""}
            key = "description"  # default continuation bucket is description
            continue
        if current is None:
            continue
        if s.startswith("PERMLINK:"):
            dbs[current]["permlink"] = s.split(":", 1)[1].strip()
            key = "permlink"
        elif s.startswith("DESCRIPTION:"):
            dbs[current]["description"] = s.split(":", 1)[1].strip()
            key = "description"
        elif s.startswith("CONTACT:"):
            dbs[current]["contact"] = s.split(":", 1)[1].strip()
            key = "contact"
        elif s.startswith("HOW TO REFERENCE:"):
            dbs[current]["how_to_reference"] = s.split(":", 1)[1].strip()
            key = "how_to_reference"
        elif RE_SEPARATOR.match(s) or RE_BANNER.match(s):
            current = None  # left the database header
        elif st and key and current:
            # wrapped continuation line of the current field
            dbs[current][key] = (dbs[current][key] + " " + st).strip()
    return dbs


def parse_file(path):
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        lines = fh.readlines()

    db_meta = parse_database_meta(lines)

    processes = []
    current_db = None
    current_banner = None
    header_lines = []
    in_table = False
    cur_E, cur_S = [], []
    idx = 0

    for raw in lines:
        line = raw.rstrip("\n")

        if RE_DASHES.match(line):
            if not in_table:
                in_table = True
                cur_E, cur_S = [], []
            else:
                in_table = False
                rec = build_record(header_lines, current_db or "Unknown",
                                    current_banner, cur_E, cur_S, idx)
                if rec["n_points"] > 0:
                    processes.append(rec)
                    idx += 1
                header_lines = []
            continue

        if in_table:
            m = RE_DATA_ROW.match(line)
            if m:
                e, s = fnum(m.group(1)), fnum(m.group(2))
                if e is not None and s is not None:
                    cur_E.append(e)
                    cur_S.append(s)
            continue

        # --- structural / header territory (outside any data table) ---
        if line.startswith("DATABASE:"):
            current_db = line[len("DATABASE:"):].strip()
            header_lines = []
            continue

        bm = RE_BANNER.match(line)
        if bm:
            inner = bm.group(1).strip()
            if inner:
                current_banner = inner
            header_lines = []           # banner resets the header buffer
            continue

        if RE_SEPARATOR.match(line):
            header_lines = []           # x/*-rule resets the header buffer
            continue

        if line.strip() == "":
            continue

        header_lines.append(line)

    return db_meta, processes


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    src, dst = sys.argv[1], sys.argv[2]
    db_meta, processes = parse_file(src)

    species = sorted({p["target"] for p in processes})
    categories = sorted({p["category"] for p in processes})
    databases = sorted({p["database"] for p in processes})

    dataset = {
        "schema": "lxcat-cross-sections/1.0",
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source_file": src.split("/")[-1],
        "source": "LXCat, www.lxcat.net",
        "units": {"energy": "eV", "cross_section": "m2"},
        "databases": [db_meta.get(d, {"name": d}) for d in databases],
        "facets": {
            "databases": databases,
            "species": species,
            "categories": categories,
        },
        "counts": {
            "processes": len(processes),
            "data_points": sum(p["n_points"] for p in processes),
        },
        "processes": processes,
    }

    with open(dst, "w", encoding="utf-8") as fh:
        json.dump(dataset, fh, ensure_ascii=False, separators=(",", ":"))

    print(f"Parsed {len(processes)} processes "
          f"({dataset['counts']['data_points']} data points) "
          f"from {len(databases)} databases, {len(species)} species.")
    print(f"Wrote {dst}")


if __name__ == "__main__":
    main()
