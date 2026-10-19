# BEMS / Living Lab Dashboard & PostgreSQL Telemetry System

Sistem pemantauan & manajemen energi gedung (Building Energy Management System) Living Lab FT UNS berbasis real-time MQTT, PostgreSQL time-series, dan modern web dashboard.

---

## 🚀 Panduan Deployment di Linux (Ubuntu / Debian via SSH)

Jika Anda mengakses server Linux melalui SSH (`iotlab@dewa-iotlab:~$`), ikuti langkah praktis berikut:

### 1. Clone Repository dari GitHub
```bash
git clone https://github.com/limegais/bems-dashboard.git
cd bems-dashboard
```

### 2. Jalankan Script Deployment Otomatis
Script ini secara otomatis menginstal PostgreSQL, mengimpor skema `bems_schema_postgresql.sql`, menyiapkan environment Python, dan memasang daemon systemd:
```bash
chmod +x deploy_linux.sh
./deploy_linux.sh
```

### 3. Layanan yang Otomatis Berjalan (Systemd)
| Layanan | Unit Systemd | Port / Target | Fungsi |
|---|---|---|---|
| **Web Dashboard** | `bems-web.service` | `:3000` | HTTP Server untuk antarmuka web |
| **MQTT Bridge** | `bems-bridge.service` | `:9001` -> `:1883` | WebSocket-to-TCP proxy untuk browser |
| **Data Collector** | `bems-collector.service` | PostgreSQL `bems_db` | Ingest sensor SHT31, NNZN, PZEM, Camera |

### 4. Perintah Berguna di Terminal Linux
```bash
# Cek status ketiga layanan
sudo systemctl status bems-web bems-bridge bems-collector

# Melihat log real-time collector data masuk ke database
sudo journalctl -u bems-collector -f

# Akses database PostgreSQL langsung
psql -U bems_user -d bems_db -h localhost

# Restart layanan jika ada perubahan kode
sudo systemctl restart bems-web bems-bridge bems-collector
```

---

## 💻 Menjalankan di Lokal (Windows)

Cukup double-click `start.bat` atau jalankan via PowerShell:
```powershell
.\start.ps1
```
Dashboard akan terbuka di `http://localhost:3000`.

---

## 🗄️ Arsitektur Database PostgreSQL (`bems_db`)

Skema database tersimpan di [`database/bems_schema_postgresql.sql`](file:///c:/Users/ramad/OneDrive/Dokumen/KULOIYEAH/PROJECT/bems-dashboard-mockup/database/bems_schema_postgresql.sql) dengan 7 schema modul:
1. `bems_core` — User RBAC, metadata gedung, master 6 workstation SHT31, inventaris sensor & aktuator.
2. `bems_telemetry` — Time-series SHT31 (Temp, RH, Dew Point, Heat Index), NNZN weather (solar, outdoor temp/RH, lux, CO2), PZEM-004T 3-channel power/kWh, occupancy kamera, dan audit raw log MQTT.
3. `bems_energy` — Agregasi konsumsi per jam/hari/bulan dan riwayat tarif PLN per kWh.
4. `bems_feedback` — Thermal & visual comfort voting (ASHRAE 55 7-point scale).
5. `bems_ai` — Model registry (Bi-LSTM, TFT, LightGBM), forecast log, Pareto solutions (MOGA/MOPSO).
6. `bems_control` — Actuation audit log (AC & Lampu) serta batas keselamatan operasi.
7. `bems_audit` — Perubahan data dan session log.