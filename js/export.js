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
    const diff = p.data_kind === "differential";
    const L = [];
    L.push("# Cross-Section Browser export — " + opts.stampISO);
    L.push("# source: " + (opts.datasetSource || "LXCat, www.lxcat.net"));
    L.push("# database: " + p.database);
    L.push("# process_id: " + p.id);
    L.push("# reaction: " + (p.reaction || ""));
    L.push("# type: " + p.type + "   |   category: " + p.category + "   |   family: " + p.family);
    L.push("# data_kind: " + (p.data_kind || "total"));
    L.push("# species: " + p.projectile + " / " + p.target);
    if (diff) {
      if (p.incident_energy_eV != null) L.push("# incident_energy_T: " + p.incident_energy_eV + " eV");
      if (p.threshold_eV != null) L.push("# ionization_potential_B: " + p.threshold_eV + " eV");
      if (p.wmax_eV != null) L.push("# W_max: " + p.wmax_eV + " eV");
    } else {
      if (p.threshold_eV != null) L.push("# threshold: " + convE(p.threshold_eV, eu) + " " + E_LABEL[eu]);
      if (p.mass_ratio != null) L.push("# mass_ratio_m_over_M: " + p.mass_ratio);
      if (p.ion_mass_amu != null) L.push("# ion_mass_amu: " + p.ion_mass_amu);
    }
    if (p.param_raw) L.push("# param: " + p.param_raw);
    if (p.comment) L.push("# comment: " + p.comment);
    if (p.updated) L.push("# updated: " + p.updated);
    L.push("# n_points: " + p.n_points);
    if (diff) {
      // SDCS: W stays in eV; only the area part of dσ/dW is unit-converted.
      L.push("# columns: W [eV], dsigma_dW [" + S_PRETTY[su] + "/eV]");
      L.push("W_eV,dsigma_dW_" + S_LABEL[su] + "_per_eV");
      for (let i = 0; i < p.energy.length; i++) {
        L.push(fmt(p.energy[i]) + "," + fmt(convS(p.cross_section[i], su)));
      }
    } else {
      L.push("# columns: energy [" + E_LABEL[eu] + "], cross_section [" + S_PRETTY[su] + "]");
      L.push("energy_" + E_LABEL[eu] + ",cross_section_" + S_LABEL[su]);
      for (let i = 0; i < p.energy.length; i++) {
        L.push(fmt(convE(p.energy[i], eu)) + "," + fmt(convS(p.cross_section[i], su)));
      }
    }
    return L.join("\n") + "\n";
  }

  // ------------------------------------------------------------------
  //  Per-process metadata sidecar (no data arrays — those live in CSV)
  // ------------------------------------------------------------------
  function processSidecar(p, opts, csvName) {
    const eu = opts.unitE, su = opts.unitS;
    const diff = p.data_kind === "differential";
    const base = {
      schema: "cross-section-metadata/1.1",
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
      mass_ratio_m_over_M: p.mass_ratio ?? null,
      ion_mass_amu: p.ion_mass_amu ?? null,
      ion_mass_ratio: p.ion_mass_ratio ?? null,
      stat_weight_ratio: p.stat_weight_ratio ?? null,
      complete_set: !!p.complete_set,
      param_raw: p.param_raw || "",
      comment: p.comment || "",
      updated: p.updated || "",
      n_points: p.n_points,
    };
    if (diff) {
      return Object.assign(base, {
        incident_energy_eV: p.incident_energy_eV ?? null,
        ionization_potential_B_eV: p.threshold_eV ?? null,
        wmax_eV: p.wmax_eV ?? null,
        axes: { x_quantity: p.x_quantity || "Ejected electron energy W", y_quantity: p.y_quantity || "dsigma/dW" },
        units: { x: "eV", y: S_PRETTY[su] + "/eV" },
        source_units: { x: "eV", y: "m^2/eV" },
        conversion_from_source: { x: 1, y: S_FACTOR[su] },
        x_min: numOrNull(p.energy_min_eV),
        x_max: numOrNull(p.energy_max_eV),
        y_max: numOrNull(convS(p.sigma_max_m2, su)),
      });
    }
    return Object.assign(base, {
      threshold: numOrNull(convE(p.threshold_eV, eu)),
      axes: { x_quantity: p.x_quantity || "Energy", y_quantity: p.y_quantity || "Cross section" },
      units: { x: E_LABEL[eu], y: S_PRETTY[su] },
      source_units: { x: "eV", y: "m^2" },
      conversion_from_source: { x: E_FACTOR[eu], y: S_FACTOR[su] },
      x_min: numOrNull(convE(p.energy_min_eV, eu)),
      x_max: numOrNull(convE(p.energy_max_eV, eu)),
      y_max: numOrNull(convS(p.sigma_max_m2, su)),
    });
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
    L.push("# total: x=energy [" + E_LABEL[eu] + "], y=cross_section [" + S_PRETTY[su] + "]");
    L.push("# differential (SDCS): x=W [eV], y=dsigma_dW [" + S_PRETTY[su] + "/eV], incident_energy in eV");
    L.push("# processes: " + procs.length + " (see accompanying _metadata.json)");
    L.push([
      "process_id", "database", "target", "category", "data_kind", "incident_energy_eV",
      "x_quantity", "x_unit", "x_value", "y_quantity", "y_unit", "y_value",
    ].join(","));
    for (const p of procs) {
      const diff = p.data_kind === "differential";
      const xq = '"' + (p.x_quantity || (diff ? "Ejected energy W" : "Energy")) + '"';
      const yq = '"' + (p.y_quantity || (diff ? "dsigma/dW" : "Cross section")) + '"';
      const xunit = diff ? "eV" : E_LABEL[eu];
      const yunit = diff ? (S_LABEL[su] + "/eV") : S_LABEL[su];
      const T = diff ? (p.incident_energy_eV ?? "") : "";
      for (let i = 0; i < p.energy.length; i++) {
        const xv = diff ? fmt(p.energy[i]) : fmt(convE(p.energy[i], eu));
        const yv = fmt(convS(p.cross_section[i], su));
        L.push([p.id, '"' + p.database + '"', p.target, '"' + p.category + '"',
                p.data_kind || "total", T, xq, xunit, xv, yq, yunit, yv].join(","));
      }
    }
    return L.join("\n") + "\n";
  }

  // ------------------------------------------------------------------
  //  LXCat text re-export (always in canonical eV / m^2)
  // ------------------------------------------------------------------
  function lxcatText(procs, opts) {
    const total = procs.filter((p) => p.data_kind !== "differential");
    const skipped = procs.length - total.length;
    const L = [];
    L.push("LXCat-format export generated by Cross-Section Browser, " + opts.stampISO);
    L.push("Original source: " + (opts.datasetSource || "LXCat, www.lxcat.net"));
    L.push("Units: energy in eV, cross section in m2 (LXCat canonical).");
    if (skipped) {
      L.push("NOTE: " + skipped + " differential (SDCS) process(es) omitted — the LXCat block "
           + "format represents total cross sections only; export those as CSV/JSON instead.");
    }
    L.push("");
    const byDb = {};
    for (const p of total) (byDb[p.database] = byDb[p.database] || []).push(p);
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
