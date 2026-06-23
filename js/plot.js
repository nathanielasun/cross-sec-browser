/* ===================================================================
   plot.js — lightweight canvas plotter for cross-section curves.
   Supports linear/log axes, multiple colored series, decade gridlines,
   and a nearest-point hover readout. No external libraries.
   =================================================================== */
(function (global) {
  "use strict";

  // Colour-blind-friendly qualitative palette (Okabe–Ito + extras).
  const PALETTE = [
    "#1f6feb", "#e8710a", "#1a7f51", "#cc3d57", "#8250df",
    "#0aa2c0", "#b25a00", "#5a6b7b", "#c026d3", "#2e7d32",
    "#d4a000", "#0050a0",
  ];

  function colorFor(i) { return PALETTE[i % PALETTE.length]; }

  function niceLogTicks(min, max) {
    // decade ticks spanning [min,max]; min/max already > 0
    const lo = Math.floor(Math.log10(min));
    const hi = Math.ceil(Math.log10(max));
    const ticks = [];
    for (let e = lo; e <= hi; e++) ticks.push(Math.pow(10, e));
    return ticks;
  }

  function niceLinTicks(min, max, n) {
    const span = (max - min) || Math.abs(max) || 1;
    const raw = span / n;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const ticks = [];
    if (!isFinite(step) || step <= 0) return [min, max];
    // epsilon must scale with the data (cross sections are ~1e-20): a fixed 1e-9
    // here would loop billions of times. Cap iterations as a hard backstop too.
    const eps = step * 0.5;
    for (let v = Math.ceil(min / step) * step; v <= max + eps && ticks.length < 1000; v += step) {
      ticks.push(v);
    }
    return ticks;
  }

  function fmtSci(v) {
    if (v === 0) return "0";
    const a = Math.abs(v);
    if (a >= 1e-3 && a < 1e5) {
      return (Math.round(v * 1e4) / 1e4).toString();
    }
    return v.toExponential(1).replace("e", "e");
  }

  /**
   * @param {HTMLCanvasElement} canvas
   */
  function Plot(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.series = [];        // {id,label,color,points:[[x,y],…]}
    this.logx = true;
    this.logy = true;
    this.focusId = null;
    this.readoutEl = null;
    this._hover = null;
    this._bindHover();
  }

  Plot.prototype.setReadout = function (el) { this.readoutEl = el; };

  Plot.prototype.setData = function (series, logx, logy, focusId) {
    this.series = series;
    this.logx = logx;
    this.logy = logy;
    this.focusId = focusId;
    this.draw();
  };

  Plot.prototype._area = function () {
    const r = this.canvas.getBoundingClientRect();
    return { w: r.width, h: r.height };
  };

  Plot.prototype.draw = function () {
    const ctx = this.ctx;
    const dpr = global.devicePixelRatio || 1;
    const { w, h } = this._area();
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const m = { l: 64, r: 14, t: 12, b: 40 };
    const pw = w - m.l - m.r, ph = h - m.t - m.b;
    this._m = m; this._pw = pw; this._ph = ph;

    if (!this.series.length) {
      ctx.fillStyle = "#8a97a4";
      ctx.font = "13px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No process selected — click a row to plot it.", m.l + pw / 2, m.t + ph / 2);
      return;
    }

    // ---- compute data ranges (only positive values for log) ----
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const s of this.series) {
      for (const [x, y] of s.points) {
        if (this.logx && x <= 0) continue;
        if (this.logy && y <= 0) continue;
        if (x < xmin) xmin = x; if (x > xmax) xmax = x;
        if (y < ymin) ymin = y; if (y > ymax) ymax = y;
      }
    }
    if (!isFinite(xmin)) { xmin = 1; xmax = 10; }
    if (!isFinite(ymin)) { ymin = 1e-22; ymax = 1e-18; }
    if (xmin === xmax) { xmin *= 0.9; xmax *= 1.1; }
    if (ymin === ymax) { ymin *= 0.9; ymax *= 1.1; }
    if (this.logy) { ymin = Math.pow(10, Math.floor(Math.log10(ymin))); ymax = Math.pow(10, Math.ceil(Math.log10(ymax))); }
    this._range = { xmin, xmax, ymin, ymax };

    const sx = (x) => {
      const t = this.logx ? (Math.log10(x) - Math.log10(xmin)) / (Math.log10(xmax) - Math.log10(xmin))
                          : (x - xmin) / (xmax - xmin);
      return m.l + t * pw;
    };
    const sy = (y) => {
      const t = this.logy ? (Math.log10(y) - Math.log10(ymin)) / (Math.log10(ymax) - Math.log10(ymin))
                          : (y - ymin) / (ymax - ymin);
      return m.t + (1 - t) * ph;
    };
    this._sx = sx; this._sy = sy;

    // ---- gridlines + ticks ----
    ctx.font = "11px " + "-apple-system, sans-serif";
    ctx.fillStyle = "#8a97a4";
    ctx.strokeStyle = "#eef1f5";
    ctx.lineWidth = 1;

    const xticks = this.logx ? niceLogTicks(xmin, xmax) : niceLinTicks(xmin, xmax, 6);
    for (const xt of xticks) {
      if (xt < xmin * 0.999 || xt > xmax * 1.001) continue;
      const px = sx(xt);
      ctx.beginPath(); ctx.moveTo(px, m.t); ctx.lineTo(px, m.t + ph); ctx.stroke();
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(this.logx ? fmtPow(xt) : fmtSci(xt), px, m.t + ph + 6);
    }
    const yticks = this.logy ? niceLogTicks(ymin, ymax) : niceLinTicks(ymin, ymax, 6);
    for (const yt of yticks) {
      if (yt < ymin * 0.999 || yt > ymax * 1.001) continue;
      const py = sy(yt);
      ctx.beginPath(); ctx.moveTo(m.l, py); ctx.lineTo(m.l + pw, py); ctx.stroke();
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillText(this.logy ? fmtPow(yt) : fmtSci(yt), m.l - 7, py);
    }

    // ---- axis frame + labels ----
    ctx.strokeStyle = "#c4ccd6"; ctx.lineWidth = 1;
    ctx.strokeRect(m.l, m.t, pw, ph);
    ctx.fillStyle = "#5a6b7b";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(this.xLabel || ("Energy  (" + (this.xunit || "eV") + ")"), m.l + pw / 2, h - 4);
    ctx.save();
    ctx.translate(13, m.t + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "top";
    ctx.fillText(this.yLabel || ("Cross section  (" + (this.yunit || "m²") + ")"), 0, 0);
    ctx.restore();

    // ---- series ----
    for (const s of this.series) {
      const focused = s.id === this.focusId;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = focused ? 2.6 : 1.4;
      ctx.globalAlpha = (this.focusId && !focused) ? 0.45 : 1;
      ctx.beginPath();
      let started = false;
      for (const [x, y] of s.points) {
        if ((this.logx && x <= 0) || (this.logy && y <= 0)) { started = false; continue; }
        const px = sx(x), py = sy(y);
        if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      }
      ctx.stroke();
      // markers for focused / sparse series
      if (focused || s.points.length <= 24) {
        ctx.fillStyle = s.color;
        for (const [x, y] of s.points) {
          if ((this.logx && x <= 0) || (this.logy && y <= 0)) continue;
          ctx.beginPath(); ctx.arc(sx(x), sy(y), focused ? 2.6 : 1.8, 0, 2 * Math.PI); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    this._drawHover();
  };

  Plot.prototype._drawHover = function () {
    if (!this._hover) { if (this.readoutEl) this.readoutEl.style.opacity = 0; return; }
    const { px } = this._hover;
    // find nearest point across all series in x
    let best = null;
    for (const s of this.series) {
      for (const [x, y] of s.points) {
        if ((this.logx && x <= 0) || (this.logy && y <= 0)) continue;
        const d = Math.abs(this._sx(x) - px);
        if (!best || d < best.d) best = { d, x, y, s };
      }
    }
    if (!best || best.d > 26) { if (this.readoutEl) this.readoutEl.style.opacity = 0; return; }
    const ctx = this.ctx;
    ctx.fillStyle = best.s.color;
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
    const cx = this._sx(best.x), cy = this._sy(best.y);
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    if (this.readoutEl) {
      this.readoutEl.style.opacity = 1;
      this.readoutEl.textContent =
        best.s.label.split(" · ").pop() +
        "\n" + (this.xsym || "E") + " = " + best.x.toPrecision(4) + " " + (this.xunit || "eV") +
        "\n" + (this.ysym || "σ") + " = " + best.y.toExponential(3) + " " + (this.yunit || "m²");
    }
  };

  Plot.prototype._bindHover = function () {
    const self = this;
    this.canvas.addEventListener("mousemove", function (ev) {
      const r = self.canvas.getBoundingClientRect();
      self._hover = { px: ev.clientX - r.left, py: ev.clientY - r.top };
      self.draw();
    });
    this.canvas.addEventListener("mouseleave", function () {
      self._hover = null; self.draw();
    });
  };

  function fmtPow(v) {
    const e = Math.round(Math.log10(v));
    if (e === 0) return "1";
    if (e === 1) return "10";
    const sup = String(e).replace(/-/g, "⁻")
      .replace(/[0-9]/g, (d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[+d]);
    return "10" + sup;
  }

  global.CSBPlot = { Plot, colorFor, PALETTE };
})(window);
