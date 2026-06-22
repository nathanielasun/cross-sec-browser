/* ===================================================================
   export.js — turn a selection of processes into downloadable files.
   Formats:
     • zip-pair     : one CSV + one JSON sidecar per process, + manifest + README
     • zip-combined : single long-format CSV + combined metadata JSON + README
     • lxcat        : re-export the selection as an LXCat .txt block file
   Optional unit conversion for energy and cross section.
   =================================================================== */
(function (global) {
  "use strict";

  // ---- unit conversions FROM source units (energy eV, sigma m^2) ----
  const E_FACTOR = { eV: 1, keV: 1e-3, J: 1.602176634e-19 };
  const S_FACTOR = { m2: 1, cm2: 1e4, A2: 1e20 };
  const E_LABEL = { eV: "eV", keV: "keV", J: "J" };
  const S_LABEL = { m2: "m2", cm2: "cm2", A2: "A2" };
  const S_PRETTY = { m2: "m^2", cm2: "cm^2", A2: "angstrom^2" };

  function fmt(v) {
    if (v === 0 || v === null || v === undefined) return "0.000000e+00";
    return Number(v).toExponential(6);
  }

  function convE(v, u) { return v === null || v === undefined ? v : v * E_FACTOR[u]; }
  function convS(v, u) { return v === null || v === undefined ? v : v * S_FACTOR[u]; }

  function sanitize(name) {
    return String(name).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  }

  // ------------------------------------------------------------------
  //  Per-process CSV  (numpy.loadtxt / pandas-friendly: '#' comments)
  // ------------------------------------------------------------------
  function processCsv(p, opts) {
    const eu = opts.unitE, su = opts.unitS;
    const L = [];
    L.push("# Cross-Section Browser export — " + opts.stampISO);
    L.push("# source: " + (opts.datasetSource || "LXCat, www.lxcat.net"));
    L.push("# database: " + p.database);
    L.push("# process_id: " + p.id);
    L.push("# reaction: " + (p.reaction || ""));
    L.push("# type: " + p.type + "   |   category: " + p.category + "   |   family: " + p.family);
    L.push("# species: " + p.projectile + " / " + p.target);
    if (p.threshold_eV !== null && p.threshold_eV !== undefined)
      L.push("# threshold: " + convE(p.threshold_eV, eu) + " " + E_LABEL[eu]);
    if (p.mass_ratio !== null && p.mass_ratio !== undefined)
      L.push("# mass_ratio_m_over_M: " + p.mass_ratio);
    if (p.ion_mass_amu !== null && p.ion_mass_amu !== undefined)
      L.push("# ion_mass_amu: " + p.ion_mass_amu);
    if (p.param_raw) L.push("# param: " + p.param_raw);
    if (p.comment) L.push("# comment: " + p.comment);
    if (p.updated) L.push("# updated: " + p.updated);
    L.push("# n_points: " + p.n_points);
    L.push("# columns: energy [" + E_LABEL[eu] + "], cross_section [" + S_PRETTY[su] + "]");
    L.push("energy_" + E_LABEL[eu] + ",cross_section_" + S_LABEL[su]);
    for (let i = 0; i < p.energy.length; i++) {
      L.push(fmt(convE(p.energy[i], eu)) + "," + fmt(convS(p.cross_section[i], su)));
    }
    return L.join("\n") + "\n";
  }

  // ------------------------------------------------------------------
  //  Per-process metadata sidecar (no data arrays — those live in CSV)
  // ------------------------------------------------------------------
  function processSidecar(p, opts, csvName) {
    const eu = opts.unitE, su = opts.unitS;
    return {
      schema: "cross-section-metadata/1.0",
      generated_utc: opts.stampISO,
      source: opts.datasetSource || "LXCat, www.lxcat.net",
      data_file: csvName,
      data_kind: p.data_kind || "total",
      process_id: p.id,
      database: p.database,
      reaction: p.reaction,
      type: p.type,
      category: p.category,
      family: p.family,
      projectile: p.projectile,
      target: p.target,
      threshold: numOrNull(convE(p.threshold_eV, eu)),
      mass_ratio_m_over_M: p.mass_ratio ?? null,
      ion_mass_amu: p.ion_mass_amu ?? null,
      ion_mass_ratio: p.ion_mass_ratio ?? null,
      stat_weight_ratio: p.stat_weight_ratio ?? null,
      complete_set: !!p.complete_set,
      param_raw: p.param_raw || "",
      comment: p.comment || "",
      updated: p.updated || "",
      units: { energy: E_LABEL[eu], cross_section: S_PRETTY[su] },
      source_units: { energy: "eV", cross_section: "m^2" },
      conversion_from_source: { energy: E_FACTOR[eu], cross_section: S_FACTOR[su] },
      n_points: p.n_points,
      energy_min: numOrNull(convE(p.energy_min_eV, eu)),
      energy_max: numOrNull(convE(p.energy_max_eV, eu)),
      sigma_max: numOrNull(convS(p.sigma_max_m2, su)),
    };
  }

  function numOrNull(v) { return (v === null || v === undefined) ? null : v; }

  // ------------------------------------------------------------------
  //  Combined long-format CSV (one stacked table for all processes)
  // ------------------------------------------------------------------
  function combinedCsv(procs, opts) {
    const eu = opts.unitE, su = opts.unitS;
    const L = [];
    L.push("# Cross-Section Browser — combined export — " + opts.stampISO);
    L.push("# source: " + (opts.datasetSource || "LXCat, www.lxcat.net"));
    L.push("# units: energy [" + E_LABEL[eu] + "], cross_section [" + S_PRETTY[su] + "]");
    L.push("# processes: " + procs.length + " (see accompanying _metadata.json)");
    L.push([
      "process_id", "database", "target", "category", "reaction",
      "threshold_" + E_LABEL[eu], "energy_" + E_LABEL[eu], "cross_section_" + S_LABEL[su],
    ].join(","));
    for (const p of procs) {
      const thr = (p.threshold_eV ?? "") === "" ? "" : fmt(convE(p.threshold_eV, eu));
      const rx = '"' + (p.reaction || "").replace(/"/g, '""') + '"';
      for (let i = 0; i < p.energy.length; i++) {
        L.push([
          p.id, '"' + p.database + '"', p.target, '"' + p.category + '"', rx,
          thr, fmt(convE(p.energy[i], eu)), fmt(convS(p.cross_section[i], su)),
        ].join(","));
      }
    }
    return L.join("\n") + "\n";
  }

  // ------------------------------------------------------------------
  //  LXCat text re-export (always in canonical eV / m^2)
  // ------------------------------------------------------------------
  function lxcatText(procs, opts) {
    const L = [];
    L.push("LXCat-format export generated by Cross-Section Browser, " + opts.stampISO);
    L.push("Original source: " + (opts.datasetSource || "LXCat, www.lxcat.net"));
    L.push("Units: energy in eV, cross section in m2 (LXCat canonical).");
    L.push("");
    const byDb = {};
    for (const p of procs) (byDb[p.database] = byDb[p.database] || []).push(p);
    for (const db of Object.keys(byDb)) {
      L.push("x".repeat(60));
      L.push("DATABASE:         " + db);
      L.push("x".repeat(60));
      L.push("");
      for (const p of byDb[db]) {
        const kw = (p.type || "").toUpperCase();
        L.push(kw);
        L.push(p.reaction || p.target);
        if (p.threshold_eV !== null && p.threshold_eV !== undefined) L.push(" " + fmt(p.threshold_eV));
        else if (p.mass_ratio !== null && p.mass_ratio !== undefined) L.push(" " + fmt(p.mass_ratio));
        L.push("SPECIES: " + p.projectile + " / " + p.target);
        L.push("PROCESS: " + (p.reaction ? p.reaction + ", " : "") + p.type);
        if (p.param_raw) L.push("PARAM.:  " + p.param_raw);
        if (p.comment) L.push("COMMENT: " + p.comment);
        if (p.updated) L.push("UPDATED: " + p.updated);
        L.push("COLUMNS: Energy (eV) | Cross section (m2)");
        L.push("-".repeat(29));
        for (let i = 0; i < p.energy.length; i++) {
          L.push(" " + fmt(p.energy[i]) + "\t" + fmt(p.cross_section[i]));
        }
        L.push("-".repeat(29));
        L.push("");
      }
    }
    return L.join("\n") + "\n";
  }

  // ------------------------------------------------------------------
  //  Manifest + README
  // ------------------------------------------------------------------
  function buildManifest(procs, opts, files) {
    return {
      schema: "cross-section-export-manifest/1.0",
      generated_utc: opts.stampISO,
      source: opts.datasetSource || "LXCat, www.lxcat.net",
      provenance: opts.provenance || {},
      units: { energy: E_LABEL[opts.unitE], cross_section: S_PRETTY[opts.unitS] },
      n_processes: procs.length,
      n_points: procs.reduce((a, p) => a + p.n_points, 0),
      files: files,
      processes: procs.map((p) => ({
        process_id: p.id, database: p.database, target: p.target,
        category: p.category, reaction: p.reaction,
        threshold_eV: p.threshold_eV ?? null, n_points: p.n_points,
      })),
    };
  }

  function readmeText(opts, mode) {
    return [
      "Cross-Section Browser — data export",
      "===================================",
      "Generated : " + opts.stampISO,
      "Source    : " + (opts.datasetSource || "LXCat, www.lxcat.net"),
      "Units     : energy = " + E_LABEL[opts.unitE] + ", cross section = " + S_PRETTY[opts.unitS],
      "",
      mode === "zip-pair"
        ? [
            "Contents",
            "--------",
            "  <id>.csv   two columns (energy, cross_section). '#'-comment header lines",
            "             carry the physics metadata; numpy.loadtxt and pandas",
            "             (comment='#') skip them automatically.",
            "  <id>.json  full metadata sidecar for the matching .csv.",
            "  manifest.json  machine-readable index of every file + provenance.",
          ].join("\n")
        : [
            "Contents",
            "--------",
            "  *_combined.csv   all selected processes stacked in long format",
            "                   (process_id, database, target, category, reaction,",
            "                    threshold, energy, cross_section).",
            "  *_metadata.json  per-process metadata + provenance.",
          ].join("\n"),
      "",
      "PIC-MCC import notes",
      "--------------------",
      "  • Cross sections are tabulated vs. incident energy; interpolate in",
      "    log-log space between points for collision-rate evaluation.",
      "  • Inelastic processes carry a threshold energy; sigma = 0 below it.",
      "  • LXCat 'Effective' = total momentum-transfer (elastic + inelastic);",
      "    do NOT double-count it alongside explicit elastic + inelastic sets.",
      "  • Phelps ion entries are ion-neutral (Backscat / Isotropic) momentum",
      "    transfer cross sections, indexed by ION energy in the lab frame.",
      "",
      "Cite the original source per the database reference requirements.",
      "",
    ].join("\n");
  }

  // ------------------------------------------------------------------
  //  Top-level: build the downloadable for a selection.
  //  Returns { filename, blob }.
  // ------------------------------------------------------------------
  function build(procs, opts) {
    const prefix = sanitize(opts.prefix || "cross_sections") || "cross_sections";
    const mode = opts.mode;

    if (mode === "lxcat") {
      return { filename: prefix + "_lxcat.txt",
               blob: new Blob([lxcatText(procs, opts)], { type: "text/plain" }) };
    }

    const files = [];
    if (mode === "zip-combined") {
      const csvName = prefix + "_combined.csv";
      const metaName = prefix + "_metadata.json";
      files.push({ name: prefix + "/" + csvName, data: combinedCsv(procs, opts) });
      const meta = { schema: "cross-section-combined-metadata/1.0", generated_utc: opts.stampISO,
        source: opts.datasetSource, units: { energy: E_LABEL[opts.unitE], cross_section: S_PRETTY[opts.unitS] },
        provenance: opts.provenance || {},
        processes: procs.map((p) => processSidecar(p, opts, csvName)) };
      files.push({ name: prefix + "/" + metaName, data: JSON.stringify(meta, null, 2) });
      files.push({ name: prefix + "/README.txt", data: readmeText(opts, mode) });
    } else { // zip-pair (default)
      const fileList = [];
      for (const p of procs) {
        const base = sanitize(p.id);
        const csvName = base + ".csv", jsonName = base + ".json";
        files.push({ name: prefix + "/" + csvName, data: processCsv(p, opts) });
        files.push({ name: prefix + "/" + jsonName, data: JSON.stringify(processSidecar(p, opts, csvName), null, 2) });
        fileList.push({ process_id: p.id, csv: csvName, json: jsonName });
      }
      files.push({ name: prefix + "/manifest.json",
                   data: JSON.stringify(buildManifest(procs, opts, fileList), null, 2) });
      files.push({ name: prefix + "/README.txt", data: readmeText(opts, mode) });
    }

    return { filename: prefix + ".zip", blob: global.CSBZip.makeZip(files) };
  }

  function triggerDownload(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  global.CSBExport = { build, triggerDownload, processCsv, combinedCsv, lxcatText, processSidecar };
})(window);
