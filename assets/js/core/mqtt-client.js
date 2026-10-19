/**
 * BEMS Dashboard — MQTT Client & Real-Time Telemetry Engine
 * Broker   : ws://localhost:9001 (Bridge ke 128.199.206.166:1883)
 * Topics   : sht-{a|c|d|e|g|h}/sensor/{temperature|humidity}/state
 *            nnzn-weather/sensor/{tag}_{key}/state
 * Semua nilai disimpan di window.liveData dan seluruh widget DOM di-update otomatis real-time tanpa refresh.
 */

// ─── Live data store ─────────────────────────────────────────────────────────
window.liveData = {
  sht: {},
  nnzn: {},
  status: {
    broker: "connecting",
    nnzn: "unknown",
    nodes: {},
  },
  aggregates: {
    avgTemp: null,
    avgHum: null,
    avgLux: null,
    minTemp: null,
    maxTemp: null,
    dewPoint: null,
    deltaTemp: null,
    comfortStatus: "Awaiting Data",
    iaqStatus: "Awaiting Data",
    activeNodes: 0,
    estimatedPowerKw: 18.4,
  },
  camera: {
    person_detected: false,
    person_count: 0,
    confidence: 0,
    status: "idle",
    met: 1.2,
    activity: "Seated / Light Activity",
    lastSeen: null
  }
};

// Inisialisasi node status
Object.keys(APP_CONFIG.MQTT.SHT_NODES).forEach(node => {
  const nodeObj = { temperature: null, humidity: null, lastSeen: null };
  window.liveData.sht[node] = nodeObj;
  window.liveData.status.nodes[node] = "unknown";
  const leg = APP_CONFIG.MQTT.SHT_NODES[node]?.legacy ? `sht-${APP_CONFIG.MQTT.SHT_NODES[node].legacy.toLowerCase()}` : null;
  if (leg) {
    window.liveData.sht[leg] = nodeObj;
    window.liveData.status.nodes[leg] = "unknown";
  }
});
Object.keys(APP_CONFIG.MQTT.NNZN_SENSORS).forEach(key => {
  window.liveData.nnzn[key] = { value: null, lastSeen: null };
});

// Telemetry history untuk chart kontinu
window.liveTelemetryHistory = {
  labels: [],
  indoorTemp: [],
  outdoorTemp: [],
  solar: []
};

// ─── Helpers DOM & Animasi ───────────────────────────────────────────────────
function setText(id, text) {
  const el = document.getElementById(id);
  if (!el || text === undefined || text === null) return;
  const str = String(text);
  if (el.textContent !== str) {
    el.textContent = str;
    el.classList.remove("data-flash");
    void el.offsetWidth; // trigger reflow for smooth micro-flash
    el.classList.add("data-flash");
  }
}

function setWidth(id, pct) {
  const el = document.getElementById(id);
  if (!el) return;
  const clamped = Math.max(0, Math.min(100, pct));
  el.style.width = clamped + "%";
}

function setClass(id, cls) {
  const el = document.getElementById(id);
  if (el) {
    el.className = el.className.replace(/\blive-(ok|warn|bad|off|unknown)\b/g, "");
    el.classList.add(cls);
  }
}

function setBadge(id, text, type) {
  const el = document.getElementById(id);
  if (!el || !text) return;
  el.textContent = text;
  el.className = "px-2 py-0.5 text-[11px] font-semibold rounded-full transition-colors " +
    (type === "ok" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
     type === "warn" ? "bg-amber-50 text-amber-700 border border-amber-200" :
     type === "bad" ? "bg-rose-50 text-rose-700 border border-rose-200" :
     "bg-slate-100 text-slate-600 border border-slate-200");
}

/** Formatta timestamp sebagai "HH:MM:SS WIB" */
function nowWib() {
  return new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour12: false });
}

/** Hitung rata-rata semua node SHT */
function shtAvg(key) {
  const vals = Object.values(window.liveData.sht)
    .map(n => n[key])
    .filter(v => v !== null && !isNaN(v));
  if (!vals.length) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/** Min & Max SHT temperature */
function shtMinMaxTemp() {
  const vals = Object.values(window.liveData.sht)
    .map(n => n.temperature)
    .filter(v => v !== null && !isNaN(v));
  if (!vals.length) return { min: null, max: null };
  return {
    min: Math.min(...vals),
    max: Math.max(...vals)
  };
}

/** Rata-rata illuminansi indoor dari lx1-lx4 */
function indoorLuxAvg() {
  const keys = ["lx1_lux", "lx2_lux", "lx3_lux", "lx4_lux"];
  const vals = keys.map(k => window.liveData.nnzn[k]?.value).filter(v => v !== null && !isNaN(v));
  if (!vals.length) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/** Perhitungan Dew Point (Titik Embun) menggunakan formula Magnus */
function calcDewPoint(temp, rh) {
  if (temp === null || rh === null) return null;
  const a = 17.27;
  const b = 237.7;
  const alpha = ((a * temp) / (b + temp)) + Math.log(rh / 100.0);
  return (b * alpha) / (a - alpha);
}

/** ASHRAE 55 Thermal Comfort Evaluation */
function evalComfort(temp, rh) {
  if (temp === null) return { text: "Awaiting Data", type: "neutral" };
  if (temp < 23.0) return { text: "Cool (<23°C)", type: "neutral" };
  if (temp <= 26.5 && (rh === null || (rh >= 35 && rh <= 65))) return { text: "Optimal (ASHRAE 55)", type: "ok" };
  if (temp <= 28.5) return { text: "Comfortably Warm (27–28.5°C)", type: "ok" };
  if (temp <= 30.5) return { text: "Warm / Supplementary Cooling", type: "warn" };
  return { text: "Hot / Action Required", type: "bad" };
}

/** Indoor Air Quality (IAQ CO2) Evaluation */
function evalIaq(co2) {
  if (co2 === null) return { text: "Awaiting Data", type: "neutral" };
  if (co2 < 600) return { text: "Excellent (<600 ppm)", type: "ok" };
  if (co2 < 800) return { text: "Good (ASHRAE 62.1)", type: "ok" };
  if (co2 <= 1000) return { text: "Moderate (Review Occupancy)", type: "warn" };
  return { text: "Elevated / Ventilate Now", type: "bad" };
}

function thresholdClass(val, warn, bad) {
  if (val === null) return "live-unknown";
  if (val >= bad)   return "live-bad";
  if (val >= warn)  return "live-warn";
  return "live-ok";
}

// ─── Telemetry Chart Pusher ──────────────────────────────────────────────────
function appendTelemetryPoint(avgT, outT, irr) {
  const timeLabel = new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour12: false });
  const hist = window.liveTelemetryHistory;

  // Hindari spamming timestamp sama persis
  if (hist.labels.length > 0 && hist.labels[hist.labels.length - 1] === timeLabel) {
    return;
  }

  hist.labels.push(timeLabel);
  hist.indoorTemp.push(avgT !== null ? parseFloat(avgT.toFixed(1)) : null);
  hist.outdoorTemp.push(outT !== null ? parseFloat(outT.toFixed(1)) : null);
  hist.solar.push(irr !== null ? parseFloat((irr / 10).toFixed(1)) : 0);

  // Batasi 20 titik riwayat data berjalan
  if (hist.labels.length > 20) {
    hist.labels.shift();
    hist.indoorTemp.shift();
    hist.outdoorTemp.shift();
    hist.solar.shift();
  }

  if (window.liveTelemetryChart) {
    try {
      window.liveTelemetryChart.data.labels = hist.labels;
      window.liveTelemetryChart.data.datasets[0].data = hist.indoorTemp;
      window.liveTelemetryChart.data.datasets[1].data = hist.outdoorTemp;
      window.liveTelemetryChart.data.datasets[2].data = hist.solar;
      window.liveTelemetryChart.update("none"); // update tanpa flicker
    } catch (e) {
      console.warn("[Chart] Error update chart:", e);
    }
  }
}

// ─── DOM Updater Utama ───────────────────────────────────────────────────────
function updateDom(changedNode, changedKey) {
  const THR = APP_CONFIG.THRESHOLDS;
  const timeStr = nowWib();

  /* ── Status broker ── */
  const brokerDot = document.getElementById("mqtt-broker-status");
  if (brokerDot) {
    brokerDot.className = "mqtt-pulse-dot mqtt-pulse-dot--" + window.liveData.status.broker;
    brokerDot.title     = "MQTT Broker: " + window.liveData.status.broker;
  }
  setText("mqtt-broker-text", window.liveData.status.broker === "online" ? `Connected (${APP_CONFIG.MQTT.BROKER_URL})` : "Disconnected");

  /* ── Status NNZN bridge ── */
  const nnznSt = window.liveData.status.nnzn;
  setText("nnzn-bridge-status", nnznSt === "online" ? "Online" : nnznSt === "offline" ? "Offline" : "Connecting");
  const nnznBadge = document.getElementById("nnzn-bridge-badge");
  if (nnznBadge) {
    nnznBadge.className = "px-2 py-0.5 text-xs font-semibold rounded-full " +
      (nnznSt === "online" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-600");
  }

  /* ══════════════════ SHT31 NODES (6 WORKBENCH) ════════════════════════ */
  let activeNodesCount = 0;
  Object.keys(APP_CONFIG.MQTT.SHT_NODES).forEach(node => {
    const data = window.liveData.sht[node] || {};
    const t   = data.temperature;
    const h   = data.humidity;
    const ts  = data.lastSeen ? new Date(data.lastSeen).toLocaleTimeString("en-US", { timeZone: "Asia/Jakarta", hour12: false }) : "—";
    const st  = window.liveData.status.nodes[node];
    const leg = APP_CONFIG.MQTT.SHT_NODES[node]?.legacy ? `sht-${APP_CONFIG.MQTT.SHT_NODES[node].legacy.toLowerCase()}` : null;

    if (st === "online") activeNodesCount++;

    // Temperature & humidity values (update kedua format ID: baru & legacy)
    const targets = [node];
    if (leg) targets.push(leg);

    targets.forEach(tgt => {
      setText(`sht-${tgt}-temp`, t !== null ? t.toFixed(1) + " °C" : "—");
      setText(`sht-${tgt}-hum`,  h !== null ? h.toFixed(1) + " %RH" : "—");
      setText(`sht-${tgt}-ts`,   ts !== "—" ? ts + " (UTC+7)" : "—");

      // Progress bar temperatur (range 20°C - 35°C)
      if (t !== null) {
        const tempPct = Math.max(5, Math.min(100, ((t - 20) / 15) * 100));
        setWidth(`sht-${tgt}-temp-bar`, tempPct);
        const bar = document.getElementById(`sht-${tgt}-temp-bar`);
        if (bar) {
          bar.className = "h-1.5 rounded-full transition-all duration-500 " +
            (t > 30 ? "bg-rose-500" : t > 27 ? "bg-amber-500" : "bg-emerald-500");
        }
      }

      // Status pill
      const pel = document.getElementById(`sht-${tgt}-pill`);
      if (pel) {
        pel.textContent = st === "online" ? "Live" : st === "offline" ? "Offline" : "—";
        pel.className   = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold " +
          (st === "online" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-500 border border-slate-200");
      }

      // Evaluation status per node
      const comf = evalComfort(t, h);
      setText(`sht-${tgt}-comfort`, comf.text.split(" ")[0]);

      // Temperature text color threshold
      setClass(`sht-${tgt}-temp`, thresholdClass(t, THR.temp_warn, THR.temp_bad));
    });
  });

  /* ══════════════════ NNZN RS485 SENSORS ════════════════════════════════ */
  Object.entries(APP_CONFIG.MQTT.NNZN_SENSORS).forEach(([tag, cfg]) => {
    const entry = window.liveData.nnzn[tag];
    const v     = entry?.value;
    const domId = cfg.domId;

    let display = v !== null && v !== undefined ? v.toFixed(tag.includes("lux") ? 0 : 1) + " " + cfg.unit : "—";
    if (tag === "co2_co2" && v !== null) {
      display = domId === "nnzn-co2" ? String(Math.round(v)) : Math.round(v) + " ppm";
    }
    if (tag === "airflow_speed" && v !== null && domId === "nnzn-airflow") {
      display = v.toFixed(1);
    }

    setText(domId, display);
    if (tag === "airflow_speed") setText("nnzn-airflow-out", v !== null && v !== undefined ? v.toFixed(1) + " m/s" : "0.0 m/s");

    // Progress bar for Workstation Lux (target scale 500 lx)
    if (tag.startsWith("lx") && tag.endsWith("_lux") && v !== null) {
      const luxPct = Math.min(100, (v / 500) * 100);
      setWidth(`${domId}-bar`, luxPct);
    }
  });

  // Progress Bar & Level CO2
  const co2Val = window.liveData.nnzn["co2_co2"]?.value;
  if (co2Val !== null && co2Val !== undefined) {
    const co2Pct = Math.min(100, Math.max(10, ((co2Val - 400) / 1000) * 100));
    setWidth("nnzn-co2-bar", co2Pct);
    setWidth("summary-co2-bar", co2Pct);
    const co2Status = evalIaq(co2Val);
    setBadge("nnzn-co2-badge", co2Status.text, co2Status.type);
    setBadge("summary-co2-status", co2Val < 600 ? "Optimal (<600)" : co2Val < 800 ? "Good Quality" : "Warning", co2Status.type);
  }

  // Solar Irradiance
  const irrVal = window.liveData.nnzn["g_out_irradiance"]?.value;
  if (irrVal !== null && irrVal !== undefined) {
    const irrPct = Math.min(100, (irrVal / 1000) * 100);
    setWidth("nnzn-irradiance-bar", irrPct);
  }

  /* ══════════════════ AGGREGATES & EXECUTIVE KPI SUMMARY ═════════════════ */
  const avgTemp = shtAvg("temperature");
  const avgHum  = shtAvg("humidity");
  const avgLux  = indoorLuxAvg();
  const minMaxT = shtMinMaxTemp();
  const outTemp = window.liveData.nnzn["th_out_temperature"]?.value;
  const outHum  = window.liveData.nnzn["th_out_humidity"]?.value;
  const airflow = window.liveData.nnzn["airflow_speed"]?.value;
  const dewP    = calcDewPoint(avgTemp, avgHum);
  const comfort = evalComfort(avgTemp, avgHum);

  // 1. Average Indoor Temperature
  setText("summary-avg-temp", avgTemp !== null ? avgTemp.toFixed(1) : "—");
  setBadge("summary-temp-status", comfort.text.split(" (")[0], comfort.type);
  if (minMaxT.min !== null && minMaxT.max !== null) {
    setText("summary-temp-range", `Min ${minMaxT.min.toFixed(1)}°C · Max ${minMaxT.max.toFixed(1)}°C`);
  }

  // 2. Average Humidity
  setText("summary-avg-hum", avgHum !== null ? avgHum.toFixed(1) : "—");
  setBadge("summary-hum-status", avgHum !== null && avgHum >= 40 && avgHum <= 65 ? "Ideal (40–65%)" : "Standard Comfort", "ok");

  // 3. Lab CO2
  setText("summary-co2", co2Val !== null && co2Val !== undefined ? String(Math.round(co2Val)) : "—");

  // 4. Average Illuminance
  setText("summary-avg-lux", avgLux !== null ? String(Math.round(avgLux)) : "—");
  setBadge("summary-lux-status", avgLux !== null && avgLux >= 350 ? "Task Compliant" : "Daylight Level", "neutral");

  // 5. Outdoor Temp & RH
  setText("summary-out-temp", outTemp !== null && outTemp !== undefined ? outTemp.toFixed(1) : "—");
  setText("summary-out-hum", outHum !== null && outHum !== undefined ? outHum.toFixed(1) + " %RH" : "—");
  if (outTemp !== null && avgTemp !== null) {
    const delta = outTemp - avgTemp;
    const deltaStr = (delta >= 0 ? "+" : "") + delta.toFixed(1) + "°C";
    setText("summary-temp-delta", deltaStr);
    setBadge("summary-delta-temp", `Delta: ${deltaStr}`, delta > 2 ? "warn" : "ok");
  }

  // 6. Irradiance & Active Nodes
  setText("summary-irradiance", irrVal !== null && irrVal !== undefined ? Math.round(irrVal) + " W/m²" : "—");
  setText("summary-active-nodes", `${activeNodesCount} / 6 Active Nodes`);

  // Estimated dynamic power demand (kW)
  let estimatedPower = 21.1;
  if (avgTemp !== null) {
    estimatedPower = 18.0 + Math.max(0, (avgTemp - 26.0) * 1.3);
  }
  setText("summary-power", estimatedPower.toFixed(1));

  /* ══════════════════ DETAILED BUILDING CONDITIONS (MIRROR) ═════════════ */
  setText("summary-avg-temp-2", avgTemp !== null ? avgTemp.toFixed(1) + " °C" : "—");
  setText("summary-avg-hum-2",  avgHum !== null ? avgHum.toFixed(1) + " %RH" : "—");
  setText("summary-co2-2",      co2Val !== null && co2Val !== undefined ? Math.round(co2Val) + " ppm" : "—");
  setText("summary-avg-lux-2",  avgLux !== null ? Math.round(avgLux) + " lx" : "—");
  setText("summary-out-temp-2", outTemp !== null && outTemp !== undefined ? outTemp.toFixed(1) + " °C" : "—");
  setText("summary-airflow-2",  airflow !== null && airflow !== undefined ? airflow.toFixed(1) + " m/s" : "—");
  setText("summary-dewpoint",   dewP !== null ? dewP.toFixed(1) + " °C" : "—");
  setText("summary-comfort-category", comfort.text);

  /* ── Append data point to Live Telemetry Chart ── */
  if (avgTemp !== null || outTemp !== null) {
    appendTelemetryPoint(avgTemp, outTemp, irrVal);
  }

  /* ── Update Timestamps ── */
  setText("mqtt-last-update", timeStr);
  setText("mqtt-last-update-big", timeStr + " (UTC+7)");
  setText("mqtt-last-update-footer", timeStr);
  setText("alert-timestamp", timeStr.split(" ")[0]);
  setText("chart-sub-time", timeStr.split(" ")[0]);
  setText("chart-sub-time-header", timeStr.split(" ")[0]);
  if (irrVal !== null && irrVal !== undefined) {
    setText("chart-sub-rad", Math.round(irrVal) + " W/m²");
  }
  if (avgLux !== null) {
    setText("alert-lux", Math.round(avgLux) + " lx");
  }
}

// ─── MQTT Client Manager ─────────────────────────────────────────────────────
class MqttManager {
  constructor() {
    this.client      = null;
    this.isConnected = false;
  }

  connect() {
    if (typeof mqtt === "undefined") {
      console.error("[MQTT] Library mqtt.js belum dimuat. Periksa CDN di HTML.");
      return;
    }

    const { BROKER_URL, OPTIONS, TOPICS } = APP_CONFIG.MQTT;
    console.log(`[MQTT] Menghubungkan ke ${BROKER_URL} …`);

    try {
      this.client = mqtt.connect(BROKER_URL, OPTIONS);
    } catch (e) {
      console.error("[MQTT] Error inisialisasi koneksi:", e);
      return;
    }

    this.client.on("connect", () => {
      console.log("[MQTT] Terhubung sukses ke broker.");
      this.isConnected = true;
      window.liveData.status.broker = "online";

      // Subscribe ke semua topik data
      Object.values(TOPICS).forEach(topic => {
        this.client.subscribe(topic, { qos: 0 }, (err) => {
          if (err) console.error(`[MQTT] Gagal subscribe ${topic}:`, err);
          else     console.log(`[MQTT] Berhasil subscribe: ${topic}`);
        });
      });

      updateDom();
    });

    this.client.on("message", (topic, messageBuffer) => {
      const payload = messageBuffer.toString().trim();
      this._dispatch(topic, payload);
    });

    this.client.on("error", (err) => {
      console.error("[MQTT] Error koneksi:", err);
    });

    this.client.on("offline", () => {
      console.warn("[MQTT] Broker offline / terputus.");
      this.isConnected = false;
      window.liveData.status.broker = "offline";
      updateDom();
    });

    this.client.on("reconnect", () => {
      window.liveData.status.broker = "connecting";
      updateDom();
    });
  }

  /**
   * Publish pesan perintah kontrol ke MQTT broker
   */
  publish(topic, message, options = { qos: 0, retain: false }) {
    if (!this.client || !this.isConnected) {
      console.warn(`[MQTT] Publish diabaikan (koneksi belum siap): ${topic} -> ${message}`);
      return false;
    }
    const payloadStr = typeof message === "object" ? JSON.stringify(message) : String(message);
    this.client.publish(topic, payloadStr, options, (err) => {
      if (err) console.error(`[MQTT] Gagal publish ke ${topic}:`, err);
      else console.log(`[MQTT] Berhasil publish: ${topic} -> ${payloadStr}`);
    });
    return true;
  }

  /**
   * Dispatch setiap pesan MQTT ke slot liveData yang tepat
   */
  _dispatch(topic, payload) {
    const parts = topic.split("/");

    /* ── SHT31 Status LWT (sht-{x}/status) ── */
    if (parts.length === 2 && parts[1] === "status") {
      const rawNode = parts[0];
      const node = APP_CONFIG.MQTT.SHT_ALIAS?.[rawNode] || rawNode;
      if (node in APP_CONFIG.MQTT.SHT_NODES) {
        window.liveData.status.nodes[node] = payload;
        const leg = APP_CONFIG.MQTT.SHT_NODES[node]?.legacy ? `sht-${APP_CONFIG.MQTT.SHT_NODES[node].legacy.toLowerCase()}` : null;
        if (leg) window.liveData.status.nodes[leg] = payload;
        updateDom(node, "status");
        return;
      }
    }

    /* ── NNZN Bridge Status (nnzn-weather/status) ── */
    if (topic === "nnzn-weather/status") {
      window.liveData.status.nnzn = payload;
      updateDom(null, "nnzn-status");
      return;
    }

    /* ── Smartroom Camera Telemetry (smartroom/camera/...) ── */
    if (topic.startsWith("smartroom/camera/")) {
      try {
        const cdata = JSON.parse(payload);
        if (!window.liveData.camera) window.liveData.camera = {};
        Object.assign(window.liveData.camera, cdata);
        window.liveData.camera.lastSeen = Date.now();
        if (typeof updateCameraDom === "function") {
          updateCameraDom(cdata);
        }
      } catch (e) {
        console.warn("[MQTT] Parse error smartroom camera:", e);
      }
      return;
    }

    /* ── Ekstraksi numeric payload ── */
    let val = parseFloat(payload);
    if (isNaN(val)) {
      try {
        const obj = JSON.parse(payload);
        if (obj.value !== undefined) val = parseFloat(obj.value);
        else if (obj.val !== undefined) val = parseFloat(obj.val);
        else if (obj.state !== undefined) val = parseFloat(obj.state);
      } catch (e) {}
    }

    /* ── SHT31 Sensor Data (sht-{x}/sensor/{metric}/state) ── */
    if (parts.length >= 4 && parts[1] === "sensor" && parts[parts.length - 1] === "state") {
      const rawNode = parts[0];
      const node    = APP_CONFIG.MQTT.SHT_ALIAS?.[rawNode] || rawNode;
      const metric  = parts[2].toLowerCase();

      if (node in APP_CONFIG.MQTT.SHT_NODES && !isNaN(val)) {
        window.liveData.status.nodes[node] = "online";
        const leg = APP_CONFIG.MQTT.SHT_NODES[node]?.legacy ? `sht-${APP_CONFIG.MQTT.SHT_NODES[node].legacy.toLowerCase()}` : null;
        if (leg) window.liveData.status.nodes[leg] = "online";

        let prop = null;
        if (metric === "temperature" || metric === "temp" || (metric.includes("temp") && !metric.includes("chip") && !metric.includes("raw"))) {
          prop = "temperature";
        } else if (metric === "humidity" || metric === "hum" || (metric.includes("hum") && !metric.includes("raw"))) {
          prop = "humidity";
        }

        if (prop) {
          window.liveData.sht[node][prop] = val;
          window.liveData.sht[node].lastSeen = Date.now();
          if (leg && window.liveData.sht[leg]) {
            window.liveData.sht[leg][prop] = val;
            window.liveData.sht[leg].lastSeen = Date.now();
          }
          updateDom(node, prop);
        }
        return;
      }

      /* ── NNZN RS485 Data (nnzn-weather/sensor/{tag}_{key}/state) ── */
      if (node === "nnzn-weather" && !isNaN(val)) {
        window.liveData.status.nnzn = "online";
        const sensorKey = parts[2];
        if (sensorKey in APP_CONFIG.MQTT.NNZN_SENSORS) {
          window.liveData.nnzn[sensorKey].value    = val;
          window.liveData.nnzn[sensorKey].lastSeen = Date.now();
          updateDom(null, sensorKey);
        }
      }
    }
  }
}

// ─── Inisialisasi MQTT saat Halaman Siap ──────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  window.mqttManager = new MqttManager();
  window.mqttManager.connect();
});
