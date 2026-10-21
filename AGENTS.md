# Aturan dan Pengetahuan Tetap Workspace BEMS Dashboard

## 🔐 KONEKSI REMOTE PC SERVER (PENTING & PERMANEN)

Server PC BEMS Living Lab (`dewa-iotlab`) **WAJIB SELALU** diremote menggunakan perintah dan konfigurasi berikut:

```bash
ssh iotlab@10.8.0.7
```

### Parameter Koneksi Server:
- **Host / IP**: `10.8.0.7` (IP VPN WireGuard - selalu gunakan IP ini untuk akses remote dari manapun)
- **User**: `iotlab`
- **Password**: `iotlabftuns2023`
- **Hostname**: `dewa-iotlab`
- **Direktori Proyek di Server**: `/home/iotlab/bems-dashboard`
- **Git Remote di Server**: `origin https://github.com/limegais/bems-dashboard.git` (branch `main`)

> [!CAUTION]
> **JANGAN PERNAH** mencoba koneksi default ke `10.18.0.57` (IP lokal subnet kampus) jika sedang berada di luar jaringan fisik lab, karena akan timeout.
> **SELALU GUNAKAN**: `10.8.0.7` (`ssh iotlab@10.8.0.7`).

---

## 🚀 Prosedur Deploy / Upload ke Server:
1. **Commit & Push lokal**:
   ```bash
   git add <files>
   git commit -m "feat/fix: <pesan>"
   git push origin main
   ```
2. **Tarik di Server (`10.8.0.7`)**:
   ```bash
   git -C /home/iotlab/bems-dashboard pull origin main
   ```
3. **Restart Service Web jika ada perubahan**:
   ```bash
   echo iotlabftuns2023 | sudo -S systemctl restart bems-web
   ```
4. **Periksa Status Service**:
   ```bash
   systemctl is-active bems-web bems-bridge bems-collector
   ```
   - `bems-web`: Web server port 3001
   - `bems-bridge`: WebSocket bridge port 9002
   - `bems-collector`: Ingest telemetri PostgreSQL (database `bems_db`)
