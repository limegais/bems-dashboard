/**
 * BEMS Dashboard — Comfort Feedback Service
 * Mengelola umpan balik persepsi kenyamanan termal dan visual penghuni ruangan:
 * - Thermal Sensation Vote (TSV / TCV) skala ASHRAE 7-Point (-3 s/d +3)
 * - Visual Comfort Vote (VCV) redup/nyaman/silau
 * - Preferensi termal penghuni & korelasi dengan telemetri riil sensor SHT31 & Lux
 */

(function () {
  "use strict";

  const state = {
    totalVotes: 58,
    thermalSatisfactionPct: 87.9,
    visualSatisfactionPct: 91.4,
    combinedIndex: 89.6,
    activeZone: "all",
    recentVotes: [
      { id: 1, time: "23:45:10", room: "Workbench 1 (Window)", tcv: 0, tcvLabel: "Netral (0)", pref: "Tidak Berubah", visual: "Nyaman (485 lx)", ta: 24.2, note: "Suhu dan cahaya sangat pas untuk mengetik." },
      { id: 2, time: "23:30:25", room: "Workbench 2 (Center)", tcv: 0, tcvLabel: "Netral (0)", pref: "Tidak Berubah", visual: "Nyaman (478 lx)", ta: 24.1, note: "Pencahayaan rata dan tidak silau." },
      { id: 3, time: "23:12:40", room: "Workbench 3 (Inner)", tcv: -1, tcvLabel: "Sejuk (-1)", pref: "Lebih Hangat", visual: "Nyaman (460 lx)", ta: 23.8, note: "Terasa sedikit sejuk di bawah diffuser AC." },
      { id: 4, time: "22:55:18", room: "Workbench 4 (Right)", tcv: +1, tcvLabel: "Hangat (+1)", pref: "Lebih Dingin", visual: "Nyaman (450 lx)", ta: 24.6, note: "Agak hangat saat banyak orang berkumpul." },
      { id: 5, time: "22:20:05", room: "Workbench 1 (Window)", tcv: 0, tcvLabel: "Netral (0)", pref: "Tidak Berubah", visual: "Silau (520 lx)", ta: 24.3, note: "Cahaya matahari sore agak silau di layar." }
    ]
  };

  const charts = {
    distribution: null,
    correlation: null
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

  // ── 1. Submit New Anonymous Comfort Feedback ──────────────────────────────────
  function submitFeedback(event) {
    if (event) event.preventDefault();

    const room = document.getElementById("fb-room") ? document.getElementById("fb-room").value : "Workbench 1";
    const tcvBtn = document.querySelector(".tcv-vote-btn.active");
    const tcv = tcvBtn ? parseInt(tcvBtn.getAttribute("data-val"), 10) : 0;
    const pref = document.getElementById("fb-pref") ? document.getElementById("fb-pref").value : "Tidak Berubah";
    const visualBtn = document.querySelector(".vcv-vote-btn.active");
    const visual = visualBtn ? visualBtn.getAttribute("data-val") : "Nyaman";
    const comment = document.getElementById("fb-comment") ? document.getElementById("fb-comment").value.trim() : "";

    const tcvMap = {
      "-3": "Cold (-3)",
      "-2": "Cool (-2)",
      "-1": "Sejuk (-1)",
      "0": "Netral Nyaman (0)",
      "+1": "Warm (+1)",
      "+2": "Hot (+2)",
      "+3": "Very Hot (+3)"
    };

    const now = new Date();
    const timeStr = now.toTimeString().split(" ")[0];
    const liveTa = (window.liveData && window.liveData.aggregates && window.liveData.aggregates.avgTemp) || 24.3;

    const newVote = {
      id: state.recentVotes.length + 1,
      time: timeStr,
      room: room,
      tcv: tcv,
      tcvLabel: tcvMap[String(tcv)] || "Netral (0)",
      pref: pref,
      visual: visual,
      ta: parseFloat(liveTa.toFixed(1)),
      note: comment || "Feedback dicatat secara anonim."
    };

    state.recentVotes.unshift(newVote);
    if (state.recentVotes.length > 8) state.recentVotes.pop();
    state.totalVotes++;

    updateStats();
    renderRecentTable();
    updateCharts();

    const toast = document.createElement("div");
    toast.className = "fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-lg text-xs font-semibold text-white bg-teal-800 border border-teal-600 transition-all flex items-center gap-2";
    toast.innerHTML = `<svg class="w-4 h-4 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Terima kasih! Feedback kenyamanan termal &amp; visual Anda berhasil dicatat secara anonim.`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);

    if (document.getElementById("fb-comment")) {
      document.getElementById("fb-comment").value = "";
    }
  }

  function setTcvVote(val) {
    document.querySelectorAll(".tcv-vote-btn").forEach(btn => {
      if (parseInt(btn.getAttribute("data-val"), 10) === val) {
        btn.className = "tcv-vote-btn active py-2.5 rounded-xl font-bold text-xs bg-teal-800 text-white shadow-2xs border-2 border-teal-600";
      } else {
        btn.className = "tcv-vote-btn py-2.5 rounded-xl font-medium text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 transition-colors";
      }
    });
  }

  function setVcvVote(val) {
    document.querySelectorAll(".vcv-vote-btn").forEach(btn => {
      if (btn.getAttribute("data-val") === val) {
        btn.className = "vcv-vote-btn active px-4 py-2 rounded-xl font-bold text-xs bg-amber-700 text-white shadow-2xs border-2 border-amber-600";
      } else {
        btn.className = "vcv-vote-btn px-4 py-2 rounded-xl font-medium text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 transition-colors";
      }
    });
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
      let tcvBadge = "bg-teal-50 text-teal-800 border-teal-200";
      if (v.tcv < 0) tcvBadge = "bg-blue-50 text-blue-800 border-blue-200";
      if (v.tcv > 0) tcvBadge = "bg-rose-50 text-rose-800 border-rose-200";

      return `
        <tr class="hover:bg-slate-50/80 transition-colors">
          <td class="py-2.5 px-3 font-mono text-slate-500">${v.time}</td>
          <td class="py-2.5 px-3 font-bold text-slate-800">${v.room}</td>
          <td class="py-2.5 px-3 font-mono text-slate-700 font-semibold">${v.ta} °C</td>
          <td class="py-2.5 px-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold border ${tcvBadge}">
              ${v.tcvLabel}
            </span>
          </td>
          <td class="py-2.5 px-3 font-medium text-slate-600">${v.pref}</td>
          <td class="py-2.5 px-3 font-medium text-slate-800">${v.visual}</td>
          <td class="py-2.5 px-3 text-slate-500 text-[11px] max-w-xs truncate">${v.note}</td>
        </tr>
      `;
    }).join("");
  }

  // ── 2. Inisialisasi Grafik Chart.js ───────────────────────────────────────────
  function initCharts() {
    // 1. Chart Distribusi Suara ASHRAE 7-Point
    const ctxDist = document.getElementById("comfortDistChart");
    if (ctxDist && !charts.distribution) {
      charts.distribution = new Chart(ctxDist, {
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

    // 2. Chart Korelasi Suhu Aktual vs Sensasi Penghuni
    const ctxCorr = document.getElementById("comfortCorrelationChart");
    if (ctxCorr && !charts.correlation) {
      // Scatter titik responden suhu vs vote
      const samplePoints = [
        { x: 23.2, y: -2 }, { x: 23.5, y: -1 }, { x: 23.8, y: -1 }, { x: 23.9, y: 0 },
        { x: 24.0, y: 0 },  { x: 24.1, y: 0 },  { x: 24.2, y: 0 },  { x: 24.3, y: 0 },
        { x: 24.4, y: 0 },  { x: 24.5, y: 0 },  { x: 24.6, y: 1 },  { x: 24.8, y: 1 },
        { x: 25.1, y: 1 },  { x: 25.4, y: 2 },  { x: 25.8, y: 2 }
      ];

      charts.correlation = new Chart(ctxCorr, {
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

  function updateCharts() {
    if (charts.distribution) charts.distribution.update();
    if (charts.correlation) charts.correlation.update();
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.ComfortService = {
    start() {
      initCharts();
      updateStats();
      renderRecentTable();
      setTcvVote(0);
      setVcvVote("Nyaman");
    },
    submitFeedback,
    setTcvVote,
    setVcvVote
  };

})();
