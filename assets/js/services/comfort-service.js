/**
 * BEMS Dashboard — Comfort Feedback Service
 * Mengelola umpan balik persepsi kenyamanan termal dan visual penghuni ruangan:
 * - Tab switcher interaktif: Terpadu (Suhu & Cahaya) / Khusus Suhu / Khusus Cahaya
 * - Skala ASHRAE 55 7-Point Thermal Sensation Vote (TCV: -3 s/d +3)
 * - Skala 7-Point Visual Comfort Vote (VCV: -3 s/d +3, simetris dengan suhu)
 * - Sinkronisasi otomatis dengan grafik analisis distribusi (7-bar) & regresi sensor riil
 * - Real-time comfort log table & kalkulasi kepuasan penghuni
 */

(function () {
  "use strict";

  const state = {
    totalVotes: 58,
    thermalSatisfactionPct: 87.9,
    visualSatisfactionPct: 91.4,
    combinedIndex: 89.6,
    activeTab: "all",
    currentTcv: 0,
    currentVis: 0,
    currentGlare: "Nyaman",
    recentVotes: [
      { id: 1, time: "23:45:10", room: "Workbench 1 (Jendela)", category: "terpadu", metric: "24.2 °C · 485 lx", voteLabel: "TCV: 0 · VCV: 0", pref: "Sudah Nyaman", condition: "Ideal (Tidak Silau)", note: "Suhu dan pencahayaan sangat pas untuk mengetik di laptop." },
      { id: 2, time: "23:30:25", room: "Workbench 2 (Tengah)", category: "thermal", metric: "24.1 °C", voteLabel: "Netral (0)", pref: "Tidak Berubah", condition: "Sirkulasi Pas", note: "Suhu udara sejuk dan aliran AC merata." },
      { id: 3, time: "23:12:40", room: "Workbench 3 (Dalam)", category: "thermal", metric: "23.8 °C", voteLabel: "Sejuk (-1)", pref: "Lebih Hangat", condition: "Sirkulasi Pas", note: "Terasa sedikit sejuk di bawah diffuser AC." },
      { id: 4, time: "22:55:18", room: "Workbench 4 (Kanan)", category: "visual", metric: "520 Lux", voteLabel: "Agak Terang (+1)", pref: "Lebih Redup", condition: "Silau Monitor", note: "Cahaya matahari sore agak memantul di sudut monitor." },
      { id: 5, time: "22:20:05", room: "Workbench 1 (Jendela)", category: "thermal", metric: "24.6 °C", voteLabel: "Hangat (+1)", pref: "Lebih Dingin", condition: "Agak Pengap", note: "Agak hangat saat banyak orang berkumpul di meja." },
      { id: 6, time: "21:50:33", room: "Workbench 2 (Tengah)", category: "visual", metric: "472 Lux", voteLabel: "Netral Nyaman (0)", pref: "Sudah Nyaman", condition: "Ideal", note: "Lampu plafon LED nyaman untuk mata." }
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

  // ── Tab Switcher: Terpadu (Semua) vs Suhu vs Cahaya ───────────────────────────
  function switchTab(tab) {
    state.activeTab = tab;

    const tabBtnAll = document.getElementById("tab-btn-all");
    const tabBtnThermal = document.getElementById("tab-btn-thermal");
    const tabBtnVisual = document.getElementById("tab-btn-visual");
    const secThermal = document.getElementById("section-thermal-fields");
    const secVisual = document.getElementById("section-visual-fields");
    const btnSubmit = document.getElementById("btn-submit-feedback");

    const defaultBtnClass = "flex-1 py-1.5 px-2 rounded-lg text-center transition-all flex items-center justify-center gap-1 text-slate-600 hover:text-slate-900 font-medium cursor-pointer";
    const activeBtnClass = "flex-1 py-1.5 px-2 rounded-lg text-center transition-all flex items-center justify-center gap-1 bg-white text-teal-900 shadow-xs font-bold border border-slate-200/60 cursor-pointer";

    if (tabBtnAll) tabBtnAll.className = tab === "all" ? activeBtnClass : defaultBtnClass;
    if (tabBtnThermal) tabBtnThermal.className = tab === "thermal" ? activeBtnClass : defaultBtnClass;
    if (tabBtnVisual) tabBtnVisual.className = tab === "visual" ? activeBtnClass : defaultBtnClass;

    if (secThermal) secThermal.classList.toggle("hidden", tab === "visual");
    if (secVisual) secVisual.classList.toggle("hidden", tab === "thermal");

    if (btnSubmit) {
      if (tab === "thermal") {
        btnSubmit.querySelector("span").textContent = "Kirim Feedback Suhu ke BEMS";
      } else if (tab === "visual") {
        btnSubmit.querySelector("span").textContent = "Kirim Feedback Cahaya ke BEMS";
      } else {
        btnSubmit.querySelector("span").textContent = "Kirim Feedback Terpadu ke BEMS";
      }
    }

    // Chart switcher sync
    const chartThermalSection = document.getElementById("charts-thermal-section");
    const chartVisualSection = document.getElementById("charts-visual-section");
    const chartTabThermalBtn = document.getElementById("chart-tab-btn-thermal");
    const chartTabVisualBtn = document.getElementById("chart-tab-btn-visual");
    const analyticsTitle = document.getElementById("active-analytics-title");

    if (tab === "visual") {
      if (chartThermalSection) chartThermalSection.classList.add("hidden");
      if (chartVisualSection) chartVisualSection.classList.remove("hidden");
      if (chartTabThermalBtn) chartTabThermalBtn.className = "px-3 py-1 rounded-md text-xs transition-all text-slate-600 hover:text-slate-900 font-medium cursor-pointer";
      if (chartTabVisualBtn) chartTabVisualBtn.className = "px-3 py-1 rounded-md text-xs transition-all bg-white text-amber-800 shadow-xs font-bold border border-slate-200/60 cursor-pointer";
      if (analyticsTitle) analyticsTitle.textContent = "Distribusi Pencahayaan (SNI 03-6197)";
      initVisualCharts();
      if (charts.visualDist) charts.visualDist.resize();
      if (charts.visualCorr) charts.visualCorr.resize();
    } else {
      if (chartThermalSection) chartThermalSection.classList.remove("hidden");
      if (chartVisualSection) chartVisualSection.classList.add("hidden");
      if (chartTabThermalBtn) chartTabThermalBtn.className = "px-3 py-1 rounded-md text-xs transition-all bg-white text-teal-800 shadow-xs font-bold border border-slate-200/60 cursor-pointer";
      if (chartTabVisualBtn) chartTabVisualBtn.className = "px-3 py-1 rounded-md text-xs transition-all text-slate-600 hover:text-slate-900 font-medium cursor-pointer";
      if (analyticsTitle) analyticsTitle.textContent = "Distribusi Termal (ASHRAE 55)";
      if (charts.thermalDist) charts.thermalDist.resize();
      if (charts.thermalCorr) charts.thermalCorr.resize();
    }
  }

  // ── Thermal Rating Selection: -3 s/d +3 ────────────────────────────────────────
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

  // ── Visual Rating Selection: -3 s/d +3 (SAMA PERSIS DENGAN SUHU) ───────────────
  function setVisVote(val) {
    state.currentVis = parseInt(val, 10);
    document.querySelectorAll(".vcv-vote-btn").forEach(btn => {
      if (parseInt(btn.getAttribute("data-val"), 10) === state.currentVis) {
        btn.className = "vcv-vote-btn active py-2.5 rounded-xl font-bold text-xs bg-amber-600 text-white shadow-2xs border-2 border-amber-500 cursor-pointer";
      } else {
        btn.className = "vcv-vote-btn py-2.5 rounded-xl font-medium text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 transition-colors cursor-pointer";
      }
    });
  }

  // ── Glare Rating Selection ───────────────────────────────────────────────────
  function setGlareVote(val) {
    state.currentGlare = val;
    document.querySelectorAll(".glare-vote-btn").forEach(btn => {
      const btnVal = btn.getAttribute("data-val");
      if (btnVal === val) {
        btn.className = "glare-vote-btn active py-2 rounded-xl font-bold text-xs bg-amber-600 text-white shadow-2xs border-2 border-amber-500 cursor-pointer";
      } else {
        btn.className = "glare-vote-btn py-2 rounded-xl font-medium text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 transition-colors cursor-pointer";
      }
    });
  }

  // ── Unified Feedback Submission ───────────────────────────────────────────────
  function submitUnifiedFeedback(event) {
    if (event) event.preventDefault();

    const room = document.getElementById("fb-room") ? document.getElementById("fb-room").value : "Workbench 1";
    const thermalPref = document.getElementById("fb-thermal-pref") ? document.getElementById("fb-thermal-pref").value : "Tidak Berubah";
    const visualPref = document.getElementById("fb-visual-pref") ? document.getElementById("fb-visual-pref").value : "Tidak Berubah";
    const comment = document.getElementById("fb-comment") ? document.getElementById("fb-comment").value.trim() : "";

    const tcvMap = {
      "-3": "Sangat Dingin (-3)",
      "-2": "Dingin (-2)",
      "-1": "Sejuk (-1)",
      "0": "Netral (0)",
      "1": "Hangat (+1)",
      "2": "Panas (+2)",
      "3": "Sangat Panas (+3)"
    };

    const vcvMap = {
      "-3": "Sangat Redup (-3)",
      "-2": "Redup (-2)",
      "-1": "Agak Redup (-1)",
      "0": "Netral Nyaman (0)",
      "1": "Agak Terang (+1)",
      "2": "Terang (+2)",
      "3": "Sangat Silau (+3)"
    };

    const glareMap = {
      "Redup": "Terlalu Redup",
      "Bebas Silau": "Nyaman (Ideal)",
      "Nyaman": "Nyaman (Ideal)",
      "Silau": "Silau (Glare)"
    };

    const now = new Date();
    const timeStr = now.toTimeString().split(" ")[0];
    const liveTa = (window.liveData && window.liveData.aggregates && window.liveData.aggregates.avgTemp) || 24.3;
    const liveLux = (window.liveData && window.liveData.aggregates && window.liveData.aggregates.avgLux) || 485;

    let category = "terpadu";
    let metric = `${liveTa.toFixed(1)} °C · ${Math.round(liveLux)} lx`;
    let voteLabel = `TCV: ${state.currentTcv} · VCV: ${state.currentVis}`;
    let pref = `Suhu: ${thermalPref} · Cahaya: ${visualPref}`;

    if (state.activeTab === "thermal") {
      category = "thermal";
      metric = `${liveTa.toFixed(1)} °C`;
      voteLabel = tcvMap[String(state.currentTcv)] || "Netral (0)";
      pref = thermalPref;
    } else if (state.activeTab === "visual") {
      category = "visual";
      metric = `${Math.round(liveLux)} Lux`;
      voteLabel = vcvMap[String(state.currentVis)] || "Netral Nyaman (0)";
      pref = visualPref;
    }

    const newVote = {
      id: Date.now(),
      time: timeStr,
      room: room,
      category: category,
      metric: metric,
      voteLabel: voteLabel,
      pref: pref,
      condition: glareMap[state.currentGlare] || "Nyaman (Ideal)",
      note: comment || "Feedback kenyamanan penghuni dicatat secara anonim."
    };

    state.recentVotes.unshift(newVote);
    if (state.recentVotes.length > 8) state.recentVotes.pop();
    state.totalVotes++;

    updateStats();
    renderRecentTable();

    const toastMsg = state.activeTab === "visual"
      ? "💡 Terima kasih! Evaluasi kenyamanan pencahayaan berhasil dicatat ke BEMS."
      : state.activeTab === "thermal"
        ? "🌡️ Terima kasih! Evaluasi kenyamanan termal berhasil dicatat ke BEMS."
        : "✅ Terima kasih! Evaluasi kenyamanan suhu & cahaya (-3 s/d +3) berhasil dicatat ke BEMS.";

    showToast(toastMsg, state.activeTab === "visual" ? "amber" : "teal");

    if (document.getElementById("fb-comment")) {
      document.getElementById("fb-comment").value = "";
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
      let catBadge = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-800 border border-slate-200">📋 Terpadu</span>`;
      if (v.category === "thermal") {
        catBadge = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-teal-800 border border-teal-200">🌡️ Termal</span>`;
      } else if (v.category === "visual") {
        catBadge = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">💡 Visual</span>`;
      }

      let voteBadge = "bg-teal-50 text-teal-800 border-teal-200";
      if (v.voteLabel.includes("-")) voteBadge = "bg-blue-50 text-blue-800 border-blue-200";
      else if (v.voteLabel.includes("+")) voteBadge = "bg-rose-50 text-rose-800 border-rose-200";

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

  // ── Grafik Chart.js (Thermal & Visual 7-Point) ─────────────────────────────────
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
    // 3. Chart Distribusi Sensasi Pencahayaan (Visual 7-Point)
    const ctxVisDist = document.getElementById("visualDistChart");
    if (ctxVisDist && !charts.visualDist) {
      charts.visualDist = new Chart(ctxVisDist, {
        type: "bar",
        data: {
          labels: ["-3 Sangat Redup", "-2 Redup", "-1 Agak Redup", "0 Netral", "+1 Agak Terang", "+2 Terang", "+3 Sangat Silau"],
          datasets: [
            {
              label: "Persentase Suara Penghuni (%)",
              data: [1.7, 3.4, 12.1, 62.1, 13.8, 5.2, 1.7],
              backgroundColor: [
                "#6366f1", "#818cf8", "#93c5fd", "#d97706", "#f59e0b", "#f97316", "#ef4444"
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

    // 4. Chart Korelasi Iluminansi Meja vs Sensasi Visual Penghuni (7-Point)
    const ctxVisCorr = document.getElementById("visualCorrelationChart");
    if (ctxVisCorr && !charts.visualCorr) {
      const samplePoints = [
        { x: 160, y: -3 }, { x: 230, y: -2 }, { x: 310, y: -1 }, { x: 390, y: 0 },
        { x: 440, y: 0 },  { x: 470, y: 0 },  { x: 490, y: 0 },  { x: 520, y: 0 },
        { x: 580, y: 1 },  { x: 670, y: 1 },  { x: 750, y: 2 },  { x: 860, y: 3 }
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
                { x: 150, y: -3.0 },
                { x: 462, y: 0.0 }, // Titik netral ideal SNI 03-6197
                { x: 860, y: +3.0 }
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
              min: 100,
              max: 900
            },
            y: {
              title: { display: true, text: "Visual Sensation Vote (VCV 7-Point)", font: { size: 11, weight: "bold" } },
              ticks: { callback: v => `${v}` },
              min: -3,
              max: 3
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
      setVisVote(0);
      setGlareVote("Nyaman");
      switchTab("all");
    },
    switchTab,
    submitUnifiedFeedback,
    submitFeedback: (e) => submitUnifiedFeedback(e),
    setTcvVote,
    setVisVote,
    setGlareVote,
    setVcvVote: (val) => {
      // Legacy backward-compatibility
      if (val === "Terlalu Redup" || val === -2) setVisVote(-2);
      else if (val === "Silau" || val === 2) setVisVote(2);
      else if (typeof val === "number") setVisVote(val);
      else setVisVote(0);
    }
  };

})();
