// Wrapper fetch tunggal: base URL, token Bearer, timeout, dan penanganan 401.
class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const ApiClient = {
  async request(path, { method = "GET", body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), APP_CONFIG.REQUEST_TIMEOUT_MS);

    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = Session.token();
    if (token) headers.Authorization = `Bearer ${token}`;

    let response;
    try {
      response = await fetch(APP_CONFIG.API_BASE_URL + path, {
        method,
        headers,
        signal: controller.signal,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new ApiError("Unable to connect to server", 0);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 && token) {
      Session.clear();
      window.location.href = APP_CONFIG.ROUTES.login;
    }
    if (!response.ok) {
      throw new ApiError(`HTTP ${response.status}`, response.status);
    }
    return response.json();
  },

  get(path) {
    return this.request(path);
  },

  post(path, body) {
    return this.request(path, { method: "POST", body });
  },
};
