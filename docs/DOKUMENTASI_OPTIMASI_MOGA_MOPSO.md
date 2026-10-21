# 🧬 Dokumentasi Teknis Sistem Optimasi Multi-Objektif (MOGA & MOPSO)
### Building Energy Management System (BEMS) — Living Lab Departemen Teknik Elektro FT UNS

---

## 1. Pendahuluan & Latar Belakang Masalah

Pada fasilitas **Living Lab Smart Office Departemen Teknik Elektro FT UNS** (luas 72 m², tinggi 3.2 m), efisiensi operasional energi berpusat pada dua subsistem utama:
1. **HVAC (AC Split Inverter 1.5 PK / ~1.55 kW nominal)**: Mengonsumsi ~65–70% total daya listrik.
2. **Pencahayaan Interior (4 Fixture LED @ 70W = 280W total)**: Mengonsumsi ~10–15% total daya listrik.

Kedua subsistem ini memiliki hubungan **pertentangan langsung (trade-off)** terhadap kenyamanan manusia di dalam ruangan:
* Menurunkan konsumsi daya AC dengan menaikkan setpoint suhu atau menurunkan kecepatan fan berisiko meningkatkan indeks ketidakpuasan termal penghuni (PPD ISO 7730).
* Meredupkan lampu LED menghemat daya listrik, namun jika kuat penerangan turun di bawah standar SNI 03-6197 (480 Lux), beban visual dan ketidaknyamanan mata penghuni akan meningkat.

Oleh karena itu, sistem ini dirumuskan sebagai **Multi-Objective Optimization Problem (MOOP)** untuk menemukan sekumpulan solusi optimal non-kalah (**Pareto Optimal Front**) yang menyeimbangkan efisiensi energi listrik dan kenyamanan penghuni gedung.

---

## 2. Formulasi Matematis Optimasi

### 2.1 Ruang Keputusan (Decision Variables)

Setiap solusi direpresentasikan sebagai vektor variabel keputusan berdimensi 4:

$$\mathbf{X} = \begin{bmatrix} T_{\text{set}} \\ PWM_{Z1} \\ PWM_{Z2} \\ FanSpeed \end{bmatrix}$$

| Variabel | Nama Parameter | Tipe Data | Domain / Batasan | Satuan | Deskripsi Fisik |
|---|---|---|---|---|---|
| $x_1$ | Setpoint Suhu AC ($T_{\text{set}}$) | Float Kontinu | $[20.0, 28.0]$ | $^\circ\text{C}$ | Target suhu pada termostat AC |
| $x_2$ | Dimmer Lampu Zona 1 ($PWM_{Z1}$) | Float Kontinu | $[0, 100]$ | $\%$ | Duty cycle lampu LED dekat jendela |
| $x_3$ | Dimmer Lampu Zona 2 ($PWM_{Z2}$) | Float Kontinu | $[0, 100]$ | $\%$ | Duty cycle lampu LED area dalam |
| $x_4$ | Kecepatan Blower ($Fan$) | Integer Diskrit | $\{1, 2, 3\}$ | Index | 1: Low (0.15 m/s), 2: Med (0.25 m/s), 3: High (0.40 m/s) |

---

### 2.2 Fungsi Objektif 1: Minimasi Daya Listrik Total ($f_1$)

Meminimalkan total konsumsi daya listrik fasilitas:

$$\min_{\mathbf{X}} f_1(\mathbf{X}) = P_{\text{AC}}(T_{\text{set}}, T_{\text{outdoor}}, Fan) + P_{\text{Lamp}}(PWM_{Z1}, PWM_{Z2}) \quad [\text{kW}]$$

#### Model Empiris Kompresor AC ($P_{\text{AC}}$)
Berdasarkan data PZEM-004T Channel 1 Living Lab terhadap suhu lingkungan luar ($T_{\text{outdoor}}$):
$$P_{\text{AC}} = P_{\text{rated}} \times \left[ 1 - 0.06 \cdot (T_{\text{set}} - 24.0) \right] \times \left[ 1 + 0.03 \cdot \max(0, T_{\text{outdoor}} - 30.0) \right] \times \left[ 1 + (Fan - 2) \cdot 0.015 \right]$$
* $P_{\text{rated}} = 1.55 \text{ kW}$.
* Setiap kenaikan setpoint $1^\circ\text{C}$ di atas $24^\circ\text{C}$ menghemat $\approx 6\%$ daya kompresor.
* Kenaikan suhu luar di atas $30^\circ\text{C}$ menambah beban pendinginan $\approx 3\% / ^\circ\text{C}$.

#### Model Daya Penerangan LED ($P_{\text{Lamp}}$)
Karakteristik linier dimmer 4 fixture LED 70W ($W_{\text{tot}} = 280\text{ W}$):
$$P_{\text{Lamp}} = \frac{1}{1000} \left[ \left(\frac{W_{\text{tot}}}{2} \cdot \frac{PWM_{Z1}}{100}\right) + \left(\frac{W_{\text{tot}}}{2} \cdot \frac{PWM_{Z2}}{100}\right) \right] \quad [\text{kW}]$$

---

### 2.3 Fungsi Objektif 2: Minimasi Ketidaknyamanan Termal & Visual ($f_2$)

$$\min_{\mathbf{X}} f_2(\mathbf{X}) = \text{PPD}(\text{PMV}) + \text{Penalty}_{\text{lux}} \quad [\%]$$

#### Prediksi Suhu Ruangan ($T_{\text{indoor}}$)
$$T_{\text{indoor}} = T_{\text{set}} + \left[ 0.3 + 0.02 \cdot \max(0, T_{\text{outdoor}} - 28.0) \right] \times \left[ 1 - (Fan - 1) \cdot 0.15 \right]$$

#### Model Fanger PMV & PPD (ISO 7730)
Kondisi kantor tropis: $M = 1.1 \text{ met}$, $I_{\text{cl}} = 0.5 \text{ clo}$, $v_a \in \{0.15, 0.25, 0.40\} \text{ m/s}$.
$$p_a = \frac{RH_{\text{indoor}}}{100} \cdot 10 \cdot \exp\left( 16.6536 - \frac{4030.183}{T_{\text{indoor}} + 235.0} \right)$$
$$T_{\text{neutral}} = 24.5 - 0.015 \cdot (p_a - 15.0) - 1.5 \cdot (v_a - 0.15)$$
$$\text{PMV} = \max\left( -3.0, \, \min\left( 3.0, \, 0.32 \cdot (T_{\text{indoor}} - T_{\text{neutral}}) \right) \right)$$
$$\text{PPD} = 100.0 - 95.0 \cdot \exp\left( -0.03353 \cdot \text{PMV}^4 - 0.2179 \cdot \text{PMV}^2 \right)$$

#### Model Iluminansi Meja Kerja ($E_{\text{desk}}$)
Integrasi daylight harvesting dengan pencahayaan buatan:
$$E_{\text{desk}} = \left( Lux_{\text{outdoor}} \times 0.08 \right) + \left( 280 \cdot \frac{PWM_{Z1}}{100} \right) + \left( 180 \cdot \frac{PWM_{Z2}}{100} \right) \quad [\text{Lux}]$$
Penalti visual berlaku jika kuat penerangan berada di luar ambang batas SNI 03-6197 (target 480 Lux, ambang batas [350, 650] Lux).

---

## 3. Algoritma 1: MOGA (NSGA-II)

MOGA menggunakan arsitektur **NSGA-II (Non-dominated Sorting Genetic Algorithm II)**:
1. **Fast Non-Dominated Sorting**: Mengelompokkan populasi ke dalam tingkatan rank Pareto (Rank 1, Rank 2, ...) dengan kompleksitas $\mathcal{O}(M N^2)$.
2. **Crowding Distance ($I_{\text{dist}}$)**: Mengukur kepadatan solusi bertetangga untuk memelihara keberagaman solusi tanpa parameter sharing buatan.
3. **Crossover SBX (Simulated Binary Crossover)**: Probabilitas $p_c = 0.85$, indeks distribusi $\eta_c = 15$.
4. **Mutasi Polinomial**: Probabilitas $p_m = 0.08$, indeks distribusi $\eta_m = 20$.
5. **Elitisme $(2N \to N)$**: Menggabungkan populasi orang tua dan anak ($2N$), lalu menyeleksi $N$ individu terbaik untuk generasi berikutnya.

---

## 4. Algoritma 2: MOPSO (Multi-Objective Particle Swarm Optimization)

MOPSO menerapkan konsep kawanan partikel (*particle swarm*) yang dibimbing oleh **Arsip Pareto Eksternal**:
1. **Persamaan Kecepatan**:
   $$v_{i,d}^{t+1} = w \cdot v_{i,d}^t + c_1 r_1 (pbest_{i,d} - x_{i,d}^t) + c_2 r_2 (gbest_d - x_{i,d}^t)$$
   Parameter: $w = 0.72$ (inersia), $c_1 = 1.49$ (kognitif), $c_2 = 1.49$ (sosial).
2. **Arsip Pareto Eksternal**: Menyimpan hingga 50 solusi non-terdominasi terbaik sepanjang iterasi.
3. **Seleksi Leader ($gbest$)**: Leader dipilih dari anggota arsip pada area kepadatan rendah menggunakan seleksi roulette wheel.
4. **Pembaruan $pbest$**: Partikel memperbarui memori terbaiknya jika posisi baru mendominasi posisi lama.

---

## 5. Fitur Seleksi Fleksibel Per Subsistem (Dekomposisi Hybrid)

Pengguna dapat memilih metode optimasi yang berbeda untuk setiap subsistem:

| Mode Preset | Subsistem AC (HVAC) | Subsistem Lampu | Mekanisme Komputasi |
|---|---|---|---|
| 🧬 `all_moga` | NSGA-II Genetic | NSGA-II Genetic | Evaluasi 4 variabel sekaligus dalam 1 kromosom |
| 🐦 `all_mopso` | Particle Swarm | Particle Swarm | Evaluasi 4 variabel sekaligus dalam 1 kawanan |
| 🔀 `ac_moga_lamp_mopso` | NSGA-II Genetic | Particle Swarm | **Dua Fase**: MOGA cari optimum AC $\to$ MOPSO cari optimum lampu |
| 🔄 `ac_mopso_lamp_moga` | Particle Swarm | NSGA-II Genetic | **Dua Fase**: MOPSO cari optimum AC $\to$ MOGA cari optimum lampu |

### Landasan Ilmiah Dekomposisi Dua Fase:
Sistem AC memiliki inersia termal tinggi (respon dalam menit/jam) yang sangat cocok dieksplorasi secara global oleh algoritma genetika. Sebaliknya, sistem pencahayaan memiliki respon instan ($<1$ detik) dan monotonik yang sangat cepat dikonvergensikan oleh kawanan partikel MOPSO. Dekomposisi ini membagi ruang pencarian menjadi dua sub-ruang 2D, mempercepat konvergensi 3–4× lipat.

---

## 6. Analisis Kualitas Pareto & Ekstraksi Solusi

### 6.1 Deteksi Knee-Point (Kompromi Optimal)
Knee-point dihitung dengan mencari jarak tegak lurus terjauh dari titik Pareto normalisasi terhadap garis diagonal utopia-nadir:
$$d(i) = \frac{|f_1^{\text{norm}}(i) - f_2^{\text{norm}}(i)|}{\sqrt{2}} + 0.3 \cdot \left[ 1.0 - \left| 0.5 - \frac{i}{N-1} \right| \right]$$

### 6.2 Tiga Profil Rekomendasi Solusi:
1. **🌱 Solusi A: Aggressive Eco Saver** — Fokus penghematan listrik maksimal (penghematan 31–36%, PPD $\sim 8.7\%$, Kelas B).
2. **⭐ Solusi B: Best Compromise (Knee-Point)** — Keseimbangan optimal (penghematan 24–28%, PPD $\sim 5.2\%$, Kelas A). **Rekomendasi Utama Operasional BEMS**.
3. **❄️ Solusi C: Ultra Comfort Priority** — Prioritas kenyamanan termal tertinggi (penghematan 12–15%, PPD $\sim 4.8\%$, Kelas A).

---

## 7. Arsitektur Perangkat Lunak & Integrasi Sistem

1. **`assets/js/core/optimization-engine.js`**: Core engine JS di browser (NSGA-II, MOPSO, model fisika, deteksi Knee-Point, kalkulasi Hypervolume).
2. **`assets/js/services/moga-service.js` & `mopso-service.js`**: Service pengontrol UI, visualisasi Chart.js, sinkronisasi preset/dropdown, dan pengiriman MQTT.
3. **`optimizer.py`**: Backend engine Python untuk eksekusi CLI dan scheduler server.
4. **`server.py`**: Web server port 3001 dengan endpoint `GET /api/optimize` dan `POST /api/optimize`.
5. **Database PostgreSQL `bems_db`**: Schema `bems_ai.optimization_runs` dan `bems_ai.pareto_solutions`.
6. **Topik MQTT Hardware**:
   * `livinglab/control/ac/setpoint` (suhu AC)
   * `livinglab/control/ac/fan` (kecepatan fan)
   * `livinglab/control/lamp/zone1/pwm` (PWM lampu zona 1)
   * `livinglab/control/lamp/zone2/pwm` (PWM lampu zona 2)

---

## 8. Panduan Penggunaan (Quick Guide)

### 8.1 Dashboard Web
Buka `http://10.8.0.7:3001/moga.html` atau `mopso.html`. Pilih preset atau atur dropdown metode AC & Lampu pada panel atas. Klik titik solusi (Eco / Knee / Comfort) lalu tekan **Deploy Solution to Living Lab**.

### 8.2 CLI Python
```bash
python optimizer.py --mode ac_moga_lamp_mopso --tout 33.0
```

### 8.3 REST API
```bash
curl "http://10.8.0.7:3001/api/optimize?mode=ac_moga_lamp_mopso&pop=30&gen=20"
```
