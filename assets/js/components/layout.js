// Navigasi bersama untuk semua halaman mockup BEMS/Living Lab Dashboard
const NAV_SECTIONS = [
  {
    label: "Overview",
    items: [{ key: "dashboard", label: "Dashboard", href: "index.html" }],
  },
  {
    label: "Monitoring",
    items: [
      { key: "indoor", label: "Indoor Environment", href: "indoor.html" },
      { key: "outdoor", label: "Outdoor Environment", href: "outdoor.html" },
      { key: "occupancy", label: "Occupancy", href: "occupancy.html" },
      { key: "energy", label: "Energy", href: "energy.html" },
    ],
  },
  {
    label: "Control",
    items: [
      { key: "ac-control", label: "AC Monitoring & Control", href: "ac-control.html" },
      { key: "lighting-control", label: "Lighting Monitoring & Control", href: "lighting-control.html" },
      { key: "experiment-mode", label: "Operating / Experiment Mode", href: "experiment-mode.html" },
      { key: "adaptive-control", label: "Adaptive Control", href: "adaptive-control.html" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { key: "prediction", label: "Prediction", href: "prediction.html" },
      { key: "moga", label: "MOGA Optimization", href: "moga.html" },
      { key: "mopso", label: "MOPSO Optimization", href: "mopso.html" },
    ],
  },
  {
    label: "Comfort & Data",
    items: [
      { key: "comfort-feedback", label: "Comfort Feedback", href: "comfort-feedback.html" },
      { key: "thermal-evaluation", label: "Thermal & MRT Evaluation", href: "thermal-evaluation.html" },
      { key: "historical", label: "Historical Data & Trends", href: "historical.html" },
    ],
  },
];

function renderSidebar(activeKey) {
  const root = document.getElementById("sidebar-root");
  if (!root) return;
  const session = Session.require();
  if (!session) return;

  const sectionIconMap = {
    Overview: '<svg viewBox="0 0 24 24" class="mini-nav-icon" aria-hidden="true"><path d="M3 13.2L12 5l9 8.2v6.3a1 1 0 0 1-1 1h-5.2v-6h-5.6v6H4a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    Monitoring: '<svg viewBox="0 0 24 24" class="mini-nav-icon" aria-hidden="true"><path d="M4 19h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M7 16l3.2-3.4 2.7 2.3 4.1-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    Control: '<svg viewBox="0 0 24 24" class="mini-nav-icon" aria-hidden="true"><circle cx="12" cy="12" r="7.4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/></svg>',
    Intelligence: '<svg viewBox="0 0 24 24" class="mini-nav-icon" aria-hidden="true"><path d="M12 3.8l6.8 3.9v8.6L12 20.2 5.2 16.3V7.7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.3 11.8h5.4M9.3 14.6h3.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    "Comfort & Data": '<svg viewBox="0 0 24 24" class="mini-nav-icon" aria-hidden="true"><path d="M12 20s-6.5-3.8-6.5-8.7a3.7 3.7 0 0 1 6.5-2.4 3.7 3.7 0 0 1 6.5 2.4C18.5 16.2 12 20 12 20z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  };

  const sections = NAV_SECTIONS.map((section) => {
    const sectionIsActive = section.items.some((item) => item.key === activeKey);
    const icon = sectionIconMap[section.label] || sectionIconMap.Overview;
    const items = section.items
      .map((item) => {
        const active = item.key === activeKey ? "active" : "";
        const current = item.key === activeKey ? ' aria-current="page"' : "";
        return `<a class="mini-nav-item ${active}" href="${item.href}"${current}><span>${item.label}</span></a>`;
      })
      .join("");
    return `
      <div class="mini-nav-group">
        <button class="mini-nav-trigger ${sectionIsActive ? "active" : ""}" type="button" aria-label="${section.label}">${icon}<span class="mini-nav-sr">${section.label}</span></button>
        <div class="mini-nav-flyout" role="menu" aria-label="${section.label}">
          <p class="mini-nav-title">${section.label}</p>
          <div class="mini-nav-list">${items}</div>
        </div>
      </div>`;
  }).join("");

  root.innerHTML = `
    <div class="sidebar-overlay" id="sidebar-overlay"></div>
    <aside id="sidebar-shell" class="mini-sidebar-shell shrink-0 h-screen sticky top-0 flex flex-col">
      <div class="mini-sidebar-brand" aria-label="BEMS Living Lab">B</div>
      <div class="mini-sidebar-logo">BEMS</div>
      <nav class="mini-sidebar-nav" aria-label="Navigasi utama">${sections}</nav>
      <div class="mini-sidebar-foot" title="Lingkungan demonstrasi">DEMO</div>
    </aside>`;

  const groupNodes = root.querySelectorAll(".mini-nav-group");
  groupNodes.forEach((group) => {
    const trigger = group.querySelector(".mini-nav-trigger");
    if (!trigger) return;
    trigger.addEventListener("click", () => {
      const hasOpen = group.classList.contains("open");
      groupNodes.forEach((node) => node.classList.remove("open"));
      if (!hasOpen) group.classList.add("open");
    });
  });

  document.addEventListener("click", (event) => {
    if (!root.contains(event.target)) {
      groupNodes.forEach((node) => node.classList.remove("open"));
    }
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      groupNodes.forEach((node) => node.classList.remove("open"));
    }
  });

  const overlay = document.getElementById("sidebar-overlay");
  if (overlay) {
    overlay.addEventListener("click", () => {
      document.body.classList.remove("sidebar-open");
      groupNodes.forEach((node) => node.classList.remove("open"));
    });
  }
}

function renderTopbar(title, subtitle) {
  const root = document.getElementById("topbar-root");
  if (!root) return;
  const session = Session.require();
  if (!session) return;

  const tone = Preferences.getTone();
  const theme = Preferences.getTheme();
  Preferences.applyTheme(theme);
  Preferences.applyTone(tone);
  const now = new Date();
  const dateText = now.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }).replace(/\./g, "");
  const timeText = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

  root.innerHTML = `
    <header class="topbar-shell sticky top-0 z-10">
      <div class="topbar-row px-6 py-2">
        <div class="topbar-left">
          <p class="topbar-breadcrumb">Workspace / Monitoring / ${title}</p>
        </div>
        <p class="topbar-project">Untitled</p>
        <div class="topbar-right">
          <span class="demo-badge">Data demo</span>
          <span class="topbar-date">${dateText} · ${timeText} WIB</span>
          <button id="logout-btn" class="topbar-link" aria-label="Keluar">Keluar</button>
        </div>
      </div>
    </header>`;

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      Session.clear();
      window.location.href = APP_CONFIG.ROUTES.login;
    });
  }
}
