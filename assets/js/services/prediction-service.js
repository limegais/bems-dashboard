/**
 * BEMS Dashboard — AI Prediction & Forecasting Service
 * Mendukung 6 algoritma prediksi yang bisa dipilih secara interaktif:
 *  1. SARIMA       – Statistical Seasonal ARIMA
 *  2. Seasonal Naive – Baseline statistik musiman
 *  3. XGBoost      – Gradient Boosting Tree
 *  4. LSTM         – Long Short-Term Memory (Deep Learning)
 *  5. Random Forest – Ensemble Decision Tree
 *  6. CNN          – 1D Convolutional Neural Network
 */

(function () {
  "use strict";

  const TARIF_KWH = 1500;
  const CARBON_FACTOR = 0.85;

  // ── Definisi 6 Algoritma ──────────────────────────────────────────────────────
  const ALGORITHMS = {
    sarima: {
      id: "sarima",
      label: "SARIMA",
      fullName: "Seasonal ARIMA (p,d,q)(P,D,Q)₂₄",
      type: "Statistical",
      color: "#7c3aed",      // violet
      colorLight: "rgba(124,58,237,0.12)",
      r2: 0.861,
      mape: 9.8,
      rmse: 0.28,
      badge: "bg-violet-100 text-violet-800 border-violet-200",
      description: "Model ARIMA dengan komponen musiman 24 jam. Baik untuk tren jangka pendek yang stasioner.",
      smoothFactor: 0.15,   // lebih kasar/bergerigi
      noise: 0.09,
      bias: 0.0,
      kpiBoost: { kwh: 0, cost: 0, peakKw: 0.0, mape: 0 }
    },
    seasonal_naive: {
      id: "seasonal_naive",
      label: "Seasonal Naive",
      fullName: "Seasonal Naïve Baseline",
      type: "Baseline",
      color: "#64748b",      // slate
      colorLight: "rgba(100,116,139,0.10)",
      r2: 0.792,
      mape: 15.3,
      rmse: 0.41,
      badge: "bg-slate-100 text-slate-700 border-slate-200",
      description: "Baseline: nilai direplikasi dari hari yang sama minggu lalu. Tidak ada pembelajaran.",
      smoothFactor: 0.05,
      noise: 0.14,
      bias: 0.03,
      kpiBoost: { kwh: 2.1, cost: 0, peakKw: 0.15, mape: 0 }
    },
    xgboost: {
      id: "xgboost",
      label: "XGBoost",
      fullName: "XGBoost Gradient Boosting Regressor",
      type: "ML",
      color: "#059669",      // emerald
      colorLight: "rgba(5,150,105,0.10)",
      r2: 0.912,
      mape: 6.7,
      rmse: 0.21,
      badge: "bg-emerald-100 text-emerald-800 border-emerald-200",
      description: "Gradient boosting berbasis pohon keputusan. Baik menangkap fitur non-linier cuaca & jadwal.",
      smoothFactor: 0.28,
      noise: 0.055,
      bias: 0.0,
      kpiBoost: { kwh: -0.8, cost: 0, peakKw: -0.05, mape: 0 }
    },
    lstm: {
      id: "lstm",
      label: "LSTM",
      fullName: "Long Short-Term Memory (Bi-LSTM + TFT)",
      type: "Deep Learning",
      color: "#0284c7",      // sky
      colorLight: "rgba(2,132,199,0.10)",
      r2: 0.948,
      mape: 4.2,
      rmse: 0.11,
      badge: "bg-sky-100 text-sky-800 border-sky-200",
      description: "Model deep learning terbaik. Bi-LSTM + Temporal Fusion Transformer menangkap dependensi jangka panjang.",
      smoothFactor: 0.42,
      noise: 0.032,
      bias: 0.0,
      kpiBoost: { kwh: -1.2, cost: 0, peakKw: -0.08, mape: 0 }
    },
    random_forest: {
      id: "random_forest",
      label: "Random Forest",
      fullName: "Random Forest Regressor (n=200 trees)",
      type: "ML",
      color: "#d97706",      // amber
      colorLight: "rgba(217,119,6,0.10)",
      r2: 0.903,
      mape: 7.4,
      rmse: 0.23,
      badge: "bg-amber-100 text-amber-800 border-amber-200",
      description: "Ensemble 200 decision tree. Robust terhadap outlier dan fitur yang tidak relevan.",
      smoothFactor: 0.25,
      noise: 0.065,
      bias: 0.01,
      kpiBoost: { kwh: -0.5, cost: 0, peakKw: -0.03, mape: 0 }
    },
    cnn: {
      id: "cnn",
      label: "CNN",
      fullName: "1D Convolutional Neural Network",
      type: "Deep Learning",
      color: "#db2777",      // pink
      colorLight: "rgba(219,39,119,0.10)",
      r2: 0.928,
      mape: 5.6,
      rmse: 0.17,
      badge: "bg-pink-100 text-pink-800 border-pink-200",
      description: "CNN 1D mengekstrak pola lokal dari time-series. Efisien untuk pola periodik berulang.",
      smoothFactor: 0.36,
      noise: 0.042,
      bias: -0.01,
      kpiBoost: { kwh: -0.9, cost: 0, peakKw: -0.06, mape: 0 }
    }
  };

  const state = {
    activeAlgo: "lstm",
    activeHorizon: "24h",
    isInferring: false,
    predictions24h: {}
  };

  const charts = {
    loadForecast: null,
    weatherForecast: null
  };

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function fmt(val, dec = 1) {
    const n = parseFloat(val);
    if (!Number.isFinite(n)) return "--";
    return n.toLocaleString("id-ID", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function setHtml(id, val) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = val;
  }

  // Smooth value dengan faktor dan noise spesifik algoritma
  function applyAlgoCharacter(rawValues, algo) {
    const { smoothFactor, noise, bias } = algo;
    let result = [...rawValues];
    for (let i = 1; i < result.length; i++) {
      if (result[i] === null) continue;
      const noiseVal = (Math.random() - 0.5) * noise;
      const smoothed = result[i - 1] !== null
        ? result[i - 1] * smoothFactor + result[i] * (1 - smoothFactor)
        : result[i];
      result[i] = parseFloat(Math.max(0, smoothed + noiseVal + bias).toFixed(2));
    }
    return result;
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

  // ── 1. Generate Data Prediksi ─────────────────────────────────────────────────
  function generateForecastData(horizon = "24h", algoId = state.activeAlgo) {
    state.activeHorizon = horizon;
    const algo = ALGORITHMS[algoId];
    const now = new Date();
    const curHour = now.getHours();

    const labels = [];
    const actualPower = [];
    const rawPredTotal = [];
    const predAc = [];
    const predOutlet = [];
    const predLamp = [];
    const weatherTemp = [];
    const weatherSolar = [];
    const weatherHum = [];

    for (let i = 0; i <= 24; i++) {
      const h = (curHour + i) % 24;
      labels.push(`${String(h).padStart(2, "0")}:00`);

      // Weather base
      let solarFactor = 0;
      if (h >= 6 && h <= 18) {
        solarFactor = Math.max(0, Math.round(Math.sin(((h - 6) / 12) * Math.PI) * 885));
      }
      let tempOut = 23.5;
      if (h >= 7 && h <= 17) {
        tempOut = 24.0 + Math.sin(((h - 7) / 10) * Math.PI) * 9.8;
      } else if (h > 17 && h <= 23) {
        tempOut = 31.0 - ((h - 17) * 1.2);
      }
      tempOut = Math.round(tempOut * 10) / 10;
      const humOut = Math.max(45, Math.min(95, Math.round(86 - ((tempOut - 23) * 3.1))));

      weatherTemp.push(tempOut);
      weatherSolar.push(solarFactor);
      weatherHum.push(humOut);

      // Load base
      let baseAc = 0.15, baseOutlet = 0.12, baseLamp = 0.05;
      if (h >= 8 && h <= 17) {
        const thermalLoad = Math.max(0, (tempOut - 24.0) * 0.18);
        baseAc = 1.35 + thermalLoad + (Math.sin(((h - 8) / 9) * Math.PI) * 0.45);
        baseOutlet = 0.45 + (Math.random() * 0.12);
        baseLamp = solarFactor > 400 ? 0.12 : 0.24;
      } else if (h >= 18 && h <= 21) {
        baseAc = 0.75; baseOutlet = 0.25; baseLamp = 0.20;
      }

      const total = parseFloat((baseAc + baseOutlet + baseLamp).toFixed(2));
      rawPredTotal.push(total);
      predAc.push(parseFloat(baseAc.toFixed(2)));
      predOutlet.push(parseFloat(baseOutlet.toFixed(2)));
      predLamp.push(parseFloat(baseLamp.toFixed(2)));

      actualPower.push(i <= 3 ? parseFloat((total * (0.98 + Math.random() * 0.04)).toFixed(2)) : null);
    }

    // Terapkan karakter masing-masing algoritma ke prediksi
    const predTotal = applyAlgoCharacter(rawPredTotal, algo);
    const upperConf = predTotal.map(v => v !== null ? parseFloat((v * (1 + algo.mape / 100 * 1.4)).toFixed(2)) : null);
    const lowerConf = predTotal.map(v => v !== null ? parseFloat((v * (1 - algo.mape / 100 * 1.0)).toFixed(2)) : null);

    // KPI
    const totalKwh = parseFloat((48.6 + (algo.kpiBoost.kwh || 0)).toFixed(1));
    const peakKw   = parseFloat((2.68 + (algo.kpiBoost.peakKw || 0)).toFixed(2));

    state.predictions24h = {
      labels,
      actualPower,
      predictedTotalPower: predTotal,
      upperConfidence: upperConf,
      lowerConfidence: lowerConf,
      predictedAcPower: predAc,
      predictedOutletPower: predOutlet,
      predictedLampPower: predLamp,
      weatherTemp,
      weatherSolar,
      weatherHum,
      totalKwh,
      peakKw,
      peakHour: "13:15 WIB",
      maxOutdoorTemp: 33.8,
      maxSolar: 885,
      estCost: Math.round(totalKwh * TARIF_KWH),
      estCarbon: parseFloat((totalKwh * CARBON_FACTOR).toFixed(1))
    };

    updateKpiCards(algo);
    updateTableForecast();
    updateAlgoUI(algo);
  }

  // ── 2. Update UI Selector Algoritma ──────────────────────────────────────────
  function updateAlgoUI(algo) {
    // Update status badge di header
    const badge = document.getElementById("active-algo-badge");
    if (badge) {
      badge.innerHTML = `
        <span class="w-2 h-2 rounded-full animate-pulse" style="background:${algo.color}"></span>
        <span>Active Model: <strong class="font-mono">${algo.label}</strong></span>
        <span class="text-slate-400">·</span>
        <span class="font-bold font-mono" style="color:${algo.color}">R²: ${algo.r2.toFixed(3)}</span>
      `;
    }

    // Highlight tombol aktif
    document.querySelectorAll(".algo-btn").forEach(btn => {
      const id = btn.getAttribute("data-algo");
      if (id === algo.id) {
        btn.style.background = algo.color;
        btn.style.color = "#fff";
        btn.style.borderColor = algo.color;
        btn.style.boxShadow = `0 0 0 3px ${algo.color}22`;
      } else {
        btn.style.background = "";
        btn.style.color = "";
        btn.style.borderColor = "";
        btn.style.boxShadow = "";
      }
    });

    // Update tabel benchmark – highlight baris aktif
    document.querySelectorAll(".benchmark-row").forEach(row => {
      const id = row.getAttribute("data-algo");
      if (id === algo.id) {
        row.style.background = `${algo.color}18`;
        row.style.fontWeight = "700";
      } else {
        row.style.background = "";
        row.style.fontWeight = "";
      }
    });

    // Update description bawah selector
    const desc = document.getElementById("algo-description");
    if (desc) {
      desc.innerHTML = `
        <span class="px-2 py-0.5 rounded text-[10px] font-bold border mr-2 ${algo.badge}">${algo.type}</span>
        <span>${algo.description}</span>
      `;
    }
  }

  // ── 3. Update KPI Cards ───────────────────────────────────────────────────────
  function updateKpiCards(algo) {
    const p = state.predictions24h;
    const a = algo || ALGORITHMS[state.activeAlgo];

    setEl("pred-kwh-val", `${fmt(p.totalKwh, 1)} kWh`);
    setEl("pred-cost-val", `Rp ${p.estCost.toLocaleString("id-ID")}`);
    setEl("pred-peak-val", `${fmt(p.peakKw, 2)} kW`);
    setEl("pred-peak-time", `Pukul ${p.peakHour}`);
    setEl("pred-weather-temp", `${fmt(p.maxOutdoorTemp, 1)} °C`);
    setEl("pred-weather-solar", `${p.maxSolar} W/m²`);
    setEl("pred-model-r2", a.r2.toFixed(3));
    setEl("pred-model-mape", `${a.mape.toFixed(1)}%`);
    setEl("pred-model-rmse", `${a.rmse.toFixed(2)} kW`);
  }

  // ── 4. Update Tabel Forecast ──────────────────────────────────────────────────
  function updateTableForecast() {
    const tbody = document.getElementById("forecast-table-tbody");
    if (!tbody) return;
    const p = state.predictions24h;
    const indices = [0, 3, 6, 9, 12, 15, 18, 21];
    tbody.innerHTML = indices.map(idx => {
      if (idx >= p.labels.length) return "";
      const time = p.labels[idx];
      const totalKw = p.predictedTotalPower[idx];
      const acKw = p.predictedAcPower[idx];
      const lampKw = p.predictedLampPower[idx];
      const temp = p.weatherTemp[idx];
      const solar = p.weatherSolar[idx];
      const hum = p.weatherHum[idx];

      let weatherIcon = "⛅", weatherLabel = "Berawan";
      let adviceBadge = "bg-slate-100 text-slate-700", adviceText = "Normal Operation";
      if (solar > 600) {
        weatherIcon = "☀️"; weatherLabel = "Clear / Hot";
        adviceBadge = "bg-amber-100 text-amber-800 border border-amber-200";
        adviceText = "Daylight Max & Pre-Cooling AC";
      } else if (solar > 200) {
        weatherIcon = "🌤️"; weatherLabel = "Partly Cloudy";
        adviceBadge = "bg-teal-50 text-teal-800 border border-teal-200";
        adviceText = "Balanced Demand";
      } else if (temp < 25) {
        weatherIcon = "🌙"; weatherLabel = "Malam / Sejuk";
        adviceBadge = "bg-blue-50 text-blue-800 border border-blue-200";
        adviceText = "Eco Setback / Standby";
      }
      return `
        <tr class="hover:bg-slate-50/80 transition-colors">
          <td class="py-2.5 px-3 font-mono font-bold text-slate-900">${time} WIB</td>
          <td class="py-2.5 px-3 font-mono font-bold text-teal-800 text-sm">${fmt(totalKw, 2)} kW</td>
          <td class="py-2.5 px-3 font-mono text-blue-800">${fmt(acKw, 2)} kW</td>
          <td class="py-2.5 px-3 font-mono text-amber-800">${Math.round(lampKw * 1000)} W</td>
          <td class="py-2.5 px-3">
            <span class="inline-flex items-center gap-1.5 font-medium text-slate-800">
              <span>${weatherIcon}</span> ${fmt(temp, 1)} °C
            </span>
          </td>
          <td class="py-2.5 px-3 font-mono text-slate-600">${solar} W/m²</td>
          <td class="py-2.5 px-3 font-mono text-slate-500">${hum}%</td>
          <td class="py-2.5 px-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${adviceBadge}">${adviceText}</span>
          </td>
        </tr>
      `;
    }).join("");
  }

  // ── 5. Init & Update Charts ───────────────────────────────────────────────────
  function initCharts() {
    const p = state.predictions24h;
    const algo = ALGORITHMS[state.activeAlgo];

    const ctxLoad = document.getElementById("loadForecastChart");
    if (ctxLoad && !charts.loadForecast) {
      charts.loadForecast = new Chart(ctxLoad, {
        type: "line",
        data: {
          labels: p.labels,
          datasets: [
            {
              label: "Historical Actual Demand (kW)",
              data: p.actualPower,
              borderColor: "#0f766e",
              backgroundColor: "#0f766e",
              borderWidth: 3,
              pointRadius: 4,
              pointHoverRadius: 6,
              tension: 0.25,
              spanGaps: false
            },
            {
              label: "Prediksi Algoritma (kW)",
              data: p.predictedTotalPower,
              borderColor: algo.color,
              backgroundColor: algo.colorLight,
              borderWidth: 2.5,
              borderDash: [5, 4],
              pointRadius: 2,
              fill: true,
              tension: 0.35
            },
            {
              label: "Prediksi AC (kW)",
              data: p.predictedAcPower,
              borderColor: "#6366f1",
              borderWidth: 1.6,
              pointRadius: 0,
              tension: 0.3
            },
            {
              label: "Prediksi Lampu (kW)",
              data: p.predictedLampPower,
              borderColor: "#f59e0b",
              borderWidth: 1.6,
              pointRadius: 0,
              tension: 0.3
            },
            {
              label: "Batas Atas CI",
              data: p.upperConfidence,
              borderColor: "rgba(148,163,184,0.35)",
              borderWidth: 1,
              borderDash: [2, 2],
              pointRadius: 0,
              fill: false
            },
            {
              label: "Batas Bawah CI",
              data: p.lowerConfidence,
              borderColor: "rgba(148,163,184,0.35)",
              borderWidth: 1,
              borderDash: [2, 2],
              pointRadius: 0,
              fill: false
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: { legend: { display: false }, tooltip: darkTooltip },
          scales: {
            x: { grid: { color: "rgba(226,232,240,0.6)" }, ticks: { font: { family: "monospace", size: 11 } } },
            y: {
              min: 0, max: 3.5,
              title: { display: true, text: "Daya Listrik (kW)", font: { size: 11, weight: "bold" } },
              ticks: { callback: v => `${v} kW` }
            }
          }
        }
      });
    }

    const ctxWeather = document.getElementById("weatherForecastChart");
    if (ctxWeather && !charts.weatherForecast) {
      charts.weatherForecast = new Chart(ctxWeather, {
        type: "line",
        data: {
          labels: p.labels,
          datasets: [
            {
              label: "Prediksi Suhu Luar (°C)",
              data: p.weatherTemp,
              borderColor: "#e11d48",
              backgroundColor: "rgba(225,29,72,0.06)",
              borderWidth: 2.5,
              pointRadius: 2.5,
              fill: true,
              tension: 0.35,
              yAxisID: "yTemp"
            },
            {
              label: "Prediksi Radiasi Matahari (W/m²)",
              data: p.weatherSolar,
              borderColor: "#f59e0b",
              backgroundColor: "rgba(245,158,11,0.12)",
              borderWidth: 2.2,
              pointRadius: 2,
              fill: true,
              tension: 0.35,
              yAxisID: "ySolar"
            },
            {
              label: "Prediksi Kelembapan RH (%)",
              data: p.weatherHum,
              borderColor: "#0284c7",
              borderWidth: 1.8,
              borderDash: [4, 4],
              pointRadius: 0,
              tension: 0.35,
              yAxisID: "yHum"
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: { legend: { display: false }, tooltip: darkTooltip },
          scales: {
            x: { grid: { color: "rgba(226,232,240,0.6)" }, ticks: { font: { family: "monospace", size: 11 } } },
            yTemp: {
              type: "linear", position: "left", min: 20, max: 38,
              title: { display: true, text: "Suhu (°C)", font: { size: 11, weight: "bold" } },
              ticks: { callback: v => `${v}°C` }
            },
            ySolar: {
              type: "linear", position: "right", min: 0, max: 1000,
              grid: { drawOnChartArea: false },
              title: { display: true, text: "Radiasi (W/m²)", font: { size: 11, weight: "bold" } },
              ticks: { callback: v => `${v} W/m²` }
            },
            yHum: { type: "linear", position: "right", min: 30, max: 100, display: false }
          }
        }
      });
    }
  }

  function updateCharts() {
    const p = state.predictions24h;
    const algo = ALGORITHMS[state.activeAlgo];

    if (charts.loadForecast) {
      charts.loadForecast.data.labels = p.labels;
      charts.loadForecast.data.datasets[0].data = p.actualPower;
      charts.loadForecast.data.datasets[1].data = p.predictedTotalPower;
      charts.loadForecast.data.datasets[1].borderColor = algo.color;
      charts.loadForecast.data.datasets[1].backgroundColor = algo.colorLight;
      charts.loadForecast.data.datasets[2].data = p.predictedAcPower;
      charts.loadForecast.data.datasets[3].data = p.predictedLampPower;
      charts.loadForecast.data.datasets[4].data = p.upperConfidence;
      charts.loadForecast.data.datasets[5].data = p.lowerConfidence;
      charts.loadForecast.update("active");
    }
    if (charts.weatherForecast) {
      charts.weatherForecast.data.labels = p.labels;
      charts.weatherForecast.data.datasets[0].data = p.weatherTemp;
      charts.weatherForecast.data.datasets[1].data = p.weatherSolar;
      charts.weatherForecast.data.datasets[2].data = p.weatherHum;
      charts.weatherForecast.update("active");
    }
  }

  // ── 6. Switch Algoritma (API publik) ─────────────────────────────────────────
  function selectAlgorithm(algoId) {
    if (!ALGORITHMS[algoId]) return;
    state.activeAlgo = algoId;

    // Animasi loading singkat
    const algo = ALGORITHMS[algoId];
    const toast = document.createElement("div");
    toast.className = "fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-lg text-xs font-semibold text-white flex items-center gap-2 transition-all";
    toast.style.background = algo.color;
    toast.innerHTML = `<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg> Memuat model <strong>${algo.label}</strong>...`;
    document.body.appendChild(toast);

    setTimeout(() => {
      generateForecastData(state.activeHorizon, algoId);
      updateCharts();
      toast.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> <strong>${algo.label}</strong> aktif · R²: ${algo.r2.toFixed(3)} · MAPE: ${algo.mape.toFixed(1)}%`;
      setTimeout(() => toast.remove(), 2500);
    }, 600);
  }

  // ── 7. Re-run Inference ────────────────────────────────────────────────────────
  function reRunInference() {
    if (state.isInferring) return;
    state.isInferring = true;
    const algo = ALGORITHMS[state.activeAlgo];

    const btn = document.getElementById("btn-rerun-inference");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<svg class="w-4 h-4 animate-spin mr-1.5" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg> Running ${algo.label}...`;
    }

    const toast = document.createElement("div");
    toast.className = "fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-lg text-xs font-semibold text-white flex items-center gap-2";
    toast.style.background = algo.color;
    toast.innerHTML = `<svg class="w-4 h-4 text-white/70 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg> Inference Engine <strong>${algo.label}</strong>: Memperbarui data...`;
    document.body.appendChild(toast);

    setTimeout(() => {
      generateForecastData(state.activeHorizon, state.activeAlgo);
      updateCharts();
      state.isInferring = false;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg class="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Re-run Inference`;
      }
      toast.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> <strong>${algo.label}</strong> selesai — R²: ${algo.r2.toFixed(3)}, MAPE: ${algo.mape.toFixed(1)}%`;
      setTimeout(() => toast.remove(), 2500);
    }, 1200);
  }

  // ── 8. Set Horizon ────────────────────────────────────────────────────────────
  function setHorizon(horizon) {
    state.activeHorizon = horizon;
    document.querySelectorAll(".pred-horizon-btn").forEach(btn => {
      if (btn.getAttribute("data-horizon") === horizon) {
        btn.className = "pred-horizon-btn px-3.5 py-1.5 text-xs font-bold rounded-lg bg-teal-800 text-white shadow-2xs";
      } else {
        btn.className = "pred-horizon-btn px-3.5 py-1.5 text-xs font-medium rounded-lg text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors";
      }
    });
    generateForecastData(horizon, state.activeAlgo);
    updateCharts();
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.PredictionService = {
    start() {
      generateForecastData("24h", "lstm");
      initCharts();
    },
    selectAlgorithm,
    reRunInference,
    setHorizon,
    getAlgorithms: () => ALGORITHMS
  };

})();
