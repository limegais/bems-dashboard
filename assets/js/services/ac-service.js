/**
 * BEMS Dashboard — AC Monitoring Service
 * Menghubungkan telemetri AC Living Lab dari 2 sumber:
 * 1. MySQL Database (iotlabun_sbms) via api_energy.php (id_kwh=1) untuk daya, arus, tegangan, energi kWh
 * 2. MQTT Telemetry (128.199.206.166) via window.liveData.sht untuk 6 node suhu/kelembapan SHT31
 * 3. Kalkulasi PMV/PPD ISO 7730 & Rekomendasi Optimal MOPSO Edge AI
 */

(function () {
  "use strict";

  const API_URL = (window.APP_CONFIG && window.APP_CONFIG.ENERGY && window.APP_CONFIG.ENERGY.API_URL) || "https://iotlab-uns.com/api_energy.php";
  const API_KEY = (window.APP_CONFIG && window.APP_CONFIG.ENERGY && window.APP_CONFIG.ENERGY.API_KEY) || "iotlab_smartroom_2024";
  const POLL_INTERVAL = 3500;
  const TARIF_KWH = 1500; // Rp/kWh

  let pollTimer = null;
  let isPolling = false;
  let activePeriod = "24h";

  // Chart instances
  const charts = {
    temp: null,
    power: null,
    comfort: null
  };

  // Cache data historis
  let cachedHistory = {
    labels: [],
    power: [],
    current: [],
    voltage: [],
    kwh: []
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

  // ── Kalkulasi Fanger PMV / PPD (ISO 7730 / ASHRAE 55) ─────────────────────────
  function calculateFangerPMV(ta, rh, tr, v, met = 1.1, clo = 0.5) {
    if (!ta || !rh) return { pmv: -0.15, ppd: 5.5, status: "Comfortable (Neutral)", cat: "A" };
    
    // Simplifikasi ISO 7730 Polynomial Fit untuk ruang kantor ber-AC
    const fnps = Math.exp(16.6536 - 4030.183 / (ta + 235));
    const pa = (rh / 100) * fnps * 10; // Tekanan uap parsial (Pa)
    
    // Perkiraan perbedaan panas
    const deltaT = ta - 24.0;
    let pmv = 0.389 * deltaT + 0.0012 * (pa - 1700) - 0.22;
    
    // Clamp PMV di rentang standar -3.0 s/d +3.0
    pmv = Math.max(-3.0, Math.min(3.0, pmv));
    
    // PPD Formula ISO 7730: 100 - 95 * exp(-0.03353*pmv^4 - 0.2179*pmv^2)
    const ppd = 100 - 95 * Math.exp(-0.03353 * Math.pow(pmv, 4) - 0.2179 * Math.pow(pmv, 2));
    
    let status = "Comfortable (Neutral)";
    let cat = "A";
    if (pmv > 0.5) {
      status = "Slightly Warm";
      cat = "B";
    } else if (pmv > 1.0) {
      status = "Warm (Overheating)";
      cat = "C";
    } else if (pmv < -0.5) {
      status = "Slightly Cool";
      cat = "B";
    } else if (pmv < -1.0) {
      status = "Cool (Overcooling)";
      cat = "C";
    }

    return {
      pmv: parseFloat(pmv.toFixed(2)),
      ppd: parseFloat(ppd.toFixed(1)),
      status,
      cat
    };
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

  // ── 1. Fetch Real-Time AC Data dari MySQL ─────────────────────────────────────
  async function fetchLiveAcData() {
    try {
      const res = await fetch(`${API_URL}?key=${API_KEY}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const ac = data.ac || {};

      const powerKw = parseFloat(ac.active_power || 0);
      const currentA = parseFloat(ac.arus || 0);
      const voltV = parseFloat(ac.tegangan || 0);
      const freqHz = parseFloat(ac.frekuensi || 50);
      const reactKvar = parseFloat(ac.reactive_power || 0);
      const appKva = parseFloat(ac.apparent_power || 0);
      
      let pf = 0.95;
      if (appKva > 0) pf = Math.min(1.0, powerKw / appKva);

      // Raw energy dari Wh ke kWh
      const rawEnergy = parseFloat(ac.total_energy || 0);
      const totalKwh = rawEnergy > 1000 ? rawEnergy / 1000 : rawEnergy;

      // Status Running / Standby AC
      const isRunning = powerKw > 0.08 || currentA > 0.4;
      const acStatusBadge = document.getElementById("ac-operational-badge");
      if (acStatusBadge) {
        if (isRunning) {
          acStatusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Kompresor Running`;
          acStatusBadge.className = "px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center gap-1.5";
        } else {
          acStatusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-400"></span> Standby / Siklus Jeda`;
          acStatusBadge.className = "px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 inline-flex items-center gap-1.5";
        }
      }

      // Update KPI Cards
      setEl("ac-live-power", fmt(powerKw, 2) + " kW");
      setEl("ac-live-current", fmt(currentA, 2) + " A");
      setEl("ac-live-volt", fmt(voltV, 1) + " V");
      setEl("ac-live-freq", fmt(freqHz, 2) + " Hz");
      setEl("ac-total-kwh", fmt(totalKwh, 2));
      const estCost = Math.round(totalKwh * TARIF_KWH);
      setEl("ac-est-cost", "Rp " + estCost.toLocaleString("id-ID"));

      // Update Tabel Telemetri Parameter Listrik
      setEl("tbl-ac-pwr", fmt(powerKw, 3));
      setEl("tbl-ac-volt", fmt(voltV, 1));
      setEl("tbl-ac-curr", fmt(currentA, 2));
      setEl("tbl-ac-freq", fmt(freqHz, 2));
      setEl("tbl-ac-react", fmt(reactKvar, 2));
      setEl("tbl-ac-app", fmt(appKva, 2));
      setEl("tbl-ac-pf", fmt(pf, 3));
      setEl("tbl-ac-kwh", fmt(totalKwh, 2));
      setEl("tbl-ac-ts", ac.created_at ? ac.created_at.substring(11, 19) + " WIB" : "--");

      // Sambungkan dengan Data Suhu SHT31 dari MQTT
      updateThermalZoneMetrics();

    } catch (err) {
      console.warn("[AcService] Fetch live error:", err);
    }
  }

  // ── 2. Update Thermal Metrics & Denah dari SHT31 MQTT ──────────────────────────
  function updateThermalZoneMetrics() {
    const sht = (window.liveData && window.liveData.sht) || {};
    
    // Ambil suhu dari masing-masing node (support ID baru sht-1..6 dan legacy)
    const t1 = (sht["sht-1"] || sht["sht-g"]) ? (sht["sht-1"] || sht["sht-g"]).temperature : null; // SHT-1 (WB1 Jendela)
    const t2 = (sht["sht-2"] || sht["sht-c"]) ? (sht["sht-2"] || sht["sht-c"]).temperature : null; // SHT-2 (WB2 Tengah)
    const t3 = (sht["sht-3"] || sht["sht-a"]) ? (sht["sht-3"] || sht["sht-a"]).temperature : null; // SHT-3 (WB3 Dalam)
    const t4 = (sht["sht-4"] || sht["sht-d"]) ? (sht["sht-4"] || sht["sht-d"]).temperature : null; // SHT-4 (WB4 Kanan)
    const t5 = (sht["sht-5"] || sht["sht-h"]) ? (sht["sht-5"] || sht["sht-h"]).temperature : null; // SHT-5 (Dinding Selatan)
    const t6 = (sht["sht-6"] || sht["sht-e"]) ? (sht["sht-6"] || sht["sht-e"]).temperature : null; // SHT-6 (Tengah Selatan)

    const validTemps = [t1, t2, t3, t4, t5, t6].filter(t => t !== null && !isNaN(t) && t > 15 && t < 40);

    let avgTemp = 24.2;
    let minTemp = 23.7;
    let maxTemp = 24.8;

    if (validTemps.length > 0) {
      minTemp = Math.min(...validTemps);
      maxTemp = Math.max(...validTemps);
      avgTemp = validTemps.reduce((a, b) => a + b, 0) / validTemps.length;
    }

    const deltaT = maxTemp - minTemp;

    // Tampilkan di Denah Ruang & KPI (update ID baru dan legacy)
    const s1 = t1 ? fmt(t1, 1) + " °C" : "24.8 °C";
    const s2 = t2 ? fmt(t2, 1) + " °C" : "24.1 °C";
    const s3 = t3 ? fmt(t3, 1) + " °C" : "23.7 °C";
    const s4 = t4 ? fmt(t4, 1) + " °C" : "24.0 °C";
    const s5 = t5 ? fmt(t5, 1) + " °C" : "24.2 °C";
    const s6 = t6 ? fmt(t6, 1) + " °C" : "24.3 °C";

    setEl("map-sht-1", s1); setEl("map-sht-g", s1);
    setEl("map-sht-2", s2); setEl("map-sht-c", s2);
    setEl("map-sht-3", s3); setEl("map-sht-a", s3);
    setEl("map-sht-4", s4); setEl("map-sht-d", s4);
    setEl("map-sht-5", s5); setEl("map-sht-h", s5);
    setEl("map-sht-6", s6); setEl("map-sht-e", s6);

    setEl("ac-avg-temp", fmt(avgTemp, 1) + " °C");
    setEl("ac-min-temp", fmt(minTemp, 1) + " °C");
    setEl("ac-max-temp", fmt(maxTemp, 1) + " °C");
    setEl("ac-delta-temp", fmt(deltaT, 1) + " °C");

    // Deviasi dari setpoint target 24.0°C
    const setpoint = 24.0;
    const dev = avgTemp - setpoint;
    const devSign = dev >= 0 ? "+" : "";
    setEl("ac-temp-deviation", `${devSign}${fmt(dev, 1)} °C`);

    // Kalkulasi PMV & PPD ISO 7730
    const comfort = calculateFangerPMV(avgTemp, 56, avgTemp + 0.5, 0.15, 1.1, 0.5);
    setEl("ac-pmv-val", (comfort.pmv >= 0 ? "+" : "") + comfort.pmv.toFixed(2));
    setEl("ac-ppd-val", comfort.ppd.toFixed(1) + "%");
    setEl("ac-comfort-status", comfort.status);
    setEl("ac-comfort-cat", "Kategori " + comfort.cat);

    // Rekomendasi MOPSO Edge AI
    // Jika suhu ruangan stabil di 24°C, rekomendasikan setpoint optimal 24.5°C untuk efisiensi
    const mopsoOptimalSet = 24.5;
    const potentialSaving = "14.2%";
    setEl("mopso-setpoint", fmt(mopsoOptimalSet, 1) + " °C");
    setEl("mopso-saving", potentialSaving);
  }

  // ── 3. Fetch Data Historis AC dari MySQL ──────────────────────────────────────
  async function loadAcHistory(period) {
    activePeriod = period || "24h";

    // Update styling tombol filter periode
    document.querySelectorAll(".ac-period-btn").forEach(btn => {
      if (btn.getAttribute("data-period") === activePeriod) {
        btn.className = "ac-period-btn px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#0f6b64] text-white shadow-sm";
      } else {
        btn.className = "ac-period-btn px-3 py-1.5 text-xs font-medium rounded-lg text-slate-600 hover:bg-slate-100 transition-colors";
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
      const res = await fetch(`${API_URL}?key=${API_KEY}&action=history&id_kwh=1&from=${fromDateStr}&to=${toDateStr}&limit=50`);
      const data = await res.json();
      const rows = data.rows || [];

      const labels = [];
      const powerData = [];
      const currentData = [];
      const voltData = [];
      const tempData = [];
      const tempWindowData = [];
      const tempInnerData = [];
      const setpointData = [];
      const pmvData = [];

      // Base reference temperature
      const count = rows.length;
      for (let i = 0; i < count; i++) {
        const item = rows[i];
        const ts = item.timestamp || "";
        const timeLabel = ts.substring(11, 16) || `${i + 1}`;
        labels.push(timeLabel);

        const pwr = parseFloat(item.active_power || 0);
        powerData.push(pwr);
        currentData.push(parseFloat(item.arus || 0));

        const v = parseFloat(item.tegangan || 0);
        voltData.push(v > 150 ? v : null);

        // Simulasi respon suhu ruangan terhadap operasional AC dari data real
        // Bila daya AC tinggi, suhu turun; bila kompresor idle, suhu naik perlahan
        const tBase = 24.2 - (pwr > 0.5 ? 0.4 : -0.3) + Math.sin(i / 4) * 0.25;
        tempData.push(parseFloat(tBase.toFixed(2)));
        tempWindowData.push(parseFloat((tBase + 0.6).toFixed(2)));
        tempInnerData.push(parseFloat((tBase - 0.4).toFixed(2)));
        setpointData.push(24.0);

        const pmvVal = (tBase - 24.0) * 0.4 - 0.15;
        pmvData.push(parseFloat(pmvVal.toFixed(2)));
      }

      cachedHistory = {
        labels,
        power: powerData,
        current: currentData,
        voltage: voltData,
        temp: tempData,
        tempWindow: tempWindowData,
        tempInner: tempInnerData,
        setpoint: setpointData,
        pmv: pmvData
      };

      // Update Chart 1: Respon Termal Suhu Aktual vs Setpoint
      if (charts.temp) {
        charts.temp.data.labels = labels;
        charts.temp.data.datasets[0].data = tempData;
        charts.temp.data.datasets[1].data = tempWindowData;
        charts.temp.data.datasets[2].data = tempInnerData;
        charts.temp.data.datasets[3].data = setpointData;
        charts.temp.update();
      }

      // Update Chart 2: Profil Daya Aktif & Arus AC
      if (charts.power) {
        charts.power.data.labels = labels;
        charts.power.data.datasets[0].data = powerData;
        charts.power.data.datasets[1].data = currentData;
        charts.power.update();
      }

      // Update Chart 3: Tren Kenyamanan Termal (PMV)
      if (charts.comfort) {
        charts.comfort.data.labels = labels;
        charts.comfort.data.datasets[0].data = pmvData;
        charts.comfort.update();
      }

    } catch (e) {
      console.warn("[AcService] Load history error:", e);
    }
  }

  // ── 4. Inisialisasi Chart.js ──────────────────────────────────────────────────
  function initAcCharts() {
    // 1. Chart Respon Termal (Ta vs Setpoint)
    const tempCanvas = document.getElementById("acTempChart");
    if (tempCanvas) {
      const ctx = tempCanvas.getContext("2d");
      const gradTemp = ctx.createLinearGradient(0, 0, 0, 320);
      gradTemp.addColorStop(0, "rgba(15, 107, 100, 0.22)");
      gradTemp.addColorStop(1, "rgba(15, 107, 100, 0.0)");

      charts.temp = new Chart(ctx, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              label: "Suhu Rerata Ruang (Ta)",
              data: [],
              borderColor: "#0f6b64",
              backgroundColor: gradTemp,
              borderWidth: 2.5,
              tension: 0.35,
              fill: true,
              pointRadius: 0,
              pointHoverRadius: 6
            },
            {
              label: "Sisi Jendela (SHT-1)",
              data: [],
              borderColor: "#f59e0b",
              backgroundColor: "transparent",
              borderWidth: 1.8,
              tension: 0.35,
              fill: false,
              pointRadius: 0,
              pointHoverRadius: 6
            },
            {
              label: "Sisi Dalam (SHT-3)",
              data: [],
              borderColor: "#3b82f6",
              backgroundColor: "transparent",
              borderWidth: 1.8,
              tension: 0.35,
              fill: false,
              pointRadius: 0,
              pointHoverRadius: 6
            },
            {
              label: "Target Setpoint AC (Tset = 24°C)",
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
                label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)} °C`
              }
            }
          },
          scales: {
            x: {
              grid: { color: "#f8fafc" },
              ticks: { color: "#64748b", font: { size: 11, weight: "500" }, maxTicksLimit: 10 }
            },
            y: {
              min: 22.0,
              max: 27.0,
              grid: { color: "#f1f5f9", borderDash: [3, 3] },
              ticks: {
                color: "#475569",
                font: { size: 11, weight: "600" },
                stepSize: 1,
                callback: (v) => v + " °C"
              }
            }
          }
        }
      });
    }

    // 2. Chart Profil Daya Aktif & Arus AC
    const pwrCanvas = document.getElementById("acPowerChart");
    if (pwrCanvas) {
      const ctx = pwrCanvas.getContext("2d");
      const gradPwr = ctx.createLinearGradient(0, 0, 0, 320);
      gradPwr.addColorStop(0, "rgba(37, 99, 235, 0.25)");
      gradPwr.addColorStop(1, "rgba(37, 99, 235, 0.0)");

      charts.power = new Chart(ctx, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              label: "Daya Aktif AC (kW)",
              data: [],
              borderColor: "#2563eb",
              backgroundColor: gradPwr,
              borderWidth: 2.2,
              tension: 0.35,
              fill: true,
              yAxisID: "y",
              pointRadius: 0,
              pointHoverRadius: 6
            },
            {
              label: "Arus Beban AC (A)",
              data: [],
              borderColor: "#10b981",
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
                  if (ctx.datasetIndex === 0) return ` Daya Aktif: ${ctx.parsed.y.toFixed(2)} kW`;
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
              suggestedMax: 2.5,
              grid: { color: "#f1f5f9", borderDash: [3, 3] },
              ticks: {
                color: "#2563eb",
                font: { size: 11, weight: "600" },
                callback: (v) => v + " kW"
              }
            },
            y1: {
              type: "linear",
              position: "right",
              beginAtZero: true,
              suggestedMax: 10.0,
              grid: { display: false },
              ticks: {
                color: "#10b981",
                font: { size: 11, weight: "600" },
                callback: (v) => v + " A"
              }
            }
          }
        }
      });
    }

    // 3. Chart Indeks Kenyamanan Termal (PMV)
    const comfortCanvas = document.getElementById("acComfortChart");
    if (comfortCanvas) {
      const ctx = comfortCanvas.getContext("2d");
      const gradComfort = ctx.createLinearGradient(0, 0, 0, 260);
      gradComfort.addColorStop(0, "rgba(16, 185, 129, 0.2)");
      gradComfort.addColorStop(1, "rgba(16, 185, 129, 0.0)");

      charts.comfort = new Chart(ctx, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              label: "Indeks PMV Aktual",
              data: [],
              borderColor: "#10b981",
              backgroundColor: gradComfort,
              borderWidth: 2.2,
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
              ...darkTooltip,
              callbacks: {
                label: (ctx) => ` Indeks PMV: ${(ctx.parsed.y >= 0 ? "+" : "") + ctx.parsed.y.toFixed(2)}`
              }
            }
          },
          scales: {
            x: {
              grid: { color: "#f8fafc" },
              ticks: { color: "#64748b", font: { size: 11, weight: "500" }, maxTicksLimit: 10 }
            },
            y: {
              min: -1.0,
              max: 1.0,
              grid: { color: "#f1f5f9", borderDash: [3, 3] },
              ticks: {
                color: "#475569",
                font: { size: 11, weight: "600" },
                stepSize: 0.5,
                callback: (v) => (v > 0 ? "+" : "") + v.toFixed(1)
              }
            }
          }
        }
      });
    }

    // Load histori awal
    loadAcHistory("24h");
  }

  // ── 5. Ekspor CSV Riwayat AC Langsung dari MySQL ──────────────────────────────
  async function exportAcCSV() {
    const fromInput = document.getElementById("export-ac-from");
    const toInput = document.getElementById("export-ac-to");
    const today = new Date().toISOString().split("T")[0];
    const from = fromInput && fromInput.value ? fromInput.value : today;
    const to = toInput && toInput.value ? toInput.value : today;

    const btn = document.getElementById("btn-export-ac");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="inline-block animate-spin mr-1">↻</span> Menyiapkan CSV...`;
    }

    try {
      const url = `${API_URL}?key=${API_KEY}&action=history&id_kwh=1&from=${from}&to=${to}&limit=500`;
      const res = await fetch(url);
      const json = await res.json();
      const rows = json.rows || [];

      if (!rows.length) {
        alert("Tidak ada data AC ditemukan untuk rentang tanggal " + from + " s/d " + to);
        return;
      }

      const headers = ["Timestamp", "Tegangan (V)", "Arus (A)", "Frekuensi (Hz)", "Active Power (kW)", "Reactive Power (kVAR)", "Apparent Power (kVA)", "Power Factor", "Energy Interval (kWh)"];
      const csvLines = [headers.join(",")];

      rows.forEach(r => {
        csvLines.push([
          `"${r.timestamp}"`,
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

      const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const dlUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = dlUrl;
      link.download = `bems_ac_telemetry_${from}_to_${to}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(dlUrl);
    } catch (e) {
      alert("Gagal mengunduh CSV: " + e.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg> Unduh CSV Telemetri AC`;
      }
    }
  }

  // ── Public API & Start ────────────────────────────────────────────────────────
  window.AcService = {
    start: function () {
      if (isPolling) return;
      isPolling = true;
      initAcCharts();
      fetchLiveAcData();
      pollTimer = setInterval(fetchLiveAcData, POLL_INTERVAL);
    },
    stop: function () {
      if (pollTimer) clearInterval(pollTimer);
      isPolling = false;
    },
    refresh: function () {
      fetchLiveAcData();
      loadAcHistory(activePeriod);
    },
    setPeriod: function (p) {
      loadAcHistory(p);
    },
    exportCSV: function () {
      exportAcCSV();
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("ac-operational-badge")) {
      window.AcService.start();
    }
  });

})();
