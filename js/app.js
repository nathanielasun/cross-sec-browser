/* ===================================================================
   app.js — Cross-Section Browser controller.
   Loads one or more datasets (via data/manifest.json), renders a
   filterable/sortable table, plots the selection, and wires export.
   =================================================================== */
(function () {
  "use strict";

  const E_FACTOR = { eV: 1, keV: 1e-3, J: 1.602176634e-19 };
  const S_FACTOR = { m2: 1, cm2: 1e4, A2: 1e20 };
  const PRETTY_UNIT = {
    eV: "eV", keV: "keV", J: "J", m2: "m²", cm2: "cm²", A2: "Å²",
    "m2/eV": "m²/eV", "cm2/eV": "cm²/eV", "A2/eV": "Å²/eV",
  };
  const pu = (u) => PRETTY_UNIT[u] || u;
  const isDiff = (p) => p.data_kind === "differential";

  // axis/legend metadata for a process (defaults cover legacy total-only data)
  function axisInfo(p) {
    const xq = p.x_quantity || "Energy", xu = p.x_unit || "eV";
    const yq = p.y_quantity || "Cross section", yu = p.y_unit || "m2";
    return {
      xLabel: xq + "  (" + pu(xu) + ")",
      yLabel: yq + "  (" + pu(yu) + ")",
      xunit: pu(xu), yunit: pu(yu),
      xsym: isDiff(p) ? "W" : "E",
      ysym: isDiff(p) ? "dσ/dW" : "σ",
    };
  }

  const state = {
    procs: [],            // all processes (merged across datasets)
    filtered: [],         // currently visible
    selected: [],         // ids in selection order (color order)
    selectedSet: new Set(),
    focusId: null,
    sortKey: "database",
    sortDir: 1,
    provenance: {},
    datasetSource: "LXCat, www.lxcat.net",
  };

  const $ = (id) => document.getElementById(id);
  const el = {};
  let plot;

  // ---------------------------------------------------------------- load
  async function load() {
    let datasets = [];
    try {
      const man = await fetch("data/manifest.json").then((r) => r.ok ? r.json() : Promise.reject());
      for (const src of man.sources) {
        const d = await fetch("data/" + src.file).then((r) => r.json());
        datasets.push({ meta: src, data: d });
      }
    } catch (e) {
      // fallback: single known dataset
      const d = await fetch("data/cross_sections.json").then((r) => r.json());
      datasets.push({ meta: { label: "LXCat" }, data: d });
    }

    const provenanceList = [];
    for (const { meta, data } of datasets) {
      const srcLabel = meta.label || data.source || "unknown";
      for (const p of data.processes) {
        p._source = srcLabel;
        p.data_kind = p.data_kind || "total";
        state.procs.push(p);
      }
      provenanceList.push({
        label: srcLabel,
        source: data.source,
        generated_utc: data.generated_utc,
        databases: (data.databases || []).map((db) => db.name || db),
        counts: data.counts,
      });
    }
    state.provenance = { datasets: provenanceList };
    state.datasetSource = provenanceList.map((p) => p.source).filter(Boolean).join("; ") || "LXCat, www.lxcat.net";

    buildFacets();
    renderStats();
    applyFilters();
  }

  // ------------------------------------------------------------- facets
  function buildFacets() {
    const uniq = (k) => Array.from(new Set(state.procs.map((p) => p[k]))).sort();
    fill(el.fDatabase, uniq("database"));
    fill(el.fSpecies, uniq("target"));
    fill(el.fCategory, uniq("category"));
  }
  function fill(sel, vals) {
    for (const v of vals) {
      const o = document.createElement("option");
      o.value = v; o.textContent = v;
      sel.appendChild(o);
    }
  }

  function renderStats() {
    const npts = state.procs.reduce((a, p) => a + p.n_points, 0);
    const nspecies = new Set(state.procs.map((p) => p.target)).size;
    const ndb = new Set(state.procs.map((p) => p.database)).size;
    el.stats.innerHTML =
      stat(state.procs.length, "processes") +
      stat(nspecies, "species") +
      stat(ndb, "databases") +
      stat(npts.toLocaleString(), "data points");
  }
  const stat = (b, s) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`;

  // ------------------------------------------------------------- filter
  function applyFilters() {
    const q = el.search.value.trim().toLowerCase();
    const fdb = el.fDatabase.value, fsp = el.fSpecies.value, fcat = el.fCategory.value;
    state.filtered = state.procs.filter((p) => {
      if (fdb && p.database !== fdb) return false;
      if (fsp && p.target !== fsp) return false;
      if (fcat && p.category !== fcat) return false;
      if (q) {
        const hay = (p.reaction + " " + p.target + " " + p.comment + " " +
                     p.category + " " + p.projectile + " " + p.database).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    sortFiltered();
    renderTable();
    el.filteredCount.textContent = "(" + state.filtered.length + " of " + state.procs.length + ")";
    syncCheckAll();
  }

  function sortFiltered() {
    const k = state.sortKey, dir = state.sortDir;
    state.filtered.sort((a, a2) => {
      let x = a[k], y = a2[k];
      if (x === null || x === undefined) x = -Infinity;
      if (y === null || y === undefined) y = -Infinity;
      if (typeof x === "string") return dir * x.localeCompare(y);
      return dir * (x - y);
    });
  }

  // -------------------------------------------------------------- table
  function shortDb(name) { return name.split(/[\s(]/)[0]; }

  function colorOf(id) {
    const i = state.selected.indexOf(id);
    return i < 0 ? null : window.CSBPlot.colorFor(i);
  }

  function renderTable() {
    const rows = state.filtered.map((p) => {
      const sel = state.selectedSet.has(p.id);
      const c = sel ? colorOf(p.id) : null;
      const swatch = sel ? `<span class="swatch" style="background:${c}"></span>` : "";
      const thr = (p.threshold_eV === null || p.threshold_eV === undefined)
        ? '<span class="muted">—</span>' : fmtNum(p.threshold_eV);
      const erange = fmtRange(p.energy_min_eV, p.energy_max_eV);
      return `<tr data-id="${p.id}" class="${sel ? "selected" : ""} ${p.id === state.focusId ? "focused" : ""}">
        <td class="col-check"><input type="checkbox" ${sel ? "checked" : ""} tabindex="-1"></td>
        <td>${shortDb(p.database)}</td>
        <td>${swatch}${esc(p.target)}</td>
        <td><span class="tag">${esc(p.category)}</span></td>
        <td class="reaction">${esc(p.reaction || p.type)}</td>
        <td class="num">${thr}</td>
        <td class="num">${p.n_points}</td>
        <td class="num">${erange}</td>
      </tr>`;
    });
    el.tbody.innerHTML = rows.join("");
  }

  function fmtNum(v) {
    if (v === 0) return "0";
    if (Math.abs(v) >= 1e-2 && Math.abs(v) < 1e4) return (Math.round(v * 1000) / 1000).toString();
    return v.toExponential(2);
  }
  function fmtRange(a, b) {
    if (a === null || b === null) return "—";
    return fmtNum(a) + "–" + fmtNum(b);
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  // ---------------------------------------------------------- selection
  function toggleSelect(id, forceState) {
    const has = state.selectedSet.has(id);
    const want = forceState === undefined ? !has : forceState;
    if (want && !has) { state.selectedSet.add(id); state.selected.push(id); state.focusId = id; }
    else if (!want && has) {
      state.selectedSet.delete(id);
      state.selected = state.selected.filter((x) => x !== id);
      if (state.focusId === id) state.focusId = state.selected[state.selected.length - 1] || null;
    }
    refreshSelectionViews();
  }

  function setFocus(id) { state.focusId = id; refreshSelectionViews(); }

  function refreshSelectionViews() {
    renderTable();
    updatePlot();
    updateDetail();
    updateExportBar();
    syncCheckAll();
  }

  function selectAllFiltered() {
    for (const p of state.filtered) if (!state.selectedSet.has(p.id)) toggleSilent(p.id, true);
    if (state.filtered.length) state.focusId = state.filtered[state.filtered.length - 1].id;
    refreshSelectionViews();
  }
  function clearSelection() {
    state.selected = []; state.selectedSet.clear(); state.focusId = null;
    refreshSelectionViews();
  }
  function toggleSilent(id, want) {
    const has = state.selectedSet.has(id);
    if (want && !has) { state.selectedSet.add(id); state.selected.push(id); }
    else if (!want && has) { state.selectedSet.delete(id); state.selected = state.selected.filter((x) => x !== id); }
  }
  function syncCheckAll() {
    const vis = state.filtered;
    const allSel = vis.length && vis.every((p) => state.selectedSet.has(p.id));
    const someSel = vis.some((p) => state.selectedSet.has(p.id));
    el.checkAll.checked = !!allSel;
    el.checkAll.indeterminate = !allSel && someSel;
  }

  // ----------------------------------------------------------- plotting
  function selectedProcs() {
    return state.selected.map((id) => state.procs.find((p) => p.id === id)).filter(Boolean);
  }

  function updatePlot() {
    // axis units differ between total (σ, m²) and differential (dσ/dW, m²/eV),
    // so only co-plot series that share the focused process's data_kind.
    const ref = state.procs.find((x) => x.id === state.focusId)
             || state.procs.find((x) => x.id === state.selected[0]);
    const refKind = ref ? ref.data_kind : "total";
    let hidden = 0;
    const series = state.selected.map((id, i) => {
      const p = state.procs.find((x) => x.id === id);
      if (p.data_kind !== refKind) { hidden++; return null; }
      const pts = [];
      for (let j = 0; j < p.energy.length; j++) pts.push([p.energy[j], p.cross_section[j]]);
      return { id: p.id, label: p.label, color: window.CSBPlot.colorFor(i), points: pts };
    }).filter(Boolean);

    if (ref) Object.assign(plot, axisInfo(ref));
    plot.setData(series, el.logx.checked, el.logy.checked, state.focusId);
    renderLegend(hidden, refKind);
  }

  function renderLegend(hidden, refKind) {
    if (!state.selected.length) { el.legend.innerHTML = ""; return; }
    const items = state.selected.map((id, i) => {
      const p = state.procs.find((x) => x.id === id);
      const c = window.CSBPlot.colorFor(i);
      const other = refKind && p.data_kind !== refKind;
      return `<span class="item ${id === state.focusId ? "focused" : ""} ${other ? "off-kind" : ""}" data-id="${id}" title="${other ? "different data kind — not plotted with the current curve" : ""}">
        <span class="swatch" style="background:${other ? "#cfd6de" : c}"></span>${esc(shortDb(p.database))} · ${esc(p.target)} · ${esc(p.reaction || p.type)}</span>`;
    }).join("");
    const note = hidden ? `<span class="legend-note">${hidden} ${refKind === "differential" ? "total" : "differential"} series hidden (different units) — focus one to plot it.</span>` : "";
    el.legend.innerHTML = note + items;
  }

  // ------------------------------------------------------------- detail
  function updateDetail() {
    const id = state.focusId;
    if (!id) { el.detail.innerHTML = '<p class="muted">Select a process to see its metadata here.</p>'; return; }
    const p = state.procs.find((x) => x.id === id);
    const rows = [];
    const add = (k, v) => { if (v !== null && v !== undefined && v !== "") rows.push(`<dt>${k}</dt><dd>${esc(v)}</dd>`); };
    add("Database", p.database);
    add("Process", p.reaction);
    add("Type", p.type + " (" + p.category + ")");
    add("Species", p.projectile + " / " + p.target);
    if (isDiff(p)) {
      add("Kind", "Differential — SDCS dσ/dW");
      if (p.incident_energy_eV != null) add("Incident energy T", p.incident_energy_eV + " eV");
      if (p.threshold_eV != null) add("Ionization potential B", p.threshold_eV + " eV");
      if (p.wmax_eV != null) add("Max ejected energy", fmtNum(p.wmax_eV) + " eV");
      add("Points", p.n_points + "  (W: " + fmtNum(p.energy_min_eV) + " – " + fmtNum(p.energy_max_eV) + " eV)");
      add("Peak dσ/dW", p.sigma_max_m2 != null ? p.sigma_max_m2.toExponential(3) + " m²/eV" : null);
    } else {
      if (p.threshold_eV != null) add("Threshold", p.threshold_eV + " eV");
      if (p.mass_ratio != null) add("Mass ratio m/M", p.mass_ratio);
      if (p.ion_mass_amu != null) add("Ion mass", p.ion_mass_amu + " amu");
      add("Points", p.n_points + "  (E: " + fmtNum(p.energy_min_eV) + " – " + fmtNum(p.energy_max_eV) + " eV)");
      add("Peak σ", p.sigma_max_m2 != null ? p.sigma_max_m2.toExponential(3) + " m²" : null);
    }
    add("Updated", p.updated);
    el.detail.innerHTML =
      `<h3>${esc(p.reaction || p.type)}</h3><dl>${rows.join("")}</dl>` +
      (p.comment ? `<p class="comment">${esc(p.comment)}</p>` : "");
  }

  // ------------------------------------------------------------- export
  function updateExportBar() {
    const n = state.selected.length;
    const pts = selectedProcs().reduce((a, p) => a + p.n_points, 0);
    el.selCount.textContent = n + (n === 1 ? " selected" : " selected");
    el.selPoints.textContent = n ? "· " + pts.toLocaleString() + " points" : "";
    el.exportBtn.disabled = n === 0;
  }

  async function doExport() {
    const procs = selectedProcs();
    if (!procs.length) return;
    const opts = {
      mode: el.fmt.value,
      unitE: el.unitE.value,
      unitS: el.unitS.value,
      prefix: el.prefix.value,
      stampISO: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      datasetSource: state.datasetSource,
      provenance: state.provenance,
    };
    // The HDF5 bundle ships the Python builder so it's self-contained.
    if (opts.mode === "hdf5") {
      try { opts.hdf5Builder = await fetch("tools/build_hdf5.py").then((r) => r.ok ? r.text() : ""); }
      catch (e) { opts.hdf5Builder = ""; }
    }
    try {
      const { filename, blob } = window.CSBExport.build(procs, opts);
      window.CSBExport.triggerDownload(filename, blob);
      toast("Exported " + procs.length + " process" + (procs.length > 1 ? "es" : "") + " → " + filename);
    } catch (err) {
      console.error(err);
      toast("Export failed: " + err.message, true);
    }
  }

  let toastTimer;
  function toast(msg, isErr) {
    el.toast.textContent = msg;
    el.toast.className = "toast show" + (isErr ? " err" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.className = "toast"; }, 3200);
  }

  // --------------------------------------------------------------- wire
  function wire() {
    el.search.addEventListener("input", debounce(applyFilters, 120));
    el.fDatabase.addEventListener("change", applyFilters);
    el.fSpecies.addEventListener("change", applyFilters);
    el.fCategory.addEventListener("change", applyFilters);
    el.selectFiltered.addEventListener("click", selectAllFiltered);
    el.clearSel.addEventListener("click", clearSelection);

    el.tbody.addEventListener("click", (ev) => {
      const tr = ev.target.closest("tr"); if (!tr) return;
      const id = tr.dataset.id;
      // clicking the checkbox or anywhere toggles selection
      toggleSelect(id);
    });

    el.checkAll.addEventListener("change", () => {
      if (el.checkAll.checked) selectAllFiltered();
      else { for (const p of state.filtered) toggleSilent(p.id, false);
             state.focusId = state.selected[state.selected.length - 1] || null;
             refreshSelectionViews(); }
    });

    el.legend.addEventListener("click", (ev) => {
      const item = ev.target.closest(".item"); if (!item) return;
      setFocus(item.dataset.id);
    });

    document.querySelectorAll("th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const k = th.dataset.sort;
        if (state.sortKey === k) state.sortDir *= -1; else { state.sortKey = k; state.sortDir = 1; }
        document.querySelectorAll("th[data-sort]").forEach((h) =>
          h.classList.remove("sorted-asc", "sorted-desc"));
        th.classList.add(state.sortDir > 0 ? "sorted-asc" : "sorted-desc");
        applyFilters();
      });
    });

    el.logx.addEventListener("change", updatePlot);
    el.logy.addEventListener("change", updatePlot);
    el.exportBtn.addEventListener("click", doExport);
    window.addEventListener("resize", debounce(() => plot.draw(), 100));
  }

  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  // --------------------------------------------------------------- boot
  let booted = false;
  function boot() {
    if (booted) return;            // run exactly once (event + readyState paths)
    booted = true;
    el.stats = $("header-stats");
    el.search = $("search");
    el.fDatabase = $("f-database");
    el.fSpecies = $("f-species");
    el.fCategory = $("f-category");
    el.selectFiltered = $("select-filtered");
    el.clearSel = $("clear-selection");
    el.tbody = $("proc-tbody");
    el.checkAll = $("check-all");
    el.filteredCount = $("filtered-count");
    el.legend = $("legend");
    el.detail = $("detail");
    el.logx = $("logx");
    el.logy = $("logy");
    el.fmt = $("fmt");
    el.unitE = $("unit-e");
    el.unitS = $("unit-s");
    el.prefix = $("prefix");
    el.selCount = $("sel-count");
    el.selPoints = $("sel-points");
    el.exportBtn = $("export-btn");
    el.toast = $("toast");

    plot = new window.CSBPlot.Plot($("plot"));
    plot.setReadout($("plot-readout"));

    wire();
    load().catch((err) => {
      console.error(err);
      toast("Failed to load dataset: " + err.message, true);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();   // DOM already parsed (deferred/late script, or test harness)
  }
})();
