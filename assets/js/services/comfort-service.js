/**
 * BEMS Living Lab — Occupant Comfort Feedback Service
 * ----------------------------------------------------------------------------
 * 1. Skala Evaluasi Kenyamanan Termal (Suhu):
 *    - Q1: Thermal Sensation Vote (TSV) - 7-point scale (-3 s/d +3)
 *    - Q2: Thermal Preference Vote (TPV) - 3-point scale (-1 s/d +1)
 *    - Q3: Thermal Satisfaction - 7-point scale (-3 s/d +3)
 * 2. Skala Evaluasi Kenyamanan Visual (Cahaya):
 *    - Q1: Lighting Sensation Vote (LSV) - 7-point scale (-3 s/d +3)
 *    - Q2: Lighting Preference Vote (LPV) - 3-point scale (-1 s/d +1)
 *    - Q3: Visual Satisfaction Vote (VSaV) - 7-point scale (-3 s/d +3)
 * 3. Role-Based Access Control:
 *    - GUEST / OCCUPANT : Hanya dapat mengisi form dan mengirim masukan (Hasil tersembunyi).
 *    - ADMIN            : Memiliki akses penuh melihat KPI, grafik analisis, log data, & ekspor CSV.
 */

(function () {
  "use strict";

  const TSV_MAP = {
    "-3": "Cold (-3)",
    "-2": "Cool (-2)",
    "-1": "Slightly Cool (-1)",
    "0": "Neutral (0)",
    "1": "Slightly Warm (+1)",
    "2": "Warm (+2)",
    "3": "Hot (+3)"
  };

  const TPV_MAP = {
    "-1": "Cooler (-1)",
    "0": "No Change (0)",
    "1": "Warmer (+1)"
  };

  const THERMAL_SAT_MAP = {
    "-3": "Very Dissatisfied (-3)",
    "-2": "Dissatisfied (-2)",
    "-1": "Slightly Dissatisfied (-1)",
    "0": "Neutral (0)",
    "1": "Slightly Satisfied (+1)",
    "2": "Satisfied (+2)",
    "3": "Very Satisfied (+3)"
  };

  const LSV_MAP = {
    "-3": "Very dark (-3)",
    "-2": "Dark (-2)",
    "-1": "Slightly dark (-1)",
    "0": "Neutral (0)",
    "1": "Slightly bright (+1)",
    "2": "Bright (+2)",
    "3": "Very bright (+3)"
  };

  const LPV_MAP = {
    "-1": "Darker (-1)",
    "0": "No change (0)",
    "1": "Brighter (+1)"
  };

  const VSAV_MAP = {
    "-3": "Very dissatisfied (-3)",
    "-2": "Dissatisfied (-2)",
    "-1": "Slightly dissatisfied (-1)",
    "0": "Neutral (0)",
    "1": "Slightly satisfied (+1)",
    "2": "Satisfied (+2)",
    "3": "Very satisfied (+3)"
  };

  const state = {
    isRealAdmin: false,
    adminPreviewGuest: false,
    activeTab: "all", // "all" | "thermal" | "visual"
    activeAnalyticsTab: "thermal",

    // State Form Suhu (Thermal)
    thermal: {
      tsv: null,
      tpv: null,
      sat: null,
      comment: ""
    },

    // State Form Cahaya (Visual)
    visual: {
      lsv: null,
      lpv: null,
      vsav: null,
      comment: ""
    },

    // KPI & Statistik Agregat
    totalVotes: 58,
    thermalSatisfactionPct: 87.9,
    visualSatisfactionPct: 91.4,
    combinedIndex: 89.6,

    recentVotes: [
      { id: 1, time: "09:45:10", room: "Workbench 1 (Jendela)", category: "thermal", metric: "24.2 °C", tsv: "0 (Neutral)", tpv: "0 (No Change)", sat: "+1 (Slightly Satisfied)", note: "Suhu udara sejuk dan aliran AC merata." },
      { id: 2, time: "09:30:25", room: "Workbench 2 (Tengah)", category: "visual", metric: "482 Lux", tsv: "0 (Neutral)", tpv: "0 (No change)", sat: "+2 (Satisfied)", note: "Pencahayaan LED meja sangat pas untuk kerja di laptop." },
      { id: 3, time: "09:12:40", room: "Workbench 3 (Dalam)", category: "thermal", metric: "23.8 °C", tsv: "-1 (Slightly Cool)", tpv: "+1 (Warmer)", sat: "0 (Neutral)", note: "Terasa sedikit sejuk di bawah diffuser AC." },
      { id: 4, time: "08:55:18", room: "Workbench 4 (Kanan)", category: "visual", metric: "520 Lux", tsv: "+1 (Slightly bright)", tpv: "-1 (Darker)", sat: "0 (Neutral)", note: "Cahaya pagi agak memantul di sudut monitor." },
      { id: 5, time: "08:20:05", room: "Workbench 1 (Jendela)", category: "thermal", metric: "24.6 °C", tsv: "+1 (Slightly Warm)", tpv: "-1 (Cooler)", sat: "-1 (Slightly Dissatisfied)", note: "Agak hangat saat banyak orang berkumpul di meja." },
      { id: 6, time: "07:50:33", room: "Workbench 2 (Tengah)", category: "visual", metric: "465 Lux", tsv: "0 (Neutral)", tpv: "0 (No change)", sat: "+2 (Satisfied)", note: "Penerangan sangat ramah untuk mata." }
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

  // ── Helper Cek Role Administrator ──────────────────────────────────────────
  function checkIsAdmin() {
    if (typeof Session === "undefined") return false;
    const session = Session.get();
    if (!session) return false;
    const r = (session.role || "").toLowerCase();
    const u = (session.user || "").toLowerCase();
    return r === "admin" || r === "superadmin" || u === "admin" || u === "superadmin";
  }

  function getEffectiveRole() {
    if (!state.isRealAdmin) return "guest";
    return state.adminPreviewGuest ? "guest" : "admin";
  }

  // ── Penyesuaian Tampilan Berdasarkan Hak Akses ─────────────────────────────
  function applyRoleVisibility() {
    const effectiveRole = getEffectiveRole();
    const isAdmin = effectiveRole === "admin";

    // Bagian Hasil yang HANYA BISA DILIHAT ADMIN:
    const kpiSection = document.getElementById("kpi-section");
    const analyticsSection = document.getElementById("analytics-section");
    const logSection = document.getElementById("recent-log-section");
    const exportBtn = document.getElementById("btn-feedback-export");
    const resultsLockedNotice = document.getElementById("guest-results-locked");
    const guestBanner = document.getElementById("guest-info-banner");
    const adminToggle = document.getElementById("admin-view-toggle");
    const formsCol = document.getElementById("forms-column");

    if (kpiSection) kpiSection.classList.toggle("hidden", !isAdmin);
    if (analyticsSection) analyticsSection.classList.toggle("hidden", !isAdmin);
    if (logSection) logSection.classList.toggle("hidden", !isAdmin);
    if (exportBtn) exportBtn.classList.toggle("hidden", !isAdmin);
    if (resultsLockedNotice) resultsLockedNotice.classList.toggle("hidden", isAdmin);
    if (guestBanner) guestBanner.classList.toggle("hidden", isAdmin);

    // Form column styling: selalu lebar & proporsional (max-w-4xl) agar 7 tombol memiliki ruang leluasa
    if (formsCol) {
      formsCol.className = "max-w-4xl mx-auto w-full space-y-6 transition-all";
    }

    // Toggle admin preview switch
    if (adminToggle) {
      if (state.isRealAdmin) {
        adminToggle.classList.remove("hidden");
        const btnAdmin = document.getElementById("btn-view-admin");
        const btnGuest = document.getElementById("btn-view-guest");
        if (btnAdmin && btnGuest) {
          if (isAdmin) {
            btnAdmin.className = "px-3 py-1 rounded-md text-xs font-bold bg-teal-800 text-white shadow-xs cursor-pointer";
            btnGuest.className = "px-3 py-1 rounded-md text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer";
          } else {
            btnAdmin.className = "px-3 py-1 rounded-md text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer";
            btnGuest.className = "px-3 py-1 rounded-md text-xs font-bold bg-amber-600 text-white shadow-xs cursor-pointer";
          }
        }
      } else {
        adminToggle.classList.add("hidden");
      }
    }

    // Inisialisasi atau resize chart jika admin
    if (isAdmin) {
      initCharts();
      if (state.activeAnalyticsTab === "visual") {
        initVisualCharts();
      }
    }
  }

  function toggleAdminPreview(mode) {
    if (!state.isRealAdmin) return;
    state.adminPreviewGuest = (mode === "guest");
    applyRoleVisibility();
    showToast(
      state.adminPreviewGuest
        ? "👤 Beralih ke Pratinjau Tampilan Guest (Hasil Disembunyikan)"
        : "👑 Beralih ke Mode Administrator (Akses Penuh Hasil & Analisis)",
      state.adminPreviewGuest ? "amber" : "teal"
    );
  }

  // ── Switcher Tab Formulir (Terpadu / Suhu / Cahaya) ────────────────────────
  function switchTab(tab) {
    state.activeTab = tab;

    const tabBtnAll = document.getElementById("tab-btn-all");
    const tabBtnThermal = document.getElementById("tab-btn-thermal");
    const tabBtnVisual = document.getElementById("tab-btn-visual");
    const secThermal = document.getElementById("thermal-rating-card");
    const secVisual = document.getElementById("visual-rating-card");

    const defaultBtnClass = "flex-1 py-1.5 px-2 rounded-lg text-center transition-all flex items-center justify-center gap-1.5 text-slate-600 hover:text-slate-900 font-medium cursor-pointer";
    const activeBtnClass = "flex-1 py-1.5 px-2 rounded-lg text-center transition-all flex items-center justify-center gap-1.5 bg-white text-blue-900 shadow-xs font-bold border border-slate-200/80 cursor-pointer";

    if (tabBtnAll) tabBtnAll.className = tab === "all" ? activeBtnClass : defaultBtnClass;
    if (tabBtnThermal) tabBtnThermal.className = tab === "thermal" ? activeBtnClass : defaultBtnClass;
    if (tabBtnVisual) tabBtnVisual.className = tab === "visual" ? activeBtnClass : defaultBtnClass;

    if (secThermal) secThermal.classList.toggle("hidden", tab === "visual");
    if (secVisual) secVisual.classList.toggle("hidden", tab === "thermal");

    // Sinkronkan tab grafik jika di mode admin
    if (getEffectiveRole() === "admin") {
      switchAnalyticsTab(tab === "visual" ? "visual" : "thermal");
    }
  }

  // ── Switcher Tab Grafik Analisis (Khusus Admin) ────────────────────────────
  function switchAnalyticsTab(tab) {
    state.activeAnalyticsTab = tab;
    const chartThermalSec = document.getElementById("charts-thermal-section");
    const chartVisualSec = document.getElementById("charts-visual-section");
    const chartTabThermalBtn = document.getElementById("chart-tab-btn-thermal");
    const chartTabVisualBtn = document.getElementById("chart-tab-btn-visual");
    const analyticsTitle = document.getElementById("active-analytics-title");

    if (tab === "visual") {
      if (chartThermalSec) chartThermalSec.classList.add("hidden");
      if (chartVisualSec) chartVisualSec.classList.remove("hidden");
      if (chartTabThermalBtn) chartTabThermalBtn.className = "px-3 py-1 rounded-md text-xs transition-all text-slate-600 hover:text-slate-900 font-medium cursor-pointer";
      if (chartTabVisualBtn) chartTabVisualBtn.className = "px-3 py-1 rounded-md text-xs transition-all bg-white text-sky-800 shadow-xs font-bold border border-slate-200/60 cursor-pointer";
      if (analyticsTitle) analyticsTitle.textContent = "Distribusi & Korelasi Pencahayaan (SNI 03-6197)";
      initVisualCharts();
      if (charts.visualDist) charts.visualDist.resize();
      if (charts.visualCorr) charts.visualCorr.resize();
    } else {
      if (chartThermalSec) chartThermalSec.classList.remove("hidden");
      if (chartVisualSec) chartVisualSec.classList.add("hidden");
      if (chartTabThermalBtn) chartTabThermalBtn.className = "px-3 py-1 rounded-md text-xs transition-all bg-white text-blue-900 shadow-xs font-bold border border-slate-200/60 cursor-pointer";
      if (chartTabVisualBtn) chartTabVisualBtn.className = "px-3 py-1 rounded-md text-xs transition-all text-slate-600 hover:text-slate-900 font-medium cursor-pointer";
      if (analyticsTitle) analyticsTitle.textContent = "Distribusi & Korelasi Termal (ASHRAE 55)";
      initCharts();
      if (charts.thermalDist) charts.thermalDist.resize();
      if (charts.thermalCorr) charts.thermalCorr.resize();
    }
  }

  // ── 3 Pertanyaan Evaluasi Kenyamanan Termal (Suhu) ─────────────────────────
  // Q1: Thermal Sensation Vote (TSV) -3 s/d +3
  function setThermalTsv(val) {
    state.thermal.tsv = parseInt(val, 10);
    document.querySelectorAll(".thermal-tsv-btn").forEach(btn => {
      const bVal = parseInt(btn.getAttribute("data-val"), 10);
      if (bVal === state.thermal.tsv) {
        btn.className = "thermal-tsv-btn active flex flex-col items-center justify-center py-2.5 sm:py-3.5 px-1 rounded-xl bg-blue-600 text-white font-bold border-2 border-blue-600 ring-2 ring-blue-300 shadow-sm cursor-pointer transition-all";
        btn.querySelector(".tsv-num").className = "tsv-num text-base sm:text-lg font-black text-white leading-tight";
        btn.querySelector(".tsv-lbl").className = "tsv-lbl text-[10px] sm:text-xs text-blue-100 font-semibold leading-tight mt-0.5";
      } else {
        btn.className = "thermal-tsv-btn flex flex-col items-center justify-center py-2.5 sm:py-3.5 px-1 rounded-xl bg-white text-slate-800 border border-slate-200/90 hover:border-blue-300 shadow-2xs cursor-pointer transition-all";
        btn.querySelector(".tsv-num").className = "tsv-num text-base sm:text-lg font-extrabold text-slate-800 leading-tight";
        btn.querySelector(".tsv-lbl").className = "tsv-lbl text-[10px] sm:text-xs text-slate-500 font-medium leading-tight mt-0.5";
      }
    });

    const statusEl = document.getElementById("tsv-status-text");
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-blue-700 font-bold not-italic">✓ Selected: ${TSV_MAP[String(val)]}</span>`;
    }
  }

  // Q2: Thermal Preference Vote (TPV) -1, 0, +1
  function setThermalTpv(val) {
    state.thermal.tpv = parseInt(val, 10);
    document.querySelectorAll(".thermal-tpv-btn").forEach(btn => {
      const bVal = parseInt(btn.getAttribute("data-val"), 10);
      if (bVal === state.thermal.tpv) {
        btn.className = "thermal-tpv-btn active flex flex-col items-center justify-center py-3 px-2 rounded-xl bg-blue-600 text-white font-bold border-2 border-blue-600 ring-2 ring-blue-300 shadow-sm cursor-pointer transition-all";
        btn.querySelector(".tpv-num").className = "tpv-num text-base sm:text-lg font-black text-white leading-tight";
        btn.querySelector(".tpv-lbl").className = "tpv-lbl text-xs text-blue-100 font-semibold leading-tight mt-0.5";
      } else {
        btn.className = "thermal-tpv-btn flex flex-col items-center justify-center py-3 px-2 rounded-xl bg-white text-slate-800 border border-slate-200/90 hover:border-blue-300 shadow-2xs cursor-pointer transition-all";
        btn.querySelector(".tpv-num").className = "tpv-num text-base sm:text-lg font-extrabold text-slate-800 leading-tight";
        btn.querySelector(".tpv-lbl").className = "tpv-lbl text-xs text-slate-500 font-medium leading-tight mt-0.5";
      }
    });

    const statusEl = document.getElementById("tpv-status-text");
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-blue-700 font-bold not-italic">✓ Selected: ${TPV_MAP[String(val)]}</span>`;
    }
  }

  // Q3: Thermal Satisfaction -3 s/d +3
  function setThermalSat(val) {
    state.thermal.sat = parseInt(val, 10);
    document.querySelectorAll(".thermal-sat-btn").forEach(btn => {
      const bVal = parseInt(btn.getAttribute("data-val"), 10);
      if (bVal === state.thermal.sat) {
        btn.className = "thermal-sat-btn active flex flex-col items-center justify-center py-2.5 sm:py-3.5 px-1 rounded-xl bg-blue-600 text-white font-bold border-2 border-blue-600 ring-2 ring-blue-300 shadow-sm cursor-pointer transition-all";
        btn.querySelector(".sat-num").className = "sat-num text-base sm:text-lg font-black text-white leading-tight";
        btn.querySelector(".sat-lbl").className = "sat-lbl text-[10px] sm:text-xs text-blue-100 font-semibold leading-tight mt-0.5";
      } else {
        btn.className = "thermal-sat-btn flex flex-col items-center justify-center py-2.5 sm:py-3.5 px-1 rounded-xl bg-white text-slate-800 border border-slate-200/90 hover:border-blue-300 shadow-2xs cursor-pointer transition-all";
        btn.querySelector(".sat-num").className = "sat-num text-base sm:text-lg font-extrabold text-slate-800 leading-tight";
        btn.querySelector(".sat-lbl").className = "sat-lbl text-[10px] sm:text-xs text-slate-500 font-medium leading-tight mt-0.5";
      }
    });

    const statusEl = document.getElementById("thermal-sat-status-text");
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-blue-700 font-bold not-italic">✓ Selected: ${THERMAL_SAT_MAP[String(val)]}</span>`;
    }
  }

  function resetThermalForm() {
    state.thermal.tsv = null;
    state.thermal.tpv = null;
    state.thermal.sat = null;
    state.thermal.comment = "";

    document.querySelectorAll(".thermal-tsv-btn").forEach(btn => {
      btn.className = "thermal-tsv-btn flex flex-col items-center justify-center py-2.5 sm:py-3.5 px-1 rounded-xl bg-white text-slate-800 border border-slate-200/90 hover:border-blue-300 shadow-2xs cursor-pointer transition-all";
      btn.querySelector(".tsv-num").className = "tsv-num text-base sm:text-lg font-extrabold text-slate-800 leading-tight";
      btn.querySelector(".tsv-lbl").className = "tsv-lbl text-[10px] sm:text-xs text-slate-500 font-medium leading-tight mt-0.5";
    });
    document.querySelectorAll(".thermal-tpv-btn").forEach(btn => {
      btn.className = "thermal-tpv-btn flex flex-col items-center justify-center py-3 px-2 rounded-xl bg-white text-slate-800 border border-slate-200/90 hover:border-blue-300 shadow-2xs cursor-pointer transition-all";
      btn.querySelector(".tpv-num").className = "tpv-num text-base sm:text-lg font-extrabold text-slate-800 leading-tight";
      btn.querySelector(".tpv-lbl").className = "tpv-lbl text-xs text-slate-500 font-medium leading-tight mt-0.5";
    });
    document.querySelectorAll(".thermal-sat-btn").forEach(btn => {
      btn.className = "thermal-sat-btn flex flex-col items-center justify-center py-2.5 sm:py-3.5 px-1 rounded-xl bg-white text-slate-800 border border-slate-200/90 hover:border-blue-300 shadow-2xs cursor-pointer transition-all";
      btn.querySelector(".sat-num").className = "sat-num text-base sm:text-lg font-extrabold text-slate-800 leading-tight";
      btn.querySelector(".sat-lbl").className = "sat-lbl text-[10px] sm:text-xs text-slate-500 font-medium leading-tight mt-0.5";
    });

    setEl("tsv-status-text", "— Not selected —");
    setEl("tpv-status-text", "— Not selected —");
    setEl("thermal-sat-status-text", "— Not selected —");

    const commentInput = document.getElementById("thermal-comment");
    if (commentInput) commentInput.value = "";

    showToast("Form evaluasi termal telah di-reset.", "blue");
  }

  // ── 3 Pertanyaan Evaluasi Kenyamanan Visual (Cahaya) ────────────────────────
  // Q1: Lighting Sensation Vote (LSV) -3 s/d +3
  function setVisualLsv(val) {
    state.visual.lsv = parseInt(val, 10);
    document.querySelectorAll(".visual-lsv-btn").forEach(btn => {
      const bVal = parseInt(btn.getAttribute("data-val"), 10);
      if (bVal === state.visual.lsv) {
        btn.className = "visual-lsv-btn active flex flex-col items-center justify-center py-2.5 sm:py-3.5 px-1 rounded-xl bg-sky-600 text-white font-bold border-2 border-sky-600 ring-2 ring-sky-300 shadow-sm cursor-pointer transition-all";
        btn.querySelector(".lsv-num").className = "lsv-num text-base sm:text-lg font-black text-white leading-tight";
        btn.querySelector(".lsv-lbl").className = "lsv-lbl text-[10px] sm:text-xs text-sky-100 font-semibold leading-tight mt-0.5";
      } else {
        btn.className = "visual-lsv-btn flex flex-col items-center justify-center py-2.5 sm:py-3.5 px-1 rounded-xl bg-white text-slate-800 border border-slate-200/90 hover:border-sky-300 shadow-2xs cursor-pointer transition-all";
        btn.querySelector(".lsv-num").className = "lsv-num text-base sm:text-lg font-extrabold text-slate-800 leading-tight";
        btn.querySelector(".lsv-lbl").className = "lsv-lbl text-[10px] sm:text-xs text-slate-500 font-medium leading-tight mt-0.5";
      }
    });

    const statusEl = document.getElementById("lsv-status-text");
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-sky-700 font-bold not-italic">✓ Selected: ${LSV_MAP[String(val)]}</span>`;
    }
  }

  // Q2: Lighting Preference Vote (LPV) -1, 0, +1
  function setVisualLpv(val) {
    state.visual.lpv = parseInt(val, 10);
    document.querySelectorAll(".visual-lpv-btn").forEach(btn => {
      const bVal = parseInt(btn.getAttribute("data-val"), 10);
      if (bVal === state.visual.lpv) {
        btn.className = "visual-lpv-btn active flex flex-col items-center justify-center py-3 px-2 rounded-xl bg-sky-600 text-white font-bold border-2 border-sky-600 ring-2 ring-sky-300 shadow-sm cursor-pointer transition-all";
        btn.querySelector(".lpv-num").className = "lpv-num text-base sm:text-lg font-black text-white leading-tight";
        btn.querySelector(".lpv-lbl").className = "lpv-lbl text-xs text-sky-100 font-semibold leading-tight mt-0.5";
      } else {
        btn.className = "visual-lpv-btn flex flex-col items-center justify-center py-3 px-2 rounded-xl bg-white text-slate-800 border border-slate-200/90 hover:border-sky-300 shadow-2xs cursor-pointer transition-all";
        btn.querySelector(".lpv-num").className = "lpv-num text-base sm:text-lg font-extrabold text-slate-800 leading-tight";
        btn.querySelector(".lpv-lbl").className = "lpv-lbl text-xs text-slate-500 font-medium leading-tight mt-0.5";
      }
    });

    const statusEl = document.getElementById("lpv-status-text");
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-sky-700 font-bold not-italic">✓ Selected: ${LPV_MAP[String(val)]}</span>`;
    }
  }

  // Q3: Visual Satisfaction Vote (VSaV) -3 s/d +3
  function setVisualVsav(val) {
    state.visual.vsav = parseInt(val, 10);
    document.querySelectorAll(".visual-vsav-btn").forEach(btn => {
      const bVal = parseInt(btn.getAttribute("data-val"), 10);
      if (bVal === state.visual.vsav) {
        btn.className = "visual-vsav-btn active flex flex-col items-center justify-center py-2.5 sm:py-3.5 px-1 rounded-xl bg-sky-600 text-white font-bold border-2 border-sky-600 ring-2 ring-sky-300 shadow-sm cursor-pointer transition-all";
        btn.querySelector(".vsav-num").className = "vsav-num text-base sm:text-lg font-black text-white leading-tight";
        btn.querySelector(".vsav-lbl").className = "vsav-lbl text-[10px] sm:text-xs text-sky-100 font-semibold leading-tight mt-0.5";
      } else {
        btn.className = "visual-vsav-btn flex flex-col items-center justify-center py-2.5 sm:py-3.5 px-1 rounded-xl bg-white text-slate-800 border border-slate-200/90 hover:border-sky-300 shadow-2xs cursor-pointer transition-all";
        btn.querySelector(".vsav-num").className = "vsav-num text-base sm:text-lg font-extrabold text-slate-800 leading-tight";
        btn.querySelector(".vsav-lbl").className = "vsav-lbl text-[10px] sm:text-xs text-slate-500 font-medium leading-tight mt-0.5";
      }
    });

    const statusEl = document.getElementById("vsav-status-text");
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-sky-700 font-bold not-italic">✓ Selected: ${VSAV_MAP[String(val)]}</span>`;
    }
  }

  function resetVisualForm() {
    state.visual.lsv = null;
    state.visual.lpv = null;
    state.visual.vsav = null;
    state.visual.comment = "";

    document.querySelectorAll(".visual-lsv-btn").forEach(btn => {
      btn.className = "visual-lsv-btn flex flex-col items-center justify-center py-2.5 sm:py-3.5 px-1 rounded-xl bg-white text-slate-800 border border-slate-200/90 hover:border-sky-300 shadow-2xs cursor-pointer transition-all";
      btn.querySelector(".lsv-num").className = "lsv-num text-base sm:text-lg font-extrabold text-slate-800 leading-tight";
      btn.querySelector(".lsv-lbl").className = "lsv-lbl text-[10px] sm:text-xs text-slate-500 font-medium leading-tight mt-0.5";
    });
    document.querySelectorAll(".visual-lpv-btn").forEach(btn => {
      btn.className = "visual-lpv-btn flex flex-col items-center justify-center py-3 px-2 rounded-xl bg-white text-slate-800 border border-slate-200/90 hover:border-sky-300 shadow-2xs cursor-pointer transition-all";
      btn.querySelector(".lpv-num").className = "lpv-num text-base sm:text-lg font-extrabold text-slate-800 leading-tight";
      btn.querySelector(".lpv-lbl").className = "lpv-lbl text-xs text-slate-500 font-medium leading-tight mt-0.5";
    });
    document.querySelectorAll(".visual-vsav-btn").forEach(btn => {
      btn.className = "visual-vsav-btn flex flex-col items-center justify-center py-2.5 sm:py-3.5 px-1 rounded-xl bg-white text-slate-800 border border-slate-200/90 hover:border-sky-300 shadow-2xs cursor-pointer transition-all";
      btn.querySelector(".vsav-num").className = "vsav-num text-base sm:text-lg font-extrabold text-slate-800 leading-tight";
      btn.querySelector(".vsav-lbl").className = "vsav-lbl text-[10px] sm:text-xs text-slate-500 font-medium leading-tight mt-0.5";
    });

    setEl("lsv-status-text", "— Not selected —");
    setEl("lpv-status-text", "— Not selected —");
    setEl("vsav-status-text", "— Not selected —");

    const commentInput = document.getElementById("visual-comment");
    if (commentInput) commentInput.value = "";

    showToast("Form evaluasi pencahayaan telah di-reset.", "sky");
  }

  // ── Submit Feedback Termal (Suhu) ──────────────────────────────────────────
  function submitThermalFeedback(event) {
    if (event) event.preventDefault();

    if (state.thermal.tsv === null && state.thermal.tpv === null && state.thermal.sat === null) {
      showToast("⚠️ Harap pilih minimal salah satu opsi sensasi termal sebelum mengirim.", "amber");
      return;
    }

    const roomSelect = document.getElementById("fb-room");
    const room = roomSelect ? roomSelect.value : "Workbench 1 (Jendela)";
    const commentInput = document.getElementById("thermal-comment");
    const comment = commentInput ? commentInput.value.trim() : "";

    const liveTa = (window.liveData && window.liveData.aggregates && window.liveData.aggregates.avgTemp) || 24.2;
    const now = new Date();
    const timeStr = now.toTimeString().split(" ")[0];

    const newVote = {
      id: Date.now(),
      time: timeStr,
      room: room,
      category: "thermal",
      metric: `${liveTa.toFixed(1)} °C`,
      tsv: state.thermal.tsv !== null ? TSV_MAP[String(state.thermal.tsv)] : "—",
      tpv: state.thermal.tpv !== null ? TPV_MAP[String(state.thermal.tpv)] : "—",
      sat: state.thermal.sat !== null ? THERMAL_SAT_MAP[String(state.thermal.sat)] : "—",
      note: comment || "Feedback suhu penghuni tercatat secara anonim."
    };

    state.recentVotes.unshift(newVote);
    if (state.recentVotes.length > 10) state.recentVotes.pop();
    state.totalVotes++;

    updateStats();
    renderRecentTable();

    // Reset form setelah kirim
    resetThermalForm();

    // Tampilkan konfirmasi sukses
    showSuccessModal(
      "🌡️ Thermal Feedback Berhasil Terkirim!",
      `Suara kenyamanan suhu Anda di <strong>${room}</strong> telah dicatat ke sistem BEMS Living Lab. Data ini langsung menyelaraskan setpoint suhu ruangan.`
    );
  }

  // ── Submit Feedback Visual (Cahaya) ────────────────────────────────────────
  function submitVisualFeedback(event) {
    if (event) event.preventDefault();

    if (state.visual.lsv === null && state.visual.lpv === null && state.visual.vsav === null) {
      showToast("⚠️ Harap pilih minimal salah satu opsi sensasi visual sebelum mengirim.", "amber");
      return;
    }

    const roomSelect = document.getElementById("fb-room");
    const room = roomSelect ? roomSelect.value : "Workbench 1 (Jendela)";
    const commentInput = document.getElementById("visual-comment");
    const comment = commentInput ? commentInput.value.trim() : "";

    const liveLux = (window.liveData && window.liveData.aggregates && window.liveData.aggregates.avgLux) || 485;
    const now = new Date();
    const timeStr = now.toTimeString().split(" ")[0];

    const newVote = {
      id: Date.now(),
      time: timeStr,
      room: room,
      category: "visual",
      metric: `${Math.round(liveLux)} Lux`,
      tsv: state.visual.lsv !== null ? LSV_MAP[String(state.visual.lsv)] : "—",
      tpv: state.visual.lpv !== null ? LPV_MAP[String(state.visual.lpv)] : "—",
      sat: state.visual.vsav !== null ? VSAV_MAP[String(state.visual.vsav)] : "—",
      note: comment || "Feedback pencahayaan penghuni tercatat secara anonim."
    };

    state.recentVotes.unshift(newVote);
    if (state.recentVotes.length > 10) state.recentVotes.pop();
    state.totalVotes++;

    updateStats();
    renderRecentTable();

    // Reset form setelah kirim
    resetVisualForm();

    // Tampilkan konfirmasi sukses
    showSuccessModal(
      "💡 Visual Feedback Berhasil Terkirim!",
      `Suara kenyamanan pencahayaan Anda di <strong>${room}</strong> telah dicatat ke sistem BEMS Living Lab. Data ini langsung menyelaraskan tingkat peredupan (dimmer) lampu.`
    );
  }

  // ── Modal & Toast Notifikasi ──────────────────────────────────────────────
  function showSuccessModal(title, msg) {
    const isGuest = getEffectiveRole() === "guest";
    const existing = document.getElementById("bems-success-modal");
    if (existing) existing.remove();

    const guestNotice = isGuest
      ? `<div class="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs">
           🔒 <strong>Catatan:</strong> Sebagai tamu (Guest), Anda telah menyelesaikan pengisian kuesioner. Hasil evaluasi kumulatif dan analisis grafik diproteksi dan hanya dapat diakses oleh Administrator BEMS.
         </div>`
      : "";

    const modal = document.createElement("div");
    modal.id = "bems-success-modal";
    modal.className = "fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200";
    modal.innerHTML = `
      <div class="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 text-slate-800 text-left space-y-4">
        <div class="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-2xl font-bold">
          ✓
        </div>
        <div>
          <h3 class="text-base font-bold text-slate-900">${title}</h3>
          <p class="text-xs text-slate-600 mt-1 leading-relaxed">${msg}</p>
          ${guestNotice}
        </div>
        <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <button type="button" onclick="document.getElementById('bems-success-modal').remove()" class="px-5 py-2.5 rounded-xl bg-teal-800 hover:bg-teal-900 text-white font-bold text-xs shadow-sm cursor-pointer transition-all">
            Selesai / Mengerti
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function showToast(msg, theme = "teal") {
    let bg = "bg-teal-800 border-teal-600";
    if (theme === "sky") bg = "bg-sky-700 border-sky-500";
    if (theme === "blue") bg = "bg-blue-700 border-blue-500";
    if (theme === "amber") bg = "bg-amber-800 border-amber-600";

    const toast = document.createElement("div");
    toast.className = `fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-lg text-xs font-semibold text-white ${bg} border transition-all flex items-center gap-2`;
    toast.innerHTML = `<span>${msg}</span>`;
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

  // ── Render Tabel Log Respon Real-Time (Khusus Admin) ──────────────────────
  function renderRecentTable() {
    const tbody = document.getElementById("fb-recent-tbody");
    if (!tbody) return;

    tbody.innerHTML = state.recentVotes.map(v => {
      const isThermal = v.category === "thermal";
      const catBadge = isThermal
        ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-200">🌡️ Termal</span>`
        : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-50 text-sky-800 border border-sky-200">💡 Visual</span>`;

      return `
        <tr class="hover:bg-slate-50/80 transition-colors">
          <td class="py-2.5 px-3 font-mono text-slate-500">${v.time}</td>
          <td class="py-2.5 px-3 font-bold text-slate-800">${v.room}</td>
          <td class="py-2.5 px-3">${catBadge}</td>
          <td class="py-2.5 px-3 font-mono font-semibold text-slate-700">${v.metric}</td>
          <td class="py-2.5 px-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold border bg-slate-100 text-slate-800 border-slate-200">
              ${v.tsv}
            </span>
          </td>
          <td class="py-2.5 px-3 font-medium text-slate-600">${v.tpv}</td>
          <td class="py-2.5 px-3 font-medium text-slate-700">${v.sat}</td>
          <td class="py-2.5 px-3 text-slate-500 text-[11px] max-w-xs truncate" title="${v.note}">${v.note}</td>
        </tr>
      `;
    }).join("");
  }

  // ── Grafik Analisis (Chart.js) Khusus Administrator ────────────────────────
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

  function initCharts() {
    const ctxDist = document.getElementById("comfortDistChart");
    if (ctxDist && !charts.thermalDist) {
      charts.thermalDist = new Chart(ctxDist, {
        type: "bar",
        data: {
          labels: ["-3 Cold", "-2 Cool", "-1 Slightly Cool", "0 Neutral", "+1 Slightly Warm", "+2 Warm", "+3 Hot"],
          datasets: [
            {
              label: "Distribusi Suara Penghuni (%)",
              data: [1.7, 3.4, 15.5, 58.6, 13.8, 5.2, 1.8],
              backgroundColor: [
                "#3b82f6", "#60a5fa", "#93c5fd", "#2563eb", "#f59e0b", "#f97316", "#ef4444"
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
              title: { display: true, text: "Persentase (%)", font: { size: 10 } },
              ticks: { callback: v => `${v}%` },
              min: 0,
              max: 70
            }
          }
        }
      });
    }

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
              backgroundColor: "#2563eb",
              pointRadius: 6,
              pointHoverRadius: 8
            },
            {
              label: "Regresi Linier Sensasi Termal",
              data: [
                { x: 23.0, y: -2.1 },
                { x: 24.2, y: 0.0 },
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
            legend: { position: "top", labels: { font: { size: 10 }, usePointStyle: true } },
            tooltip: {
              ...darkTooltip,
              callbacks: {
                label: ctx => `Suhu Ruang: ${ctx.raw.x}°C -> Sensasi: ${ctx.raw.y}`
              }
            }
          },
          scales: {
            x: {
              title: { display: true, text: "Suhu Ruang Ta (°C)", font: { size: 10, weight: "bold" } },
              ticks: { callback: v => `${v}°C` },
              min: 22.5,
              max: 26.5
            },
            y: {
              title: { display: true, text: "TSV Vote (-3 s/d +3)", font: { size: 10, weight: "bold" } },
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
    const ctxVisDist = document.getElementById("visualDistChart");
    if (ctxVisDist && !charts.visualDist) {
      charts.visualDist = new Chart(ctxVisDist, {
        type: "bar",
        data: {
          labels: ["-3 Very Dark", "-2 Dark", "-1 Slightly Dark", "0 Neutral", "+1 Slightly Bright", "+2 Bright", "+3 Very Bright"],
          datasets: [
            {
              label: "Distribusi Suara Pencahayaan (%)",
              data: [1.7, 3.4, 12.1, 62.1, 13.8, 5.2, 1.7],
              backgroundColor: [
                "#0284c7", "#38bdf8", "#7dd3fc", "#0369a1", "#f59e0b", "#f97316", "#ef4444"
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
              title: { display: true, text: "Persentase (%)", font: { size: 10 } },
              ticks: { callback: v => `${v}%` },
              min: 0,
              max: 70
            }
          }
        }
      });
    }

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
              backgroundColor: "#0284c7",
              pointRadius: 6,
              pointHoverRadius: 8
            },
            {
              label: "Regresi Linier Pencahayaan Ideal",
              data: [
                { x: 150, y: -3.0 },
                { x: 462, y: 0.0 },
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
            legend: { position: "top", labels: { font: { size: 10 }, usePointStyle: true } },
            tooltip: {
              ...darkTooltip,
              callbacks: {
                label: ctx => `Iluminansi: ${ctx.raw.x} lx -> Sensasi: ${ctx.raw.y}`
              }
            }
          },
          scales: {
            x: {
              title: { display: true, text: "Iluminansi Meja Kerja (Lux)", font: { size: 10, weight: "bold" } },
              ticks: { callback: v => `${v} lx` },
              min: 100,
              max: 900
            },
            y: {
              title: { display: true, text: "LSV Vote (-3 s/d +3)", font: { size: 10, weight: "bold" } },
              ticks: { callback: v => `${v}` },
              min: -3,
              max: 3
            }
          }
        }
      });
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  window.ComfortService = {
    start() {
      // 1. Identifikasi status hak akses (Admin vs Guest)
      state.isRealAdmin = checkIsAdmin();
      state.adminPreviewGuest = false;

      // 2. Terapkan visibilitas berdasarkan role
      applyRoleVisibility();

      // 3. Update data & tabel
      updateStats();
      renderRecentTable();

      // 4. Set tab default ke "all" (Terpadu)
      switchTab("all");
    },
    switchTab,
    switchAnalyticsTab,
    toggleAdminPreview,

    // Thermal Actions
    setThermalTsv,
    setThermalTpv,
    setThermalSat,
    submitThermalFeedback,
    resetThermalForm,

    // Visual Actions
    setVisualLsv,
    setVisualLpv,
    setVisualVsav,
    submitVisualFeedback,
    resetVisualForm,

    // Unified Submission (Backward compatibility)
    submitUnifiedFeedback(e) {
      if (e) e.preventDefault();
      if (state.activeTab === "thermal") {
        submitThermalFeedback(e);
      } else if (state.activeTab === "visual") {
        submitVisualFeedback(e);
      } else {
        // Jika terpadu, kirim keduanya bila ada yang dipilih
        let sent = false;
        if (state.thermal.tsv !== null || state.thermal.tpv !== null || state.thermal.sat !== null) {
          submitThermalFeedback(e);
          sent = true;
        }
        if (state.visual.lsv !== null || state.visual.lpv !== null || state.visual.vsav !== null) {
          submitVisualFeedback(e);
          sent = true;
        }
        if (!sent) {
          showToast("⚠️ Harap pilih minimal salah satu opsi sensasi termal atau visual sebelum mengirim.", "amber");
        }
      }
    },
    // Aliases
    setTcvVote: (v) => setThermalTsv(v),
    setVisVote: (v) => setVisualLsv(v),
    setGlareVote: (v) => { /* backward compatible */ },
  };

})();
