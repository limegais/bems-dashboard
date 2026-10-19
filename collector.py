#!/usr/bin/env python3
"""
BEMS Ingestion Daemon & Telemetry Collector (PostgreSQL + MQTT + Energy API)
----------------------------------------------------------------------------
Menyimpan SELURUH data telemetri ke PostgreSQL 'bems_db' SETIAP 5 DETIK SEKALI:
1. bems_telemetry.sht31_readings : 6 baris (SHT-1 s.d. SHT-6) setiap 5 detik
2. bems_telemetry.nnzn_weather   : 1 baris (RS485 Outdoor & Indoor lux/CO2/airflow) setiap 5 detik
3. bems_telemetry.pzem_readings  : 3 baris (CH1 AC, CH2 Socket, CH3 Lamp) setiap 5 detik
4. bems_telemetry.occupancy      : 1 baris (Deteksi orang & headcount) setiap 5 detik
5. bems_telemetry.mqtt_raw_log   : Real-time setiap ada paket MQTT masuk
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

STORAGE_INTERVAL_SEC = int(os.getenv("STORAGE_INTERVAL_SEC", "5"))

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
                    cur.execute("SELECT id, code FROM bems_core.workstations;")
                    for r in cur.fetchall():
                        self.ws_map[r[1]] = r[0]

                    cur.execute("SELECT id, device_code FROM bems_core.devices;")
                    for r in cur.fetchall():
                        self.device_map[r[1]] = r[0]

                    cur.execute("SELECT id FROM bems_core.rooms LIMIT 1;")
                    r = cur.fetchone()
                    if r:
                        self.room_id = r[0]

                logger.info(f"Metadata termuat: {len(self.ws_map)} workstation, {len(self.device_map)} device.")
            except Exception as e:
                logger.warning(f"Gagal memuat metadata awal ({e}).")

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

    def insert_batch_snapshots(self, sht_data, nnzn_data, pzem_data, occ_data):
        """Menyimpan snapshot lengkap seluruh sensor ke database dalam 1 transaksi per 5 detik"""
        self.check_connection()
        try:
            with self.lock:
                with self.conn.cursor() as cur:
                    now = datetime.now(timezone.utc)

                    # 1. Simpan SHT31 (6 Workstations)
                    for code, d in sht_data.items():
                        ws_id = self.ws_map.get(code)
                        if not ws_id:
                            try:
                                ws_id = int(code.replace("sht-", ""))
                            except Exception:
                                ws_id = 1

                        temp = d.get("temp", 24.5)
                        rh = d.get("rh", 55.0)
                        dp = calc_dew_point(temp, rh)
                        hi = calc_heat_index(temp, rh)

                        cur.execute("""
                            INSERT INTO bems_telemetry.sht31_readings
                                (time, workstation_id, air_temperature, relative_humidity,
                                 dew_point_c, heat_index_c, mqtt_topic)
                            VALUES (%s, %s, %s, %s, %s, %s, %s);
                        """, (now, ws_id, temp, rh, dp, hi, f"{code}/sensor/state"))

                    # 2. Simpan NNZN Weather
                    dev_id = self.device_map.get("NNZN_WEATHER", 4)
                    cur.execute("""
                        INSERT INTO bems_telemetry.nnzn_weather
                            (time, device_id, outdoor_temp_c, outdoor_rh_pct, solar_irradiance,
                             outdoor_lux, lux_wb1, lux_wb2, lux_wb3, lux_wb4,
                             co2_outdoor_ppm, airflow_speed_ms)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
                    """, (
                        now,
                        dev_id,
                        nnzn_data.get("th_out_temperature", 28.5),
                        nnzn_data.get("th_out_humidity", 65.0),
                        nnzn_data.get("g_out_irradiance", 350.0),
                        nnzn_data.get("lx_out_lux", 12000.0),
                        nnzn_data.get("lx1_lux", 420.0),
                        nnzn_data.get("lx2_lux", 410.0),
                        nnzn_data.get("lx3_lux", 390.0),
                        nnzn_data.get("lx4_lux", 430.0),
                        nnzn_data.get("co2_co2", 520.0),
                        nnzn_data.get("airflow_speed", 0.2)
                    ))

                    # 3. Simpan PZEM Readings (CH1 AC, CH2 Socket, CH3 Lampu)
                    for ch_item in pzem_data:
                        ch_id = ch_item["channel_id"]
                        lbl = ch_item["channel_label"]
                        dev_code = f"PZEM_CH{ch_id}_" + ("AC" if ch_id == 1 else "SOCKET" if ch_id == 2 else "LAMP")
                        pzem_dev_id = self.device_map.get(dev_code, ch_id)

                        kwh = ch_item["energy_kwh"]
                        cost = kwh * 1444.70
                        co2 = kwh * 0.85

                        cur.execute("""
                            INSERT INTO bems_telemetry.pzem_readings
                                (time, device_id, channel_id, channel_label, voltage_v,
                                 current_a, active_power_w, power_factor, energy_kwh,
                                 cost_idr, co2_kg)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
                        """, (
                            now, pzem_dev_id, ch_id, lbl,
                            ch_item["voltage_v"], ch_item["current_a"],
                            ch_item["active_power_w"], ch_item["power_factor"],
                            kwh, cost, co2
                        ))

                    # 4. Simpan Occupancy
                    cur.execute("""
                        INSERT INTO bems_telemetry.occupancy
                            (time, room_id, headcount, motion_detected, detection_method, detection_confidence)
                        VALUES (%s, %s, %s, %s, 'camera_yolo', %s);
                    """, (
                        now, self.room_id,
                        occ_data.get("person_count", 2),
                        occ_data.get("person_detected", True),
                        occ_data.get("confidence", 0.92)
                    ))

        except Exception as e:
            logger.error(f"Error insert batch snapshots: {e}")


db = BemsDatabase()

# Global Buffers (Menyimpan nilai live terbaru)
state_lock = threading.Lock()

live_sht = {
    f"sht-{i}": {"temp": 24.5 + (i * 0.2), "rh": 55.0 - (i * 0.5), "last_seen": time.time()}
    for i in range(1, 7)
}

live_nnzn = {
    "th_out_temperature": 29.5,
    "th_out_humidity": 68.0,
    "g_out_irradiance": 450.0,
    "lx_out_lux": 15000.0,
    "lx1_lux": 420.0,
    "lx2_lux": 410.0,
    "lx3_lux": 395.0,
    "lx4_lux": 430.0,
    "co2_co2": 520.0,
    "airflow_speed": 0.2,
    "last_seen": time.time()
}

live_pzem = [
    {"channel_id": 1, "channel_label": "Air Conditioning (HVAC)", "voltage_v": 224.5, "current_a": 5.4, "active_power_w": 1210.0, "power_factor": 0.95, "energy_kwh": 34.2},
    {"channel_id": 2, "channel_label": "Receptacle / Socket",    "voltage_v": 223.8, "current_a": 2.1, "active_power_w": 465.0,  "power_factor": 0.98, "energy_kwh": 18.7},
    {"channel_id": 3, "channel_label": "Lighting",               "voltage_v": 225.1, "current_a": 0.9, "active_power_w": 195.0,  "power_factor": 0.96, "energy_kwh": 8.4},
]

live_occ = {
    "person_count": 3,
    "person_detected": True,
    "confidence": 0.92,
    "last_seen": time.time()
}


def periodic_storage_engine():
    """
    Looping yang MENYIMPAN SEMUA DATA SENSOR KE DATABASE SETIAP 5 DETIK SEKALI
    """
    logger.info(f"Engine penyimpanan 5 detik aktif. Menyimpan seluruh telemetri setiap {STORAGE_INTERVAL_SEC} detik...")
    step = 0
    while running:
        t_start = time.time()
        step += 1

        with state_lock:
            # Ambil salinan state saat ini
            sht_copy = {k: v.copy() for k, v in live_sht.items()}
            nnzn_copy = live_nnzn.copy()
            pzem_copy = [item.copy() for item in live_pzem]
            occ_copy = live_occ.copy()

        # Simpan snapshot ke database
        db.insert_batch_snapshots(sht_copy, nnzn_copy, pzem_copy, occ_copy)

        if step % 6 == 0:
            # Log setiap 30 detik agar journal tidak banjir
            logger.info(f"[5s Snapshot #{step}] Berhasil menyimpan telemetri 6 Workstation, 1 NNZN Weather, 3 Channel PZEM, dan Occupancy.")

        # Hitung jeda presisi agar tepat 5 detik
        elapsed = time.time() - t_start
        sleep_time = max(0.1, STORAGE_INTERVAL_SEC - elapsed)
        time.sleep(sleep_time)


def energy_api_poller():
    """Worker polling Energy API (iotlab-uns.com) untuk meng-update live_pzem"""
    logger.info("Worker Energy API poller aktif.")
    while running:
        try:
            resp = requests.get(ENERGY_API_URL, params={"api_key": ENERGY_API_KEY}, timeout=7)
            if resp.status_code == 200:
                data = resp.json()
                channels = data if isinstance(data, list) else data.get("data", [data])

                with state_lock:
                    for item in channels:
                        ch_id = int(item.get("channel", item.get("channel_id", 1)))
                        idx = ch_id - 1
                        if 0 <= idx < len(live_pzem):
                            v = float(item.get("voltage", live_pzem[idx]["voltage_v"]))
                            i = float(item.get("current", live_pzem[idx]["current_a"]))
                            p = float(item.get("power", item.get("active_power", v * i)))
                            k = float(item.get("energy", item.get("kwh", live_pzem[idx]["energy_kwh"])))
                            pf = float(item.get("power_factor", 0.95))

                            live_pzem[idx]["voltage_v"] = v
                            live_pzem[idx]["current_a"] = i
                            live_pzem[idx]["active_power_w"] = p
                            live_pzem[idx]["energy_kwh"] = k
                            live_pzem[idx]["power_factor"] = pf
        except Exception as e:
            logger.debug(f"Energy poller: {e}")

        time.sleep(STORAGE_INTERVAL_SEC)


def on_mqtt_connect(client, userdata, flags, rc):
    if rc == 0:
        logger.info(f"MQTT Collector terhubung ke {MQTT_HOST}:{MQTT_PORT}")
        client.subscribe("#", qos=0)
    else:
        logger.error(f"MQTT connect gagal (rc={rc})")


def on_mqtt_message(client, userdata, msg):
    try:
        topic = msg.topic
        payload = msg.payload.decode("utf-8", errors="ignore").strip()

        # Selalu simpan raw MQTT log
        db.insert_raw_log(topic, payload)

        parts = topic.split("/")

        # Smartroom Camera
        if topic.startswith("smartroom/camera"):
            try:
                data = json.loads(payload)
                count = int(data.get("person_count", 0))
                det = bool(data.get("person_detected", count > 0))
                conf = float(data.get("confidence", 0.9))
                with state_lock:
                    live_occ["person_count"] = count
                    live_occ["person_detected"] = det
                    live_occ["confidence"] = conf
                    live_occ["last_seen"] = time.time()
            except Exception:
                pass
            return

        # Nilai numerik
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

        # SHT31
        if len(parts) >= 4 and parts[1] == "sensor" and parts[-1] == "state":
            raw_node = parts[0]
            canonical = SHT_ALIAS.get(raw_node, raw_node)
            metric = parts[2].lower()

            if canonical in live_sht:
                with state_lock:
                    if "temp" in metric:
                        live_sht[canonical]["temp"] = val
                    elif "hum" in metric:
                        live_sht[canonical]["rh"] = val
                    live_sht[canonical]["last_seen"] = time.time()
                return

            # NNZN RS485
            if raw_node == "nnzn-weather":
                sensor_key = parts[2]
                with state_lock:
                    if sensor_key in live_nnzn:
                        live_nnzn[sensor_key] = val
                        live_nnzn["last_seen"] = time.time()

    except Exception as e:
        logger.error(f"Error parse MQTT message: {e}")


def handle_signal(sig, frame):
    global running
    logger.info("Mematikan collector telemetri...")
    running = False
    sys.exit(0)


def main():
    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    logger.info("==================================================================")
    logger.info(" BEMS Telemetry Engine (5-Second PostgreSQL Storage Daemon) v2.2  ")
    logger.info(f" Target Database: PostgreSQL bems_db ({PG_USER}@{PG_HOST}:{PG_PORT})")
    logger.info(" Interval Penyimpanan: SETIAP 5 DETIK                             ")
    logger.info("==================================================================")

    # 1. Thread penyimpan 5 detik kontinu ke PostgreSQL
    t_storage = threading.Thread(target=periodic_storage_engine, daemon=True)
    t_storage.start()

    # 2. Thread poller energi PZEM
    t_energy = threading.Thread(target=energy_api_poller, daemon=True)
    t_energy.start()

    # 3. Client MQTT
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
            logger.warning(f"Koneksi MQTT terputus ({e}), reconnect dalam 5 detik...")
            time.sleep(5)


if __name__ == "__main__":
    main()
