#!/usr/bin/env bash
# ==============================================================================
# BEMS Living Lab - Automated Linux (Ubuntu 26.04 / Debian) Deployment Script
# Target: dewa-iotlab (iotlab@dewa-iotlab)
# ==============================================================================
set -e

# Warna Terminal
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${CYAN}${BOLD}"
echo "=================================================================="
echo "    BEMS DASHBOARD & POSTGRESQL TELEMETRY - LINUX DEPLOYMENT     "
echo "=================================================================="
echo -e "${NC}"

CURRENT_DIR=$(pwd)
CURRENT_USER=$(whoami)

echo -e "${BLUE}[1/6] Memeriksa Hak Akses dan Lingkungan...${NC}"
echo "User saat ini : $CURRENT_USER"
echo "Direktori     : $CURRENT_DIR"

if [ "$EUID" -eq 0 ]; then
    echo -e "${YELLOW}Perhatian: Script dijalankan sebagai root. Disarankan dijalankan sebagai user biasa (iotlab) dengan akses sudo.${NC}"
fi

echo -e "\n${BLUE}[2/6] Memperbarui Paket & Menginstal Dependensi Sistem...${NC}"
sudo apt update
sudo apt install -y postgresql postgresql-contrib python3 python3-pip python3-venv git curl ufw

echo -e "\n${BLUE}[3/6] Mengonfigurasi Database PostgreSQL (bems_db)...${NC}"
sudo systemctl enable --now postgresql

# Buat User bems_user jika belum ada
echo "Membuat role bems_user di PostgreSQL..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='bems_user'" | grep -q 1 || \
sudo -u postgres psql -c "CREATE USER bems_user WITH PASSWORD 'bems_password_secure' CREATEDB;"

# Buat Database bems_db jika belum ada
echo "Membuat database bems_db..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='bems_db'" | grep -q 1 || \
sudo -u postgres psql -c "CREATE DATABASE bems_db OWNER bems_user;"

# Grant privileges
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE bems_db TO bems_user;"
sudo -u postgres psql -d bems_db -c "GRANT ALL ON SCHEMA public TO bems_user;"

# Import Schema
echo "Mengimpor skema database dari database/bems_schema_postgresql.sql..."
if [ -f "$CURRENT_DIR/database/bems_schema_postgresql.sql" ]; then
    cat "$CURRENT_DIR/database/bems_schema_postgresql.sql" | sudo -u postgres psql -d bems_db
    echo -e "${GREEN}Skema bems_schema_postgresql.sql berhasil diimpor!${NC}"
else
    echo -e "${RED}File database/bems_schema_postgresql.sql tidak ditemukan!${NC}"
    exit 1
fi

echo -e "\n${BLUE}[4/6] Menyiapkan Python Virtual Environment (.venv)...${NC}"
if [ ! -d "$CURRENT_DIR/.venv" ]; then
    python3 -m venv "$CURRENT_DIR/.venv"
fi

"$CURRENT_DIR/.venv/bin/pip" install --upgrade pip
"$CURRENT_DIR/.venv/bin/pip" install -r "$CURRENT_DIR/requirements.txt"
echo -e "${GREEN}Dependensi Python berhasil diinstal.${NC}"

echo -e "\n${BLUE}[5/6] Mengonfigurasi Systemd Services (Autostart on Boot)...${NC}"

# Buat unit file bems-bridge
sudo bash -c "cat > /etc/systemd/system/bems-bridge.service" <<EOF
[Unit]
Description=BEMS WebSocket-to-MQTT Bridge Service
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$CURRENT_DIR
ExecStart=$CURRENT_DIR/.venv/bin/python bridge.py
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

# Buat unit file bems-collector
sudo bash -c "cat > /etc/systemd/system/bems-collector.service" <<EOF
[Unit]
Description=BEMS Telemetry & Database Ingestion Collector
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$CURRENT_DIR
ExecStart=$CURRENT_DIR/.venv/bin/python collector.py
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=PYTHONUNBUFFERED=1
Environment=PG_HOST=localhost
Environment=PG_PORT=5432
Environment=PG_DATABASE=bems_db
Environment=PG_USER=bems_user
Environment=PG_PASSWORD=bems_password_secure

[Install]
WantedBy=multi-user.target
EOF

# Buat unit file bems-web
sudo bash -c "cat > /etc/systemd/system/bems-web.service" <<EOF
[Unit]
Description=BEMS Web Dashboard HTTP Server
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$CURRENT_DIR
ExecStart=/usr/bin/python3 -m http.server 3000 --bind 0.0.0.0
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

echo "Reload systemd daemon dan mengaktifkan service..."
sudo systemctl daemon-reload
sudo systemctl enable --now bems-bridge.service
sudo systemctl enable --now bems-collector.service
sudo systemctl enable --now bems-web.service

echo -e "\n${BLUE}[6/6] Memeriksa Status Layanan...${NC}"
sleep 2

sudo systemctl is-active --quiet bems-bridge.service && \
    echo -e "  [+] bems-bridge    : ${GREEN}RUNNING (Port 9001)${NC}" || \
    echo -e "  [-] bems-bridge    : ${RED}FAILED${NC}"

sudo systemctl is-active --quiet bems-collector.service && \
    echo -e "  [+] bems-collector : ${GREEN}RUNNING (MQTT Ingestion to bems_db)${NC}" || \
    echo -e "  [-] bems-collector : ${RED}FAILED${NC}"

sudo systemctl is-active --quiet bems-web.service && \
    echo -e "  [+] bems-web       : ${GREEN}RUNNING (Port 3000)${NC}" || \
    echo -e "  [-] bems-web       : ${RED}FAILED${NC}"

# Ambil IP address mesin
IP_ADDR=$(hostname -I | awk '{print $1}')

echo -e "\n${GREEN}${BOLD}=================================================================="
echo "           DEPLOYMENT BEMS BERHASIL SELESAI!"
echo "==================================================================${NC}"
echo -e "Dashboard Web dapat diakses di:"
echo -e "  > Lokal Mesin : ${CYAN}http://localhost:3000${NC}"
if [ -n "$IP_ADDR" ]; then
    echo -e "  > Jaringan LAN: ${CYAN}http://${IP_ADDR}:3000${NC}"
fi
echo -e "  > WebSocket Bridge Port : ${CYAN}9001${NC}"
echo -e "  > PostgreSQL DB         : ${CYAN}localhost:5432 / bems_db${NC}"
echo ""
echo -e "${YELLOW}Perintah Berguna untuk Monitoring:${NC}"
echo "  - Cek log collector : sudo journalctl -u bems-collector -f"
echo "  - Cek log bridge    : sudo journalctl -u bems-bridge -f"
echo "  - Cek log web       : sudo journalctl -u bems-web -f"
echo "  - Restart service   : sudo systemctl restart bems-collector bems-bridge bems-web"
echo "  - Query database    : psql -U bems_user -d bems_db -h localhost"
echo "=================================================================="
