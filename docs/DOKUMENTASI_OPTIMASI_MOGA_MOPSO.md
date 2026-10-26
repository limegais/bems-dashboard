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

$$\min_{\mathbf{X}} f_2(\mathbf{X}) = \underbrace{\text{PPD}(\text{PMV})}_{\text{termal [\%]}} + \underbrace{P_{\text{lux}}}_{\text{visual [\%]}}$$

Kedua komponen dinyatakan dalam **satuan persen (%)** sehingga skalanya sebanding dan tidak ada komponen yang mendominasi secara artifisial.

#### Prediksi Suhu Ruangan ($T_{\text{indoor}}$)
$$T_{\text{indoor}} = T_{\text{set}} + \left[ 0.3 + 0.02 \cdot \max(0, T_{\text{outdoor}} - 28.0) \right] \times \left[ 1 - (Fan - 1) \cdot 0.15 \right]$$

> **Catatan validasi:** Suhu ruangan dipengaruhi beban panas internal (okupansi, peralatan, radiasi matahari), kelembapan, dan karakteristik aktual AC inverter. Kalibrasi koefisien model menggunakan data sensor SHT31 dan PZEM-004T aktual sangat dianjurkan.

#### Model Fanger PMV & PPD (ISO 7730)
Kondisi kantor tropis: $M = 1.1 \text{ met}$, $I_{\text{cl}} = 0.5 \text{ clo}$, $v_a \in \{0.15, 0.25, 0.40\} \text{ m/s}$.
$$p_a = \frac{RH_{\text{indoor}}}{100} \cdot \exp\left( 16.6536 - \frac{4030.183}{T_{\text{indoor}} + 235.0} \right) \quad [\text{kPa}]$$
$$T_{\text{neutral}} = 24.5 - 0.15 \cdot (p_a - 1.50) - 1.5 \cdot (v_a - 0.15) \quad [^\circ\text{C}]$$
$$\text{PMV} = \max\left( -3.0, \, \min\left( 3.0, \, 0.32 \cdot (T_{\text{indoor}} - T_{\text{neutral}}) \right) \right)$$
$$\text{PPD} = 100.0 - 95.0 \cdot \exp\left( -0.03353 \cdot \text{PMV}^4 - 0.2179 \cdot \text{PMV}^2 \right) \quad [\%]$$

> **Catatan Validasi & Keterbatasan Model PMV:**
> 1. Persamaan tekanan uap jenuh air $p_a$ di atas secara konsisten menghasilkan satuan **kPa** (faktor 10 dihilangkan).
> 2. Model PMV yang diimplementasikan pada mesin optimasi ini merupakan **model regresi linier surrogate terkalibrasi** yang dirancang untuk komputasi instan ($<1\,\mu\text{s}$) dalam loop evolusioner populasi besar. Model ini menyederhanakan $T_{\text{radiant}} \approx T_{\text{indoor}}$ dan tidak menjalankan iterasi implisit penuh neraca panas Fanger ISO 7730 (6 parameter dengan suhu permukaan pakaian $t_{\text{cl}}$).
> 3. Untuk benchmark kepatuhan standar formal dan riset komparatif, pustaka tervalidasi ISO 7730 (seperti `pythermalcomfort`) disarankan sebagai pembanding kontrol.

#### Model Iluminansi Meja Kerja ($E_{\text{desk}}$)
Integrasi daylight harvesting dengan pencahayaan buatan:
$$E_{\text{desk}} = \left( Lux_{\text{outdoor}} \times 0.08 \right) + \left( 280 \cdot \frac{PWM_{Z1}}{100} \right) + \left( 180 \cdot \frac{PWM_{Z2}}{100} \right) \quad [\text{Lux}]$$

> **Catatan validasi:** Koefisien (0.08, 280, 180) harus dikalibrasi dengan pengukuran lux-meter aktual. Nilai PWM algoritma menggunakan rentang 0–100%, sedangkan perangkat keras menggunakan 0–255: $PWM_{255} = \operatorname{round}(2.55 \cdot PWM_{\%})$.

#### Penalti Iluminansi Berbasis Persen ($P_{\text{lux}}$)
Target SNI 03-6197 = **480 Lux** dengan dead-band $\pm 50$ Lux $\Rightarrow$ zona toleransi $[430, 530]$ Lux:

$$P_{\text{lux}} = \begin{cases} \min\!\left(\dfrac{430 - E_{\text{desk}}}{430} \times 100 + \delta_{\text{hard}},\; 95\right) & E_{\text{desk}} < 430 \\ 0 & 430 \leq E_{\text{desk}} \leq 530 \\ \min\!\left(\dfrac{E_{\text{desk}} - 530}{530} \times 50,\; 30\right) & E_{\text{desk}} > 530 \end{cases}$$

di mana:
$$\delta_{\text{hard}} = w_{\text{hard}} \times \frac{\max(0,\, 350 - E_{\text{desk}})}{350} \times 100 \quad [\%]$$
dengan bobot $w_{\text{hard}} = 0.5$. Komponen $\delta_{\text{hard}}$ dinormalisasi terhadap ambang 350 Lux sehingga berdimensi murni persen (%) yang setara dengan penalti proporsional, dan pembatasan maksimum (cap 95%) diterapkan di akhir setelah seluruh komponen penalti dijumlahkan.

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

1. **Persamaan Kecepatan** dengan batas kecepatan $v_{\max} = 0.2 \times (x_{\max} - x_{\min})$ per dimensi:
   $$v_{i,d}^{t+1} = \operatorname{clip}\!\left(w \cdot v_{i,d}^t + c_1 r_1 (pbest_{i,d} - x_{i,d}^t) + c_2 r_2 (gbest_d - x_{i,d}^t),\; -v_{\max},\; v_{\max}\right)$$
   Parameter: $w = 0.72$ (inersia), $c_1 = 1.49$ (kognitif), $c_2 = 1.49$ (sosial).

2. **Arsip Pareto Eksternal**: Menyimpan hingga 50 solusi non-terdominasi. Pemangkasan menggunakan **crowding distance**: solusi pada area padat (CD kecil) dibuang lebih dahulu untuk mempertahankan keberagaman front.

3. **Seleksi Leader ($gbest$) — Roulette Wheel berbasis Crowding Distance**: Leader dipilih secara probabilistik dari arsip; solusi dengan CD besar (area jarang) mendapat bobot lebih tinggi, mendorong eksplorasi bagian Pareto front yang belum terjamah.

4. **Pembaruan $pbest$**:
   - Jika $x_i^{t+1}$ **mendominasi** $pbest_i$: selalu update.
   - Jika keduanya **non-dominated**: update dengan probabilitas 0.5.
   - Jika $pbest_i$ **mendominasi** $x_i^{t+1}$: tidak update.

5. **Penanganan Variabel Diskrit $FanSpeed \in \{1,2,3\}$**: Kecepatan dihitung kontinu; posisi diklem ke domain dan dibulatkan ke bilangan bulat valid setelah setiap iterasi.

---

## 5. Fitur Seleksi Fleksibel Per Subsistem (Dekomposisi Hybrid)

Pengguna dapat memilih metode optimasi yang berbeda untuk setiap subsistem:

| Mode Preset | Subsistem AC (HVAC) | Subsistem Lampu | Mekanisme Komputasi |
|---|---|---|---|
| 🧬 `all_moga` | NSGA-II Genetic | NSGA-II Genetic | Evaluasi 4 variabel sekaligus dalam 1 kromosom |
| 🐦 `all_mopso` | Particle Swarm | Particle Swarm | Evaluasi 4 variabel sekaligus dalam 1 kawanan |
| 🔀 `ac_moga_lamp_mopso` | NSGA-II Genetic | Particle Swarm | **Dua Fase**: MOGA cari optimum AC $\to$ MOPSO cari optimum lampu |
| 🔄 `ac_mopso_lamp_moga` | Particle Swarm | NSGA-II Genetic | **Dua Fase**: MOPSO cari optimum AC $\to$ MOGA cari optimum lampu |

### Landasan Ilmiah & Evaluasi Dekomposisi Dua Fase:
Sistem AC memiliki inersia termal tinggi (respon dalam menit/jam) yang sangat cocok dieksplorasi secara global oleh algoritma genetika. Sebaliknya, sistem pencahayaan memiliki respon instan ($<1$ detik) dan monotonik yang sangat cepat dikonvergensikan oleh kawanan partikel MOPSO. 

#### Prosedur Re-evaluasi Global Pasca-Dekomposisi (Poin D):
Untuk mencegah degradasi akibat penggabungan sub-ruang solusi yang terpisah:
1. Setelah Fase 1 (AC) menghasilkan knee setpoint ($T_{\text{set}}^*, Fan^*$) dan Fase 2 (Lampu) menghasilkan rentang dimmer ($PWM_{Z1}^*, PWM_{Z2}^*$), seluruh kandidat solusi gabungan $\mathbf{X} = [T_{\text{set}}^*, PWM_{Z1}^*, PWM_{Z2}^*, Fan^*]$ **wajib dievaluasi ulang secara utuh** menggunakan fungsi objektif global lengkap:
   $$f_1(\mathbf{X}) = P_{\text{AC}}(T_{\text{set}}^*, T_{\text{out}}, Fan^*) + P_{\text{Lamp}}(PWM_{Z1}^*, PWM_{Z2}^*)$$
   $$f_2(\mathbf{X}) = \text{PPD}(T_{\text{in}}, RH, v_a) + P_{\text{lux}}(E_{\text{desk}})$$
2. Himpunan solusi gabungan kemudian disaring melalui filter non-dominasi ketat (*Pareto dominance filter*) untuk memastikan seluruh solusi akhir benar-benar merupakan anggota Pareto front non-kalah yang valid.

> **Catatan Benchmark & Keterbatasan Klaim (Poin D):**
> Klaim penghematan energi $\approx 24.8\%$, reduksi waktu komputasi hingga $\approx 60\%$, metrik Hypervolume $0.935\text{--}0.942$, dan waktu komputasi di bawah $200\text{ ms}$ merupakan **target desain dan hasil estimasi awal simulasi (preliminary benchmarks)**. Pengukuran konsumsi energi kWh aktual jangka panjang melalui submetering PZEM-004T serta pencatatan latency riil pada server Living Lab diperlukan sebelum angka tersebut dinyatakan sebagai performa empiris terverifikasi.

---

## 6. Analisis Kualitas Pareto & Ekstraksi Solusi

### 6.1 Deteksi Knee-Point (Kompromi Optimal Trade-Off)

Knee-point merepresentasikan titik pada Pareto front dengan perubahan *marginal rate of substitution* (MRS) paling tajam, di mana perbaikan kecil pada penghematan daya akan menyebabkan lonjakan ketidaknyamanan termal/visual yang drastis.

#### Metode Jarak Maksimum Garis Penghubung Titik Ekstrem (Poin C):
1. **Normalisasi Min-Max:** Kedua objektif dinormalisasi ke rentang $[0, 1]$ berdasarkan batas ekstrem aktual front:
   $$p_{x,i} = \frac{f_1(s_i) - f_{1,\min}}{f_{1,\max} - f_{1,\min}}, \quad p_{y,i} = \frac{f_2(s_i) - f_{2,\min}}{f_{2,\max} - f_{2,\min}}$$
2. **Identifikasi Titik Ekstrem Aktual:**
   - Titik $A = (p_{x,A}, p_{y,A})$: Solusi dengan $f_1$ minimum (daya terendah, $p_{x,A} = 0$).
   - Titik $B = (p_{x,B}, p_{y,B})$: Solusi dengan $f_2$ minimum (ketidaknyamanan terendah, $p_{y,B} = 0$).
   - Vektor garis chord penghubung $AB$: $\vec{v}_{AB} = (dx, dy) = (p_{x,B} - p_{x,A}, \; p_{y,B} - p_{y,A})$ dengan panjang $L_{AB} = \sqrt{dx^2 + dy^2}$.
3. **Jarak Tegak Lurus Bertanda (Signed Perpendicular Distance):**
   Untuk setiap titik $P_i = (p_{x,i}, p_{y,i})$ pada front:
   $$d_{\text{chord}}(P_i) = \frac{dx \cdot (p_{y,A} - p_{y,i}) - dy \cdot (p_{x,A} - p_{x,i})}{L_{AB}}$$
   - **Orientasi Kelengkungan (Trade-off):** Untuk permasalahan minimisasi, titik ideal (utopia) berada di $(0,0)$. Titik-titik Pareto yang melengkung secara konveks ke arah origin memiliki $d_{\text{chord}} > 0$. Titik dengan $d_{\text{chord}}$ positif terbesar dipilih sebagai knee-point.
   - **Syarat Bentuk Front:** Jika front berbentuk datar/linear atau konkaf ($d_{\text{chord}} \leq 0$ untuk semua titik), algoritma menggunakan titik terdekat ke titik utopia $(0,0)$ via jarak Euclidean $\sqrt{p_{x,i}^2 + p_{y,i}^2}$ sebagai fallback.

### 6.2 Tiga Profil Rekomendasi Solusi:
1. **🌱 Solusi A: Aggressive Eco Saver** — Fokus penghematan listrik maksimal (estimasi penghematan 31–36%, PPD $\sim 8.7\%$, Kelas B).
2. **⭐ Solusi B: Best Compromise (Knee-Point)** — Keseimbangan optimal trade-off (estimasi penghematan 24–28%, PPD $\sim 5.2\%$, Kelas A). **Rekomendasi Utama Operasional BEMS**.
3. **❄️ Solusi C: Ultra Comfort Priority** — Prioritas kenyamanan termal tertinggi (estimasi penghematan 12–15%, PPD $\sim 4.8\%$, Kelas A).

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
