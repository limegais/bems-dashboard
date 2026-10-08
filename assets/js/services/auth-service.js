// Kontrak API: POST /auth/login { username, password } -> { token, user, role }
const AuthService = {
  async login(username, password) {
    if (APP_CONFIG.USE_MOCK) {
      const account = MOCK_ACCOUNTS.find((item) => item.username === username && item.password === password);
      if (!account) throw new ApiError("Kredensial tidak valid", 401);
      return { token: null, user: account.username, role: account.role };
    }

    const result = await ApiClient.post(APP_CONFIG.ENDPOINTS.login, { username, password });
    return { token: result.token, user: result.user, role: result.role };
  },
};
