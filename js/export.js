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

  // Total electron-impact cross section σ(E) in canonical eV / m^2 — the only kind
  // WarpX/LXCat σ exports and the eV↔keV / m²↔cm² unit toggle apply to. Differential
  // (SDCS), rate-coefficient k(T) and photoabsorption σ(λ) carry their own units and
  // are exported natively / skipped by σ-only formats.
  function isTotalSigma(p) { return (p.data_kind || "total") === "total"; }

  // strict: WarpX parameter names & internal file stems (no +,(,) which can break parsers)
  function sanitize(name) {
    return String(name).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  }
  // relaxed: download filename / folder — keep reaction chars () + so e.g. CO2+ survives
  function fileStem(name) {
    return String(name).replace(/[^A-Za-z0-9()._+-]+/g, "_").replace(/_+/g, "_").replace(/^[_\s]+|[_\s]+$/g, "");
  }

  // ------------------------------------------------------------------
  //  Per-process CSV  (numpy.loadtxt / pandas-friendly: '#' comments)
  // ------------------------------------------------------------------
  function processCsv(p, opts) {
    const eu = opts.unitE, su = opts.unitS;
    const diff = p.data_kind === "differential";
    const total = isTotalSigma(p);
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
    } else if (total) {
      L.push("# columns: energy [" + E_LABEL[eu] + "], cross_section [" + S_PRETTY[su] + "]");
      L.push("energy_" + E_LABEL[eu] + ",cross_section_" + S_LABEL[su]);
      for (let i = 0; i < p.energy.length; i++) {
        L.push(fmt(convE(p.energy[i], eu)) + "," + fmt(convS(p.cross_section[i], su)));
      }
    } else {
      // rate-coefficient / photoabsorption: native units (the eV/m² toggle does not apply).
      const xu = p.x_unit || "x", yu = p.y_unit || "y";
      const xq = (p.x_quantity || "x").replace(/\s+/g, "_");
      const yq = (p.y_quantity || "y").replace(/\s+/g, "_");
      L.push("# columns: " + (p.x_quantity || "x") + " [" + xu + "], " + (p.y_quantity || "y") + " [" + yu + "]");
      L.push(xq + "_" + xu.replace(/\//g, "_per_") + "," + yq + "_" + yu.replace(/\//g, "_per_"));
      for (let i = 0; i < p.energy.length; i++) {
        L.push(fmt(p.energy[i]) + "," + fmt(p.cross_section[i]));
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
    const total = isTotalSigma(p);
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
    if (!total) {
      // rate-coefficient / photoabsorption: native units, no eV/m² conversion.
      return Object.assign(base, {
        threshold: numOrNull(p.threshold_eV),
        axes: { x_quantity: p.x_quantity || "x", y_quantity: p.y_quantity || "y" },
        units: { x: p.x_unit || "", y: p.y_unit || "" },
        source_units: { x: p.x_unit || "", y: p.y_unit || "" },
        conversion_from_source: { x: 1, y: 1 },
        x_min: numOrNull(p.energy_min_eV),
        x_max: numOrNull(p.energy_max_eV),
        y_max: numOrNull(p.sigma_max_m2),
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
    L.push("# rate (k(T)) / photoabsorption: native units per the x_unit/y_unit columns (no eV/m² conversion)");
    L.push("# processes: " + procs.length + " (see accompanying _metadata.json)");
    L.push([
      "process_id", "database", "target", "category", "data_kind", "incident_energy_eV",
      "x_quantity", "x_unit", "x_value", "y_quantity", "y_unit", "y_value",
    ].join(","));
    for (const p of procs) {
      const diff = p.data_kind === "differential";
      const total = isTotalSigma(p);
      const xq = '"' + (p.x_quantity || (diff ? "Ejected energy W" : "Energy")) + '"';
      const yq = '"' + (p.y_quantity || (diff ? "dsigma/dW" : "Cross section")) + '"';
      const xunit = total ? E_LABEL[eu] : (diff ? "eV" : (p.x_unit || ""));
      const yunit = total ? S_LABEL[su] : (diff ? (S_LABEL[su] + "/eV") : (p.y_unit || ""));
      const T = diff ? (p.incident_energy_eV ?? "") : "";
      for (let i = 0; i < p.energy.length; i++) {
        const xv = total ? fmt(convE(p.energy[i], eu)) : fmt(p.energy[i]);
        const yv = (total || diff) ? fmt(convS(p.cross_section[i], su)) : fmt(p.cross_section[i]);
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
    const total = procs.filter(isTotalSigma);
    const skipped = procs.length - total.length;
    const L = [];
    L.push("LXCat-format export generated by Cross-Section Browser, " + opts.stampISO);
    L.push("Original source: " + (opts.datasetSource || "LXCat, www.lxcat.net"));
    L.push("Units: energy in eV, cross section in m2 (LXCat canonical).");
    if (skipped) {
      L.push("NOTE: " + skipped + " non-total process(es) omitted (differential SDCS, "
           + "rate-coefficient k(T), and/or photoabsorption σ(λ)) — the LXCat block format "
           + "represents total cross sections σ(E) only; export those as CSV/JSON instead.");
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
  //  NIST-style SDCS text for differential processes (canonical eV / m^2/eV),
  //  preserving the incident energy T, ionization potential B and Wmax.
  // ------------------------------------------------------------------
  function sdcsText(procs, opts) {
    const diffs = procs.filter((p) => p.data_kind === "differential");
    const L = [];
    L.push("Singly differential ionization cross sections (SDCS) — exported by Cross-Section Browser, " + opts.stampISO);
    L.push("Source: " + (opts.datasetSource || "NIST SRD 107"));
    L.push("Units: ejected-electron energy W in eV; dsigma/dW in m2/eV.");
    L.push("");
    for (const p of diffs) {
      L.push("=".repeat(64));
      L.push("SPECIES: " + p.projectile + " / " + p.target);
      L.push("PROCESS: " + (p.reaction || (p.type + ", SDCS")));
      if (p.incident_energy_eV != null) L.push("INCIDENT ENERGY T: " + p.incident_energy_eV + " eV");
      if (p.threshold_eV != null) L.push("IONIZATION POTENTIAL B: " + p.threshold_eV + " eV");
      if (p.wmax_eV != null) L.push("WMAX: " + p.wmax_eV + " eV");
      if (p.param_raw) L.push("PARAM.:  " + p.param_raw);
      if (p.comment) L.push("COMMENT: " + p.comment);
      L.push("COLUMNS: W (eV) | dsigma/dW (m2/eV)");
      L.push("-".repeat(29));
      for (let i = 0; i < p.energy.length; i++) {
        L.push(" " + fmt(p.energy[i]) + "\t" + fmt(p.cross_section[i]));
      }
      L.push("-".repeat(29));
      L.push("");
    }
    return L.join("\n") + "\n";
  }

  // Standard .txt: total -> LXCat blocks, differential -> NIST SDCS blocks.
  // Single file when homogeneous; a .zip pairing both when mixed.
  function buildStandardTxt(procs, opts, prefix) {
    const totals = procs.filter(isTotalSigma);
    const diffs = procs.filter((p) => p.data_kind === "differential");
    if (!diffs.length) {
      return { filename: prefix + "_lxcat.txt",
               blob: new Blob([lxcatText(procs, opts)], { type: "text/plain" }) };
    }
    if (!totals.length) {
      return { filename: prefix + "_sdcs.txt",
               blob: new Blob([sdcsText(procs, opts)], { type: "text/plain" }) };
    }
    const files = [
      { name: prefix + "/" + prefix + "_lxcat.txt", data: lxcatText(totals, opts) },
      { name: prefix + "/" + prefix + "_sdcs.txt", data: sdcsText(diffs, opts) },
      { name: prefix + "/README.txt", data: [
        "Standard cross-section text export",
        "Generated: " + opts.stampISO,
        "",
        prefix + "_lxcat.txt  total cross sections in canonical LXCat block format",
        "                    (energy eV, cross section m2) — read by BOLSIG+, VSim,",
        "                    Magboltz and other LXCat-compatible tools.",
        prefix + "_sdcs.txt   differential (SDCS) dsigma/dW vs ejected energy W",
        "                    (W eV, dsigma/dW m2/eV), with T, B and Wmax preserved.",
        "",
      ].join("\n") },
    ];
    return { filename: prefix + "_standard_txt.zip", blob: global.CSBZip.makeZip(files) };
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
  //  WarpX export: BackgroundMCCCollisions reads a 2-column file with
  //  EQUALLY SPACED energy (eV) and cross section (m^2). Our tables are
  //  non-uniform, so we resample onto a uniform grid by linear interpolation.
  // ------------------------------------------------------------------
  function resampleUniform(E, S) {
    const lo = E[0], hi = E[E.length - 1];
    let finest = Infinity;
    for (let i = 1; i < E.length; i++) finest = Math.min(finest, E[i] - E[i - 1]);
    if (!isFinite(finest) || finest <= 0) finest = (hi - lo) / 200;
    const n = Math.min(1000, Math.max(100, Math.ceil((hi - lo) / finest) + 1));
    const step = (hi - lo) / (n - 1);
    const out = [];
    let j = 0;
    for (let i = 0; i < n; i++) {
      const x = (i === n - 1) ? hi : lo + step * i;
      while (j < E.length - 2 && E[j + 1] < x) j++;
      const x0 = E[j], x1 = E[j + 1], y0 = S[j], y1 = S[j + 1];
      let t = x1 > x0 ? (x - x0) / (x1 - x0) : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      out.push([x, y0 + t * (y1 - y0)]);
    }
    return out;
  }

  // map our category/type onto a WarpX scattering-process keyword
  function warpxKind(p) {
    const c = (p.category || "").toLowerCase();
    if (c.includes("ionization") && !c.includes("differential")) return { key: "ionization", needsE: true, needsSpecies: true };
    if (c.includes("excitation")) return { key: "excitation", needsE: true, needsSpecies: false };
    if (c === "elastic") return { key: "elastic", needsE: false, needsSpecies: false };
    if (c === "effective") return { key: "elastic", needsE: false, needsSpecies: false, note: "effective (total momentum transfer)" };
    if (c.includes("backscat")) return { key: "back", needsE: false, needsSpecies: false };
    if (c.includes("isotropic")) return { key: "elastic", needsE: false, needsSpecies: false, note: "ion isotropic" };
    return { key: "elastic", needsE: false, needsSpecies: false, note: p.type };
  }

  function buildWarpXFiles(procs, opts, prefix) {
    const totals = procs.filter(isTotalSigma);
    const skipped = procs.length - totals.length;
    const files = [];
    const byTarget = {};

    for (const p of totals) {
      const wk = warpxKind(p);
      const grid = resampleUniform(p.energy, p.cross_section);
      // 9 sig figs on energy keeps the grid uniform well within WarpX's
      // sanityCheckEnergyGrid tolerance (|gap - dE| < dE/100); 6 figs for sigma.
      const lines = grid.map(([e, s]) => e.toExponential(8) + "    " + fmt(s));
      const fname = sanitize(p.target + "_" + p.id.split("__").slice(-2).join("_")) + ".dat";
      files.push({ name: prefix + "/xsec/" + fname, data: lines.join("\n") + "\n" });
      (byTarget[p.target] = byTarget[p.target] || []).push({ p, wk, fname });
    }

    // input-deck snippet, one collision block per background-gas target
    const deck = [
      "# WarpX BackgroundMCCCollisions snippet generated by Cross-Section Browser",
      "# " + opts.stampISO,
      "# Cross-section files are 2-column (energy[eV]  sigma[m^2]) on a UNIFORM",
      "# energy grid (resampled by linear interpolation, as WarpX requires).",
      "# Fill in <...> placeholders (species names, background density/temperature).",
      "",
    ];
    const names = [];
    for (const tgt of Object.keys(byTarget)) {
      const grp = byTarget[tgt];
      const cname = "mcc_" + sanitize(tgt);
      names.push(cname);
      deck.push("# ---- " + tgt + " background gas ----");
      deck.push(cname + ".species = electrons <" + tgt + "_gas>");
      deck.push(cname + ".background_density = <n_gas_in_m^-3>");
      deck.push(cname + ".background_temperature = <T_gas_in_K>");
      deck.push(cname + ".background_mass = <m_" + tgt + "_in_kg>   # optional");
      const procNames = [];
      const counts = {};
      for (const { wk } of grp) counts[wk.key] = (counts[wk.key] || 0) + 1;
      const idxByKey = {};
      const fileLines = [];
      for (const { p, wk, fname } of grp) {
        let pn = wk.key;
        if (counts[wk.key] > 1 || wk.key === "excitation") {
          idxByKey[wk.key] = (idxByKey[wk.key] || 0) + 1;
          pn = wk.key + idxByKey[wk.key];
        }
        procNames.push(pn);
        fileLines.push(cname + "." + pn + ".cross_section = xsec/" + fname
          + (wk.note ? "   # " + wk.note : ""));
        if (wk.needsE && p.threshold_eV != null) fileLines.push(cname + "." + pn + ".energy = " + p.threshold_eV);
        if (wk.needsSpecies) fileLines.push(cname + "." + pn + ".species = <" + tgt + "_ions>");
      }
      deck.push(cname + ".scattering_processes = " + procNames.join(" "));
      deck.push(...fileLines, "");
    }
    deck.unshift("collisions.collision_names = " + names.join(" "), "");

    files.push({ name: prefix + "/inputs_mcc_snippet.txt", data: deck.join("\n") + "\n" });
    files.push({ name: prefix + "/README.txt", data: [
      "WarpX cross-section export",
      "=========================",
      "Generated : " + opts.stampISO,
      "Source    : " + (opts.datasetSource || "LXCat, www.lxcat.net"),
      "",
      "xsec/*.dat  two columns: energy [eV]  cross_section [m^2], on a",
      "                      UNIFORM energy grid (WarpX requires equally-spaced",
      "                      energies; resampled here by linear interpolation).",
      "inputs_mcc_snippet.txt  paste into your WarpX input deck; fill <...>.",
      "",
      "Notes:",
      "  * excitation/ionization processes carry '.energy' (threshold, eV);",
      "    ionization also needs '.species' (the product ion) — set per your run.",
      "  * 'effective' (LXCat total momentum transfer) is mapped to 'elastic';",
      "    don't combine it with explicit elastic + inelastic sets.",
      skipped ? "  * " + skipped + " non-total process(es) omitted (differential SDCS, "
              + "rate-coefficient k(T), photoabsorption σ(λ)) — WarpX MCC uses total "
              + "cross sections σ(E) only." : "",
      "",
    ].filter((l) => l !== "").join("\n") });

    return files;
  }

  // ------------------------------------------------------------------
  //  Top-level: build the downloadable for a selection.
  //  Returns { filename, blob }.
  // ------------------------------------------------------------------
  function build(procs, opts) {
    const prefix = fileStem(opts.prefix || "cross_sections") || "cross_sections";
    const mode = opts.mode;

    if (mode === "warpx") {
      const files = buildWarpXFiles(procs, opts, prefix);
      return { filename: prefix + "_warpx.zip", blob: global.CSBZip.makeZip(files) };
    }

    if (mode === "standard-txt" || mode === "lxcat") {
      return buildStandardTxt(procs, opts, prefix);
    }

    if (mode === "hdf5") {
      const inputName = prefix + "_hdf5_input.json";
      const input = { schema: "cross-section-hdf5-input/1.0", generated_utc: opts.stampISO,
                      source: opts.datasetSource, n_processes: procs.length, processes: procs };
      const files = [
        { name: prefix + "/" + inputName, data: JSON.stringify(input) },
        { name: prefix + "/README.txt", data: [
          "HDF5 export bundle",
          "==================",
          "Generated : " + opts.stampISO,
          "Source    : " + (opts.datasetSource || "LXCat + NIST"),
          "",
          "Build a single self-describing .h5 (needs Python h5py + numpy):",
          "    pip install h5py numpy",
          "    python3 build_hdf5.py " + inputName + " -o " + prefix + ".h5",
          "",
          "Resulting layout:",
          "  /                file attrs (schema, source, n_processes)",
          "  /<process_id>    one group per process",
          "      x, y         1D float64 datasets",
          "                   total:        x=energy[eV], y=cross_section[m^2]",
          "                   differential: x=W[eV],      y=dsigma/dW[m^2/eV]",
          "      <attrs>      full metadata + per-dataset quantity/unit",
          "",
          "(A browser cannot write binary HDF5 without a heavy library, so this",
          " bundle ships the data + a small, dependency-light builder instead.)",
          "",
        ].join("\n") },
      ];
      if (opts.hdf5Builder) files.push({ name: prefix + "/build_hdf5.py", data: opts.hdf5Builder });
      return { filename: prefix + "_hdf5.zip", blob: global.CSBZip.makeZip(files) };
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

    const zipName = (mode === "zip-combined") ? prefix + "_combined.zip" : prefix + "_csv.zip";
    return { filename: zipName, blob: global.CSBZip.makeZip(files) };
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
