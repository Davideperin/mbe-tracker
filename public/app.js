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
  // Delivered
  if (s.includes("consegn") || s.includes("delivered") || s === "d") return "delivered";
  // PENDING: label created but not yet picked up (check this BEFORE transit)
  if (s.includes("new label") ||
      s.includes("not scanned yet") ||
      s.includes("information sent to") ||
      s.includes("creato un'etichetta") ||
      s.includes("creato unetichetta") ||
      s.includes("non ha ancora ricevuto") ||
      s.includes("label created") ||
      s.includes("etichetta creata") ||
      s.includes("ready for") ||
      s.includes("pronto per")) return "pending";
  // Exception
  if (s.includes("eccez") || s.includes("exception") || s === "e" || s.includes("customs") || s.includes("dogana")) return "exception";
  // Transit
  if (s.includes("transit") || s.includes("transito") || s.includes("corso") || s === "t" || s.includes("smist") || s.includes("spedito") || s.includes("shipped")) return "transit";
  // Generic pending
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
  document.getElementById("stat-all").textContent = active.length;
  document.getElementById("stat-transit").textContent = active.filter(s => s.status === "transit").length;
  document.getElementById("stat-delivered").textContent = active.filter(s => s.status === "delivered").length;
  document.getElementById("stat-exception").textContent = active.filter(s => s.status === "exception").length;
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
        <div class="card-tracking">${formatSourceTracking(s)}</div>
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

    ${renderDeliveryInfo(s)}

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
  const hasCost = s.cost || s.customsDuty || s.brokerage || s.mrn || (s.attachments && s.attachments.length > 0);
  if (!hasCost) return "";
  const parts = [];
  if (s.cost) parts.push(`<span class="bill-item">Spedizione: <strong>${currencySymbol(s.costCurrency)}${parseFloat(s.cost).toFixed(2)}</strong></span>`);
  if (s.customsDuty) parts.push(`<span class="bill-item">Dazi: <strong>${currencySymbol(s.customsDutyCurrency)}${parseFloat(s.customsDuty).toFixed(2)}</strong></span>`);
  if (s.brokerage) parts.push(`<span class="bill-item">Sdoganamento: <strong>${currencySymbol(s.brokerageCurrency)}${parseFloat(s.brokerage).toFixed(2)}</strong></span>`);
  // Total per currency
  const totals = computeShipmentTotals(s);
  const totalParts = [];
  if (totals.eur > 0) totalParts.push(`€${totals.eur.toFixed(2)}`);
  if (totals.usd > 0) totalParts.push(`$${totals.usd.toFixed(2)}`);
  if (totalParts.length > 0 && (s.cost ? 1 : 0) + (s.customsDuty ? 1 : 0) + (s.brokerage ? 1 : 0) > 1) {
    parts.push(`<span class="bill-item bill-total">Totale: <strong>${totalParts.join(" + ")}</strong></span>`);
  }
  if (s.mrn) parts.push(`<span class="bill-item">MRN: <code>${s.mrn}</code></span>`);
  if (s.entryNo) parts.push(`<span class="bill-item">Entry: <code>${s.entryNo}</code></span>`);
  if (s.attachments && s.attachments.length > 0) {
    s.attachments.forEach(a => {
      parts.push(`<a href="${a.url}" target="_blank" class="bill-attachment">📎 ${a.name || "Allegato"}</a>`);
    });
  }
  return `<div class="card-billing">${parts.join("")}</div>`;
}


function renderDeliveryInfo(s) {
  if (s.status !== "delivered") return "";
  if (!s.deliveryDate && !s.deliverySign) return "";
  const parts = [];
  if (s.deliveryDate) {
    parts.push(`📅 Consegnata il <strong>${formatDate(s.deliveryDate)}</strong>`);
  }
  if (s.deliverySign) {
    parts.push(`✍️ Firmato da <strong>${escapeHtml(s.deliverySign)}</strong>`);
  }
  return `<div class="delivery-info">${parts.join("")}</div>`;
}

function computeShipmentTotals(s) {
  let eur = 0, usd = 0;
  const items = [
    { val: s.cost, cur: s.costCurrency },
    { val: s.customsDuty, cur: s.customsDutyCurrency },
    { val: s.brokerage, cur: s.brokerageCurrency },
  ];
  items.forEach(({ val, cur }) => {
    const v = parseFloat(val) || 0;
    if (v > 0) {
      if (cur === "USD") usd += v;
      else eur += v;
    }
  });
  return { eur, usd };
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
      if (state.selected.has(s.masterTracking)) return { ...s, status: newStatus, progress, statusLocked: true };
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

  setVal("billing-modal-title", s.recipient || masterTracking, "text");
  setVal("billing-cost", s.cost || "");
  setVal("billing-cost-currency", s.costCurrency || "EUR");
  setVal("billing-customs", s.customsDuty || "");
  setVal("billing-customs-currency", s.customsDutyCurrency || "EUR");
  setVal("billing-brokerage", s.brokerage || "");
  setVal("billing-brokerage-currency", s.brokerageCurrency || "EUR");
  setVal("billing-mrn", s.mrn || "");
  setVal("billing-entry", s.entryNo || "");
  setVal("billing-notes", s.notesBilling || "");

  renderAttachmentsList(s);
  document.getElementById("billing-modal").classList.add("open");
}

// Safe setter: skips elements that don't exist
function setVal(id, val, type) {
  const el = document.getElementById(id);
  if (!el) return;
  if (type === "text") el.textContent = val;
  else el.value = val;
}

// Safe getter
function getVal(id, defaultVal) {
  const el = document.getElementById(id);
  return el ? el.value : (defaultVal !== undefined ? defaultVal : "");
}

function renderAttachmentsList(s) {
  const attachInfo = document.getElementById("billing-attachment-info");
  const list = s.attachments || [];
  if (list.length === 0) {
    attachInfo.innerHTML = "";
    return;
  }
  attachInfo.innerHTML = list.map((a, i) => `
    <div class="attachment-row">
      <a href="${a.url}" target="_blank">📎 ${a.name || "Allegato"}</a>
      <button class="btn-sm danger" onclick="removeAttachmentAt(${i})">Rimuovi</button>
    </div>
  `).join("");
}

async function removeAttachmentAt(idx) {
  if (!currentBillingTracking) return;
  if (!confirm("Rimuovere questo allegato?")) return;
  const s = state.shipments.find(x => x.masterTracking === currentBillingTracking);
  if (!s || !s.attachments) return;
  const removed = s.attachments[idx];
  s.attachments = s.attachments.filter((_, i) => i !== idx);
  try {
    if (removed && removed.path) await deleteAttachmentFile(removed.path);
    await saveAttachmentsList(currentBillingTracking, s.attachments);
    renderAttachmentsList(s);
    render();
    showToast("Allegato rimosso");
  } catch (e) {
    showToast("Errore: " + e.message);
  }
}

function closeBillingModal() {
  document.getElementById("billing-modal").classList.remove("open");
  currentBillingTracking = null;
  document.getElementById("billing-file").value = "";
}

async function saveBilling() {
  if (!currentBillingTracking) return;
  const billing = {
    cost: parseFloat(getVal("billing-cost")) || null,
    costCurrency: getVal("billing-cost-currency", "EUR"),
    customsDuty: parseFloat(getVal("billing-customs")) || null,
    customsDutyCurrency: getVal("billing-customs-currency", "EUR"),
    brokerage: parseFloat(getVal("billing-brokerage")) || null,
    brokerageCurrency: getVal("billing-brokerage-currency", "EUR"),
    mrn: getVal("billing-mrn").trim() || null,
    entryNo: getVal("billing-entry").trim() || null,
    notesBilling: getVal("billing-notes").trim() || null,
  };

  const btn = document.getElementById("billing-save-btn");
  btn.disabled = true;
  btn.textContent = "Salvataggio...";

  try {
    await updateBillingDB(currentBillingTracking, billing);

    // Handle multiple file uploads
    const fileInput = document.getElementById("billing-file");
    if (fileInput.files && fileInput.files.length > 0) {
      const s = state.shipments.find(x => x.masterTracking === currentBillingTracking);
      if (!s.attachments) s.attachments = [];
      for (let i = 0; i < fileInput.files.length; i++) {
        const f = fileInput.files[i];
        btn.textContent = `Caricamento ${i+1}/${fileInput.files.length}...`;
        const result = await uploadAttachment(currentBillingTracking, f);
        s.attachments.push(result);
      }
      await saveAttachmentsList(currentBillingTracking, s.attachments);
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
          costCurrency: "USD",
          customsDutyCurrency: "USD",
          brokerageCurrency: "USD",
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
        costCurrency: "EUR",
        customsDutyCurrency: "EUR",
        brokerageCurrency: "EUR",
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
        // If status was manually set, we IGNORE incoming status changes
        const statusChanged = !found.statusLocked && (oldStatus !== newStatus || found.state !== r.state);
        // Detect cost change: import has a cost AND it differs from existing
        const costChanged = r.cost && parseFloat(r.cost) > 0 && parseFloat(r.cost) !== parseFloat(found.cost || 0);
        if (statusChanged || costChanged) {
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
      // Smart merge: keep manually-edited fields from existing, but apply imported values where present
      // If statusLocked, keep existing status; otherwise update from import
      const newStatus = existing.statusLocked ? existing.status : normalizeStatus(incoming.state, incoming.courierTracking);
      const newState = existing.statusLocked ? existing.state : (incoming.state || existing.state);
      const merged = enrichShipment({
        ...existing,
        // Always update from import:
        state: newState,
        status: newStatus,
        statusLocked: existing.statusLocked,
        date: incoming.date || existing.date,
        // Update cost only if import has a value (don't wipe manually-entered cost)
        cost: incoming.cost !== null && incoming.cost !== undefined ? incoming.cost : existing.cost,
        costCurrency: incoming.costCurrency || existing.costCurrency || "EUR",
        // Preserve manually entered billing fields (MRN, customs, brokerage, notes, attachments)
        customsDuty: existing.customsDuty,
        customsDutyCurrency: existing.customsDutyCurrency,
        brokerage: existing.brokerage,
        brokerageCurrency: existing.brokerageCurrency,
        mrn: existing.mrn,
        entryNo: existing.entryNo,
        notesBilling: existing.notesBilling,
        attachments: existing.attachments,
        attachmentUrl: existing.attachmentUrl,
        attachmentName: existing.attachmentName,
        note: existing.note,
      });
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

function showToast(msg, duration = 4500) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(() => t.classList.remove("show"), duration);
}

function formatSourceTracking(s) {
  const src = s.source || "";
  // PirateShip: show "PirateShip" label with the original tracking number (without PS- prefix)
  if (src === "PirateShip") {
    const cleanTrk = (s.masterTracking || "").replace(/^PS-/, "");
    return `PirateShip: ${cleanTrk || "—"}`;
  }
  // MBE: show MBE label
  if (src === "MBE") return `MBE: ${s.masterTracking || "—"}`;
  // Other brokers/imports: show source name if available
  if (src) return `${src}: ${s.masterTracking || "—"}`;
  // Manual or unknown: show tracking only
  return s.masterTracking || "—";
}

function formatDate(d) {
  if (!d) return "—";
  const ts = parseDateForSort(d);
  if (ts === 0) return d;
  return new Date(ts).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

function parseDateForSort(d) {
  if (!d) return 0;
  if (typeof d !== "string") {
    const t = new Date(d).getTime();
    return isNaN(t) ? 0 : t;
  }

  // ISO format: YYYY-MM-DD (from MBE API)
  const isoMatch = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const [_, y, m, day] = isoMatch;
    const t = new Date(parseInt(y), parseInt(m) - 1, parseInt(day)).getTime();
    if (!isNaN(t)) return t;
  }

  // PirateShip format: "Tuesday, 4/21/26 4:22 PM PDT"
  const psMatch = d.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (psMatch && d.includes(",")) {
    const [_, m, day, y] = psMatch;
    let year = parseInt(y);
    if (year < 100) year += 2000;
    const t = new Date(year, parseInt(m) - 1, parseInt(day)).getTime();
    if (!isNaN(t)) return t;
  }

  // Italian format: DD/MM/YYYY
  if (d.includes("/")) {
    const parts = d.split(" ")[0].split("/");
    if (parts.length === 3) {
      const [day, month, year] = parts;
      let y = parseInt(year);
      if (y < 100) y += 2000;
      const t = new Date(y, parseInt(month) - 1, parseInt(day)).getTime();
      if (!isNaN(t)) return t;
    }
  }

  // ISO or any other format — final fallback
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
  sortBy: "date",
  compareYoY: false,
  quickRange: 6,
};

function openStats() {
  // Default range: last 6 months
  if (!statsState.dateFrom) {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    statsState.dateFrom = sixMonthsAgo.toISOString().slice(0, 10);
    statsState.dateTo = new Date().toISOString().slice(0, 10);
    statsState.quickRange = 6;
  }
  document.getElementById("stats-screen").style.display = "block";
  document.getElementById("app-screen").style.display = "none";
  // Set active button
  setTimeout(() => {
    document.querySelectorAll(".stats-quick-ranges .filter-chip").forEach(b => {
      b.classList.toggle("active", parseInt(b.dataset.months) === (statsState.quickRange || 6));
    });
  }, 0);
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
    const cd = parseFloat(s.customsDuty) || 0;
    const br = parseFloat(s.brokerage) || 0;
    if (s.costCurrency === "USD") costUsd += cost; else costEur += cost;
    if (s.customsDutyCurrency === "USD") customsUsd += cd; else customsEur += cd;
    if (s.brokerageCurrency === "USD") customsUsd += br; else customsEur += br;
    const t = computeShipmentTotals(s);
    totalEur += t.eur;
    totalUsd += t.usd;
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
    const tot = computeShipmentTotals(s);
    monthly[key].eur += tot.eur;
    monthly[key].usd += tot.usd;
  });

  // Fill in empty months in the selected range (so 1y selection shows 12 months)
  if (statsState.dateFrom && statsState.dateTo) {
    const start = new Date(statsState.dateFrom);
    const end = new Date(statsState.dateTo);
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cursor <= endMonth) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      if (!monthly[key]) monthly[key] = { count: 0, eur: 0, usd: 0 };
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

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
        ${renderMonthlyChart([...sortedMonths].reverse(), monthly)}
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
    const tot = computeShipmentTotals(s);
    breakdown[c].eur += tot.eur;
    breakdown[c].usd += tot.usd;
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
          const cur = field === "cost" ? s.costCurrency : s.customsDutyCurrency;
          const sym = currencySymbol(cur);
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
  // Compute YoY data if enabled
  let prevData = {};
  if (statsState.compareYoY) {
    state.shipments.forEach(s => {
      const t = parseDateForSort(s.date);
      if (!t) return;
      const d = new Date(t);
      const prevYearKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!prevData[prevYearKey]) prevData[prevYearKey] = { count: 0, eur: 0, usd: 0 };
      prevData[prevYearKey].count++;
      const tot = computeShipmentTotals(s);
      prevData[prevYearKey].eur += tot.eur;
      prevData[prevYearKey].usd += tot.usd;
    });
  }

  const monthNames = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return months.map(m => {
    const d = data[m];
    const [year, month] = m.split("-");
    const label = monthNames[parseInt(month) - 1] + " " + year.slice(2);
    const isCurrent = m === currentKey;

    // YoY compare: same month previous year
    let yoyText = "";
    if (statsState.compareYoY) {
      const prevKey = `${parseInt(year) - 1}-${month}`;
      const prev = prevData[prevKey];
      if (prev) {
        const diff = d.count - prev.count;
        const pct = prev.count > 0 ? Math.round((diff / prev.count) * 100) : 0;
        const sign = diff > 0 ? "↑" : diff < 0 ? "↓" : "=";
        const cls = diff > 0 ? "yoy-up" : diff < 0 ? "yoy-down" : "yoy-eq";
        yoyText = `<span class="yoy-badge ${cls}">${sign} ${Math.abs(diff)} (${pct >= 0 ? "+" : ""}${pct}%)</span>`;
      } else {
        yoyText = `<span class="yoy-badge yoy-new">nuovo</span>`;
      }
    }

    const costParts = [];
    if (d.eur > 0) costParts.push(`€${d.eur.toFixed(0)}`);
    if (d.usd > 0) costParts.push(`$${d.usd.toFixed(0)}`);

    return `<div class="month-row ${isCurrent ? "current" : ""}">
      <div class="month-row-label">${label}${isCurrent ? ' <span class="current-badge">in corso</span>' : ""}</div>
      <div class="month-row-count">${d.count} <span class="month-row-cost">${costParts.join(" · ") || "—"}</span></div>
      ${yoyText}
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

function resetStatsFilters() {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  statsState.dateFrom = sixMonthsAgo.toISOString().slice(0, 10);
  statsState.dateTo = new Date().toISOString().slice(0, 10);
  statsState.filterSender = "";
  statsState.filterRecipient = "";
  statsState.filterCourier = "";
  statsState.compareYoY = false;
  // Clear input fields
  document.querySelectorAll(".stats-text-filters input").forEach(i => i.value = "");
  const cs = document.getElementById("stats-courier");
  if (cs) cs.value = "";
  renderStatsPage();
}

function toggleYoYCompare() {
  statsState.compareYoY = !statsState.compareYoY;
  document.getElementById("yoy-toggle").classList.toggle("active", statsState.compareYoY);
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
  statsState.quickRange = months;
  // Update visual active state
  document.querySelectorAll(".stats-quick-ranges .filter-chip").forEach(b => {
    b.classList.toggle("active", parseInt(b.dataset.months) === months);
  });
  renderStatsPage();
}


// ── SYNC FROM MBE API ─────────────────────────────────────
async function syncFromMBE() {
  // Get all MBE shipments that need syncing:
  // - not archived
  // - has MBE master tracking format (starts with IT)
  // - either: not delivered yet, OR delivered but missing delivery info
  const candidates = state.shipments.filter(s =>
    !s.archived &&
    s.masterTracking &&
    s.masterTracking.startsWith("IT") &&
    (s.status !== "delivered" || !s.deliveryDate || !s.deliverySign)
  );

  if (candidates.length === 0) {
    showToast("Nessuna spedizione MBE da aggiornare");
    return;
  }

  const btn = document.getElementById("mbe-sync-btn");
  if (btn) {
    btn.disabled = true;
    btn.classList.add("spinning");
  }

  showToast(`Sincronizzazione di ${candidates.length} spedizioni MBE...`);

  try {
    const trackings = candidates.map(s => s.masterTracking);
    const results = await syncMBEStatusBatch(trackings);

    let updated = 0;
    let delivered = 0;
    for (const result of results) {
      if (!result.tracking || !result.status) continue;
      const local = state.shipments.find(s => s.masterTracking === result.tracking);
      if (!local) continue;
      // Skip if user has manually locked the status
      if (local.statusLocked) continue;

      const newStatus = mapMBEStatus(result.status);
      const statusChanged = local.status !== newStatus;
      const newDeliveryDate = result.deliveryDate && local.deliveryDate !== result.deliveryDate;
      const newDeliverySign = result.deliverySign && local.deliverySign !== result.deliverySign;

      if (statusChanged || newDeliveryDate || newDeliverySign) {
        await applyMBEUpdate(result.tracking, result);
        updated++;
        if (newStatus === "delivered" && local.status !== "delivered") delivered++;

        // Update local state immediately for UI
        local.state = result.status;
        local.status = newStatus;
        local.progress = { delivered: 100, transit: 60, exception: 40, pending: 15 }[newStatus] || 15;
        if (newDeliveryDate) local.deliveryDate = newDeliveryDate;
        if (result.deliverySign) local.deliverySign = result.deliverySign;
        if (result.courierTracking && !local.courierTracking) local.courierTracking = result.courierTracking;
      }
    }

    state.lastSync = new Date().toLocaleString("it-IT");
    saveLocalCache();
    render();

    if (updated === 0) {
      showToast("✓ Tutte le spedizioni sono già aggiornate");
    } else if (delivered > 0) {
      showToast(`✓ ${updated} aggiornate · ${delivered} consegnate! 📦`);
    } else {
      showToast(`✓ ${updated} spedizioni aggiornate da MBE`);
    }
  } catch (e) {
    console.error("MBE sync error:", e);
    showToast("Errore sync MBE: " + e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("spinning");
    }
  }
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
