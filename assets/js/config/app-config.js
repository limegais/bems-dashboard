// Satu-satunya tempat untuk mengatur koneksi backend. Ubah USE_MOCK ke false untuk memakai API sungguhan.
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
    BROKER_URL: "ws://128.199.206.166:9001", // HARUS port WebSockets, bukan 1883
    OPTIONS: {
      clientId: "bems_dashboard_" + Math.random().toString(16).substr(2, 8),
      username: "user_1",
      password: "__**password_not_changed**__",
    },
    TOPICS: {
      indoor: "neobms/indoor/#",
      outdoor: "nnzn/weather/#"
    }
  }
};
