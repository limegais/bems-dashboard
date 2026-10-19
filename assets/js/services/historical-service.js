/**
 * BEMS Dashboard — Historical Data & Trends Service
 * Mengelola analitik historis multi-parameter BEMS Living Lab:
 * - Submeter PZEM-004T Ch-1 (AC), Ch-2 (Stop Kontak), Ch-3 (Lampu)
 * - Sensor Lingkungan SHT31 (Indoor) & Stasiun Cuaca NNZN RS485 (Outdoor)
 * - Filter periode: 24 Jam, 7 Hari, 30 Hari, dan Rentang Kustom
 * - Visualisasi Chart.js: Profil Beban Energi Stacked & Korelasi Multivariat
 * - Ekspor Dataset CSV Otomatis
 */

(function () {
  "use strict";

  const TARIF_KWH = 1500; // Rp/kWh (PLN B-2/TR)
  const EMISI_FACTOR = 0.85; // kg CO2 / kWh

  const state = {
    period: "7d", // "24h" | "7d" | "30d" | "custom"
    submeterFilter: "all", // "all" | "ac" | "outlet" | "lamp"
    envFilter: "all",
    startDate: "2026-10-06",
    endDate: "2026-10-13",
    tablePage: 1,
    tablePageSize: 8,
    records: [],
    kpis: {
      totalKwh: 248.64,
      peakWatt: 3420,
      peakTime: "13:15 WIB",
      avgWatt: 1478,
      totalCost: 372960,
      totalCo2: 211.34,
      avgIndoorTemp: 24.2,
      avgOutdoorTemp: 31.4,
      avgSolarRad: 485
    }
  };

  const charts = {
    energyProfile: null,
    envTrends: null
  };

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

  // ── 1. Synthetic / Historical Generator Engine ────────────────────────────────
  // Menghasilkan dataset realistis berbasis siklus termal dan pola operasional lab
  function generateHistoricalDataset(period) {
    const records = [];
    let count = 24;
    let labelFmt = "hour";

    if (period === "24h") {
      count = 24;
      labelFmt = "hour";
    } else if (period === "7d") {
      count = 7;
      labelFmt = "day";
    } else if (period === "30d") {
      count = 30;
      labelFmt = "day";
    } else {
      count = 14;
      labelFmt = "day";
    }

    const now = new Date();

    if (labelFmt === "hour") {
      for (let i = 23; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 3600000);
        const hour = d.getHours();
        const timeLabel = `${String(hour).padStart(2, "0")}:00`;

        // Pola beban kerja harian (Jam 08:00 - 17:00 beban naik)
        const isOccupied = hour >= 8 && hour <= 17;
        const occFactor = isOccupied ? (1.0 + Math.sin((hour - 8) / 9 * Math.PI) * 0.8) : 0.25;

        // Radiasi matahari puncaknya jam 11:00 - 13:00
        const solar = (hour >= 6 && hour <= 18) ? Math.round(Math.max(0, Math.sin((hour - 6) / 12 * Math.PI) * 880 + (Math.random() * 50 - 25))) : 0;
        const outdoorTemp = parseFloat((26.0 + (solar / 880) * 7.5 + (Math.random() * 0.4 - 0.2)).toFixed(1));
        const outdoorRh = Math.round(85 - (solar / 880) * 35 + (Math.random() * 4 - 2));

        // Beban Listrik (AC merespons suhu luar dan okupansi)
        const acWatt = isOccupied ? Math.round(1200 + (solar / 880) * 1100 + (Math.random() * 120 - 60)) : Math.round(180 + Math.random() * 40);
        const outletWatt = isOccupied ? Math.round(480 + Math.random() * 140) : Math.round(210 + Math.random() * 20);
        const lampWatt = isOccupied ? Math.round(220 + (solar > 400 ? -70 : 0) + Math.random() * 30) : 15;
        const totalWatt = acWatt + outletWatt + lampWatt;

        const indoorTemp = parseFloat((23.8 + (isOccupied ? 0.4 : 0) + (solar > 600 ? 0.3 : 0) + (Math.random() * 0.2 - 0.1)).toFixed(1));
        const indoorRh = Math.round(58 + (isOccupied ? 2 : 0) + (Math.random() * 2 - 1));

        records.push({
          timestamp: `${d.toISOString().slice(0, 10)} ${timeLabel}`,
          label: timeLabel,
          acWatt,
          outletWatt,
          lampWatt,
          totalWatt,
          indoorTemp,
          indoorRh,
          outdoorTemp,
          outdoorRh,
          solarRad: solar
        });
      }
    } else {
      // Per hari (Daily records)
      for (let i = count - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000);
        const dayLabel = d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        const workFactor = isWeekend ? 0.35 : 1.0;

        const solarAvg = Math.round((420 + Math.random() * 140) * (isWeekend ? 1.0 : 1.0));
        const outdoorTempAvg = parseFloat((30.8 + Math.random() * 1.6).toFixed(1));
        const indoorTempAvg = parseFloat((24.1 + Math.random() * 0.4).toFixed(1));

        const acDailyKwh = parseFloat(((isWeekend ? 6.2 : 23.5) + (Math.random() * 2.8 - 1.4)).toFixed(2));
        const outletDailyKwh = parseFloat(((isWeekend ? 3.8 : 8.4) + (Math.random() * 0.8 - 0.4)).toFixed(2));
        const lampDailyKwh = parseFloat(((isWeekend ? 0.8 : 3.6) + (Math.random() * 0.4 - 0.2)).toFixed(2));
        const totalDailyKwh = parseFloat((acDailyKwh + outletDailyKwh + lampDailyKwh).toFixed(2));

        // Rata-rata beban daya harian (W)
        const totalWatt = Math.round((totalDailyKwh * 1000) / 24);
        const acWatt = Math.round((acDailyKwh * 1000) / 24);
        const outletWatt = Math.round((outletDailyKwh * 1000) / 24);
        const lampWatt = Math.round((lampDailyKwh * 1000) / 24);

        records.push({
          timestamp: d.toISOString().slice(0, 10),
          label: dayLabel,
          acDailyKwh,
          outletDailyKwh,
          lampDailyKwh,
          totalDailyKwh,
          acWatt,
          outletWatt,
          lampWatt,
          totalWatt,
          indoorTemp: indoorTempAvg,
          indoorRh: 58,
          outdoorTemp: outdoorTempAvg,
          outdoorRh: 68,
          solarRad: solarAvg
        });
      }
    }

    return records;
  }

  // ── 2. Update KPI Summary Metrics ─────────────────────────────────────────────
  function updateKPIs() {
    const isHourly = state.period === "24h";
    let sumTotalKwh = 0;
    let maxWatt = 0;
    let peakTs = "--";
    let sumWatt = 0;
    let sumInTemp = 0;
    let sumOutTemp = 0;
    let sumSolar = 0;

    state.records.forEach(r => {
      if (isHourly) {
        sumTotalKwh += (r.totalWatt / 1000); // 1 jam = W/1000 kWh
      } else {
        sumTotalKwh += (r.totalDailyKwh || (r.totalWatt * 24 / 1000));
      }

      if (r.totalWatt > maxWatt) {
        maxWatt = r.totalWatt;
        peakTs = r.label;
      }
      sumWatt += r.totalWatt;
      sumInTemp += r.indoorTemp;
      sumOutTemp += r.outdoorTemp;
      sumSolar += r.solarRad;
    });

    const len = state.records.length || 1;
    const avgWatt = Math.round(sumWatt / len);
    const avgInTemp = parseFloat((sumInTemp / len).toFixed(1));
    const avgOutTemp = parseFloat((sumOutTemp / len).toFixed(1));
    const avgSolar = Math.round(sumSolar / len);
    const totalCost = Math.round(sumTotalKwh * TARIF_KWH);
    const totalCo2 = parseFloat((sumTotalKwh * EMISI_FACTOR).toFixed(1));

    state.kpis = {
      totalKwh: parseFloat(sumTotalKwh.toFixed(2)),
      peakWatt: maxWatt,
      peakTime: peakTs,
      avgWatt,
      totalCost,
      totalCo2,
      avgIndoorTemp: avgInTemp,
      avgOutdoorTemp: avgOutTemp,
      avgSolarRad: avgSolar
    };

    setEl("kpi-hist-energy", `${fmt(state.kpis.totalKwh, 1)} kWh`);
    setEl("kpi-hist-peak", `${state.kpis.peakWatt.toLocaleString("id-ID")} W`);
    setEl("kpi-hist-peak-time", `Puncak pada ${state.kpis.peakTime}`);
    setEl("kpi-hist-avg", `${state.kpis.avgWatt.toLocaleString("id-ID")} W`);
    setEl("kpi-hist-cost", `Rp ${state.kpis.totalCost.toLocaleString("id-ID")}`);
    setEl("kpi-hist-co2", `${fmt(state.kpis.totalCo2, 1)} kg CO₂`);
  }

  // ── 3. Master Chart 1: Energy Load Profile (Stacked Area / Multi-line) ────────
  function updateEnergyChart() {
    const canvas = document.getElementById("chart-hist-energy");
    if (!canvas) return;

    const labels = state.records.map(r => r.label);
    const isHourly = state.period === "24h";

    const acData = state.records.map(r => isHourly ? r.acWatt : (r.acDailyKwh || Math.round(r.acWatt * 24 / 1000)));
    const outletData = state.records.map(r => isHourly ? r.outletWatt : (r.outletDailyKwh || Math.round(r.outletWatt * 24 / 1000)));
    const lampData = state.records.map(r => isHourly ? r.lampWatt : (r.lampDailyKwh || Math.round(r.lampWatt * 24 / 1000)));
    const totalData = state.records.map(r => isHourly ? r.totalWatt : (r.totalDailyKwh || Math.round(r.totalWatt * 24 / 1000)));

    const yUnit = isHourly ? "Demand (Watts)" : "Energy (kWh/day)";

    if (charts.energyProfile) {
      charts.energyProfile.data.labels = labels;
      charts.energyProfile.data.datasets[0].data = acData;
      charts.energyProfile.data.datasets[1].data = outletData;
      charts.energyProfile.data.datasets[2].data = lampData;
      charts.energyProfile.data.datasets[3].data = totalData;
      charts.energyProfile.options.scales.y.title.text = yUnit;
      charts.energyProfile.update();
      return;
    }

    charts.energyProfile = new Chart(canvas, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Submeter 1: AC (HVAC)",
            data: acData,
            borderColor: "#0d9488",
            backgroundColor: "rgba(13, 148, 136, 0.22)",
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 5,
            fill: true,
            tension: 0.35
          },
          {
            label: "Submeter 2: Stop Kontak & IT",
            data: outletData,
            borderColor: "#4f46e5",
            backgroundColor: "rgba(79, 70, 229, 0.15)",
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 5,
            fill: true,
            tension: 0.35
          },
          {
            label: "Submeter 3: Lampu / Lighting",
            data: lampData,
            borderColor: "#f59e0b",
            backgroundColor: "rgba(245, 158, 11, 0.15)",
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 5,
            fill: true,
            tension: 0.35
          },
          {
            label: "Total Aggregated Demand",
            data: totalData,
            borderColor: "#0f172a",
            backgroundColor: "transparent",
            borderWidth: 2.5,
            borderDash: [4, 4],
            pointRadius: 3,
            pointHoverRadius: 6,
            fill: false,
            tension: 0.35
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            grid: { color: "rgba(226, 232, 240, 0.6)" },
            ticks: { font: { size: 10, family: "Source Sans 3" }, color: "#475569" }
          },
          y: {
            title: {
              display: true,
              text: yUnit,
              color: "#64748b",
              font: { family: "Source Sans 3", size: 11, weight: "bold" }
            },
            grid: { color: "rgba(226, 232, 240, 0.6)" },
            ticks: {
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
                const unit = isHourly ? "W" : "kWh";
                return `${ctx.dataset.label}: ${fmt(ctx.parsed.y, isHourly ? 0 : 2)} ${unit}`;
              }
            }
          }
        }
      }
    });
  }

  // ── 4. Master Chart 2: Environmental Trends (Indoor vs Outdoor Correlation) ──
  function updateEnvTrendsChart() {
    const canvas = document.getElementById("chart-hist-env");
    if (!canvas) return;

    const labels = state.records.map(r => r.label);
    const inTempData = state.records.map(r => r.indoorTemp);
    const outTempData = state.records.map(r => r.outdoorTemp);
    const solarData = state.records.map(r => r.solarRad);
    const rhData = state.records.map(r => r.indoorRh);

    if (charts.envTrends) {
      charts.envTrends.data.labels = labels;
      charts.envTrends.data.datasets[0].data = inTempData;
      charts.envTrends.data.datasets[1].data = outTempData;
      charts.envTrends.data.datasets[2].data = solarData;
      charts.envTrends.data.datasets[3].data = rhData;
      charts.envTrends.update();
      return;
    }

    charts.envTrends = new Chart(canvas, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Indoor Temp (SHT31) °C",
            data: inTempData,
            borderColor: "#0d9488",
            backgroundColor: "#0d9488",
            borderWidth: 2.2,
            pointRadius: 2,
            pointHoverRadius: 5,
            yAxisID: "y",
            tension: 0.3
          },
          {
            label: "Outdoor Temp (NNZN) °C",
            data: outTempData,
            borderColor: "#f97316",
            backgroundColor: "#f97316",
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 5,
            yAxisID: "y",
            tension: 0.3
          },
          {
            type: "bar",
            label: "Radiasi Surya (W/m²)",
            data: solarData,
            backgroundColor: "rgba(250, 204, 21, 0.45)",
            borderColor: "#eab308",
            borderWidth: 1,
            borderRadius: 4,
            yAxisID: "y1"
          },
          {
            label: "Indoor Humidity (%RH)",
            data: rhData,
            borderColor: "#3b82f6",
            backgroundColor: "transparent",
            borderWidth: 1.5,
            borderDash: [3, 3],
            pointRadius: 0,
            yAxisID: "y",
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            grid: { color: "rgba(226, 232, 240, 0.6)" },
            ticks: { font: { size: 10, family: "Source Sans 3" }, color: "#475569" }
          },
          y: {
            min: 20,
            max: 38,
            title: {
              display: true,
              text: "Suhu (°C) & Kelembapan (%)",
              color: "#64748b",
              font: { family: "Source Sans 3", size: 11, weight: "bold" }
            },
            grid: { color: "rgba(226, 232, 240, 0.6)" },
            ticks: {
              stepSize: 4,
              font: { size: 10, family: "Source Sans 3" },
              color: "#64748b"
            }
          },
          y1: {
            position: "right",
            min: 0,
            max: 1000,
            title: {
              display: true,
              text: "Radiasi Matahari (W/m²)",
              color: "#ca8a04",
              font: { family: "Source Sans 3", size: 11, weight: "bold" }
            },
            grid: { display: false },
            ticks: {
              stepSize: 200,
              font: { size: 10, family: "Source Sans 3" },
              color: "#ca8a04"
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
                if (ctx.dataset.label.includes("Radiasi")) {
                  return `${ctx.dataset.label}: ${ctx.parsed.y} W/m²`;
                } else if (ctx.dataset.label.includes("RH")) {
                  return `${ctx.dataset.label}: ${ctx.parsed.y} %`;
                }
                return `${ctx.dataset.label}: ${fmt(ctx.parsed.y, 1)} °C`;
              }
            }
          }
        }
      }
    });
  }

  // ── 5. Render Historical Table with Pagination ────────────────────────────────
  function renderTable() {
    const tbody = document.getElementById("hist-tbody");
    if (!tbody) return;

    const startIdx = (state.tablePage - 1) * state.tablePageSize;
    const pageRecords = state.records.slice(startIdx, startIdx + state.tablePageSize);
    const isHourly = state.period === "24h";

    tbody.innerHTML = pageRecords.map(r => {
      const acVal = isHourly ? `${r.acWatt.toLocaleString("id-ID")} W` : `${fmt(r.acDailyKwh, 2)} kWh`;
      const outletVal = isHourly ? `${r.outletWatt.toLocaleString("id-ID")} W` : `${fmt(r.outletDailyKwh, 2)} kWh`;
      const lampVal = isHourly ? `${r.lampWatt.toLocaleString("id-ID")} W` : `${fmt(r.lampDailyKwh, 2)} kWh`;
      const totalVal = isHourly ? `${r.totalWatt.toLocaleString("id-ID")} W` : `${fmt(r.totalDailyKwh, 2)} kWh`;

      let badge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-teal-50 text-teal-700 border border-teal-200">Normal</span>`;
      if (r.totalWatt > 2800) {
        badge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">Puncak</span>`;
      } else if (r.totalWatt > 1800) {
        badge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Menengah</span>`;
      }

      return `
        <tr class="border-b border-slate-100 hover:bg-slate-50/70 transition-colors">
          <td class="py-3 px-4 font-mono font-semibold text-slate-800 text-xs">${r.timestamp}</td>
          <td class="py-3 px-4 font-mono text-teal-700 font-semibold text-xs">${acVal}</td>
          <td class="py-3 px-4 font-mono text-indigo-700 font-semibold text-xs">${outletVal}</td>
          <td class="py-3 px-4 font-mono text-amber-700 font-semibold text-xs">${lampVal}</td>
          <td class="py-3 px-4 font-mono text-slate-900 font-bold text-xs">${totalVal}</td>
          <td class="py-3 px-4 font-mono text-slate-700 text-xs">${fmt(r.indoorTemp, 1)} °C</td>
          <td class="py-3 px-4 font-mono text-slate-700 text-xs">${fmt(r.outdoorTemp, 1)} °C</td>
          <td class="py-3 px-4 font-mono text-amber-800 text-xs">${r.solarRad} W/m²</td>
          <td class="py-3 px-4">${badge}</td>
        </tr>
      `;
    }).join("");

    const totalPages = Math.ceil(state.records.length / state.tablePageSize) || 1;
    setEl("hist-page-info", `Halaman ${state.tablePage} dari ${totalPages} (${state.records.length} data)`);

    const prevBtn = document.getElementById("btn-hist-prev");
    const nextBtn = document.getElementById("btn-hist-next");
    if (prevBtn) prevBtn.disabled = state.tablePage <= 1;
    if (nextBtn) nextBtn.disabled = state.tablePage >= totalPages;
  }

  // ── 6. CSV Export Generator ───────────────────────────────────────────────────
  function exportCSV() {
    const isHourly = state.period === "24h";
    let csv = "Timestamp,PZEM_AC_Value,PZEM_Outlet_Value,PZEM_Lamp_Value,Total_Energy_Value,Indoor_Temp_C,Indoor_RH_Pct,Outdoor_Temp_C,Solar_Radiation_Wm2\n";

    state.records.forEach(r => {
      const acVal = isHourly ? r.acWatt : r.acDailyKwh;
      const outletVal = isHourly ? r.outletWatt : r.outletDailyKwh;
      const lampVal = isHourly ? r.lampWatt : r.lampDailyKwh;
      const totalVal = isHourly ? r.totalWatt : r.totalDailyKwh;

      csv += `"${r.timestamp}",${acVal},${outletVal},${lampVal},${totalVal},${r.indoorTemp},${r.indoorRh},${r.outdoorTemp},${r.solarRad}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bems_livinglab_historical_${state.period}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── 7. Setup Filter Controls & Event Handlers ─────────────────────────────────
  function applyPeriod(newPeriod) {
    state.period = newPeriod;
    state.tablePage = 1;

    // Update button states
    document.querySelectorAll(".hist-period-btn").forEach(btn => {
      if (btn.getAttribute("data-period") === newPeriod) {
        btn.className = "hist-period-btn px-3 py-1.5 rounded-xl text-xs font-bold font-mono bg-teal-800 text-white shadow-2xs transition-all";
      } else {
        btn.className = "hist-period-btn px-3 py-1.5 rounded-xl text-xs font-semibold font-mono bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all";
      }
    });

    // Generate new dataset
    state.records = generateHistoricalDataset(newPeriod);
    updateKPIs();
    updateEnergyChart();
    updateEnvTrendsChart();
    renderTable();
  }

  function setupEvents() {
    // Period buttons
    document.querySelectorAll(".hist-period-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        applyPeriod(btn.getAttribute("data-period"));
      });
    });

    // Apply Filter Button
    const btnApply = document.getElementById("btn-hist-apply");
    if (btnApply) {
      btnApply.addEventListener("click", () => {
        const selSub = document.getElementById("hist-submeter-select");
        if (selSub) state.submeterFilter = selSub.value;

        applyPeriod(state.period);
      });
    }

    // Pagination
    const prevBtn = document.getElementById("btn-hist-prev");
    const nextBtn = document.getElementById("btn-hist-next");
    if (prevBtn) {
      prevBtn.addEventListener("click", () => {
        if (state.tablePage > 1) {
          state.tablePage--;
          renderTable();
        }
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        const totalPages = Math.ceil(state.records.length / state.tablePageSize);
        if (state.tablePage < totalPages) {
          state.tablePage++;
          renderTable();
        }
      });
    }

    // Export CSV
    const btnExport = document.getElementById("btn-hist-export");
    if (btnExport) {
      btnExport.addEventListener("click", exportCSV);
    }
  }

  // ── 8. Public Initialization ──────────────────────────────────────────────────
  function init() {
    state.records = generateHistoricalDataset(state.period);
    updateKPIs();
    updateEnergyChart();
    updateEnvTrendsChart();
    renderTable();
    setupEvents();
  }

  window.HistoricalService = {
    init,
    applyPeriod,
    exportCSV
  };

  document.addEventListener("DOMContentLoaded", init);
})();
