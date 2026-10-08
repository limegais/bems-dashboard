// Penyimpanan sesi login dan preferensi tampilan di localStorage.
const Session = {
  KEY: "bems-session",

  get() {
    try {
      const raw = localStorage.getItem(this.KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  save(session) {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(session));
    } catch (e) {
      // Abaikan error storage pada browser yang dibatasi.
    }
  },

  clear() {
    try {
      localStorage.removeItem(this.KEY);
    } catch (e) {
      // Abaikan error storage pada browser yang dibatasi.
    }
  },

  token() {
    const session = this.get();
    return session && session.token ? session.token : null;
  },

  require() {
    const session = this.get();
    if (!session) {
      window.location.href = APP_CONFIG.ROUTES.login;
      return null;
    }
    return session;
  },
};

const Preferences = {
  TONE_KEY: "bems-tone",
  THEME_KEY: "bems-theme",

  getTone() {
    try {
      return localStorage.getItem(this.TONE_KEY) || "neutral";
    } catch (e) {
      return "neutral";
    }
  },

  getTheme() {
    try {
      return localStorage.getItem(this.THEME_KEY) || "light";
    } catch (e) {
      return "light";
    }
  },

  saveTone(tone) {
    try {
      localStorage.setItem(this.TONE_KEY, tone);
    } catch (e) {
      // Abaikan error storage pada browser yang dibatasi.
    }
  },

  saveTheme(theme) {
    try {
      localStorage.setItem(this.THEME_KEY, theme);
    } catch (e) {
      // Abaikan error storage pada browser yang dibatasi.
    }
  },

  applyTone(tone) {
    document.body.setAttribute("data-tone", tone === "corporate" ? "corporate" : "neutral");
  },

  applyTheme(theme) {
    document.body.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
  },
};
