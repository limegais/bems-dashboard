# 📘 DOKUMENTASI & RANGKUMAN ARSITEKTUR DATABASE BEMS LIVING LAB
**Sistem Manajemen & Pemantauan Energi Gedung — Fakultas Teknik Universitas Sebelas Maret (FT UNS)**

---

## 📌 Ringkasan Eksekutif & Metadata Sistem

| Parameter | Spesifikasi |
|---|---|
| **Nama Database** | `bems_db` |
| **Engine Database** | PostgreSQL 18 (Cluster `18-main`) |
| **Sistem Operasi Server** | Ubuntu 26.04.1 LTS (x86_64, Linux 7.0 generic) |
| **Port Aktif** | **Port `5433`** (Local Unix Socket: `/var/run/postgresql/.s.PGSQL.5433`) |
| **User & Autentikasi** | `iotlab` (Superuser Peer Auth) & `bems_user` (SCRAM-SHA-256) |
| **Frekuensi Penyimpanan** | **SETIAP 5 DETIK SEKALI SECARA KONTINU (12 snapshot/menit)** |
| **Broker Sumber Telemetri** | MQTT `128.199.206.166:1883` & API Energy `iotlab-uns.com` |
| **Total Objek Database** | 7 Schema \| 20 Tabel \| 20+ Index Teroptimasi \| 7 View Analitik \| 2 Fungsi ISO 7730 |

---

## 🏗️ 1. Peta 7 Skema Modul Database

Database `bems_db` dirancang modular agar data time-series berkecepatan tinggi terpisah dari data master, model AI, dan log aktuasi:

```
                                  ┌──────────────────────────────────┐
                                  │      DATABASE: bems_db (5433)    │
                                  └─────────────────┬────────────────┘
                                                    │
        ┌───────────────────┬───────────────────────┼───────────────────────┬───────────────────┐
        ▼                   ▼                       ▼                       ▼                   ▼
┌──────────────┐    ┌──────────────┐        ┌──────────────┐        ┌──────────────┐    ┌──────────────┐
│  bems_core   │    │bems_telemetry│        │ bems_energy  │        │   bems_ai    │    │ bems_control │
│ (Master Data)│    │ (Time-Series)│        │ (Agregasi)   │        │  (Prediksi)  │    │  (Aktuasi)   │
└──────────────┘    └──────────────┘        └──────────────┘        └──────────────┘    └──────────────┘
                            │                       ▲
                            └───── Ingest 5s ───────┘
```

1. **`bems_core`** : Master data denah ruang, 6 stasiun kerja SHT31, akun user (RBAC), dan inventaris perangkat.
2. **`bems_telemetry`** : Data telemetri time-series yang disimpan **setiap 5 detik** (SHT31, NNZN Weather, PZEM Energy, Okupansi, Raw MQTT).
3. **`bems_energy`** : Agregasi konsumsi listrik (per jam, per hari, per bulan) dan riwayat tarif PLN.
4. **`bems_feedback`** : Voting kenyamanan termal & visual penghuni (skala ASHRAE 55 7-point).
5. **`bems_ai`** : Registrasi model AI (Bi-LSTM, TFT), hasil peramalan (*forecasting*), dan solusi optimasi (*Pareto Front*).
6. **`bems_control`** : Rekam jejak perintah kendali AC & Dimmer serta batasan keselamatan (*safety interlock*).
7. **`bems_audit`** : Audit trail dan log perubahan konfigurasi sistem.

---

## 📊 2. Struktur Detail Tabel per Skema

### A. Skema `bems_core` (Master Data & Inventaris)
- **`users`** : Manajemen akun pengguna.
  - `id` (PK, Serial), `username` (VarChar 50), `email`, `password_hash`, `full_name`, `role` (`superadmin`, `researcher`, `operator`, `occupant`), `is_active`, `created_at`.
- **`buildings`** : Profil fisik gedung.
  - `id` (PK), `code` (`FT_UNS_B2`), `name`, `address`, `latitude` (-7.5594), `longitude` (110.8595), `timezone` (`Asia/Jakarta`).
- **`rooms`** : Ruangan Living Lab IoT.
  - `id` (PK), `code` (`SMART_ROOM_01`), `area_sqm` (72.00 $m^2$), `height_m` (3.20 m), `target_temp_min` (23.0°C), `target_temp_max` (26.0°C), `target_rh_min` (40%), `target_rh_max` (60%), `target_lux_min` (350 lx), `target_co2_max` (1000 ppm).
- **`workstations`** : Master 6 titik meja kerja sensor SHT31.
  - `id` (PK 1..6), `code` (`sht-1` s.d. `sht-6`), `label`, `legacy_alias` (`G, C, A, D, H, E`), `zone_name`, `ip_address` (ESP32 IP), `coord_x_m`, `coord_y_m`, `cal_offset_temp`, `cal_offset_rh`.
- **`devices`** : Inventaris IoT Hardware.
  - `id` (PK), `device_code` (`PZEM_CH1_AC`, `PZEM_CH2_SOCKET`, `PZEM_CH3_LAMP`, `NNZN_WEATHER`, `AC_DAIKIN`, `DIMMER_Z1`, `DIMMER_Z2`, `RADAR_MMWAVE_01`), `device_type`, `model_name`, `ip_or_bus_addr`.

---

### B. Skema `bems_telemetry` (Time-Series 5 Detik)
*Semua tabel di bawah memiliki indeks `(time DESC)` untuk performa query instan pada jutaan baris data.*

#### 1. `bems_telemetry.sht31_readings` (6 Baris per 5 Detik)
Menyimpan kondisi lingkungan mikro pada 6 workstation meja kerja:
| Nama Kolom | Tipe Data | Keterangan & Satuan |
|---|---|---|
| `time` | `TIMESTAMPTZ` | Waktu pencatatan (UTC/WIB) presisi 5 detik |
| `workstation_id` | `INT (FK)` | Relasi ke `bems_core.workstations.id` (1 s.d. 6) |
| `air_temperature` | `REAL` | Suhu udara kering ($T_a$) dalam °C |
| `relative_humidity` | `REAL` | Kelembapan relatif ($RH$) dalam % |
| `dew_point_c` | `REAL` | Titik embun dihitung formula Magnus (°C) |
| `heat_index_c` | `REAL` | Indeks bahaya panas regresi Rothfusz (°C) |
| `lux_level` | `REAL` | Intensitas cahaya lokal meja kerja (lx) |
| `fanger_pmv` | `REAL` | Nilai Predicted Mean Vote ISO 7730 (-3 s.d. +3) |
| `fanger_ppd` | `REAL` | Predicted Percentage of Dissatisfied (%) |
| `mqtt_topic` | `VARCHAR` | Topik MQTT asal (`sht-1/sensor/state`) |

#### 2. `bems_telemetry.nnzn_weather` (1 Baris per 5 Detik)
Menyimpan cuaca outdoor dan multi-sensor bus RS485:
| Nama Kolom | Tipe Data | Keterangan & Satuan |
|---|---|---|
| `time` | `TIMESTAMPTZ` | Waktu pencatatan presisi 5 detik |
| `device_id` | `INT (FK)` | Relasi ke `bems_core.devices.id` (`NNZN_WEATHER`) |
| `outdoor_temp_c` | `REAL` | Suhu udara luar ruangan (°C) |
| `outdoor_rh_pct` | `REAL` | Kelembapan udara luar ruangan (%) |
| `solar_irradiance` | `REAL` | Radiasi matahari global ($W/m^2$) |
| `outdoor_lux` | `REAL` | Iluminansi sinar matahari luar (lx) |
| `lux_wb1`..`lux_wb4`| `REAL` | Sensor lux indoor zona WB1 s.d. WB4 (lx) |
| `co2_outdoor_ppm` | `REAL` | Kadar karbon dioksida ruangan (ppm) |
| `airflow_speed_ms` | `REAL` | Kecepatan aliran udara anemometer (m/s) |

#### 3. `bems_telemetry.pzem_readings` (3 Baris per 5 Detik)
Sub-metering konsumsi listrik 3 kanal PZEM-004T:
| Nama Kolom | Tipe Data | Keterangan & Satuan |
|---|---|---|
| `time` | `TIMESTAMPTZ` | Waktu pencatatan presisi 5 detik |
| `channel_id` | `SMALLINT` | `1` = AC Inverter, `2` = Socket/Stop Kontak, `3` = Lampu |
| `channel_label` | `VARCHAR(30)` | Nama beban listrik |
| `voltage_v` | `REAL` | Tegangan listrik jala-jala PLN (Volt) |
| `current_a` | `REAL` | Arus listrik terukur (Ampere) |
| `active_power_w` | `REAL` | Daya aktif nyata (Watt) |
| `power_factor` | `REAL` | Faktor daya $\cos \phi$ (0.0 s.d. 1.0) |
| `energy_kwh` | `DOUBLE PRECISION`| Akumulasi konsumsi energi listrik kumulatif (kWh) |
| `cost_idr` | `NUMERIC(12,2)` | Estimasi biaya pemakaian tarif PLN (Rupiah) |
| `co2_kg` | `REAL` | Estimasi emisi jejak karbon (Faktor: $0.85\text{ kg CO}_2\text{/kWh}$) |

#### 4. `bems_telemetry.occupancy` (1 Baris per 5 Detik)
| Nama Kolom | Tipe Data | Keterangan |
|---|---|---|
| `time` | `TIMESTAMPTZ` | Waktu pencatatan |
| `room_id` | `INT (FK)` | Relasi ke `bems_core.rooms.id` |
| `headcount` | `SMALLINT` | Estimasi jumlah orang di dalam ruang |
| `motion_detected` | `BOOLEAN` | Status deteksi pergerakan (True/False) |
| `detection_method`| `VARCHAR` | Sensor/Kamera pemantau (`camera_yolo`, `mmWave_radar`) |
| `detection_confidence` | `REAL` | Skor akurasi deteksi (0.0 s.d. 1.0) |

#### 5. `bems_telemetry.mqtt_raw_log` (Real-Time per Paket Masuk)
Arsip lengkap seluruh pesan biner/string MQTT tanpa modifikasi:
- `id` (BIGSERIAL), `received_at`, `mqtt_topic`, `payload_raw`, `broker_host`, `processed`.

---

### C. Skema `bems_energy` (Agregasi Historis & Tarif)
- **`hourly_summary`** : Ringkasan per jam (Daya rata-rata W, Daya puncak W, Total kWh, Total Biaya Rp).
- **`daily_summary`** : Ringkasan per hari (Total kWh, Target Baseline, Penghematan %).
- **`monthly_summary`** : Ringkasan bulanan dan perhitungan EUI (*Energy Use Intensity* $kWh/m^2$).
- **`tarif_history`** : Master tarif listrik PLN resmi (Golongan I3/TM Rp 1.444,70 / kWh).

---

### D. Skema `bems_feedback` (Kuesioner Kenyamanan Penghuni)
- **`comfort_votes`** :
  - `thermal_vote` : -3 (Cold), -2 (Cool), -1 (Slightly Cool), 0 (Neutral), +1 (Slightly Warm), +2 (Warm), +3 (Hot).
  - `visual_vote` : -2 (Too Dim), -1 (Dim), 0 (Just Right), +1 (Bright), +2 (Glare/Too Bright).
  - `air_movement_preference` : Kurang, Pas, Terlalu Kencang.
  - `clothing_clo` : Nilai isolasi pakaian (0.5 clo = kemeja pendek, 1.0 clo = jas/jaket).
  - `metabolic_rate` : Aktivitas fisik (1.0 = istirahat, 1.2 = mengetik/duduk).

---

### E. Skema `bems_ai` (Machine Learning & Optimasi)
- **`model_registry`** : Metadata model Bi-LSTM, TFT, LightGBM (Hyperparameter JSON, Metrik MAE, RMSE, $R^2$).
- **`forecast_records`** : Output inferensi prediksi beban listrik (W) dan suhu (°C) untuk 1 s.d. 24 jam ke depan lengkap dengan $95\%$ Confidence Interval (`pred_lower_95`, `pred_upper_95`).
- **`optimization_runs`** : Log running algoritma MOGA/NSGA-II dan MOPSO (Jumlah generasi, populasi, waktu konvergensi).
- **`pareto_solutions`** : Kumpulan titik solusi *Pareto Optimal* (trade-off antara konsumsi listrik terendah vs discomfort indeks termal PMV terkecil).

---

### F. Skema `bems_control` (Aktuasi & Safety Interlock)
- **`actuation_logs`** : Rekam jejak seluruh aksi aktuasi kontrol:
  - Setpoint AC (°C), Kecepatan kipas, Mode (Cool/Dry/Fan).
  - Level redup lampu Dimmer Zona 1 & Zona 2 (0 - 100%).
  - Pemicu perintah (`user_manual`, `ai_optimization`, `rule_engine`).
- **`safety_rules`** : Aturan interlock keselamatan perangkat:
  - `MIN_COMPRESSOR_DELAY`: Jeda minimal 3 menit antara perintah ON/OFF kompresor AC.
  - `TEMP_RANGE_GUARD`: Batas setpoint AC hanya boleh antara 18°C s.d. 30°C.
  - `CO2_VENTILATION`: Ventilasi paksa menyala otomatis jika $CO_2 > 1000\text{ ppm}$.

---

## 🧮 3. Fungsi Komputasi Termal Tersimpan (PL/pgSQL)

Database dilengkapi fungsi bawaan berstandar internasional ISO 7730:
1. **`bems_core.calc_pmv(ta, tr, va, rh, met, clo)`**
   - Menghitung nilai **PMV** (*Predicted Mean Vote*) Fanger langsung di dalam database SQL dengan mempertimbangkan suhu radiasi $T_r$, suhu udara $T_a$, kecepatan angin $v_a$, dan kelembapan $RH$.
2. **`bems_core.calc_ppd(pmv)`**
   - Menghitung persentase ketidakpuasan penghuni **PPD** ($0\text{ s.d. }100\%$) berdasarkan nilai PMV.

---

## 💾 4. Cara Ekspor Data Database dari Server Linux

Anda dapat mengekspor data database ke berbagai format kapan saja melalui terminal SSH:

### A. Ekspor Seluruh Database ke File SQL (.sql)
```bash
pg_dump -p 5433 -U iotlab -d bems_db -F p -f ~/bems_db_backup.sql
```

### B. Ekspor Data Sensor SHT31 ke File CSV (Bisa Dibuka di Excel / SPSS)
```bash
psql -p 5433 -d bems_db -c "\copy (SELECT * FROM bems_telemetry.sht31_readings ORDER BY time DESC) TO '~/sht31_data.csv' WITH CSV HEADER;"
```

### C. Ekspor Data Energi PZEM ke File CSV
```bash
psql -p 5433 -d bems_db -c "\copy (SELECT * FROM bems_telemetry.pzem_readings ORDER BY time DESC) TO '~/pzem_energy_data.csv' WITH CSV HEADER;"
```

### D. Ekspor Data Cuaca NNZN ke File CSV
```bash
psql -p 5433 -d bems_db -c "\copy (SELECT * FROM bems_telemetry.nnzn_weather ORDER BY time DESC) TO '~/nnzn_weather_data.csv' WITH CSV HEADER;"
```

---

## 📈 5. Contoh Query Analitik Siap Pakai

#### 1. Perbandingan Suhu Meja Dekat Jendela (WB1) vs Meja Dalam (WB3)
```sql
SELECT 
    date_trunc('minute', time) AS menit,
    AVG(CASE WHEN workstation_id = 1 THEN air_temperature END) AS temp_window_wb1,
    AVG(CASE WHEN workstation_id = 3 THEN air_temperature END) AS temp_inner_wb3
FROM bems_telemetry.sht31_readings
WHERE time > NOW() - INTERVAL '1 hour'
GROUP BY 1 ORDER BY 1 DESC;
```

#### 2. Total Pemakaian Listrik Hari Ini (kWh) & Total Biaya (Rupiah)
```sql
SELECT 
    channel_label,
    ROUND(MAX(energy_kwh) - MIN(energy_kwh), 3) AS konsumsi_kwh_hari_ini,
    ROUND((MAX(energy_kwh) - MIN(energy_kwh)) * 1444.70, 0) AS biaya_rupiah
FROM bems_telemetry.pzem_readings
WHERE time >= CURRENT_DATE
GROUP BY channel_label;
```

#### 3. Cek Jumlah Data Sensor yang Berhasil Tersimpan Hari Ini
```sql
SELECT 
    (SELECT count(*) FROM bems_telemetry.sht31_readings WHERE time >= CURRENT_DATE) AS total_sht31_rows,
    (SELECT count(*) FROM bems_telemetry.nnzn_weather WHERE time >= CURRENT_DATE) AS total_weather_rows,
    (SELECT count(*) FROM bems_telemetry.pzem_readings WHERE time >= CURRENT_DATE) AS total_energy_rows,
    (SELECT count(*) FROM bems_telemetry.occupancy WHERE time >= CURRENT_DATE) AS total_occupancy_rows;
```

---

## 🛠️ 6. Informasi Service Daemon Linux

| Service Unit | Port / Eksekusi | Status | Keterangan |
|---|---|---|---|
| **`bems-collector.service`** | Python `.venv` | `active (running)` | Daemon ingest 5 detik ke PostgreSQL port `5433` |
| **`bems-bridge.service`** | Port **`9002`** | `active (running)` | Proxy WebSocket-to-TCP untuk browser web |
| **`bems-web.service`** | Port **`3001`** | `active (running)` | Web HTTP Server antarmuka BEMS |
| **`postgresql.service`** | Port **`5433`** | `active (running)` | Server database PostgreSQL 18 |

---
*Dokumen ini disusun untuk Living Lab Smart Room FT UNS — Siap diekspor ke format PDF, Markdown, atau disitasi dalam laporan teknis dan publikasi ilmiah.*
