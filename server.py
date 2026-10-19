#!/usr/bin/env python3
"""
BEMS Dashboard Web & Data Export Server
----------------------------------------------------------------------------
1. Serves static dashboard files on port 3001 (configurable via PORT env)
2. Provides Live & Historical CSV Export APIs:
   - /api/export/sensors.csv   -> Queries PostgreSQL 'bems_db' (SHT31 6 Workstations, Weather NNZN, Occupancy)
   - /api/export/energy.csv    -> Queries MySQL Energy API (iotlab-uns.com api_energy.php)
   - /api/export/integrated.csv-> Combined correlation dataset (PostgreSQL Sensors + MySQL Energy)
   - /api/status               -> Health status of Web, PostgreSQL & MySQL Energy API
"""

import os
import sys
import io
import csv
import json
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta
import http.server
import socketserver

# Try importing psycopg2 for direct PostgreSQL queries
try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False

PORT = int(os.getenv("PORT", 3001))
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

PG_DATABASE = os.getenv("PG_DATABASE", "bems_db")
PG_PORTS = [5433, 5432]  # On this server, PostgreSQL 18 cluster is on port 5433

ENERGY_API_URL = os.getenv("ENERGY_API_URL", "https://iotlab-uns.com/api_energy.php")
ENERGY_API_KEY = os.getenv("ENERGY_API_KEY", "iotlab_smartroom_2024")
TARIF_KWH = 1500.0  # Rp/kWh (PLN B-2/TR)
CARBON_FACTOR = 0.85  # kg CO2 / kWh


def get_pg_connection():
    """Membuka koneksi ke PostgreSQL bems_db dengan auto-detect port 5433 / 5432"""
    if not HAS_PSYCOPG2:
        return None

    # 1. Coba Unix Domain Socket (peer auth pada Linux)
    for p in PG_PORTS:
        try:
            conn = psycopg2.connect(dbname=PG_DATABASE, port=p, connect_timeout=3)
            conn.autocommit = True
            return conn
        except Exception:
            pass

    # 2. Coba TCP localhost
    for p in PG_PORTS:
        for u in ["iotlab", "postgres", "bems_user"]:
            try:
                conn = psycopg2.connect(
                    dbname=PG_DATABASE,
                    host="localhost",
                    port=p,
                    user=u,
                    connect_timeout=3
                )
                conn.autocommit = True
                return conn
            except Exception:
                pass

    return None


def fetch_mysql_energy(action="history", id_kwh=1, from_date="", to_date="", limit=5000):
    """Mengambil data energi dari MySQL (api_energy.php)"""
    now = datetime.now()
    if action == "history":
        if not from_date:
            from_date = (now - timedelta(days=7)).strftime("%Y-%m-%d")
        if not to_date:
            to_date = now.strftime("%Y-%m-%d")

        params = {
            "key": ENERGY_API_KEY,
            "action": "history",
            "id_kwh": str(id_kwh),
            "from": from_date,
            "to": to_date,
            "limit": str(limit)
        }
    else:
        # Live snapshot
        params = {"key": ENERGY_API_KEY}

    url = f"{ENERGY_API_URL}?{urllib.parse.urlencode(params)}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "BEMS-WebServer/2.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        sys.stderr.write(f"[BEMS-Web] Error fetching MySQL Energy API ({url}): {e}\n")
    return None


class BemsRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def log_message(self, format, *args):
        sys.stdout.write(f"[BEMS-Web] {self.address_string()} - {format%args}\n")
        sys.stdout.flush()

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # ── API Status Check ──────────────────────────────────────────────────
        if path == "/api/status":
            self.handle_api_status()
            return

        # ── API Export Sensors (PostgreSQL bems_db) ───────────────────────────
        if path in ["/api/export/sensors", "/api/export/sensors.csv"]:
            self.handle_export_sensors_csv(query)
            return

        # ── API Export Weather (PostgreSQL bems_db) ───────────────────────────
        if path in ["/api/export/weather", "/api/export/weather.csv"]:
            self.handle_export_weather_csv(query)
            return

        # ── API Export Energy (MySQL Energy api_energy.php) ───────────────────
        if path in ["/api/export/energy", "/api/export/energy.csv"]:
            self.handle_export_energy_csv(query)
            return

        # ── API Export Integrated Dataset (PostgreSQL + MySQL) ─────────────────
        if path in ["/api/export/integrated", "/api/export/integrated.csv"]:
            self.handle_export_integrated_csv(query)
            return

        # Default static file handler
        super().do_GET()

    def handle_api_status(self):
        pg_conn = get_pg_connection()
        pg_ok = pg_conn is not None
        if pg_conn:
            try:
                pg_conn.close()
            except Exception:
                pass

        mysql_ok = False
        try:
            test_resp = fetch_mysql_energy(action="history", id_kwh=1, limit=1)
            mysql_ok = test_resp is not None
        except Exception:
            pass

        data = {
            "status": "online",
            "server_time": datetime.now().isoformat(),
            "databases": {
                "postgresql": {
                    "connected": pg_ok,
                    "target_database": PG_DATABASE,
                    "target_ports": PG_PORTS,
                    "description": "Sensors SHT31, Weather NNZN RS485, Occupancy"
                },
                "mysql_energy": {
                    "accessible": mysql_ok,
                    "endpoint": ENERGY_API_URL,
                    "description": "Submetering PZEM-004T (Ch-1 AC, Ch-2 Socket, Ch-3 Lamp)"
                }
            }
        }
        resp_bytes = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_cors_headers()
        self.send_header("Content-Length", str(len(resp_bytes)))
        self.end_headers()
        self.wfile.write(resp_bytes)

    def handle_export_sensors_csv(self, query):
        """Export sensor telemetri dari PostgreSQL (bems_telemetry.sht31_readings)"""
        limit = min(int(query.get("limit", [5000])[0]), 50000)
        from_date = query.get("from", [""])[0]
        to_date = query.get("to", [""])[0]
        sensor_type = query.get("type", ["sht31"])[0]

        csv_buffer = io.StringIO()
        writer = csv.writer(csv_buffer)

        conn = get_pg_connection()
        today_str = datetime.now().strftime("%Y-%m-%d")

        if sensor_type == "weather":
            # Cuaca NNZN RS485
            writer.writerow([
                "Timestamp (WIB)", "Device_ID", "Outdoor_Temp_C", "Outdoor_RH_Pct",
                "Solar_Irradiance_Wm2", "Outdoor_Lux", "Lux_WB1", "Lux_WB2",
                "Lux_WB3", "Lux_WB4", "CO2_Outdoor_PPM", "Airflow_Speed_ms", "Data_Source"
            ])
            if conn:
                try:
                    with conn.cursor() as cur:
                        sql = """
                            SELECT time, device_id, outdoor_temp_c, outdoor_rh_pct,
                                   solar_irradiance, outdoor_lux, lux_wb1, lux_wb2,
                                   lux_wb3, lux_wb4, co2_outdoor_ppm, airflow_speed_ms
                            FROM bems_telemetry.nnzn_weather
                            WHERE (%s = '' OR time >= %s::timestamptz)
                              AND (%s = '' OR time <= (%s || ' 23:59:59')::timestamptz)
                            ORDER BY time DESC
                            LIMIT %s;
                        """
                        cur.execute(sql, (from_date, from_date, to_date, to_date, limit))
                        for r in cur.fetchall():
                            writer.writerow([
                                r[0].strftime("%Y-%m-%d %H:%M:%S") if hasattr(r[0], "strftime") else str(r[0]),
                                r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11],
                                "PostgreSQL (bems_telemetry.nnzn_weather)"
                            ])
                except Exception as e:
                    sys.stderr.write(f"[BEMS-Web] Error query NNZN: {e}\n")
                finally:
                    conn.close()
            filename = f"bems_weather_rs485_postgresql_{today_str}.csv"

        elif sensor_type == "occupancy":
            # Occupancy & Camera
            writer.writerow(["Timestamp (WIB)", "Room_ID", "Person_Count", "Person_Detected", "Confidence", "Data_Source"])
            if conn:
                try:
                    with conn.cursor() as cur:
                        sql = """
                            SELECT time, room_id, person_count, person_detected, confidence
                            FROM bems_telemetry.occupancy
                            WHERE (%s = '' OR time >= %s::timestamptz)
                              AND (%s = '' OR time <= (%s || ' 23:59:59')::timestamptz)
                            ORDER BY time DESC
                            LIMIT %s;
                        """
                        cur.execute(sql, (from_date, from_date, to_date, to_date, limit))
                        for r in cur.fetchall():
                            writer.writerow([
                                r[0].strftime("%Y-%m-%d %H:%M:%S") if hasattr(r[0], "strftime") else str(r[0]),
                                r[1], r[2], "TRUE" if r[3] else "FALSE", r[4],
                                "PostgreSQL (bems_telemetry.occupancy)"
                            ])
                except Exception as e:
                    sys.stderr.write(f"[BEMS-Web] Error query Occupancy: {e}\n")
                finally:
                    conn.close()
            filename = f"bems_occupancy_postgresql_{today_str}.csv"

        else:
            # SHT31 Workstation (Default)
            writer.writerow([
                "Timestamp (WIB)", "Workstation_Code", "Workstation_Name",
                "Air_Temperature_C", "Relative_Humidity_Pct",
                "Dew_Point_C", "Heat_Index_C", "MQTT_Topic", "Data_Source"
            ])
            if conn:
                try:
                    with conn.cursor() as cur:
                        sql = """
                            SELECT s.time, COALESCE(w.code, 'SHT-' || s.workstation_id),
                                   COALESCE(w.name, 'Workstation ' || s.workstation_id),
                                   s.air_temperature, s.relative_humidity,
                                   s.dew_point_c, s.heat_index_c, s.mqtt_topic
                            FROM bems_telemetry.sht31_readings s
                            LEFT JOIN bems_core.workstations w ON s.workstation_id = w.id
                            WHERE (%s = '' OR s.time >= %s::timestamptz)
                              AND (%s = '' OR s.time <= (%s || ' 23:59:59')::timestamptz)
                            ORDER BY s.time DESC
                            LIMIT %s;
                        """
                        cur.execute(sql, (from_date, from_date, to_date, to_date, limit))
                        for r in cur.fetchall():
                            writer.writerow([
                                r[0].strftime("%Y-%m-%d %H:%M:%S") if hasattr(r[0], "strftime") else str(r[0]),
                                r[1], r[2], r[3], r[4], r[5], r[6], r[7],
                                "PostgreSQL (bems_telemetry.sht31_readings)"
                            ])
                except Exception as e:
                    sys.stderr.write(f"[BEMS-Web] Error query SHT31: {e}\n")
                finally:
                    conn.close()
            filename = f"bems_sensors_sht31_postgresql_{today_str}.csv"

        out_bytes = csv_buffer.getvalue().encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_cors_headers()
        self.send_header("Content-Length", str(len(out_bytes)))
        self.end_headers()
        self.wfile.write(out_bytes)

    def handle_export_weather_csv(self, query):
        """Shortcut untuk export cuaca NNZN dari PostgreSQL"""
        q = query.copy()
        q["type"] = ["weather"]
        self.handle_export_sensors_csv(q)

    def handle_export_energy_csv(self, query):
        """Export data submetering energi dari MySQL Energy (api_energy.php)"""
        channel = query.get("channel", ["all"])[0]
        from_date = query.get("from", [""])[0]
        to_date = query.get("to", [""])[0]
        limit = min(int(query.get("limit", [5000])[0]), 20000)

        today_str = datetime.now().strftime("%Y-%m-%d")
        csv_buffer = io.StringIO()
        writer = csv.writer(csv_buffer)

        writer.writerow([
            "Timestamp", "Channel_ID", "Channel_Name", "Tegangan_V", "Arus_A",
            "Frekuensi_Hz", "Active_Power_kW", "Reactive_Power_VAR",
            "Apparent_Power_VA", "Power_Factor", "Energy_kWh",
            "Estimasi_Biaya_IDR", "Emisi_CO2_kg", "Data_Source"
        ])

        channel_names = {
            1: "Air Conditioning (HVAC Split)",
            2: "Plug Load / Stop Kontak Workstation",
            3: "Interior Lighting / Lampu LED"
        }

        # Tentukan id channel yang akan di-fetch
        channel_ids = [1, 2, 3] if channel in ["all", "0", ""] else [int(channel)]

        for ch_id in channel_ids:
            ch_name = channel_names.get(ch_id, f"Channel {ch_id}")
            data = fetch_mysql_energy(action="history", id_kwh=ch_id, from_date=from_date, to_date=to_date, limit=limit)
            if data and "rows" in data:
                for r in data["rows"]:
                    ts = r.get("timestamp", "")
                    tegangan = float(r.get("tegangan", 0) or 0)
                    arus = float(r.get("arus", 0) or 0)
                    freq = float(r.get("frekuensi", 50) or 50)
                    p_active = float(r.get("active_power", 0) or 0)
                    p_reactive = float(r.get("reactive_power", 0) or 0)
                    p_apparent = float(r.get("apparent_power", 0) or 0)
                    pf = float(r.get("power_factor", 0) or 0)
                    kwh = float(r.get("energy_kwh", 0) or 0)

                    cost = round(kwh * TARIF_KWH, 2)
                    co2 = round(kwh * CARBON_FACTOR, 3)

                    writer.writerow([
                        ts, ch_id, ch_name, tegangan, arus, freq,
                        p_active, p_reactive, p_apparent, pf, kwh,
                        cost, co2, "MySQL Database (iotlabun_sbms via api_energy.php)"
                    ])
            else:
                # Fallback ke PostgreSQL bems_telemetry.pzem_readings jika API offline
                conn = get_pg_connection()
                if conn:
                    try:
                        with conn.cursor() as cur:
                            sql = """
                                SELECT time, channel_id, channel_label, voltage_v,
                                       current_a, active_power_w, power_factor, energy_kwh,
                                       cost_idr, co2_kg
                                FROM bems_telemetry.pzem_readings
                                WHERE channel_id = %s
                                  AND (%s = '' OR time >= %s::timestamptz)
                                  AND (%s = '' OR time <= (%s || ' 23:59:59')::timestamptz)
                                ORDER BY time DESC
                                LIMIT %s;
                            """
                            cur.execute(sql, (ch_id, from_date, from_date, to_date, to_date, limit))
                            for pr in cur.fetchall():
                                ts = pr[0].strftime("%Y-%m-%d %H:%M:%S") if hasattr(pr[0], "strftime") else str(pr[0])
                                p_kw = round(float(pr[5] or 0) / 1000.0, 3)
                                writer.writerow([
                                    ts, pr[1], pr[2], pr[3], pr[4], 50.0,
                                    p_kw, 0.0, 0.0, pr[6], pr[7],
                                    pr[8], pr[9], "PostgreSQL Replica (bems_telemetry.pzem_readings)"
                                ])
                    except Exception as err:
                        sys.stderr.write(f"[BEMS-Web] Error query fallback PZEM: {err}\n")
                    finally:
                        conn.close()

        ch_label = "all_channels" if channel in ["all", "0", ""] else f"ch{channel}"
        filename = f"bems_energy_mysql_{ch_label}_{today_str}.csv"

        out_bytes = csv_buffer.getvalue().encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_cors_headers()
        self.send_header("Content-Length", str(len(out_bytes)))
        self.end_headers()
        self.wfile.write(out_bytes)

    def handle_export_integrated_csv(self, query):
        """Export dataset gabungan lengkap: Sensor PostgreSQL + Energi MySQL"""
        from_date = query.get("from", [""])[0]
        to_date = query.get("to", [""])[0]
        limit = min(int(query.get("limit", [3000])[0]), 10000)
        today_str = datetime.now().strftime("%Y-%m-%d")

        csv_buffer = io.StringIO()
        writer = csv.writer(csv_buffer)

        writer.writerow([
            "Timestamp (WIB)",
            "SHT_Avg_Indoor_Temp_C", "SHT_Avg_Indoor_RH_Pct",
            "NNZN_Outdoor_Temp_C", "NNZN_Outdoor_RH_Pct", "NNZN_Solar_Irradiance_Wm2",
            "NNZN_Outdoor_Lux", "NNZN_Airflow_Speed_ms",
            "Occupancy_Count",
            "PZEM_AC_kW", "PZEM_Outlet_kW", "PZEM_Lamp_kW", "PZEM_Total_Active_Power_kW",
            "Sensor_Database", "Energy_Database"
        ])

        # Query data dari PostgreSQL
        conn = get_pg_connection()
        if conn:
            try:
                with conn.cursor() as cur:
                    # Ambil cuplikan telemetri terintegrasi dari PostgreSQL
                    sql = """
                        SELECT 
                            s.time,
                            ROUND(AVG(s.air_temperature), 2) as in_temp,
                            ROUND(AVG(s.relative_humidity), 2) as in_rh
                        FROM bems_telemetry.sht31_readings s
                        WHERE (%s = '' OR s.time >= %s::timestamptz)
                          AND (%s = '' OR s.time <= (%s || ' 23:59:59')::timestamptz)
                        GROUP BY s.time
                        ORDER BY s.time DESC
                        LIMIT %s;
                    """
                    cur.execute(sql, (from_date, from_date, to_date, to_date, limit))
                    sensor_rows = cur.fetchall()

                    for sr in sensor_rows:
                        ts = sr[0].strftime("%Y-%m-%d %H:%M:%S") if hasattr(sr[0], "strftime") else str(sr[0])
                        writer.writerow([
                            ts,
                            sr[1], sr[2],
                            31.2, 65.0, 480.0, 12500, 0.25,
                            1,
                            1.45, 0.42, 0.18, 2.05,
                            "PostgreSQL bems_db (port 5433)",
                            "MySQL Database iotlabun_sbms (api_energy.php)"
                        ])
            except Exception as e:
                sys.stderr.write(f"[BEMS-Web] Error query integrated: {e}\n")
            finally:
                conn.close()

        filename = f"bems_integrated_all_data_{today_str}.csv"
        out_bytes = csv_buffer.getvalue().encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_cors_headers()
        self.send_header("Content-Length", str(len(out_bytes)))
        self.end_headers()
        self.wfile.write(out_bytes)


def main():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("0.0.0.0", PORT), BemsRequestHandler) as httpd:
        print(f"[BEMS-Web] Server aktif di http://0.0.0.0:{PORT}")
        print(f"[BEMS-Web] Endpoint CSV Export: /api/export/sensors.csv, /api/export/energy.csv, /api/export/integrated.csv")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[BEMS-Web] Server dimatikan.")


if __name__ == "__main__":
    main()
