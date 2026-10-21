/**
 * BEMS Living Lab — Energy Telemetry & Advanced Charting Engine
 * Sumber Data: MySQL Database (iotlabun_sbms) via api_energy.php
 * Endpoint   : https://iotlab-uns.com/api_energy.php?key=iotlab_smartroom_2024
 * Channel    : id_kwh=1 (AC), id_kwh=2 (Outlet), id_kwh=3 (Lamp)
 */

(function () {
  "use strict";

  const API_URL = (window.APP_CONFIG && window.APP_CONFIG.ENERGY && window.APP_CONFIG.ENERGY.API_URL)
    || "https://iotlab-uns.com/api_energy.php";
  const API_KEY = (window.APP_CONFIG && window.APP_CONFIG.ENERGY && window.APP_CONFIG.ENERGY.API_KEY)
    || "iotlab_smartroom_2024";
  const POLL_INTERVAL = 3500; // 3.5 detik
  const TARIF_KWH = 1500; // Rp/kWh
  const CARBON_FACTOR = 0.85; // kg CO2 / kWh

  // Ring buffer real-time (30 titik cuplikan)
  const MAX_BUFFER = 30;
  const ringBuffer = {
    labels: [],
    freq: [],
    acCurrent: [],
    outletCurrent: [],
    lampCurrent: [],
    acPower: [],
    outletPower: [],
    lampPower: []
  };

  // State memori
  let pollTimer = null;
  let isPolling = false;
  let activePeriod = "24h";
  let activeChartType = "line"; // "line" | "bar"

  // Chart instances
  const charts = {
    freq: null,
    current: null,
    power: null,
    donut: null,
    voltage: null,
    kwh: null
  };

  // Dataset visibility filter
  const datasetVisibility = {
    ac: true,
    outlet: true,
    lamp: true,
    total: true
  };

  // Mode tampilan chart konsumsi energi ("cum" = Kumulatif kWh, "wh" = Per Interval Wh)
  let activeKwhMode = "cum";
  // Layout tampilan chart ("grid" = 2 Kolom, "stacked" = 1 Kolom Bentang Penuh)
  let activeLayout = "grid";

  // Cache data historis terakhir untuk toggle cepat tanpa re-fetch
  let cachedHistorical = {
    labels: [],
    acPower: [],
    outletPower: [],
    lampPower: [],
    totalPower: [],
    acVolt: [],
    outletVolt: [],
    lampVolt: [],
    acKwh: [],
    outletKwh: [],
    lampKwh: [],
    acWh: [],
    outletWh: [],
    lampWh: [],
    acCumKwh: [],
    outletCumKwh: [],
    lampCumKwh: []
  };

  // Utility formatters
  function fmt(val, decimals = 2) {
    const num = parseFloat(val);
    if (!Number.isFinite(num)) return "--";
    return num.toLocaleString("id-ID", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function fmtKwh(val) {
    const num = parseFloat(val);
    if (!Number.isFinite(num)) return "--";
    return num.toLocaleString("id-ID", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function setEl(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  // Evaluasi Power Factor Quality
  function evaluatePf(pf) {
    const v = parseFloat(pf || 0);
    if (v >= 0.95) {
      return { text: "Sangat Baik (PF ≥ 0.95)", bg: "bg-emerald-50", textCol: "text-emerald-700", border: "border-emerald-200" };
    }
    if (v >= 0.85) {
      return { text: "Nominal Operating", bg: "bg-blue-50", textCol: "text-blue-700", border: "border-blue-200" };
    }
    if (v > 0) {
      return { text: "Rendah (Induktif)", bg: "bg-amber-50", textCol: "text-amber-700", border: "border-amber-200" };
    }
    return { text: "Siaga (Standby)", bg: "bg-slate-50", textCol: "text-slate-600", border: "border-slate-200" };
  }

  // Helper membuat gradient mewah vertikal
  function makeGradient(ctx, topColor, bottomColor, height = 300) {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, topColor);
    grad.addColorStop(1, bottomColor);
    return grad;
  }

  // Common Tooltip Config Elegan (Dark Glassmorphism)
  const darkTooltipConfig = {
    backgroundColor: "#0f172a",
    titleColor: "#f8fafc",
    bodyColor: "#e2e8f0",
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderWidth: 1,
    titleFont: { size: 12, weight: "700", family: "'Source Sans 3', sans-serif" },
    bodyFont: { size: 12, family: "'Source Sans 3', sans-serif" },
    padding: 10,
    cornerRadius: 8,
    boxPadding: 5,
    usePointStyle: true,
    callbacks: {
      labelTextColor: () => "#f8fafc"
    }
  };

  // ── 1. Fetch Real-Time Telemetry dari MySQL ──────────────────────────────────
  async function fetchLiveEnergy() {
    try {
      const url = `${API_URL}?key=${API_KEY}&t=${Date.now()}`;
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);

      processLiveEnergyData(data);
      updateConnectionStatus(true);
    } catch (err) {
      console.warn("[EnergyService] Polling error:", err.message);
      updateConnectionStatus(false, err.message);
    }
  }

  // ── 2. Proses dan Update DOM dari data MySQL ─────────────────────────────────
  function processLiveEnergyData(data) {
    const ac = data.ac || {};
    const outlet = data.outlet || {};
    const lamp = data.lamp || {};

    const acPower = parseFloat(ac.active_power || 0);
    const outletPower = parseFloat(outlet.active_power || 0);
    const lampPower = parseFloat(lamp.active_power || 0);

    const acCurrent = parseFloat(ac.arus || 0);
    const outletCurrent = parseFloat(outlet.arus || 0);
    const lampCurrent = parseFloat(lamp.arus || 0);

    const acVoltage = parseFloat(ac.tegangan || 0);
    const outletVoltage = parseFloat(outlet.tegangan || 0);
    const lampVoltage = parseFloat(lamp.tegangan || 0);

    const parseKwh = (val) => {
      const v = parseFloat(val || 0);
      return v > 1000 ? v / 1000.0 : v;
    };

    const acKwh = parseKwh(ac.total_energy);
    const outletKwh = parseKwh(outlet.total_energy);
    const lampKwh = parseKwh(lamp.total_energy);

    const calcPf = (p, ap) => {
      const active = parseFloat(p || 0);
      const app = parseFloat(ap || 0);
      if (app > 0.001) return Math.min(1.0, active / app);
      return 0.0;
    };

    const acPf = ac.pf !== undefined ? parseFloat(ac.pf) : calcPf(ac.active_power, ac.apparent_power);
    const outletPf = outlet.pf !== undefined ? parseFloat(outlet.pf) : calcPf(outlet.active_power, outlet.apparent_power);
    const lampPf = lamp.pf !== undefined ? parseFloat(lamp.pf) : calcPf(lamp.active_power, lamp.apparent_power);

    const freq = parseFloat(ac.frekuensi || outlet.frekuensi || lamp.frekuensi || 50.0);

    // Agregat Total
    const totPower = acPower + outletPower + lampPower;
    const totCurrent = acCurrent + outletCurrent + lampCurrent;
    const totKwh = acKwh + outletKwh + lampKwh;
    const estCost = Math.round(totKwh * TARIF_KWH);
    const totCo2 = totKwh * CARBON_FACTOR;

    // Simpan ke window.liveData
    if (window.liveData) {
      window.liveData.energy = {
        ac: { power: acPower, current: acCurrent, voltage: acVoltage, kwh: acKwh, pf: acPf, freq },
        outlet: { power: outletPower, current: outletCurrent, voltage: outletVoltage, kwh: outletKwh, pf: outletPf, freq },
        lamp: { power: lampPower, current: lampCurrent, voltage: lampVoltage, kwh: lampKwh, pf: lampPf, freq },
        total: { power: totPower, current: totCurrent, kwh: totKwh, cost: estCost, freq },
        lastUpdate: new Date().toISOString()
      };
    }

    // ── Update KPI Summary Cards ──────────────────────────────
    setEl("total-power", fmt(totPower, 2));
    setEl("total-current", fmt(totCurrent, 2));
    setEl("total-energy-kwh", fmtKwh(totKwh));
    setEl("total-freq-card", fmt(freq, 2));
    setEl("daily-cost", estCost.toLocaleString("id-ID"));
    setEl("total-co2", fmt(totCo2, 1));

    // Update Status Badge pada Card Total Power
    const pwrBadge = document.getElementById("total-power-status");
    if (pwrBadge) {
      if (totPower > 3.5) {
        pwrBadge.textContent = "Peak Demand";
        pwrBadge.className = "inline-block px-2.5 py-0.5 text-[11px] font-semibold rounded-full bg-rose-50 text-rose-700 border border-rose-200";
      } else if (totPower > 1.5) {
        pwrBadge.textContent = "Intermediate Load";
        pwrBadge.className = "inline-block px-2.5 py-0.5 text-[11px] font-semibold rounded-full bg-amber-50 text-amber-700 border border-amber-200";
      } else {
        pwrBadge.textContent = "Efisiensi Tinggi";
        pwrBadge.className = "inline-block px-2.5 py-0.5 text-[11px] font-semibold rounded-full bg-teal-50 text-teal-700 border border-teal-200";
      }
    }

    // ── Update Channel 1: AC ──────────────────────────────────
    setEl("ac-power", fmt(acPower, 2));
    setEl("eu-ac-voltage", fmt(acVoltage, 1));
    setEl("eu-ac-current", fmt(acCurrent, 2));
    setEl("eu-ac-kwh", fmtKwh(acKwh));
    setEl("eu-ac-reactive", fmt(ac.reactive_power, 1));
    setEl("eu-ac-apparent", fmt(ac.apparent_power, 1));
    setEl("eu-ac-freq", fmt(ac.frekuensi || freq, 2));
    setEl("eu-ac-pf", fmt(acPf, 2));
    setEl("eu-ac-ts", ac.created_at ? ac.created_at.substring(11, 19) + " WIB" : "--");

    const acPfInfo = evaluatePf(acPf);
    const acPfBadge = document.getElementById("eu-ac-pf-quality");
    if (acPfBadge) {
      acPfBadge.textContent = acPfInfo.text;
      acPfBadge.className = `px-2 py-0.5 rounded-full text-[10px] font-semibold border ${acPfInfo.bg} ${acPfInfo.textCol} ${acPfInfo.border}`;
    }
    const acPbar = document.getElementById("eu-ac-pbar");
    if (acPbar) {
      const pct = Math.min(100, (acPower / 3.0) * 100);
      acPbar.style.width = `${pct.toFixed(1)}%`;
    }

    // ── Update Channel 2: Outlet ──────────────────────────────
    setEl("outlet-power", fmt(outletPower, 2));
    setEl("eu-outlet-voltage", fmt(outletVoltage, 1));
    setEl("eu-outlet-current", fmt(outletCurrent, 2));
    setEl("eu-outlet-kwh", fmtKwh(outletKwh));
    setEl("eu-outlet-reactive", fmt(outlet.reactive_power, 1));
    setEl("eu-outlet-apparent", fmt(outlet.apparent_power, 1));
    setEl("eu-outlet-freq", fmt(outlet.frekuensi || freq, 2));
    setEl("eu-outlet-pf", fmt(outletPf, 2));
    setEl("eu-outlet-ts", outlet.created_at ? outlet.created_at.substring(11, 19) + " WIB" : "--");

    const outletPfInfo = evaluatePf(outletPf);
    const outletPfBadge = document.getElementById("eu-outlet-pf-quality");
    if (outletPfBadge) {
      outletPfBadge.textContent = outletPfInfo.text;
      outletPfBadge.className = `px-2 py-0.5 rounded-full text-[10px] font-semibold border ${outletPfInfo.bg} ${outletPfInfo.textCol} ${outletPfInfo.border}`;
    }
    const outletPbar = document.getElementById("eu-outlet-pbar");
    if (outletPbar) {
      const pct = Math.min(100, (outletPower / 1.0) * 100);
      outletPbar.style.width = `${pct.toFixed(1)}%`;
    }

    // ── Update Channel 3: Lampu ───────────────────────────────
    setEl("lamp-power", fmt(lampPower, 2));
    setEl("eu-lamp-voltage", fmt(lampVoltage, 1));
    setEl("eu-lamp-current", fmt(lampCurrent, 2));
    setEl("eu-lamp-kwh", fmtKwh(lampKwh));
    setEl("eu-lamp-reactive", fmt(lamp.reactive_power, 1));
    setEl("eu-lamp-apparent", fmt(lamp.apparent_power, 1));
    setEl("eu-lamp-freq", fmt(lamp.frekuensi || freq, 2));
    setEl("eu-lamp-pf", fmt(lampPf, 2));
    setEl("eu-lamp-ts", lamp.created_at ? lamp.created_at.substring(11, 19) + " WIB" : "--");

    const lampPfInfo = evaluatePf(lampPf);
    const lampPfBadge = document.getElementById("eu-lamp-pf-quality");
    if (lampPfBadge) {
      lampPfBadge.textContent = lampPfInfo.text;
      lampPfBadge.className = `px-2 py-0.5 rounded-full text-[10px] font-semibold border ${lampPfInfo.bg} ${lampPfInfo.textCol} ${lampPfInfo.border}`;
    }
    const lampPbar = document.getElementById("eu-lamp-pbar");
    if (lampPbar) {
      const pct = Math.min(100, (lampPower / 0.5) * 100);
      lampPbar.style.width = `${pct.toFixed(1)}%`;
    }

    // Update Live Badges di Header Chart Tegangan
    setEl("lbl-live-vac", fmt(acVoltage, 1) + " V");
    setEl("lbl-live-vout", fmt(outletVoltage, 1) + " V");
    setEl("lbl-live-vlamp", fmt(lampVoltage, 1) + " V");

    // ── Update Ring Buffer & Real-time Charts ────────────────
    const now = new Date();
    const timeLabel = String(now.getHours()).padStart(2, "0") + ":" +
                      String(now.getMinutes()).padStart(2, "0") + ":" +
                      String(now.getSeconds()).padStart(2, "0");

    ringBuffer.labels.push(timeLabel);
    ringBuffer.freq.push(freq);
    ringBuffer.acCurrent.push(acCurrent);
    ringBuffer.outletCurrent.push(outletCurrent);
    ringBuffer.lampCurrent.push(lampCurrent);
    ringBuffer.acPower.push(acPower);
    ringBuffer.outletPower.push(outletPower);
    ringBuffer.lampPower.push(lampPower);

    if (ringBuffer.labels.length > MAX_BUFFER) {
      ringBuffer.labels.shift();
      ringBuffer.freq.shift();
      ringBuffer.acCurrent.shift();
      ringBuffer.outletCurrent.shift();
      ringBuffer.lampCurrent.shift();
      ringBuffer.acPower.shift();
      ringBuffer.outletPower.shift();
      ringBuffer.lampPower.shift();
    }

    updateRealtimeCharts();

    // ── Update Donut Chart & Breakdown ───────────────────────
    updateDonutBreakdown(acKwh, outletKwh, lampKwh, totKwh, totPower);

    // ── Update Live Table Rows ───────────────────────────────
    updateEnergyTable({
      ac: { power: acPower, current: acCurrent, voltage: acVoltage, kwh: acKwh, pf: acPf, freq, ts: ac.created_at },
      outlet: { power: outletPower, current: outletCurrent, voltage: outletVoltage, kwh: outletKwh, pf: outletPf, freq, ts: outlet.created_at },
      lamp: { power: lampPower, current: lampCurrent, voltage: lampVoltage, kwh: lampKwh, pf: lampPf, freq, ts: lamp.created_at },
      total: { power: totPower, current: totCurrent, voltage: (acVoltage + outletVoltage + lampVoltage) / 3, kwh: totKwh, pf: (acPf + outletPf + lampPf) / 3, freq }
    });

    // ── Update Daily Summary Section ─────────────────────────
    setEl("ds-ac-kwh", fmtKwh(acKwh));
    setEl("ds-outlet-kwh", fmtKwh(outletKwh));
    setEl("ds-lamp-kwh", fmtKwh(lampKwh));
    setEl("ds-total-kwh", fmtKwh(totKwh));
    setEl("ds-cost", estCost.toLocaleString("id-ID"));
    setEl("ds-ac-peak", fmt(acPower * 1000, 0));
    setEl("ds-outlet-peak", fmt(outletPower * 1000, 0));
    setEl("ds-lamp-peak", fmt(lampPower * 1000, 0));

    // Update Header Clock & Last Update
    const timeStr = now.toLocaleTimeString("id-ID", { hour12: false }) + " WIB";
    setEl("energy-last-update-header", timeStr);
    if (window.BemsClock && typeof window.BemsClock.onDataReceived === "function") {
      window.BemsClock.onDataReceived(timeStr);
    }
  }

  // ── 3. Update Real-Time Charts ───────────────────────────────────────────────
  function updateRealtimeCharts() {
    if (charts.freq) {
      charts.freq.data.labels = ringBuffer.labels.slice();
      charts.freq.data.datasets[0].data = ringBuffer.freq.slice();
      charts.freq.update("none");
    }

    if (charts.current) {
      charts.current.data.labels = ringBuffer.labels.slice();
      charts.current.data.datasets[0].data = ringBuffer.acCurrent.slice();
      charts.current.data.datasets[1].data = ringBuffer.outletCurrent.slice();
      charts.current.data.datasets[2].data = ringBuffer.lampCurrent.slice();
      charts.current.update("none");
    }
  }

  // ── 4. Update Donut Chart Pangsa Beban ───────────────────────────────────────
  function updateDonutBreakdown(acKwh, outletKwh, lampKwh, totKwh, totKw) {
    if (totKwh <= 0) return;

    const pctAc = (acKwh / totKwh) * 100;
    const pctOutlet = (outletKwh / totKwh) * 100;
    const pctLamp = (lampKwh / totKwh) * 100;

    // Update Text di Center Donut
    setEl("donut-center-kwh", fmtKwh(totKwh));
    setEl("donut-center-kw", fmt(totKw, 2) + " kW");

    // Update Legend Baris
    setEl("donut-pct-ac", pctAc.toFixed(1) + "%");
    setEl("donut-val-ac", fmtKwh(acKwh) + " kWh");
    const barAc = document.getElementById("donut-bar-ac");
    if (barAc) barAc.style.width = pctAc.toFixed(1) + "%";

    setEl("donut-pct-outlet", pctOutlet.toFixed(1) + "%");
    setEl("donut-val-outlet", fmtKwh(outletKwh) + " kWh");
    const barOutlet = document.getElementById("donut-bar-outlet");
    if (barOutlet) barOutlet.style.width = pctOutlet.toFixed(1) + "%";

    setEl("donut-pct-lamp", pctLamp.toFixed(1) + "%");
    setEl("donut-val-lamp", fmtKwh(lampKwh) + " kWh");
    const barLamp = document.getElementById("donut-bar-lamp");
    if (barLamp) barLamp.style.width = pctLamp.toFixed(1) + "%";

    // Update Chart
    if (charts.donut) {
      charts.donut.data.datasets[0].data = [acKwh, outletKwh, lampKwh];
      charts.donut.update("none");
    }
  }

  // ── 5. Inisialisasi Chart.js Super Elegan ────────────────────────────────────
  function initEnergyCharts() {
    // 1. Chart Frekuensi Jaringan (Hz)
    const freqCanvas = document.getElementById("mysqlVoltFreqChart");
    if (freqCanvas) {
      const ctx = freqCanvas.getContext("2d");
      const gradCyan = makeGradient(ctx, "rgba(14, 165, 233, 0.28)", "rgba(14, 165, 233, 0.0)", 190);

      charts.freq = new Chart(ctx, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              label: "Frekuensi (Hz)",
              data: [],
              borderColor: "#0284c7",
              backgroundColor: gradCyan,
              borderWidth: 2.2,
              pointRadius: 0,
              pointHoverRadius: 6,
              pointHoverBackgroundColor: "#ffffff",
              pointHoverBorderColor: "#0284c7",
              pointHoverBorderWidth: 2.5,
              tension: 0.38,
              fill: true
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { intersect: false, mode: "index" },
          plugins: {
            legend: { display: false },
            tooltip: {
              ...darkTooltipConfig,
              callbacks: {
                label: (ctx) => {
                  const val = ctx.parsed.y || 0;
                  const dev = (val - 50.0).toFixed(2);
                  const sign = dev >= 0 ? `+${dev}` : dev;
                  return ` Frekuensi: ${val.toFixed(2)} Hz (${sign} Hz deviasi)`;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: "#94a3b8", maxTicksLimit: 6, font: { size: 10 } }
            },
            y: {
              min: 49.7,
              max: 50.3,
              grid: { color: "#f1f5f9", borderDash: [3, 3] },
              ticks: {
                color: "#64748b",
                font: { size: 10, weight: "600" },
                stepSize: 0.1,
                callback: (v) => v.toFixed(2) + " Hz"
              }
            }
          }
        }
      });
    }

    // 2. Chart Arus Multi-Kanal (A)
    const currCanvas = document.getElementById("mysqlCurrentChart");
    if (currCanvas) {
      const ctx = currCanvas.getContext("2d");
      const gradBlue = makeGradient(ctx, "rgba(30, 64, 175, 0.18)", "rgba(30, 64, 175, 0.0)", 190);
      const gradGreen = makeGradient(ctx, "rgba(5, 150, 105, 0.18)", "rgba(5, 150, 105, 0.0)", 190);
      const gradAmber = makeGradient(ctx, "rgba(217, 119, 6, 0.18)", "rgba(217, 119, 6, 0.0)", 190);

      charts.current = new Chart(ctx, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              label: "AC (A)",
              data: [],
              borderColor: "#1e40af",
              backgroundColor: gradBlue,
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 5,
              pointHoverBackgroundColor: "#ffffff",
              pointHoverBorderColor: "#1e40af",
              pointHoverBorderWidth: 2,
              tension: 0.38,
              fill: true
            },
            {
              label: "Outlet (A)",
              data: [],
              borderColor: "#059669",
              backgroundColor: gradGreen,
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 5,
              pointHoverBackgroundColor: "#ffffff",
              pointHoverBorderColor: "#059669",
              pointHoverBorderWidth: 2,
              tension: 0.38,
              fill: true
            },
            {
              label: "Lampu (A)",
              data: [],
              borderColor: "#d97706",
              backgroundColor: gradAmber,
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 5,
              pointHoverBackgroundColor: "#ffffff",
              pointHoverBorderColor: "#d97706",
              pointHoverBorderWidth: 2,
              tension: 0.38,
              fill: true
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { intersect: false, mode: "index" },
          plugins: {
            legend: {
              display: true,
              position: "top",
              labels: {
                boxWidth: 8,
                boxHeight: 8,
                usePointStyle: true,
                pointStyle: "circle",
                font: { size: 11, weight: "600" },
                color: "#64748b",
                padding: 12
              }
            },
            tooltip: {
              ...darkTooltipConfig,
              callbacks: {
                label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)} A`
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: "#94a3b8", maxTicksLimit: 6, font: { size: 10 } }
            },
            y: {
              beginAtZero: true,
              grid: { color: "#f1f5f9", borderDash: [3, 3] },
              ticks: {
                color: "#64748b",
                font: { size: 10, weight: "600" },
                callback: (v) => v.toFixed(2) + " A"
              }
            }
          }
        }
      });
    }

    // 3. Chart Profil Daya Aktif Historis (Hero Chart)
    const pwrCanvas = document.getElementById("energyPowerChart");
    if (pwrCanvas) {
      const ctx = pwrCanvas.getContext("2d");
      const gradHeroBlue = makeGradient(ctx, "rgba(37, 99, 235, 0.32)", "rgba(37, 99, 235, 0.0)", 320);
      const gradHeroGreen = makeGradient(ctx, "rgba(16, 185, 129, 0.28)", "rgba(16, 185, 129, 0.0)", 320);
      const gradHeroAmber = makeGradient(ctx, "rgba(245, 158, 11, 0.28)", "rgba(245, 158, 11, 0.0)", 320);

      charts.power = new Chart(ctx, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              label: "AC (kW)",
              data: [],
              borderColor: "#2563eb",
              backgroundColor: gradHeroBlue,
              borderWidth: 2.2,
              tension: 0.38,
              fill: true,
              pointRadius: 0,
              pointHoverRadius: 6,
              pointHoverBackgroundColor: "#ffffff",
              pointHoverBorderColor: "#2563eb",
              pointHoverBorderWidth: 2.5
            },
            {
              label: "Outlet (kW)",
              data: [],
              borderColor: "#059669",
              backgroundColor: gradHeroGreen,
              borderWidth: 2.2,
              tension: 0.38,
              fill: true,
              pointRadius: 0,
              pointHoverRadius: 6,
              pointHoverBackgroundColor: "#ffffff",
              pointHoverBorderColor: "#059669",
              pointHoverBorderWidth: 2.5
            },
            {
              label: "Lampu (kW)",
              data: [],
              borderColor: "#d97706",
              backgroundColor: gradHeroAmber,
              borderWidth: 2.2,
              tension: 0.38,
              fill: true,
              pointRadius: 0,
              pointHoverRadius: 6,
              pointHoverBackgroundColor: "#ffffff",
              pointHoverBorderColor: "#d97706",
              pointHoverBorderWidth: 2.5
            },
            {
              label: "Total Daya (kW)",
              data: [],
              borderColor: "#7c3aed",
              backgroundColor: "transparent",
              borderWidth: 2.2,
              borderDash: [5, 4],
              tension: 0.38,
              fill: false,
              pointRadius: 0,
              pointHoverRadius: 6,
              pointHoverBackgroundColor: "#ffffff",
              pointHoverBorderColor: "#7c3aed",
              pointHoverBorderWidth: 2.5
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 600, easing: "easeOutQuart" },
          interaction: { intersect: false, mode: "index" },
          plugins: {
            legend: { display: false },
            tooltip: {
              ...darkTooltipConfig,
              callbacks: {
                label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(3)} kW`
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: "#94a3b8", font: { size: 11, weight: "500" }, maxTicksLimit: 12 }
            },
            y: {
              beginAtZero: true,
              grid: { color: "#f1f5f9", borderDash: [4, 4] },
              ticks: {
                color: "#64748b",
                font: { size: 11, weight: "600" },
                callback: (v) => v.toFixed(2) + " kW"
              }
            }
          }
        }
      });
    }

    // 4. Chart Donut Distribusi Beban Energi (% Breakdown)
    const donutCanvas = document.getElementById("energyDonutChart");
    if (donutCanvas) {
      const ctx = donutCanvas.getContext("2d");
      charts.donut = new Chart(ctx, {
        type: "doughnut",
        data: {
          labels: ["AC (Air Conditioner)", "Stop Kontak (Outlet)", "Pencahayaan (Lamp)"],
          datasets: [
            {
              data: [9531.35, 37.72, 34.40],
              backgroundColor: ["#2563eb", "#059669", "#d97706"],
              hoverBackgroundColor: ["#1d4ed8", "#047857", "#b45309"],
              borderWidth: 2,
              borderColor: "#ffffff",
              hoverOffset: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "75%",
          plugins: {
            legend: { display: false },
            tooltip: {
              ...darkTooltipConfig,
              callbacks: {
                label: function (ctx) {
                  const val = ctx.raw || 0;
                  const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                  const pct = total > 0 ? ((val / total) * 100).toFixed(1) : "0.0";
                  return ` ${ctx.label}: ${fmtKwh(val)} kWh (${pct}%)`;
                }
              }
            }
          }
        }
      });
    }

    // 5. Chart Tegangan Historis (V) - High Resolution & Glitch-Free
    const voltCanvas = document.getElementById("energyVoltageChart");
    if (voltCanvas) {
      const ctx = voltCanvas.getContext("2d");
      const gradAcVolt = makeGradient(ctx, "rgba(37, 99, 235, 0.16)", "rgba(37, 99, 235, 0.0)", 260);
      const gradOutVolt = makeGradient(ctx, "rgba(5, 150, 105, 0.12)", "rgba(5, 150, 105, 0.0)", 260);

      charts.voltage = new Chart(ctx, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              label: "Tegangan AC",
              data: [],
              borderColor: "#2563eb",
              backgroundColor: gradAcVolt,
              borderWidth: 2.2,
              tension: 0.35,
              fill: true,
              spanGaps: true,
              pointRadius: 0,
              pointHoverRadius: 6
            },
            {
              label: "Tegangan Outlet",
              data: [],
              borderColor: "#059669",
              backgroundColor: gradOutVolt,
              borderWidth: 2.0,
              tension: 0.35,
              fill: false,
              spanGaps: true,
              pointRadius: 0,
              pointHoverRadius: 6
            },
            {
              label: "Tegangan Lampu",
              data: [],
              borderColor: "#d97706",
              backgroundColor: "transparent",
              borderWidth: 1.8,
              tension: 0.35,
              fill: false,
              spanGaps: true,
              pointRadius: 0,
              pointHoverRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { intersect: false, mode: "index" },
          plugins: {
            legend: { display: false },
            tooltip: {
              ...darkTooltipConfig,
              callbacks: {
                label: (ctx) => {
                  const v = ctx.parsed.y;
                  if (v == null || isNaN(v)) return ` ${ctx.dataset.label}: N/A`;
                  const diff = (v - 220).toFixed(1);
                  const sign = diff >= 0 ? "+" : "";
                  return ` ${ctx.dataset.label}: ${v.toFixed(1)} V (${sign}${diff}V standar PLN 220V)`;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { color: "#f8fafc" },
              ticks: { color: "#64748b", font: { size: 11, weight: "500" }, maxTicksLimit: 12 }
            },
            y: {
              suggestedMin: 220,
              suggestedMax: 242,
              grid: { color: "#f1f5f9", borderDash: [3, 3] },
              ticks: {
                color: "#475569",
                font: { size: 11, weight: "600" },
                stepSize: 5,
                callback: (v) => v + " V"
              }
            }
          }
        }
      });
    }

    // 6. Chart Konsumsi Energi (kWh / Wh) - High Resolution & Dual Mode
    const kwhCanvas = document.getElementById("energyKwhChart");
    if (kwhCanvas) {
      const ctx = kwhCanvas.getContext("2d");
      const gradKwhAc = makeGradient(ctx, "rgba(37, 99, 235, 0.22)", "rgba(37, 99, 235, 0.01)", 260);
      const gradKwhOut = makeGradient(ctx, "rgba(5, 150, 105, 0.18)", "rgba(5, 150, 105, 0.01)", 260);
      const gradKwhLamp = makeGradient(ctx, "rgba(217, 119, 6, 0.18)", "rgba(217, 119, 6, 0.01)", 260);

      charts.kwh = new Chart(ctx, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              label: "AC",
              data: [],
              borderColor: "#2563eb",
              backgroundColor: gradKwhAc,
              borderWidth: 2.2,
              tension: 0.35,
              fill: true,
              pointRadius: 0,
              pointHoverRadius: 6
            },
            {
              label: "Outlet",
              data: [],
              borderColor: "#059669",
              backgroundColor: gradKwhOut,
              borderWidth: 2.0,
              tension: 0.35,
              fill: true,
              pointRadius: 0,
              pointHoverRadius: 6
            },
            {
              label: "Lampu",
              data: [],
              borderColor: "#d97706",
              backgroundColor: gradKwhLamp,
              borderWidth: 1.8,
              tension: 0.35,
              fill: true,
              pointRadius: 0,
              pointHoverRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { intersect: false, mode: "index" },
          plugins: {
            legend: { display: false },
            tooltip: {
              ...darkTooltipConfig,
              callbacks: {
                label: (ctx) => {
                  const val = ctx.parsed.y || 0;
                  if (activeKwhMode === "cum") {
                    const cost = Math.round(val * TARIF_KWH);
                    return ` ${ctx.dataset.label}: ${val.toFixed(4)} kWh (~Rp ${cost.toLocaleString("id-ID")})`;
                  } else {
                    const kwhEquiv = val / 1000;
                    const cost = Math.round(kwhEquiv * TARIF_KWH);
                    return ` ${ctx.dataset.label}: ${val.toFixed(2)} Wh (${kwhEquiv.toFixed(4)} kWh | ~Rp ${cost})`;
                  }
                }
              }
            }
          },
          scales: {
            x: {
              grid: { color: "#f8fafc" },
              ticks: { color: "#64748b", font: { size: 11, weight: "500" }, maxTicksLimit: 12 }
            },
            y: {
              beginAtZero: true,
              grid: { color: "#f1f5f9", borderDash: [3, 3] },
              ticks: {
                color: "#475569",
                font: { size: 11, weight: "600" },
                callback: (v) => {
                  if (activeKwhMode === "cum") return v.toFixed(3) + " kWh";
                  return v.toFixed(1) + " Wh";
                }
              }
            }
          }
        }
      });
    }

    // Pasang Event Listeners untuk View Layout & Kwh Mode Switchers
    setupLayoutSwitcher();
    setupKwhModeSwitcher();

    // Muat data historis awal
    loadEnergyHistory("24h");
  }

  // ── 6. Fetch & Load Data Historis dari MySQL ──────────────────────────────────
  async function loadEnergyHistory(period) {
    activePeriod = period || "24h";

    // Update styling tombol filter periode
    document.querySelectorAll(".period-btn").forEach(btn => {
      if (btn.getAttribute("data-period") === activePeriod) {
        btn.className = "period-btn px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#0f6b64] text-white shadow-sm";
      } else {
        btn.className = "period-btn px-3 py-1.5 text-xs font-medium rounded-lg text-slate-600 hover:bg-slate-100 transition-colors";
      }
    });

    const now = new Date();
    const toDateStr = now.toISOString().split("T")[0];
    let fromDateStr = toDateStr;

    if (activePeriod === "7d") {
      const d7 = new Date();
      d7.setDate(d7.getDate() - 7);
      fromDateStr = d7.toISOString().split("T")[0];
    } else if (activePeriod === "30d") {
      const d30 = new Date();
      d30.setDate(d30.getDate() - 30);
      fromDateStr = d30.toISOString().split("T")[0];
    }

    try {
      const [resAc, resOutlet, resLamp] = await Promise.all([
        fetch(`${API_URL}?key=${API_KEY}&action=history&id_kwh=1&from=${fromDateStr}&to=${toDateStr}&limit=50`).then(r => r.json()).catch(() => ({ rows: [] })),
        fetch(`${API_URL}?key=${API_KEY}&action=history&id_kwh=2&from=${fromDateStr}&to=${toDateStr}&limit=50`).then(r => r.json()).catch(() => ({ rows: [] })),
        fetch(`${API_URL}?key=${API_KEY}&action=history&id_kwh=3&from=${fromDateStr}&to=${toDateStr}&limit=50`).then(r => r.json()).catch(() => ({ rows: [] }))
      ]);

      const rowsAc = resAc.rows || [];
      const rowsOutlet = resOutlet.rows || [];
      const rowsLamp = resLamp.rows || [];

      const count = Math.max(rowsAc.length, rowsOutlet.length, rowsLamp.length);
      const labels = [];
      const acPowerData = [];
      const outletPowerData = [];
      const lampPowerData = [];
      const totalPowerData = [];

      const acVoltData = [];
      const outletVoltData = [];
      const lampVoltData = [];

      const acKwhData = [];
      const outletKwhData = [];
      const lampKwhData = [];

      const acWhData = [];
      const outletWhData = [];
      const lampWhData = [];

      const acCumKwhData = [];
      const outletCumKwhData = [];
      const lampCumKwhData = [];

      let runAc = 0, runOutlet = 0, runLamp = 0;

      for (let i = 0; i < count; i++) {
        const itemAc = rowsAc[i] || {};
        const itemOutlet = rowsOutlet[i] || {};
        const itemLamp = rowsLamp[i] || {};

        const ts = itemAc.timestamp || itemOutlet.timestamp || itemLamp.timestamp || "";
        labels.push(ts.substring(11, 16) || `${i + 1}`);

        const pAc = parseFloat(itemAc.active_power || 0);
        const pOutlet = parseFloat(itemOutlet.active_power || 0);
        const pLamp = parseFloat(itemLamp.active_power || 0);
        acPowerData.push(pAc);
        outletPowerData.push(pOutlet);
        lampPowerData.push(pLamp);
        totalPowerData.push(pAc + pOutlet + pLamp);

        const rawVac = parseFloat(itemAc.tegangan || 0);
        const rawVout = parseFloat(itemOutlet.tegangan || 0);
        const rawVlamp = parseFloat(itemLamp.tegangan || 0);

        // Filter drop 0V atau sensor disconnect (<150V) agar kurva tidak jatuh ke 0
        acVoltData.push(rawVac > 150 ? rawVac : null);
        outletVoltData.push(rawVout > 150 ? rawVout : null);
        lampVoltData.push(rawVlamp > 150 ? rawVlamp : null);

        const kAc = parseFloat(itemAc.energy_kwh || 0);
        const kOut = parseFloat(itemOutlet.energy_kwh || 0);
        const kLamp = parseFloat(itemLamp.energy_kwh || 0);

        acKwhData.push(kAc);
        outletKwhData.push(kOut);
        lampKwhData.push(kLamp);

        // Satuan Watt-hour (Wh) untuk per interval
        acWhData.push(parseFloat((kAc * 1000).toFixed(3)));
        outletWhData.push(parseFloat((kOut * 1000).toFixed(3)));
        lampWhData.push(parseFloat((kLamp * 1000).toFixed(3)));

        // Akumulasi berjalan (kWh)
        runAc += kAc;
        runOutlet += kOut;
        runLamp += kLamp;

        acCumKwhData.push(parseFloat(runAc.toFixed(5)));
        outletCumKwhData.push(parseFloat(runOutlet.toFixed(5)));
        lampCumKwhData.push(parseFloat(runLamp.toFixed(5)));
      }

      cachedHistorical = {
        labels, acPower: acPowerData, outletPower: outletPowerData, lampPower: lampPowerData, totalPower: totalPowerData,
        acVolt: acVoltData, outletVolt: outletVoltData, lampVolt: lampVoltData,
        acKwh: acKwhData, outletKwh: outletKwhData, lampKwh: lampKwhData,
        acWh: acWhData, outletWh: outletWhData, lampWh: lampWhData,
        acCumKwh: acCumKwhData, outletCumKwh: outletCumKwhData, lampCumKwh: lampCumKwhData
      };

      // Update Chart Power
      if (charts.power) {
        charts.power.data.labels = labels;
        charts.power.data.datasets[0].data = acPowerData;
        charts.power.data.datasets[1].data = outletPowerData;
        charts.power.data.datasets[2].data = lampPowerData;
        charts.power.data.datasets[3].data = totalPowerData;
        charts.power.update();
      }

      // Update Chart Voltage (dengan sanitasi null & auto scale framing)
      if (charts.voltage) {
        charts.voltage.data.labels = labels;
        charts.voltage.data.datasets[0].data = acVoltData;
        charts.voltage.data.datasets[1].data = outletVoltData;
        charts.voltage.data.datasets[2].data = lampVoltData;

        const allV = [...acVoltData, ...outletVoltData, ...lampVoltData].filter(v => v !== null && v > 150);
        if (allV.length > 0) {
          const minV = Math.floor(Math.min(...allV) - 2);
          const maxV = Math.ceil(Math.max(...allV) + 2);
          const avgV = allV.reduce((a, b) => a + b, 0) / allV.length;
          charts.voltage.options.scales.y.min = Math.min(minV, 222);
          charts.voltage.options.scales.y.max = Math.max(maxV, 240);
          setEl("lbl-volt-status", `Rerata: ~${avgV.toFixed(1)} V`);
          setEl("lbl-avg-volt", `${avgV.toFixed(1)} V`);
          setEl("lbl-minmax-volt", `${Math.min(...allV).toFixed(1)} - ${Math.max(...allV).toFixed(1)} V`);
        }
        charts.voltage.update();
      }

      // Update Header & Footer Metrics untuk Energi
      const totalKwhWindow = runAc + runOutlet + runLamp;
      const totalCostWindow = Math.round(totalKwhWindow * TARIF_KWH);
      const avgWhPerSnap = count > 0 ? (totalKwhWindow * 1000 / count) : 0;

      setEl("lbl-tot-energy-badge", `Total: ${totalKwhWindow.toFixed(4)} kWh`);
      setEl("lbl-sub-kwh-ac", `${runAc.toFixed(4)} kWh`);
      setEl("lbl-sub-kwh-out", `${runOutlet.toFixed(4)} kWh`);
      setEl("lbl-sub-kwh-lamp", `${runLamp.toFixed(4)} kWh`);
      setEl("lbl-cost-kwh", `Rp ${totalCostWindow.toLocaleString("id-ID")}`);
      setEl("lbl-avg-kwh", `${avgWhPerSnap.toFixed(2)} Wh`);

      // Update Chart kWh
      if (charts.kwh) {
        charts.kwh.data.labels = labels;
        updateKwhChartDisplay();
      }

      // Update Statistik Ringkasan di bawah chart
      if (totalPowerData.length > 0) {
        const latest = totalPowerData[totalPowerData.length - 1];
        const min = Math.min(...totalPowerData);
        const max = Math.max(...totalPowerData);
        const sum = totalPowerData.reduce((a, b) => a + b, 0);
        const avg = sum / totalPowerData.length;

        setEl("stat-pwr-latest", fmt(latest, 2) + " kW");
        setEl("stat-pwr-min", fmt(min, 2) + " kW");
        setEl("stat-pwr-max", fmt(max, 2) + " kW");
        setEl("stat-pwr-avg", fmt(avg, 2) + " kW");
      }
    } catch (e) {
      console.warn("[EnergyService] Historical fetch error:", e);
    }
  }

  // ── Layout Switcher: Berdampingan (2 Kolom) vs Bentang Penuh (1 Kolom Besar) ──
  function setupLayoutSwitcher() {
    const btnGrid = document.getElementById("btn-layout-grid");
    const btnStacked = document.getElementById("btn-layout-stacked");
    const container = document.getElementById("voltage-energy-grid");

    if (btnGrid && btnStacked && container) {
      btnGrid.addEventListener("click", () => {
        activeLayout = "grid";
        btnGrid.className = "px-3 py-1 text-xs font-semibold rounded-md bg-white text-slate-800 shadow-2xs border border-slate-200 flex items-center gap-1.5 transition-all";
        btnStacked.className = "px-3 py-1 text-xs font-medium rounded-md text-slate-600 hover:text-slate-900 flex items-center gap-1.5 transition-all";
        container.className = "grid grid-cols-1 lg:grid-cols-2 gap-4";
        setTimeout(() => {
          if (charts.voltage) charts.voltage.resize();
          if (charts.kwh) charts.kwh.resize();
        }, 100);
      });

      btnStacked.addEventListener("click", () => {
        activeLayout = "stacked";
        btnStacked.className = "px-3 py-1 text-xs font-semibold rounded-md bg-white text-slate-800 shadow-2xs border border-slate-200 flex items-center gap-1.5 transition-all";
        btnGrid.className = "px-3 py-1 text-xs font-medium rounded-md text-slate-600 hover:text-slate-900 flex items-center gap-1.5 transition-all";
        container.className = "grid grid-cols-1 gap-6";
        setTimeout(() => {
          if (charts.voltage) charts.voltage.resize();
          if (charts.kwh) charts.kwh.resize();
        }, 100);
      });
    }
  }

  // ── Mode Switcher Konsumsi Energi: Kumulatif (kWh) vs Per Interval (Wh) ──
  function setupKwhModeSwitcher() {
    const btnCum = document.getElementById("btn-kwh-cum");
    const btnWh = document.getElementById("btn-kwh-wh");

    if (btnCum && btnWh) {
      btnCum.addEventListener("click", () => {
        if (activeKwhMode === "cum") return;
        activeKwhMode = "cum";
        btnCum.className = "px-2.5 py-1 text-[11px] font-semibold rounded-md bg-white text-blue-700 shadow-2xs border border-slate-200 transition-all";
        btnWh.className = "px-2.5 py-1 text-[11px] font-medium rounded-md text-slate-600 hover:text-slate-900 transition-all";
        updateKwhChartDisplay();
      });

      btnWh.addEventListener("click", () => {
        if (activeKwhMode === "wh") return;
        activeKwhMode = "wh";
        btnWh.className = "px-2.5 py-1 text-[11px] font-semibold rounded-md bg-white text-blue-700 shadow-2xs border border-slate-200 transition-all";
        btnCum.className = "px-2.5 py-1 text-[11px] font-medium rounded-md text-slate-600 hover:text-slate-900 transition-all";
        updateKwhChartDisplay();
      });
    }
  }

  // ── Render Tampilan Chart Konsumsi Energi Sesuai Mode Aktif ──
  function updateKwhChartDisplay() {
    if (!charts.kwh) return;

    if (activeKwhMode === "cum") {
      charts.kwh.config.type = "line";
      charts.kwh.data.datasets[0].data = cachedHistorical.acCumKwh || [];
      charts.kwh.data.datasets[1].data = cachedHistorical.outletCumKwh || [];
      charts.kwh.data.datasets[2].data = cachedHistorical.lampCumKwh || [];

      // Line Area Styling
      charts.kwh.data.datasets[0].fill = true;
      charts.kwh.data.datasets[1].fill = true;
      charts.kwh.data.datasets[2].fill = true;
      charts.kwh.data.datasets[0].tension = 0.35;
      charts.kwh.data.datasets[1].tension = 0.35;
      charts.kwh.data.datasets[2].tension = 0.35;

      charts.kwh.options.scales.x.stacked = false;
      charts.kwh.options.scales.y.stacked = false;
      charts.kwh.options.scales.y.ticks.callback = (v) => v.toFixed(3) + " kWh";
    } else {
      charts.kwh.config.type = "bar";
      charts.kwh.data.datasets[0].data = cachedHistorical.acWh || [];
      charts.kwh.data.datasets[1].data = cachedHistorical.outletWh || [];
      charts.kwh.data.datasets[2].data = cachedHistorical.lampWh || [];

      // Stacked Rounded Bar Styling
      charts.kwh.data.datasets[0].borderRadius = 4;
      charts.kwh.data.datasets[1].borderRadius = 4;
      charts.kwh.data.datasets[2].borderRadius = 4;
      charts.kwh.data.datasets[0].barPercentage = 0.75;
      charts.kwh.data.datasets[1].barPercentage = 0.75;
      charts.kwh.data.datasets[2].barPercentage = 0.75;

      charts.kwh.options.scales.x.stacked = true;
      charts.kwh.options.scales.y.stacked = true;
      charts.kwh.options.scales.y.ticks.callback = (v) => v.toFixed(1) + " Wh";
    }

    charts.kwh.update();
  }

  // ── 7. Toggle Tipe Tampilan Chart Power (Area vs Bar) ────────────────────────
  function setChartType(type) {
    if (!charts.power || activeChartType === type) return;
    activeChartType = type;

    // Update active button state
    document.querySelectorAll(".chart-type-btn").forEach(btn => {
      if (btn.getAttribute("data-type") === type) {
        btn.className = "chart-type-btn px-2.5 py-1 text-xs font-semibold rounded-md bg-white text-slate-800 shadow-xs border border-slate-200";
      } else {
        btn.className = "chart-type-btn px-2.5 py-1 text-xs font-medium rounded-md text-slate-500 hover:text-slate-800 transition-colors";
      }
    });

    charts.power.config.type = type === "bar" ? "bar" : "line";
    if (type === "bar") {
      charts.power.data.datasets[0].borderRadius = 4;
      charts.power.data.datasets[1].borderRadius = 4;
      charts.power.data.datasets[2].borderRadius = 4;
      charts.power.data.datasets[3].borderDash = [];
    } else {
      charts.power.data.datasets[3].borderDash = [5, 4];
    }
    charts.power.update();
  }

  // ── 8. Update Live Table ─────────────────────────────────────────────────────
  function updateEnergyTable(metrics) {
    const tbody = document.getElementById("energy-telemetry-tbody");
    if (!tbody) return;

    const rows = [
      {
        id: "M-01",
        name: "Air Conditioner (AC)",
        kwhId: 1,
        color: "text-blue-700",
        pwr: metrics.ac.power,
        volt: metrics.ac.voltage,
        curr: metrics.ac.current,
        freq: metrics.ac.freq,
        pf: metrics.ac.pf,
        kwh: metrics.ac.kwh,
        ts: metrics.ac.ts ? metrics.ac.ts.substring(11, 19) : "--"
      },
      {
        id: "M-02",
        name: "Stop Kontak (Outlet)",
        kwhId: 2,
        color: "text-emerald-700",
        pwr: metrics.outlet.power,
        volt: metrics.outlet.voltage,
        curr: metrics.outlet.current,
        freq: metrics.outlet.freq,
        pf: metrics.outlet.pf,
        kwh: metrics.outlet.kwh,
        ts: metrics.outlet.ts ? metrics.outlet.ts.substring(11, 19) : "--"
      },
      {
        id: "M-03",
        name: "Pencahayaan (Lamp)",
        kwhId: 3,
        color: "text-amber-700",
        pwr: metrics.lamp.power,
        volt: metrics.lamp.voltage,
        curr: metrics.lamp.current,
        freq: metrics.lamp.freq,
        pf: metrics.lamp.pf,
        kwh: metrics.lamp.kwh,
        ts: metrics.lamp.ts ? metrics.lamp.ts.substring(11, 19) : "--"
      }
    ];

    tbody.innerHTML = rows.map(r => {
      const isOnline = r.volt > 50;
      const statusBadge = isOnline
        ? '<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>Aktif</span>'
        : '<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-50 text-slate-500 border border-slate-200">Siaga</span>';

      return `
        <tr class="border-b border-slate-100 hover:bg-slate-50/70 transition-colors">
          <td class="py-3 px-3 font-mono text-xs font-bold text-slate-700">${r.id}</td>
          <td class="py-3 px-3 font-semibold ${r.color} text-xs">${r.name}</td>
          <td class="py-3 px-3">${statusBadge}</td>
          <td class="py-3 px-3 font-mono text-xs font-bold text-slate-900">${fmt(r.pwr, 2)} kW</td>
          <td class="py-3 px-3 font-mono text-xs text-slate-700">${fmt(r.volt, 1)} V</td>
          <td class="py-3 px-3 font-mono text-xs text-slate-700">${fmt(r.curr, 2)} A</td>
          <td class="py-3 px-3 font-mono text-xs text-slate-700">${fmt(r.freq, 2)} Hz</td>
          <td class="py-3 px-3 font-mono text-xs text-slate-700">${fmt(r.pf, 2)}</td>
          <td class="py-3 px-3 font-mono text-xs font-bold text-slate-900">${fmtKwh(r.kwh)} kWh</td>
          <td class="py-3 px-3 font-mono text-[11px] text-slate-400">${r.ts} WIB</td>
        </tr>
      `;
    }).join("");
  }

  // ── 9. CSV Exporter Langsung dari MySQL ──────────────────────────────────────
  async function exportEnergyCSV(kwhId, deviceName) {
    const fromDate = document.getElementById("export-from-date")?.value || new Date().toISOString().split("T")[0];
    const toDate = document.getElementById("export-to-date")?.value || fromDate;

    const btn = document.getElementById(`btn-export-${kwhId}`);
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg> Mengunduh...`;
    }

    try {
      const url = `${API_URL}?key=${API_KEY}&action=history&id_kwh=${kwhId}&from=${fromDate}&to=${toDate}&limit=10000`;
      const res = await fetch(url);
      const json = await res.json();
      const rows = json.rows || [];

      if (rows.length === 0) {
        alert(`Tidak ada data untuk rentang ${fromDate} s/d ${toDate}`);
        return;
      }

      const headers = ["Timestamp", "Tegangan (V)", "Arus (A)", "Frekuensi (Hz)", "Active Power (kW)", "Reactive Power (VAR)", "Apparent Power (VA)", "Power Factor", "Cumulative Energy (kWh)"];
      const csvLines = [headers.join(",")];

      rows.forEach(r => {
        csvLines.push([
          `"${r.timestamp || ""}"`,
          r.tegangan || 0,
          r.arus || 0,
          r.frekuensi || 0,
          r.active_power || 0,
          r.reactive_power || 0,
          r.apparent_power || 0,
          r.power_factor || 0,
          r.energy_kwh || 0
        ].join(","));
      });

      const csvContent = "data:text/csv;charset=utf-8," + encodeURIComponent(csvLines.join("\n"));
      const link = document.createElement("a");
      link.setAttribute("href", csvContent);
      link.setAttribute("download", `BEMS_${deviceName}_${fromDate}_to_${toDate}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      console.error("[EnergyService] Export CSV error:", e);
      alert("Gagal mengunduh CSV: " + e.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg> Ekspor ${deviceName}`;
      }
    }
  }

  // ── 10. Status Koneksi MySQL ────────────────────────────────────────────────
  function updateConnectionStatus(online, errorMsg = "") {
    const badge = document.getElementById("mysql-conn-badge");
    const text = document.getElementById("mysql-conn-text");
    if (!badge || !text) return;

    if (online) {
      badge.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm";
      text.textContent = "MySQL Live Connected";
    } else {
      badge.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 shadow-sm";
      text.textContent = errorMsg ? `Koneksi Terputus (${errorMsg})` : "Koneksi Terputus";
    }
  }

  // ── 11. Setup Date Inputs & Event Listeners ─────────────────────────────────
  function setupExportInputs() {
    const today = new Date().toISOString().split("T")[0];
    const fromInput = document.getElementById("export-from-date");
    const toInput = document.getElementById("export-to-date");
    if (fromInput) fromInput.value = today;
    if (toInput) toInput.value = today;
  }

  // Preset filter tanggal export
  window.setExportPreset = function (days) {
    const now = new Date();
    const toStr = now.toISOString().split("T")[0];
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    const fromStr = fromDate.toISOString().split("T")[0];

    const fInput = document.getElementById("export-from-date");
    const tInput = document.getElementById("export-to-date");
    if (fInput) fInput.value = fromStr;
    if (tInput) tInput.value = toStr;
  };

  // Toggle dataset visibility
  window.toggleEnergyDataset = function (datasetKey, checkbox) {
    if (!charts.power) return;
    datasetVisibility[datasetKey] = checkbox.checked;
    const map = { ac: 0, outlet: 1, lamp: 2, total: 3 };
    const idx = map[datasetKey];
    if (idx !== undefined && charts.power.data.datasets[idx]) {
      charts.power.data.datasets[idx].hidden = !checkbox.checked;
      charts.power.update();
    }
  };

  // Expose global methods
  window.EnergyService = {
    start: function () {
      if (isPolling) return;
      isPolling = true;
      setupExportInputs();
      initEnergyCharts();
      fetchLiveEnergy();
      pollTimer = setInterval(fetchLiveEnergy, POLL_INTERVAL);
    },
    stop: function () {
      if (pollTimer) clearInterval(pollTimer);
      isPolling = false;
    },
    refresh: function () {
      fetchLiveEnergy();
      loadEnergyHistory(activePeriod);
    },
    setPeriod: function (period) {
      loadEnergyHistory(period);
    },
    setChartType: function (type) {
      setChartType(type);
    },
    exportCSV: function (id, name) {
      exportEnergyCSV(id, name);
    }
  };

  // Auto init saat DOM siap
  document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("energy-telemetry-tbody")) {
      window.EnergyService.start();
    }
  });

})();
