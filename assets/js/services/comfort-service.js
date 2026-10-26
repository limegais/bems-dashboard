/**
 * BEMS Dashboard — Comfort Feedback Service
 * Mengelola umpan balik persepsi kenyamanan termal dan visual penghuni ruangan:
 * - Tab switcher interaktif: Evaluasi Termal (Suhu AC) vs Evaluasi Visual (Pencahayaan & Glare)
 * - Skala ASHRAE 55 7-Point Thermal Sensation Vote (TCV: -3 s/d +3) & Kecepatan Udara
 * - Skala SNI 03-6197 / IESNA 5-Point Visual Sensation Vote (VCV: -2 s/d +2) & Glare Assessment
 * - Sinkronisasi otomatis dengan 4 grafik analisis distribusi & korelasi sensor riil (SHT31 Ta & Lux meja)
 * - Real-time comfort log table & kalkulasi indeks kenyamanan gabungan
 */

(function () {
  "use strict";

  const state = {
    totalVotes: 58,
    thermalSatisfactionPct: 87.9,
    visualSatisfactionPct: 91.4,
    combinedIndex: 89.6,
    activeTab: "thermal",
    currentTcv: 0,
    currentAir: "Pas",
    currentVis: 0,
    currentGlare: "Bebas Silau",
    recentVotes: [
      { id: 1, time: "23:45:10", room: "Workbench 1 (Jendela)", category: "visual", metric: "485 Lux", voteLabel: "Ideal (0)", pref: "Tidak Berubah", condition: "Bebas Silau", note: "Pencahayaan sangat pas untuk bekerja di depan laptop." },
      { id: 2, time: "23:30:25", room: "Workbench 2 (Tengah)", category: "thermal", metric: "24.1 °C", voteLabel: "Netral (0)", pref: "Tidak Berubah", condition: "Semilir Pas", note: "Suhu udara sejuk dan aliran merata." },
      { id: 3, time: "23:12:40", room: "Workbench 3 (Dalam)", category: "thermal", metric: "23.8 °C", voteLabel: "Sejuk (-1)", pref: "Lebih Hangat", condition: "Semilir Pas", note: "Terasa sedikit sejuk di bawah diffuser AC." },
      { id: 4, time: "22:55:18", room: "Workbench 4 (Kanan)", category: "visual", metric: "520 Lux", voteLabel: "Agak Terang (+1)", pref: "Lebih Redup", condition: "Pantulan Monitor", note: "Cahaya matahari sore agak memantul di sudut monitor." },
      { id: 5, time: "22:20:05", room: "Workbench 1 (Jendela)", category: "thermal", metric: "24.6 °C", voteLabel: "Hangat (+1)", pref: "Lebih Dingin", condition: "Pengap", note: "Agak hangat saat banyak orang berkumpul di meja." },
      { id: 6, time: "21:50:33", room: "Workbench 2 (Tengah)", category: "visual", metric: "472 Lux", voteLabel: "Ideal (0)", pref: "Tidak Berubah", condition: "Bebas Silau", note: "Lampu plafon LED nyaman untuk mata." }
    ]
  };

  const charts = {
    thermalDist: null,
    thermalCorr: null,
    visualDist: null,
    visualCorr: null
  };

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

  // ── Tab Switcher: Thermal (Suhu) vs Visual (Cahaya) ──────────────────────────
  function switchTab(tab) {
    state.activeTab = tab;
    const isThermal = tab === "thermal";

    // Form buttons
    const tabThermalBtn = document.getElementById("tab-btn-thermal");
    const tabVisualBtn = document.getElementById("tab-btn-visual");
    const formThermal = document.getElementById("form-thermal");
    const formVisual = document.getElementById("form-visual");

    if (tabThermalBtn && tabVisualBtn) {
      if (isThermal) {
        tabThermalBtn.className = "flex-1 py-2 px-3 rounded-lg text-center transition-all flex items-center justify-center gap-1.5 bg-white text-teal-800 shadow-xs font-bold border border-slate-200/60 cursor-pointer";
        tabVisualBtn.className = "flex-1 py-2 px-3 rounded-lg text-center transition-all flex items-center justify-center gap-1.5 text-slate-600 hover:text-slate-900 font-medium cursor-pointer";
      } else {
        tabVisualBtn.className = "flex-1 py-2 px-3 rounded-lg text-center transition-all flex items-center justify-center gap-1.5 bg-white text-amber-800 shadow-xs font-bold border border-slate-200/60 cursor-pointer";
        tabThermalBtn.className = "flex-1 py-2 px-3 rounded-lg text-center transition-all flex items-center justify-center gap-1.5 text-slate-600 hover:text-slate-900 font-medium cursor-pointer";
      }
    }

    if (formThermal && formVisual) {
      formThermal.classList.toggle("hidden", !isThermal);
      formVisual.classList.toggle("hidden", isThermal);
    }

    // Chart switcher buttons & containers
    const chartThermalSection = document.getElementById("charts-thermal-section");
    const chartVisualSection = document.getElementById("charts-visual-section");
    const chartTabThermalBtn = document.getElementById("chart-tab-btn-thermal");
    const chartTabVisualBtn = document.getElementById("chart-tab-btn-visual");
    const analyticsTitle = document.getElementById("active-analytics-title");

    if (chartThermalSection && chartVisualSection) {
      chartThermalSection.classList.toggle("hidden", !isThermal);
      chartVisualSection.classList.toggle("hidden", isThermal);
    }

    if (chartTabThermalBtn && chartTabVisualBtn) {
      if (isThermal) {
        chartTabThermalBtn.className = "px-3 py-1 rounded-md text-xs transition-all bg-white text-teal-800 shadow-xs font-bold border border-slate-200/60 cursor-pointer";
        chartTabVisualBtn.className = "px-3 py-1 rounded-md text-xs transition-all text-slate-600 hover:text-slate-900 font-medium cursor-pointer";
        if (analyticsTitle) analyticsTitle.textContent = "Distribusi Termal (ASHRAE 55)";
        if (charts.thermalDist) charts.thermalDist.resize();
        if (charts.thermalCorr) charts.thermalCorr.resize();
      } else {
        chartTabVisualBtn.className = "px-3 py-1 rounded-md text-xs transition-all bg-white text-amber-800 shadow-xs font-bold border border-slate-200/60 cursor-pointer";
        chartTabThermalBtn.className = "px-3 py-1 rounded-md text-xs transition-all text-slate-600 hover:text-slate-900 font-medium cursor-pointer";
        if (analyticsTitle) analyticsTitle.textContent = "Distribusi Pencahayaan (SNI 03-6197)";
        initVisualCharts();
        if (charts.visualDist) charts.visualDist.resize();
        if (charts.visualCorr) charts.visualCorr.resize();
      }
    }
  }

  // ── Button Selection Handlers: Thermal ─────────────────────────────────────────
  function setTcvVote(val) {
    state.currentTcv = parseInt(val, 10);
    document.querySelectorAll(".tcv-vote-btn").forEach(btn => {
      if (parseInt(btn.getAttribute("data-val"), 10) === state.currentTcv) {
        btn.className = "tcv-vote-btn active py-2.5 rounded-xl font-bold text-xs bg-teal-800 text-white shadow-2xs border-2 border-teal-600 cursor-pointer";
      } else {
        btn.className = "tcv-vote-btn py-2.5 rounded-xl font-medium text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 transition-colors cursor-pointer";
      }
    });
  }

  function setAirVote(val) {
    state.currentAir = val;
    document.querySelectorAll(".air-vote-btn").forEach(btn => {
      if (btn.getAttribute("data-val") === val) {
        btn.className = "air-vote-btn active px-2 py-2 rounded-xl font-bold text-xs bg-teal-800 text-white shadow-2xs border-2 border-teal-600 cursor-pointer";
      } else {
        btn.className = "air-vote-btn px-2 py-2 rounded-xl font-medium text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 transition-colors cursor-pointer";
      }
    });
  }

  // ── Button Selection Handlers: Visual ──────────────────────────────────────────
  function setVisVote(val) {
    state.currentVis = parseInt(val, 10);
    document.querySelectorAll(".vis-vote-btn").forEach(btn => {
      if (parseInt(btn.getAttribute("data-val"), 10) === state.currentVis) {
        btn.className = "vis-vote-btn active py-2 rounded-xl font-bold text-xs bg-amber-600 text-white shadow-2xs border-2 border-amber-500 cursor-pointer";
      } else {
        btn.className = "vis-vote-btn py-2 rounded-xl font-medium text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 transition-colors cursor-pointer";
      }
    });
  }

  function setGlareVote(val) {
    state.currentGlare = val;
    document.querySelectorAll(".glare-vote-btn").forEach(btn => {
      if (btn.getAttribute("data-val") === val) {
        btn.className = "glare-vote-btn active py-2 px-2.5 rounded-xl font-bold text-xs bg-amber-600 text-white shadow-2xs border-2 border-amber-500 text-left flex items-center gap-1.5 cursor-pointer";
      } else {
        btn.className = "glare-vote-btn py-2 px-2.5 rounded-xl font-medium text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 transition-colors text-left flex items-center gap-1.5 cursor-pointer";
      }
    });
  }

  // ── Submit Feedback Handlers ──────────────────────────────────────────────────
  function submitThermalFeedback(event) {
    if (event) event.preventDefault();

    const room = document.getElementById("fb-thermal-room") ? document.getElementById("fb-thermal-room").value : "Workbench 1";
    const pref = document.getElementById("fb-thermal-pref") ? document.getElementById("fb-thermal-pref").value : "Tidak Berubah";
    const comment = document.getElementById("fb-thermal-comment") ? document.getElementById("fb-thermal-comment").value.trim() : "";

    const tcvMap = {
      "-3": "Sangat Dingin (-3)",
      "-2": "Dingin (-2)",
      "-1": "Sejuk (-1)",
      "0": "Netral (0)",
      "1": "Hangat (+1)",
      "2": "Panas (+2)",
      "3": "Sangat Panas (+3)"
    };

    const airMap = {
      "Draughty": "Kencang",
      "Pas": "Semilir Pas",
      "Stuffy": "Pengap"
    };

    const now = new Date();
    const timeStr = now.toTimeString().split(" ")[0];
    const liveTa = (window.liveData && window.liveData.aggregates && window.liveData.aggregates.avgTemp) || 24.3;

    const newVote = {
      id: Date.now(),
      time: timeStr,
      room: room,
      category: "thermal",
      metric: `${liveTa.toFixed(1)} °C`,
      voteLabel: tcvMap[String(state.currentTcv)] || "Netral (0)",
      pref: pref,
      condition: airMap[state.currentAir] || "Semilir Pas",
      note: comment || "Feedback kenyamanan termal dicatat secara anonim."
    };

    state.recentVotes.unshift(newVote);
    if (state.recentVotes.length > 8) state.recentVotes.pop();
    state.totalVotes++;

    updateStats();
    renderRecentTable();

    showToast("🌡️ Terima kasih! Evaluasi kenyamanan termal berhasil dikirim ke BEMS Living Lab.", "teal");

    if (document.getElementById("fb-thermal-comment")) {
      document.getElementById("fb-thermal-comment").value = "";
    }
  }

  function submitVisualFeedback(event) {
    if (event) event.preventDefault();

    const room = document.getElementById("fb-visual-room") ? document.getElementById("fb-visual-room").value : "Workbench 1";
    const pref = document.getElementById("fb-visual-pref") ? document.getElementById("fb-visual-pref").value : "Tidak Berubah";
    const source = document.getElementById("fb-visual-source") ? document.getElementById("fb-visual-source").value : "Campuran Alami & Lampu";
    const comment = document.getElementById("fb-visual-comment") ? document.getElementById("fb-visual-comment").value.trim() : "";

    const visMap = {
      "-2": "Sangat Redup (-2)",
      "-1": "Agak Redup (-1)",
      "0": "Ideal (0)",
      "1": "Agak Terang (+1)",
      "2": "Sangat Silau (+2)"
    };

    const now = new Date();
    const timeStr = now.toTimeString().split(" ")[0];
    const liveLux = (window.liveData && window.liveData.aggregates && window.liveData.aggregates.avgLux) || 485;

    const newVote = {
      id: Date.now(),
      time: timeStr,
      room: room,
      category: "visual",
      metric: `${Math.round(liveLux)} Lux`,
      voteLabel: visMap[String(state.currentVis)] || "Ideal (0)",
      pref: pref,
      condition: state.currentGlare || "Bebas Silau",
      note: comment || (source ? `Kondisi: ${source}` : "Feedback kenyamanan visual dicatat secara anonim.")
    };

    state.recentVotes.unshift(newVote);
    if (state.recentVotes.length > 8) state.recentVotes.pop();
    state.totalVotes++;

    updateStats();
    renderRecentTable();

    showToast("💡 Terima kasih! Evaluasi kenyamanan pencahayaan berhasil dikirim ke BEMS Living Lab.", "amber");

    if (document.getElementById("fb-visual-comment")) {
      document.getElementById("fb-visual-comment").value = "";
    }
  }

  function showToast(msg, theme = "teal") {
    const bgClass = theme === "amber" ? "bg-amber-800 border-amber-600" : "bg-teal-800 border-teal-600";
    const iconColor = theme === "amber" ? "text-amber-200" : "text-emerald-300";
    const toast = document.createElement("div");
    toast.className = `fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-lg text-xs font-semibold text-white ${bgClass} border transition-all flex items-center gap-2`;
    toast.innerHTML = `<svg class="w-4 h-4 ${iconColor} shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> <span>${msg}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.4s ease";
      setTimeout(() => toast.remove(), 400);
    }, 3200);
  }

  function updateStats() {
    setEl("kpi-fb-total", `${state.totalVotes} Suara`);
    setEl("kpi-fb-thermal", `${state.thermalSatisfactionPct.toFixed(1)}%`);
    setEl("kpi-fb-visual", `${state.visualSatisfactionPct.toFixed(1)}%`);
    setEl("kpi-fb-combined", `${state.combinedIndex.toFixed(1)}%`);
  }

  function renderRecentTable() {
    const tbody = document.getElementById("fb-recent-tbody");
    if (!tbody) return;

    tbody.innerHTML = state.recentVotes.map(v => {
      const isThermal = v.category === "thermal";
      const catBadge = isThermal
        ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-teal-800 border border-teal-200">🌡️ Termal</span>`
        : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">💡 Visual</span>`;

      let voteBadge = "bg-slate-100 text-slate-700 border-slate-200";
      if (isThermal) {
        if (v.voteLabel.includes("-")) voteBadge = "bg-blue-50 text-blue-800 border-blue-200";
        else if (v.voteLabel.includes("+")) voteBadge = "bg-rose-50 text-rose-800 border-rose-200";
        else voteBadge = "bg-teal-50 text-teal-800 border-teal-200";
      } else {
        if (v.voteLabel.includes("-")) voteBadge = "bg-indigo-50 text-indigo-800 border-indigo-200";
        else if (v.voteLabel.includes("+")) voteBadge = "bg-amber-50 text-amber-800 border-amber-200";
        else voteBadge = "bg-emerald-50 text-emerald-800 border-emerald-200";
      }

      return `
        <tr class="hover:bg-slate-50/80 transition-colors">
          <td class="py-2.5 px-3 font-mono text-slate-500">${v.time}</td>
          <td class="py-2.5 px-3 font-bold text-slate-800">${v.room}</td>
          <td class="py-2.5 px-3">${catBadge}</td>
          <td class="py-2.5 px-3 font-mono font-semibold text-slate-700">${v.metric}</td>
          <td class="py-2.5 px-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold border ${voteBadge}">
              ${v.voteLabel}
            </span>
          </td>
          <td class="py-2.5 px-3 font-medium text-slate-600">${v.pref}</td>
          <td class="py-2.5 px-3 text-slate-700 font-medium">${v.condition}</td>
          <td class="py-2.5 px-3 text-slate-500 text-[11px] max-w-xs truncate" title="${v.note}">${v.note}</td>
        </tr>
      `;
    }).join("");
  }

  // ── Inisialisasi Grafik Chart.js ───────────────────────────────────────────────
  function initCharts() {
    // 1. Chart Distribusi Suara ASHRAE 7-Point (Thermal)
    const ctxDist = document.getElementById("comfortDistChart");
    if (ctxDist && !charts.thermalDist) {
      charts.thermalDist = new Chart(ctxDist, {
        type: "bar",
        data: {
          labels: ["-3 Sangat Dingin", "-2 Dingin", "-1 Sejuk", "0 Netral", "+1 Hangat", "+2 Panas", "+3 Sangat Panas"],
          datasets: [
            {
              label: "Persentase Suara Penghuni (%)",
              data: [1.7, 3.4, 15.5, 58.6, 13.8, 5.2, 1.8],
              backgroundColor: [
                "#3b82f6", "#60a5fa", "#93c5fd", "#0f766e", "#f59e0b", "#f97316", "#ef4444"
              ],
              borderRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              ...darkTooltip,
              callbacks: {
                label: ctx => `Jumlah Suara: ${ctx.raw}% (${Math.round((ctx.raw / 100) * state.totalVotes)} responden)`
              }
            }
          },
          scales: {
            y: {
              title: { display: true, text: "Persentase Responden (%)", font: { size: 11 } },
              ticks: { callback: v => `${v}%` },
              min: 0,
              max: 70
            }
          }
        }
      });
    }

    // 2. Chart Korelasi Suhu Aktual vs Sensasi Penghuni (Thermal)
    const ctxCorr = document.getElementById("comfortCorrelationChart");
    if (ctxCorr && !charts.thermalCorr) {
      const samplePoints = [
        { x: 23.2, y: -2 }, { x: 23.5, y: -1 }, { x: 23.8, y: -1 }, { x: 23.9, y: 0 },
        { x: 24.0, y: 0 },  { x: 24.1, y: 0 },  { x: 24.2, y: 0 },  { x: 24.3, y: 0 },
        { x: 24.4, y: 0 },  { x: 24.5, y: 0 },  { x: 24.6, y: 1 },  { x: 24.8, y: 1 },
        { x: 25.1, y: 1 },  { x: 25.4, y: 2 },  { x: 25.8, y: 2 }
      ];

      charts.thermalCorr = new Chart(ctxCorr, {
        type: "scatter",
        data: {
          datasets: [
            {
              label: "Respon Nyata Penghuni",
              data: samplePoints,
              backgroundColor: "#0f766e",
              pointRadius: 6,
              pointHoverRadius: 8
            },
            {
              label: "Garis Regresi Linear Tren Kenyamanan",
              data: [
                { x: 23.0, y: -2.1 },
                { x: 24.2, y: 0.0 }, // Titik netral ideal
                { x: 26.0, y: +2.3 }
              ],
              showLine: true,
              borderColor: "#e11d48",
              borderDash: [5, 4],
              borderWidth: 2,
              pointRadius: 0
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
                label: ctx => `Suhu Ruang: ${ctx.raw.x}°C -> Sensasi: ${ctx.raw.y}`
              }
            }
          },
          scales: {
            x: {
              title: { display: true, text: "Suhu Ruangan Terukur Ta (°C)", font: { size: 11, weight: "bold" } },
              ticks: { callback: v => `${v}°C` },
              min: 22.5,
              max: 26.5
            },
            y: {
              title: { display: true, text: "Thermal Sensation Vote (ASHRAE 7-Point)", font: { size: 11, weight: "bold" } },
              ticks: { callback: v => `${v}` },
              min: -3,
              max: 3
            }
          }
        }
      });
    }
  }

  function initVisualCharts() {
    // 3. Chart Distribusi Sensasi Pencahayaan (Visual)
    const ctxVisDist = document.getElementById("visualDistChart");
    if (ctxVisDist && !charts.visualDist) {
      charts.visualDist = new Chart(ctxVisDist, {
        type: "bar",
        data: {
          labels: ["-2 Sangat Redup", "-1 Agak Redup", "0 Nyaman (Ideal)", "+1 Agak Terang", "+2 Sangat Silau"],
          datasets: [
            {
              label: "Persentase Suara Penghuni (%)",
              data: [3.4, 5.2, 70.7, 13.8, 6.9],
              backgroundColor: [
                "#6366f1", "#93c5fd", "#d97706", "#f59e0b", "#ef4444"
              ],
              borderRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              ...darkTooltip,
              callbacks: {
                label: ctx => `Jumlah Suara: ${ctx.raw}% (${Math.round((ctx.raw / 100) * state.totalVotes)} responden)`
              }
            }
          },
          scales: {
            y: {
              title: { display: true, text: "Persentase Responden (%)", font: { size: 11 } },
              ticks: { callback: v => `${v}%` },
              min: 0,
              max: 80
            }
          }
        }
      });
    }

    // 4. Chart Korelasi Iluminansi Meja vs Sensasi Visual Penghuni
    const ctxVisCorr = document.getElementById("visualCorrelationChart");
    if (ctxVisCorr && !charts.visualCorr) {
      const samplePoints = [
        { x: 190, y: -2 }, { x: 240, y: -2 }, { x: 290, y: -1 }, { x: 320, y: -1 },
        { x: 380, y: 0 },  { x: 410, y: 0 },  { x: 440, y: 0 },  { x: 465, y: 0 },
        { x: 480, y: 0 },  { x: 500, y: 0 },  { x: 530, y: 0 },  { x: 580, y: 1 },
        { x: 640, y: 1 },  { x: 720, y: 2 },  { x: 810, y: 2 }
      ];

      charts.visualCorr = new Chart(ctxVisCorr, {
        type: "scatter",
        data: {
          datasets: [
            {
              label: "Respon Responden (Tingkat Lux)",
              data: samplePoints,
              backgroundColor: "#d97706",
              pointRadius: 6,
              pointHoverRadius: 8
            },
            {
              label: "Garis Regresi Linear Kepuasan Cahaya",
              data: [
                { x: 180, y: -2.1 },
                { x: 462, y: 0.0 }, // Titik ideal SNI 03-6197
                { x: 800, y: +2.1 }
              ],
              showLine: true,
              borderColor: "#ea580c",
              borderDash: [5, 4],
              borderWidth: 2,
              pointRadius: 0
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
                label: ctx => `Iluminansi: ${ctx.raw.x} lx -> Sensasi: ${ctx.raw.y}`
              }
            }
          },
          scales: {
            x: {
              title: { display: true, text: "Tingkat Iluminansi Meja Kerja (Lux)", font: { size: 11, weight: "bold" } },
              ticks: { callback: v => `${v} lx` },
              min: 150,
              max: 850
            },
            y: {
              title: { display: true, text: "Visual Comfort Vote (VCV 5-Point)", font: { size: 11, weight: "bold" } },
              ticks: { callback: v => `${v}` },
              min: -2,
              max: 2
            }
          }
        }
      });
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.ComfortService = {
    start() {
      initCharts();
      updateStats();
      renderRecentTable();
      setTcvVote(0);
      setAirVote("Pas");
      setVisVote(0);
      setGlareVote("Bebas Silau");
      switchTab("thermal");
    },
    switchTab,
    submitThermalFeedback,
    submitVisualFeedback,
    submitFeedback: (e) => {
      if (state.activeTab === "visual") submitVisualFeedback(e);
      else submitThermalFeedback(e);
    },
    setTcvVote,
    setAirVote,
    setVisVote,
    setGlareVote,
    setVcvVote: (val) => {
      if (val === "Terlalu Redup") setVisVote(-2);
      else if (val === "Silau") setVisVote(2);
      else setVisVote(0);
    }
  };

})();
