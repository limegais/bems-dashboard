#!/usr/bin/env python3
"""
BEMS Ingestion Daemon & Telemetry Collector (PostgreSQL + MQTT + Energy API)
----------------------------------------------------------------------------
Menyimpan SELURUH data secara real-time ke schema database 'bems_db':
- bems_telemetry.mqtt_raw_log    : Audit trail mentah setiap payload MQTT
- bems_telemetry.sht31_readings  : SHT31 workstation 1..6 (Temp, RH, Dew Point, Heat Index)
- bems_telemetry.nnzn_weather    : RS485 Outdoor weather & indoor lux/co2/airflow
- bems_telemetry.pzem_readings   : Sub-metering listrik AC, Socket, Lampu (API / MQTT)
- bems_telemetry.occupancy       : Deteksi orang & headcount kamera
"""

import os
import sys
import time
import json
import math
import logging
import threading
import signal
from datetime import datetime, timezone

import requests
import paho.mqtt.client as mqtt
import psycopg2

# Setup Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("bems-collector")

# Environment & Config
PG_HOST = os.getenv("PG_HOST", "localhost")
PG_PORT = int(os.getenv("PG_PORT", "5432"))
PG_DATABASE = os.getenv("PG_DATABASE", "bems_db")
PG_USER = os.getenv("PG_USER", "bems_user")
PG_PASSWORD = os.getenv("PG_PASSWORD", "bems_password_secure")

MQTT_HOST = os.getenv("MQTT_HOST", "128.199.206.166")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_USER = os.getenv("MQTT_USER", "user_1")
MQTT_PASS = os.getenv("MQTT_PASS", "iotlabftuns2023")
MQTT_CLIENT_ID = os.getenv("MQTT_CLIENT_ID", f"bems_collector_{os.getpid()}")

ENERGY_API_URL = os.getenv("ENERGY_API_URL", "https://iotlab-uns.com/api_energy.php")
ENERGY_API_KEY = os.getenv("ENERGY_API_KEY", "iotlab_smartroom_2024")
ENERGY_POLL_INTERVAL = int(os.getenv("ENERGY_POLL_INTERVAL", "5"))

SHT_ALIAS = {
    "sht-1": "sht-1", "sht-2": "sht-2", "sht-3": "sht-3",
    "sht-4": "sht-4", "sht-5": "sht-5", "sht-6": "sht-6",
    "sht-g": "sht-1", "sht-c": "sht-2", "sht-a": "sht-3",
    "sht-d": "sht-4", "sht-h": "sht-5", "sht-e": "sht-6",
}

running = True

def calc_dew_point(t, rh):
    if t is None or rh is None or rh <= 0:
        return None
    a = 17.27
    b = 237.7
    alpha = ((a * t) / (b + t)) + math.log(rh / 100.0)
    return round((b * alpha) / (a - alpha), 2)

def calc_heat_index(t, rh):
    if t is None or rh is None:
        return None
    # Rothfusz regression
    tf = (t * 9.0 / 5.0) + 32.0
    if tf < 80.0:
        hi_f = 0.5 * (tf + 61.0 + ((tf - 68.0) * 1.2) + (rh * 0.094))
    else:
        hi_f = (-42.379 + 2.04901523 * tf + 10.14333127 * rh -
                0.22475541 * tf * rh - 0.00683783 * tf * tf -
                0.05481717 * rh * rh + 0.00122874 * tf * tf * rh +
                0.00085282 * tf * rh * rh - 0.00000199 * tf * tf * rh * rh)
    hi_c = (hi_f - 32.0) * 5.0 / 9.0
    return round(hi_c, 2)


class BemsDatabase:
    def __init__(self):
        self.conn = None
        self.lock = threading.Lock()
        self.ws_map = {}     # code -> id
        self.device_map = {} # code -> id
        self.room_id = 1
        self.connect()
        self.load_metadata()

    def connect(self):
        while running:
            try:
                self.conn = psycopg2.connect(
                    host=PG_HOST,
                    port=PG_PORT,
                    database=PG_DATABASE,
                    user=PG_USER,
                    password=PG_PASSWORD,
                    connect_timeout=10
                )
                self.conn.autocommit = True
                logger.info(f"Database bems_db terhubung via {PG_USER}@{PG_HOST}:{PG_PORT}")
                return
            except Exception as e:
                logger.warning(f"Koneksi DB gagal ({e}). Retry dalam 5 detik...")
                time.sleep(5)

    def load_metadata(self):
        with self.lock:
            try:
                with self.conn.cursor() as cur:
                    # Workstations
                    cur.execute("SELECT id, code FROM bems_core.workstations;")
                    for r in cur.fetchall():
                        self.ws_map[r[1]] = r[0]

                    # Devices
                    cur.execute("SELECT id, device_code FROM bems_core.devices;")
                    for r in cur.fetchall():
                        self.device_map[r[1]] = r[0]

                    # Default Room
                    cur.execute("SELECT id FROM bems_core.rooms LIMIT 1;")
                    r = cur.fetchone()
                    if r:
                        self.room_id = r[0]

                logger.info(f"Metadata termuat: {len(self.ws_map)} workstation, {len(self.device_map)} device.")
            except Exception as e:
                logger.warning(f"Gagal memuat metadata awal ({e}). Menggunakan default.")

    def check_connection(self):
        with self.lock:
            try:
                if self.conn is None or self.conn.closed != 0:
                    self.connect()
                    self.load_metadata()
            except Exception:
                self.connect()

    def insert_raw_log(self, topic, payload):
        self.check_connection()
        query = """
            INSERT INTO bems_telemetry.mqtt_raw_log
                (received_at, mqtt_topic, payload_raw, broker_host, processed)
            VALUES (NOW(), %s, %s, %s, TRUE);
        """
        try:
            with self.lock:
                with self.conn.cursor() as cur:
                    cur.execute(query, (topic, payload, MQTT_HOST))
        except Exception as e:
            logger.error(f"Error raw_log: {e}")

    def insert_sht31(self, ws_code, temp, rh, topic):
        self.check_connection()
        ws_id = self.ws_map.get(ws_code)
        if not ws_id:
            # Fallback jika id belum di map
            try:
                ws_id = int(ws_code.replace("sht-", ""))
            except Exception:
                ws_id = 1

        dp = calc_dew_point(temp, rh)
        hi = calc_heat_index(temp, rh)
        query = """
            INSERT INTO bems_telemetry.sht31_readings
                (time, workstation_id, air_temperature, relative_humidity,
                 dew_point_c, heat_index_c, mqtt_topic)
            VALUES (NOW(), %s, %s, %s, %s, %s, %s);
        """
        try:
            with self.lock:
                with self.conn.cursor() as cur:
                    cur.execute(query, (ws_id, temp, rh, dp, hi, topic))
        except Exception as e:
            logger.error(f"Error insert SHT31 ({ws_code}): {e}")

    def insert_nnzn_weather(self, data_dict):
        self.check_connection()
        dev_id = self.device_map.get("NNZN_WEATHER", 4)
        query = """
            INSERT INTO bems_telemetry.nnzn_weather
                (time, device_id, outdoor_temp_c, outdoor_rh_pct, solar_irradiance,
                 outdoor_lux, lux_wb1, lux_wb2, lux_wb3, lux_wb4,
                 co2_outdoor_ppm, airflow_speed_ms)
            VALUES (NOW(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
        """
        try:
            with self.lock:
                with self.conn.cursor() as cur:
                    cur.execute(query, (
                        dev_id,
                        data_dict.get("th_out_temperature", 28.0),
                        data_dict.get("th_out_humidity", 65.0),
                        data_dict.get("g_out_irradiance", 0.0),
                        data_dict.get("lx_out_lux", 0.0),
                        data_dict.get("lx1_lux", 400.0),
                        data_dict.get("lx2_lux", 400.0),
                        data_dict.get("lx3_lux", 400.0),
                        data_dict.get("lx4_lux", 400.0),
                        data_dict.get("co2_co2", 550.0),
                        data_dict.get("airflow_speed", 0.1)
                    ))
        except Exception as e:
            logger.error(f"Error insert NNZN weather: {e}")

    def insert_pzem(self, ch_id, ch_label, volt, curr, power, kwh, pf=1.0):
        self.check_connection()
        dev_code = f"PZEM_CH{ch_id}_" + ("AC" if ch_id == 1 else "SOCKET" if ch_id == 2 else "LAMP")
        dev_id = self.device_map.get(dev_code, ch_id)

        cost = kwh * 1444.70
        co2 = kwh * 0.85

        query = """
            INSERT INTO bems_telemetry.pzem_readings
                (time, device_id, channel_id, channel_label, voltage_v,
                 current_a, active_power_w, power_factor, energy_kwh,
                 cost_idr, co2_kg)
            VALUES (NOW(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
        """
        try:
            with self.lock:
                with self.conn.cursor() as cur:
                    cur.execute(query, (dev_id, ch_id, ch_label, volt, curr, power, pf, kwh, cost, co2))
        except Exception as e:
            logger.error(f"Error insert PZEM channel {ch_id}: {e}")

    def insert_occupancy(self, count, detected, confidence=0.9):
        self.check_connection()
        query = """
            INSERT INTO bems_telemetry.occupancy
                (time, room_id, headcount, motion_detected, detection_method, detection_confidence)
            VALUES (NOW(), %s, %s, %s, 'camera_yolo', %s);
        """
        try:
            with self.lock:
                with self.conn.cursor() as cur:
                    cur.execute(query, (self.room_id, count, detected, confidence))
        except Exception as e:
            logger.error(f"Error insert occupancy: {e}")


# Global Buffers untuk aggregation
db = BemsDatabase()

sht_buffer = {
    f"sht-{i}": {"temp": 24.5, "rh": 55.0, "updated": False}
    for i in range(1, 7)
}
nnzn_buffer = {
    "th_out_temperature": 29.5,
    "th_out_humidity": 68.0,
    "g_out_irradiance": 450.0,
    "lx_out_lux": 15000.0,
    "lx1_lux": 420.0,
    "lx2_lux": 410.0,
    "lx3_lux": 395.0,
    "lx4_lux": 430.0,
    "co2_co2": 520.0,
    "airflow_speed": 0.2
}
nnzn_has_updates = False
buffer_lock = threading.Lock()

def on_mqtt_connect(client, userdata, flags, rc):
    if rc == 0:
        logger.info(f"MQTT Collector connected to {MQTT_HOST}:{MQTT_PORT}")
        client.subscribe("#", qos=0)
    else:
        logger.error(f"MQTT connect failed (rc={rc})")

def on_mqtt_message(client, userdata, msg):
    global nnzn_has_updates
    try:
        topic = msg.topic
        payload = msg.payload.decode("utf-8", errors="ignore").strip()

        # 1. Simpan raw log
        db.insert_raw_log(topic, payload)

        parts = topic.split("/")

        # 2. Camera Occupancy
        if topic.startswith("smartroom/camera"):
            try:
                data = json.loads(payload)
                count = int(data.get("person_count", 0))
                det = bool(data.get("person_detected", count > 0))
                conf = float(data.get("confidence", 0.9))
                db.insert_occupancy(count, det, conf)
            except Exception:
                pass
            return

        # 3. Numeric extraction
        val = None
        try:
            val = float(payload)
        except ValueError:
            try:
                obj = json.loads(payload)
                for k in ("value", "val", "state"):
                    if k in obj:
                        val = float(obj[k])
                        break
            except Exception:
                pass

        if val is None:
            return

        # 4. SHT31 telemetry (sht-{1..6}/sensor/{temperature|humidity}/state)
        if len(parts) >= 4 and parts[1] == "sensor" and parts[-1] == "state":
            raw_node = parts[0]
            canonical = SHT_ALIAS.get(raw_node, raw_node)
            metric = parts[2].lower()

            if canonical in sht_buffer:
                with buffer_lock:
                    if "temp" in metric:
                        sht_buffer[canonical]["temp"] = val
                        sht_buffer[canonical]["updated"] = True
                    elif "hum" in metric:
                        sht_buffer[canonical]["rh"] = val
                        sht_buffer[canonical]["updated"] = True

                    # Jika update, commit row
                    if sht_buffer[canonical]["updated"]:
                        t = sht_buffer[canonical]["temp"]
                        h = sht_buffer[canonical]["rh"]
                        db.insert_sht31(canonical, t, h, topic)
                        sht_buffer[canonical]["updated"] = False
                return

            # 5. NNZN RS485 telemetry (nnzn-weather/sensor/{key}/state)
            if raw_node == "nnzn-weather":
                sensor_key = parts[2]
                with buffer_lock:
                    if sensor_key in nnzn_buffer:
                        nnzn_buffer[sensor_key] = val
                        nnzn_has_updates = True

    except Exception as e:
        logger.error(f"Error parse MQTT message: {e}")

def nnzn_periodic_flusher():
    """Flush data NNZN weather setiap 30 detik ke DB"""
    global nnzn_has_updates
    while running:
        time.sleep(30)
        with buffer_lock:
            if nnzn_has_updates:
                db.insert_nnzn_weather(nnzn_buffer)
                nnzn_has_updates = False

def energy_poller():
    """Poll API Energy dan simpan PZEM readings ke DB"""
    logger.info(f"PZEM Energy poller berjalan setiap {ENERGY_POLL_INTERVAL} detik.")
    while running:
        try:
            resp = requests.get(ENERGY_API_URL, params={"api_key": ENERGY_API_KEY}, timeout=8)
            if resp.status_code == 200:
                data = resp.json()
                channels = []
                if isinstance(data, list):
                    channels = data
                elif isinstance(data, dict):
                    channels = data.get("data", [data])

                for item in channels:
                    ch_id = int(item.get("channel", item.get("channel_id", 1)))
                    lbl = "Air Conditioning (HVAC)" if ch_id == 1 else "Receptacle / Socket" if ch_id == 2 else "Lighting"
                    v = float(item.get("voltage", 220.0))
                    i = float(item.get("current", 0.0))
                    p = float(item.get("power", item.get("active_power", v * i)))
                    kwh = float(item.get("energy", item.get("kwh", 0.0)))
                    pf = float(item.get("power_factor", 0.95))

                    db.insert_pzem(ch_id, lbl, v, i, p, kwh, pf)
        except Exception as e:
            logger.debug(f"Energy poller: {e}")

        time.sleep(ENERGY_POLL_INTERVAL)

def handle_signal(sig, frame):
    global running
    logger.info("Shutdown collector...")
    running = False
    sys.exit(0)

def main():
    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    logger.info("======================================================")
    logger.info(" BEMS Telemetry & DB Collector Daemon v2.0            ")
    logger.info(" PostgreSQL -> bems_db                               ")
    logger.info("======================================================")

    # Threads
    t_flush = threading.Thread(target=nnzn_periodic_flusher, daemon=True)
    t_flush.start()

    t_energy = threading.Thread(target=energy_poller, daemon=True)
    t_energy.start()

    # MQTT
    mqtt_client = mqtt.Client(client_id=MQTT_CLIENT_ID)
    mqtt_client.username_pw_set(MQTT_USER, MQTT_PASS)
    mqtt_client.on_connect = on_mqtt_connect
    mqtt_client.on_message = on_mqtt_message

    while running:
        try:
            logger.info(f"Menghubungkan ke MQTT broker {MQTT_HOST}:{MQTT_PORT}...")
            mqtt_client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
            mqtt_client.loop_forever()
        except Exception as e:
            logger.warning(f"MQTT loop terputus ({e}), retry dalam 5 detik...")
            time.sleep(5)

if __name__ == "__main__":
    main()
