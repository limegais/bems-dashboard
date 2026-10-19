// Kontrak API: POST /auth/login { username, password } -> { token, user, role }
const AuthService = {
  async login(username, password) {
    // Cek akun mock terlebih dahulu jika USE_MOCK true atau sebagai fallback lokal
    const checkMock = () => {
      if (typeof MOCK_ACCOUNTS !== "undefined") {
        const account = MOCK_ACCOUNTS.find(
          (item) => item.username.toLowerCase() === username.toLowerCase() && item.password === password
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
