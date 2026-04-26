// ── STATE ──────────────────────────────────────────────
const state = {
  user: null,
  shipments: [],
  filter: "transit",
  search: "",
  loading: false,
  lastSync: null,
  selected: new Set(),
};

// ── AUTH UI ────────────────────────────────────────────
function showLoginScreen() {
  document.getElementById("login-screen").style.display = "flex";
  document.getElementById("app-screen").style.display = "none";
}

function showAppScreen() {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app-screen").style.display = "block";
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errEl = document.getElementById("login-error");
  const btn = document.getElementById("login-btn");

  errEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Accesso in corso...";

  try {
    await signIn(email, password);
    state.user = await getCurrentUser();
    showAppScreen();
    await initApp();
  } catch (err) {
    errEl.textContent = err.message || "Credenziali non valide";
    btn.disabled = false;
    btn.textContent = "Accedi";
  }
}

async function handleLogout() {
  if (!confirm("Vuoi davvero uscire?")) return;
  await signOut();
}

// ── DATA LOAD ──────────────────────────────────────────
async function loadShipments() {
  setLoading(true);
  try {
    state.shipments = await loadShipmentsFromDB();
    state.lastSync = new Date().toLocaleString("it-IT");
    saveLocalCache();
  } catch (e) {
    console.error("Load error:", e);
    showToast("Errore caricamento: " + e.message);
  }
  setLoading(false);
  render();
}

function saveLocalCache() {
  try {
    localStorage.setItem("mbe_cache", JSON.stringify(state.shipments));
    localStorage.setItem("mbe_last_sync", state.lastSync || "");
  } catch {}
}

function loadLocalCache() {
  try {
    const cache = localStorage.getItem("mbe_cache");
    if (cache) state.shipments = JSON.parse(cache);
    state.lastSync = localStorage.getItem("mbe_last_sync") || null;
  } catch {}
}

// ── DATA ENRICHMENT ─────────────────────────────────────
function enrichShipment(s) {
  return {
    ...s,
    status: s.status || normalizeStatus(s.state, s.courierTracking),
    progress: s.progress || statusProgress(s.state, s.courierTracking),
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

// ── COURIER ──────────────────────────────────────────────
function detectCourierFromTracking(tracking) {
  if (!tracking) return "";
  const t = tracking.trim().toUpperCase();
  if (/^1Z[A-Z0-9]{16}$/.test(t)) return "UPS";
  if (/^\d{12}$/.test(t) || /^\d{15}$/.test(t)) return "FedEx";
  if (/^\d{10}$/.test(t) || /^JJD\d/.test(t)) return "DHL";
  if (/^(GE|AB)\d{9}/.test(t)) return "TNT";
  if (/^0\d{11}$/.test(t)) return "BRT";
  if (/^\d{11,13}$/.test(t) && t.length !== 12) return "GLS";
  if (/^(94|93|92|95)\d{20}$/.test(t) || /^\d{22}$/.test(t)) return "USPS";
  return "";
}

function courierTrackingUrl(courier, tracking) {
  if (!tracking) return null;
  if (!courier) courier = detectCourierFromTracking(tracking);
  const c = (courier || "").toLowerCase();
  if (c.includes("ups")) return `https://www.ups.com/track?tracknum=${tracking}&loc=it_IT`;
  if (c.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${tracking}&trkqual=&cntry_code=it`;
  if (c.includes("dhl")) return `https://www.dhl.com/it-it/home/tracking/tracking-express.html?submit=1&tracking-id=${tracking}`;
  if (c.includes("tnt")) return `https://www.tnt.com/express/it_it/site/shipping-tools/tracking.html?searchType=con&cons=${tracking}`;
  if (c.includes("brt") || c.includes("bartolini")) return `https://vas.brt.it/vas/sped_det_show.hsm?referer=sped_numspe_par.htm&Nspediz=${tracking}`;
  if (c.includes("gls")) return `https://gls-group.eu/IT/it/servizi-online/track-and-trace?match=${tracking}`;
  if (c.includes("poste") || c.includes("crono") || c.includes("sda")) return `https://www.poste.it/cerca/index.html#/risultati-spedizioni/${tracking}`;
  if (c.includes("usps")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${tracking}`;
  return `https://t.17track.net/en#nums=${tracking}`;
}

function openTracking(courier, tracking) {
  const url = courierTrackingUrl(courier, tracking);
  if (url) window.open(url, "_blank");
}

function courierLabel(courier, tracking) {
  if (!courier && tracking) courier = detectCourierFromTracking(tracking);
  if (!courier) return "—";
  const c = courier.toLowerCase();
  if (c.includes("ups")) return "UPS";
  if (c.includes("fedex")) return "FedEx";
  if (c.includes("dhl")) return "DHL";
  if (c.includes("tnt")) return "TNT";
  if (c.includes("brt") || c.includes("bartolini")) return "BRT";
  if (c.includes("gls")) return "GLS";
  if (c.includes("poste") || c.includes("crono")) return "Poste";
  if (c.includes("sda")) return "SDA";
  if (c.includes("usps")) return "USPS";
  return courier;
}

// ── RENDER ───────────────────────────────────────────────
function render() {
  renderStats();
  renderList();
  renderActionBar();
  document.getElementById("last-sync").textContent = state.lastSync ? `Aggiornato: ${state.lastSync}` : "Non ancora sincronizzato";
}

function renderStats() {
  const active = state.shipments.filter(s => !s.archived);
  let totalEur = 0, totalUsd = 0;
  state.shipments.forEach(s => {
    const sum = (parseFloat(s.cost) || 0) + (parseFloat(s.customsDuty) || 0) + (parseFloat(s.brokerage) || 0);
    if (s.currency === "USD") totalUsd += sum;
    else totalEur += sum;
  });
  document.getElementById("stat-all").textContent = active.length;
  document.getElementById("stat-transit").textContent = active.filter(s => s.status === "transit").length;
  document.getElementById("stat-delivered").textContent = active.filter(s => s.status === "delivered").length;
  // Show whichever currency has data, prefer EUR
  let costStr = "—";
  if (totalEur > 0 && totalUsd > 0) costStr = `€${totalEur.toFixed(0)} · $${totalUsd.toFixed(0)}`;
  else if (totalEur > 0) costStr = `€${totalEur.toFixed(0)}`;
  else if (totalUsd > 0) costStr = `$${totalUsd.toFixed(0)}`;
  document.getElementById("stat-cost").textContent = costStr;
}

function renderList() {
  const container = document.getElementById("shipment-list");
  let list = state.shipments;

  // Filter by archive status
  if (state.filter === "archived") {
    list = list.filter(s => s.archived === true);
  } else {
    list = list.filter(s => !s.archived);
    if (state.filter !== "ALL") {
      list = list.filter(s => s.status === state.filter.toLowerCase());
    }
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

  list = [...list].sort((a, b) => parseDateForSort(b.date) - parseDateForSort(a.date));

  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <p>${state.shipments.length === 0 ? 'Nessuna spedizione. Importa un CSV per iniziare.' : 'Nessuna spedizione con questo filtro'}</p>
    </div>`;
    return;
  }

  container.innerHTML = list.map(s => renderCard(s)).join("");
}

function renderCard(s) {
  const note = s.note || "";
  const eventsHtml = s.eventsLoaded && s.events.length > 0
    ? `<div class="events-panel">${s.events.slice(0, 4).map((e, i) => `
        <div class="event-item">
          <div class="event-dot ${i === 0 ? "latest" : ""}"></div>
          <span class="event-time">${e.date || ""} ${e.time || ""}</span>
          <span class="event-desc">${e.location ? e.location + " — " : ""}${e.description || ""}</span>
        </div>`).join("")}
      </div>` : "";

  const trk = s.courierTracking || "";
  const courierName = courierLabel(s.courier, trk);
  const trackUrl = courierTrackingUrl(s.courier, trk);
  const trkLink = trk
    ? (trackUrl
        ? `<a href="${trackUrl}" target="_blank" class="tracking-link">${trk} ↗</a>`
        : `<span style="font-family:var(--mono);font-size:11px;">${trk}</span>`)
    : `<span style="color:var(--text-faint);font-size:11px;">non ancora assegnato</span>`;

  return `<div class="shipment-card ${state.selected.has(s.masterTracking) ? 'selected' : ''}" id="card-${s.masterTracking}">
    <div class="card-header">
      <label class="card-checkbox" onclick="event.stopPropagation()">
        <input type="checkbox" ${state.selected.has(s.masterTracking) ? 'checked' : ''} onchange="toggleSelect('${s.masterTracking}')">
        <span class="checkbox-mark"></span>
      </label>
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
        <span class="detail-value">${courierName}</span>
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
        <span class="detail-label">Tracking ${courierName !== "—" ? courierName : ""}</span>
        <span class="detail-value">${trkLink}</span>
      </div>
    </div>

    ${note ? `<div class="card-note">📝 ${escapeHtml(note)}</div>` : ""}

    ${renderBillingSummary(s)}

    ${eventsHtml}

    <div class="card-footer">
      <button class="btn-sm" onclick="toggleEvents('${s.masterTracking}')">
        ${s.eventsLoaded ? "Nascondi" : "📍 Storico"}
      </button>
      <button class="btn-sm" onclick="openNoteModal('${s.masterTracking}')">✏️ Nota</button>
      <button class="btn-sm" onclick="openBillingModal('${s.masterTracking}')">💰 Costi</button>
      ${trk && trackUrl ? `<button class="btn-sm primary" onclick="openTracking('${(s.courier||'').replace(/'/g,'')}', '${trk}')">Traccia ${courierName}</button>` : ""}
      <button class="btn-sm danger" onclick="deleteShipment('${s.masterTracking}')">🗑 Rimuovi</button>
    </div>
  </div>`;
}

function renderBillingSummary(s) {
  const hasCost = s.cost || s.customsDuty || s.brokerage || s.mrn || s.attachmentUrl;
  if (!hasCost) return "";
  const sym = currencySymbol(s.currency);
  const parts = [];
  if (s.cost) parts.push(`<span class="bill-item">Spedizione: <strong>${sym}${parseFloat(s.cost).toFixed(2)}</strong></span>`);
  if (s.customsDuty) parts.push(`<span class="bill-item">Dazi: <strong>${sym}${parseFloat(s.customsDuty).toFixed(2)}</strong></span>`);
  if (s.brokerage) parts.push(`<span class="bill-item">Sdoganamento: <strong>${sym}${parseFloat(s.brokerage).toFixed(2)}</strong></span>`);
  // Total
  const total = (parseFloat(s.cost) || 0) + (parseFloat(s.customsDuty) || 0) + (parseFloat(s.brokerage) || 0);
  if (total > 0 && (s.cost ? 1 : 0) + (s.customsDuty ? 1 : 0) + (s.brokerage ? 1 : 0) > 1) {
    parts.push(`<span class="bill-item bill-total">Totale: <strong>${sym}${total.toFixed(2)}</strong></span>`);
  }
  if (s.mrn) parts.push(`<span class="bill-item">MRN: <code>${s.mrn}</code></span>`);
  if (s.entryNo) parts.push(`<span class="bill-item">Entry: <code>${s.entryNo}</code></span>`);
  if (s.attachmentUrl) parts.push(`<a href="${s.attachmentUrl}" target="_blank" class="bill-attachment">📎 ${s.attachmentName || "Allegato"}</a>`);
  return `<div class="card-billing">${parts.join("")}</div>`;
}

function currencySymbol(c) {
  return c === "USD" ? "$" : "€";
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
  s.eventsLoaded = !s.eventsLoaded;
  render();
}

async function deleteShipment(masterTracking) {
  if (!confirm("Rimuovere questa spedizione?")) return;
  try {
    await deleteShipmentDB(masterTracking);
    state.shipments = state.shipments.filter(s => s.masterTracking !== masterTracking);
    state.selected.delete(masterTracking);
    saveLocalCache();
    render();
    showToast("Spedizione rimossa");
  } catch (e) {
    showToast("Errore: " + e.message);
  }
}

// ── MULTI SELECTION ──────────────────────────────────────
function toggleSelect(masterTracking) {
  if (state.selected.has(masterTracking)) state.selected.delete(masterTracking);
  else state.selected.add(masterTracking);
  renderActionBar();
  const card = document.getElementById(`card-${masterTracking}`);
  if (card) card.classList.toggle("selected", state.selected.has(masterTracking));
}

function selectAllVisible() {
  let list = state.shipments;
  if (state.filter !== "ALL") list = list.filter(s => s.status === state.filter.toLowerCase());
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter(s =>
      (s.courierTracking || "").toLowerCase().includes(q) ||
      (s.masterTracking || "").toLowerCase().includes(q) ||
      (s.recipient || "").toLowerCase().includes(q) ||
      (s.sender || "").toLowerCase().includes(q)
    );
  }
  const allSelected = list.every(s => state.selected.has(s.masterTracking));
  if (allSelected) list.forEach(s => state.selected.delete(s.masterTracking));
  else list.forEach(s => state.selected.add(s.masterTracking));
  render();
}

function clearSelection() {
  state.selected.clear();
  render();
}

async function bulkDelete() {
  const count = state.selected.size;
  if (!count) return;
  if (!confirm(`Rimuovere ${count} spedizion${count === 1 ? "e" : "i"}?`)) return;
  try {
    const ids = Array.from(state.selected);
    await bulkDeleteDB(ids);
    state.shipments = state.shipments.filter(s => !state.selected.has(s.masterTracking));
    state.selected.clear();
    saveLocalCache();
    render();
    showToast(`✓ ${count} spedizion${count === 1 ? "e rimossa" : "i rimosse"}`);
  } catch (e) {
    showToast("Errore: " + e.message);
  }
}

async function bulkChangeStatus(newStatus) {
  const count = state.selected.size;
  if (!count) return;
  try {
    const ids = Array.from(state.selected);
    await bulkUpdateStatusDB(ids, newStatus);
    const progress = { delivered: 100, transit: 60, exception: 40, pending: 15 }[newStatus];
    state.shipments = state.shipments.map(s => {
      if (state.selected.has(s.masterTracking)) return { ...s, status: newStatus, progress };
      return s;
    });
    state.selected.clear();
    saveLocalCache();
    render();
    showToast(`✓ ${count} spedizion${count === 1 ? "e spostata" : "i spostate"} in "${statusLabel(newStatus)}"`);
  } catch (e) {
    showToast("Errore: " + e.message);
  }
}

function renderActionBar() {
  let bar = document.getElementById("action-bar");
  if (state.selected.size === 0) {
    if (bar) bar.classList.remove("show");
    return;
  }
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "action-bar";
    bar.className = "action-bar";
    document.body.appendChild(bar);
  }
  bar.innerHTML = `
    <div class="action-bar-header">
      <button class="action-btn-icon" onclick="clearSelection()" title="Annulla">✕</button>
      <span class="action-count">${state.selected.size} selezionat${state.selected.size === 1 ? "a" : "e"}</span>
      <button class="action-btn-icon" onclick="selectAllVisible()" title="Seleziona tutto">☑</button>
    </div>
    <div class="action-bar-buttons">
      <button class="action-btn-text" onclick="bulkChangeStatus('transit')">
        <span class="action-icon">→</span><span>In transito</span>
      </button>
      <button class="action-btn-text" onclick="bulkChangeStatus('delivered')">
        <span class="action-icon">✓</span><span>Consegnata</span>
      </button>
      <button class="action-btn-text" onclick="bulkChangeStatus('pending')">
        <span class="action-icon">⏱</span><span>In attesa</span>
      </button>
      <button class="action-btn-text" onclick="bulkChangeStatus('exception')">
        <span class="action-icon">!</span><span>Eccezione</span>
      </button>
      <button class="action-btn-text danger" onclick="bulkDelete()">
        <span class="action-icon">🗑</span><span>Elimina</span>
      </button>
    </div>
  `;
  setTimeout(() => bar.classList.add("show"), 10);
}

// ── NOTE MODAL ───────────────────────────────────────────
let currentNoteTracking = null;

function openNoteModal(masterTracking) {
  currentNoteTracking = masterTracking;
  const s = state.shipments.find(x => x.masterTracking === masterTracking);
  document.getElementById("note-modal-title").textContent = s ? (s.recipient || masterTracking) : masterTracking;
  document.getElementById("note-input").value = (s && s.note) || "";
  document.getElementById("note-modal").classList.add("open");
}

function closeNoteModal() {
  document.getElementById("note-modal").classList.remove("open");
  currentNoteTracking = null;
}

async function saveNote() {
  if (!currentNoteTracking) return;
  const text = document.getElementById("note-input").value.trim();
  try {
    await updateNoteDB(currentNoteTracking, text);
    const s = state.shipments.find(x => x.masterTracking === currentNoteTracking);
    if (s) s.note = text;
    saveLocalCache();
    closeNoteModal();
    render();
    showToast("Nota salvata");
  } catch (e) {
    showToast("Errore: " + e.message);
  }
}


// ── BILLING MODAL ────────────────────────────────────────
let currentBillingTracking = null;

function openBillingModal(masterTracking) {
  currentBillingTracking = masterTracking;
  const s = state.shipments.find(x => x.masterTracking === masterTracking);
  if (!s) return;

  document.getElementById("billing-modal-title").textContent = s.recipient || masterTracking;
  document.getElementById("billing-cost").value = s.cost || "";
  document.getElementById("billing-customs").value = s.customsDuty || "";
  document.getElementById("billing-brokerage").value = s.brokerage || "";
  document.getElementById("billing-currency").value = s.currency || "EUR";
  document.getElementById("billing-mrn").value = s.mrn || "";
  document.getElementById("billing-entry").value = s.entryNo || "";
  document.getElementById("billing-notes").value = s.notesBilling || "";

  // Show existing attachment if any
  const attachInfo = document.getElementById("billing-attachment-info");
  if (s.attachmentUrl) {
    attachInfo.innerHTML = `<div class="attachment-row">
      <a href="${s.attachmentUrl}" target="_blank">📎 ${s.attachmentName || "Allegato"}</a>
      <button class="btn-sm danger" onclick="removeAttachment()">Rimuovi</button>
    </div>`;
  } else {
    attachInfo.innerHTML = "";
  }

  document.getElementById("billing-modal").classList.add("open");
}

function closeBillingModal() {
  document.getElementById("billing-modal").classList.remove("open");
  currentBillingTracking = null;
  document.getElementById("billing-file").value = "";
}

async function saveBilling() {
  if (!currentBillingTracking) return;
  const billing = {
    cost: parseFloat(document.getElementById("billing-cost").value) || null,
    customsDuty: parseFloat(document.getElementById("billing-customs").value) || null,
    brokerage: parseFloat(document.getElementById("billing-brokerage").value) || null,
    currency: document.getElementById("billing-currency").value || "EUR",
    mrn: document.getElementById("billing-mrn").value.trim() || null,
    entryNo: document.getElementById("billing-entry").value.trim() || null,
    notesBilling: document.getElementById("billing-notes").value.trim() || null,
  };

  const btn = document.getElementById("billing-save-btn");
  btn.disabled = true;
  btn.textContent = "Salvataggio...";

  try {
    await updateBillingDB(currentBillingTracking, billing);

    // Handle file upload if present
    const fileInput = document.getElementById("billing-file");
    if (fileInput.files && fileInput.files[0]) {
      btn.textContent = "Caricamento allegato...";
      const result = await uploadAttachment(currentBillingTracking, fileInput.files[0]);
      const s = state.shipments.find(x => x.masterTracking === currentBillingTracking);
      if (s) {
        s.attachmentUrl = result.url;
        s.attachmentName = result.name;
      }
    }

    // Update local state
    const s = state.shipments.find(x => x.masterTracking === currentBillingTracking);
    if (s) Object.assign(s, billing);

    closeBillingModal();
    render();
    showToast("✓ Costi salvati");
  } catch (e) {
    showToast("Errore: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Salva";
  }
}

async function removeAttachment() {
  if (!currentBillingTracking) return;
  if (!confirm("Rimuovere l\'allegato?")) return;
  const s = state.shipments.find(x => x.masterTracking === currentBillingTracking);
  if (s && s.attachmentUrl) {
    try {
      await deleteAttachment(currentBillingTracking, s.attachmentUrl);
      s.attachmentUrl = null;
      s.attachmentName = null;
      document.getElementById("billing-attachment-info").innerHTML = "";
      render();
      showToast("Allegato rimosso");
    } catch (e) {
      showToast("Errore: " + e.message);
    }
  }
}

// ── ADD MANUAL ───────────────────────────────────────────
function openAddModal() {
  document.getElementById("add-modal").classList.add("open");
  document.getElementById("add-tracking").focus();
}

function closeAddModal() {
  document.getElementById("add-modal").classList.remove("open");
}

async function saveManualShipment() {
  const tracking = document.getElementById("add-tracking").value.trim();
  const sender = document.getElementById("add-sender").value.trim();
  const recipient = document.getElementById("add-recipient").value.trim();
  const note = document.getElementById("add-note").value.trim();

  if (!tracking) { showToast("Inserisci il tracking"); return; }

  const exists = state.shipments.find(s => s.courierTracking === tracking || s.masterTracking === tracking);
  if (exists) { showToast("Tracking già presente"); return; }

  const today = new Date().toLocaleDateString("it-IT");
  const masterTracking = "MAN-" + Date.now();
  const newShipment = enrichShipment({
    masterTracking,
    courierTracking: tracking,
    sender: sender || "",
    recipient: recipient || "Destinatario non specificato",
    state: "TRANSIT",
    date: today,
    courier: detectCourierFromTracking(tracking),
    note: note || null,
  });

  try {
    const inserted = await insertShipments([newShipment]);
    state.shipments.unshift(...inserted);
    saveLocalCache();
    closeAddModal();
    render();
    showToast("Spedizione aggiunta");
    document.getElementById("add-tracking").value = "";
    document.getElementById("add-sender").value = "";
    document.getElementById("add-recipient").value = "";
    document.getElementById("add-note").value = "";
  } catch (e) {
    showToast("Errore: " + e.message);
  }
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
  const btn = document.getElementById("import-confirm-btn");
  btn.style.display = "none";
  btn.disabled = false;
  importPending = { news: [], updates: [] };
}

let importPending = { news: [], updates: [] };

async function handleImportFile(input) {
  const file = input.files[0];
  if (!file) return;
  const preview = document.getElementById("import-preview");
  preview.innerHTML = "<span style='color:var(--text-faint)'>Lettura file...</span>";

  try {
    let rows = [];
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "xlsx" || ext === "xls") rows = await parseXLSX(file);
    else if (ext === "csv") rows = await parseCSV(file);
    else { preview.innerHTML = "<span style='color:var(--red)'>Formato non supportato</span>"; return; }

    const mapped = rows.map(r => {
      // Detect source by columns present
      const isPirateShip = r["Tracking Number"] !== undefined && r["Ship From"] !== undefined;
      const isMBE = r["Tracking MBE"] !== undefined;

      if (isPirateShip) {
        const trk = r["Tracking Number"] || "";
        return {
          masterTracking: "PS-" + trk,
          courierTracking: trk,
          sender: r["Ship From"] || "",
          recipient: r["Recipient"] || "",
          city: "",
          country: "US",
          date: r["Created Date"] || "",
          service: r["Saved Package"] || "",
          state: r["Tracking Status"] || "",
          description: r["Batch"] || "",
          reference: "",
          courier: "",
          cost: parseFloat(r["Cost"]) || null,
          currency: "USD",
          source: "PirateShip",
        };
      }

      // Default: MBE format
      return {
        masterTracking: r["Tracking MBE"] || r["tracking_mbe"] || r["ID"] || "",
        courierTracking: r["Tracking"] || r["tracking"] || r["Tracking Number"] || "",
        sender: r["Mittente"] || r["mittente"] || r["Sender"] || r["Ship From"] || "",
        recipient: r["Destinatario"] || r["destinatario"] || r["Recipient"] || "",
        city: (r["Città  Destinatario"] || r["Città Destinatario"] || r["City"] || "").trim(),
        country: r["Stato Destinatario"] || r["Country"] || "",
        date: r["Data Spedizione"] || r["Data Creazione"] || r["Date"] || r["Created Date"] || "",
        service: r["Servizio MBE"] || r["Service"] || "",
        state: r["Stato Spedizione Corriere"] || r["Status"] || r["Tracking Status"] || "",
        description: r["Descrizione Merce"] || r["Description"] || "",
        reference: r["Riferimento"] || r["Reference"] || "",
        courier: r["Corriere"] || r["courier"] || "",
        cost: parseFloat(r["Prezzo Lordo Totale"]) || parseFloat(r["Prezzo Stimato"]) || parseFloat(r["Cost"]) || null,
        currency: "EUR",
        source: ext === "xlsx" ? "MBE" : "Import",
      };
    }).filter(r => r.masterTracking || r.courierTracking);

    const seen = new Set();
    const deduped = mapped.filter(r => {
      const key = r.masterTracking || r.courierTracking;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const existing = state.shipments;
    const newOnes = [];
    const updatedOnes = [];
    let unchanged = 0;

    deduped.forEach(r => {
      const found = existing.find(s =>
        (r.masterTracking && s.masterTracking === r.masterTracking) ||
        (r.courierTracking && s.courierTracking === r.courierTracking)
      );
      if (!found) newOnes.push(r);
      else {
        const oldStatus = found.status;
        const newStatus = normalizeStatus(r.state, r.courierTracking);
        if (oldStatus !== newStatus || found.state !== r.state) {
          updatedOnes.push({ existing: found, incoming: r, oldStatus, newStatus });
        } else unchanged++;
      }
    });

    importPending = {
      news: newOnes.map(enrichShipment),
      updates: updatedOnes,
    };

    const totalToProcess = newOnes.length + updatedOnes.length;
    if (totalToProcess === 0) {
      preview.innerHTML = `<div class="file-info">✓ Tutte le ${deduped.length} spedizioni sono già aggiornate</div>`;
      document.getElementById("import-confirm-btn").style.display = "none";
    } else {
      const summaryParts = [];
      if (newOnes.length) summaryParts.push(`<strong style="color:var(--blue)">${newOnes.length} nuove</strong>`);
      if (updatedOnes.length) summaryParts.push(`<strong style="color:var(--amber)">${updatedOnes.length} aggiornate</strong>`);
      if (unchanged) summaryParts.push(`<span style="color:var(--text-faint)">${unchanged} invariate</span>`);

      preview.innerHTML = `
        <div style="font-size:13px;color:var(--text-muted);margin:8px 0;">${summaryParts.join(" · ")}</div>`;
      document.getElementById("import-confirm-btn").style.display = "block";
      document.getElementById("import-confirm-btn").textContent = `Sincronizza (${totalToProcess})`;
      document.getElementById("import-confirm-btn").disabled = false;
    }
  } catch (e) {
    preview.innerHTML = `<span style='color:var(--red)'>Errore: ${e.message}</span>`;
  }
}

async function confirmImport() {
  if (!importPending.news.length && !importPending.updates.length) return;
  const btn = document.getElementById("import-confirm-btn");
  btn.disabled = true;
  btn.textContent = "Sincronizzazione...";

  try {
    // Insert new
    if (importPending.news.length) {
      const inserted = await insertShipments(importPending.news);
      state.shipments.unshift(...inserted);
    }

    // Update existing
    for (const { existing, incoming } of importPending.updates) {
      const merged = enrichShipment({ ...existing, ...incoming });
      await updateShipmentDB(existing.masterTracking, merged);
      const idx = state.shipments.findIndex(s => s.masterTracking === existing.masterTracking);
      if (idx >= 0) state.shipments[idx] = merged;
    }

    state.lastSync = new Date().toLocaleString("it-IT");
    saveLocalCache();
    closeImportModal();
    render();

    const msgs = [];
    if (importPending.news.length) msgs.push(`${importPending.news.length} nuove`);
    if (importPending.updates.length) msgs.push(`${importPending.updates.length} aggiornate`);
    showToast(`✓ ${msgs.join(" · ")}`);
    importPending = { news: [], updates: [] };
  } catch (e) {
    showToast("Errore: " + e.message);
    btn.disabled = false;
    btn.textContent = "Riprova";
  }
}

function parseXLSX(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(sheet, { defval: "" }));
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

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

// ── UTILS ─────────────────────────────────────────────────
function setLoading(val) {
  state.loading = val;
  document.getElementById("loading-bar").style.display = val ? "block" : "none";
  const refreshBtn = document.getElementById("refresh-btn");
  if (refreshBtn) {
    if (val) refreshBtn.classList.add("spinning");
    else refreshBtn.classList.remove("spinning");
  }
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

function formatDate(d) {
  if (!d) return "—";
  if (typeof d === "string" && d.includes("/")) {
    const parts = d.split("/");
    if (parts.length === 3) {
      const [day, month, year] = parts;
      const date = new Date(`${year}-${month.padStart(2,"0")}-${day.padStart(2,"0")}`);
      if (!isNaN(date)) return date.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
    }
  }
  try {
    const date = new Date(d);
    if (!isNaN(date)) return date.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
  } catch {}
  return d;
}

function parseDateForSort(d) {
  if (!d) return 0;
  if (typeof d === "string" && d.includes("/")) {
    const parts = d.split("/");
    if (parts.length === 3) {
      const [day, month, year] = parts;
      const t = new Date(`${year}-${month.padStart(2,"0")}-${day.padStart(2,"0")}`).getTime();
      return isNaN(t) ? 0 : t;
    }
  }
  const t = new Date(d).getTime();
  return isNaN(t) ? 0 : t;
}

function escapeHtml(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}


// ── STATISTICS ───────────────────────────────────────────
const statsState = {
  dateFrom: null,
  dateTo: null,
  filterSender: "",
  filterRecipient: "",
  filterCourier: "",
  sortBy: "date",  // date | cost | duty
};

function openStats() {
  // Default range: last 6 months
  if (!statsState.dateFrom) {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    statsState.dateFrom = sixMonthsAgo.toISOString().slice(0, 10);
    statsState.dateTo = new Date().toISOString().slice(0, 10);
  }
  document.getElementById("stats-screen").style.display = "block";
  document.getElementById("app-screen").style.display = "none";
  renderStatsPage();
}

function closeStats() {
  document.getElementById("stats-screen").style.display = "none";
  document.getElementById("app-screen").style.display = "block";
}

function getFilteredForStats() {
  let list = state.shipments;
  // Date filter
  const fromMs = statsState.dateFrom ? new Date(statsState.dateFrom).getTime() : 0;
  const toMs = statsState.dateTo ? new Date(statsState.dateTo).getTime() + 86400000 : Infinity;
  list = list.filter(s => {
    const t = parseDateForSort(s.date);
    return t >= fromMs && t <= toMs;
  });
  // Sender/recipient filter
  if (statsState.filterSender) {
    const q = statsState.filterSender.toLowerCase();
    list = list.filter(s => (s.sender || "").toLowerCase().includes(q));
  }
  if (statsState.filterRecipient) {
    const q = statsState.filterRecipient.toLowerCase();
    list = list.filter(s => (s.recipient || "").toLowerCase().includes(q));
  }
  if (statsState.filterCourier) {
    list = list.filter(s => courierLabel(s.courier, s.courierTracking) === statsState.filterCourier);
  }
  return list;
}

function renderStatsPage() {
  const list = getFilteredForStats();

  // Update inputs
  document.getElementById("stats-date-from").value = statsState.dateFrom || "";
  document.getElementById("stats-date-to").value = statsState.dateTo || "";

  // Build courier options from all shipments (not filtered)
  const couriers = new Set();
  state.shipments.forEach(s => {
    const c = courierLabel(s.courier, s.courierTracking);
    if (c && c !== "—") couriers.add(c);
  });
  const courierSelect = document.getElementById("stats-courier");
  if (courierSelect) {
    const current = statsState.filterCourier;
    courierSelect.innerHTML = `<option value="">Tutti i corrieri</option>` +
      [...couriers].sort().map(c => `<option value="${c}" ${current === c ? "selected" : ""}>${c}</option>`).join("");
  }

  // Totals by currency
  let totalEur = 0, totalUsd = 0;
  let costEur = 0, costUsd = 0;
  let customsEur = 0, customsUsd = 0;
  list.forEach(s => {
    const cost = parseFloat(s.cost) || 0;
    const customs = (parseFloat(s.customsDuty) || 0) + (parseFloat(s.brokerage) || 0);
    if (s.currency === "USD") {
      costUsd += cost;
      customsUsd += customs;
      totalUsd += cost + customs;
    } else {
      costEur += cost;
      customsEur += customs;
      totalEur += cost + customs;
    }
  });

  // Average delivery time (only delivered with both dates)
  const deliveredWithDates = list.filter(s => s.status === "delivered" && s.deliveryDate && s.date);
  let avgDays = 0;
  if (deliveredWithDates.length > 0) {
    const totalDays = deliveredWithDates.reduce((sum, s) => {
      const start = parseDateForSort(s.date);
      const end = parseDateForSort(s.deliveryDate);
      if (start && end && end > start) return sum + Math.round((end - start) / 86400000);
      return sum;
    }, 0);
    avgDays = Math.round(totalDays / deliveredWithDates.length);
  }

  // Monthly chart data
  const monthly = {};
  list.forEach(s => {
    const t = parseDateForSort(s.date);
    if (!t) return;
    const d = new Date(t);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!monthly[key]) monthly[key] = { count: 0, eur: 0, usd: 0 };
    monthly[key].count++;
    const cost = (parseFloat(s.cost) || 0) + (parseFloat(s.customsDuty) || 0) + (parseFloat(s.brokerage) || 0);
    if (s.currency === "USD") monthly[key].usd += cost;
    else monthly[key].eur += cost;
  });

  const sortedMonths = Object.keys(monthly).sort();

  // Render
  const html = `
    <div class="stats-section">
      <h3>Riepilogo periodo</h3>
      <div class="stats-cards">
        <div class="stat-big">
          <div class="stat-big-num">${list.length}</div>
          <div class="stat-big-lbl">Spedizioni</div>
        </div>
        <div class="stat-big">
          <div class="stat-big-num">${avgDays || "—"}${avgDays ? "<small> gg</small>" : ""}</div>
          <div class="stat-big-lbl">Tempo medio consegna</div>
        </div>
        <div class="stat-big">
          <div class="stat-big-num">${totalEur > 0 ? "€" + totalEur.toFixed(0) : "—"}</div>
          <div class="stat-big-lbl">Totale EUR</div>
        </div>
        <div class="stat-big">
          <div class="stat-big-num">${totalUsd > 0 ? "$" + totalUsd.toFixed(0) : "—"}</div>
          <div class="stat-big-lbl">Totale USD</div>
        </div>
      </div>
    </div>

    ${(totalEur > 0 || totalUsd > 0) ? `
    <div class="stats-section">
      <h3>Dettaglio costi</h3>
      <table class="stats-table">
        <thead><tr><th></th><th>EUR</th><th>USD</th></tr></thead>
        <tbody>
          <tr><td>Spedizione</td><td>${costEur > 0 ? "€" + costEur.toFixed(2) : "—"}</td><td>${costUsd > 0 ? "$" + costUsd.toFixed(2) : "—"}</td></tr>
          <tr><td>Dazi + Sdoganamento</td><td>${customsEur > 0 ? "€" + customsEur.toFixed(2) : "—"}</td><td>${customsUsd > 0 ? "$" + customsUsd.toFixed(2) : "—"}</td></tr>
          <tr class="total-row"><td>Totale</td><td><strong>${totalEur > 0 ? "€" + totalEur.toFixed(2) : "—"}</strong></td><td><strong>${totalUsd > 0 ? "$" + totalUsd.toFixed(2) : "—"}</strong></td></tr>
        </tbody>
      </table>
    </div>` : ""}

    ${sortedMonths.length > 0 ? `
    <div class="stats-section">
      <h3>Spedizioni per mese</h3>
      <div class="monthly-chart">
        ${renderMonthlyChart(sortedMonths, monthly)}
      </div>
    </div>` : ""}

    ${renderCourierBreakdown(list)}

    ${renderTopShipments(list)}
  `;

  document.getElementById("stats-content").innerHTML = html;
}

function renderCourierBreakdown(list) {
  const breakdown = {};
  list.forEach(s => {
    const c = courierLabel(s.courier, s.courierTracking);
    if (!breakdown[c]) breakdown[c] = { count: 0, eur: 0, usd: 0 };
    breakdown[c].count++;
    const cost = (parseFloat(s.cost) || 0) + (parseFloat(s.customsDuty) || 0) + (parseFloat(s.brokerage) || 0);
    if (s.currency === "USD") breakdown[c].usd += cost;
    else breakdown[c].eur += cost;
  });
  const sorted = Object.entries(breakdown).sort((a, b) => b[1].count - a[1].count);
  if (sorted.length === 0) return "";
  return `<div class="stats-section">
    <h3>Per corriere</h3>
    <table class="stats-table">
      <thead><tr><th>Corriere</th><th>Spedizioni</th><th>Costi</th></tr></thead>
      <tbody>
        ${sorted.map(([c, d]) => {
          const costs = [];
          if (d.eur > 0) costs.push(`€${d.eur.toFixed(0)}`);
          if (d.usd > 0) costs.push(`$${d.usd.toFixed(0)}`);
          return `<tr><td>${c}</td><td>${d.count}</td><td>${costs.join(" + ") || "—"}</td></tr>`;
        }).join("")}
      </tbody>
    </table>
  </div>`;
}

function renderTopShipments(list) {
  if (statsState.sortBy === "date") return ""; // skip if not sorted by cost/duty
  const field = statsState.sortBy === "cost" ? "cost" : "customsDuty";
  const title = statsState.sortBy === "cost" ? "Top spedizioni per costo" : "Top spedizioni per dazi";
  const sorted = [...list]
    .filter(s => parseFloat(s[field]) > 0)
    .sort((a, b) => (parseFloat(b[field]) || 0) - (parseFloat(a[field]) || 0))
    .slice(0, 10);
  if (sorted.length === 0) return "";
  return `<div class="stats-section">
    <h3>${title}</h3>
    <table class="stats-table">
      <thead><tr><th>Destinatario</th><th>Mittente</th><th>${statsState.sortBy === "cost" ? "Costo" : "Dazi"}</th></tr></thead>
      <tbody>
        ${sorted.map(s => {
          const sym = currencySymbol(s.currency);
          const val = parseFloat(s[field]);
          return `<tr>
            <td><strong>${s.recipient || "—"}</strong></td>
            <td>${s.sender || "—"}</td>
            <td>${sym}${val.toFixed(2)}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  </div>`;
}

function renderMonthlyChart(months, data) {
  const maxCount = Math.max(...months.map(m => data[m].count), 1);
  return months.map(m => {
    const d = data[m];
    const heightPct = (d.count / maxCount) * 100;
    const [year, month] = m.split("-");
    const monthNames = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
    const label = monthNames[parseInt(month) - 1] + " " + year.slice(2);
    const costParts = [];
    if (d.eur > 0) costParts.push(`€${d.eur.toFixed(0)}`);
    if (d.usd > 0) costParts.push(`$${d.usd.toFixed(0)}`);
    return `<div class="month-bar">
      <div class="month-bar-value">${d.count}</div>
      <div class="month-bar-fill" style="height:${heightPct}%"></div>
      <div class="month-bar-label">${label}</div>
      <div class="month-bar-cost">${costParts.join(" + ") || "—"}</div>
    </div>`;
  }).join("");
}

function updateStatsDateFrom(v) {
  statsState.dateFrom = v;
  renderStatsPage();
}

function updateStatsDateTo(v) {
  statsState.dateTo = v;
  renderStatsPage();
}

function updateStatsSender(v) {
  statsState.filterSender = v;
  renderStatsPage();
}

function updateStatsRecipient(v) {
  statsState.filterRecipient = v;
  renderStatsPage();
}

function updateStatsCourier(v) {
  statsState.filterCourier = v;
  renderStatsPage();
}

function setStatsSort(by) {
  statsState.sortBy = by;
  document.querySelectorAll(".sort-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.sort === by);
  });
  renderStatsPage();
}

function setStatsRange(months) {
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - months);
  statsState.dateFrom = from.toISOString().slice(0, 10);
  statsState.dateTo = to.toISOString().slice(0, 10);
  renderStatsPage();
}

// ── INIT ──────────────────────────────────────────────────
async function initApp() {
  loadLocalCache();
  render();
  await loadShipments();
  // Auto-archive old delivered in background (no longer deletes)
  autoArchiveOldDelivered().then(archived => {
    if (archived > 0) {
      showToast(`📦 ${archived} spedizioni consegnate da oltre 1 mese archiviate`);
      loadShipments();
    }
  }).catch(() => {});
}

async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  // Check existing session
  const user = await getCurrentUser();
  if (user) {
    state.user = user;
    showAppScreen();
    await initApp();
  } else {
    showLoginScreen();
  }

  // Auto-refresh when app becomes visible again (after being in background)
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.user) {
      const lastSyncMs = state.lastSync ? Date.now() - parseLastSync(state.lastSync) : Infinity;
      // If more than 2 minutes since last sync, refresh
      if (lastSyncMs > 2 * 60 * 1000) {
        loadShipments();
      }
    }
  });

  // Auto-refresh when window gains focus (desktop)
  window.addEventListener("focus", () => {
    if (state.user) {
      const lastSyncMs = state.lastSync ? Date.now() - parseLastSync(state.lastSync) : Infinity;
      if (lastSyncMs > 2 * 60 * 1000) {
        loadShipments();
      }
    }
  });
}

function parseLastSync(s) {
  if (!s) return 0;
  // Parse Italian format: "25/04/2026, 17:30:25"
  try {
    const [datePart, timePart] = s.split(", ");
    const [day, month, year] = datePart.split("/");
    return new Date(`${year}-${month}-${day}T${timePart || "00:00:00"}`).getTime();
  } catch {
    return 0;
  }
}

document.addEventListener("DOMContentLoaded", init);
