# BEMS / Living Lab Dashboard — Mockup

Mockup statis (HTML + Tailwind via CDN) untuk preview struktur halaman dashboard sebelum development Next.js.

## Cara Membuka

Buka file `index.html` langsung di browser (double click), atau jalankan live server:

```powershell
cd bems-dashboard-mockup
npx serve .
```

## Struktur Halaman

- `index.html` — Dashboard utama (ringkasan KPI)
- `indoor.html` — Indoor Environment Monitoring
- `outdoor.html` — Outdoor Environment Monitoring
- `occupancy.html` — Occupancy Monitoring
- `energy.html` — Energy Monitoring
- `ac-control.html` — AC Monitoring & Control
- `lighting-control.html` — Lighting Monitoring & Control
- `prediction.html` — Prediction
- `moga.html` — MOGA Optimization
- `mopso.html` — MOPSO Optimization
- `adaptive-control.html` — Adaptive Control
- `experiment-mode.html` — Operating / Experiment Mode
- `comfort-feedback.html` — Thermal & Visual Comfort Feedback
- `thermal-evaluation.html` — Thermal Comfort & MRT Evaluation
- `historical.html` — Historical Data & Trends
- `login.html` — Login

## Struktur Folder

```
assets/
  css/style.css                     tema dan styling di luar Tailwind
  js/
    config/app-config.js            USE_MOCK, API_BASE_URL, ENDPOINTS, ROUTES (satu-satunya tempat konfigurasi)
    core/api-client.js              wrapper fetch: base URL, Bearer token, timeout, 401
    core/session.js                 Session (login) dan Preferences (tema/tone)
    services/auth-service.js        login (mock atau API)
    services/page-data-service.js   ambil data per halaman (mock atau API)
    components/layout.js            sidebar dan topbar
    pages/page-init.js              render KPI dan caption chart dari data service
    pages/login.js                  logika halaman login
    mock/                           data contoh; hapus saat backend siap
```

## Menyambungkan ke Backend

1. Di `assets/js/config/app-config.js` set `USE_MOCK: false` dan isi `API_BASE_URL`.
2. Backend perlu menyediakan:
   - `POST /auth/login` body `{ username, password }`, respons `{ token, user, role }`
   - `GET /pages/{pageKey}` (header `Authorization: Bearer <token>`), respons berbentuk sama dengan `MOCK_PAGE_DATA[pageKey]` di `assets/js/mock/page-data.js` (`kpiGroups`, `charts`)
3. `pageKey` mengikuti kunci pada `MOCK_PAGE_DATA` (mis. `dashboard`, `indoor`, `ac-control`).
4. Backend harus mengizinkan CORS dari origin dashboard.