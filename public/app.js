// ── STATE ──────────────────────────────────────────────
const state = {
  shipments: [],
  notes: {},       // masterTracking → note text
  filter: "transit",
  search: "",
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
    status: normalizeStatus(s.state, s.courierTracking),
    progress: statusProgress(s.state, s.courierTracking),
    eventsLoaded: false,
    events: s.events || [],
  };
}

function normalizeStatus(state, courierTracking) {
  if (!state) return courierTracking ? "transit" : "pending";
  const s = state.toLowerCase();
  if (s.includes("consegn") || s.includes("delivered") || s === "d") return "delivered";
  if (s.includes("eccez") || s.includes("exception") || s === "e" || s.includes("customs") || s.includes("dogana")) return "exception";
  if (s.includes("transit") || s.includes("transito") || s.includes("corso") || s === "t" || s.includes("smist") || s.includes("spedito") || s.includes("shipped")) return "transit";
  if (s.includes("attesa") || s.includes("pending") || s.includes("bozza") || s.includes("draft")) return "pending";
  return courierTracking ? "transit" : "pending";
}

function statusProgress(state, courierTracking) {
  const s = normalizeStatus(state, courierTracking);
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

  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter(s =>
      (s.courierTracking || "").toLowerCase().includes(q) ||
      (s.masterTracking || "").toLowerCase().includes(q) ||
      (s.recipient || "").toLowerCase().includes(q) ||
      (s.companyName || "").toLowerCase().includes(q) ||
      (s.sender || "").toLowerCase().includes(q)
    );
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

function setSearch(q) {
  state.search = q.trim();
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

// ── IMPORT ───────────────────────────────────────────────

function openImportModal() {
  document.getElementById("import-modal").classList.add("open");
  const zone = document.getElementById("drop-zone");
  zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("dragover"); });
  zone.addEventListener("dragleave", () => { zone.classList.remove("dragover"); });
  zone.addEventListener("drop", e => {
    e.preventDefault();
    zone.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (file) {
      const input = document.getElementById("import-file");
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      handleImportFile(input);
    }
  });
}

function closeImportModal() {
  document.getElementById("import-modal").classList.remove("open");
  document.getElementById("import-file").value = "";
  document.getElementById("import-preview").innerHTML = "";
  document.getElementById("import-confirm-btn").style.display = "none";
  importPending = [];
}

let importPending = [];

async function handleImportFile(input) {
  const file = input.files[0];
  if (!file) return;

  const preview = document.getElementById("import-preview");
  preview.innerHTML = "<span style='color:var(--text-faint)'>Lettura file...</span>";

  try {
    let rows = [];
    const ext = file.name.split(".").pop().toLowerCase();

    if (ext === "xlsx" || ext === "xls") {
      rows = await parseXLSX(file);
    } else if (ext === "csv") {
      rows = await parseCSV(file);
    } else {
      preview.innerHTML = "<span style='color:var(--red)'>Formato non supportato. Usa .xlsx o .csv</span>";
      return;
    }

    // Map MBE columns to shipment objects
    const mapped = rows.map(r => ({
      masterTracking: r["Tracking MBE"] || r["tracking_mbe"] || r["ID"] || "",
      courierTracking: r["Tracking"] || r["tracking"] || r["Tracking Number"] || "",
      sender: r["Mittente"] || r["mittente"] || r["Sender"] || "",
      recipient: r["Destinatario"] || r["destinatario"] || r["Recipient"] || "",
      city: (r["Città  Destinatario"] || r["Città Destinatario"] || r["City"] || "").trim(),
      country: r["Stato Destinatario"] || r["Country"] || "",
      date: r["Data Spedizione"] || r["Data Creazione"] || r["Date"] || "",
      service: r["Servizio MBE"] || r["Service"] || "",
      state: r["Stato Spedizione Corriere"] || r["Status"] || "",
      description: r["Descrizione Merce"] || r["Description"] || "",
      reference: r["Riferimento"] || r["Reference"] || "",
      courier: r["Corriere"] || "UPS",
      source: ext === "xlsx" ? "MBE" : "Import",
    })).filter(r => r.masterTracking || r.courierTracking);

    // Deduplicate within file by masterTracking
    const seen = new Set();
    const deduped = mapped.filter(r => {
      const key = r.masterTracking || r.courierTracking;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Categorize: new, updated (status changed), unchanged
    const existing = state.shipments;
    const newOnes = [];
    const updatedOnes = [];
    let unchanged = 0;

    deduped.forEach(r => {
      const found = existing.find(s =>
        (r.masterTracking && s.masterTracking === r.masterTracking) ||
        (r.courierTracking && s.courierTracking === r.courierTracking)
      );
      if (!found) {
        newOnes.push(r);
      } else {
        const oldStatus = found.status;
        const newStatus = normalizeStatus(r.state, r.courierTracking);
        if (oldStatus !== newStatus || found.state !== r.state) {
          updatedOnes.push({ existing: found, incoming: r, oldStatus, newStatus });
        } else {
          unchanged++;
        }
      }
    });

    importPending = {
      news: newOnes.map(enrichShipment),
      updates: updatedOnes,
    };

    // Show preview
    const totalToProcess = newOnes.length + updatedOnes.length;
    if (totalToProcess === 0) {
      preview.innerHTML = `<div class="file-info">✓ Tutte le ${deduped.length} spedizioni sono già aggiornate</div>`;
      document.getElementById("import-confirm-btn").style.display = "none";
    } else {
      const summaryParts = [];
      if (newOnes.length) summaryParts.push(`<strong style="color:var(--blue)">${newOnes.length} nuove</strong>`);
      if (updatedOnes.length) summaryParts.push(`<strong style="color:var(--amber)">${updatedOnes.length} aggiornate</strong>`);
      if (unchanged) summaryParts.push(`<span style="color:var(--text-faint)">${unchanged} invariate</span>`);

      const previewItems = [
        ...newOnes.slice(0, 5).map(s => `
          <div style="padding:6px 10px;border-radius:6px;background:var(--blue-light);margin-bottom:4px;display:flex;gap:8px;align-items:center;font-size:12px;">
            <span style="background:var(--blue);color:white;font-size:10px;padding:1px 7px;border-radius:99px;font-weight:600;">NEW</span>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.sender || "—"} → ${s.recipient || "—"}</span>
          </div>`),
        ...updatedOnes.slice(0, 5).map(u => `
          <div style="padding:6px 10px;border-radius:6px;background:var(--amber-bg);margin-bottom:4px;display:flex;gap:8px;align-items:center;font-size:12px;">
            <span style="background:#F59E0B;color:white;font-size:10px;padding:1px 7px;border-radius:99px;font-weight:600;">UPD</span>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${u.existing.recipient || u.incoming.recipient || "—"}</span>
            <span style="color:var(--text-muted);font-size:11px;">${statusLabel(u.oldStatus)} → <strong style="color:var(--text)">${statusLabel(u.newStatus)}</strong></span>
          </div>`),
      ];

      preview.innerHTML = `
        <div style="font-size:13px;color:var(--text-muted);margin:8px 0;">
          ${summaryParts.join(" · ")}
        </div>
        <div style="max-height:200px;overflow-y:auto;">
          ${previewItems.join("")}
          ${totalToProcess > 10 ? `<div style="padding:6px 10px;color:var(--text-faint);font-size:12px;">... e altre ${totalToProcess - 10}</div>` : ""}
        </div>`;
      document.getElementById("import-confirm-btn").style.display = "block";
      document.getElementById("import-confirm-btn").textContent = newOnes.length && updatedOnes.length
        ? `Importa e aggiorna (${totalToProcess})`
        : newOnes.length
          ? `Importa ${newOnes.length} ${newOnes.length === 1 ? "spedizione" : "spedizioni"}`
          : `Aggiorna ${updatedOnes.length} ${updatedOnes.length === 1 ? "spedizione" : "spedizioni"}`;
    }

  } catch (e) {
    preview.innerHTML = `<span style='color:var(--red)'>Errore nella lettura: ${e.message}</span>`;
  }
}

async function confirmImport() {
  if (!importPending || (!importPending.news?.length && !importPending.updates?.length)) return;

  // Add new shipments
  const newOnes = importPending.news || [];
  newOnes.forEach(s => {
    if (s.description && !state.notes[s.masterTracking]) {
      state.notes[s.masterTracking] = s.description;
    }
  });

  // Update existing shipments
  const updates = importPending.updates || [];
  updates.forEach(({ existing, incoming }) => {
    const idx = state.shipments.findIndex(s => s.masterTracking === existing.masterTracking);
    if (idx >= 0) {
      state.shipments[idx] = enrichShipment({
        ...existing,
        ...incoming,
        // preserve some local fields
        events: existing.events,
        eventsLoaded: existing.eventsLoaded,
      });
    }
  });

  state.shipments = [...newOnes, ...state.shipments];
  state.lastSync = new Date().toLocaleString("it-IT");
  saveLocal();
  closeImportModal();
  render();

  const msgs = [];
  if (newOnes.length) msgs.push(`${newOnes.length} nuove`);
  if (updates.length) msgs.push(`${updates.length} aggiornate`);
  showToast(`✓ ${msgs.join(" · ")}`);
  importPending = [];
}

// Parse XLSX using SheetJS (loaded from CDN in HTML)
function parseXLSX(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        resolve(rows);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// Parse CSV
function parseCSV(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const text = e.target.result;
        const lines = text.split(/\r?\n/).filter(Boolean);
        const headers = lines[0].split(/[,;|\t]/).map(h => h.trim().replace(/^"|"$/g, ""));
        const rows = lines.slice(1).map(line => {
          const vals = line.split(/[,;|\t]/).map(v => v.trim().replace(/^"|"$/g, ""));
          const obj = {};
          headers.forEach((h, i) => obj[h] = vals[i] || "");
          return obj;
        });
        resolve(rows);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsText(file, "UTF-8");
  });
}
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
  // Handle Italian format DD/MM/YYYY
  if (typeof d === "string" && d.includes("/")) {
    const parts = d.split("/");
    if (parts.length === 3) {
      const [day, month, year] = parts;
      const iso = `${year}-${month.padStart(2,"0")}-${day.padStart(2,"0")}`;
      const date = new Date(iso);
      if (!isNaN(date)) {
        return date.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
      }
    }
  }
  // Handle ISO or other formats
  try {
    const date = new Date(d);
    if (!isNaN(date)) {
      return date.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
    }
  } catch {}
  return d; // return as-is if can't parse
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
