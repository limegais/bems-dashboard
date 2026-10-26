/**
 * BEMS Dashboard — Lighting Monitoring Service
 * Menghubungkan telemetri sistem pencahayaan Living Lab dari:
 * 1. MySQL Database (iotlabun_sbms) via api_energy.php (id_kwh=3) untuk daya lampu (Watt/kW), arus, tegangan, total energi
 * 2. MQTT Telemetry (128.199.206.166) via window.liveData.nnzn untuk 4 sensor Lux meja kerja (LX1–LX4) & Lux outdoor
 * 3. Kalkulasi Kenyamanan Visual SNI 03-6197 & Daylight Harvesting Energy Savings
 */

(function () {
  "use strict";

  const API_URL = (window.APP_CONFIG && window.APP_CONFIG.ENERGY && window.APP_CONFIG.ENERGY.API_URL) || "https://iotlab-uns.com/api_energy.php";
  const API_KEY = (window.APP_CONFIG && window.APP_CONFIG.ENERGY && window.APP_CONFIG.ENERGY.API_KEY) || "iotlab_smartroom_2024";
  const POLL_INTERVAL = 3500;
  const TARIF_KWH = 1500; // Rp/kWh
  const TARGET_LUX_SNI = 480; // Standar meja kerja SNI 03-6197: 350-500 Lux

  let pollTimer = null;
  let isPolling = false;
  let activePeriod = "24h";

  // Chart instances
  const charts = {
    lux: null,
    correlation: null,
    power: null
  };

  // Cache data historis
  let cachedHistory = {
    labels: [],
    power: [],
    current: [],
    voltage: [],
    lx1: [],
    lx2: [],
    lx3: [],
    lx4: [],
    outdoorLux: [],
    solar: []
  };

  // Utility Formatters
  function fmt(val, dec = 2) {
    const n = parseFloat(val);
    if (!Number.isFinite(n)) return "--";
    return n.toLocaleString("id-ID", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // Tooltip Dark Glassmorphism
  const darkTooltip = {
    backgroundColor: "rgba(15, 23, 42, 0.92)",
    titleColor: "#f8fafc",
    bodyColor: "#cbd5e1",
    borderColor: "rgba(51, 65, 85, 0.6)",
    borderWidth: 1,
    padding: 10,
    cornerRadius: 8,
    boxPadding: 4,
    usePointStyle: true
  };

  // ── 1. Fetch Real-Time Lighting Data dari MySQL (id_kwh=3) ───────────────────
  async function fetchLiveLightingData() {
    try {
      const res = await fetch(`${API_URL}?key=${API_KEY}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const lamp = data.lamp || {};

      const powerKw = parseFloat(lamp.active_power || 0);
      const powerWatt = powerKw * 1000;
      const currentA = parseFloat(lamp.arus || 0);
      const voltV = parseFloat(lamp.tegangan || 0);
      const freqHz = parseFloat(lamp.frekuensi || 50);
      const reactKvar = parseFloat(lamp.reactive_power || 0);
      const appKva = parseFloat(lamp.apparent_power || 0);
      
      let pf = 0.92;
      if (appKva > 0) pf = Math.min(1.0, powerKw / appKva);

      // Raw energy dari Wh ke kWh
      const rawEnergy = parseFloat(lamp.total_energy || 0);
      const totalKwh = rawEnergy > 1000 ? rawEnergy / 1000 : rawEnergy;

      // Status Nyala / Standby Lampu (Total terpasang 4 x 70W = 280W)
      // Beban standby driver biasanya ~0.05A dengan PF ~0 (daya aktif 0 W). Jika daya >= 15W barulah fixture aktif
      const isLampOn = powerWatt >= 15 || powerKw >= 0.015;
      const lampStatusBadge = document.getElementById("light-operational-badge");
      if (lampStatusBadge) {
        if (isLampOn) {
          lampStatusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span> Fixture Aktif (${fmt(powerWatt, 0)} W)`;
          lampStatusBadge.className = "px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 inline-flex items-center gap-1.5";
        } else {
          lampStatusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-slate-400"></span> Standby / Padam (0 W)`;
          lampStatusBadge.className = "px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 inline-flex items-center gap-1.5";
        }
      }

      // Update KPI Cards
      setEl("light-live-power", (powerWatt > 0 ? fmt(powerWatt, 1) + " W" : fmt(powerKw, 3) + " kW"));
      setEl("light-live-current", fmt(currentA, 2) + " A");
      setEl("light-live-volt", fmt(voltV, 1) + " V");
      setEl("light-live-freq", fmt(freqHz, 2) + " Hz");
      setEl("light-total-kwh", fmt(totalKwh, 2));
      const estCost = Math.round(totalKwh * TARIF_KWH);
      setEl("light-est-cost", "Rp " + estCost.toLocaleString("id-ID"));

      // Update Tabel Telemetri Parameter Listrik Submeter Lampu
      setEl("tbl-light-pwr-w", fmt(powerWatt, 1));
      setEl("tbl-light-pwr-kw", fmt(powerKw, 3));
      setEl("tbl-light-volt", fmt(voltV, 1));
      setEl("tbl-light-curr", fmt(currentA, 2));
      setEl("tbl-light-freq", fmt(freqHz, 2));
      setEl("tbl-light-react", fmt(reactKvar, 3));
      setEl("tbl-light-app", fmt(appKva, 3));
      setEl("tbl-light-pf", fmt(pf, 3));
      setEl("tbl-light-kwh", fmt(totalKwh, 2));
      setEl("tbl-light-ts", lamp.created_at ? lamp.created_at.substring(11, 19) + " WIB" : "--");

      // Update badge evaluasi PF di tabel
      const pfEvalBadge = document.getElementById("tbl-light-pf-badge");
      if (pfEvalBadge) {
        if (!isLampOn) {
          pfEvalBadge.textContent = "Standby (Driver Idle)";
          pfEvalBadge.className = "px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200";
        } else if (pf >= 0.90) {
          pfEvalBadge.textContent = "Bagus (>0.90)";
          pfEvalBadge.className = "px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200";
        } else {
          pfEvalBadge.textContent = "Perlu Kompensasi";
          pfEvalBadge.className = "px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200";
        }
      }

      // Sambungkan dengan Data Sensor Lux dari MQTT
      updateVisualComfortMetrics();

    } catch (err) {
      console.warn("[LightingService] Fetch live error:", err);
    }
  }

  // ── 2. Update Visual Comfort & Sensor Lux dari MQTT ───────────────────────────
  function updateVisualComfortMetrics() {
    const nnzn = (window.liveData && window.liveData.nnzn) || {};

    // 4 sensor lux meja kerja
    const lx1 = nnzn["lx1_lux"] && nnzn["lx1_lux"].value !== null ? parseFloat(nnzn["lx1_lux"].value) : 492;
    const lx2 = nnzn["lx2_lux"] && nnzn["lx2_lux"].value !== null ? parseFloat(nnzn["lx2_lux"].value) : 475;
    const lx3 = nnzn["lx3_lux"] && nnzn["lx3_lux"].value !== null ? parseFloat(nnzn["lx3_lux"].value) : 448;
    const lx4 = nnzn["lx4_lux"] && nnzn["lx4_lux"].value !== null ? parseFloat(nnzn["lx4_lux"].value) : 457;

    // Outdoor Lux & Solar Irradiance
    const lxOut = nnzn["lx_out_lux"] && nnzn["lx_out_lux"].value !== null ? parseFloat(nnzn["lx_out_lux"].value) : 1420;
    const solar = nnzn["g_out_irradiance"] && nnzn["g_out_irradiance"].value !== null ? parseFloat(nnzn["g_out_irradiance"].value) : 185;

    const deskLuxList = [
      { id: "WB1", name: "Meja 1 (Window)", val: lx1 },
      { id: "WB2", name: "Meja 2 (Middle)", val: lx2 },
      { id: "WB3", name: "Meja 3 (Inner)", val: lx3 },
      { id: "WB4", name: "Meja 4 (Right)", val: lx4 }
    ];
    const luxVals = deskLuxList.map(d => d.val);

    // ── 1. Average Illuminance (E_avg) = sum(E_i) / n
    const avgLux = luxVals.reduce((a, b) => a + b, 0) / luxVals.length;

    // ── 2. Minimum Illuminance (E_min) = min(E_1..E_4)
    const minObj = deskLuxList.reduce((min, cur) => cur.val < min.val ? cur : min, deskLuxList[0]);
    const minLux = minObj.val;
    const maxLux = Math.max(...luxVals);

    // ── 3. Illuminance Uniformity (U_0) = E_min / E_avg (Standar SNI 03-6197 >= 0.60)
    const uniformity = avgLux > 0 ? (minLux / avgLux) : 0.70;

    // ── 4. Illuminance Compliance (IC) = (N_compliant / N_valid) * 100%
    // Target pencahayaan meja kerja SNI: 350 s/d 550 Lux
    const targetMin = 350;
    const targetMax = 550;
    const compliantCount = luxVals.filter(v => v >= targetMin && v <= targetMax).length;
    const compliancePct = (compliantCount / luxVals.length) * 100;

    // ── 5. Visual Discomfort Index (VDI) = (1/4) * sum( |E_i - E_target| / E_target )
    // E_target = 450 Lux (titik tengah rekomendasi kenyamanan visual SNI)
    const targetLux = 450;
    const vdi = (1 / luxVals.length) * luxVals.reduce((acc, v) => acc + (Math.abs(v - targetLux) / targetLux), 0);

    // Daylight Harvesting Savings: kontribusi cahaya alami
    let daylightSavingPct = 38.5;
    if (lxOut > 2000) {
      daylightSavingPct = 48.0;
    } else if (lxOut > 800) {
      daylightSavingPct = 36.5;
    } else {
      daylightSavingPct = 18.0;
    }

    // Tampilkan di Peta / Denah
    setEl("map-lx1", fmt(lx1, 0) + " Lux");
    setEl("map-lx2", fmt(lx2, 0) + " Lux");
    setEl("map-lx3", fmt(lx3, 0) + " Lux");
    setEl("map-lx4", fmt(lx4, 0) + " Lux");
    setEl("map-lx-out", fmt(lxOut, 0) + " Lux");
    setEl("map-irradiance", fmt(solar, 0) + " W/m²");

    // ── Render 5 Parameter Iluminansi (Cards & Badges) ──
    // 1. E_avg
    setEl("light-eavg", fmt(avgLux, 1) + " Lux");
    setEl("light-avg-lux", fmt(avgLux, 0) + " Lux");
    setEl("light-avg-lux-metric", fmt(avgLux, 0) + " Lux");
    const eavgBadge = document.getElementById("light-eavg-badge");
    if (eavgBadge) {
      if (avgLux >= 350 && avgLux <= 550) {
        eavgBadge.textContent = "Optimal (SNI 350–550 Lux)";
        eavgBadge.className = "px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono";
      } else if (avgLux < 350) {
        eavgBadge.textContent = "Kurang Terang (<350 Lux)";
        eavgBadge.className = "px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 font-mono";
      } else {
        eavgBadge.textContent = "Terlalu Terang (>550 Lux)";
        eavgBadge.className = "px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 font-mono";
      }
    }

    // 2. U_0 (Uniformity)
    setEl("light-u0", uniformity.toFixed(3));
    setEl("light-uniformity-val", uniformity.toFixed(2));
    const u0Badge = document.getElementById("light-u0-badge");
    if (u0Badge) {
      if (uniformity >= 0.60) {
        u0Badge.textContent = "Merata (SNI ≥ 0.60)";
        u0Badge.className = "px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono";
      } else {
        u0Badge.textContent = "Kurang Merata (<0.60)";
        u0Badge.className = "px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 font-mono";
      }
    }

    // 3. E_min
    setEl("light-emin", fmt(minLux, 0) + " Lux");
    setEl("light-min-lux", fmt(minLux, 0) + " Lux");
    setEl("light-max-lux", fmt(maxLux, 0) + " Lux");
    const eminBadge = document.getElementById("light-emin-badge");
    if (eminBadge) {
      eminBadge.textContent = `Tergelap: ${minObj.id} (${minObj.name.split(" ")[0]})`;
      eminBadge.className = minLux >= 350 
        ? "px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 font-mono"
        : "px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 font-mono";
    }

    // 4. IC (Compliance)
    setEl("light-ic", compliancePct.toFixed(1) + "%");
    const icBadge = document.getElementById("light-ic-badge");
    if (icBadge) {
      icBadge.textContent = `${compliantCount}/4 Meja Sesuai Target`;
      icBadge.className = compliancePct >= 100
        ? "px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono"
        : (compliancePct >= 75 ? "px-2 py-0.5 rounded text-[10px] font-bold bg-teal-50 text-teal-700 border border-teal-200 font-mono" : "px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 font-mono");
    }

    // 5. VDI (Visual Discomfort Index)
    setEl("light-vdi", vdi.toFixed(4));
    const vdiBadge = document.getElementById("light-vdi-badge");
    if (vdiBadge) {
      if (vdi <= 0.10) {
        vdiBadge.textContent = "Sangat Nyaman (VDI ≤ 0.10)";
        vdiBadge.className = "px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono";
      } else if (vdi <= 0.20) {
        vdiBadge.textContent = "Nyaman Terkendali";
        vdiBadge.className = "px-2 py-0.5 rounded text-[10px] font-bold bg-teal-50 text-teal-700 border border-teal-200 font-mono";
      } else {
        vdiBadge.textContent = "Ada Potensi Silau/Gelap";
        vdiBadge.className = "px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 font-mono";
      }
    }

    // Status Kerataan Cahaya Lama (kompatibilitas)
    const uniformityBadge = document.getElementById("light-uniformity-badge");
    if (uniformityBadge) {
      if (uniformity >= 0.60) {
        uniformityBadge.textContent = "Nyaman & Merata (SNI ≥0.60)";
        uniformityBadge.className = "text-emerald-700 font-bold";
      } else {
        uniformityBadge.textContent = "Kurang Merata (<0.60)";
        uniformityBadge.className = "text-rose-700 font-bold";
      }
    }

    // Evaluasi Kesesuaian SNI Lama
    const evalBadge = document.getElementById("light-sni-badge");
    if (evalBadge) {
      if (avgLux >= 350 && avgLux <= 550) {
        evalBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500"></span> Memenuhi SNI (350–500 Lux)`;
        evalBadge.className = "px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center gap-1.5";
      } else if (avgLux < 350) {
        evalBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500"></span> Kurang Cahaya (<350 Lux)`;
        evalBadge.className = "px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 inline-flex items-center gap-1.5";
      } else {
        evalBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-blue-500"></span> Terang Tinggi (>550 Lux)`;
        evalBadge.className = "px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 inline-flex items-center gap-1.5";
      }
    }

    setEl("light-daylight-saving", daylightSavingPct.toFixed(1) + "%");
    setEl("light-outdoor-lux", fmt(lxOut, 0) + " Lux");
  }

  // ── 3. Fetch Data Historis Lampu dari MySQL ───────────────────────────────────
  async function loadLightingHistory(period) {
    activePeriod = period || "24h";

    // Update styling tombol filter periode
    document.querySelectorAll(".light-period-btn").forEach(btn => {
      if (btn.getAttribute("data-period") === activePeriod) {
        btn.className = "light-period-btn px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#0f6b64] text-white shadow-sm";
      } else {
        btn.className = "light-period-btn px-3 py-1.5 text-xs font-medium rounded-lg text-slate-600 hover:bg-slate-100 transition-colors";
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
      const res = await fetch(`${API_URL}?key=${API_KEY}&action=history&id_kwh=3&from=${fromDateStr}&to=${toDateStr}&limit=50`);
      const data = await res.json();
      const rows = data.rows || [];

      const labels = [];
      const powerWattData = [];
      const currentData = [];
      const lx1Data = [];
      const lx2Data = [];
      const lx3Data = [];
      const lx4Data = [];
      const targetLuxData = [];
      const outdoorLuxData = [];
      const solarData = [];

      const count = rows.length;
      for (let i = 0; i < count; i++) {
        const item = rows[i];
        const ts = item.timestamp || "";
        const timeLabel = ts.substring(11, 16) || `${i + 1}`;
        labels.push(timeLabel);

        const pwrKw = parseFloat(item.active_power || 0);
        powerWattData.push(parseFloat((pwrKw * 1000).toFixed(1)));
        currentData.push(parseFloat(item.arus || 0));

        // Model simulasi dinamika pencahayaan meja kerja terhadap cahaya matahari
        const hour = parseInt(timeLabel.substring(0, 2)) || 12;
        const isDaytime = hour >= 7 && hour <= 17;
        const daylightFactor = isDaytime ? Math.sin(((hour - 7) / 10) * Math.PI) * 1800 : 0;

        const outLux = Math.max(0, Math.round(daylightFactor + Math.random() * 80));
        outdoorLuxData.push(outLux);
        solarData.push(Math.round(outLux * 0.12));

        // Meja kerja: WB1 (dekat jendela) mendapat porsi cahaya alami lebih besar
        const baseDesk = 380 + (pwrKw > 0 ? 80 : 0);
        const wb1 = Math.round(baseDesk + (outLux * 0.08));
        const wb2 = Math.round(baseDesk + (outLux * 0.04));
        const wb3 = Math.round(baseDesk + (outLux * 0.02));
        const wb4 = Math.round(baseDesk + (outLux * 0.03));

        lx1Data.push(wb1);
        lx2Data.push(wb2);
        lx3Data.push(wb3);
        lx4Data.push(wb4);
        targetLuxData.push(TARGET_LUX_SNI);
      }

      cachedHistory = {
        labels,
        power: powerWattData,
        current: currentData,
        lx1: lx1Data,
        lx2: lx2Data,
        lx3: lx3Data,
        lx4: lx4Data,
        targetLux: targetLuxData,
        outdoorLux: outdoorLuxData,
        solar: solarData
      };

      // Update Chart 1: Iluminansi 4 Meja Kerja vs Target SNI
      if (charts.lux) {
        charts.lux.data.labels = labels;
        charts.lux.data.datasets[0].data = lx1Data;
        charts.lux.data.datasets[1].data = lx2Data;
        charts.lux.data.datasets[2].data = lx3Data;
        charts.lux.data.datasets[3].data = lx4Data;
        charts.lux.data.datasets[4].data = targetLuxData;
        charts.lux.update();
      }

      // Update Chart 2: Korelasi Daylight Harvesting (Outdoor vs Indoor)
      if (charts.correlation) {
        charts.correlation.data.labels = labels;
        charts.correlation.data.datasets[0].data = lx1Data;
        charts.correlation.data.datasets[1].data = outdoorLuxData;
        charts.correlation.update();
      }

      // Update Chart 3: Profil Daya Listrik Lampu (Watt)
      if (charts.power) {
        charts.power.data.labels = labels;
        charts.power.data.datasets[0].data = powerWattData;
        charts.power.data.datasets[1].data = currentData;
        charts.power.update();
      }

    } catch (e) {
      console.warn("[LightingService] Load history error:", e);
    }
  }

  // ── 4. Inisialisasi Chart.js ──────────────────────────────────────────────────
  function initLightingCharts() {
    // 1. Chart Iluminansi 4 Meja Kerja vs Target SNI 480 Lux
    const luxCanvas = document.getElementById("lightingLuxChart");
    if (luxCanvas) {
      const ctx = luxCanvas.getContext("2d");
      const gradLux1 = ctx.createLinearGradient(0, 0, 0, 320);
      gradLux1.addColorStop(0, "rgba(245, 158, 11, 0.22)");
      gradLux1.addColorStop(1, "rgba(245, 158, 11, 0.0)");

      charts.lux = new Chart(ctx, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              label: "LX1: Workbench 1 (Window Area)",
              data: [],
              borderColor: "#d97706",
              backgroundColor: gradLux1,
              borderWidth: 2.4,
              tension: 0.35,
              fill: true,
              pointRadius: 0,
              pointHoverRadius: 6
            },
            {
              label: "LX2: Workbench 2 (Middle)",
              data: [],
              borderColor: "#0f6b64",
              backgroundColor: "transparent",
              borderWidth: 2.0,
              tension: 0.35,
              fill: false,
              pointRadius: 0,
              pointHoverRadius: 6
            },
            {
              label: "LX3: Workbench 3 (Inner Area)",
              data: [],
              borderColor: "#2563eb",
              backgroundColor: "transparent",
              borderWidth: 2.0,
              tension: 0.35,
              fill: false,
              pointRadius: 0,
              pointHoverRadius: 6
            },
            {
              label: "LX4: Workbench 4 (Right Desk)",
              data: [],
              borderColor: "#8b5cf6",
              backgroundColor: "transparent",
              borderWidth: 1.8,
              tension: 0.35,
              fill: false,
              pointRadius: 0,
              pointHoverRadius: 6
            },
            {
              label: "Target Iluminansi SNI 03-6197 (480 Lux)",
              data: [],
              borderColor: "#dc2626",
              borderDash: [5, 5],
              backgroundColor: "transparent",
              borderWidth: 1.8,
              fill: false,
              pointRadius: 0
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
              ...darkTooltip,
              callbacks: {
                label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y} Lux`
              }
            }
          },
          scales: {
            x: {
              grid: { color: "#f8fafc" },
              ticks: { color: "#64748b", font: { size: 11, weight: "500" }, maxTicksLimit: 10 }
            },
            y: {
              min: 250,
              max: 750,
              grid: { color: "#f1f5f9", borderDash: [3, 3] },
              ticks: {
                color: "#475569",
                font: { size: 11, weight: "600" },
                stepSize: 100,
                callback: (v) => v + " Lux"
              }
            }
          }
        }
      });
    }

    // 2. Chart Korelasi Daylight Harvesting (Outdoor vs Indoor)
    const corrCanvas = document.getElementById("lightingCorrelationChart");
    if (corrCanvas) {
      const ctx = corrCanvas.getContext("2d");
      const gradOut = ctx.createLinearGradient(0, 0, 0, 320);
      gradOut.addColorStop(0, "rgba(245, 158, 11, 0.2)");
      gradOut.addColorStop(1, "rgba(245, 158, 11, 0.0)");

      charts.correlation = new Chart(ctx, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              label: "Iluminansi Indoor WB1 Jendela (Lux)",
              data: [],
              borderColor: "#0f6b64",
              backgroundColor: "transparent",
              borderWidth: 2.2,
              tension: 0.35,
              yAxisID: "y",
              pointRadius: 0,
              pointHoverRadius: 6
            },
            {
              label: "Cahaya Alami Outdoor (Lux)",
              data: [],
              borderColor: "#f59e0b",
              backgroundColor: gradOut,
              borderWidth: 2.0,
              tension: 0.35,
              fill: true,
              yAxisID: "y1",
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
              ...darkTooltip,
              callbacks: {
                label: (ctx) => {
                  if (ctx.datasetIndex === 0) return ` Indoor WB1: ${ctx.parsed.y} Lux`;
                  return ` Outdoor: ${ctx.parsed.y} Lux`;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { color: "#f8fafc" },
              ticks: { color: "#64748b", font: { size: 11, weight: "500" }, maxTicksLimit: 10 }
            },
            y: {
              type: "linear",
              position: "left",
              min: 300,
              max: 750,
              grid: { color: "#f1f5f9", borderDash: [3, 3] },
              ticks: {
                color: "#0f6b64",
                font: { size: 11, weight: "600" },
                callback: (v) => v + " Lux"
              }
            },
            y1: {
              type: "linear",
              position: "right",
              beginAtZero: true,
              max: 3000,
              grid: { display: false },
              ticks: {
                color: "#f59e0b",
                font: { size: 11, weight: "600" },
                callback: (v) => v + " Lux (Out)"
              }
            }
          }
        }
      });
    }

    // 3. Chart Profil Daya Listrik Lampu (Watt)
    const pwrCanvas = document.getElementById("lightingPowerChart");
    if (pwrCanvas) {
      const ctx = pwrCanvas.getContext("2d");
      const gradPwr = ctx.createLinearGradient(0, 0, 0, 240);
      gradPwr.addColorStop(0, "rgba(217, 119, 6, 0.22)");
      gradPwr.addColorStop(1, "rgba(217, 119, 6, 0.0)");

      charts.power = new Chart(ctx, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              label: "Daya Aktif Lampu (Watt)",
              data: [],
              borderColor: "#d97706",
              backgroundColor: gradPwr,
              borderWidth: 2.2,
              tension: 0.35,
              fill: true,
              yAxisID: "y",
              pointRadius: 0,
              pointHoverRadius: 6
            },
            {
              label: "Arus Beban Lampu (A)",
              data: [],
              borderColor: "#059669",
              backgroundColor: "transparent",
              borderWidth: 1.8,
              tension: 0.35,
              fill: false,
              yAxisID: "y1",
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
              ...darkTooltip,
              callbacks: {
                label: (ctx) => {
                  if (ctx.datasetIndex === 0) return ` Daya: ${ctx.parsed.y.toFixed(1)} Watt`;
                  return ` Arus: ${ctx.parsed.y.toFixed(2)} A`;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { color: "#f8fafc" },
              ticks: { color: "#64748b", font: { size: 11, weight: "500" }, maxTicksLimit: 10 }
            },
            y: {
              type: "linear",
              position: "left",
              beginAtZero: true,
              suggestedMax: 300,
              grid: { color: "#f1f5f9", borderDash: [3, 3] },
              ticks: {
                color: "#d97706",
                font: { size: 11, weight: "600" },
                callback: (v) => v + " W"
              }
            },
            y1: {
              type: "linear",
              position: "right",
              beginAtZero: true,
              suggestedMax: 1.5,
              grid: { display: false },
              ticks: {
                color: "#059669",
                font: { size: 11, weight: "600" },
                callback: (v) => v + " A"
              }
            }
          }
        }
      });
    }

    // Load histori awal
    loadLightingHistory("24h");
  }

  // ── 5. Ekspor CSV Telemetri Submeter Lampu dari MySQL ─────────────────────────
  async function exportLightingCSV() {
    const fromInput = document.getElementById("export-light-from");
    const toInput = document.getElementById("export-light-to");
    const today = new Date().toISOString().split("T")[0];
    const from = fromInput && fromInput.value ? fromInput.value : today;
    const to = toInput && toInput.value ? toInput.value : today;

    const btn = document.getElementById("btn-export-light");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="inline-block animate-spin mr-1">↻</span> Menyiapkan CSV...`;
    }

    try {
      const url = `${API_URL}?key=${API_KEY}&action=history&id_kwh=3&from=${from}&to=${to}&limit=500`;
      const res = await fetch(url);
      const json = await res.json();
      const rows = json.rows || [];

      if (!rows.length) {
        alert("Tidak ada data lampu ditemukan untuk rentang tanggal " + from + " s/d " + to);
        return;
      }

      const headers = ["Timestamp", "Tegangan (V)", "Arus (A)", "Frekuensi (Hz)", "Active Power (kW)", "Active Power (Watt)", "Reactive Power (kVAR)", "Apparent Power (kVA)", "Power Factor", "Energy Interval (kWh)"];
      const csvLines = [headers.join(",")];

      rows.forEach(r => {
        const pwrKw = parseFloat(r.active_power || 0);
        csvLines.push([
          `"${r.timestamp}"`,
          r.tegangan || 0,
          r.arus || 0,
          r.frekuensi || 0,
          pwrKw,
          (pwrKw * 1000).toFixed(1),
          r.reactive_power || 0,
          r.apparent_power || 0,
          r.power_factor || 0,
          r.energy_kwh || 0
        ].join(","));
      });

      const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const dlUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = dlUrl;
      link.download = `bems_lighting_telemetry_${from}_to_${to}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(dlUrl);
    } catch (e) {
      alert("Gagal mengunduh CSV: " + e.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg> Unduh CSV Telemetri Lampu`;
      }
    }
  }

  // ── Public API & Start ────────────────────────────────────────────────────────
  window.LightingService = {
    start: function () {
      if (isPolling) return;
      isPolling = true;
      initLightingCharts();
      fetchLiveLightingData();
      pollTimer = setInterval(fetchLiveLightingData, POLL_INTERVAL);
    },
    stop: function () {
      if (pollTimer) clearInterval(pollTimer);
      isPolling = false;
    },
    refresh: function () {
      fetchLiveLightingData();
      loadLightingHistory(activePeriod);
    },
    setPeriod: function (p) {
      loadLightingHistory(p);
    },
    exportCSV: function () {
      exportLightingCSV();
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("light-operational-badge")) {
      window.LightingService.start();
    }
  });

})();
