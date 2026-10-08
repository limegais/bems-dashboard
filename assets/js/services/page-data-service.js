// Kontrak API: GET /pages/{pageKey} -> objek dengan bentuk yang sama seperti MOCK_PAGE_DATA[pageKey]
const PageDataService = {
  async get(pageKey) {
    if (APP_CONFIG.USE_MOCK) return MOCK_PAGE_DATA[pageKey] || null;
    return ApiClient.get(APP_CONFIG.ENDPOINTS.pageData(pageKey));
  },
};
