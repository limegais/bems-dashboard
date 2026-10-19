/**
 * BEMS Dashboard — Thermal Comfort & MRT Evaluation Service
 * Standard ISO 7730 & ASHRAE 55-2023 Implementation
 * - Fanger PMV (Predicted Mean Vote) & PPD (Predicted Percentage of Dissatisfied)
 * - Mean Radiant Temperature (MRT - Tr) from Globe Thermometer (ISO 7726)
 * - Operative Temperature (Top)
 * - Multi-Zone SHT31 Physical Nodes Evaluation (Node A, C, D, E, G, H)
 * - Interactive Environmental Parameter Calculator & Dynamic Fanger Curve
 */

(function () {
  "use strict";

  // ── 1. Default State ──────────────────────────────────────────────────────────
  const state = {
    // Current room baseline inputs
    ta: 24.2,      // Air temperature (°C)
    tg: 24.9,      // Globe temperature (°C)
    tr: 25.1,      // Mean radiant temperature (°C)
    top: 24.65,    // Operative temperature (°C)
    rh: 58.0,      // Relative humidity (%)
    vel: 0.12,     // Air velocity (m/s)
    met: 1.1,      // Metabolic rate (met)
    clo: 0.50,     // Clothing insulation (clo)
    globeDiameter: 0.15, // Globe diameter (m)
    globeEmissivity: 0.95,

    // Calculated outputs
    pmv: 0.14,
    ppd: 5.4,
    category: "Kategori I (Kelas A)",
    categoryClass: "bg-emerald-50 text-emerald-800 border-emerald-200",

    // Multi-zone SHT31 sensor network (SHT-1 s.d SHT-6)
    zones: [
      { id: "node-1", name: "SHT-1 (WB1 - Dekat Jendela)", code: "SHT-1", ta: 25.2, rh: 55.4, tg: 25.8, vel: 0.11, lux: 350, desc: "Dipengaruhi radiasi jendela kaca timur" },
      { id: "node-2", name: "SHT-2 (WB2 - NW Komputer)", code: "SHT-2", ta: 23.9, rh: 58.5, tg: 24.2, vel: 0.10, lux: 470, desc: "Zona kerja komputer tengah lab" },
      { id: "node-3", name: "SHT-3 (WB3 - Inner Lab)", code: "SHT-3", ta: 24.5, rh: 57.2, tg: 25.4, vel: 0.14, lux: 510, desc: "Area meja kerja dalam" },
      { id: "node-4", name: "SHT-4 (WB4 - Area Kanan)", code: "SHT-4", ta: 24.8, rh: 59.1, tg: 25.1, vel: 0.18, lux: 390, desc: "Area meja kerja kanan" },
      { id: "node-5", name: "SHT-5 (South Wall)", code: "SHT-5", ta: 23.6, rh: 60.1, tg: 24.0, vel: 0.22, lux: 420, desc: "Dinding selatan living lab" },
      { id: "node-6", name: "SHT-6 (Central / South Hub)", code: "SHT-6", ta: 24.1, rh: 57.8, tg: 24.5, vel: 0.12, lux: 490, desc: "Pusat aktivitas living lab" }
    ]
  };

  const charts = {
    fangerCurve: null,
    multiZone: null
  };

  // ── 2. Rigorous ISO 7730 Fanger PMV & PPD Calculation ─────────────────────────
  function calcFanger(ta, tr, vel, rh, met, clo, w = 0) {
    const m = met * 58.15; // W/m2
    const mw = m - w;      // internal heat production
    const icl = clo * 0.155; // m2 K / W
    const fcl = clo <= 0.078 ? 1.0 + 1.29 * icl : 1.05 + 0.645 * icl;

    // Saturated water vapor pressure (Pa)
    const pa = (rh / 100) * 10 * Math.exp(16.6536 - 4030.183 / (ta + 235));

    // Iteration to solve clothing surface temperature tcl
    const tra = tr + 273.15;
    const taa = ta + 273.15;
    let tcla = taa + (35.5 - ta) / (3.5 * (6.45 * icl + 0.1));
    let tcl = tcla - 273.15;
    let hc = 0;

    for (let iter = 0; iter < 150; iter++) {
      const hc_free = 2.38 * Math.pow(Math.abs(tcl - ta), 0.25);
      const hc_forced = 12.1 * Math.sqrt(Math.max(vel, 0.05));
      hc = Math.max(hc_free, hc_forced);
      const rad = 3.96e-8 * fcl * (Math.pow(tcla, 4) - Math.pow(tra, 4));
      const conv = fcl * hc * (tcl - ta);
      const tcl_next = 35.7 - 0.028 * mw - icl * (rad + conv);
      if (Math.abs(tcl_next - tcl) < 0.0001) break;
      tcl = 0.5 * (tcl + tcl_next);
      tcla = tcl + 273.15;
    }

    // Heat loss components
    const hl1 = 3.05e-3 * (5733 - 6.99 * mw - pa); // skin diffusion
    const hl2 = mw > 58.15 ? 0.42 * (mw - 58.15) : 0; // sweat secretion
    const hl3 = 1.7e-5 * m * (5867 - pa);          // latent respiration
    const hl4 = 0.0014 * m * (34 - ta);             // dry respiration
    const hl5 = 3.96e-8 * fcl * (Math.pow(tcla, 4) - Math.pow(tra, 4)); // radiation
    const hl6 = fcl * hc * (tcl - ta);              // convection

    const l = mw - hl1 - hl2 - hl3 - hl4 - hl5 - hl6; // Thermal load
    let pmv = (0.303 * Math.exp(-0.036 * m) + 0.028) * l;
    pmv = Math.max(-3, Math.min(3, pmv));

    const ppd = Math.max(5.0, Math.min(100.0, 100 - 95 * Math.exp(-0.03353 * Math.pow(pmv, 4) - 0.2179 * Math.pow(pmv, 2))));

    return {
      pmv: pmv,
      ppd: ppd,
      tcl: tcl,
      radLoss: hl5,
      convLoss: hl6,
      respLoss: hl3 + hl4,
      evapLoss: hl1 + hl2
    };
  }

  // ── 3. ISO 7726 Mean Radiant Temperature (MRT) from Globe Temp ────────────────
  function calcMRT(tg, ta, vel, d = 0.15, eps = 0.95) {
    const tgK = tg + 273.15;
    const term = (1.1e8 * Math.pow(Math.max(vel, 0.05), 0.6)) / (eps * Math.pow(d, 0.4));
    const radFourth = Math.pow(tgK, 4) + term * (tg - ta);
    if (radFourth <= 0) return ta;
    return Math.pow(radFourth, 0.25) - 273.15;
  }

  // ── 4. Operative Temperature (Top) ────────────────────────────────────────────
  function calcOperativeTemp(ta, tr, vel) {
    let a = 0.5;
    if (vel >= 0.2 && vel < 0.6) a = 0.6;
    else if (vel >= 0.6) a = 0.7;
    return a * ta + (1 - a) * tr;
  }

  // ── 5. Standard ISO 7730 / EN 16798 Category ──────────────────────────────────
  function getCategory(pmv, ppd) {
    const absPmv = Math.abs(pmv);
    if (absPmv <= 0.2 && ppd < 6.0) {
      return {
        label: "Kategori I (Kelas A)",
        desc: "Category I: High Standard (Special Spaces)",
        badgeClass: "bg-emerald-50 text-emerald-800 border-emerald-200"
      };
    } else if (absPmv <= 0.5 && ppd <= 10.0) {
      return {
        label: "Kategori II (Kelas B)",
        desc: "Standar Bangunan Baru & Kantor Modern",
        badgeClass: "bg-teal-50 text-teal-800 border-teal-200"
      };
    } else if (absPmv <= 0.7 && ppd <= 15.0) {
      return {
        label: "Kategori III (Kelas C)",
        desc: "Category II: Normal Standard (New/Existing Buildings)",
        badgeClass: "bg-amber-50 text-amber-800 border-amber-200"
      };
    } else {
      return {
        label: "Kategori IV (Di Luar Standar)",
        desc: "Perlu Penyesuaian Setpoint AC / Ventilasi",
        badgeClass: "bg-rose-50 text-rose-800 border-rose-200"
      };
    }
  }

  function fmt(val, dec = 2) {
    const n = parseFloat(val);
    if (!Number.isFinite(n)) return "--";
    return n.toLocaleString("id-ID", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  const darkTooltip = {
    backgroundColor: "rgba(15, 23, 42, 0.94)",
    titleColor: "#f8fafc",
    bodyColor: "#cbd5e1",
    borderColor: "rgba(51, 65, 85, 0.6)",
    borderWidth: 1,
    padding: 10,
    cornerRadius: 8,
    usePointStyle: true
  };

  // ── 6. Update Primary KPIs & Gauge ────────────────────────────────────────────
  function updateKPIs() {
    // Recompute MRT and Top for central living lab
    state.tr = calcMRT(state.tg, state.ta, state.vel, state.globeDiameter, state.globeEmissivity);
    state.top = calcOperativeTemp(state.ta, state.tr, state.vel);

    const res = calcFanger(state.ta, state.tr, state.vel, state.rh, state.met, state.clo);
    state.pmv = res.pmv;
    state.ppd = res.ppd;

    const cat = getCategory(state.pmv, state.ppd);
    state.category = cat.label;
    state.categoryClass = cat.badgeClass;

    // Update KPI Card texts
    const pmvSign = state.pmv > 0 ? "+" : "";
    setEl("kpi-thermal-pmv", `${pmvSign}${fmt(state.pmv, 2)}`);
    setEl("kpi-thermal-ppd", `${fmt(state.ppd, 1)} %`);
    setEl("kpi-thermal-mrt", `${fmt(state.tr, 1)} °C`);
    setEl("kpi-thermal-top", `${fmt(state.top, 1)} °C`);
    setEl("kpi-thermal-cat", cat.label);

    const catBadge = document.getElementById("kpi-thermal-cat-badge");
    if (catBadge) {
      catBadge.className = `px-2.5 py-0.5 rounded-full text-xs font-bold border font-mono ${cat.badgeClass}`;
      catBadge.textContent = cat.label;
    }

    // Update Sensation text
    let sensasi = "Netral";
    let sensasiColor = "text-emerald-700";
    if (state.pmv > 1.5) { sensasi = "Hot (+2/+3)"; sensasiColor = "text-rose-700"; }
    else if (state.pmv > 0.5) { sensasi = "Warm (+1)"; sensasiColor = "text-amber-700"; }
    else if (state.pmv > -0.5) { sensasi = "Netral Nyaman (0)"; sensasiColor = "text-emerald-700"; }
    else if (state.pmv > -1.5) { sensasi = "Cool (-1)"; sensasiColor = "text-cyan-700"; }
    else { sensasi = "Cold (-2/-3)"; sensasiColor = "text-blue-700"; }

    setEl("thermal-sensation-label", `Sensasi: ${sensasi}`);
    const sensSpan = document.getElementById("thermal-sensation-label");
    if (sensSpan) sensSpan.className = `text-sm font-bold ${sensasiColor}`;

    // Update PMV Scale needle position (from -3 to +3, map to 0% to 100%)
    const needle = document.getElementById("pmv-gauge-needle");
    if (needle) {
      const pct = Math.max(2, Math.min(98, ((state.pmv + 3) / 6) * 100));
      needle.style.left = `${pct}%`;
    }

    // Update delta Tr - Ta
    const deltaTr = state.tr - state.ta;
    const deltaSign = deltaTr >= 0 ? "+" : "";
    setEl("thermal-delta-tr", `Δ(Tr - Ta): ${deltaSign}${fmt(deltaTr, 2)} °C`);

    // Update Chart marker
    updateChartMarker();
  }

  // ── 7. Render Multi-Zone Table ────────────────────────────────────────────────
  function renderMultiZoneTable() {
    const tbody = document.getElementById("thermal-zone-tbody");
    if (!tbody) return;

    tbody.innerHTML = state.zones.map(z => {
      const trZone = calcMRT(z.tg, z.ta, z.vel, 0.15, 0.95);
      const topZone = calcOperativeTemp(z.ta, trZone, z.vel);
      const fangerZone = calcFanger(z.ta, trZone, z.vel, z.rh, state.met, state.clo);
      const catZone = getCategory(fangerZone.pmv, fangerZone.ppd);
      const pmvSign = fangerZone.pmv > 0 ? "+" : "";

      let statusBadge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Optimal</span>`;
      if (Math.abs(fangerZone.pmv) > 0.5) {
        statusBadge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Perhatian</span>`;
      }

      return `
        <tr class="border-b border-slate-100 hover:bg-slate-50/70 transition-colors">
          <td class="py-3 px-4">
            <strong class="text-slate-900 block text-xs">${z.name}</strong>
            <span class="text-[11px] text-slate-400 font-mono">${z.code} · ${z.desc}</span>
          </td>
          <td class="py-3 px-4 font-mono font-semibold text-slate-800 text-xs">${fmt(z.ta, 1)} °C</td>
          <td class="py-3 px-4 font-mono font-semibold text-slate-800 text-xs">${fmt(trZone, 1)} °C</td>
          <td class="py-3 px-4 font-mono font-semibold text-slate-800 text-xs">${fmt(topZone, 1)} °C</td>
          <td class="py-3 px-4 font-mono font-bold ${Math.abs(fangerZone.pmv) <= 0.5 ? 'text-teal-700' : 'text-amber-700'} text-xs">
            ${pmvSign}${fmt(fangerZone.pmv, 2)}
          </td>
          <td class="py-3 px-4 font-mono text-slate-700 text-xs">${fmt(fangerZone.ppd, 1)}%</td>
          <td class="py-3 px-4">
            <span class="px-2 py-0.5 rounded text-[11px] font-medium ${catZone.badgeClass}">${catZone.label.split(' ')[0]}</span>
          </td>
          <td class="py-3 px-4">${statusBadge}</td>
        </tr>
      `;
    }).join("");
  }

  // ── 8. Chart 1: Fanger Theoretical PMV vs PPD Bathtub Curve ──────────────────
  function initFangerCurveChart() {
    const canvas = document.getElementById("chart-fanger-curve");
    if (!canvas) return;

    // Generate theoretical points from PMV = -3.0 to +3.0 with step 0.1
    const curvePoints = [];
    for (let p = -3.0; p <= 3.01; p += 0.1) {
      const ppdVal = 100 - 95 * Math.exp(-0.03353 * Math.pow(p, 4) - 0.2179 * Math.pow(p, 2));
      curvePoints.push({ x: parseFloat(p.toFixed(2)), y: parseFloat(ppdVal.toFixed(1)) });
    }

    const currentPoint = [{ x: parseFloat(state.pmv.toFixed(2)), y: parseFloat(state.ppd.toFixed(1)) }];

    charts.fangerCurve = new Chart(canvas, {
      type: "scatter",
      data: {
        datasets: [
          {
            label: "Kurva Teoritis Fanger (ISO 7730)",
            data: curvePoints,
            showLine: true,
            borderColor: "#0d9488",
            borderWidth: 2.5,
            pointRadius: 0,
            pointHitRadius: 6,
            fill: {
              target: "origin",
              above: "rgba(13, 148, 136, 0.06)"
            },
            tension: 0.3
          },
          {
            label: "Current Zone State",
            data: currentPoint,
            pointRadius: 7,
            pointHoverRadius: 9,
            pointBackgroundColor: "#0284c7",
            pointBorderColor: "#ffffff",
            pointBorderWidth: 2.5,
            showLine: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: "linear",
            min: -3,
            max: 3,
            title: {
              display: true,
              text: "Predicted Mean Vote (PMV) — Skala Sensasi Termal",
              color: "#64748b",
              font: { family: "Source Sans 3", size: 11, weight: "bold" }
            },
            grid: { color: "rgba(226, 232, 240, 0.7)" },
            ticks: {
              stepSize: 1,
              callback: function (val) {
                if (val === -3) return "-3 (Cold)";
                if (val === -2) return "-2 (Cool)";
                if (val === -1) return "-1 (Agak Sejuk)";
                if (val === 0) return "0 (Neutral)";
                if (val === 1) return "+1 (Agak Hangat)";
                if (val === 2) return "+2 (Warm)";
                if (val === 3) return "+3 (Hot)";
                return val;
              },
              font: { size: 10, family: "Source Sans 3" },
              color: "#475569"
            }
          },
          y: {
            min: 0,
            max: 100,
            title: {
              display: true,
              text: "Predicted Percentage Dissatisfied (PPD %)",
              color: "#64748b",
              font: { family: "Source Sans 3", size: 11, weight: "bold" }
            },
            grid: { color: "rgba(226, 232, 240, 0.7)" },
            ticks: {
              stepSize: 20,
              callback: v => `${v}%`,
              font: { size: 10, family: "Source Sans 3" },
              color: "#64748b"
            }
          }
        },
        plugins: {
          legend: {
            position: "top",
            labels: {
              boxWidth: 12,
              font: { family: "Source Sans 3", size: 11, weight: 600 },
              color: "#334155"
            }
          },
          tooltip: {
            ...darkTooltip,
            callbacks: {
              label: function (ctx) {
                if (ctx.datasetIndex === 1) {
                  return `Titik Operasi: PMV ${ctx.parsed.x > 0 ? '+' : ''}${ctx.parsed.x} | PPD ${ctx.parsed.y}%`;
                }
                return `PMV: ${ctx.parsed.x > 0 ? '+' : ''}${ctx.parsed.x} -> PPD: ${ctx.parsed.y}%`;
              }
            }
          }
        }
      }
    });
  }

  function updateChartMarker() {
    if (!charts.fangerCurve) return;
    charts.fangerCurve.data.datasets[1].data = [
      { x: parseFloat(state.pmv.toFixed(2)), y: parseFloat(state.ppd.toFixed(1)) }
    ];
    charts.fangerCurve.update("none");
  }

  // ── 9. Chart 2: Multi-Zone Thermal Comfort Comparison ─────────────────────────
  function initMultiZoneChart() {
    const canvas = document.getElementById("chart-thermal-multizone");
    if (!canvas) return;

    const labels = state.zones.map(z => z.name.split(' (')[0]);
    const taData = state.zones.map(z => z.ta);
    const trData = state.zones.map(z => parseFloat(calcMRT(z.tg, z.ta, z.vel, 0.15, 0.95).toFixed(1)));
    const topData = state.zones.map((z, i) => parseFloat(calcOperativeTemp(z.ta, trData[i], z.vel).toFixed(1)));
    const pmvData = state.zones.map((z, i) => parseFloat(calcFanger(z.ta, trData[i], z.vel, z.rh, state.met, state.clo).pmv.toFixed(2)));

    charts.multiZone = new Chart(canvas, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Suhu Udara Ta (°C)",
            data: taData,
            backgroundColor: "rgba(14, 165, 233, 0.8)",
            borderRadius: 6,
            yAxisID: "y"
          },
          {
            label: "Mean Radiant Temp Tr (°C)",
            data: trData,
            backgroundColor: "rgba(245, 158, 11, 0.8)",
            borderRadius: 6,
            yAxisID: "y"
          },
          {
            label: "Operative Temp Top (°C)",
            data: topData,
            backgroundColor: "rgba(13, 148, 136, 0.85)",
            borderRadius: 6,
            yAxisID: "y"
          },
          {
            type: "line",
            label: "PMV Indeks (-3 s/d +3)",
            data: pmvData,
            borderColor: "#e11d48",
            backgroundColor: "#e11d48",
            borderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            yAxisID: "y1"
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 10, family: "Source Sans 3" }, color: "#475569" }
          },
          y: {
            min: 20,
            max: 28,
            title: {
              display: true,
              text: "Suhu (°C)",
              color: "#64748b",
              font: { family: "Source Sans 3", size: 11, weight: "bold" }
            },
            grid: { color: "rgba(226, 232, 240, 0.7)" },
            ticks: {
              stepSize: 2,
              callback: v => `${v}°C`,
              font: { size: 10, family: "Source Sans 3" },
              color: "#64748b"
            }
          },
          y1: {
            position: "right",
            min: -1.0,
            max: 1.0,
            title: {
              display: true,
              text: "Indeks PMV",
              color: "#e11d48",
              font: { family: "Source Sans 3", size: 11, weight: "bold" }
            },
            grid: { display: false },
            ticks: {
              stepSize: 0.5,
              callback: v => (v > 0 ? `+${v}` : v),
              font: { size: 10, family: "Source Sans 3" },
              color: "#e11d48"
            }
          }
        },
        plugins: {
          legend: {
            position: "top",
            labels: {
              boxWidth: 12,
              font: { family: "Source Sans 3", size: 11, weight: 600 },
              color: "#334155"
            }
          },
          tooltip: {
            ...darkTooltip,
            callbacks: {
              label: function (ctx) {
                if (ctx.dataset.label.includes("PMV")) {
                  return `${ctx.dataset.label}: ${ctx.parsed.y > 0 ? '+' : ''}${ctx.parsed.y}`;
                }
                return `${ctx.dataset.label}: ${ctx.parsed.y} °C`;
              }
            }
          }
        }
      }
    });
  }

  // ── 10. Interactive Calculator Event Handlers ─────────────────────────────────
  function setupCalculator() {
    const bindInput = (id, prop, isNum = true) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", (e) => {
        const val = isNum ? parseFloat(e.target.value) : e.target.value;
        if (!isNaN(val)) {
          state[prop] = val;
          // Update display badge next to input if any
          const badge = document.getElementById(`${id}-val`);
          if (badge) badge.textContent = val;
          updateKPIs();
        }
      });
    };

    bindInput("calc-ta", "ta");
    bindInput("calc-tg", "tg");
    bindInput("calc-rh", "rh");
    bindInput("calc-vel", "vel");

    // Metabolic rate preset select
    const selMet = document.getElementById("calc-met-select");
    if (selMet) {
      selMet.addEventListener("change", (e) => {
        state.met = parseFloat(e.target.value);
        updateKPIs();
      });
    }

    // Clothing preset select
    const selClo = document.getElementById("calc-clo-select");
    if (selClo) {
      selClo.addEventListener("change", (e) => {
        state.clo = parseFloat(e.target.value);
        updateKPIs();
      });
    }

    // Reset Calculator to Lab Live Baseline
    const btnReset = document.getElementById("btn-calc-reset");
    if (btnReset) {
      btnReset.addEventListener("click", () => {
        state.ta = 24.2;
        state.tg = 24.9;
        state.rh = 58.0;
        state.vel = 0.12;
        state.met = 1.1;
        state.clo = 0.50;

        const setVal = (id, v) => {
          const el = document.getElementById(id);
          if (el) el.value = v;
          const badge = document.getElementById(`${id}-val`);
          if (badge) badge.textContent = v;
        };

        setVal("calc-ta", 24.2);
        setVal("calc-tg", 24.9);
        setVal("calc-rh", 58.0);
        setVal("calc-vel", 0.12);
        if (selMet) selMet.value = "1.1";
        if (selClo) selClo.value = "0.5";

        updateKPIs();
      });
    }
  }

  // ── 11. Export Report Functionality ───────────────────────────────────────────
  function exportReport() {
    const reportData = {
      timestamp: new Date().toLocaleString("id-ID"),
      location: "BEMS Living Lab — Ruang Smart Lab & Workspace",
      parameters: {
        ta: `${state.ta} °C`,
        tg: `${state.tg} °C`,
        tr: `${fmt(state.tr, 2)} °C`,
        top: `${fmt(state.top, 2)} °C`,
        rh: `${state.rh} %`,
        vel: `${state.vel} m/s`,
        met: `${state.met} met`,
        clo: `${state.clo} clo`
      },
      evaluation: {
        pmv: `${state.pmv > 0 ? '+' : ''}${fmt(state.pmv, 2)}`,
        ppd: `${fmt(state.ppd, 1)} %`,
        isoCategory: state.category,
        comfortStandard: "ISO 7730 / ASHRAE 55-2023"
      },
      zones: state.zones.map(z => ({
        name: z.name,
        code: z.code,
        ta: `${z.ta} °C`,
        tr: `${fmt(calcMRT(z.tg, z.ta, z.vel, 0.15, 0.95), 1)} °C`,
        pmv: fmt(calcFanger(z.ta, calcMRT(z.tg, z.ta, z.vel, 0.15, 0.95), z.vel, z.rh, state.met, state.clo).pmv, 2)
      }))
    };

    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bems_thermal_evaluation_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── 12. Public Init ───────────────────────────────────────────────────────────
  function init() {
    updateKPIs();
    renderMultiZoneTable();
    initFangerCurveChart();
    initMultiZoneChart();
    setupCalculator();

    const exportBtn = document.getElementById("btn-export-thermal");
    if (exportBtn) {
      exportBtn.addEventListener("click", exportReport);
    }
  }

  window.ThermalService = {
    init,
    calcFanger,
    calcMRT,
    calcOperativeTemp,
    updateKPIs,
    exportReport
  };

  document.addEventListener("DOMContentLoaded", init);
})();
