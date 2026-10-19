/**
 * BEMS Living Lab — Universal CSV Data Export Service & Modal
 * ----------------------------------------------------------------------------
 * Memungkinkan ekspor dataset CSV langsung dari web:
 * 1. Data Sensor (SHT31 6 Workstation, Stasiun Cuaca NNZN RS485, Okupansi)
 *    -> Mengambil dari Database PostgreSQL 'bems_db'
 * 2. Data Energi Listrik Submetering (AC, Stop Kontak, Lampu, Total Demand)
 *    -> Mengambil dari Database MySQL 'iotlabun_sbms' via api_energy.php
 * 3. Dataset Terintegrasi Lengkap (Sensor PostgreSQL + Energi MySQL)
 * 
 * Format Kompatibilitas Excel:
 * - Menggunakan Semicolon (;) secara default agar Excel Indonesia membagi data
 *   ke kolom A, B, C, D... secara otomatis tanpa tercampur menjadi 1 kolom.
 * - Menggunakan CRLF (\r\n) agar setiap data terpisah pada baris baru.
 * - Menggunakan UTF-8 BOM (\ufeff) agar simbol derajat °C dan format angka presisi.
 */

(function () {
  "use strict";

  const ENERGY_API_URL = (window.APP_CONFIG && window.APP_CONFIG.ENERGY && window.APP_CONFIG.ENERGY.API_URL)
    || "https://iotlab-uns.com/api_energy.php";
  const ENERGY_API_KEY = (window.APP_CONFIG && window.APP_CONFIG.ENERGY && window.APP_CONFIG.ENERGY.API_KEY)
    || "iotlab_smartroom_2024";

  // Helper untuk format tanggal YYYY-MM-DD
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

  // Unduh CSV dari MySQL Energy langsung dari browser (Client-Side Fetcher)
  async function downloadEnergyFromMySql(channelId, fromDate, toDate, limit = 5000, delimiter = ";") {
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
      "Timestamp", "Channel_ID", "Channel_Name", "Tegangan_V", "Arus_A",
      "Frekuensi_Hz", "Active_Power_kW", "Reactive_Power_VAR",
      "Apparent_Power_VA", "Power_Factor", "Energy_kWh",
      "Estimasi_Biaya_IDR", "Emisi_CO2_kg", "Database_Source"
    ];

    const csvRows = [];
    if (delimiter === ",") {
      csvRows.push("sep=,");
    }
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

        csvRows.push([
          `"${r.timestamp || ""}"`,
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
      throw new Error(`Tidak ada baris data energi MySQL untuk rentang ${fromDate} s/d ${toDate}`);
    }

    // CRLF (\r\n) + UTF-8 BOM (\ufeff)
    const blob = new Blob(["\ufeff" + csvRows.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const blobUrl = URL.createObjectURL(blob);
    triggerDownload(blobUrl, filename);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }

  // Unduh CSV dari Endpoint Server (PostgreSQL bems_db)
  async function downloadFromServerApi(apiPath, queryParams, fallbackFilename) {
    const searchParams = new URLSearchParams(queryParams);
    const downloadUrl = `${apiPath}?${searchParams.toString()}`;

    // Direct window location trigger
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.target = "_blank";
    link.download = fallbackFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // ── Modal UI Component ───────────────────────────────────────────────────────
  function ensureModal() {
    let modal = document.getElementById("bems-export-modal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "bems-export-modal";
    modal.className = "fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs hidden transition-opacity";

    const todayStr = toDateInput(new Date());
    const d7 = new Date();
    d7.setDate(d7.getDate() - 7);
    const d7Str = toDateInput(d7);

    modal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl border border-slate-200/90 w-full max-w-xl overflow-hidden transform transition-all animate-in fade-in zoom-in-95">
        <!-- Modal Header -->
        <div class="px-6 py-4 bg-gradient-to-r from-teal-800 to-teal-900 text-white flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-teal-700/60 flex items-center justify-center text-teal-200">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
            </div>
            <div>
              <h2 class="text-base font-bold tracking-tight">Export Dataset BEMS Living Lab (CSV)</h2>
              <p class="text-xs text-teal-200/80">Sensor Telemetri (PostgreSQL) &amp; Monitoring Energi (MySQL)</p>
            </div>
          </div>
          <button id="bems-export-close" class="text-teal-200 hover:text-white p-1 rounded-lg hover:bg-teal-700/50 transition-colors" title="Tutup">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <!-- Modal Body -->
        <div class="p-6 space-y-4 text-xs text-slate-600">
          <!-- 1. Pilihan Kategori Dataset -->
          <div>
            <label class="block font-bold text-slate-800 mb-1.5 uppercase tracking-wider text-[11px]">1. Pilih Dataset yang Ingin Diexport</label>
            <div class="space-y-2">
              <!-- Opsi Sensor PostgreSQL -->
              <label class="flex items-start gap-3 p-3 rounded-xl border border-slate-200 hover:border-teal-500 bg-slate-50/50 cursor-pointer transition-all has-checked:border-teal-600 has-checked:bg-teal-50/40">
                <input type="radio" name="export-category" value="sensors_sht31" checked class="mt-0.5 text-teal-700 focus:ring-teal-500">
                <div class="flex-1">
                  <div class="flex items-center justify-between">
                    <span class="font-bold text-slate-800 text-xs">Sensor Workstation SHT31 (6 Node)</span>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 font-mono">PostgreSQL</span>
                  </div>
                  <p class="text-[11px] text-slate-500 mt-0.5">Suhu Udara (°C), RH (%), Titik Embun, Heat Index dari 6 meja living lab.</p>
                </div>
              </label>

              <label class="flex items-start gap-3 p-3 rounded-xl border border-slate-200 hover:border-teal-500 bg-slate-50/50 cursor-pointer transition-all has-checked:border-teal-600 has-checked:bg-teal-50/40">
                <input type="radio" name="export-category" value="sensors_weather" class="mt-0.5 text-teal-700 focus:ring-teal-500">
                <div class="flex-1">
                  <div class="flex items-center justify-between">
                    <span class="font-bold text-slate-800 text-xs">Stasiun Cuaca &amp; RS485 Outdoor (NNZN)</span>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 font-mono">PostgreSQL</span>
                  </div>
                  <p class="text-[11px] text-slate-500 mt-0.5">Suhu Luar, RH Luar, Radiasi Matahari (W/m²), Lux, CO₂ Outdoor, dan Kecepatan Angin.</p>
                </div>
              </label>

              <!-- Opsi Energi MySQL -->
              <label class="flex items-start gap-3 p-3 rounded-xl border border-slate-200 hover:border-teal-500 bg-slate-50/50 cursor-pointer transition-all has-checked:border-teal-600 has-checked:bg-teal-50/40">
                <input type="radio" name="export-category" value="energy_all" class="mt-0.5 text-teal-700 focus:ring-teal-500">
                <div class="flex-1">
                  <div class="flex items-center justify-between">
                    <span class="font-bold text-slate-800 text-xs">Monitoring Energi Submetering (Semua Kanal)</span>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 font-mono">MySQL Energy</span>
                  </div>
                  <p class="text-[11px] text-slate-500 mt-0.5">3 Submeter: AC Inverter (Ch-1), Stop Kontak (Ch-2), Lampu (Ch-3) &amp; Total Demand.</p>
                </div>
              </label>

              <label class="flex items-start gap-3 p-3 rounded-xl border border-slate-200 hover:border-teal-500 bg-slate-50/50 cursor-pointer transition-all has-checked:border-teal-600 has-checked:bg-teal-50/40">
                <input type="radio" name="export-category" value="energy_ac" class="mt-0.5 text-teal-700 focus:ring-teal-500">
                <div class="flex-1">
                  <div class="flex items-center justify-between">
                    <span class="font-bold text-slate-800 text-xs">Khusus Submeter AC Split / HVAC (Ch-1)</span>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 font-mono">MySQL Energy</span>
                  </div>
                  <p class="text-[11px] text-slate-500 mt-0.5">Tegangan, Arus, Frekuensi, Active/Reactive Power, PF, kWh, Biaya &amp; CO₂.</p>
                </div>
              </label>

              <!-- Opsi Terintegrasi Lengkap -->
              <label class="flex items-start gap-3 p-3 rounded-xl border border-slate-200 hover:border-teal-500 bg-slate-50/50 cursor-pointer transition-all has-checked:border-teal-600 has-checked:bg-teal-50/40">
                <input type="radio" name="export-category" value="integrated_all" class="mt-0.5 text-teal-700 focus:ring-teal-500">
                <div class="flex-1">
                  <div class="flex items-center justify-between">
                    <span class="font-bold text-slate-800 text-xs">Dataset Terintegrasi Lengkap (Korelasi Sensor + Energi)</span>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 font-mono">PostgreSQL + MySQL</span>
                  </div>
                  <p class="text-[11px] text-slate-500 mt-0.5">Suhu indoor &amp; outdoor, radiasi surya, okupansi terhubung dengan profil beban daya listrik.</p>
                </div>
              </label>
            </div>
          </div>

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

          <!-- 3. Pilihan Delimiter Excel -->
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

    document.body.appendChild(modal);

    // Event close
    const closeModal = () => {
      modal.classList.add("hidden");
    };
    modal.querySelector("#bems-export-close").addEventListener("click", closeModal);
    modal.querySelector("#bems-export-cancel").addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

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

    // Submit Download Action
    modal.querySelector("#bems-export-submit").addEventListener("click", async () => {
      const selected = modal.querySelector('input[name="export-category"]:checked')?.value || "sensors_sht31";
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
            limit: 5000,
            delimiter: delimiter
          }, `bems_sensors_sht31_${fromDate}_to_${toDate}.csv`);
        } else if (selected === "sensors_weather") {
          statusBox.textContent = "Querying PostgreSQL bems_db: bems_telemetry.nnzn_weather...";
          await downloadFromServerApi("/api/export/weather.csv", {
            from: fromDate,
            to: toDate,
            limit: 5000,
            delimiter: delimiter
          }, `bems_weather_rs485_${fromDate}_to_${toDate}.csv`);
        } else if (selected === "energy_all") {
          statusBox.textContent = "Querying MySQL Energy Database via api_energy.php (All Channels)...";
          try {
            await downloadEnergyFromMySql("all", fromDate, toDate, 5000, delimiter);
          } catch (e) {
            await downloadFromServerApi("/api/export/energy.csv", {
              channel: "all",
              from: fromDate,
              to: toDate,
              delimiter: delimiter
            }, `bems_energy_mysql_all_${fromDate}_to_${toDate}.csv`);
          }
        } else if (selected === "energy_ac") {
          statusBox.textContent = "Querying MySQL Energy Database via api_energy.php (Ch-1 AC)...";
          try {
            await downloadEnergyFromMySql("1", fromDate, toDate, 5000, delimiter);
          } catch (e) {
            await downloadFromServerApi("/api/export/energy.csv", {
              channel: "1",
              from: fromDate,
              to: toDate,
              delimiter: delimiter
            }, `bems_energy_mysql_ac_${fromDate}_to_${toDate}.csv`);
          }
        } else if (selected === "integrated_all") {
          statusBox.textContent = "Menggabungkan dataset: Sensor (PostgreSQL) + Energi (MySQL)...";
          await downloadFromServerApi("/api/export/integrated.csv", {
            from: fromDate,
            to: toDate,
            limit: 3000,
            delimiter: delimiter
          }, `bems_integrated_all_${fromDate}_to_${toDate}.csv`);
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

  // Buka modal export dengan pilihan dataset tertentu
  function openModal(category = "sensors_sht31") {
    const modal = ensureModal();
    const radio = modal.querySelector(`input[name="export-category"][value="${category}"]`);
    if (radio) radio.checked = true;
    modal.classList.remove("hidden");
  }

  // Pasang listener otomatis ke tombol export yang ada di halaman
  function autoBindButtons() {
    document.querySelectorAll("button, a").forEach(el => {
      const txt = (el.textContent || "").trim().toLowerCase();
      if ((txt.includes("export data") || txt.includes("export csv") || el.id === "btn-hist-export") && !el.hasAttribute("data-bound-export")) {
        el.setAttribute("data-bound-export", "true");
        el.addEventListener("click", (e) => {
          e.preventDefault();
          const path = window.location.pathname;
          let cat = "sensors_sht31";
          if (path.includes("indoor")) cat = "sensors_sht31";
          else if (path.includes("outdoor")) cat = "sensors_weather";
          else if (path.includes("energy")) cat = "energy_all";
          else if (path.includes("historical")) cat = "integrated_all";
          else cat = "sensors_sht31";

          openModal(cat);
        });
      }
    });
  }

  // Public Interface
  window.BemsExport = {
    openModal,
    downloadEnergy: downloadEnergyFromMySql,
    downloadSensors: (type, from, to, delim) => downloadFromServerApi("/api/export/sensors.csv", { type, from, to, delimiter: delim || ";" }),
    autoBindButtons
  };

  document.addEventListener("DOMContentLoaded", () => {
    autoBindButtons();
  });
})();
