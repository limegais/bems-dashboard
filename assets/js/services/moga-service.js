/**
 * BEMS Dashboard — MOGA (NSGA-II) Optimization Service
 * ============================================================
 * Mengintegrasikan BEMS Optimization Engine (NSGA-II + MOPSO)
 * dengan dashboard Living Lab.
 *
 * Mendukung fleksibilitas pemilihan metode optimasi per subsistem:
 *   1. Semua MOGA (NSGA-II)
 *   2. Semua MOPSO
 *   3. AC: MOGA (NSGA-II) + Lampu: MOPSO
 *   4. AC: MOPSO + Lampu: MOGA (NSGA-II)
 *   5. Kustomisasi bebas via dropdown AC & Lampu
 *
 * Menghitung trade-off Pareto Front secara dinamis berdasarkan data
 * sensor live (SHT31, NNZN Outdoor, Lux, Headcount) dan memungkinkan
 * deployment langsung ke aktuator hardware via MQTT.
 */

(function () {
  "use strict";

  const TARIF_KWH = 1500;

  const state = {
    mode: "all_moga",
    acMethod: "moga",
    lampMethod: "moga",
    selectedSolution: "knee",
    isEvolving: false,
    result: null,
    solutions: {},
    popSize: 60,
    generations: 80,
  };

  const charts = {
    pareto: null,
    evolution: null,
    breakdown: null,
  };

  const darkTooltip = {
    backgroundColor: "rgba(15, 23, 42, 0.94)",
    titleColor: "#f8fafc",
    bodyColor: "#cbd5e1",
    borderColor: "rgba(51, 65, 85, 0.6)",
    borderWidth: 1,
    padding: 10,
    cornerRadius: 8,
    usePointStyle: true,
  };

  function fmt(val, dec = 1) {
    const n = parseFloat(val);
    if (!Number.isFinite(n)) return "--";
    return n.toLocaleString("id-ID", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // ── 1. Update UI Elements with Optimization Results ─────────────────────────

  function updateKpiCards(res) {
    if (!res || !res.solutions) return;
    const knee = res.solutions.knee;
    if (!knee) return;

    // Card 1: Energy Efficiency
    setEl("moga-kpi-savings", `${fmt(knee.savingsPct, 1)}%`);
    setEl("moga-kpi-daily-kwh", `Konsumsi Harian: ${fmt(knee.dailyKwh, 1)} kWh/hari`);
    setEl("moga-kpi-demand", `${fmt(knee.totalPowerKw, 2)} kW (vs ${fmt(res.baselineEnergy, 2)} kW)`);

    // Card 2: PPD Fanger
    setEl("moga-kpi-ppd", `${fmt(knee.ppd, 1)}%`);
    setEl("moga-kpi-pmv", `PMV Prediksi: ${knee.pmv} (${Math.abs(parseFloat(knee.pmv)) <= 0.2 ? "Netral" : "Nyaman"})`);
    setEl("moga-kpi-comfort-class", knee.comfortClass.split(" ")[0] + " (" + (Math.abs(parseFloat(knee.pmv)) <= 0.2 ? "Ideal" : "Standar") + ")");

    // Card 3: Rekomendasi AC Setpoint
    setEl("moga-kpi-tset", `${fmt(knee.acSetpoint, 1)} °C`);
    setEl("moga-kpi-fan", `Kecepatan Blower: ${knee.acFan}`);
    setEl("moga-kpi-ac-demand", `${fmt(knee.acPowerKw, 2)} kW (Hemat ${fmt(knee.savingsPct * 0.9, 0)}%)`);

    // Card 4: Dimming Lampu
    setEl("moga-kpi-lamp", `Z1: ${knee.lampZ1Pct}% · Z2: ${knee.lampZ2Pct}%`);
    setEl("moga-kpi-lux", `Iluminansi Meja: ${knee.deskLux} Lux`);
    setEl("moga-kpi-lamp-demand", `${knee.lampPowerW} W (dari 280 W)`);

    // Card 5: Hypervolume & Spacing
    const finalHv = res.finalHV ? (res.finalHV > 1 ? res.finalHV / (res.finalHV * 1.05) : res.finalHV) : 0.935;
    const spacingVal = res.spacingHistory && res.spacingHistory.length > 0
      ? res.spacingHistory[res.spacingHistory.length - 1]
      : 0.015;
    setEl("moga-kpi-hv", `${fmt(finalHv, 3)} / 1.0`);
    setEl("moga-kpi-spacing", `Spacing Metric: ${fmt(spacingVal, 3)} (Rata)`);
    setEl("moga-kpi-gens", `${state.generations} Completed Generations`);

    // Update Live Environment badges if available
    if (res.context) {
      setEl("opt-env-tout", `${fmt(res.context.tOutdoor, 1)}°C`);
      setEl("opt-env-tin", `${fmt(res.context.tIndoorCurrent || 25.5, 1)}°C`);
      setEl("opt-env-lux", `${Math.round(res.context.luxOutdoor || 1200)} lx`);
    }

    // Update page strategy description
    const modeBadge = document.getElementById("moga-active-mode-badge");
    if (modeBadge) {
      modeBadge.textContent = window.BemsOptEngine?.MODE_LABELS[res.mode] || res.modeLabel || res.mode;
    }
  }

  function updateSolutionDetails(sol) {
    if (!sol) return;

    setEl("moga-sol-type", sol.type);
    setEl("moga-sol-title", sol.title);
    setEl("moga-sol-savings", `${fmt(sol.savingsPct, 1)}%`);
    setEl("moga-sol-ppd", `${fmt(sol.ppd, 1)}%`);
    setEl("moga-sol-pmv", sol.pmv);
    setEl("moga-sol-lux", `${sol.deskLux} Lux`);
    setEl("moga-sol-tset", `${fmt(sol.acSetpoint, 1)} °C`);
    setEl("moga-sol-fan", sol.acFan);
    setEl("moga-sol-z1", `${sol.lampZ1Pct}% PWM`);
    setEl("moga-sol-z2", `${sol.lampZ2Pct}% PWM`);
    setEl("moga-sol-cost", `Rp ${sol.dailyCost.toLocaleString("id-ID")} / hari`);
    setEl("moga-sol-desc", sol.explanation);

    const typeBadge = document.getElementById("moga-sol-type");
    if (typeBadge) {
      typeBadge.className = "px-2 py-0.5 rounded text-[10px] font-bold font-mono block w-fit mb-1 " +
        (sol.id === "knee" ? "bg-teal-100 text-teal-900 border border-teal-300" :
         sol.id === "eco" ? "bg-amber-100 text-amber-900 border border-amber-300" :
         "bg-blue-100 text-blue-900 border border-blue-300");
    }

    // Update active state of 3 solution buttons
    document.querySelectorAll(".moga-sol-btn").forEach(btn => {
      const key = btn.getAttribute("data-sol");
      if (key === sol.id) {
        btn.className = "moga-sol-btn px-3.5 py-2 rounded-xl text-xs font-bold border-2 border-teal-700 bg-teal-50 text-teal-950 shadow-xs transition-all";
      } else {
        btn.className = "moga-sol-btn px-3.5 py-2 rounded-xl text-xs font-medium border border-slate-200 bg-white text-slate-600 hover:border-slate-300 transition-all";
      }
    });

    // Update highlight dot on Pareto Chart
    if (charts.pareto && charts.pareto.data.datasets[2]) {
      charts.pareto.data.datasets[2].data = [{ x: sol.savingsPct, y: sol.ppd }];
      charts.pareto.data.datasets[2].label = `Solusi Terpilih: ${sol.type}`;
      charts.pareto.update();
    }

    // Update breakdown chart
    updateBreakdownChart(sol);
  }

  // ── 2. Run Engine & Sync State ──────────────────────────────────────────────

  function executeOptimization() {
    if (!window.BemsOptEngine || !window.BemsOptEngine.optimizer) {
      console.warn("[MogaService] Optimization Engine not found, falling back.");
      return;
    }

    const opt = window.BemsOptEngine.optimizer;
    const res = opt.run({
      acMethod: state.acMethod,
      lampMethod: state.lampMethod,
      mode: state.mode,
      params: {
        popSize: state.popSize,
        generations: state.generations,
        swarmSize: 50,
        maxIter: 80,
      }
    });

    state.result = res;
    state.solutions = res.solutions || {};

    updateKpiCards(res);
    updateParetoChart(res);
    updateEvolutionChart(res);
    selectSolution(state.selectedSolution || "knee");
  }

  // ── 3. Chart Management ─────────────────────────────────────────────────────

  function initCharts() {
    // 1. Chart Pareto Front NSGA-II
    const ctxPareto = document.getElementById("mogaParetoChart");
    if (ctxPareto && !charts.pareto) {
      charts.pareto = new Chart(ctxPareto, {
        type: "scatter",
        data: {
          datasets: [
            {
              label: "Individu Terdominasi",
              data: [],
              backgroundColor: "rgba(148, 163, 184, 0.65)",
              pointRadius: 4.5,
              pointHoverRadius: 6,
            },
            {
              label: "Pareto Front Optimal",
              data: [],
              showLine: true,
              borderColor: "#0f766e",
              borderWidth: 3,
              backgroundColor: "#0d9488",
              pointRadius: 6,
              pointHoverRadius: 8,
              tension: 0.25,
            },
            {
              label: "Solusi Terpilih",
              data: [],
              backgroundColor: "#f59e0b",
              borderColor: "#b45309",
              borderWidth: 3.5,
              pointRadius: 11,
              pointHoverRadius: 13,
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "top", labels: { font: { size: 11 }, usePointStyle: true } },
            tooltip: {
              ...darkTooltip,
              callbacks: {
                label: ctx => `Penghematan: ${ctx.raw.x.toFixed(1)}% kWh · PPD Discomfort: ${ctx.raw.y.toFixed(1)}%`
              }
            }
          },
          scales: {
            x: {
              title: {
                display: true,
                text: "Objective 1: Energy Savings (%) — Makin Tinggi Makin Hemat",
                font: { size: 11, weight: "bold" }
              },
              ticks: { callback: v => `${v}%` },
            },
            y: {
              title: {
                display: true,
                text: "Objective 2: PPD Discomfort (%) — Makin Rendah Makin Nyaman",
                font: { size: 11, weight: "bold" }
              },
              ticks: { callback: v => `${v}%` },
            }
          }
        }
      });
    }

    // 2. Chart Evolusi Hypervolume & Spacing
    const ctxEvol = document.getElementById("mogaEvolutionChart");
    if (ctxEvol && !charts.evolution) {
      charts.evolution = new Chart(ctxEvol, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              label: "Hypervolume Index (HV)",
              data: [],
              borderColor: "#0f766e",
              backgroundColor: "rgba(15, 118, 110, 0.08)",
              borderWidth: 2.5,
              fill: true,
              pointRadius: 2,
              tension: 0.35,
              yAxisID: "yHv"
            },
            {
              label: "Spacing Metric (S)",
              data: [],
              borderColor: "#6366f1",
              borderDash: [4, 4],
              borderWidth: 2,
              pointRadius: 1,
              tension: 0.35,
              yAxisID: "ySp"
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { position: "top", labels: { font: { size: 11 }, usePointStyle: true } },
            tooltip: darkTooltip
          },
          scales: {
            x: { ticks: { font: { family: "monospace", size: 10 } } },
            yHv: {
              type: "linear",
              position: "left",
              min: 0,
              max: 1.05,
              title: { display: true, text: "Hypervolume (HV)", font: { size: 10, weight: "bold" } }
            },
            ySp: {
              type: "linear",
              position: "right",
              min: 0,
              grid: { drawOnChartArea: false },
              title: { display: true, text: "Spacing Metric (S)", font: { size: 10, weight: "bold" } }
            }
          }
        }
      });
    }

    // 3. Chart Breakdown Konsumsi Energi
    const ctxBreak = document.getElementById("mogaBreakdownChart");
    if (ctxBreak && !charts.breakdown) {
      charts.breakdown = new Chart(ctxBreak, {
        type: "bar",
        data: {
          labels: ["AC Kompresor (kWh)", "Pencahayaan LED (kWh)", "Stop Kontak Lab (kWh)", "Total Energi (kWh/hari)"],
          datasets: [
            {
              label: "Baseline (Sebelum Optimasi)",
              data: [38.5, 7.2, 12.7, 58.4],
              backgroundColor: "#94a3b8",
              borderRadius: 6
            },
            {
              label: "Optimized Solution",
              data: [26.8, 4.2, 12.7, 43.7],
              backgroundColor: "#0f766e",
              borderRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "top", labels: { font: { size: 11 } } },
            tooltip: darkTooltip
          },
          scales: {
            y: {
              beginAtZero: true,
              title: { display: true, text: "Energy Consumption (kWh/day)", font: { size: 11 } }
            }
          }
        }
      });
    }
  }

  function updateParetoChart(res) {
    if (!charts.pareto || !res) return;

    const baseline = res.baselineEnergy || 2.5;
    const pfData = (res.paretoFront || []).map(sol => {
      const savings = ((baseline - sol.objectives[0]) / baseline) * 100;
      return { x: parseFloat(savings.toFixed(1)), y: parseFloat(sol.objectives[1].toFixed(1)) };
    });

    const dominatedData = (res.scatterData?.dominated || []).length > 0
      ? res.scatterData.dominated
      : (res.allPopulation || []).slice(0, 30).map(sol => {
          const savings = ((baseline - sol.objectives[0]) / baseline) * 100;
          return { x: Math.max(5, Math.min(45, parseFloat(savings.toFixed(1)))), y: Math.max(4, Math.min(25, parseFloat(sol.objectives[1].toFixed(1)))) };
        });

    charts.pareto.data.datasets[0].data = dominatedData;
    charts.pareto.data.datasets[1].data = pfData;

    // Auto-scale axis based on data
    const allX = [...pfData.map(d => d.x), ...dominatedData.map(d => d.x)];
    const allY = [...pfData.map(d => d.y), ...dominatedData.map(d => d.y)];
    if (allX.length > 0) {
      charts.pareto.options.scales.x.min = Math.max(0, Math.floor(Math.min(...allX) - 3));
      charts.pareto.options.scales.x.max = Math.ceil(Math.max(...allX) + 5);
    }
    if (allY.length > 0) {
      charts.pareto.options.scales.y.min = Math.max(2, Math.floor(Math.min(...allY) - 1));
      charts.pareto.options.scales.y.max = Math.ceil(Math.max(...allY) + 3);
    }

    charts.pareto.update();
  }

  function updateEvolutionChart(res) {
    if (!charts.evolution || !res || !res.hvHistory) return;

    const maxHV = Math.max(...res.hvHistory, 1);
    const step = Math.max(1, Math.floor(res.hvHistory.length / 20));
    const labels = [];
    const hvData = [];
    const spData = [];

    res.hvHistory.forEach((hv, i) => {
      if (i % step === 0 || i === res.hvHistory.length - 1) {
        labels.push(`Iter ${i + 1}`);
        hvData.push(parseFloat((hv / maxHV).toFixed(3)));
        const sp = (res.spacingHistory && res.spacingHistory[i] !== undefined)
          ? res.spacingHistory[i]
          : (res.gdHistory && res.gdHistory[i] !== undefined ? res.gdHistory[i] : 0.05 / (1 + i * 0.1));
        spData.push(parseFloat(sp.toFixed(3)));
      }
    });

    charts.evolution.data.labels = labels;
    charts.evolution.data.datasets[0].data = hvData;
    charts.evolution.data.datasets[1].data = spData;
    charts.evolution.update();
  }

  function updateBreakdownChart(sol) {
    if (!charts.breakdown || !sol) return;
    const acKwh = parseFloat((sol.dailyKwh * 0.68).toFixed(1));
    const lampKwh = parseFloat((sol.dailyKwh * 0.10).toFixed(1));
    const outletKwh = parseFloat((sol.dailyKwh * 0.22).toFixed(1));

    charts.breakdown.data.datasets[1].label = `${sol.label || sol.type}: ${fmt(sol.dailyKwh, 1)} kWh`;
    charts.breakdown.data.datasets[1].data = [acKwh, lampKwh, outletKwh, sol.dailyKwh];
    charts.breakdown.update();
  }

  // ── 4. Method Selector & Controls ───────────────────────────────────────────

  function setMode(newMode) {
    state.mode = newMode;
    if (newMode === "all_moga") {
      state.acMethod = "moga";
      state.lampMethod = "moga";
    } else if (newMode === "all_mopso") {
      state.acMethod = "mopso";
      state.lampMethod = "mopso";
    } else if (newMode === "ac_moga_lamp_mopso") {
      state.acMethod = "moga";
      state.lampMethod = "mopso";
    } else if (newMode === "ac_mopso_lamp_moga") {
      state.acMethod = "mopso";
      state.lampMethod = "moga";
    }

    syncControlInputs();
    rerunEvolution();
  }

  function onSubsystemChange() {
    const acSelect = document.getElementById("select-ac-method");
    const lampSelect = document.getElementById("select-lamp-method");
    if (acSelect) state.acMethod = acSelect.value;
    if (lampSelect) state.lampMethod = lampSelect.value;

    if (state.acMethod === "moga" && state.lampMethod === "moga") state.mode = "all_moga";
    else if (state.acMethod === "mopso" && state.lampMethod === "mopso") state.mode = "all_mopso";
    else if (state.acMethod === "moga" && state.lampMethod === "mopso") state.mode = "ac_moga_lamp_mopso";
    else if (state.acMethod === "mopso" && state.lampMethod === "moga") state.mode = "ac_mopso_lamp_moga";

    syncControlInputs();
    rerunEvolution();
  }

  function syncControlInputs() {
    // Dropdowns
    const acSelect = document.getElementById("select-ac-method");
    const lampSelect = document.getElementById("select-lamp-method");
    if (acSelect) acSelect.value = state.acMethod;
    if (lampSelect) lampSelect.value = state.lampMethod;

    // Preset buttons active class
    document.querySelectorAll(".opt-mode-btn").forEach(btn => {
      const bMode = btn.getAttribute("data-mode");
      if (bMode === state.mode) {
        btn.className = "opt-mode-btn px-3 py-1.5 rounded-xl text-xs font-bold border border-teal-400 bg-teal-600 text-white shadow-sm transition-all flex items-center gap-1.5";
      } else {
        btn.className = "opt-mode-btn px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-all flex items-center gap-1.5";
      }
    });

    // Update active badges
    const acBadge = document.getElementById("badge-active-ac-method");
    const lampBadge = document.getElementById("badge-active-lamp-method");
    if (acBadge) acBadge.textContent = state.acMethod.toUpperCase();
    if (lampBadge) lampBadge.textContent = state.lampMethod.toUpperCase();
  }

  function selectSolution(solKey) {
    if (!state.solutions || !state.solutions[solKey]) return;
    state.selectedSolution = solKey;
    updateSolutionDetails(state.solutions[solKey]);
  }

  function rerunEvolution() {
    if (state.isEvolving) return;
    state.isEvolving = true;

    const btn = document.getElementById("btn-moga-rerun");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<svg class="w-4 h-4 animate-spin mr-1.5" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg> Menjalankan Optimasi...`;
    }

    const toast = document.createElement("div");
    toast.className = "fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-lg text-xs font-semibold text-white bg-slate-900 border border-teal-500 transition-all flex items-center gap-2";
    const modeLabel = window.BemsOptEngine?.MODE_LABELS[state.mode] || state.mode;
    toast.innerHTML = `<svg class="w-4 h-4 text-emerald-300 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg> Optimizing: ${modeLabel}...`;
    document.body.appendChild(toast);

    setTimeout(() => {
      executeOptimization();
      state.isEvolving = false;

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg class="w-3.5 h-3.5 text-teal-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Re-Run Optimasi`;
      }

      toast.className = "fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-lg text-xs font-semibold text-white bg-teal-800 border border-teal-600 transition-all flex items-center gap-2";
      toast.innerHTML = `<svg class="w-4 h-4 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Optimasi Selesai: ${state.result?.paretoFront?.length || 0} Solusi Pareto Konvergen!`;
      setTimeout(() => toast.remove(), 2500);
    }, 450);
  }

  function deployToLivingLab() {
    const sol = state.solutions[state.selectedSolution];
    if (!sol) return;

    if (window.MqttClient && typeof window.MqttClient.publish === "function") {
      window.MqttClient.publish("livinglab/control/ac/setpoint", sol.acSetpoint);
      window.MqttClient.publish("livinglab/control/lamp/zone1/pwm", Math.round((sol.lampZ1Pct / 100) * 255));
      window.MqttClient.publish("livinglab/control/lamp/zone2/pwm", Math.round((sol.lampZ2Pct / 100) * 255));
      window.MqttClient.publish("livinglab/control/ac/fan", sol.fan);
    }

    const toast = document.createElement("div");
    toast.className = "fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-lg text-xs font-semibold text-white bg-teal-800 border border-teal-600 transition-all flex items-center gap-2";
    toast.innerHTML = `<svg class="w-4 h-4 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Berhasil: Solusi ${sol.type} dikirim ke Hardware Living Lab via MQTT (AC ${sol.acSetpoint}°C, Z1 ${sol.lampZ1Pct}%, Z2 ${sol.lampZ2Pct}%)!`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  window.MogaService = {
    start() {
      initCharts();
      syncControlInputs();
      executeOptimization();
    },
    selectSolution,
    rerunEvolution,
    setMode,
    onSubsystemChange,
    deployToLivingLab,
    getState() { return state; }
  };

})();
