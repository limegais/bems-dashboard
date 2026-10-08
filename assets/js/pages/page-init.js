// Merender KPI dan caption chart ke container halaman dari data service.
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

const STATUS_LABELS = { ok: "Normal", warn: "Peringatan", bad: "Bermasalah" };

function renderKpiGrid(targetId, items, plain) {
  const root = document.getElementById(targetId);
  if (!root || !items) return;

  root.innerHTML = items
    .map((item) => {
      const label = escapeHtml(item.label);
      const value = escapeHtml(item.value);

      if (plain) {
        return `<div><p class="text-xs text-slate-400">${label}</p><p class="${escapeHtml(item.valueClass || "text-white font-medium")}">${value}</p></div>`;
      }

      const valueClass = escapeHtml(item.valueClass || "text-2xl font-semibold text-white mt-1");
      const note = item.note ? `<p class="text-xs ${escapeHtml(item.noteClass || "text-slate-500")} mt-1">${escapeHtml(item.note)}</p>` : "";
      const statusDot = STATUS_LABELS[item.status]
        ? `<span class="status-dot status-${item.status} mt-2 inline-block" role="img" aria-label="Status: ${STATUS_LABELS[item.status]}"></span>`
        : "";

      return `<div class="card p-4"><p class="text-xs text-slate-400">${label}</p><p class="${valueClass}">${value}</p>${note}${statusDot}</div>`;
    })
    .join("");
}

function applyChartCaptions(captions) {
  if (!captions) return;
  Object.keys(captions).forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = captions[id];
  });
}

function showLoadError() {
  const main = document.getElementById("main-content");
  if (!main) return;
  const banner = document.createElement("div");
  banner.className = "card p-4 text-sm text-red-400";
  banner.setAttribute("role", "alert");
  banner.textContent = "Data tidak dapat dimuat dari server. Coba muat ulang halaman.";
  main.prepend(banner);
}

async function initPageData(pageKey) {
  let data;
  try {
    data = await PageDataService.get(pageKey);
  } catch (error) {
    console.error(`Gagal memuat data halaman "${pageKey}":`, error);
    showLoadError();
    return;
  }
  if (!data) return;

  if (data.kpiGroups) {
    data.kpiGroups.forEach((group) => renderKpiGrid(group.target, group.items, group.plain));
  }
  applyChartCaptions(data.charts);
}
