// Kontrak API: POST /auth/login { username, password } -> { token, user, role }
const AuthService = {
  async login(username, password) {
    const u = (username || "").trim().toLowerCase();
    const p = (password || "").trim();

    // Kredensial Resmi BEMS Living Lab (admin & user: iotlabftuns2023)
    if (p === "iotlabftuns2023") {
      if (u === "admin" || u === "superadmin") {
        return { token: "bems-token-" + Date.now(), user: "admin", role: "Admin" };
      }
      if (u === "user" || u === "occupant") {
        return { token: "bems-token-" + Date.now(), user: "user", role: "Occupant" };
      }
    }

    // Cek akun mock lainnya jika USE_MOCK true atau sebagai fallback lokal
    const checkMock = () => {
      if (typeof MOCK_ACCOUNTS !== "undefined") {
        const account = MOCK_ACCOUNTS.find(
          (item) => item.username.toLowerCase() === u && item.password === p
        );
        if (account) {
          return { token: "mock-token-" + Date.now(), user: account.username, role: account.role };
        }
      }
      return null;
    };

    if (APP_CONFIG.USE_MOCK) {
      const mockResult = checkMock();
      if (!mockResult) throw new ApiError("Kredensial tidak valid", 401);
      return mockResult;
    }

    try {
      const result = await ApiClient.post(APP_CONFIG.ENDPOINTS.login, { username, password });
      return { token: result.token, user: result.user, role: result.role };
    } catch (err) {
      // Fallback ke akun lokal jika backend belum berjalan
      const mockResult = checkMock();
      if (mockResult) return mockResult;
      throw err;
    }
  },
};
