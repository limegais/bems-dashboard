#!/usr/bin/env python3
"""
BEMS Living Lab — Multi-Objective Optimization Engine (Python Backend)
=====================================================================
Implementasi Python algoritma optimasi multi-objektif:
  - NSGA-II (Non-dominated Sorting Genetic Algorithm II)
  - MOPSO (Multi-Objective Particle Swarm Optimization)
  - Hybrid / Decomposed:
      * AC: MOGA (NSGA-II) + Lampu: MOPSO
      * AC: MOPSO + Lampu: MOGA (NSGA-II)

Objektif:
  min f1 = Konsumsi Daya Listrik Total (kW)
  min f2 = Indeks Ketidaknyamanan Termal & Visual (PPD % ISO 7730 + Deviasi Lux)

Variabel Keputusan:
  X = [ Tset_AC (°C), PWM_Z1 (%), PWM_Z2 (%), FanSpeed (1-3) ]

Mendukung eksekusi CLI mandiri serta integrasi API web server dan
pencatatan hasil ke PostgreSQL schema 'bems_ai'.
"""

import sys
import os
import math
import time
import json
import random
import argparse
from datetime import datetime, timezone

# ── Physics Constants & Room Models ──────────────────────────────────────────

ROOM = {
    "area_sqm": 72.0,
    "ac_rated_kw": 1.55,
    "lamp_total_w": 280.0,
    "target_lux": 480.0,
    "met_default": 1.1,
    "clo_default": 0.5,
}

BOUNDS = {
    "tset": (20.0, 28.0),
    "pwm_z1": (0.0, 100.0),
    "pwm_z2": (0.0, 100.0),
    "fan": (1.0, 3.0),
}

FAN_MAP = {1: 0.15, 2: 0.25, 3: 0.40}
FAN_LABELS = {1: "Low", 2: "Med", 3: "High / Auto"}


def model_ac_power(tset, t_outdoor=32.0, fan=2):
    """Regresi daya AC kompresor inverter (kW) berbasis data PZEM Channel 1.

    Poin B: Model ini adalah aproksimasi linear. Konsumsi AC inverter nyata
    bersifat non-linear terhadap setpoint dan beban pendinginan aktual.
    Untuk akurasi penelitian:
    - Kalibrasi koefisien (0.06, 0.03, 0.015) dengan data PZEM-004T aktual.
    - Pertimbangkan beban panas internal: okupansi, peralatan, radiasi matahari.
    - Bandingkan prediksi model vs pengukuran aktual sebagai validasi.
    """
    setpoint_factor = 1.0 - 0.06 * (tset - 24.0)
    outdoor_factor = 1.0 + 0.03 * max(0.0, t_outdoor - 30.0)
    fan_factor = 1.0 + (fan - 2) * 0.015
    power = ROOM["ac_rated_kw"] * setpoint_factor * outdoor_factor * fan_factor
    return max(0.15, min(2.5, power))


def model_lamp_power(pwm_z1, pwm_z2):
    """Daya pencahayaan 2-zona (kW)."""
    p_z1 = (ROOM["lamp_total_w"] / 2.0) * (pwm_z1 / 100.0)
    p_z2 = (ROOM["lamp_total_w"] / 2.0) * (pwm_z2 / 100.0)
    return (p_z1 + p_z2) / 1000.0


def model_indoor_temp(tset, t_outdoor=32.0, fan=2):
    """Prediksi suhu indoor steady-state (°C)."""
    heat_gain_offset = 0.02 * max(0.0, t_outdoor - 28.0)
    fan_correction = 1.0 - (fan - 1) * 0.15
    offset = (0.3 + heat_gain_offset) * fan_correction
    return tset + offset


def model_pmv(t_indoor, rh_indoor=55.0, va=0.20, met=1.1, clo=0.5):
    """Fanger PMV (ISO 7730) regresi analitik untuk iklim tropis kantor UNS.

    Poin A (Revisi):
    - Tekanan uap jenuh air parsial pa dinyatakan secara konsisten dalam satuan kPa:
        pa = (rh_indoor / 100.0) * exp(16.6536 - 4030.183 / (t_indoor + 235.0))  [kPa]
      (Faktor pengali 10 dihilangkan karena exp(...) langsung menghasilkan kPa).
    - Suhu netral T_neutral menggunakan selisih (pa - 1.50) kPa (ekuivalen 15 hPa).
    - CATATAN VALIDASI & KETERBATASAN MODEL:
      Model PMV di bawah ini adalah MODEL REGRESI LINEAR SURROGATE terkalibrasi untuk
      kondisi kantor tropis FT UNS (met=1.1, clo=0.5, Trad ≈ Tindoor, va=0.15-0.40 m/s),
      bukan implementasi standar penuh persamaan non-linear implisit Fanger ISO 7730
      (yang memerlukan iterasi perpindahan panas konveksi/radiasi dan suhu pakaian t_cl).
      Model ini digunakan untuk efisiensi komputasi instan (<1 µs) dalam iterasi evolusioner.
      Untuk verifikasi standar dan pengujian benchmark, implementasi Fanger ISO 7730
      lengkap (misal pythermalcomfort) disarankan sebagai kontrol validasi.
    """
    pa = (rh_indoor / 100.0) * math.exp(16.6536 - 4030.183 / (t_indoor + 235.0))
    t_neutral = 24.5 - 0.15 * (pa - 1.50) - 1.5 * (va - 0.15)
    delta_t = t_indoor - t_neutral
    return max(-3.0, min(3.0, 0.32 * delta_t))


def model_ppd(pmv):
    """Predicted Percentage of Dissatisfied (PPD %) ISO 7730."""
    ppd = 100.0 - 95.0 * math.exp(-0.03353 * (pmv ** 4) - 0.2179 * (pmv ** 2))
    return max(5.0, min(100.0, ppd))


def model_desk_lux(pwm_z1, pwm_z2, lux_outdoor=1200.0):
    """Iluminansi meja kerja gabungan luminer LED + daylight harvesting (Lux).

    Koefisien kontribusi (0.08, 280, 180) harus divalidasi dengan pengukuran
    lux-meter pada kondisi aktual ruangan (tutup/buka tirai, sudut matahari).
    Poin C: model ini adalah regresi pendekatan linear; validasi lapangan wajib.
    """
    daylight = lux_outdoor * 0.08
    art_z1 = 280.0 * (pwm_z1 / 100.0)
    art_z2 = 180.0 * (pwm_z2 / 100.0)
    return daylight + art_z1 + art_z2


def lux_penalty_pct(desk_lux, target_lux=480.0, dead_band=50.0, overlight_weight=0.5, hard_thresh=350.0, w_hard=0.5):
    """Penalti iluminansi berbasis persen (skala sebanding dengan PPD %).

    Poin B (Revisi):
    - Seluruh komponen penalti dinyatakan secara konsisten dalam satuan persen (%) tanpa dimensi campuran.
    - Zona toleransi SNI 03-6197: target 480 Lux, dead-band ±50 Lux -> zona [430, 530] Lux (penalti = 0%).
    - Jika E_desk < 430 Lux: penalti proporsional (430 - E_desk)/430 * 100%.
    - Jika E_desk < 350 Lux (pelanggaran keras SNI): ditambahkan denda keras ternormalisasi:
        delta_hard = w_hard * ((350 - E_desk) / 350) * 100%
      yang merupakan besaran relatif murni (%) terhadap ambang 350 Lux.
    - Jika E_desk > 530 Lux: penalti glare proporsional (E_desk - 530)/530 * 50%.
    - Batas maksimum penalti (cap 95.0%) diterapkan di akhir setelah semua komponen dijumlahkan.
    """
    lo = target_lux - dead_band   # 430 Lux
    hi = target_lux + dead_band   # 530 Lux

    if desk_lux < lo:
        deficit_pct = (lo - desk_lux) / lo * 100.0
        if desk_lux < hard_thresh:
            # Denda keras ternormalisasi dalam % terhadap ambang 350 Lux
            delta_hard = w_hard * ((hard_thresh - desk_lux) / hard_thresh) * 100.0
            deficit_pct += delta_hard
        return min(deficit_pct, 95.0)   # Cap 95% setelah semua komponen dihitung
    elif desk_lux > hi:
        # Penalti ringan untuk kelebihan pencahayaan (glare)
        surplus_pct = (desk_lux - hi) / hi * 100.0 * overlight_weight
        return min(surplus_pct, 30.0)
    return 0.0


def evaluate_solution(vars_vec, ctx):
    """Evaluasi fungsi objektif [f1, f2]:

      f1 = P_AC + P_Lamp  [kW]  — minimasi konsumsi daya total
      f2 = PPD + P_lux    [%]   — minimasi ketidaknyamanan termal & visual

    Poin A: PPD (%) dan Penalty_lux (%) kini memiliki satuan yang sebanding.
    Solusi yang tidak memenuhi E_desk >= 480 Lux mendapat penalti besar pada f2
    sehingga terdominasi oleh solusi yang memenuhi kendala pencahayaan.
    """
    tset = vars_vec[0]
    pwm_z1 = vars_vec[1]
    pwm_z2 = vars_vec[2]
    fan = int(round(vars_vec[3]))

    t_out = ctx.get("tOutdoor", 32.0)
    rh_in = ctx.get("rhIndoor", 55.0)
    lux_out = ctx.get("luxOutdoor", 1200.0)

    # ── Objektif 1: Energi ───────────────────────────────────────────────────
    p_ac = model_ac_power(tset, t_out, fan)
    p_lamp = model_lamp_power(pwm_z1, pwm_z2)
    f1 = p_ac + p_lamp

    # ── Objektif 2: Kenyamanan Termal (PPD) ─────────────────────────────────
    t_in = model_indoor_temp(tset, t_out, fan)
    va = FAN_MAP.get(fan, 0.20)
    pmv = model_pmv(t_in, rh_in, va)
    ppd = model_ppd(pmv)

    # ── Objektif 2: Kenyamanan Visual (Penalty Lux berbasis %) ───────────────
    # Poin C: target 480 Lux dengan dead-band ±50 Lux, konsisten dengan SNI.
    desk_lux = model_desk_lux(pwm_z1, pwm_z2, lux_out)
    p_lux = lux_penalty_pct(desk_lux, target_lux=ROOM["target_lux"])

    f2 = ppd + p_lux
    return [f1, f2]


def dominates(obj_a, obj_b):
    """Pareto dominance (minimasi): True jika a mendominasi b."""
    not_worse = (obj_a[0] <= obj_b[0]) and (obj_a[1] <= obj_b[1])
    strictly_better = (obj_a[0] < obj_b[0]) or (obj_a[1] < obj_b[1])
    return not_worse and strictly_better


def fast_non_dominated_sort(objectives):
    """Fast Non-Dominated Sorting (NSGA-II)."""
    n = len(objectives)
    S = [[] for _ in range(n)]
    n_dom = [0] * n
    rank = [-1] * n
    fronts = [[]]

    for p in range(n):
        for q in range(n):
            if p == q:
                continue
            if dominates(objectives[p], objectives[q]):
                S[p].append(q)
            elif dominates(objectives[q], objectives[p]):
                n_dom[p] += 1
        if n_dom[p] == 0:
            rank[p] = 0
            fronts[0].append(p)

    i = 0
    while i < len(fronts) and len(fronts[i]) > 0:
        next_front = []
        for p in fronts[i]:
            for q in S[p]:
                n_dom[q] -= 1
                if n_dom[q] == 0:
                    rank[q] = i + 1
                    next_front.append(q)
        if len(next_front) > 0:
            fronts.append(next_front)
        i += 1

    return fronts, rank


def crowding_distance(front, objectives):
    """Crowding distance assignment."""
    n = len(front)
    if n <= 2:
        return [float("inf")] * n

    dist = [0.0] * n
    n_obj = len(objectives[front[0]])

    for m in range(n_obj):
        indexed = [(front[i], objectives[front[i]][m], i) for i in range(n)]
        indexed.sort(key=lambda x: x[1])

        f_min = indexed[0][1]
        f_max = indexed[-1][1]
        f_range = f_max - f_min if (f_max - f_min) > 1e-9 else 1.0

        dist[indexed[0][2]] = float("inf")
        dist[indexed[-1][2]] = float("inf")

        for i in range(1, n - 1):
            dist[indexed[i][2]] += (indexed[i + 1][1] - indexed[i - 1][1]) / f_range

    return dist


def find_knee_point(pareto_front):
    """Menemukan Knee-Point menggunakan jarak maksimum terhadap garis penghubung titik ekstrem (Poin C).

    Poin C (Revisi):
    - Normalisasi kedua objektif [f1, f2] ke [0, 1] berbasis batas min-max Pareto front aktual.
    - Tentukan titik ekstrem aktual:
        A = titik dengan f1 minimum (daya terendah, ketidaknyamanan tertinggi)
        B = titik dengan f2 minimum (ketidaknyamanan terendah, daya tertinggi)
    - Bentuk garis chord AB yang menghubungkan kedua ekstrem ternormalisasi.
    - Untuk setiap kandidat titik P pada front Pareto, hitung jarak tegak lurus bertanda (signed distance):
        d_signed(P) = [ dx * (y_A - y_P) - dy * (x_A - x_P) ] / L_AB
      di mana orientasi positif didefinisikan ke arah titik ideal (0,0) untuk masalah minimisasi (kurva konveks).
    - Titik dengan defleksi positif terbesar (peningkatan trade-off paling tajam) dipilih sebagai knee-point.
    - Jika front bersifat linear atau konkaf (tidak ada d_signed > 0), gunakan fallback jarak Euclidean terdekat ke (0,0).
    """
    if len(pareto_front) <= 2:
        return 0

    f1_vals = [s["objectives"][0] for s in pareto_front]
    f2_vals = [s["objectives"][1] for s in pareto_front]

    f1_min, f1_max = min(f1_vals), max(f1_vals)
    f2_min, f2_max = min(f2_vals), max(f2_vals)
    r1 = f1_max - f1_min if (f1_max - f1_min) > 1e-9 else 1.0
    r2 = f2_max - f2_min if (f2_max - f2_min) > 1e-9 else 1.0

    # Normalisasi semua titik ke [0, 1]
    norm_pts = [
        ((f1_vals[i] - f1_min) / r1, (f2_vals[i] - f2_min) / r2)
        for i in range(len(pareto_front))
    ]

    # Cari titik ekstrem aktual dari solusi non-dominated
    idx_A = min(range(len(norm_pts)), key=lambda i: (norm_pts[i][0], norm_pts[i][1]))
    idx_B = min(range(len(norm_pts)), key=lambda i: (norm_pts[i][1], norm_pts[i][0]))

    pt_A = norm_pts[idx_A]
    pt_B = norm_pts[idx_B]

    dx = pt_B[0] - pt_A[0]
    dy = pt_B[1] - pt_A[1]
    chord_len = math.hypot(dx, dy)

    if chord_len < 1e-6:
        return min(range(len(norm_pts)), key=lambda i: math.hypot(norm_pts[i][0], norm_pts[i][1]))

    # Hitung signed perpendicular distance ke arah titik ideal (0,0)
    best_idx = idx_A
    max_tradeoff_dist = -float("inf")

    for i in range(len(norm_pts)):
        px, py = norm_pts[i]
        # Cross product 2D terhadap vektor AB
        signed_dist = (dx * (pt_A[1] - py) - dy * (pt_A[0] - px)) / chord_len
        if signed_dist > max_tradeoff_dist:
            max_tradeoff_dist = signed_dist
            best_idx = i

    # Validasi kelengkungan: jika tidak ada titik dengan defleksi positif ke arah origin,
    # fallback ke titik dengan jarak Euclidean terdekat ke titik utopia (0,0)
    if max_tradeoff_dist <= 1e-6:
        best_idx = min(range(len(norm_pts)), key=lambda i: math.hypot(norm_pts[i][0], norm_pts[i][1]))

    return best_idx


def compute_hypervolume_2d(objectives, ref=(3.0, 100.0)):
    """Menghitung metrik Hypervolume 2D."""
    if not objectives:
        return 0.0
    sorted_pts = sorted(objectives, key=lambda x: x[0])
    hv = 0.0
    prev_y = ref[1]
    for pt in sorted_pts:
        if pt[0] < ref[0] and pt[1] < ref[1]:
            hv += (ref[0] - pt[0]) * (prev_y - pt[1])
            prev_y = pt[1]
    return hv


# ── Optimizers ───────────────────────────────────────────────────────────────

class NSGA2Optimizer:
    """Implementasi NSGA-II untuk BEMS."""

    def __init__(self, pop_size=60, generations=80, crossover_rate=0.85, mutation_rate=0.08,
                 active_vars=None, fixed_vals=None):
        self.pop_size = pop_size
        self.generations = generations
        self.crossover_rate = crossover_rate
        self.mutation_rate = mutation_rate
        self.active_vars = active_vars or [0, 1, 2, 3]
        self.fixed_vals = fixed_vals or {}

    def _random_ind(self):
        v = [
            random.uniform(BOUNDS["tset"][0], BOUNDS["tset"][1]),
            random.uniform(BOUNDS["pwm_z1"][0], BOUNDS["pwm_z1"][1]),
            random.uniform(BOUNDS["pwm_z2"][0], BOUNDS["pwm_z2"][1]),
            float(random.randint(int(BOUNDS["fan"][0]), int(BOUNDS["fan"][1]))),
        ]
        for idx, val in self.fixed_vals.items():
            v[int(idx)] = float(val)
        v[3] = float(min(3, max(1, round(v[3]))))
        return v

    def run(self, ctx):
        pop = [self._random_ind() for _ in range(self.pop_size)]
        objectives = [evaluate_solution(ind, ctx) for ind in pop]

        hv_history = []
        spacing_history = []

        for gen in range(self.generations):
            fronts, ranks = fast_non_dominated_sort(objectives)
            crowd = [0.0] * len(pop)
            for f in fronts:
                cd = crowding_distance(f, objectives)
                for i_pos, ind_idx in enumerate(f):
                    crowd[ind_idx] = cd[i_pos]

            # Offspring generation via tournament + SBX + mutation
            offspring = []
            while len(offspring) < self.pop_size:
                p1_idx = random.randint(0, len(pop) - 1)
                p2_idx = random.randint(0, len(pop) - 1)
                p1 = pop[p1_idx] if ranks[p1_idx] < ranks[p2_idx] else pop[p2_idx]

                p3_idx = random.randint(0, len(pop) - 1)
                p4_idx = random.randint(0, len(pop) - 1)
                p2 = pop[p3_idx] if ranks[p3_idx] < ranks[p4_idx] else pop[p4_idx]

                # Crossover
                c1 = list(p1)
                c2 = list(p2)
                if random.random() < self.crossover_rate:
                    for d in self.active_vars:
                        if random.random() < 0.5:
                            alpha = random.random()
                            c1[d] = alpha * p1[d] + (1 - alpha) * p2[d]
                            c2[d] = (1 - alpha) * p1[d] + alpha * p2[d]

                # Mutate
                for c in [c1, c2]:
                    if len(offspring) >= self.pop_size:
                        break
                    for d in self.active_vars:
                        if random.random() < self.mutation_rate:
                            b_lo, b_hi = (BOUNDS["tset"], BOUNDS["pwm_z1"], BOUNDS["pwm_z2"], BOUNDS["fan"])[d]
                            c[d] = random.uniform(b_lo, b_hi)
                    # Clamp
                    c[0] = max(BOUNDS["tset"][0], min(BOUNDS["tset"][1], c[0]))
                    c[1] = max(BOUNDS["pwm_z1"][0], min(BOUNDS["pwm_z1"][1], c[1]))
                    c[2] = max(BOUNDS["pwm_z2"][0], min(BOUNDS["pwm_z2"][1], c[2]))
                    c[3] = float(max(1, min(3, round(c[3]))))
                    for idx, val in self.fixed_vals.items():
                        c[int(idx)] = float(val)
                    offspring.append(c)

            offspring_obj = [evaluate_solution(ind, ctx) for ind in offspring]
            combined = pop + offspring
            combined_obj = objectives + offspring_obj

            c_fronts, _ = fast_non_dominated_sort(combined_obj)
            new_pop = []
            new_obj = []
            fi = 0
            while fi < len(c_fronts) and len(new_pop) + len(c_fronts[fi]) <= self.pop_size:
                for idx in c_fronts[fi]:
                    new_pop.append(combined[idx])
                    new_obj.append(combined_obj[idx])
                fi += 1

            if len(new_pop) < self.pop_size and fi < len(c_fronts):
                last_f = c_fronts[fi]
                cd = crowding_distance(last_f, combined_obj)
                sorted_f = sorted(zip(last_f, cd), key=lambda x: x[1], reverse=True)
                needed = self.pop_size - len(new_pop)
                for idx, _ in sorted_f[:needed]:
                    new_pop.append(combined[idx])
                    new_obj.append(combined_obj[idx])

            pop = new_pop
            objectives = new_obj

            pareto_obj = [combined_obj[i] for i in c_fronts[0]]
            hv_history.append(compute_hypervolume_2d(pareto_obj))

        final_fronts, _ = fast_non_dominated_sort(objectives)
        pareto_list = []
        for idx in final_fronts[0]:
            pareto_list.append({
                "vars": pop[idx],
                "objectives": objectives[idx],
                "tset": pop[idx][0],
                "pwm_z1": pop[idx][1],
                "pwm_z2": pop[idx][2],
                "fan": int(round(pop[idx][3])),
            })

        pareto_list.sort(key=lambda s: s["objectives"][0])
        return {
            "paretoFront": pareto_list,
            "allPopulation": [{"vars": pop[i], "objectives": objectives[i]} for i in range(len(pop))],
            "hvHistory": hv_history,
            "finalHV": hv_history[-1] if hv_history else 0.0,
        }


class MOPSOOptimizer:
    """Implementasi Multi-Objective Particle Swarm Optimization (MOPSO).

    Poin D: Implementasi lengkap mencakup:
    - Batas kecepatan partikel (v_max) per dimensi.
    - Seleksi leader dari arsip menggunakan roulette wheel berbasis crowding
      distance (leader dengan kepadatan rendah = peluang dipilih lebih tinggi).
    - Pembaruan pbest: hanya update jika solusi baru mendominasi pbest lama;
      jika non-dominated (tidak ada yang mendominasi), update dengan prob 0.5.
    - Pemangkasan arsip: gunakan crowding distance untuk membuang solusi pada
      area padat saat arsip melebihi kapasitas.
    - Penanganan variabel diskrit FanSpeed via pembulatan setelah clamp.
    """

    def __init__(self, swarm_size=50, max_iter=80, w=0.72, c1=1.49, c2=1.49,
                 active_vars=None, fixed_vals=None):
        self.swarm_size = swarm_size
        self.max_iter = max_iter
        self.w = w
        self.c1 = c1
        self.c2 = c2
        self.active_vars = active_vars or [0, 1, 2, 3]
        self.fixed_vals = fixed_vals or {}
        # v_max = 20% rentang tiap dimensi untuk stabilitas konvergensi
        all_bounds = [BOUNDS["tset"], BOUNDS["pwm_z1"], BOUNDS["pwm_z2"], BOUNDS["fan"]]
        self.v_max = [0.20 * (b[1] - b[0]) for b in all_bounds]

    def _select_leader_roulette(self, archive):
        """Pilih leader dari arsip dengan roulette wheel berbasis crowding distance.

        Solusi pada area crowding rendah (jarak besar) mendapat bobot lebih tinggi
        sehingga mendorong eksplorasi area yang belum terjamah Pareto front.
        """
        if len(archive) == 1:
            return archive[0]

        # Hitung crowding distance untuk seluruh arsip
        objs = [a["objectives"] for a in archive]
        n = len(archive)
        cd = [0.0] * n

        for m in range(2):  # 2 objektif
            sorted_idx = sorted(range(n), key=lambda k: objs[k][m])
            f_min = objs[sorted_idx[0]][m]
            f_max = objs[sorted_idx[-1]][m]
            f_range = f_max - f_min if (f_max - f_min) > 1e-9 else 1.0
            cd[sorted_idx[0]] = float("inf")
            cd[sorted_idx[-1]] = float("inf")
            for k in range(1, n - 1):
                cd[sorted_idx[k]] += (objs[sorted_idx[k + 1]][m] - objs[sorted_idx[k - 1]][m]) / f_range

        # Ganti inf dengan nilai besar terbatas agar roulette bisa dihitung
        max_finite = max((v for v in cd if v != float("inf")), default=1.0)
        weights = [min(v, max_finite * 2.0) for v in cd]
        total = sum(weights)
        if total < 1e-12:
            return random.choice(archive)

        r = random.uniform(0, total)
        cumulative = 0.0
        for i, w in enumerate(weights):
            cumulative += w
            if r <= cumulative:
                return archive[i]
        return archive[-1]

    def run(self, ctx):
        all_bounds = [BOUNDS["tset"], BOUNDS["pwm_z1"], BOUNDS["pwm_z2"], BOUNDS["fan"]]
        positions = []
        velocities = []

        for _ in range(self.swarm_size):
            p = [
                random.uniform(BOUNDS["tset"][0], BOUNDS["tset"][1]),
                random.uniform(BOUNDS["pwm_z1"][0], BOUNDS["pwm_z1"][1]),
                random.uniform(BOUNDS["pwm_z2"][0], BOUNDS["pwm_z2"][1]),
                float(random.randint(int(BOUNDS["fan"][0]), int(BOUNDS["fan"][1]))),
            ]
            for idx, val in self.fixed_vals.items():
                p[int(idx)] = float(val)
            positions.append(p)
            # Kecepatan awal kecil: ±5% rentang
            v = [(b[1] - b[0]) * random.uniform(-0.05, 0.05) for b in all_bounds]
            velocities.append(v)

        pbest = [list(pos) for pos in positions]
        pbest_obj = [evaluate_solution(pos, ctx) for pos in positions]
        archive = []

        # Init arsip dengan posisi awal yang non-dominated
        for i, pos in enumerate(positions):
            archive = self._update_archive(archive, [{"vars": pos, "objectives": pbest_obj[i]}])

        hv_history = []
        for it in range(self.max_iter):
            candidates = []
            for i in range(self.swarm_size):
                # Seleksi leader dari arsip (roulette wheel berbasis crowding distance)
                leader = self._select_leader_roulette(archive) if archive else {"vars": pbest[i]}

                for d in self.active_vars:
                    r1 = random.random()
                    r2 = random.random()
                    new_v = (
                        self.w * velocities[i][d]
                        + self.c1 * r1 * (pbest[i][d] - positions[i][d])
                        + self.c2 * r2 * (leader["vars"][d] - positions[i][d])
                    )
                    # Batasi kecepatan (v_max) untuk stabilitas
                    velocities[i][d] = max(-self.v_max[d], min(self.v_max[d], new_v))
                    positions[i][d] += velocities[i][d]

                # Clamp posisi ke batas domain
                positions[i][0] = max(BOUNDS["tset"][0], min(BOUNDS["tset"][1], positions[i][0]))
                positions[i][1] = max(BOUNDS["pwm_z1"][0], min(BOUNDS["pwm_z1"][1], positions[i][1]))
                positions[i][2] = max(BOUNDS["pwm_z2"][0], min(BOUNDS["pwm_z2"][1], positions[i][2]))
                # Poin D: FanSpeed adalah variabel diskrit {1,2,3} — bulatkan setelah clamp
                positions[i][3] = float(max(1, min(3, round(positions[i][3]))))
                for idx, val in self.fixed_vals.items():
                    positions[i][int(idx)] = float(val)

                obj = evaluate_solution(positions[i], ctx)

                # Pembaruan pbest: dominasi ketat atau non-dominated dengan prob 0.5
                if dominates(obj, pbest_obj[i]):
                    # Solusi baru lebih baik — selalu update
                    pbest[i] = list(positions[i])
                    pbest_obj[i] = list(obj)
                elif not dominates(pbest_obj[i], obj):
                    # Keduanya non-dominated — update probabilistik untuk diversitas
                    if random.random() < 0.5:
                        pbest[i] = list(positions[i])
                        pbest_obj[i] = list(obj)

                candidates.append({"vars": list(positions[i]), "objectives": list(obj)})

            archive = self._update_archive(archive, candidates)
            hv_history.append(compute_hypervolume_2d([a["objectives"] for a in archive]))

        pareto_list = []
        for a in archive:
            pareto_list.append({
                "vars": a["vars"],
                "objectives": a["objectives"],
                "tset": a["vars"][0],
                "pwm_z1": a["vars"][1],
                "pwm_z2": a["vars"][2],
                "fan": int(round(a["vars"][3])),
            })

        pareto_list.sort(key=lambda s: s["objectives"][0])
        return {
            "paretoFront": pareto_list,
            "allSwarm": [{"vars": positions[i], "objectives": pbest_obj[i]} for i in range(len(positions))],
            "hvHistory": hv_history,
            "finalHV": hv_history[-1] if hv_history else 0.0,
        }

    def _update_archive(self, archive, candidates, max_size=50):
        """Perbarui arsip Pareto eksternal dan pangkas jika melebihi kapasitas.

        Poin D: Pemangkasan menggunakan crowding distance — solusi pada area
        padat (CD kecil) dibuang terlebih dahulu untuk mempertahankan keberagaman.
        """
        pool = archive + candidates
        non_dom = []
        for i, a in enumerate(pool):
            is_dom = any(
                j != i and dominates(b["objectives"], a["objectives"])
                for j, b in enumerate(pool)
            )
            if not is_dom:
                # Hindari duplikat identik dalam arsip
                if not any(
                    abs(nd["objectives"][0] - a["objectives"][0]) < 1e-4 and
                    abs(nd["objectives"][1] - a["objectives"][1]) < 1e-4
                    for nd in non_dom
                ):
                    non_dom.append(a)

        # Pemangkasan arsip: buang solusi crowding tinggi (area padat)
        if len(non_dom) > max_size:
            n = len(non_dom)
            objs = [a["objectives"] for a in non_dom]
            cd = [0.0] * n
            for m in range(2):
                sorted_idx = sorted(range(n), key=lambda k: objs[k][m])
                f_min = objs[sorted_idx[0]][m]
                f_max = objs[sorted_idx[-1]][m]
                f_range = f_max - f_min if (f_max - f_min) > 1e-9 else 1.0
                cd[sorted_idx[0]] = float("inf")
                cd[sorted_idx[-1]] = float("inf")
                for k in range(1, n - 1):
                    cd[sorted_idx[k]] += (
                        objs[sorted_idx[k + 1]][m] - objs[sorted_idx[k - 1]][m]
                    ) / f_range
            # Urutkan dari CD besar ke kecil; pertahankan max_size teratas
            indexed_cd = sorted(enumerate(cd), key=lambda x: x[1], reverse=True)
            keep = {idx for idx, _ in indexed_cd[:max_size]}
            non_dom = [non_dom[i] for i in range(n) if i in keep]

        return non_dom


# ── High Level Orchestrator ──────────────────────────────────────────────────

def run_optimization(mode="all_moga", ac_method=None, lamp_method=None, ctx=None, params=None):
    """
    Eksekusi optimasi multi-objektif dengan dukungan pemilihan metode subsistem:
      - mode='all_moga'
      - mode='all_mopso'
      - mode='ac_moga_lamp_mopso' (AC MOGA, Lampu MOPSO)
      - mode='ac_mopso_lamp_moga' (AC MOPSO, Lampu MOGA)
    """
    t_start = time.time()
    params = params or {}
    ctx = ctx or {
        "tOutdoor": 32.0,
        "rhIndoor": 55.0,
        "luxOutdoor": 1200.0,
        "headcount": 3,
    }

    if ac_method and lamp_method:
        ac = ac_method.lower()
        lamp = lamp_method.lower()
        if ac == "moga" and lamp == "moga":
            mode = "all_moga"
        elif ac == "mopso" and lamp == "mopso":
            mode = "all_mopso"
        elif ac == "moga" and lamp == "mopso":
            mode = "ac_moga_lamp_mopso"
        elif ac == "mopso" and lamp == "moga":
            mode = "ac_mopso_lamp_moga"

    # Baseline energy: Tset=24, PWM=100%, Fan=2
    baseline_energy = evaluate_solution([24.0, 100.0, 100.0, 2.0], ctx)[0]

    if mode == "all_moga":
        engine = NSGA2Optimizer(
            pop_size=params.get("popSize", 60),
            generations=params.get("generations", 80),
        )
        raw = engine.run(ctx)
    elif mode == "all_mopso":
        engine = MOPSOOptimizer(
            swarm_size=params.get("swarmSize", 50),
            max_iter=params.get("maxIter", 80),
        )
        raw = engine.run(ctx)
    elif mode in ("ac_moga_lamp_mopso", "ac_mopso_lamp_moga"):
        # Decomposed Hybrid Optimization
        first_ac = "moga" if mode == "ac_moga_lamp_mopso" else "mopso"
        second_lamp = "mopso" if mode == "ac_moga_lamp_mopso" else "moga"

        # Phase 1: Optimize AC [Tset=0, Fan=3], fix Lamp at 50%
        if first_ac == "moga":
            ac_eng = NSGA2Optimizer(pop_size=40, generations=40, active_vars=[0, 3], fixed_vals={1: 50.0, 2: 60.0})
        else:
            ac_eng = MOPSOOptimizer(swarm_size=35, max_iter=45, active_vars=[0, 3], fixed_vals={1: 50.0, 2: 60.0})

        ac_res = ac_eng.run(ctx)
        ac_knee_idx = find_knee_point(ac_res["paretoFront"])
        ac_knee = ac_res["paretoFront"][ac_knee_idx]
        fixed_tset = ac_knee["tset"]
        fixed_fan = ac_knee["fan"]

        # Phase 2: Optimize Lamp [PWM_Z1=1, PWM_Z2=2], fix AC at knee
        if second_lamp == "mopso":
            lamp_eng = MOPSOOptimizer(swarm_size=35, max_iter=45, active_vars=[1, 2], fixed_vals={0: fixed_tset, 3: fixed_fan})
        else:
            lamp_eng = NSGA2Optimizer(pop_size=40, generations=40, active_vars=[1, 2], fixed_vals={0: fixed_tset, 3: fixed_fan})

        lamp_res = lamp_eng.run(ctx)

        # ── Re-evaluasi Global Lengkap Solusi Akhir (Poin D) ──────────────────
        # Evaluasi ulang seluruh solusi gabungan [fixed_tset, pwm_z1, pwm_z2, fixed_fan]
        # dengan fungsi objektif global: f1 = P_AC + P_Lamp, f2 = PPD + P_lux.
        # Menjamin interaksi gabungan kedua subsistem konsisten secara fisik dan matematis.
        combined_candidates = []
        for sol in lamp_res["paretoFront"]:
            v = [fixed_tset, sol["vars"][1], sol["vars"][2], float(fixed_fan)]
            full_objs = evaluate_solution(v, ctx)
            combined_candidates.append({
                "vars": v,
                "objectives": full_objs,
                "tset": fixed_tset,
                "pwm_z1": v[1],
                "pwm_z2": v[2],
                "fan": int(round(fixed_fan)),
            })

        # Saring solusi non-dominated murni dari kandidat gabungan
        final_pf = []
        for i, a in enumerate(combined_candidates):
            is_dom = any(
                j != i and dominates(b["objectives"], a["objectives"])
                for j, b in enumerate(combined_candidates)
            )
            if not is_dom:
                if not any(
                    abs(nd["objectives"][0] - a["objectives"][0]) < 1e-4 and
                    abs(nd["objectives"][1] - a["objectives"][1]) < 1e-4
                    for nd in final_pf
                ):
                    final_pf.append(a)

        final_pf.sort(key=lambda s: s["objectives"][0])

        raw = {
            "paretoFront": final_pf if final_pf else combined_candidates,
            "allPopulation": lamp_res.get("allPopulation") or lamp_res.get("allSwarm") or [],
            "hvHistory": ac_res["hvHistory"] + lamp_res["hvHistory"],
            "finalHV": compute_hypervolume_2d([s["objectives"] for s in (final_pf or combined_candidates)]),
            "decomposed": True,
        }
    else:
        engine = NSGA2Optimizer(pop_size=60, generations=80)
        raw = engine.run(ctx)

    exec_time_ms = int((time.time() - t_start) * 1000)
    pf = raw["paretoFront"]

    # Enrich Solutions
    def enrich(sol, label, sol_id):
        if not sol:
            sol = pf[0] if pf else {"vars": [24.0, 50.0, 50.0, 2.0], "objectives": [1.2, 5.0], "tset": 24.0, "pwm_z1": 50.0, "pwm_z2": 50.0, "fan": 2}
        energy = sol["objectives"][0]
        discomfort = sol["objectives"][1]
        t_in = model_indoor_temp(sol["tset"], ctx["tOutdoor"], sol["fan"])
        va = FAN_MAP.get(sol["fan"], 0.20)
        pmv = model_pmv(t_in, ctx["rhIndoor"], va)
        ppd = model_ppd(pmv)
        desk_lux = model_desk_lux(sol["pwm_z1"], sol["pwm_z2"], ctx["luxOutdoor"])
        savings_pct = ((baseline_energy - energy) / baseline_energy) * 100.0
        daily_kwh = energy * 24.0 * 0.65
        daily_cost = daily_kwh * 1500.0

        return {
            "id": sol_id,
            "title": label,
            "type": "Knee Point (Keseimbangan Optimal)" if sol_id == "knee" else ("Aggressive Eco Saver" if sol_id == "eco" else "Ultra Comfort Priority"),
            "vars": sol["vars"],
            "objectives": sol["objectives"],
            "tset": round(sol["tset"], 1),
            "acSetpoint": round(sol["tset"], 1),
            "pwmZ1": int(round(sol["pwm_z1"])),
            "pwmZ2": int(round(sol["pwm_z2"])),
            "lampZ1Pct": int(round(sol["pwm_z1"])),
            "lampZ2Pct": int(round(sol["pwm_z2"])),
            "fan": sol["fan"],
            "acFan": FAN_LABELS.get(sol["fan"], "Auto"),
            "energy": round(energy, 3),
            "savingsPct": round(savings_pct, 1),
            "tIndoor": round(t_in, 1),
            "pmv": f"{'+' if pmv >= 0 else ''}{pmv:.2f}",
            "ppd": round(ppd, 1),
            "deskLux": int(round(desk_lux)),
            "dailyKwh": round(daily_kwh, 1),
            "dailyCost": int(round(daily_cost)),
            "acPowerKw": round(model_ac_power(sol["tset"], ctx["tOutdoor"], sol["fan"]), 2),
            "lampPowerW": int(round(model_lamp_power(sol["pwm_z1"], sol["pwm_z2"]) * 1000.0)),
            "totalPowerKw": round(energy, 3),
            "comfortClass": "Kelas A (Sangat Nyaman)" if abs(pmv) <= 0.2 else ("Kelas A (Nyaman)" if abs(pmv) <= 0.5 else "Kelas B (Standar)"),
        }

    knee_idx = find_knee_point(pf) if pf else 0
    eco_idx = len(pf) - 1 if pf else 0
    comfort_idx = 0
    min_discomfort = float("inf")
    for i, s in enumerate(pf):
        if s["objectives"][1] < min_discomfort:
            min_discomfort = s["objectives"][1]
            comfort_idx = i

    solutions = {
        "knee": enrich(pf[knee_idx] if pf else None, "Solusi B: Best Compromise (Rekomendasi Utama)", "knee"),
        "eco": enrich(pf[eco_idx] if pf else None, "Solusi A: Aggressive Eco Saver", "eco"),
        "comfort": enrich(pf[comfort_idx] if pf else None, "Solusi C: Ultra Comfort Priority", "comfort"),
    }

    return {
        "mode": mode,
        "acMethod": "moga" if mode in ("all_moga", "ac_moga_lamp_mopso") else "mopso",
        "lampMethod": "moga" if mode in ("all_moga", "ac_mopso_lamp_moga") else "mopso",
        "baselineEnergy": round(baseline_energy, 3),
        "executionTimeMs": exec_time_ms,
        "solutions": solutions,
        "paretoFront": pf,
        "finalHV": raw.get("finalHV", 0.0),
        "hvHistory": raw.get("hvHistory", []),
        "context": ctx,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ── CLI Interface ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="BEMS Multi-Objective Optimizer (NSGA-II & MOPSO)")
    parser.add_argument("--mode", default="all_moga", choices=["all_moga", "all_mopso", "ac_moga_lamp_mopso", "ac_mopso_lamp_moga"], help="Mode optimasi")
    parser.add_argument("--ac", choices=["moga", "mopso"], help="Metode spesifik AC")
    parser.add_argument("--lamp", choices=["moga", "mopso"], help="Metode spesifik Lampu")
    parser.add_argument("--pop", type=int, default=50, help="Ukuran populasi / swarm")
    parser.add_argument("--gen", type=int, default=60, help="Jumlah generasi / iterasi")
    parser.add_argument("--tout", type=float, default=32.0, help="Suhu outdoor (°C)")
    parser.add_argument("--json", action="store_true", help="Output format JSON")

    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    args = parser.parse_args()
    ctx = {"tOutdoor": args.tout, "rhIndoor": 55.0, "luxOutdoor": 1200.0, "headcount": 3}
    params = {"popSize": args.pop, "generations": args.gen, "swarmSize": args.pop, "maxIter": args.gen}

    res = run_optimization(mode=args.mode, ac_method=args.ac, lamp_method=args.lamp, ctx=ctx, params=params)

    if args.json:
        print(json.dumps(res, indent=2))
    else:
        print("\n" + "=" * 65)
        print("  [*] BEMS LIVING LAB - MULTI-OBJECTIVE OPTIMIZER")
        print("=" * 65)
        print(f" Mode               : {res['mode'].upper()} (AC: {res['acMethod'].upper()}, Lamp: {res['lampMethod'].upper()})")
        print(f" Waktu Komputasi    : {res['executionTimeMs']} ms")
        print(f" Solusi Pareto      : {len(res['paretoFront'])} solusi non-terdominasi")
        print("-" * 65)
        knee = res["solutions"]["knee"]
        print(" [*] Solusi Knee-Point (Rekomendasi Terbaik):")
        print(f"    - Setpoint AC   : {knee['acSetpoint']} C ({knee['acFan']} Fan)")
        print(f"    - Dimmer Lampu  : Z1 {knee['lampZ1Pct']}%, Z2 {knee['lampZ2Pct']}%")
        print(f"    - Penghematan   : {knee['savingsPct']}% daya (vs baseline)")
        print(f"    - Kenyamanan    : PPD {knee['ppd']}% ({knee['comfortClass']}, PMV {knee['pmv']})")
        print(f"    - Iluminansi    : {knee['deskLux']} Lux meja kerja")
        print(f"    - Estimasi Daya : {knee['totalPowerKw']} kW (AC: {knee['acPowerKw']} kW, Lamp: {knee['lampPowerW']} W)")
        print("=" * 65 + "\n")
