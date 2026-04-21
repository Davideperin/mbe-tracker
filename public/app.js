// ── STATE ──────────────────────────────────────────────
const state = {
  shipments: [],
  notes: {},       // masterTracking → note text
  filter: "ALL",
  loading: false,
  lastSync: null,
};

// ── STORAGE ─────────────────────────────────────────────
function saveLocal() {
  try {
    localStorage.setItem("mbe_notes", JSON.stringify(state.notes));
    localStorage.setItem("mbe_last_sync", state.lastSync || "");
    localStorage.setItem("mbe_cache", JSON.stringify(state.shipments));
  } catch {}
}

function loadLocal() {
  try {
    state.notes = JSON.parse(localStorage.getItem("mbe_notes") || "{}");
    state.lastSync = localStorage.getItem("mbe_last_sync") || null;
    const cache = localStorage.getItem("mbe_cache");
    if (cache) state.shipments = JSON.parse(cache);
  } catch {}
}

// ── API ─────────────────────────────────────────────────
async function fetchShipments() {
  setLoading(true);
  try {
    const dateFrom = "2024-01-01";
    const dateTo = new Date().toISOString().slice(0, 10);
    const url = `/api/mbe-proxy?action=search&dateFrom=${dateFrom}&dateTo=${dateTo}&state=ALL`;
    const resp = await fetch(url);
    const json = await resp.json();

    if (json.ok && json.data) {
      state.shipments = json.data.map(enrichShipment);
      state.lastSync = new Date().toLocaleString("it-IT");
      saveLocal();
      showToast("Spedizioni aggiornate ✓");
    } else {
      showToast("Errore API: " + (json.error || "risposta non valida"));
    }
  } catch (e) {
    // Offline: use cache
    if (state.shipments.length > 0) {
      showToast("Offline – mostro dati in cache");
    } else {
      showToast("Nessuna connessione e nessun dato in cache");
    }
  }
  setLoading(false);
  render();
}

async function fetchDetail(masterTracking) {
  try {
    const url = `/api/mbe-proxy?action=detail&tracking=${encodeURIComponent(masterTracking)}`;
    const resp = await fetch(url);
    const json = await resp.json();
    if (json.ok && json.data && json.data.length > 0) {
      const s = state.shipments.find(x => x.masterTracking === masterTracking);
      if (s) {
        s.events = json.data;
        s.eventsLoaded = true;
        saveLocal();
        render();
      }
    }
  } catch {}
}

// ── DATA ENRICHMENT ─────────────────────────────────────
function enrichShipment(s) {
  return {
    ...s,
    status: normalizeStatus(s.state),
    progress: statusProgress(s.state),
    eventsLoaded: false,
    events: s.events || [],
  };
}

function normalizeStatus(state) {
  if (!state) return "pending";
  const s = state.toLowerCase();
  if (s.includes("consegn") || s.includes("delivered") || s === "d") return "delivered";
  if (s.includes("transit") || s.includes("corso") || s === "t" || s.includes("smist")) return "transit";
  if (s.includes("eccez") || s.includes("exception") || s === "e") return "exception";
  return "pending";
}

function statusProgress(state) {
  const s = normalizeStatus(state);
  return { delivered: 100, transit: 60, exception: 40, pending: 15 }[s] || 15;
}

function statusLabel(s) {
  return { transit: "In transito", delivered: "Consegnato", pending: "In attesa", exception: "Eccezione" }[s] || "Sconosciuto";
}

// ── RENDER ───────────────────────────────────────────────
function render() {
  renderStats();
  renderList();
  document.getElementById("last-sync").textContent = state.lastSync ? `Aggiornato: ${state.lastSync}` : "Non ancora sincronizzato";
}

function renderStats() {
  const all = state.shipments;
  document.getElementById("stat-all").textContent = all.length;
  document.getElementById("stat-transit").textContent = all.filter(s => s.status === "transit").length;
  document.getElementById("stat-delivered").textContent = all.filter(s => s.status === "delivered").length;
  document.getElementById("stat-exception").textContent = all.filter(s => s.status === "exception").length;
}

function renderList() {
  const container = document.getElementById("shipment-list");
  let list = state.shipments;

  if (state.filter !== "ALL") {
    list = list.filter(s => s.status === state.filter.toLowerCase());
  }

  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="2" y="7" width="20" height="15" rx="2"/><path d="M16 7V5a2 2 0 0 0-4 0v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>
      </svg>
      <p>${state.shipments.length === 0 ? 'Premi ↺ per caricare le spedizioni da MBE' : 'Nessuna spedizione con questo filtro'}</p>
    </div>`;
    return;
  }

  container.innerHTML = list.map(s => renderCard(s)).join("");
}

function renderCard(s) {
  const note = state.notes[s.masterTracking] || "";
  const eventsHtml = s.eventsLoaded && s.events.length > 0
    ? `<div class="events-panel">${s.events.slice(0, 4).map((e, i) => `
        <div class="event-item">
          <div class="event-dot ${i === 0 ? "latest" : ""}"></div>
          <span class="event-time">${e.date || ""} ${e.time || ""}</span>
          <span class="event-desc">${e.location ? e.location + " — " : ""}${e.description || ""}</span>
        </div>`).join("")}
      </div>` : "";

  const upsTracking = s.courierTracking || "";
  const upsLink = upsTracking
    ? `<a href="https://www.ups.com/track?tracknum=${upsTracking}&loc=it_IT" target="_blank" style="color:var(--blue);text-decoration:none;font-size:11px;font-family:monospace;">${upsTracking} ↗</a>`
    : `<span style="color:var(--text-faint);font-size:11px;">non ancora assegnato</span>`;

  return `<div class="shipment-card" id="card-${s.masterTracking}">
    <div class="card-header">
      <div class="card-left">
        <div class="card-recipient">${s.recipient || "Destinatario sconosciuto"}</div>
        <div class="card-ref">${s.city || ""}${s.country && s.country !== "IT" ? " · " + s.country : ""}${s.reference ? " · Rif: " + s.reference : ""}</div>
        <div class="card-tracking">MBE: ${s.masterTracking || "—"}</div>
      </div>
      <span class="badge badge-${s.status}">${statusLabel(s.status)}</span>
    </div>

    <div class="card-progress">
      <div class="progress-fill fill-${s.status}" style="width:${s.progress}%"></div>
    </div>

    <div class="card-details">
      <div class="detail-row">
        <span class="detail-label">Mittente</span>
        <span class="detail-value">${s.sender || "—"}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Corriere</span>
        <span class="detail-value">${s.courier || "UPS"}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Servizio</span>
        <span class="detail-value">${s.service || "—"}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Data</span>
        <span class="detail-value">${formatDate(s.date)}</span>
      </div>
      <div class="detail-row" style="grid-column: 1 / -1;">
        <span class="detail-label">Tracking UPS</span>
        <span class="detail-value">${upsLink}</span>
      </div>
    </div>

    ${note ? `<div class="card-note">📝 ${escapeHtml(note)}</div>` : ""}

    ${eventsHtml}

    <div class="card-footer">
      <button class="btn-sm" onclick="toggleEvents('${s.masterTracking}')">
        ${s.eventsLoaded ? "Nascondi" : "📍 Storico"}
      </button>
      <button class="btn-sm" onclick="openNoteModal('${s.masterTracking}')">✏️ Nota</button>
      ${upsTracking ? `<button class="btn-sm primary" onclick="openUPS('${upsTracking}')">Traccia UPS</button>` : ""}
      <button class="btn-sm danger" onclick="deleteShipment('${s.masterTracking}')">🗑 Rimuovi</button>
    </div>
  </div>`;
}

// ── ACTIONS ──────────────────────────────────────────────
function setFilter(f) {
  state.filter = f;
  document.querySelectorAll(".filter-chip").forEach(c => {
    c.classList.toggle("active", c.dataset.filter === f);
  });
  render();
}

function toggleEvents(masterTracking) {
  const s = state.shipments.find(x => x.masterTracking === masterTracking);
  if (!s) return;
  if (!s.eventsLoaded) {
    fetchDetail(masterTracking);
  } else {
    s.eventsLoaded = false;
    render();
  }
}

function openUPS(tracking) {
  window.open(`https://www.ups.com/track?tracknum=${tracking}&loc=it_IT`, "_blank");
}

async function deleteShipment(masterTracking) {
  if (!confirm("Rimuovere questa spedizione?")) return;
  state.shipments = state.shipments.filter(s => s.masterTracking !== masterTracking);
  delete state.notes[masterTracking];
  saveLocal();
  render();
  showToast("Spedizione rimossa");
}

// ── NOTE MODAL ───────────────────────────────────────────
let currentNoteTracking = null;

function openNoteModal(masterTracking) {
  currentNoteTracking = masterTracking;
  const s = state.shipments.find(x => x.masterTracking === masterTracking);
  document.getElementById("note-modal-title").textContent = s ? (s.recipient || masterTracking) : masterTracking;
  document.getElementById("note-input").value = state.notes[masterTracking] || "";
  document.getElementById("note-modal").classList.add("open");
}

function closeNoteModal() {
  document.getElementById("note-modal").classList.remove("open");
  currentNoteTracking = null;
}

function saveNote() {
  if (!currentNoteTracking) return;
  const text = document.getElementById("note-input").value.trim();
  if (text) {
    state.notes[currentNoteTracking] = text;
  } else {
    delete state.notes[currentNoteTracking];
  }
  saveLocal();
  closeNoteModal();
  render();
  showToast("Nota salvata");
}

// ── MANUAL ADD MODAL ─────────────────────────────────────
function openAddModal() {
  document.getElementById("add-modal").classList.add("open");
  document.getElementById("add-tracking").focus();
}

function closeAddModal() {
  document.getElementById("add-modal").classList.remove("open");
}

function saveManualShipment() {
  const tracking = document.getElementById("add-tracking").value.trim();
  const sender = document.getElementById("add-sender").value.trim();
  const recipient = document.getElementById("add-recipient").value.trim();
  const note = document.getElementById("add-note").value.trim();

  if (!tracking) { showToast("Inserisci il tracking UPS"); return; }

  const exists = state.shipments.find(s => s.courierTracking === tracking || s.masterTracking === tracking);
  if (exists) { showToast("Tracking già presente"); return; }

  const newShipment = enrichShipment({
    masterTracking: "MAN-" + Date.now(),
    courierTracking: tracking,
    sender: sender || "",
    recipient: recipient || "Destinatario non specificato",
    state: "TRANSIT",
    date: new Date().toISOString().slice(0, 10),
    courier: "UPS",
  });

  if (note) state.notes[newShipment.masterTracking] = note;
  state.shipments.unshift(newShipment);
  saveLocal();
  closeAddModal();
  render();
  showToast("Spedizione aggiunta");

  document.getElementById("add-tracking").value = "";
  document.getElementById("add-sender").value = "";
  document.getElementById("add-recipient").value = "";
  document.getElementById("add-note").value = "";
}

// ── UTILS ─────────────────────────────────────────────────
function setLoading(val) {
  state.loading = val;
  const bar = document.getElementById("loading-bar");
  bar.style.display = val ? "block" : "none";
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

function formatDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return d; }
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── INIT ──────────────────────────────────────────────────
function init() {
  loadLocal();
  render();

  // Register service worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  // Auto-refresh if data is stale (> 30 min)
  if (state.lastSync) {
    const last = new Date(state.lastSync.split(",").join("").replace(/(\d{2})\/(\d{2})\/(\d{4})/, "$3-$2-$1"));
    const diff = (Date.now() - last) / 1000 / 60;
    if (diff > 30) fetchShipments();
  }
}

document.addEventListener("DOMContentLoaded", init);
