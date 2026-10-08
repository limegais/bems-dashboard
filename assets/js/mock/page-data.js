// Data contoh bentuk respons GET /pages/{pageKey}; hanya dipakai saat APP_CONFIG.USE_MOCK = true.
const MOCK_PAGE_DATA = {
  dashboard: {
    kpiGroups: [
      {
        target: "kpi-dashboard-main",
        items: [
          { label: "Energi hari ini", value: "184,6 kWh", note: "↓ 12,7% dari baseline 211,4 kWh", noteClass: "text-teal-600" },
          { label: "Daya saat ini", value: "18,4 kW", note: "Puncak hari ini 26,8 kW", noteClass: "text-teal-600" },
          { label: "Okupansi bangunan", value: "86 / 120 orang", note: "71,7% kapasitas · 6 ruang aktif", noteClass: "text-teal-600" },
          { label: "Kepuasan kenyamanan", value: "87 %", note: "48 respons hari ini · thermal & visual", noteClass: "text-teal-600" }
        ]
      }
    ]
  },

  indoor: {
    kpiGroups: [
      {
        target: "kpi-indoor-main",
        items: [
          { label: "Suhu rata-rata", value: "24,6°C", note: "Target 24-26 °C · seluruh ruang", noteClass: "text-emerald-500" },
          { label: "Kelembapan", value: "56 %RH", note: "Dalam rentang 40-60 %RH", noteClass: "text-emerald-500" },
          { label: "CO₂ rata-rata", value: "810 ppm", note: "Lab B: 1.040 ppm · tinjau ventilasi", noteClass: "text-amber-600" },
          { label: "Iluminansi", value: "458 lux", note: "Target aktivitas 350-550 lux", noteClass: "text-teal-600" }
        ]
      }
    ]
  },

  outdoor: {
    kpiGroups: [
      {
        target: "kpi-outdoor-main",
        items: [
          { label: "Suhu luar", value: "31,2°C", note: "+6,6 °C dibanding indoor", noteClass: "text-teal-600" },
          { label: "Kelembapan", value: "64 %RH", note: "Rata-rata hari ini 69 %RH", noteClass: "text-teal-600" },
          { label: "Radiasi", value: "620 W/m²", note: "Nilai demo · sensor cadangan", noteClass: "text-amber-600" },
          { label: "Kecepatan angin", value: "2,4 m/s", note: "Arah tenggara · 135°", noteClass: "text-teal-600" }
        ]
      }
    ]
  },

  occupancy: {
    kpiGroups: [
      {
        target: "kpi-occupancy-main",
        items: [
          { label: "Occupancy realtime", value: "23 orang", note: "Puncak hari ini: 28 orang", noteClass: "text-teal-600" },
          { label: "Rata-rata MET", value: "1.2 met", note: "Aktivitas dominan: duduk/komputer", noteClass: "text-teal-600" },
          { label: "Rata-rata CLO", value: "0.6 clo", note: "Rentang observasi 0.4-0.8", noteClass: "text-teal-600" },
          { label: "PIR event terakhir", value: "14:30:12", note: "Sensor PIR-1 · Lab A", noteClass: "text-slate-500" }
        ]
      }
    ]
  },

  energy: {
    kpiGroups: [
      {
        target: "kpi-energy-main",
        items: [
          { label: "Konsumsi hari ini", value: "184,6 kWh", note: "↓ 12,7% dari baseline 211,4 kWh", noteClass: "text-teal-600" },
          { label: "Daya aktif", value: "18,4 kW", note: "Daya puncak 26,8 kW · 10:30", noteClass: "text-teal-600" },
          { label: "Estimasi biaya", value: "266.062 Rp", note: "Tarif ilustratif Rp1.441,70 / kWh", noteClass: "text-teal-600" },
          { label: "Emisi ekuivalen", value: "156,9 kgCO₂e", note: "Faktor demo 0,85 kgCO₂e / kWh", noteClass: "text-teal-600" }
        ]
      }
    ]
  },

  "ac-control": {
    kpiGroups: [
      {
        target: "kpi-ac-main",
        items: [
          { label: "Unit aktif", value: "6 / 8 unit", note: "2 standby · tidak ada fault demo", noteClass: "text-teal-600" },
          { label: "Daya HVAC", value: "11,2 kW", note: "60,9% daya bangunan saat ini", noteClass: "text-teal-600" },
          { label: "Setpoint rata-rata", value: "24,8 °C", note: "Rentang aman 23-27 °C", noteClass: "text-teal-600" },
          { label: "Suhu zona", value: "24,6 °C", note: "Selisih rata-rata -0,2 °C", noteClass: "text-teal-600" }
        ]
      }
    ]
  },

  "lighting-control": {
    kpiGroups: [
      {
        target: "kpi-light-main",
        items: [
          { label: "Fixture aktif", value: "42 / 48", note: "6 redup / standby · 6 ruang", noteClass: "text-teal-600" },
          { label: "Daya lighting", value: "3,8 kW", note: "Energi hari ini 38,2 kWh", noteClass: "text-teal-600" },
          { label: "Iluminansi rata-rata", value: "458 lux", note: "Target kerja 350-550 lux", noteClass: "text-teal-600" },
          { label: "Dimming rata-rata", value: "68 %", note: "Daylight harvesting: simulasi aktif", noteClass: "text-teal-600" }
        ]
      }
    ]
  },

  prediction: {
    kpiGroups: [
      {
        target: "kpi-prediction-main",
        items: [
          { label: "Proyeksi energi harian", value: "258,4 kWh", note: "Aktual 184,6 + prediksi 73,8 kWh", noteClass: "text-teal-600" },
          { label: "Suhu indoor +1 jam", value: "24,8 °C", note: "Confidence 95%: 24,4-25,2 °C", noteClass: "text-teal-600" },
          { label: "MAPE energi", value: "6,2 %", note: "Validasi demo · 7 hari terakhir", noteClass: "text-teal-600" },
          { label: "Horizon prediksi", value: "6 jam", note: "14:30-20:30 WIB · resolusi 15 menit", noteClass: "text-teal-600" }
        ]
      }
    ]
  },

  moga: {
    kpiGroups: [
      {
        target: "kpi-moga-main",
        items: [
          { label: "Energi solusi terpilih", value: "246,0 kWh/hari", note: "↓ 4,8% terhadap forecast 258,4", noteClass: "text-teal-600" },
          { label: "PPD solusi terpilih", value: "7,8 %", note: "Memenuhi ambang kenyamanan < 10%", noteClass: "text-teal-600" },
          { label: "Solusi non-dominated", value: "18 solusi", note: "Pareto archive · run MOGA-024", noteClass: "text-teal-600" },
          { label: "Generasi selesai", value: "100 / 100", note: "8.000 evaluasi · 42 detik (demo)", noteClass: "text-teal-600" }
        ]
      }
    ]
  },

  mopso: {
    kpiGroups: [
      {
        target: "kpi-mopso-main",
        items: [
          { label: "Energi solusi terpilih", value: "241,0 kWh/hari", note: "↓ 6,7% terhadap forecast 258,4", noteClass: "text-teal-600" },
          { label: "PPD solusi terpilih", value: "8,2 %", note: "Memenuhi ambang kenyamanan < 10%", noteClass: "text-teal-600" },
          { label: "Solusi dalam archive", value: "22 solusi", note: "Non-dominated · run MOPSO-018", noteClass: "text-teal-600" },
          { label: "Iterasi selesai", value: "120 / 120", note: "7.200 evaluasi · 36 detik (demo)", noteClass: "text-teal-600" }
        ]
      }
    ]
  },

  "adaptive-control": {
    kpiGroups: [
      {
        target: "kpi-adaptive-main",
        items: [
          { label: "Mode strategi", value: "Shadow", note: "Rekomendasi saja · tanpa aktuasi", noteClass: "text-teal-600" },
          { label: "Potensi penghematan", value: "6,7 %", note: "Solusi MOPSO: 241,0 kWh/hari", noteClass: "text-teal-600" },
          { label: "Loop interval", value: "15 menit", note: "Evaluasi demo berikutnya 14:45", noteClass: "text-teal-600" },
          { label: "Safety gate", value: "5 / 6 zona", note: "Lab B ditahan: CO₂ 1.040 ppm", noteClass: "text-amber-400" }
        ]
      }
    ]
  },

  "comfort-feedback": {
    kpiGroups: [
      {
        target: "kpi-comfort-main",
        items: [
          { label: "Respons hari ini", value: "48 respons", note: "6 ruang · feedback demo anonim", noteClass: "text-teal-600" },
          { label: "Thermal satisfaction", value: "85 %", note: "41 dari 48 respons dalam rentang nyaman", noteClass: "text-teal-600" },
          { label: "Visual satisfaction", value: "90 %", note: "43 dari 48 respons menilai nyaman", noteClass: "text-teal-600" },
          { label: "Indeks gabungan", value: "87 %", note: "Bobot thermal 60% · visual 40%", noteClass: "text-teal-600" }
        ]
      }
    ]
  },

  "thermal-evaluation": {
    kpiGroups: [
      {
        target: "kpi-thermal-main",
        items: [
          { label: "PMV rata-rata", value: "+0,18", note: "Netral · rentang target −0,5 hingga +0,5", noteClass: "text-teal-600" },
          { label: "PPD rata-rata", value: "5,7 %", note: "Di bawah batas evaluasi 10%", noteClass: "text-teal-600" },
          { label: "MRT rata-rata", value: "25,1 °C", note: "Estimasi globe thermometer demo", noteClass: "text-teal-600" },
          { label: "Zona dalam target", value: "6 / 6 zona", note: "Lounge menggunakan sampel 14:00", noteClass: "text-amber-400" }
        ]
      }
    ]
  },

  historical: {
    kpiGroups: [
      {
        target: "kpi-historical-main",
        items: [
          { label: "Total konsumsi", value: "1.742,8 kWh", note: "Hari terakhir parsial hingga 14:30", noteClass: "text-teal-600" },
          { label: "Daya puncak periode", value: "31,6 kW", note: "30 Sep 2026 · 10:45 WIB", noteClass: "text-teal-600" },
          { label: "Suhu indoor rata-rata", value: "24,7 °C", note: "Min 23,8 °C · max 26,2 °C", noteClass: "text-teal-600" },
          { label: "Kelengkapan data", value: "99,2 %", note: "3.774 / 3.804 sampel valid", noteClass: "text-teal-600" }
        ]
      }
    ]
  }
};
