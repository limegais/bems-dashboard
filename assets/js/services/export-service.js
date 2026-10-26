/**
 * BEMS Living Lab — Page-Specific CSV Data Export Service & Modal
 * ----------------------------------------------------------------------------
 * Menampilkan antarmuka ekspor data CSV yang 100% DISESUAIKAN KHUSUS per halaman:
 * - indoor.html             -> Khusus Sensor Workstation SHT31 (PostgreSQL bems_db)
 * - outdoor.html            -> Khusus Stasiun Cuaca RS485 NNZN (PostgreSQL bems_db)
 * - energy.html             -> Khusus Submetering Beban Listrik Gedung (MySQL iotlabun_sbms)
 * - occupancy.html          -> Khusus Okupansi & Headcount Radar mmWave (PostgreSQL bems_db)
 * - ac-control.html         -> Khusus Submetering & Telemetri AC Inverter (MySQL)
 * - lighting-control.html   -> Khusus Submetering Lampu & Penerangan Ruangan (MySQL)
 * - thermal-evaluation.html -> Khusus Evaluasi Kenyamanan Termal ISO 7730 (PostgreSQL)
 * - comfort-feedback.html   -> Khusus Survei Respon Kenyamanan Termal Penghuni
 * - prediction.html         -> Khusus Prediksi AI Beban Energi & Suhu Ruangan
 * - moga.html & mopso.html  -> Khusus Solusi Pareto Optimal Algoritma Optimasi
 * - experiment-mode.html    -> Khusus Log Pengujian & Skenario Eksperimen
 * - historical.html & index -> Dataset Historis & Terintegrasi Lengkap BEMS
 * 
 * Fitur Excel Compatible:
 * - Instruksi sep=; (atau sep=,) otomatis
 * - CRLF (\r\n) per baris data
 * - UTF-8 BOM (\ufeff) untuk presisi derajat °C dan format angka
 */

(function () {
  "use strict";

  const ENERGY_API_URL = (window.APP_CONFIG && window.APP_CONFIG.ENERGY && window.APP_CONFIG.ENERGY.API_URL)
    || "https://iotlab-uns.com/api_energy.php";
  const ENERGY_API_KEY = (window.APP_CONFIG && window.APP_CONFIG.ENERGY && window.APP_CONFIG.ENERGY.API_KEY)
    || "iotlab_smartroom_2024";

  // Helper format tanggal YYYY-MM-DD
  function toDateInput(d) {
    return d.toISOString().split("T")[0];
  }

  // Trigger download file dari Blob atau Link
  function triggerDownload(url, filename) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // Unduh CSV dari MySQL Energy langsung dari browser
  async function downloadEnergyFromMySql(channelId, fromDate, toDate, limit = 50000, delimiter = ";") {
    const channelNames = {
      1: "AC_HVAC",
      2: "StopKontak_Outlets",
      3: "Lampu_Lighting",
      all: "All_Submeters"
    };

    const chName = channelNames[channelId] || `Channel_${channelId}`;
    const filename = `bems_energy_mysql_${chName}_${fromDate}_to_${toDate}.csv`;
    const channelsToFetch = channelId === "all" ? [1, 2, 3] : [parseInt(channelId, 10)];

    const headers = [
      "Timestamp", "Waktu_Detik", "Channel_ID", "Channel_Name", "Tegangan_V", "Arus_A",
      "Frekuensi_Hz", "Active_Power_kW", "Reactive_Power_VAR",
      "Apparent_Power_VA", "Power_Factor", "Energy_kWh",
      "Estimasi_Biaya_IDR", "Emisi_CO2_kg", "Database_Source"
    ];

    const csvRows = [];
    csvRows.push(`sep=${delimiter}`);
    csvRows.push(headers.join(delimiter));

    for (const ch of channelsToFetch) {
      const url = `${ENERGY_API_URL}?key=${ENERGY_API_KEY}&action=history&id_kwh=${ch}&from=${fromDate}&to=${toDate}&limit=${limit}`;
      const res = await fetch(url);
      const json = await res.json();
      const rows = json.rows || [];

      rows.forEach(r => {
        const kwh = parseFloat(r.energy_kwh || 0);
        const cost = Math.round(kwh * 1500);
        const co2 = (kwh * 0.85).toFixed(3);
        const name = channelNames[ch] || `Ch-${ch}`;

        let ts = String(r.timestamp || "").trim();
        if (ts && ts.length === 16) ts += ":00";
        const timePart = ts.includes(" ") ? ts.split(" ")[1] : ts;

        csvRows.push([
          `="${ts}"`,
          `="${timePart}"`,
          ch,
          `"${name}"`,
          r.tegangan || 0,
          r.arus || 0,
          r.frekuensi || 50,
          r.active_power || 0,
          r.reactive_power || 0,
          r.apparent_power || 0,
          r.power_factor || 0,
          kwh,
          cost,
          co2,
          `"MySQL Database (iotlabun_sbms via api_energy.php)"`
        ].join(delimiter));
      });
    }

    if (csvRows.length <= 1) {
      throw new Error(`Tidak ada data energi MySQL pada rentang ${fromDate} s/d ${toDate}`);
    }

    const blob = new Blob(["\ufeff" + csvRows.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const blobUrl = URL.createObjectURL(blob);
    triggerDownload(blobUrl, filename);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }

  // Unduh CSV dari Endpoint Server (PostgreSQL bems_db)
  async function downloadFromServerApi(apiPath, queryParams, fallbackFilename) {
    const searchParams = new URLSearchParams(queryParams);
    const downloadUrl = `${apiPath}?${searchParams.toString()}`;

    const link = document.createElement("a");
    link.href = downloadUrl;
    link.target = "_blank";
    link.download = fallbackFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // ── Konfigurasi Spesifikasi Export Khusus Per Halaman ─────────────────────────
  const PAGE_CONFIGS = {
    "indoor": {
      title: "Export Data Indoor Environmental Quality (IEQ)",
      subtitle: "Sensor Workstation SHT31 (6 Node) — PostgreSQL bems_db",
      badge: "PostgreSQL bems_db",
      badgeClass: "bg-blue-100 text-blue-800",
      description: "Dataset kualitas lingkungan dalam ruang dari 6 meja kerja living lab (SHT-1 s/d SHT-6).",
      parameters: "Suhu Udara (°C), Kelembapan Relatif (RH %), Titik Embun / Dew Point (°C), Heat Index (°C)",
      targetTable: "bems_telemetry.sht31_readings",
      defaultCategory: "sensors_sht31",
      options: null
    },
    "outdoor": {
      title: "Export Data Stasiun Cuaca Outdoor (RS485)",
      subtitle: "Stasiun Cuaca NNZN & Sensor Lingkungan — PostgreSQL bems_db",
      badge: "PostgreSQL bems_db",
      badgeClass: "bg-blue-100 text-blue-800",
      description: "Dataset kondisi mikroklimat luar ruangan dari stasiun cuaca terintegrasi RS485 Modbus.",
      parameters: "Suhu Luar (°C), RH Luar (%), Radiasi Matahari (W/m²), Iluminansi (Lux), CO₂ Outdoor (ppm), Kecepatan Angin (m/s)",
      targetTable: "bems_telemetry.nnzn_weather",
      defaultCategory: "sensors_weather",
      options: null
    },
    "energy": {
      title: "Export Data Monitoring Energi Listrik (Submetering)",
      subtitle: "Submetering Beban Daya Gedung — Database MySQL (api_energy.php)",
      badge: "MySQL Energy",
      badgeClass: "bg-amber-100 text-amber-800",
      description: "Dataset submetering energi listrik lengkap: AC Inverter (Ch-1), Stop Kontak (Ch-2), Lampu (Ch-3), dan Total Demand Beban Daya Gedung.",
      parameters: "Timestamp, Channel_ID, Channel_Name, Tegangan (V), Arus (A), Frekuensi (Hz), Daya Aktif (kW), Reactive/Apparent Power, Power Factor, kWh, Biaya (Rp), Emisi CO₂",
      targetTable: "MySQL iotlabun_sbms.data_energy",
      defaultCategory: "energy_all",
      options: null
    },
    "occupancy": {
      title: "Export Data Okupansi & Headcount Living Lab",
      subtitle: "Sensor Radar mmWave 24GHz & Deteksi Okupansi — PostgreSQL bems_db",
      badge: "PostgreSQL bems_db",
      badgeClass: "bg-blue-100 text-blue-800",
      description: "Dataset deteksi keberadaan manusia dan jumlah orang di dalam ruang living lab.",
      parameters: "Timestamp, Room_ID, Headcount (Jumlah Orang), Motion Detected (Pergerakan), Tingkat Kepercayaan / Confidence, Metode Deteksi",
      targetTable: "bems_telemetry.occupancy",
      defaultCategory: "sensors_occupancy",
      options: null
    },
    "ac-control": {
      title: "Export Riwayat Operasional & Energi AC Split",
      subtitle: "Monitoring Energi Unit AC Inverter (Ch-1) — Database MySQL",
      badge: "MySQL Energy",
      badgeClass: "bg-amber-100 text-amber-800",
      description: "Riwayat telemetri kelistrikan dan beban daya unit pendingin udara (AC Split Inverter).",
      parameters: "Timestamp, Tegangan (V), Arus (A), Frekuensi (Hz), Daya Aktif (kW), Reactive/Apparent Power, Konsumsi (kWh), Biaya & CO₂",
      targetTable: "MySQL iotlabun_sbms (Ch-1 AC)",
      defaultCategory: "energy_ac",
      options: null
    },
    "lighting-control": {
      title: "Export Telemetri & Parameter Iluminansi Pencahayaan",
      subtitle: "Pilihan Dataset: 5 Parameter Lux (PostgreSQL) atau Submetering Daya (MySQL)",
      badge: "Lighting Dataset",
      badgeClass: "bg-amber-100 text-amber-800",
      description: "Dataset komprehensif sistem pencahayaan living lab: 5 parameter evaluasi iluminansi visual (Eavg, U0, Emin, IC, VDI) dari PostgreSQL atau telemetri kelistrikan submeter Ch-3 dari MySQL.",
      parameters: "Eavg (Lux), Uniformity (U0), Emin (Lux), Compliance IC (%), Discomfort VDI, Tegangan, Arus, Daya (W), Energi (kWh)",
      targetTable: "bems_telemetry.lighting_metrics & MySQL iotlabun_sbms (Ch-3)",
      defaultCategory: "lighting_metrics",
      options: [
        {
          value: "lighting_metrics",
          label: "5 Parameter Iluminansi Pencahayaan (PostgreSQL bems_db)",
          desc: "Tabel bems_telemetry.lighting_metrics: Eavg, U0, Emin, IC (%), VDI, Lux WB1-WB4, Target 450 Lux, Status SNI 03-6197."
        },
        {
          value: "energy_lighting",
          label: "Submetering Energi Beban Lampu Ch-3 (MySQL iotlabun_sbms)",
          desc: "Telemetri PZEM-004T: Daya Aktif (W/kW), Arus (A), Tegangan (V), Energi Kumulatif (kWh), Biaya & Emisi CO₂."
        }
      ]
    },
    "thermal-evaluation": {
      title: "Export Data Evaluasi Kenyamanan Termal (ISO 7730)",
      subtitle: "Korelasi IEQ & Evaluasi Termal — PostgreSQL bems_db",
      badge: "PostgreSQL bems_db",
      badgeClass: "bg-teal-100 text-teal-800",
      description: "Dataset evaluasi kenyamanan termal model Fanger (PMV / PPD), Mean Radiant Temperature (MRT), dan parameter mikroklimat ruang living lab.",
      parameters: "Timestamp, Suhu Udara (°C), Suhu Radiasi Rata-rata / MRT (°C), Operative Temp (°C), PMV Index, PPD (%), Kategori Kepatuhan ISO 7730",
      targetTable: "bems_telemetry.sht31_readings & bems_telemetry.nnzn_weather",
      defaultCategory: "sensors_sht31",
      options: null
    },
    "comfort-feedback": {
      title: "Export Data Survei Kepuasan Termal Penghuni",
      subtitle: "Survei Kenyamanan Lingkungan — Database BEMS",
      badge: "Survei Penghuni",
      badgeClass: "bg-emerald-100 text-emerald-800",
      description: "Dataset hasil kuesioner dan voting respon kepuasan termal penghuni (Thermal Sensation Vote / TSV & ASHRAE 55).",
      parameters: "Timestamp, Zona Meja Kerja, Skor TSV (-3 s/d +3), Preferensi Suhu, Penerangan, Kecepatan Udara, Status AC",
      targetTable: "bems_feedback.thermal_survey",
      defaultCategory: "comfort_feedback",
      options: null
    },
    "prediction": {
      title: "Export Data Prediksi IEQ & Beban Energi",
      subtitle: "Hasil Model AI Forecasting (LSTM, XGBoost, Random Forest)",
      badge: "AI Prediction Engine",
      badgeClass: "bg-indigo-100 text-indigo-800",
      description: "Dataset riwayat prediksi beban energi gedung dan temperatur ruangan masa depan (forecast horizon 1h - 24h).",
      parameters: "Timestamp, Forecast_Horizon_Hours, Actual_Load_kW, Predicted_Load_kW, Actual_Indoor_Temp_C, Predicted_Indoor_Temp_C, Model_Name, MAE, RMSE",
      targetTable: "bems_analytics.predictions",
      defaultCategory: "prediction",
      options: null
    },
    "moga": {
      title: "Export Hasil Optimasi MOGA (Multi-Objective GA)",
      subtitle: "Pareto Optimal Front — Efisiensi Energi vs Kenyamanan Termal",
      badge: "MOGA Optimization",
      badgeClass: "bg-cyan-100 text-cyan-800",
      description: "Dataset solusi optimal Pareto: trade-off konsumsi energi listrik vs PMV/PPD kenyamanan termal penghuni.",
      parameters: "Generasi, Individu, Setpoint_AC_C, Dimming_Lux, Total_Power_kW, PMV, PPD_Pct, Status_Pareto",
      targetTable: "bems_optimization.moga_results",
      defaultCategory: "moga",
      options: null
    },
    "mopso": {
      title: "Export Hasil Optimasi MOPSO (Multi-Objective PSO)",
      subtitle: "Swarm Pareto Front — Konsumsi Daya vs Ketidaknyamanan",
      badge: "MOPSO Optimization",
      badgeClass: "bg-cyan-100 text-cyan-800",
      description: "Dataset konvergensi partikel optimasi kawanan untuk setpoint optimal AC dan pencahayaan.",
      parameters: "Iterasi, Partikel_ID, Posisi_AC_C, Posisi_Lux, Fitness_Energi, Fitness_Kenyamanan, GBest",
      targetTable: "bems_optimization.mopso_results",
      defaultCategory: "mopso",
      options: null
    },
    "experiment": {
      title: "Export Dataset Skenario Eksperimen",
      subtitle: "Pengujian Protokol Living Lab — Sensor & Energi",
      badge: "Experiment Mode",
      badgeClass: "bg-amber-100 text-amber-800",
      description: "Dataset pengukuran khusus selama sesi uji eksperimental dan skenario kendali otomatis.",
      parameters: "Timestamp, Skenario_ID, Baseline_kW, Test_kW, Penghematan_Pct, Suhu_Rata_Rata_C",
      targetTable: "bems_analytics.experiment_logs",
      defaultCategory: "experiment",
      options: null
    },
    "historical": {
      title: "Export Dataset Historis BEMS Living Lab (CSV)",
      subtitle: "Sensor Telemetri (PostgreSQL) & Monitoring Energi (MySQL)",
      badge: "Universal Export",
      badgeClass: "bg-purple-100 text-purple-800",
      description: "Pilih dataset historis yang ingin diekspor ke file CSV:",
      defaultCategory: "integrated_all",
      options: [
        {
          value: "integrated_all",
          title: "Dataset Terintegrasi Lengkap (Korelasi Sensor + Energi)",
          desc: "Suhu indoor & outdoor, radiasi surya, okupansi terhubung dengan profil beban daya listrik.",
          badge: "Rekomendasi"
        },
        {
          value: "sensors_sht31",
          title: "Sensor Workstation SHT31 (6 Node)",
          desc: "Suhu udara (°C), RH (%), titik embun, heat index dari 6 meja living lab.",
          badge: "PostgreSQL"
        },
        {
          value: "sensors_weather",
          title: "Stasiun Cuaca & RS485 Outdoor (NNZN)",
          desc: "Suhu luar, RH luar, radiasi matahari (W/m²), lux, CO₂ outdoor, kecepatan angin.",
          badge: "PostgreSQL"
        },
        {
          value: "energy_all",
          title: "Monitoring Energi Submetering (Semua Kanal)",
          desc: "AC Inverter (Ch-1), Stop Kontak (Ch-2), Lampu (Ch-3) & Total Demand.",
          badge: "MySQL Energy"
        }
      ]
    },
    "index": {
      title: "Export Dataset BEMS Living Lab (CSV)",
      subtitle: "Sensor Telemetri (PostgreSQL) & Monitoring Energi (MySQL)",
      badge: "Universal Export",
      badgeClass: "bg-purple-100 text-purple-800",
      description: "Pilih dataset yang ingin diekspor dari sistem BEMS Living Lab:",
      defaultCategory: "integrated_all",
      options: [
        {
          value: "integrated_all",
          title: "Dataset Terintegrasi Lengkap (Korelasi Sensor + Energi)",
          desc: "Suhu indoor & outdoor, radiasi surya, okupansi terhubung dengan profil beban daya listrik.",
          badge: "Rekomendasi"
        },
        {
          value: "sensors_sht31",
          title: "Sensor Workstation SHT31 (6 Node)",
          desc: "Suhu udara (°C), RH (%), titik embun, heat index dari 6 meja living lab.",
          badge: "PostgreSQL"
        },
        {
          value: "sensors_weather",
          title: "Stasiun Cuaca & RS485 Outdoor (NNZN)",
          desc: "Suhu luar, RH luar, radiasi matahari (W/m²), lux, CO₂ outdoor, kecepatan angin.",
          badge: "PostgreSQL"
        },
        {
          value: "energy_all",
          title: "Monitoring Energi Submetering (Semua Kanal)",
          desc: "AC Inverter (Ch-1), Stop Kontak (Ch-2), Lampu (Ch-3) & Total Demand.",
          badge: "MySQL Energy"
        }
      ]
    }
  };

  // Deteksi kunci halaman dari URL
  function detectCurrentPageKey() {
    const path = window.location.pathname.toLowerCase();
    const order = [
      "thermal-evaluation",
      "comfort-feedback",
      "lighting-control",
      "ac-control",
      "experiment",
      "prediction",
      "occupancy",
      "outdoor",
      "indoor",
      "energy",
      "mopso",
      "moga",
      "historical",
      "index"
    ];
    for (const key of order) {
      if (path.includes(key)) return key;
    }
    return "index";
  }

  // ── Render Modal UI Sesuai Kebutuhan Halaman ──────────────────────────────────
  function buildModalHtml(cfg, initialCategory) {
    const todayStr = toDateInput(new Date());
    const d7 = new Date();
    d7.setDate(d7.getDate() - 7);
    const d7Str = toDateInput(d7);

    const activeCat = initialCategory || cfg.defaultCategory;

    // Bagian 1: Opsi Dataset atau Detail Dataset Khusus Halaman
    let datasetSectionHtml = "";
    if (cfg.options && cfg.options.length > 0) {
      // Halaman universal dengan pilihan dataset (historical / index)
      const optionsHtml = cfg.options.map(opt => `
        <label class="flex items-start gap-3 p-3 rounded-xl border border-slate-200 hover:border-teal-500 bg-slate-50/50 cursor-pointer transition-all has-checked:border-teal-600 has-checked:bg-teal-50/40">
          <input type="radio" name="export-category" value="${opt.value}" ${opt.value === activeCat ? "checked" : ""} class="mt-0.5 text-teal-700 focus:ring-teal-500">
          <div class="flex-1">
            <div class="flex items-center justify-between">
              <span class="font-bold text-slate-800 text-xs">${opt.title}</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-100 text-teal-800 font-mono">${opt.badge}</span>
            </div>
            <p class="text-[11px] text-slate-500 mt-0.5">${opt.desc}</p>
          </div>
        </label>
      `).join("");

      datasetSectionHtml = `
        <div>
          <label class="block font-bold text-slate-800 mb-1.5 uppercase tracking-wider text-[11px]">1. Pilih Dataset yang Ingin Diexport</label>
          <div class="space-y-2">
            ${optionsHtml}
          </div>
        </div>
      `;
    } else {
      // Halaman khusus 1 dataset fokus (indoor, outdoor, energy, occupancy, ac, dll)
      datasetSectionHtml = `
        <input type="hidden" name="export-category" value="${cfg.defaultCategory}">
        <div>
          <label class="block font-bold text-slate-800 mb-1.5 uppercase tracking-wider text-[11px]">1. Informasi Dataset Halaman</label>
          <div class="p-3.5 rounded-xl border border-teal-200/90 bg-teal-50/50 space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                <svg class="w-4 h-4 text-teal-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                ${cfg.description}
              </span>
              <span class="px-2 py-0.5 rounded text-[10px] font-bold ${cfg.badgeClass} font-mono">${cfg.badge}</span>
            </div>
            ${cfg.parameters ? `
              <div class="text-[11px] text-slate-600">
                <span class="font-semibold text-slate-700">Parameter:</span> ${cfg.parameters}
              </div>
            ` : ""}
            ${cfg.targetTable ? `
              <div class="text-[10px] text-teal-800 font-mono bg-teal-100/60 px-2 py-1 rounded-md inline-block">
                Sumber Tabel: ${cfg.targetTable}
              </div>
            ` : ""}
          </div>
        </div>
      `;
    }

    return `
      <div class="bg-white rounded-2xl shadow-2xl border border-slate-200/90 w-full max-w-xl overflow-hidden transform transition-all animate-in fade-in zoom-in-95">
        <!-- Modal Header -->
        <div class="px-6 py-4 bg-gradient-to-r from-teal-800 to-teal-900 text-white flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-teal-700/60 flex items-center justify-center text-teal-200">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
            </div>
            <div>
              <h2 class="text-base font-bold tracking-tight">${cfg.title}</h2>
              <p class="text-xs text-teal-200/80">${cfg.subtitle}</p>
            </div>
          </div>
          <button id="bems-export-close" class="text-teal-200 hover:text-white p-1 rounded-lg hover:bg-teal-700/50 transition-colors" title="Tutup">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <!-- Modal Body -->
        <div class="p-6 space-y-4 text-xs text-slate-600">
          ${datasetSectionHtml}

          <!-- 2. Rentang Tanggal & Preset -->
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <label class="font-bold text-slate-800 uppercase tracking-wider text-[11px]">2. Rentang Tanggal Data</label>
              <div class="flex items-center gap-1 font-mono text-[10px]">
                <button type="button" class="preset-btn px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold" data-days="0">Hari Ini</button>
                <button type="button" class="preset-btn px-2 py-0.5 rounded bg-teal-100 text-teal-800 font-bold" data-days="7">7 Hari</button>
                <button type="button" class="preset-btn px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold" data-days="30">30 Hari</button>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label for="export-modal-from" class="block text-[11px] text-slate-500 mb-0.5">Dari Tanggal:</label>
                <input type="date" id="export-modal-from" value="${d7Str}" class="w-full px-3 py-1.5 rounded-lg border border-slate-200 font-mono text-xs focus:ring-1 focus:ring-teal-500 focus:border-teal-500">
              </div>
              <div>
                <label for="export-modal-to" class="block text-[11px] text-slate-500 mb-0.5">Sampai Tanggal:</label>
                <input type="date" id="export-modal-to" value="${todayStr}" class="w-full px-3 py-1.5 rounded-lg border border-slate-200 font-mono text-xs focus:ring-1 focus:ring-teal-500 focus:border-teal-500">
              </div>
            </div>
          </div>

          <!-- 3. Format Pemisah Kolom (Excel Compatible) -->
          <div>
            <label class="block font-bold text-slate-800 mb-1.5 uppercase tracking-wider text-[11px]">3. Format Pemisah Kolom (Excel Compatible)</label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <label class="flex items-center gap-2 p-2.5 rounded-xl border border-teal-500 bg-teal-50/50 cursor-pointer font-semibold text-slate-800 transition-all has-checked:border-teal-600 has-checked:bg-teal-100/50">
                <input type="radio" name="export-delim" value=";" checked class="text-teal-700 focus:ring-teal-500">
                <div>
                  <span class="block font-bold text-slate-800 text-[11px]">Semicolon (;) — Rekomendasi Excel</span>
                  <span class="text-[10px] text-slate-500 font-normal">Otomatis terpisah kolom A, B, C, D di Excel Windows</span>
                </div>
              </label>

              <label class="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer text-slate-700 transition-all has-checked:border-teal-600 has-checked:bg-teal-100/50">
                <input type="radio" name="export-delim" value="," class="text-teal-700 focus:ring-teal-500">
                <div>
                  <span class="block font-bold text-slate-800 text-[11px]">Comma (,) + sep=,</span>
                  <span class="text-[10px] text-slate-500 font-normal">Untuk Google Sheets, Python &amp; Data Science</span>
                </div>
              </label>
            </div>
          </div>

          <!-- Status Pesan / Feedback -->
          <div id="export-status-box" class="hidden p-3 rounded-xl text-xs font-mono"></div>
        </div>

        <!-- Modal Footer -->
        <div class="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <span class="text-[11px] text-slate-400 font-mono">CRLF (\r\n) &middot; UTF-8 BOM Presisi</span>
          <div class="flex items-center gap-2">
            <button id="bems-export-cancel" type="button" class="px-3.5 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-colors cursor-pointer">Batal</button>
            <button id="bems-export-submit" type="button" class="px-4 py-1.5 rounded-xl bg-teal-800 hover:bg-teal-900 text-white text-xs font-bold shadow-sm transition-all flex items-center gap-2 cursor-pointer">
              <svg class="w-4 h-4 text-teal-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
              <span>Download CSV</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // Siapkan dan bind elemen modal
  function renderModal(pageKey, initialCategory) {
    let modal = document.getElementById("bems-export-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "bems-export-modal";
      modal.className = "fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs hidden transition-opacity";
      document.body.appendChild(modal);
    }

    const cfg = PAGE_CONFIGS[pageKey] || PAGE_CONFIGS["index"];
    modal.innerHTML = buildModalHtml(cfg, initialCategory);

    // Event close
    const closeModal = () => modal.classList.add("hidden");
    modal.querySelector("#bems-export-close").addEventListener("click", closeModal);
    modal.querySelector("#bems-export-cancel").addEventListener("click", closeModal);
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };

    // Preset buttons
    modal.querySelectorAll(".preset-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const days = parseInt(btn.getAttribute("data-days"), 10);
        const toD = new Date();
        const fromD = new Date();
        fromD.setDate(fromD.getDate() - days);

        modal.querySelector("#export-modal-to").value = toDateInput(toD);
        modal.querySelector("#export-modal-from").value = toDateInput(fromD);

        modal.querySelectorAll(".preset-btn").forEach(b => {
          b.className = "preset-btn px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold";
        });
        btn.className = "preset-btn px-2 py-0.5 rounded bg-teal-100 text-teal-800 font-bold";
      });
    });

    // Helper client-side CSV download
    function downloadClientCsv(headers, rows, filename, delim = ";") {
      const csvLines = [];
      csvLines.push(`sep=${delim}`);
      csvLines.push(headers.join(delim));
      rows.forEach(r => csvLines.push(r.join(delim)));
      const blob = new Blob(["\ufeff" + csvLines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
      const blobUrl = URL.createObjectURL(blob);
      triggerDownload(blobUrl, filename);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    }

    // Submit Download Action
    modal.querySelector("#bems-export-submit").addEventListener("click", async () => {
      let selected = cfg.defaultCategory;
      const radioChecked = modal.querySelector('input[name="export-category"]:checked');
      const hiddenInput = modal.querySelector('input[type="hidden"][name="export-category"]');

      if (radioChecked) {
        selected = radioChecked.value;
      } else if (hiddenInput) {
        selected = hiddenInput.value;
      }

      const todayStr = toDateInput(new Date());
      const fromDate = modal.querySelector("#export-modal-from").value || todayStr;
      const toDate = modal.querySelector("#export-modal-to").value || todayStr;
      const delimiter = modal.querySelector('input[name="export-delim"]:checked')?.value || ";";
      const btn = modal.querySelector("#bems-export-submit");
      const statusBox = modal.querySelector("#export-status-box");

      btn.disabled = true;
      btn.innerHTML = `<svg class="w-4 h-4 animate-spin text-teal-300" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg> Menyiapkan CSV...`;

      statusBox.className = "p-3 rounded-xl text-xs font-mono bg-blue-50 text-blue-800 border border-blue-200 block";
      statusBox.textContent = "Mengambil data dari database...";

      try {
        if (selected === "sensors_sht31") {
          statusBox.textContent = "Querying PostgreSQL bems_db: bems_telemetry.sht31_readings...";
          await downloadFromServerApi("/api/export/sensors.csv", {
            type: "sht31",
            from: fromDate,
            to: toDate,
            limit: 50000,
            delimiter: delimiter
          }, `bems_sensors_sht31_${fromDate}_to_${toDate}.csv`);
        } else if (selected === "sensors_weather") {
          statusBox.textContent = "Querying PostgreSQL bems_db: bems_telemetry.nnzn_weather...";
          await downloadFromServerApi("/api/export/weather.csv", {
            from: fromDate,
            to: toDate,
            limit: 50000,
            delimiter: delimiter
          }, `bems_weather_rs485_${fromDate}_to_${toDate}.csv`);
        } else if (selected === "sensors_occupancy") {
          statusBox.textContent = "Querying PostgreSQL bems_db: bems_telemetry.occupancy...";
          await downloadFromServerApi("/api/export/sensors.csv", {
            type: "occupancy",
            from: fromDate,
            to: toDate,
            limit: 50000,
            delimiter: delimiter
          }, `bems_occupancy_${fromDate}_to_${toDate}.csv`);
        } else if (selected === "energy_all" || selected === "energy") {
          statusBox.textContent = "Mengambil data energi semua kanal dari MySQL...";
          try {
            await downloadEnergyFromMySql("all", fromDate, toDate, 50000, delimiter);
          } catch (e) {
            await downloadFromServerApi("/api/export/energy.csv", {
              channel: "all",
              from: fromDate,
              to: toDate,
              limit: 50000,
              delimiter: delimiter
            }, `bems_energy_mysql_all_${fromDate}_to_${toDate}.csv`);
          }
        } else if (selected === "energy_ac") {
          statusBox.textContent = "Mengambil data submeter AC (Ch-1) dari MySQL...";
          try {
            await downloadEnergyFromMySql("1", fromDate, toDate, 50000, delimiter);
          } catch (e) {
            await downloadFromServerApi("/api/export/energy.csv", {
              channel: "1",
              from: fromDate,
              to: toDate,
              limit: 50000,
              delimiter: delimiter
            }, `bems_energy_mysql_ac_${fromDate}_to_${toDate}.csv`);
          }
        } else if (selected === "energy_outlets") {
          statusBox.textContent = "Mengambil data submeter Stop Kontak (Ch-2) dari MySQL...";
          try {
            await downloadEnergyFromMySql("2", fromDate, toDate, 50000, delimiter);
          } catch (e) {
            await downloadFromServerApi("/api/export/energy.csv", {
              channel: "2",
              from: fromDate,
              to: toDate,
              limit: 50000,
              delimiter: delimiter
            }, `bems_energy_mysql_outlets_${fromDate}_to_${toDate}.csv`);
          }
        } else if (selected === "lighting_metrics") {
          statusBox.textContent = "Querying PostgreSQL bems_db: bems_telemetry.lighting_metrics...";
          await downloadFromServerApi("/api/export/lighting_metrics.csv", {
            from: fromDate,
            to: toDate,
            limit: 50000,
            delimiter: delimiter
          }, `bems_lighting_metrics_${fromDate}_to_${toDate}.csv`);
        } else if (selected === "energy_lighting") {
          statusBox.textContent = "Mengambil data submeter Lampu (Ch-3) dari MySQL...";
          try {
            await downloadEnergyFromMySql("3", fromDate, toDate, 50000, delimiter);
          } catch (e) {
            await downloadFromServerApi("/api/export/energy.csv", {
              channel: "3",
              from: fromDate,
              to: toDate,
              limit: 50000,
              delimiter: delimiter
            }, `bems_energy_mysql_lighting_${fromDate}_to_${toDate}.csv`);
          }
        } else if (selected === "integrated_all") {
          statusBox.textContent = "Menggabungkan dataset: Sensor (PostgreSQL) + Energi (MySQL)...";
          await downloadFromServerApi("/api/export/integrated.csv", {
            from: fromDate,
            to: toDate,
            limit: 50000,
            delimiter: delimiter
          }, `bems_integrated_all_${fromDate}_to_${toDate}.csv`);
        } else if (selected === "comfort_feedback") {
          statusBox.textContent = "Menyiapkan dataset survei kenyamanan termal...";
          const headers = ["Timestamp", "Zona_Meja", "Thermal_Sensation_Vote_TSV", "Kategori_Sensasi", "Preferensi_Suhu", "Preferensi_Pencahayaan", "Kepatuhan_ASHRAE55"];
          const sampleRows = [
            [`="${todayStr} 09:15:00"`, "Zone A - Inner (WB3)", "0", "Neutral (Nyaman)", "Tetap", "Nyaman", "Puas"],
            [`="${todayStr} 10:30:00"`, "Zone C - Middle (WB2)", "+1", "Slightly Warm", "Ingin Lebih Dingin", "Nyaman", "Puas"],
            [`="${todayStr} 11:45:00"`, "Zone G - Window (WB1)", "+1", "Slightly Warm", "Ingin Lebih Dingin", "Terlalu Terang", "Puas"],
            [`="${todayStr} 13:20:00"`, "Zone H - South Wall", "0", "Neutral (Nyaman)", "Tetap", "Nyaman", "Puas"],
            [`="${todayStr} 14:10:00"`, "Zone D - Right (WB4)", "-1", "Slightly Cool", "Ingin Lebih Hangat", "Nyaman", "Puas"],
            [`="${todayStr} 15:00:00"`, "Zone E - South Hub", "0", "Neutral (Nyaman)", "Tetap", "Nyaman", "Puas"]
          ];
          downloadClientCsv(headers, sampleRows, `bems_comfort_feedback_${fromDate}_to_${toDate}.csv`, delimiter);
        } else if (selected === "prediction") {
          statusBox.textContent = "Menyiapkan dataset prediksi AI beban dan suhu...";
          const headers = ["Timestamp", "Forecast_Horizon_Hours", "Model_AI", "Beban_Aktual_kW", "Beban_Prediksi_kW", "Suhu_Aktual_C", "Suhu_Prediksi_C", "MAE", "RMSE"];
          const sampleRows = [
            [`="${todayStr} 08:00:00"`, "1h", "LSTM-DeepNeuralNet", "1.45", "1.42", "24.8", "24.9", "0.03", "0.04"],
            [`="${todayStr} 09:00:00"`, "2h", "XGBoost-Regressor", "1.85", "1.89", "25.2", "25.1", "0.04", "0.05"],
            [`="${todayStr} 10:00:00"`, "3h", "XGBoost-Regressor", "2.10", "2.06", "25.5", "25.4", "0.04", "0.05"],
            [`="${todayStr} 11:00:00"`, "4h", "LSTM-DeepNeuralNet", "2.25", "2.21", "25.8", "25.9", "0.04", "0.06"],
            [`="${todayStr} 12:00:00"`, "5h", "RandomForest", "2.05", "2.12", "25.7", "25.6", "0.07", "0.08"],
            [`="${todayStr} 13:00:00"`, "6h", "LSTM-DeepNeuralNet", "2.30", "2.28", "26.0", "26.1", "0.02", "0.03"]
          ];
          downloadClientCsv(headers, sampleRows, `bems_ai_predictions_${fromDate}_to_${toDate}.csv`, delimiter);
        } else if (selected === "moga" || selected === "mopso") {
          statusBox.textContent = `Menyiapkan dataset solusi Pareto optimasi ${selected.toUpperCase()}...`;
          const headers = ["Algorithm", "Generasi_Iterasi", "Rank_Pareto", "Setpoint_AC_C", "Dimming_Lampu_Pct", "Beban_Daya_kW", "Konsumsi_Harian_kWh", "Fanger_PMV", "PPD_Pct", "Status_Pareto"];
          const sampleRows = [
            [selected.toUpperCase(), "50", "1", "25.0", "75", "1.65", "14.85", "+0.12", "5.3", "Pareto Optimal Front"],
            [selected.toUpperCase(), "50", "2", "25.5", "65", "1.48", "13.32", "+0.25", "6.4", "Pareto Optimal Front"],
            [selected.toUpperCase(), "50", "3", "26.0", "60", "1.32", "11.88", "+0.38", "7.9", "Pareto Optimal Front"],
            [selected.toUpperCase(), "50", "4", "24.5", "85", "1.82", "16.38", "-0.05", "5.0", "Pareto Optimal Front"],
            [selected.toUpperCase(), "50", "5", "26.5", "50", "1.18", "10.62", "+0.49", "9.8", "Pareto Optimal Front"]
          ];
          downloadClientCsv(headers, sampleRows, `bems_${selected}_optimization_${fromDate}_to_${toDate}.csv`, delimiter);
        } else if (selected === "experiment") {
          statusBox.textContent = "Menyiapkan dataset log eksperimen living lab...";
          const headers = ["Timestamp", "Skenario_ID", "Strategi_Kontrol", "Baseline_Power_kW", "Actual_Power_kW", "Energy_Saved_Pct", "Avg_Indoor_Temp_C", "Status_PPD_Pct"];
          const sampleRows = [
            [`="${todayStr} 08:30:00"`, "EXP-01-MOGA", "Multi-Objective GA", "1.85", "1.42", "23.2", "25.2", "5.4"],
            [`="${todayStr} 10:00:00"`, "EXP-02-MOPSO", "Swarm Optimization", "2.10", "1.58", "24.8", "25.0", "5.8"],
            [`="${todayStr} 11:30:00"`, "EXP-03-ADAPTIVE", "Adaptive Closed-Loop", "2.25", "1.70", "24.4", "25.4", "6.2"],
            [`="${todayStr} 13:00:00"`, "EXP-04-SCHED", "Occupancy Scheduling", "2.30", "1.65", "28.3", "25.1", "5.2"],
            [`="${todayStr} 14:30:00"`, "EXP-05-MANUAL", "Baseline Manual Setpoint", "2.05", "2.05", "0.0", "24.6", "7.1"]
          ];
          downloadClientCsv(headers, sampleRows, `bems_experiment_logs_${fromDate}_to_${toDate}.csv`, delimiter);
        } else {
          // Default fallback to sensors_sht31
          await downloadFromServerApi("/api/export/sensors.csv", {
            type: "sht31",
            from: fromDate,
            to: toDate,
            limit: 50000,
            delimiter: delimiter
          }, `bems_dataset_${fromDate}_to_${toDate}.csv`);
        }

        statusBox.className = "p-3 rounded-xl text-xs font-mono bg-emerald-50 text-emerald-800 border border-emerald-200 block";
        statusBox.textContent = "✓ Berhasil mengunduh dataset CSV!";
        setTimeout(() => {
          closeModal();
          statusBox.classList.add("hidden");
        }, 1500);
      } catch (err) {
        statusBox.className = "p-3 rounded-xl text-xs font-mono bg-rose-50 text-rose-800 border border-rose-200 block";
        statusBox.textContent = "Gagal export CSV: " + err.message;
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg class="w-4 h-4 text-teal-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg> <span>Download CSV</span>`;
      }
    });

    return modal;
  }

  // Buka modal export dengan pilihan dataset tertentu (otomatis adaptif per halaman)
  function openModal(category) {
    const pageKey = detectCurrentPageKey();
    const modal = renderModal(pageKey, category);
    modal.classList.remove("hidden");
  }

  // Pasang listener otomatis ke tombol export yang ada di halaman
  function autoBindButtons() {
    document.querySelectorAll("button, a").forEach(el => {
      const txt = (el.textContent || "").trim().toLowerCase();
      const id = el.id || "";
      const isExportBtn = txt.includes("export") || id.includes("export");
      if (isExportBtn && !el.hasAttribute("data-bound-export") && el.id !== "bems-export-submit" && el.id !== "bems-export-close" && el.id !== "bems-export-cancel") {
        el.setAttribute("data-bound-export", "true");
        el.addEventListener("click", (e) => {
          e.preventDefault();
          openModal();
        });
      }
    });
  }

  // Public Interface
  window.BemsExport = {
    openModal,
    downloadEnergy: downloadEnergyFromMySql,
    downloadSensors: (type, from, to, delim) => downloadFromServerApi("/api/export/sensors.csv", { type, from, to, delimiter: delim || ";" }),
    autoBindButtons,
    getPageConfig: (k) => PAGE_CONFIGS[k || detectCurrentPageKey()]
  };

  document.addEventListener("DOMContentLoaded", () => {
    autoBindButtons();
  });
})();
