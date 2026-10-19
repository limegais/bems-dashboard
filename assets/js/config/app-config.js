/**
 * BEMS Dashboard — App Configuration
 * Broker: 128.199.206.166:1883 (TCP) / :9001 (WebSocket)
 * Topic layout sesuai sensing/README.md
 */
const APP_CONFIG = {
  USE_MOCK: true,
  API_BASE_URL: "http://localhost:8000/api/v1",
  REQUEST_TIMEOUT_MS: 10000,

  ENDPOINTS: {
    login: "/auth/login",
    pageData: (pageKey) => `/pages/${pageKey}`,
  },

  ROUTES: {
    login: "login.html",
    home: "index.html",
  },

  MQTT: {
    // Bridge WebSocket menghubungkan browser ke broker TCP 128.199.206.166:1883
    // Menggunakan port 9002 (port 9001 dicadangkan/dipakai docker)
    BROKER_URL: (function () {
      const isHttps = typeof window !== "undefined" && window.location && window.location.protocol === "https:";
      const host = (typeof window !== "undefined" && window.location && window.location.hostname) ? window.location.hostname : "localhost";
      let wsPort = "9002";
      if (typeof window !== "undefined" && window.location && window.location.search) {
        const params = new URLSearchParams(window.location.search);
        if (params.get("ws_url")) return params.get("ws_url");
        if (params.get("ws_port")) wsPort = params.get("ws_port");
      }
      if (isHttps) {
        // Jika website diakses via Cloudflare Tunnel (HTTPS), gunakan Secure WebSocket (WSS)
        return `wss://${host}/ws`;
      }
      return `ws://${host}:${wsPort}`;
    })(),
    OPTIONS: {
      clientId: "bems_dashboard_" + Math.random().toString(16).substr(2, 8),
      username: "user_1",
      password: "iotlabftuns2023",
      keepalive: 60,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    },

    // ── Topic yang di-subscribe ─────────────────────────────────────────────
    TOPICS: {
      all:            "#",                  // subscribe ke seluruh topic data & status
      sht_all:        "+/sensor/+/state",   // semua node SHT31 + NNZN state
      sht_status:     "+/status",           // LWT setiap node
      nnzn_sensors:   "nnzn-weather/sensor/+/state",
      nnzn_status:    "nnzn-weather/status",
    },

    // ── Peta alias topic MQTT → canonical node ──────────────────────────────
    // Mendukung pesan dari broker berformat angka (sht-1..6) maupun huruf lama (sht-g, c, a, d, h, e)
    SHT_ALIAS: {
      "sht-1": "sht-1",
      "sht-2": "sht-2",
      "sht-3": "sht-3",
      "sht-4": "sht-4",
      "sht-5": "sht-5",
      "sht-6": "sht-6",
      "sht-g": "sht-1",
      "sht-c": "sht-2",
      "sht-a": "sht-3",
      "sht-d": "sht-4",
      "sht-h": "sht-5",
      "sht-e": "sht-6",
    },

    // ── Peta node → metadata (Penamaan Baru: sht-1 s.d. sht-6) ───────────────
    // Mapping: sht-1 (G), sht-2 (C), sht-3 (A), sht-4 (D), sht-5 (H), sht-6 (E)
    SHT_NODES: {
      "sht-1": { label: "SHT-1", legacy: "G", zone: "Window (WB1)",  ip: "10.18.13.181" },
      "sht-2": { label: "SHT-2", legacy: "C", zone: "Middle (WB2)",  ip: "10.18.13.154" },
      "sht-3": { label: "SHT-3", legacy: "A", zone: "Inner (WB3)",   ip: "10.18.13.202" },
      "sht-4": { label: "SHT-4", legacy: "D", zone: "Right (WB4)",   ip: "10.18.13.204" },
      "sht-5": { label: "SHT-5", legacy: "H", zone: "South Wall",    ip: "10.18.13.208" },
      "sht-6": { label: "SHT-6", legacy: "E", zone: "South Hub",     ip: "10.18.13.209" },
    },

    // NNZN bridge – RS485 sensor topics
    // Pattern: nnzn-weather/sensor/<tag>_<key>/state
    NNZN_SENSORS: {
      "th_out_temperature": { label: "Outdoor Temperature", unit: "°C",    domId: "nnzn-th-temp"      },
      "th_out_humidity":    { label: "Outdoor Humidity",    unit: "%RH",   domId: "nnzn-th-hum"       },
      "g_out_irradiance":   { label: "Solar Irradiance",    unit: "W/m²",  domId: "nnzn-irradiance"   },
      "lx_out_lux":         { label: "Outdoor Illuminance", unit: "lx",    domId: "nnzn-lx-out"       },
      "lx1_lux":            { label: "Lux WB1",            unit: "lx",    domId: "nnzn-lx1"          },
      "lx2_lux":            { label: "Lux WB2",            unit: "lx",    domId: "nnzn-lx2"          },
      "lx3_lux":            { label: "Lux WB3",            unit: "lx",    domId: "nnzn-lx3"          },
      "lx4_lux":            { label: "Lux WB4",            unit: "lx",    domId: "nnzn-lx4"          },
      "co2_co2":            { label: "CO₂ Concentration",  unit: "ppm",   domId: "nnzn-co2"          },
      "airflow_speed":      { label: "Air Velocity",        unit: "m/s",   domId: "nnzn-airflow"      },
    },
  },

  // ── Threshold limits for alarms ──────────────────────────────────────────
  THRESHOLDS: {
    co2_warn:   800,    // ppm – warning (yellow)
    co2_bad:    1000,   // ppm – critical (red)
    temp_warn:  27,     // °C  – warning
    temp_bad:   30,     // °C  – critical
    rh_warn:    70,     // %RH – warning
    rh_bad:     80,     // %RH – critical
  },

  // ── MySQL Energy Monitoring (iotlabun_sbms) ──────────────────────────────
  ENERGY: {
    API_URL: "https://iotlab-uns.com/api_energy.php",
    API_KEY: "iotlab_smartroom_2024",
    POLL_INTERVAL: 4000, // 4 sec
    TARIF_KWH: 1500,     // IDR/kWh
    CARBON_FACTOR: 0.85, // kg CO2 per kWh
    CHANNELS: {
      1: { id: "ac",     label: "Air Conditioning (HVAC)", color: "#1e40af", maxKw: 3.0 },
      2: { id: "outlet", label: "Plug Load / Receptacle",  color: "#059669", maxKw: 1.0 },
      3: { id: "lamp",   label: "Interior Lighting",       color: "#d97706", maxKw: 0.5 },
    }
  },

  // ── Smart Room (Raspberry Pi Tailscale Edge) ──────────────────────────────
  SMARTROOM: {
    SERVER_URL: "http://100.116.178.92:5000",
    VIDEO_FEED: "http://100.116.178.92:5000/video_feed",
    CAMERA_STATUS: "http://100.116.178.92:5000/api/camera/status",
  },
};

