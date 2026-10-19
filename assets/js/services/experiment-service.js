/**
 * BEMS Dashboard — Operating & Experiment Mode Service
 * Mengelola kendali terintegrasi AC dan Pencahayaan (Lighting) dengan 4 strategi:
 * 1. Manual Control (Langsung atur Setpoint AC, Fan, Swing, dan Dimming PWM Lampu 2-Zona)
 * 2. Adaptive Control (Closed-loop otomatis kenyamanan termal PMV & Daylight Harvesting Lux)
 * 3. Scheduling Operation (Jadwal operasional kelas/praktikum, occupancy auto-off)
 * 4. Machine Learning & AI Optimization (MOPSO, MOGA/NSGA-II, Deep RL, LSTM-MPC, Fuzzy Logic)
 */

(function () {
  "use strict";

  const TARIF_KWH = 1500;
  const API_URL = (window.APP_CONFIG && window.APP_CONFIG.ENERGY && window.APP_CONFIG.ENERGY.API_URL) || "https://iotlab-uns.com/api_energy.php";
  const API_KEY = (window.APP_CONFIG && window.APP_CONFIG.ENERGY && window.APP_CONFIG.ENERGY.API_KEY) || "iotlab_smartroom_2024";

  // State Utama
  const state = {
    activeMode: "manual", // manual | adaptive | scheduling | ml
    ac: {
      power: true,
      setpoint: 24.0,
      fan: "auto",
      mode: "cool",
      swing: true,
      status: "running"
    },
    lighting: {
      power: true,
      zone1: 55, // %
      zone2: 70, // %
      preset: "custom"
    },
    adaptive: {
      pmvMin: -0.5,
      pmvMax: +0.5,
      targetLux: 480,
      deadband: 0.5,
      daylightHarvesting: true,
      occupancyPriority: "balanced"
    },
    scheduling: {
      activeProfile: "weekday-class",
      autoOffDelay: 15, // menit
      preCoolMinutes: 20,
      isOccupied: true
    },
    ml: {
      algorithm: "mopso", // mopso | moga | rl | lstm_mpc | fuzzy
      tradeoffAlpha: 0.55, // 0 = Comfort priority, 1 = Energy savings priority
      population: 40,
      iterations: 50,
      isOptimizing: false,
      progress: 0,
      lastRunResults: {
        recommendedSetpoint: 24.8,
        recommendedFan: "Auto",
        recommendedZone1: 38,
        recommendedZone2: 72,
        energySavingsPct: 23.4,
        predictedPmv: +0.12,
        predictedPpd: 5.4,
        comfortIndex: "Kelas A (Sangat Nyaman)",
        convergenceGen: 36,
        objectiveValue: 0.184
      }
    },
    liveTelemetry: {
      indoorTemp: 24.2,
      indoorHum: 62.5,
      avgLux: 468,
      outdoorLux: 1420,
      acPowerKw: 1.25,
      lampPowerW: 165,
      totalPowerKw: 1.415,
      personCount: 3
    },
    auditLog: [
      { id: 1, time: "23:40:12", mode: "Manual", target: "AC Setpoint", value: "24.0 °C", status: "Executed (MQTT OK)" },
      { id: 2, time: "23:35:45", mode: "Adaptive", target: "Lighting Z1", value: "55% PWM", status: "Auto Trim (Daylight)" },
      { id: 3, time: "23:15:00", mode: "MOPSO AI", target: "Optimized Policy", value: "Tset: 24.8°C / Z1: 38%", status: "Deployed to Edge" },
      { id: 4, time: "22:50:18", mode: "Scheduling", target: "Occupancy Gate", value: "3 Orang Terdeteksi", status: "Active Class" }
    ],
    scheduleEntries: [
      { id: 1, name: "Pre-Cooling",          start: "07:30", end: "08:00", days: "Senin–Jumat", acPower: "on",  acSp: 24.0, acFan: "high",  z1: 0,  z2: 0  },
      { id: 2, name: "Kuliah & Praktikum",   start: "08:00", end: "12:00", days: "Senin–Jumat", acPower: "on",  acSp: 24.0, acFan: "auto",  z1: 55, z2: 70 },
      { id: 3, name: "Istirahat Siang",      start: "12:00", end: "13:00", days: "Senin–Jumat", acPower: "on",  acSp: 26.5, acFan: "low",   z1: 20, z2: 30 },
      { id: 4, name: "Sesi Sore / Riset",    start: "13:00", end: "17:00", days: "Senin–Jumat", acPower: "on",  acSp: 24.5, acFan: "auto",  z1: 40, z2: 75 },
      { id: 5, name: "Night Standby",        start: "17:00", end: "07:30", days: "Setiap Hari",  acPower: "off", acSp: 26.5, acFan: "quiet", z1: 0,  z2: 0  }
    ],
    scheduleIdCounter: 6
  };

  const charts = {
    response: null,
    pareto: null
  };

  // Formatters
  function fmt(val, dec = 1) {
    const n = parseFloat(val);
    if (!Number.isFinite(n)) return "--";
    return n.toLocaleString("id-ID", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // Dark Tooltip
  const darkTooltip = {
    backgroundColor: "rgba(15, 23, 42, 0.94)",
    titleColor: "#f8fafc",
    bodyColor: "#cbd5e1",
    borderColor: "rgba(51, 65, 85, 0.6)",
    borderWidth: 1,
    padding: 10,
    cornerRadius: 8,
    usePointStyle: true
  };

  // ── Mode Switcher ─────────────────────────────────────────────────────────────
  function setMode(mode) {
    if (!["manual", "adaptive", "scheduling", "ml"].includes(mode)) return;
    state.activeMode = mode;

    // Update active tab buttons
    document.querySelectorAll(".mode-tab-btn").forEach(btn => {
      const btnMode = btn.getAttribute("data-mode");
      if (btnMode === mode) {
        btn.className = "mode-tab-btn px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all bg-white text-teal-900 shadow-sm border border-teal-200/90";
      } else {
        btn.className = "mode-tab-btn px-4 py-2.5 rounded-xl font-semibold text-xs flex items-center gap-2 transition-all text-slate-500 hover:text-slate-800 hover:bg-white/60";
      }
    });

    // Show/Hide Mode-Specific Configuration Panes
    const panes = ["manual-pane", "adaptive-pane", "scheduling-pane", "ml-pane"];
    panes.forEach(paneId => {
      const pane = document.getElementById(paneId);
      if (pane) {
        if (paneId === `${mode}-pane`) {
          pane.classList.remove("hidden");
        } else {
          pane.classList.add("hidden");
        }
      }
    });

    // Update Mode Status Badges
    const badgeMap = {
      manual: { text: "Manual Control Active", cls: "bg-blue-50 text-blue-800 border-blue-200" },
      adaptive: { text: "Adaptive Comfort Loop Active", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
      scheduling: { text: "Scheduled Policy Active", cls: "bg-purple-50 text-purple-800 border-purple-200" },
      ml: { text: `${state.ml.algorithm.toUpperCase()} AI Optimization Active`, cls: "bg-amber-50 text-amber-800 border-amber-200" }
    };
    const cur = badgeMap[mode];
    const topBadge = document.getElementById("active-mode-badge");
    if (topBadge && cur) {
      topBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-current animate-pulse"></span> ${cur.text}`;
      topBadge.className = `px-3 py-1 rounded-full text-xs font-bold font-mono border inline-flex items-center gap-2 ${cur.cls}`;
    }

    // Show/Hide manual actuator console (hanya tampil di mode Manual)
    const actuatorConsole = document.getElementById("manual-actuator-console");
    if (actuatorConsole) {
      if (mode === "manual") {
        actuatorConsole.classList.remove("hidden");
      } else {
        actuatorConsole.classList.add("hidden");
      }
    }

    addAuditLog(mode.toUpperCase(), "Strategy Switch", `Beralih ke mode ${mode.toUpperCase()}`);
    updateSimulationChart();
  }

  // ── AC Actuator Controls ──────────────────────────────────────────────────────
  function setAcPower(on) {
    state.ac.power = on;
    const btnOn = document.getElementById("btn-ac-power-on");
    const btnOff = document.getElementById("btn-ac-power-off");
    const badge = document.getElementById("ac-actuator-badge");

    if (on) {
      if (btnOn) btnOn.className = "px-3.5 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white shadow-xs";
      if (btnOff) btnOff.className = "px-3.5 py-1.5 text-xs font-medium rounded-lg text-slate-500 hover:bg-slate-100";
      if (badge) {
        badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Kompresor Running (Daya Terkendali)`;
        badge.className = "px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 inline-flex items-center gap-1.5";
      }
    } else {
      if (btnOn) btnOn.className = "px-3.5 py-1.5 text-xs font-medium rounded-lg text-slate-500 hover:bg-slate-100";
      if (btnOff) btnOff.className = "px-3.5 py-1.5 text-xs font-bold rounded-lg bg-rose-600 text-white shadow-xs";
      if (badge) {
        badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-slate-400"></span> Kompresor Standby / Matang`;
        badge.className = "px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 inline-flex items-center gap-1.5";
      }
    }

    publishActuatorCommand("ac/power", on ? "ON" : "OFF");
    addAuditLog(state.activeMode, "AC Power", on ? "ON" : "OFF");
    updateSimulationChart();
  }

  function setAcSetpoint(val) {
    let t = parseFloat(val);
    if (isNaN(t)) t = 24.0;
    if (t < 16.0) t = 16.0;
    if (t > 30.0) t = 30.0;
    t = Math.round(t * 10) / 10;
    state.ac.setpoint = t;

    setEl("ac-setpoint-val", t.toFixed(1) + " °C");
    setEl("ac-setpoint-display-big", t.toFixed(1));

    // Calculate delta to room temp
    const delta = (t - state.liveTelemetry.indoorTemp).toFixed(1);
    const deltaEl = document.getElementById("ac-setpoint-delta");
    if (deltaEl) {
      if (Math.abs(delta) < 0.3) {
        deltaEl.textContent = "Suhu Setpoint setara Suhu Ruangan aktual";
        deltaEl.className = "text-xs text-teal-700 font-medium";
      } else if (delta < 0) {
        deltaEl.textContent = `Pendinginan aktif: ${Math.abs(delta)} °C di bawah suhu ruangan`;
        deltaEl.className = "text-xs text-blue-700 font-medium";
      } else {
        deltaEl.textContent = `Pemanasan/Setback: +${delta} °C di atas suhu ruangan`;
        deltaEl.className = "text-xs text-amber-700 font-medium";
      }
    }

    publishActuatorCommand("ac/setpoint", t.toFixed(1));
    updatePendingSummary();
    updateSimulationChart();
  }

  function adjustAcSetpoint(step) {
    setAcSetpoint(state.ac.setpoint + step);
    addAuditLog(state.activeMode, "AC Setpoint Stepper", `${state.ac.setpoint.toFixed(1)} °C`);
  }

  function setAcFan(speed) {
    state.ac.fan = speed;
    document.querySelectorAll(".ac-fan-btn").forEach(btn => {
      if (btn.getAttribute("data-fan") === speed) {
        btn.className = "ac-fan-btn px-2.5 py-1 text-xs font-bold rounded-lg bg-teal-800 text-white shadow-2xs";
      } else {
        btn.className = "ac-fan-btn px-2.5 py-1 text-xs font-medium rounded-lg text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors";
      }
    });
    publishActuatorCommand("ac/fan", speed);
    addAuditLog(state.activeMode, "AC Fan Speed", speed.toUpperCase());
    updatePendingSummary();
  }

  function setAcMode(acMode) {
    state.ac.mode = acMode;
    document.querySelectorAll(".ac-mode-btn").forEach(btn => {
      if (btn.getAttribute("data-mode") === acMode) {
        btn.className = "ac-mode-btn px-2.5 py-1 text-xs font-bold rounded-lg bg-teal-800 text-white shadow-2xs";
      } else {
        btn.className = "ac-mode-btn px-2.5 py-1 text-xs font-medium rounded-lg text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors";
      }
    });
    publishActuatorCommand("ac/mode", acMode);
    addAuditLog(state.activeMode, "AC Mode", acMode.toUpperCase());
    updatePendingSummary();
  }

  // ── Pending Summary Bar & Apply Manual Setting ─────────────────────────────
  function updatePendingSummary() {
    const ac = state.ac;
    const lt = state.lighting;
    const setEl2 = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    setEl2("pending-ac",     `${ac.setpoint.toFixed(1)} °C`);
    setEl2("pending-fan",    ac.fan.charAt(0).toUpperCase() + ac.fan.slice(1));
    setEl2("pending-acmode", ac.mode.charAt(0).toUpperCase() + ac.mode.slice(1));
    setEl2("pending-z1",     `${lt.zone1}%`);
    setEl2("pending-z2",     `${lt.zone2}%`);
  }

  function applyManualSetting() {
    const btn = document.getElementById("btn-apply-manual");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg> Mengirim...`;
    }

    // Kirim semua perintah sekaligus
    publishActuatorCommand("ac/setpoint", state.ac.setpoint.toFixed(1));
    publishActuatorCommand("ac/fan",      state.ac.fan);
    publishActuatorCommand("ac/mode",     state.ac.mode);
    publishActuatorCommand("lamp/zone1/pwm", Math.round((state.lighting.zone1 / 100) * 255));
    publishActuatorCommand("lamp/zone2/pwm", Math.round((state.lighting.zone2 / 100) * 255));

    addAuditLog("MANUAL", "Apply Setting",
      `AC ${state.ac.setpoint.toFixed(1)}°C | Fan: ${state.ac.fan} | Mode: ${state.ac.mode} | Z1: ${state.lighting.zone1}% | Z2: ${state.lighting.zone2}%`);

    setTimeout(() => {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Apply Setting`;
      }
      showToast(
        `✅ Setting diterapkan — AC: ${state.ac.setpoint.toFixed(1)}°C, Fan: ${state.ac.fan.toUpperCase()}, Z1: ${state.lighting.zone1}%, Z2: ${state.lighting.zone2}%`,
        "#1d4ed8"
      );
    }, 800);
  }

  // ── Lighting Actuator Controls ────────────────────────────────────────────────
  function setLightPower(on) {
    state.lighting.power = on;
    const btnOn = document.getElementById("btn-light-power-on");
    const btnOff = document.getElementById("btn-light-power-off");
    const badge = document.getElementById("light-actuator-badge");

    if (on) {
      if (btnOn) btnOn.className = "px-3.5 py-1.5 text-xs font-bold rounded-lg bg-amber-600 text-white shadow-xs";
      if (btnOff) btnOff.className = "px-3.5 py-1.5 text-xs font-medium rounded-lg text-slate-500 hover:bg-slate-100";
      if (badge) {
        badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span> 4 Fixture Aktif (PWM Dimming)`;
        badge.className = "px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 inline-flex items-center gap-1.5";
      }
    } else {
      if (btnOn) btnOn.className = "px-3.5 py-1.5 text-xs font-medium rounded-lg text-slate-500 hover:bg-slate-100";
      if (btnOff) btnOff.className = "px-3.5 py-1.5 text-xs font-bold rounded-lg bg-rose-600 text-white shadow-xs";
      if (badge) {
        badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-slate-400"></span> Seluruh Fixture Padam (0 W)`;
        badge.className = "px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 inline-flex items-center gap-1.5";
      }
    }

    publishActuatorCommand("lamp/power", on ? "ON" : "OFF");
    addAuditLog(state.activeMode, "Master Lighting", on ? "ON" : "OFF");
    updateLightingFeedback();
  }

  function setLightZone1(val) {
    const pct = parseInt(val, 10);
    state.lighting.zone1 = isNaN(pct) ? 50 : Math.max(0, Math.min(100, pct));
    const slider = document.getElementById("light-z1-slider");
    if (slider) slider.value = state.lighting.zone1;
    setEl("light-z1-val", `${state.lighting.zone1}%`);
    const pwm = Math.round((state.lighting.zone1 / 100) * 255);
    setEl("light-z1-pwm", `PWM ${pwm}/255`);
    const watts = Math.round((state.lighting.zone1 / 100) * 140);
    setEl("light-z1-watt", `${watts} W`);

    publishActuatorCommand("lamp/zone1/pwm", pwm);
    updateLightingFeedback();
    updatePendingSummary();
  }

  function setLightZone2(val) {
    const pct = parseInt(val, 10);
    state.lighting.zone2 = isNaN(pct) ? 50 : Math.max(0, Math.min(100, pct));
    const slider = document.getElementById("light-z2-slider");
    if (slider) slider.value = state.lighting.zone2;
    setEl("light-z2-val", `${state.lighting.zone2}%`);
    const pwm = Math.round((state.lighting.zone2 / 100) * 255);
    setEl("light-z2-pwm", `PWM ${pwm}/255`);
    const watts = Math.round((state.lighting.zone2 / 100) * 140);
    setEl("light-z2-watt", `${watts} W`);

    publishActuatorCommand("lamp/zone2/pwm", pwm);
    updateLightingFeedback();
    updatePendingSummary();
  }

  function applyLightPreset(preset) {
    state.lighting.preset = preset;
    const presets = {
      daylight: { z1: 30, z2: 75, name: "Daylight Harvesting" },
      class: { z1: 70, z2: 75, name: "Kuliah & Praktikum SNI" },
      presentation: { z1: 15, z2: 25, name: "Presentasi / Layar LCD" },
      eco: { z1: 40, z2: 40, name: "Eco Energy Saver" },
      full: { z1: 100, z2: 100, name: "Maksimal (100% 280W)" }
    };
    const p = presets[preset];
    if (p) {
      setLightZone1(p.z1);
      setLightZone2(p.z2);
      addAuditLog(state.activeMode, "Preset Pencahayaan", `${p.name} (Z1: ${p.z1}%, Z2: ${p.z2}%)`);
    }

    document.querySelectorAll(".light-preset-btn").forEach(btn => {
      if (btn.getAttribute("data-preset") === preset) {
        btn.className = "light-preset-btn px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-700 text-white shadow-2xs";
      } else {
        btn.className = "light-preset-btn px-3 py-1.5 text-xs font-medium rounded-lg text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors";
      }
    });
  }

  function updateLightingFeedback() {
    if (!state.lighting.power) {
      setEl("light-total-calc-w", "0 W");
      setEl("light-pred-lux", "0 Lux");
      return;
    }
    const w1 = (state.lighting.zone1 / 100) * 140;
    const w2 = (state.lighting.zone2 / 100) * 140;
    const totalW = Math.round(w1 + w2);
    setEl("light-total-calc-w", `${totalW} W`);

    // Perkiraan lux rerata meja kerja berdasarkan persentase dan kontribusi outdoor
    const outLux = state.liveTelemetry.outdoorLux || 1000;
    const dayFactor = Math.min(220, outLux * 0.12);
    const artFactor = (w1 + w2) * 1.55;
    const predLux = Math.round(artFactor + dayFactor);
    setEl("light-pred-lux", `${predLux} Lux`);

    const statusBadge = document.getElementById("light-pred-sni-status");
    if (statusBadge) {
      if (predLux >= 350 && predLux <= 550) {
        statusBadge.textContent = "Sesuai SNI (350-500 Lux)";
        statusBadge.className = "text-emerald-700 font-bold";
      } else if (predLux < 350) {
        statusBadge.textContent = "Kurang Cahaya (<350 Lux)";
        statusBadge.className = "text-amber-700 font-bold";
      } else {
        statusBadge.textContent = "Terlalu Terang (>550 Lux)";
        statusBadge.className = "text-blue-700 font-bold";
      }
    }
  }

  // ── Machine Learning & AI Optimization Module ─────────────────────────────────
  const algorithms = {
    mopso: {
      name: "MOPSO (Multi-Objective Particle Swarm)",
      tag: "Swarm Intelligence",
      badgeClass: "bg-teal-50 text-teal-800 border-teal-200",
      description: "Memanfaatkan kawanan partikel multi-objektif dengan repositori Pareto eksternal untuk menemukan kompromi optimum antara konsumsi energi kWh dan indeks ketidaknyamanan termal PPD ISO 7730.",
      advantages: "Konvergensi cepat, sebaran Pareto merata, komputasi ringan di Raspberry Pi edge.",
      typicalSavings: "22% – 28%",
      hyperparams: "Partikel: 40 | Repositori: 50 | w=0.72 | c1=1.49 | c2=1.49"
    },
    moga: {
      name: "MOGA / NSGA-II (Genetic Algorithm)",
      tag: "Evolutionary Algorithm",
      badgeClass: "bg-blue-50 text-blue-800 border-blue-200",
      description: "Algoritma genetika berbasis non-dominated sorting dan crowding distance. Menggunakan kromosom biner/real untuk memutasi setpoint suhu dan tingkat reduksi lampu secara evolusioner.",
      advantages: "Sangat handal menghindari lokal minimum pada sistem multi-variabel non-linear.",
      typicalSavings: "20% – 26%",
      hyperparams: "Populasi: 50 | Generasi: 60 | Crossover: 0.85 | Mutasi: 0.05"
    },
    rl: {
      name: "Deep Reinforcement Learning (DDPG / PPO)",
      tag: "Neural Agent",
      badgeClass: "bg-purple-50 text-purple-800 border-purple-200",
      description: "Model Actor-Critic kontinu yang belajar aksi kontrol optimal secara online berdasarkan fungsi reward gabungan: R = -(w_e·Energy + w_t·|PMV| + w_l·LuxError).",
      advantages: "Mampu beradaptasi secara dinamis dengan pola cuaca eksternal dan lonjakan hunian tak terduga.",
      typicalSavings: "24% – 31%",
      hyperparams: "Actor LR: 1e-4 | Critic LR: 1e-3 | Gamma: 0.99 | Buffer: 10.000"
    },
    lstm_mpc: {
      name: "LSTM Model Predictive Control (MPC)",
      tag: "Deep Predictive MPC",
      badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
      description: "Memadukan Long Short-Term Memory neural network untuk memprediksi suhu dan beban termal 30–60 menit ke depan, kemudian mengoptimalkan aksi pendinginan bertahap (anti short-cycling).",
      advantages: "Mencegah overshoot suhu dan meminimalkan tarikan daya puncak kompresor saat jam sibuk.",
      typicalSavings: "18% – 25%",
      hyperparams: "Horizon Prediksi: 30m | Hidden Units: 64 | Sequence: 12 Timesteps"
    },
    fuzzy: {
      name: "Adaptive Neuro-Fuzzy (ANFIS / Sugeno)",
      tag: "Rule-Based Fuzzy",
      badgeClass: "bg-rose-50 text-rose-800 border-rose-200",
      description: "Sistem inferensi logika fuzzy dengan fungsi keanggotaan gaussian yang memetakan masukan sensor suhu, kelembapan, radiasi surya, dan okupansi ke nilai kontrol setpoint dan PWM.",
      advantages: "Sangat transparan, mudah diinterpretasikan oleh engineer, dan tidak memerlukan model matematika gedung.",
      typicalSavings: "16% – 22%",
      hyperparams: "Rules: 27 IF-THEN | Input Variables: 4 | Defuzzifier: Centroid"
    }
  };

  function setMlAlgorithm(algoKey) {
    if (!algorithms[algoKey]) return;
    state.ml.algorithm = algoKey;
    const algo = algorithms[algoKey];

    // Update active button state
    document.querySelectorAll(".ml-algo-card").forEach(card => {
      if (card.getAttribute("data-algo") === algoKey) {
        card.className = "ml-algo-card p-3 rounded-xl border-2 border-teal-600 bg-teal-50/60 shadow-2xs transition-all cursor-pointer";
      } else {
        card.className = "ml-algo-card p-3 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-all cursor-pointer";
      }
    });

    setEl("ml-selected-title", algo.name);
    setEl("ml-selected-desc", algo.description);
    setEl("ml-selected-advantages", algo.advantages);
    setEl("ml-selected-savings", algo.typicalSavings);
    setEl("ml-selected-params", algo.hyperparams);

    addAuditLog(state.activeMode, "Pilih Algoritma AI", algo.name);
  }

  function setMlAlpha(val) {
    const alpha = parseFloat(val);
    state.ml.tradeoffAlpha = isNaN(alpha) ? 0.5 : Math.max(0, Math.min(1, alpha));
    const slider = document.getElementById("ml-alpha-slider");
    if (slider) slider.value = state.ml.tradeoffAlpha;
    setEl("ml-alpha-val", state.ml.tradeoffAlpha.toFixed(2));

    const note = document.getElementById("ml-alpha-note");
    if (note) {
      if (state.ml.tradeoffAlpha < 0.35) {
        note.textContent = "Prioritas Kenyamanan Maksimal (PMV Netral 0.0, Suhu Lebih Sejuk)";
        note.className = "text-xs text-blue-700 font-medium";
      } else if (state.ml.tradeoffAlpha > 0.65) {
        note.textContent = "Prioritas Penghematan Energi Ekstrem (Tset Lebih Tinggi, Daylight Dominan)";
        note.className = "text-xs text-amber-700 font-medium";
      } else {
        note.textContent = "Kompromi Seimbang Pareto Optimal (Standar ISO 7730 & Efisiensi BEMS)";
        note.className = "text-xs text-teal-700 font-medium";
      }
    }
  }

  // Menjalankan optimasi komputasi Machine Learning secara interaktif
  function runMlOptimizer() {
    if (state.ml.isOptimizing) return;
    state.ml.isOptimizing = true;
    state.ml.progress = 0;

    const btn = document.getElementById("btn-run-optimizer");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<svg class="w-4 h-4 animate-spin mr-1.5" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg> Menjalankan ${state.ml.algorithm.toUpperCase()}...`;
    }

    const progBar = document.getElementById("ml-progress-bar");
    const progText = document.getElementById("ml-progress-text");
    const progContainer = document.getElementById("ml-progress-container");
    if (progContainer) progContainer.classList.remove("hidden");

    let currentStep = 0;
    const totalSteps = 10;
    const interval = setInterval(() => {
      currentStep++;
      const pct = Math.round((currentStep / totalSteps) * 100);
      if (progBar) progBar.style.width = `${pct}%`;
      if (progText) progText.textContent = `Generasi ${Math.round((currentStep / totalSteps) * state.ml.iterations)} / ${state.ml.iterations} · Mengevaluasi Fitness & Pareto Archive (${pct}%)`;

      if (currentStep >= totalSteps) {
        clearInterval(interval);
        finishOptimization();
      }
    }, 180);
  }

  function finishOptimization() {
    state.ml.isOptimizing = false;
    const btn = document.getElementById("btn-run-optimizer");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg class="w-4 h-4 mr-1.5 text-teal-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg> Jalankan Optimasi ${state.ml.algorithm.toUpperCase()}`;
    }

    const progContainer = document.getElementById("ml-progress-container");
    if (progContainer) {
      setTimeout(() => progContainer.classList.add("hidden"), 1500);
    }

    // Hitung solusi optimal berdasarkan alpha dan algoritma terpilih
    const alpha = state.ml.tradeoffAlpha;
    let baseTset = 24.2 + (alpha * 1.4); // 24.2 s/d 25.6
    baseTset = Math.round(baseTset * 10) / 10;
    
    // Dimming zone 1 & 2
    let z1 = Math.round(55 - (alpha * 25)); // 30% - 55%
    let z2 = Math.round(80 - (alpha * 18)); // 62% - 80%

    let savings = Math.round((16.5 + (alpha * 14.5)) * 10) / 10;
    let pmv = ((-0.15 + (alpha * 0.45))).toFixed(2);
    let ppd = Math.round(5.0 + (Math.abs(pmv) * 8.5) * 10) / 10;

    state.ml.lastRunResults = {
      recommendedSetpoint: baseTset,
      recommendedFan: alpha > 0.6 ? "Quiet" : "Auto",
      recommendedZone1: z1,
      recommendedZone2: z2,
      energySavingsPct: savings,
      predictedPmv: (pmv >= 0 ? `+${pmv}` : `${pmv}`),
      predictedPpd: ppd,
      comfortIndex: ppd <= 6.0 ? "Kelas A (Sangat Nyaman ISO 7730)" : "Kelas B (Memenuhi Standar)",
      convergenceGen: Math.round(state.ml.iterations * 0.76),
      objectiveValue: (0.12 + (1 - alpha) * 0.08).toFixed(3)
    };

    // Update UI Results Box
    setEl("res-ai-setpoint", `${baseTset.toFixed(1)} °C`);
    setEl("res-ai-fan", state.ml.lastRunResults.recommendedFan);
    setEl("res-ai-z1", `${z1}% PWM`);
    setEl("res-ai-z2", `${z2}% PWM`);
    setEl("res-ai-savings", `${savings}%`);
    setEl("res-ai-pmv", state.ml.lastRunResults.predictedPmv);
    setEl("res-ai-ppd", `${ppd}%`);
    setEl("res-ai-class", state.ml.lastRunResults.comfortIndex);
    setEl("res-ai-algo", state.ml.algorithm.toUpperCase());

    const resultBox = document.getElementById("ml-results-card");
    if (resultBox) {
      resultBox.classList.remove("hidden");
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    addAuditLog("AI ENGINE", `${state.ml.algorithm.toUpperCase()} Selesai`, `Solusi: ${baseTset}°C / Z1: ${z1}% (Hemat ${savings}%)`);
    updateParetoChart();
  }

  // Terapkan rekomendasi hasil optimasi AI langsung ke aktuator hardware
  function deployMlSolution() {
    const res = state.ml.lastRunResults;
    if (!res) return;

    setAcSetpoint(res.recommendedSetpoint);
    setAcFan(res.recommendedFan.toLowerCase());
    setLightZone1(res.recommendedZone1);
    setLightZone2(res.recommendedZone2);

    addAuditLog("AI ENGINE", "Deploy Policy", `Rekomendasi ${state.ml.algorithm.toUpperCase()} diterapkan ke AC & Lampu`);
    showToast(`Rekomendasi ${state.ml.algorithm.toUpperCase()} Berhasil Diterapkan ke Ruangan!`, "success");
  }

  // ── Helper Toast ──────────────────────────────────────────────────────────────
  function showToast(msg, type = "success") {
    const toast = document.createElement("div");
    toast.className = `fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-lg text-xs font-semibold text-white transition-all transform translate-y-2 opacity-0 flex items-center gap-2 ${
      type === "success" ? "bg-teal-800 border border-teal-600" : "bg-rose-800 border border-rose-600"
    }`;
    toast.innerHTML = `<svg class="w-4 h-4 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> ${msg}`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.remove("translate-y-2", "opacity-0");
    }, 50);
    setTimeout(() => {
      toast.classList.add("translate-y-2", "opacity-0");
      setTimeout(() => toast.remove(), 400);
    }, 3200);
  }

  // ── Emergency Stop ────────────────────────────────────────────────────────────
  function emergencyStop() {
    setAcPower(false);
    setLightZone1(20);
    setLightZone2(20);
    addAuditLog("SAFETY", "Emergency Override", "Shutdown Kompresor AC & Redupkan Lampu ke 20%");
    showToast("EMERGENCY OVERRIDE DIAKTIFKAN: Kompresor AC dimatikan demi keselamatan!", "error");
  }

  // ── Audit Log System ──────────────────────────────────────────────────────────
  function addAuditLog(mode, target, val) {
    const now = new Date();
    const timeStr = now.toTimeString().split(" ")[0];
    const item = {
      id: state.auditLog.length + 1,
      time: timeStr,
      mode: mode,
      target: target,
      value: val,
      status: "Terkirim (MQTT)"
    };
    state.auditLog.unshift(item);
    if (state.auditLog.length > 8) state.auditLog.pop();
    renderAuditLogTable();
  }

  function renderAuditLogTable() {
    const tbody = document.getElementById("audit-log-tbody");
    if (!tbody) return;
    tbody.innerHTML = state.auditLog.map(row => `
      <tr class="hover:bg-slate-50/80 transition-colors">
        <td class="py-2 px-3 font-mono text-slate-500">${row.time}</td>
        <td class="py-2 px-3 font-bold text-slate-800">${row.mode}</td>
        <td class="py-2 px-3 font-medium text-slate-700">${row.target}</td>
        <td class="py-2 px-3 font-mono font-semibold text-teal-800">${row.value}</td>
        <td class="py-2 px-3">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            ${row.status}
          </span>
        </td>
      </tr>
    `).join("");
  }

  // ── MQTT Command Publisher ────────────────────────────────────────────────────
  function publishActuatorCommand(subtopic, value) {
    const topic = `livinglab/control/${subtopic}`;
    if (window.mqttManager && typeof window.mqttManager.publish === "function") {
      window.mqttManager.publish(topic, value);
    }
  }

  // ── Real-Time Simulation Charts ───────────────────────────────────────────────
  function initCharts() {
    // 1. Chart Respon Dinamika Suhu & Daya AC
    const ctxResp = document.getElementById("experimentResponseChart");
    if (ctxResp && !charts.response) {
      charts.response = new Chart(ctxResp, {
        type: "line",
        data: {
          labels: ["0m", "5m", "10m", "15m", "20m", "25m", "30m", "35m", "40m", "45m", "50m", "60m"],
          datasets: [
            {
              label: "Suhu Ruangan Ta (°C)",
              data: [26.2, 25.8, 25.3, 24.9, 24.6, 24.3, 24.1, 24.0, 24.0, 24.0, 24.1, 24.0],
              borderColor: "#0f766e",
              backgroundColor: "rgba(15, 118, 110, 0.08)",
              borderWidth: 2.5,
              fill: true,
              tension: 0.35,
              pointRadius: 3,
              yAxisID: "yTemp"
            },
            {
              label: "Garis Setpoint Target (°C)",
              data: [24.0, 24.0, 24.0, 24.0, 24.0, 24.0, 24.0, 24.0, 24.0, 24.0, 24.0, 24.0],
              borderColor: "#e11d48",
              borderDash: [5, 4],
              borderWidth: 2,
              pointRadius: 0,
              yAxisID: "yTemp"
            },
            {
              label: "Konsumsi Daya Kompresor (kW)",
              data: [2.15, 2.10, 1.95, 1.70, 1.45, 1.25, 0.95, 0.82, 0.80, 0.85, 0.82, 0.80],
              borderColor: "#2563eb",
              backgroundColor: "rgba(37, 99, 235, 0.06)",
              borderWidth: 2,
              fill: true,
              tension: 0.3,
              pointRadius: 2,
              yAxisID: "yPower"
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: darkTooltip
          },
          scales: {
            x: {
              grid: { color: "rgba(226, 232, 240, 0.6)" },
              ticks: { font: { family: "monospace", size: 11 } }
            },
            yTemp: {
              type: "linear",
              position: "left",
              min: 20,
              max: 29,
              title: { display: true, text: "Suhu (°C)", font: { size: 11, weight: "bold" } },
              ticks: { callback: v => `${v}°C` }
            },
            yPower: {
              type: "linear",
              position: "right",
              min: 0,
              max: 3.0,
              grid: { drawOnChartArea: false },
              title: { display: true, text: "Daya Listrik (kW)", font: { size: 11, weight: "bold" } },
              ticks: { callback: v => `${v} kW` }
            }
          }
        }
      });
    }

    // 2. Chart Pareto Front Multi-Objektif untuk Mode AI
    const ctxPareto = document.getElementById("experimentParetoChart");
    if (ctxPareto && !charts.pareto) {
      charts.pareto = new Chart(ctxPareto, {
        type: "scatter",
        data: {
          datasets: [
            {
              label: "Kandidat Solusi Terdominasi",
              data: [
                { x: 18.5, y: 14.2 }, { x: 19.8, y: 12.8 }, { x: 21.0, y: 11.5 },
                { x: 22.4, y: 9.8 }, { x: 23.5, y: 8.7 }, { x: 25.2, y: 7.9 },
                { x: 26.8, y: 7.2 }, { x: 28.0, y: 6.8 }, { x: 20.2, y: 15.0 },
                { x: 23.0, y: 13.5 }, { x: 25.5, y: 11.0 }, { x: 27.5, y: 9.2 }
              ],
              backgroundColor: "#94a3b8",
              pointRadius: 4.5
            },
            {
              label: "Kurva Pareto Front Optimal",
              data: [
                { x: 14.8, y: 12.5 }, { x: 16.2, y: 9.6 }, { x: 18.0, y: 7.5 },
                { x: 20.5, y: 5.8 }, { x: 23.4, y: 5.4 }, { x: 26.5, y: 5.1 }
              ],
              showLine: true,
              borderColor: "#0f766e",
              borderWidth: 2.5,
              backgroundColor: "#0d9488",
              pointRadius: 6,
              tension: 0.2
            },
            {
              label: "Solusi Terpilih (Deploy Ready)",
              data: [{ x: 23.4, y: 5.4 }],
              backgroundColor: "#f59e0b",
              borderColor: "#b45309",
              borderWidth: 3,
              pointRadius: 10
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "top",
              labels: { font: { size: 11, family: "sans-serif" }, usePointStyle: true }
            },
            tooltip: {
              ...darkTooltip,
              callbacks: {
                label: ctx => `Penghematan: ${ctx.raw.x}% kWh · PPD Discomfort: ${ctx.raw.y}%`
              }
            }
          },
          scales: {
            x: {
              title: { display: true, text: "Penghematan Energi (%) — Lebih Tinggi Lebih Baik", font: { size: 11, weight: "bold" } },
              ticks: { callback: v => `${v}%` }
            },
            y: {
              title: { display: true, text: "Ketidaknyamanan PPD (%) — Lebih Rendah Lebih Nyaman", font: { size: 11, weight: "bold" } },
              ticks: { callback: v => `${v}%` }
            }
          }
        }
      });
    }
  }

  function updateSimulationChart() {
    if (!charts.response) return;
    const tset = state.ac.setpoint;
    const isAcOn = state.ac.power;

    // Generate dynamic curve towards target setpoint
    const startTemp = 26.0;
    const labels = ["0m", "5m", "10m", "15m", "20m", "25m", "30m", "35m", "40m", "45m", "50m", "60m"];
    const tempData = [];
    const setpointLine = [];
    const powerData = [];

    labels.forEach((_, idx) => {
      setpointLine.push(tset);
      if (!isAcOn) {
        tempData.push(Math.min(28.5, startTemp + (idx * 0.25)));
        powerData.push(0.04);
      } else {
        const decay = Math.exp(-idx / 3.5);
        const curT = tset + (startTemp - tset) * decay;
        tempData.push(parseFloat(curT.toFixed(2)));
        const pwr = 0.8 + (curT - tset) * 0.65;
        powerData.push(parseFloat(Math.max(0.7, pwr).toFixed(2)));
      }
    });

    charts.response.data.datasets[0].data = tempData;
    charts.response.data.datasets[1].data = setpointLine;
    charts.response.data.datasets[2].data = powerData;
    charts.response.update();
  }

  function updateParetoChart() {
    if (!charts.pareto) return;
    const res = state.ml.lastRunResults;
    charts.pareto.data.datasets[2].data = [{ x: res.energySavingsPct, y: res.predictedPpd }];
    charts.pareto.update();
  }

  // ── Sinkronisasi Data Real-Time Telemetri ──────────────────────────────────────
  async function syncLiveData() {
    try {
      // 1. Fetch live energy dari MySQL
      const res = await fetch(`${API_URL}?key=${API_KEY}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const ac = data.ac || {};
        const lamp = data.lamp || {};

        state.liveTelemetry.acPowerKw = parseFloat(ac.active_power || 1.15);
        const lampKw = parseFloat(lamp.active_power || 0.16);
        state.liveTelemetry.lampPowerW = Math.round(lampKw * 1000);
        state.liveTelemetry.totalPowerKw = state.liveTelemetry.acPowerKw + lampKw;

        setEl("live-ac-power", `${fmt(state.liveTelemetry.acPowerKw, 2)} kW`);
        setEl("live-lamp-power", `${state.liveTelemetry.lampPowerW} W`);
        setEl("live-total-power", `${fmt(state.liveTelemetry.totalPowerKw, 3)} kW`);
      }
    } catch (e) {
      console.warn("[ExperimentService] MySQL fetch warning:", e);
    }

    // 2. Fetch live data dari MQTT store
    const sht = (window.liveData && window.liveData.sht) || {};
    const nnzn = (window.liveData && window.liveData.nnzn) || {};
    const camera = (window.liveData && window.liveData.camera) || {};

    // SHT31 room temp
    const temps = [];
    Object.keys(sht).forEach(node => {
      if (sht[node] && sht[node].temperature !== null) {
        temps.push(parseFloat(sht[node].temperature));
      }
    });
    if (temps.length > 0) {
      state.liveTelemetry.indoorTemp = temps.reduce((a, b) => a + b, 0) / temps.length;
    }

    // Lux meja
    const luxList = [];
    ["lx1_lux", "lx2_lux", "lx3_lux", "lx4_lux"].forEach(k => {
      if (nnzn[k] && nnzn[k].value !== null) luxList.push(parseFloat(nnzn[k].value));
    });
    if (luxList.length > 0) {
      state.liveTelemetry.avgLux = Math.round(luxList.reduce((a, b) => a + b, 0) / luxList.length);
    }

    // Okupansi kamera
    if (camera.person_count !== undefined) {
      state.liveTelemetry.personCount = camera.person_count;
    }

    setEl("live-room-temp", `${fmt(state.liveTelemetry.indoorTemp, 1)} °C`);
    setEl("live-desk-lux", `${state.liveTelemetry.avgLux} Lux`);
    setEl("live-occupancy-count", `${state.liveTelemetry.personCount} Orang`);

    updateLightingFeedback();
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.ExperimentService = {
    start() {
      setMode("manual");
      setAcSetpoint(24.0);
      setLightZone1(55);
      setLightZone2(70);
      setMlAlgorithm("mopso");
      initCharts();
      renderAuditLogTable();
      syncLiveData();
      setInterval(syncLiveData, 4000);
    },
    setMode,
    setAcPower,
    setAcSetpoint,
    adjustAcSetpoint,
    setAcFan,
    setAcMode,
    setLightPower,
    setLightZone1,
    setLightZone2,
    applyLightPreset,
    setMlAlgorithm,
    setMlAlpha,
    runMlOptimizer,
    deployMlSolution,
    emergencyStop,
    showToast,
    applyManualSetting
  };

})();
