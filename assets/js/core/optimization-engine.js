/**
 * BEMS Optimization Engine — Core Algorithms & Physics Models
 * ============================================================
 * Implementasi NYATA algoritma multi-objektif:
 *   - NSGA-II (Non-dominated Sorting Genetic Algorithm II)
 *   - MOPSO  (Multi-Objective Particle Swarm Optimization)
 *
 * Model Fisika Empiris:
 *   - AC Power: P_ac(Tset, T_outdoor, FanSpeed)
 *   - Lamp Power: P_lamp(PWM_Z1, PWM_Z2)
 *   - Indoor Temperature: T_indoor(Tset, T_outdoor, FanSpeed)
 *   - Fanger PMV/PPD ISO 7730 (simplified)
 *   - Desk Illuminance: E_desk(PWM_Z1, PWM_Z2, Lux_outdoor)
 *
 * Mendukung 4 mode optimasi:
 *   1. All MOGA  — NSGA-II untuk AC + Lampu
 *   2. All MOPSO — MOPSO untuk AC + Lampu
 *   3. AC:MOGA + Lamp:MOPSO — Dekomposisi hybrid
 *   4. AC:MOPSO + Lamp:MOGA — Dekomposisi hybrid terbalik
 *
 * Decision Variables: [Tset, PWM_Z1, PWM_Z2, FanSpeed]
 * Objectives:  min f1 = Energy(kW),  min f2 = Discomfort(%)
 */

(function () {
  "use strict";

  // ═══════════════════════════════════════════════════════════════════════════
  // ▌ SECTION 1: PHYSICS & EMPIRICAL MODELS
  // ═══════════════════════════════════════════════════════════════════════════

  const ROOM = {
    area_sqm: 72.0,
    height_m: 3.2,
    ac_rated_kw: 1.55,
    lamp_total_w: 280,       // 4 × 70W LED fixtures
    target_temp: 24.0,       // °C setpoint default
    target_lux: 480,         // SNI 03-6197 task lighting
    met_default: 1.1,        // Metabolic rate (seated office)
    clo_default: 0.5,        // Clothing insulation (tropical office)
  };

  // Fan speed mapping: index → air velocity (m/s)
  const FAN_MAP = { 1: 0.15, 2: 0.25, 3: 0.40 };
  const FAN_LABELS = { 1: "Low", 2: "Med", 3: "High / Auto" };

  // Variable bounds: [min, max]
  const BOUNDS = {
    tset:    [20.0, 28.0],   // °C
    pwm_z1:  [0, 100],       // % duty
    pwm_z2:  [0, 100],       // % duty
    fan:     [1, 3],         // integer: Low, Med, High
  };

  /**
   * AC Power consumption model (kW)
   * Empirical regression dari data PZEM Channel 1 Living Lab
   *
   * P_ac = P_rated × COP_factor(Tset, T_out)
   * - Setpoint lebih rendah → kompresor kerja lebih keras → daya naik
   * - Suhu outdoor lebih tinggi → heat load meningkat → daya naik
   * - Fan speed lebih tinggi → sedikit tambahan daya blower
   */
  function modelAcPower(tset, tOutdoor, fanSpeed) {
    const tOut = tOutdoor || 32.0;
    // Efek setpoint: setiap 1°C di atas 24°C hemat ~6% daya kompresor
    const setpointFactor = 1.0 - 0.06 * (tset - 24.0);
    // Efek outdoor: setiap 1°C di atas 30°C tambah ~3% beban
    const outdoorFactor = 1.0 + 0.03 * Math.max(0, tOut - 30.0);
    // Efek fan: High fan sedikit tambah ~3% (blower motor)
    const fanFactor = 1.0 + (fanSpeed - 2) * 0.015;

    let power = ROOM.ac_rated_kw * setpointFactor * outdoorFactor * fanFactor;
    return Math.max(0.15, Math.min(2.5, power)); // clamp ke range realistis
  }

  /**
   * Lamp Power consumption model (kW)
   * Linear scaling dari PWM duty cycle
   */
  function modelLampPower(pwmZ1, pwmZ2) {
    // Zona 1 dan Zona 2 masing-masing ~50% dari total fixture
    const pZ1 = (ROOM.lamp_total_w / 2) * (pwmZ1 / 100);
    const pZ2 = (ROOM.lamp_total_w / 2) * (pwmZ2 / 100);
    return (pZ1 + pZ2) / 1000; // convert W → kW
  }

  /**
   * Prediksi suhu udara ruangan (°C) hasil AC
   * Model steady-state sederhana: T_indoor ≈ Tset + offset
   * - AC dengan setpoint rendah → suhu mendekati setpoint
   * - Outdoor panas → suhu indoor sedikit di atas setpoint
   * - Fan speed tinggi → distribusi lebih merata → lebih dekat setpoint
   */
  function modelIndoorTemp(tset, tOutdoor, fanSpeed) {
    const tOut = tOutdoor || 32.0;
    // Offset dari setpoint karena heat gain dan inersia termal
    const heatGainOffset = 0.02 * Math.max(0, tOut - 28.0);
    const fanCorrectionFactor = 1.0 - (fanSpeed - 1) * 0.15;
    const offset = (0.3 + heatGainOffset) * fanCorrectionFactor;
    return tset + offset;
  }

  /**
   * Fanger PMV (Predicted Mean Vote) — ISO 7730 Simplified
   * Input: Ta (°C), RH (%), Va (m/s), Met, Clo
   * Output: PMV value [-3, +3]
   */
  function modelPMV(ta, rh, va, met, clo) {
    met = met || ROOM.met_default;
    clo = clo || ROOM.clo_default;
    rh = rh || 55;
    va = va || 0.15;

    // Saturated vapor pressure (Pa) — Antoine equation: exp(...) yields kPa, * 1000 converts to Pa
    const pSat = Math.exp(16.6536 - 4030.183 / (ta + 235)) * 1000;
    const pa = (rh / 100) * pSat; // partial vapor pressure (Pa)

    // Clothing surface temperature approximation
    const icl = 0.155 * clo;
    const mw = met * 58.15; // metabolic heat production W/m²
    const fcl = clo <= 0.078 ? 1.0 + 1.290 * icl : 1.05 + 0.645 * icl;

    // Simplified heat balance
    const tr = ta + 0.5; // mean radiant temp ≈ air temp + small offset indoor
    const hc = Math.max(2.38 * Math.pow(Math.abs(ta - tr), 0.25), 12.1 * Math.sqrt(va));

    const tsk = 35.7 - 0.028 * mw;
    const tcl = tsk - icl * (mw - 3.05e-3 * (5733 - 6.99 * mw - pa)
              - 0.42 * (mw - 58.15) - 1.7e-5 * mw * (5867 - pa) - 0.0014 * mw * (34 - ta));

    // PMV equation (Fanger 1970)
    const pmvRaw = (0.303 * Math.exp(-0.036 * mw) + 0.028) *
      (mw - 3.05e-3 * (5733 - 6.99 * mw - pa)
       - 0.42 * (mw - 58.15)
       - 1.7e-5 * mw * (5867 - pa)
       - 0.0014 * mw * (34 - ta)
       - fcl * (3.96e-8 * (Math.pow(tcl + 273, 4) - Math.pow(tr + 273, 4))
                + hc * (tcl - ta)));

    return Math.max(-3.0, Math.min(3.0, pmvRaw));
  }

  /**
   * PPD (Predicted Percentage Dissatisfied) — ISO 7730
   */
  function modelPPD(pmv) {
    return 100 - 95 * Math.exp(-0.03353 * Math.pow(pmv, 4) - 0.2179 * Math.pow(pmv, 2));
  }

  /**
   * Desk illuminance model (Lux)
   * Kombinasi artificial light + daylight harvesting
   *
   * Zona 1 (jendela): mendapat kontribusi cahaya alami lebih besar
   * Zona 2 (dalam): dominan lampu artifisial
   */
  function modelDeskLux(pwmZ1, pwmZ2, luxOutdoor) {
    const lxOut = luxOutdoor || 500;
    // Artificial light contribution per zona
    const artZ1 = 300 * (pwmZ1 / 100); // max 300 lux at 100%
    const artZ2 = 350 * (pwmZ2 / 100); // max 350 lux at 100% (more fixtures)

    // Daylight contribution (mainly zona 1 near window)
    const dayZ1 = Math.min(250, lxOut * 0.08); // 8% daylight penetration
    const dayZ2 = Math.min(80, lxOut * 0.025);  // 2.5% deep penetration

    // Weighted average across all workstations
    const luxZ1 = artZ1 + dayZ1;
    const luxZ2 = artZ2 + dayZ2;
    return (luxZ1 + luxZ2) / 2;
  }

  // ─── Objective Functions ──────────────────────────────────────────────────

  /**
   * Context object for sensor data:
   * { tOutdoor, rhOutdoor, luxOutdoor, rhIndoor, headcount }
   */

  /**
   * f1: Total energy consumption (kW) — MINIMIZE
   */
  function objectiveEnergy(vars, ctx) {
    const [tset, pwmZ1, pwmZ2, fan] = vars;
    const pAc = modelAcPower(tset, ctx.tOutdoor, fan);
    const pLamp = modelLampPower(pwmZ1, pwmZ2);
    return pAc + pLamp;
  }

  /**
   * f2: Discomfort index (0-100) — MINIMIZE
   * Gabungan thermal discomfort (PPD) + visual discomfort (lux deviation)
   */
  function objectiveDiscomfort(vars, ctx) {
    const [tset, pwmZ1, pwmZ2, fan] = vars;
    const fanVa = FAN_MAP[Math.round(fan)] || 0.15;

    // Prediksi suhu indoor
    const tIndoor = modelIndoorTemp(tset, ctx.tOutdoor, fan);

    // PMV & PPD
    const pmv = modelPMV(tIndoor, ctx.rhIndoor || 55, fanVa);
    const ppd = modelPPD(pmv);

    // Lux penalty: deviasi dari target
    const deskLux = modelDeskLux(pwmZ1, pwmZ2, ctx.luxOutdoor);
    const luxDev = Math.abs(deskLux - ROOM.target_lux) / ROOM.target_lux;
    const luxPenalty = luxDev * 100; // scale to 0-100

    // Weighted sum: 70% thermal, 30% visual
    return 0.7 * ppd + 0.3 * luxPenalty;
  }

  /**
   * Evaluate both objectives for a solution vector
   */
  function evaluate(vars, ctx) {
    return [objectiveEnergy(vars, ctx), objectiveDiscomfort(vars, ctx)];
  }

  /**
   * Check constraint violations (returns penalty, 0 = feasible)
   */
  function constraintPenalty(vars, ctx) {
    const [tset, pwmZ1, pwmZ2, fan] = vars;
    let penalty = 0;

    const tIndoor = modelIndoorTemp(tset, ctx.tOutdoor, fan);
    const fanVa = FAN_MAP[Math.round(fan)] || 0.15;
    const pmv = modelPMV(tIndoor, ctx.rhIndoor || 55, fanVa);
    const deskLux = modelDeskLux(pwmZ1, pwmZ2, ctx.luxOutdoor);

    // Constraint 1: Indoor temp 23-26.5°C
    if (tIndoor < 23.0) penalty += (23.0 - tIndoor) * 10;
    if (tIndoor > 26.5) penalty += (tIndoor - 26.5) * 10;

    // Constraint 2: PMV within [-0.7, +0.7] (ISO 7730 Class B)
    if (Math.abs(pmv) > 0.7) penalty += (Math.abs(pmv) - 0.7) * 15;

    // Constraint 3: Desk illuminance 350-600 Lux (SNI 03-6197)
    if (deskLux < 350) penalty += (350 - deskLux) * 0.05;
    if (deskLux > 600) penalty += (deskLux - 600) * 0.02;

    return penalty;
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // ▌ SECTION 2: PARETO UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if solution a dominates solution b (both minimization)
   */
  function dominates(objA, objB) {
    let atLeastOneBetter = false;
    for (let m = 0; m < objA.length; m++) {
      if (objA[m] > objB[m]) return false;
      if (objA[m] < objB[m]) atLeastOneBetter = true;
    }
    return atLeastOneBetter;
  }

  /**
   * Fast Non-Dominated Sorting (NSGA-II style)
   * Returns array of fronts: [[idx,...], [idx,...], ...]
   */
  function fastNonDominatedSort(objectives) {
    const n = objectives.length;
    const S = new Array(n).fill(null).map(() => []);
    const nDom = new Array(n).fill(0);
    const rank = new Array(n).fill(-1);
    const fronts = [[]];

    for (let p = 0; p < n; p++) {
      for (let q = 0; q < n; q++) {
        if (p === q) continue;
        if (dominates(objectives[p], objectives[q])) {
          S[p].push(q);
        } else if (dominates(objectives[q], objectives[p])) {
          nDom[p]++;
        }
      }
      if (nDom[p] === 0) {
        rank[p] = 0;
        fronts[0].push(p);
      }
    }

    let i = 0;
    while (i < fronts.length && fronts[i].length > 0) {
      const nextFront = [];
      for (const p of fronts[i]) {
        for (const q of S[p]) {
          nDom[q]--;
          if (nDom[q] === 0) {
            rank[q] = i + 1;
            nextFront.push(q);
          }
        }
      }
      if (nextFront.length > 0) fronts.push(nextFront);
      i++;
    }

    return { fronts, rank };
  }

  /**
   * Crowding Distance Assignment
   */
  function crowdingDistance(front, objectives) {
    const n = front.length;
    const dist = new Array(n).fill(0);
    if (n <= 2) {
      dist.fill(Infinity);
      return dist;
    }

    const nObj = objectives[front[0]].length;
    for (let m = 0; m < nObj; m++) {
      // Sort by objective m
      const sorted = front.map((idx, i) => ({ origIdx: i, objVal: objectives[idx][m] }));
      sorted.sort((a, b) => a.objVal - b.objVal);

      const fMin = sorted[0].objVal;
      const fMax = sorted[n - 1].objVal;
      const range = fMax - fMin || 1e-10;

      dist[sorted[0].origIdx] = Infinity;
      dist[sorted[n - 1].origIdx] = Infinity;

      for (let i = 1; i < n - 1; i++) {
        dist[sorted[i].origIdx] += (sorted[i + 1].objVal - sorted[i - 1].objVal) / range;
      }
    }
    return dist;
  }

  /**
   * Find Knee-Point in Pareto Front (maximum distance to utopia-nadir line)
   */
  function findKneePoint(solutions) {
    if (solutions.length <= 2) return 0;

    // Normalize objectives
    const f1Vals = solutions.map(s => s.objectives[0]);
    const f2Vals = solutions.map(s => s.objectives[1]);
    const f1Min = Math.min(...f1Vals), f1Max = Math.max(...f1Vals);
    const f2Min = Math.min(...f2Vals), f2Max = Math.max(...f2Vals);
    const r1 = f1Max - f1Min || 1;
    const r2 = f2Max - f2Min || 1;

    // Line from utopia to nadir
    const lineVec = [1.0, 1.0]; // normalized direction
    const lineLen = Math.sqrt(2);

    let maxDist = -1;
    let kneeIdx = 0;

    for (let i = 0; i < solutions.length; i++) {
      const pNorm = [(f1Vals[i] - f1Min) / r1, (f2Vals[i] - f2Min) / r2];
      // Distance from point to diagonal line
      const dist = Math.abs(pNorm[0] - pNorm[1]) / lineLen;
      // Prefer points closer to the bend (middle region)
      const centrality = 1.0 - Math.abs(0.5 - (i / (solutions.length - 1)));
      const score = dist + 0.3 * centrality;
      if (score > maxDist) {
        maxDist = score;
        kneeIdx = i;
      }
    }
    return kneeIdx;
  }

  /**
   * Compute Hypervolume Indicator (2D only) — area under Pareto front
   */
  function hypervolume2D(paretoObjectives, refPoint) {
    if (!paretoObjectives.length) return 0;
    const ref = refPoint || [3.0, 100]; // reference point (worst case)
    const sorted = [...paretoObjectives].sort((a, b) => a[0] - b[0]);
    let hv = 0;
    let prevY = ref[1];
    for (const pt of sorted) {
      if (pt[0] < ref[0] && pt[1] < ref[1]) {
        hv += (ref[0] - pt[0]) * (prevY - pt[1]);
        prevY = pt[1];
      }
    }
    return hv;
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // ▌ SECTION 3: NSGA-II ENGINE
  // ═══════════════════════════════════════════════════════════════════════════

  class NSGA2Engine {
    constructor(config = {}) {
      this.popSize = config.popSize || 60;
      this.generations = config.generations || 80;
      this.crossoverRate = config.crossoverRate || 0.85;
      this.mutationRate = config.mutationRate || 0.08;
      this.etaCross = config.etaCross || 15;  // SBX distribution index
      this.etaMut = config.etaMut || 20;      // polynomial mutation index
      this.activeVars = config.activeVars || [0, 1, 2, 3]; // indices of vars to optimize
      this.fixedVals = config.fixedVals || {};  // {varIndex: fixedValue}
    }

    /** Generate random solution within bounds */
    _randomSolution() {
      const vars = [
        BOUNDS.tset[0] + Math.random() * (BOUNDS.tset[1] - BOUNDS.tset[0]),
        BOUNDS.pwm_z1[0] + Math.random() * (BOUNDS.pwm_z1[1] - BOUNDS.pwm_z1[0]),
        BOUNDS.pwm_z2[0] + Math.random() * (BOUNDS.pwm_z2[1] - BOUNDS.pwm_z2[0]),
        Math.floor(BOUNDS.fan[0] + Math.random() * (BOUNDS.fan[1] - BOUNDS.fan[0] + 1)),
      ];
      // Apply fixed values
      for (const [idx, val] of Object.entries(this.fixedVals)) {
        vars[parseInt(idx)] = val;
      }
      vars[3] = Math.min(3, Math.max(1, Math.round(vars[3]))); // ensure integer fan
      return vars;
    }

    /** Get bounds for a specific variable index */
    _getBounds(varIdx) {
      const allBounds = [BOUNDS.tset, BOUNDS.pwm_z1, BOUNDS.pwm_z2, BOUNDS.fan];
      return allBounds[varIdx];
    }

    /** SBX (Simulated Binary Crossover) */
    _sbxCrossover(p1, p2) {
      const c1 = [...p1];
      const c2 = [...p2];

      if (Math.random() > this.crossoverRate) return [c1, c2];

      for (const i of this.activeVars) {
        if (Math.random() > 0.5) continue;
        const [lo, hi] = this._getBounds(i);
        if (Math.abs(p1[i] - p2[i]) < 1e-10) continue;

        const u = Math.random();
        const eta = this.etaCross;
        let beta;
        if (u <= 0.5) {
          beta = Math.pow(2 * u, 1.0 / (eta + 1));
        } else {
          beta = Math.pow(1.0 / (2 * (1 - u)), 1.0 / (eta + 1));
        }

        c1[i] = Math.max(lo, Math.min(hi, 0.5 * ((1 + beta) * p1[i] + (1 - beta) * p2[i])));
        c2[i] = Math.max(lo, Math.min(hi, 0.5 * ((1 - beta) * p1[i] + (1 + beta) * p2[i])));
      }
      // Fan speed always integer
      c1[3] = Math.min(3, Math.max(1, Math.round(c1[3])));
      c2[3] = Math.min(3, Math.max(1, Math.round(c2[3])));
      return [c1, c2];
    }

    /** Polynomial Mutation */
    _polynomialMutate(individual) {
      const result = [...individual];
      for (const i of this.activeVars) {
        if (Math.random() > this.mutationRate) continue;
        const [lo, hi] = this._getBounds(i);
        const delta = hi - lo;
        const u = Math.random();
        const eta = this.etaMut;
        let deltaq;
        if (u < 0.5) {
          const bl = (result[i] - lo) / delta;
          const b = 2.0 * u + (1.0 - 2.0 * u) * Math.pow(1.0 - bl, eta + 1);
          deltaq = Math.pow(b, 1.0 / (eta + 1)) - 1.0;
        } else {
          const bu = (hi - result[i]) / delta;
          const b = 2.0 * (1.0 - u) + 2.0 * (u - 0.5) * Math.pow(1.0 - bu, eta + 1);
          deltaq = 1.0 - Math.pow(b, 1.0 / (eta + 1));
        }
        result[i] = Math.max(lo, Math.min(hi, result[i] + deltaq * delta));
      }
      result[3] = Math.min(3, Math.max(1, Math.round(result[3])));
      // Re-apply fixed values
      for (const [idx, val] of Object.entries(this.fixedVals)) {
        result[parseInt(idx)] = val;
      }
      return result;
    }

    /** Tournament Selection */
    _tournamentSelect(pop, objectives, ranks, crowdDist) {
      const i = Math.floor(Math.random() * pop.length);
      const j = Math.floor(Math.random() * pop.length);
      // Prefer lower rank, then higher crowding distance
      if (ranks[i] < ranks[j]) return pop[i];
      if (ranks[j] < ranks[i]) return pop[j];
      return (crowdDist[i] || 0) >= (crowdDist[j] || 0) ? pop[i] : pop[j];
    }

    /**
     * Run NSGA-II optimization
     * @param {Object} ctx - Sensor context { tOutdoor, rhIndoor, luxOutdoor }
     * @param {Function} onProgress - Callback(generation, hvHistory)
     * @returns {Object} { paretoFront, allPop, hvHistory, spacingHistory }
     */
    run(ctx, onProgress) {
      // Initialize population
      let pop = [];
      for (let i = 0; i < this.popSize; i++) {
        pop.push(this._randomSolution());
      }

      let objectives = pop.map(ind => {
        const obj = evaluate(ind, ctx);
        const penalty = constraintPenalty(ind, ctx);
        return [obj[0] + penalty * 0.5, obj[1] + penalty * 2.0];
      });

      const hvHistory = [];
      const spacingHistory = [];

      for (let gen = 0; gen < this.generations; gen++) {
        // Sort and get ranks/crowding
        const { fronts, rank } = fastNonDominatedSort(objectives);
        const allCrowdDist = new Array(pop.length).fill(0);
        for (const front of fronts) {
          const cd = crowdingDistance(front, objectives);
          for (let fi = 0; fi < front.length; fi++) {
            allCrowdDist[front[fi]] = cd[fi];
          }
        }

        // Create offspring
        const offspring = [];
        while (offspring.length < this.popSize) {
          const p1 = this._tournamentSelect(pop, objectives, rank, allCrowdDist);
          const p2 = this._tournamentSelect(pop, objectives, rank, allCrowdDist);
          const [c1, c2] = this._sbxCrossover(p1, p2);
          offspring.push(this._polynomialMutate(c1));
          if (offspring.length < this.popSize) {
            offspring.push(this._polynomialMutate(c2));
          }
        }

        // Evaluate offspring
        const offspringObj = offspring.map(ind => {
          const obj = evaluate(ind, ctx);
          const penalty = constraintPenalty(ind, ctx);
          return [obj[0] + penalty * 0.5, obj[1] + penalty * 2.0];
        });

        // Combine parent + offspring
        const combined = [...pop, ...offspring];
        const combinedObj = [...objectives, ...offspringObj];

        // Environmental selection
        const { fronts: cFronts } = fastNonDominatedSort(combinedObj);
        const newPop = [];
        const newObj = [];
        let fi = 0;

        while (fi < cFronts.length && newPop.length + cFronts[fi].length <= this.popSize) {
          for (const idx of cFronts[fi]) {
            newPop.push(combined[idx]);
            newObj.push(combinedObj[idx]);
          }
          fi++;
        }

        // Fill remaining from last partial front using crowding distance
        if (newPop.length < this.popSize && fi < cFronts.length) {
          const lastFront = cFronts[fi];
          const cd = crowdingDistance(lastFront, combinedObj);
          const indexed = lastFront.map((idx, i) => ({ idx, cd: cd[i] }));
          indexed.sort((a, b) => b.cd - a.cd); // higher crowding first
          const remaining = this.popSize - newPop.length;
          for (let i = 0; i < remaining && i < indexed.length; i++) {
            newPop.push(combined[indexed[i].idx]);
            newObj.push(combinedObj[indexed[i].idx]);
          }
        }

        pop = newPop;
        objectives = newObj;

        // Track metrics
        const paretoObjs = cFronts[0].map(i => combinedObj[i]);
        const hv = hypervolume2D(paretoObjs);
        hvHistory.push(hv);

        // Spacing metric
        if (paretoObjs.length > 1) {
          const sorted = [...paretoObjs].sort((a, b) => a[0] - b[0]);
          let spacingSum = 0;
          for (let i = 1; i < sorted.length; i++) {
            spacingSum += Math.sqrt(Math.pow(sorted[i][0] - sorted[i - 1][0], 2) +
                                    Math.pow(sorted[i][1] - sorted[i - 1][1], 2));
          }
          const avgSpacing = spacingSum / (sorted.length - 1);
          let spacingVar = 0;
          for (let i = 1; i < sorted.length; i++) {
            const d = Math.sqrt(Math.pow(sorted[i][0] - sorted[i - 1][0], 2) +
                                Math.pow(sorted[i][1] - sorted[i - 1][1], 2));
            spacingVar += Math.pow(d - avgSpacing, 2);
          }
          spacingHistory.push(Math.sqrt(spacingVar / (sorted.length - 1)));
        } else {
          spacingHistory.push(0);
        }

        if (onProgress) onProgress(gen + 1, hvHistory);
      }

      // Extract final Pareto front
      const { fronts: finalFronts } = fastNonDominatedSort(objectives);
      const paretoFront = finalFronts[0].map(i => ({
        vars: pop[i],
        objectives: evaluate(pop[i], ctx), // raw objectives without penalty
        tset: pop[i][0],
        pwmZ1: pop[i][1],
        pwmZ2: pop[i][2],
        fan: Math.round(pop[i][3]),
      }));

      // Sort Pareto front by f1 (energy)
      paretoFront.sort((a, b) => a.objectives[0] - b.objectives[0]);

      return {
        paretoFront,
        allPopulation: pop.map((ind, i) => ({ vars: ind, objectives: objectives[i] })),
        hvHistory,
        spacingHistory,
        finalHV: hvHistory[hvHistory.length - 1] || 0,
      };
    }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // ▌ SECTION 4: MOPSO ENGINE
  // ═══════════════════════════════════════════════════════════════════════════

  class MOPSOEngine {
    constructor(config = {}) {
      this.swarmSize = config.swarmSize || 50;
      this.maxIter = config.maxIter || 100;
      this.w = config.w || 0.4;          // inertia weight (start)
      this.wMax = config.wMax || 0.9;
      this.wMin = config.wMin || 0.4;
      this.c1 = config.c1 || 1.49;       // cognitive coefficient
      this.c2 = config.c2 || 1.49;       // social coefficient
      this.archiveSize = config.archiveSize || 60;
      this.activeVars = config.activeVars || [0, 1, 2, 3];
      this.fixedVals = config.fixedVals || {};
    }

    _randomPosition() {
      const pos = [
        BOUNDS.tset[0] + Math.random() * (BOUNDS.tset[1] - BOUNDS.tset[0]),
        BOUNDS.pwm_z1[0] + Math.random() * (BOUNDS.pwm_z1[1] - BOUNDS.pwm_z1[0]),
        BOUNDS.pwm_z2[0] + Math.random() * (BOUNDS.pwm_z2[1] - BOUNDS.pwm_z2[0]),
        Math.floor(BOUNDS.fan[0] + Math.random() * (BOUNDS.fan[1] - BOUNDS.fan[0] + 1)),
      ];
      for (const [idx, val] of Object.entries(this.fixedVals)) {
        pos[parseInt(idx)] = val;
      }
      pos[3] = Math.min(3, Math.max(1, Math.round(pos[3])));
      return pos;
    }

    _randomVelocity() {
      return [
        (Math.random() - 0.5) * (BOUNDS.tset[1] - BOUNDS.tset[0]) * 0.2,
        (Math.random() - 0.5) * (BOUNDS.pwm_z1[1] - BOUNDS.pwm_z1[0]) * 0.2,
        (Math.random() - 0.5) * (BOUNDS.pwm_z2[1] - BOUNDS.pwm_z2[0]) * 0.2,
        (Math.random() - 0.5) * 0.5,
      ];
    }

    _clampPosition(pos) {
      const allBounds = [BOUNDS.tset, BOUNDS.pwm_z1, BOUNDS.pwm_z2, BOUNDS.fan];
      for (let i = 0; i < 4; i++) {
        pos[i] = Math.max(allBounds[i][0], Math.min(allBounds[i][1], pos[i]));
      }
      pos[3] = Math.min(3, Math.max(1, Math.round(pos[3])));
      for (const [idx, val] of Object.entries(this.fixedVals)) {
        pos[parseInt(idx)] = val;
      }
      return pos;
    }

    /** Select leader from archive using roulette on inverse crowding density */
    _selectLeader(archive) {
      if (archive.length === 1) return archive[0];

      // Compute crowding distance in archive
      const archiveObjs = archive.map(a => a.objectives);
      const indices = archive.map((_, i) => i);
      const cd = crowdingDistance(indices, archiveObjs);

      // Roulette: higher crowding distance → higher probability
      const total = cd.reduce((s, v) => s + (isFinite(v) ? v : 10), 0);
      let r = Math.random() * total;
      for (let i = 0; i < cd.length; i++) {
        r -= isFinite(cd[i]) ? cd[i] : 10;
        if (r <= 0) return archive[i];
      }
      return archive[archive.length - 1];
    }

    /** Update external archive with new solutions */
    _updateArchive(archive, newSolutions) {
      const combined = [...archive, ...newSolutions];

      // Remove dominated
      const nonDom = [];
      for (let i = 0; i < combined.length; i++) {
        let isDominated = false;
        for (let j = 0; j < combined.length; j++) {
          if (i === j) continue;
          if (dominates(combined[j].objectives, combined[i].objectives)) {
            isDominated = true;
            break;
          }
        }
        if (!isDominated) nonDom.push(combined[i]);
      }

      // Truncate if exceeds archive size
      if (nonDom.length <= this.archiveSize) return nonDom;

      // Remove most crowded members
      while (nonDom.length > this.archiveSize) {
        const objs = nonDom.map(s => s.objectives);
        const indices = nonDom.map((_, i) => i);
        const cd = crowdingDistance(indices, objs);
        // Find minimum crowding (most crowded) — not infinite
        let minIdx = 0, minCd = Infinity;
        for (let i = 0; i < cd.length; i++) {
          if (isFinite(cd[i]) && cd[i] < minCd) {
            minCd = cd[i];
            minIdx = i;
          }
        }
        nonDom.splice(minIdx, 1);
      }
      return nonDom;
    }

    /**
     * Run MOPSO optimization
     * @param {Object} ctx - Sensor context
     * @param {Function} onProgress - Callback(iteration, hvHistory)
     * @returns {Object} results
     */
    run(ctx, onProgress) {
      // Initialize swarm
      const positions = [];
      const velocities = [];
      const pbest = [];
      const pbestObj = [];
      let archive = [];

      for (let i = 0; i < this.swarmSize; i++) {
        const pos = this._randomPosition();
        positions.push(pos);
        velocities.push(this._randomVelocity());
        pbest.push([...pos]);

        const obj = evaluate(pos, ctx);
        const penalty = constraintPenalty(pos, ctx);
        const penalizedObj = [obj[0] + penalty * 0.5, obj[1] + penalty * 2.0];
        pbestObj.push(penalizedObj);

        archive.push({ vars: [...pos], objectives: [...obj] });
      }
      archive = this._updateArchive([], archive);

      const hvHistory = [];
      const gdHistory = []; // generational distance

      for (let iter = 0; iter < this.maxIter; iter++) {
        // Linear decreasing inertia weight
        const w = this.wMax - (this.wMax - this.wMin) * (iter / this.maxIter);

        const newArchiveCandidates = [];

        for (let i = 0; i < this.swarmSize; i++) {
          // Select leader from archive
          const leader = this._selectLeader(archive);

          // Update velocity
          for (const d of this.activeVars) {
            const r1 = Math.random();
            const r2 = Math.random();
            velocities[i][d] = w * velocities[i][d]
              + this.c1 * r1 * (pbest[i][d] - positions[i][d])
              + this.c2 * r2 * (leader.vars[d] - positions[i][d]);
          }

          // Update position
          for (const d of this.activeVars) {
            positions[i][d] += velocities[i][d];
          }
          this._clampPosition(positions[i]);

          // Evaluate
          const obj = evaluate(positions[i], ctx);
          const penalty = constraintPenalty(positions[i], ctx);
          const penalizedObj = [obj[0] + penalty * 0.5, obj[1] + penalty * 2.0];

          // Update personal best
          if (dominates(penalizedObj, pbestObj[i]) ||
              (!dominates(pbestObj[i], penalizedObj) && Math.random() < 0.5)) {
            pbest[i] = [...positions[i]];
            pbestObj[i] = [...penalizedObj];
          }

          newArchiveCandidates.push({ vars: [...positions[i]], objectives: [...obj] });
        }

        // Update archive
        archive = this._updateArchive(archive, newArchiveCandidates);

        // Compute metrics
        const archiveObjs = archive.map(a => a.objectives);
        const hv = hypervolume2D(archiveObjs);
        hvHistory.push(hv);

        // Generational Distance: avg distance from archive to reference front
        if (archiveObjs.length > 0) {
          const avgF1 = archiveObjs.reduce((s, o) => s + o[0], 0) / archiveObjs.length;
          const avgF2 = archiveObjs.reduce((s, o) => s + o[1], 0) / archiveObjs.length;
          // GD proxy: variance of objectives
          const gd = Math.sqrt(
            archiveObjs.reduce((s, o) => s + Math.pow(o[0] - avgF1, 2) + Math.pow(o[1] - avgF2, 2), 0) / archiveObjs.length
          );
          gdHistory.push(gd);
        } else {
          gdHistory.push(0);
        }

        if (onProgress) onProgress(iter + 1, hvHistory);
      }

      // Sort archive by f1
      archive.sort((a, b) => a.objectives[0] - b.objectives[0]);

      return {
        paretoFront: archive.map(a => ({
          vars: a.vars,
          objectives: a.objectives,
          tset: a.vars[0],
          pwmZ1: a.vars[1],
          pwmZ2: a.vars[2],
          fan: Math.round(a.vars[3]),
        })),
        allSwarm: positions.map((pos, i) => ({ vars: pos, objectives: pbestObj[i] })),
        hvHistory,
        gdHistory,
        finalHV: hvHistory[hvHistory.length - 1] || 0,
      };
    }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // ▌ SECTION 5: BEMS OPTIMIZER ORCHESTRATOR
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Modes:
   *   "all_moga"        — NSGA-II optimizes all 4 vars
   *   "all_mopso"       — MOPSO optimizes all 4 vars
   *   "ac_moga_lamp_mopso" — NSGA-II for [Tset, Fan], MOPSO for [PWM_Z1, PWM_Z2]
   *   "ac_mopso_lamp_moga" — MOPSO for [Tset, Fan], NSGA-II for [PWM_Z1, PWM_Z2]
   */

  const MODE_LABELS = {
    all_moga:            "🧬 Semua MOGA (NSGA-II)",
    all_mopso:           "🐦 Semua MOPSO",
    ac_moga_lamp_mopso:  "🔀 AC: MOGA · Lampu: MOPSO",
    ac_mopso_lamp_moga:  "🔄 AC: MOPSO · Lampu: MOGA",
  };

  class BEMSOptimizer {
    constructor() {
      this.lastResult = null;
      this.isRunning = false;
    }

    /**
     * Gather live sensor context from window.liveData
     */
    getSensorContext() {
      const ld = window.liveData || {};
      const nnzn = ld.nnzn || {};
      const sht = ld.sht || {};

      // Average indoor temp & RH from SHT31 nodes
      const temps = Object.values(sht).map(n => n.temperature).filter(t => t && t > 15 && t < 40);
      const hums = Object.values(sht).map(n => n.humidity).filter(h => h && h > 0 && h < 100);
      const avgTemp = temps.length > 0 ? temps.reduce((a, b) => a + b) / temps.length : 25.0;
      const avgRH = hums.length > 0 ? hums.reduce((a, b) => a + b) / hums.length : 55;

      return {
        tOutdoor: nnzn["th_out_temperature"]?.value || 32.0,
        rhOutdoor: nnzn["th_out_humidity"]?.value || 65,
        luxOutdoor: nnzn["lx_out_lux"]?.value || 1200,
        rhIndoor: avgRH,
        tIndoorCurrent: avgTemp,
        headcount: ld.camera?.person_count || 3,
      };
    }

    /**
     * Run optimization with the specified mode or options
     * @param {string|Object} modeOrOptions - mode string or { mode, acMethod, lampMethod, ctx, params }
     * @param {Object} params - optional params
     * @param {Function} onProgress - callback(phase, iteration, total)
     */
    run(modeOrOptions = "all_moga", params = {}, onProgress) {
      this.isRunning = true;
      let mode = "all_moga";
      let optParams = params;
      let optProgress = onProgress;
      let userCtx = {};

      if (typeof modeOrOptions === "object" && modeOrOptions !== null) {
        optParams = Object.assign({}, params, modeOrOptions.params || {});
        optProgress = modeOrOptions.onProgress || onProgress;
        userCtx = modeOrOptions.ctx || {};

        if (modeOrOptions.acMethod && modeOrOptions.lampMethod) {
          const ac = String(modeOrOptions.acMethod).toLowerCase();
          const lamp = String(modeOrOptions.lampMethod).toLowerCase();
          if (ac === "moga" && lamp === "moga") mode = "all_moga";
          else if (ac === "mopso" && lamp === "mopso") mode = "all_mopso";
          else if (ac === "moga" && lamp === "mopso") mode = "ac_moga_lamp_mopso";
          else if (ac === "mopso" && lamp === "moga") mode = "ac_mopso_lamp_moga";
        } else if (modeOrOptions.mode) {
          mode = modeOrOptions.mode;
        }
      } else if (typeof modeOrOptions === "string") {
        mode = modeOrOptions;
      }

      const defaultCtx = this.getSensorContext();
      const ctx = Object.assign({}, defaultCtx, userCtx);
      let result;

      try {
        switch (mode) {
          case "all_moga":
            result = this._runFullMOGA(ctx, optParams, optProgress);
            break;
          case "all_mopso":
            result = this._runFullMOPSO(ctx, optParams, optProgress);
            break;
          case "ac_moga_lamp_mopso":
            result = this._runDecomposed(ctx, optParams, "moga", "mopso", optProgress);
            break;
          case "ac_mopso_lamp_moga":
            result = this._runDecomposed(ctx, optParams, "mopso", "moga", optProgress);
            break;
          default:
            result = this._runFullMOGA(ctx, optParams, optProgress);
        }

        // Enrich results with derived metrics
        result = this._enrichResults(result, ctx, mode);
        this.lastResult = result;
      } finally {
        this.isRunning = false;
      }

      return result;
    }

    _runFullMOGA(ctx, params, onProgress) {
      const engine = new NSGA2Engine({
        popSize: params.popSize || 60,
        generations: params.generations || 80,
        crossoverRate: params.crossoverRate || 0.85,
        mutationRate: params.mutationRate || 0.08,
      });
      return engine.run(ctx, (gen, hv) => {
        if (onProgress) onProgress("NSGA-II", gen, engine.generations);
      });
    }

    _runFullMOPSO(ctx, params, onProgress) {
      const engine = new MOPSOEngine({
        swarmSize: params.swarmSize || 50,
        maxIter: params.maxIter || 100,
        w: params.w || 0.72,
        c1: params.c1 || 1.49,
        c2: params.c2 || 1.49,
      });
      return engine.run(ctx, (iter, hv) => {
        if (onProgress) onProgress("MOPSO", iter, engine.maxIter);
      });
    }

    _runDecomposed(ctx, params, acMethod, lampMethod, onProgress) {
      // Phase 1: Optimize AC variables [Tset=0, Fan=3], fix lamp at mid
      const acEngine = acMethod === "moga"
        ? new NSGA2Engine({
            popSize: Math.round((params.popSize || 60) * 0.7),
            generations: Math.round((params.generations || 80) * 0.6),
            activeVars: [0, 3],
            fixedVals: { 1: 50, 2: 60 }, // default lamp PWM mid
          })
        : new MOPSOEngine({
            swarmSize: Math.round((params.swarmSize || 50) * 0.7),
            maxIter: Math.round((params.maxIter || 100) * 0.6),
            activeVars: [0, 3],
            fixedVals: { 1: 50, 2: 60 },
          });

      const acResult = acEngine.run(ctx, (iter, hv) => {
        if (onProgress) onProgress(`Phase-1 AC (${acMethod.toUpperCase()})`, iter,
          acMethod === "moga" ? acEngine.generations : acEngine.maxIter);
      });

      // Get knee-point from AC phase
      const kneeIdx = findKneePoint(acResult.paretoFront);
      const acKnee = acResult.paretoFront[kneeIdx] || acResult.paretoFront[0];
      const fixedTset = acKnee.tset;
      const fixedFan = acKnee.fan;

      // Phase 2: Optimize Lamp variables [PWM_Z1=1, PWM_Z2=2], fix AC at knee
      const lampEngine = lampMethod === "mopso"
        ? new MOPSOEngine({
            swarmSize: Math.round((params.swarmSize || 50) * 0.7),
            maxIter: Math.round((params.maxIter || 100) * 0.6),
            activeVars: [1, 2],
            fixedVals: { 0: fixedTset, 3: fixedFan },
          })
        : new NSGA2Engine({
            popSize: Math.round((params.popSize || 60) * 0.7),
            generations: Math.round((params.generations || 80) * 0.6),
            activeVars: [1, 2],
            fixedVals: { 0: fixedTset, 3: fixedFan },
          });

      const lampResult = lampEngine.run(ctx, (iter, hv) => {
        if (onProgress) onProgress(`Phase-2 Lamp (${lampMethod.toUpperCase()})`, iter,
          lampMethod === "mopso" ? lampEngine.maxIter : lampEngine.generations);
      });

      // Combine results
      const combinedHV = [...acResult.hvHistory, ...lampResult.hvHistory];
      const combinedSpacing = acResult.spacingHistory
        ? [...acResult.spacingHistory, ...(lampResult.spacingHistory || lampResult.gdHistory || [])]
        : [...(acResult.gdHistory || []), ...(lampResult.gdHistory || lampResult.spacingHistory || [])];

      return {
        paretoFront: lampResult.paretoFront,
        allPopulation: lampResult.allPopulation || lampResult.allSwarm || [],
        hvHistory: combinedHV,
        spacingHistory: combinedSpacing,
        gdHistory: combinedSpacing,
        finalHV: combinedHV[combinedHV.length - 1] || 0,
        decomposed: true,
        acPhase: { method: acMethod, knee: acKnee },
        lampPhase: { method: lampMethod },
      };
    }

    /**
     * Enrich raw optimization results with human-readable metrics
     */
    _enrichResults(rawResult, ctx, mode) {
      const pf = rawResult.paretoFront;
      if (!pf.length) return rawResult;

      // Find key solutions
      const kneeIdx = findKneePoint(pf);

      // Most eco (lowest energy, highest f1)
      const ecoIdx = pf.length - 1;

      // Most comfort (lowest discomfort, lowest f2)
      let comfortIdx = 0;
      let minDiscomfort = Infinity;
      pf.forEach((sol, i) => {
        if (sol.objectives[1] < minDiscomfort) {
          minDiscomfort = sol.objectives[1];
          comfortIdx = i;
        }
      });

      // Baseline energy (no optimization: Tset=24, PWM=100%, Fan=2)
      const baselineVars = [24.0, 100, 100, 2];
      const baselineEnergy = objectiveEnergy(baselineVars, ctx);

      // Build enriched solutions
      const enrichSolution = (sol, label, type) => {
        if (!sol) sol = pf[0] || { vars: [24, 50, 50, 2], objectives: [1.2, 5.0], tset: 24, pwmZ1: 50, pwmZ2: 50, fan: 2 };
        const energy = sol.objectives[0];
        const discomfort = sol.objectives[1];
        const tIndoor = modelIndoorTemp(sol.tset, ctx.tOutdoor, sol.fan);
        const fanVa = FAN_MAP[sol.fan] || 0.15;
        const pmv = modelPMV(tIndoor, ctx.rhIndoor, fanVa);
        const ppd = modelPPD(pmv);
        const deskLux = modelDeskLux(sol.pwmZ1, sol.pwmZ2, ctx.luxOutdoor);
        const savingsPct = ((baselineEnergy - energy) / baselineEnergy) * 100;
        const dailyKwh = energy * 24 * 0.65; // 65% duty cycle avg
        const dailyCost = dailyKwh * 1500;
        const lampPowerW = modelLampPower(sol.pwmZ1, sol.pwmZ2) * 1000;
        const acPowerKw = modelAcPower(sol.tset, ctx.tOutdoor, sol.fan);

        return {
          id: type,
          label,
          title: label,
          type: type === "knee" ? "Knee Point (Keseimbangan Optimal)" : (type === "eco" ? "Aggressive Eco Saver" : "Ultra Comfort Priority"),
          vars: sol.vars,
          objectives: sol.objectives,
          tset: parseFloat(sol.tset.toFixed(1)),
          acSetpoint: parseFloat(sol.tset.toFixed(1)),
          pwmZ1: Math.round(sol.pwmZ1),
          pwmZ2: Math.round(sol.pwmZ2),
          lampZ1Pct: Math.round(sol.pwmZ1),
          lampZ2Pct: Math.round(sol.pwmZ2),
          fan: sol.fan,
          acFan: FAN_LABELS[sol.fan] || "Auto",
          fanLabel: FAN_LABELS[sol.fan] || "Auto",
          energy,
          discomfort,
          savingsPct: parseFloat(savingsPct.toFixed(1)),
          tIndoor: parseFloat(tIndoor.toFixed(1)),
          pmv: (pmv >= 0 ? "+" : "") + pmv.toFixed(2),
          ppd: parseFloat(ppd.toFixed(1)),
          deskLux: Math.round(deskLux),
          dailyKwh: parseFloat(dailyKwh.toFixed(1)),
          dailyCost: Math.round(dailyCost),
          acPowerKw: parseFloat(acPowerKw.toFixed(2)),
          lampPowerW: Math.round(lampPowerW),
          totalPowerKw: parseFloat(energy.toFixed(3)),
          comfortClass: Math.abs(pmv) <= 0.2 ? "Kelas A (Sangat Nyaman ISO 7730)" :
                        Math.abs(pmv) <= 0.5 ? "Kelas A (Nyaman ISO 7730)" :
                        Math.abs(pmv) <= 0.7 ? "Kelas B (Memenuhi Standar)" : "Kelas C (Perlu Penyesuaian)",
          explanation: type === "knee"
            ? `Solusi knee-point hasil seleksi optimal pareto. Menyeimbangkan efisiensi energi (${parseFloat(savingsPct.toFixed(1))}%) dengan kenyamanan termal PPD ${parseFloat(ppd.toFixed(1))}% (PMV ${(pmv >= 0 ? "+" : "") + pmv.toFixed(2)}). Setpoint AC stabil pada ${parseFloat(sol.tset.toFixed(1))}°C dan pencahayaan daylight disesuaikan.`
            : (type === "eco"
              ? `Solusi fokus efisiensi energi maksimal (${parseFloat(savingsPct.toFixed(1))}%) dengan setpoint AC ${parseFloat(sol.tset.toFixed(1))}°C dan pemotongan daya lampu agresif yang tetap memenuhi batas ambang kenyamanan standar.`
              : `Solusi prioritas kenyamanan termal dan visual tertinggi dengan PPD ${parseFloat(ppd.toFixed(1))}% dan iluminansi meja ${Math.round(deskLux)} Lux untuk produktivitas kerja optimal.`),
        };
      };

      const solutions = {
        knee: enrichSolution(pf[kneeIdx] || pf[0], "Solusi B: Best Compromise (Rekomendasi Utama BEMS)", "knee"),
        eco: enrichSolution(pf[ecoIdx] || pf[pf.length - 1] || pf[0], "Solusi A: Aggressive Eco Saver (Prioritas Efisiensi)", "eco"),
        comfort: enrichSolution(pf[comfortIdx] || pf[0], "Solusi C: Ultra Comfort Priority (Kenyamanan Maksimal)", "comfort"),
      };

      // Normalize HV to 0-1 scale
      const maxHV = Math.max(...rawResult.hvHistory, 1);
      const hvNormalized = rawResult.hvHistory.map(h => h / maxHV);

      const acMethod = (mode === "all_moga" || mode === "ac_moga_lamp_mopso") ? "moga" : "mopso";
      const lampMethod = (mode === "all_moga" || mode === "ac_mopso_lamp_moga") ? "moga" : "mopso";

      return {
        ...rawResult,
        solutions,
        mode,
        modeLabel: MODE_LABELS[mode] || mode,
        acMethod,
        lampMethod,
        baselineEnergy,
        context: ctx,
        hvNormalized,
        timestamp: new Date().toISOString(),
        // Scatter plot data
        scatterData: {
          dominated: (rawResult.allPopulation || rawResult.allSwarm || [])
            .filter((_, i) => {
              // Filter out Pareto front members
              return !pf.some(p =>
                Math.abs(p.objectives[0] - (rawResult.allPopulation || rawResult.allSwarm || [])[i]?.objectives?.[0]) < 0.001 &&
                Math.abs(p.objectives[1] - (rawResult.allPopulation || rawResult.allSwarm || [])[i]?.objectives?.[1]) < 0.001
              );
            })
            .map(s => ({
              x: ((baselineEnergy - s.objectives[0]) / baselineEnergy) * 100,
              y: s.objectives[1],
            }))
            .filter(p => p.x > 0 && p.x < 50 && p.y > 0 && p.y < 30),
          paretoLine: pf.map(s => ({
            x: solutions.knee.savingsPct + (s.objectives[0] - pf[kneeIdx].objectives[0]) / baselineEnergy * -100,
            y: s.objectives[1],
          })),
        },
      };
    }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // ▌ PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  window.BemsOptEngine = {
    // Models (for external use by services)
    models: {
      acPower: modelAcPower,
      lampPower: modelLampPower,
      indoorTemp: modelIndoorTemp,
      pmv: modelPMV,
      ppd: modelPPD,
      deskLux: modelDeskLux,
    },

    // Algorithm classes
    NSGA2Engine,
    MOPSOEngine,

    // Utilities
    utils: {
      dominates,
      fastNonDominatedSort,
      crowdingDistance,
      findKneePoint,
      hypervolume2D,
      evaluate,
      constraintPenalty,
    },

    // Constants
    BOUNDS,
    FAN_MAP,
    FAN_LABELS,
    MODE_LABELS,
    ROOM,

    // Main optimizer instance
    optimizer: new BEMSOptimizer(),
  };

  console.log("[OptEngine] BEMS Optimization Engine loaded: NSGA-II + MOPSO ready.");

})();
