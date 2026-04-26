// ── DATABASE LAYER ───────────────────────────────────────

// ── AUTH ─────────────────────────────────────────────────
async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  await sb.auth.signOut();
  state.user = null;
  state.shipments = [];
  showLoginScreen();
}

async function getCurrentUser() {
  const { data: { user } } = await sb.auth.getUser();
  return user;
}

// ── SHIPMENTS ────────────────────────────────────────────

function dbToApp(row) {
  return {
    id: row.id,
    masterTracking: row.master_tracking,
    courierTracking: row.courier_tracking,
    sender: row.sender,
    recipient: row.recipient,
    companyName: row.company_name,
    city: row.city,
    country: row.country,
    date: row.date,
    courier: row.courier,
    service: row.service,
    state: row.state,
    reference: row.reference,
    description: row.description,
    source: row.source,
    status: row.status,
    progress: row.progress,
    events: row.events || [],
    note: row.note,
    cost: row.cost,
    customsDuty: row.customs_duty,
    brokerage: row.brokerage,
    mrn: row.mrn,
    entryNo: row.entry_no,
    notesBilling: row.notes_billing,
    attachments: parseAttachments(row.attachment_url, row.attachment_name),
    attachmentUrl: row.attachment_url,
    attachmentName: row.attachment_name,
    archived: row.archived,
    statusLocked: row.status_locked || false,
    currency: row.currency || "EUR",  // legacy field, kept for backward compat
    costCurrency: row.cost_currency || "EUR",
    customsDutyCurrency: row.customs_duty_currency || "EUR",
    brokerageCurrency: row.brokerage_currency || "EUR",
    deliveryDate: row.delivery_date,
    eventsLoaded: false,
  };
}

function appToDb(s) {
  return {
    master_tracking: s.masterTracking,
    courier_tracking: s.courierTracking,
    sender: s.sender,
    recipient: s.recipient,
    company_name: s.companyName,
    city: s.city,
    country: s.country,
    date: s.date,
    courier: s.courier,
    service: s.service,
    state: s.state,
    reference: s.reference,
    description: s.description,
    source: s.source,
    status: s.status,
    progress: s.progress,
    events: s.events || [],
    note: s.note,
    cost: s.cost ?? null,
    customs_duty: s.customsDuty ?? null,
    brokerage: s.brokerage ?? null,
    mrn: s.mrn ?? null,
    entry_no: s.entryNo ?? null,
    notes_billing: s.notesBilling ?? null,
    attachment_url: s.attachmentUrl ?? null,
    attachment_name: s.attachmentName ?? null,
    archived: s.archived ?? false,
    status_locked: s.statusLocked ?? false,
    currency: s.currency || "EUR",
    cost_currency: s.costCurrency || "EUR",
    customs_duty_currency: s.customsDutyCurrency || "EUR",
    brokerage_currency: s.brokerageCurrency || "EUR",
    delivery_date: s.deliveryDate ?? null,
  };
}

async function loadShipmentsFromDB() {
  const { data, error } = await sb
    .from("shipments")
    .select("*")
    .order("date", { ascending: false });
  if (error) throw error;
  return data.map(dbToApp);
}

async function insertShipments(shipments) {
  if (!shipments.length) return [];
  const rows = shipments.map(appToDb);
  const { data, error } = await sb.from("shipments").insert(rows).select();
  if (error) throw error;
  return data.map(dbToApp);
}

async function updateShipmentDB(masterTracking, updates) {
  const { data, error } = await sb
    .from("shipments")
    .update(appToDb(updates))
    .eq("master_tracking", masterTracking)
    .select()
    .single();
  if (error) throw error;
  return dbToApp(data);
}

async function deleteShipmentDB(masterTracking) {
  const { error } = await sb.from("shipments").delete().eq("master_tracking", masterTracking);
  if (error) throw error;
}

async function bulkDeleteDB(masterTrackings) {
  const { error } = await sb.from("shipments").delete().in("master_tracking", masterTrackings);
  if (error) throw error;
}

async function bulkUpdateStatusDB(masterTrackings, newStatus) {
  const progress = { delivered: 100, transit: 60, exception: 40, pending: 15 }[newStatus] || 15;
  const { error } = await sb
    .from("shipments")
    .update({ status: newStatus, progress, status_locked: true })
    .in("master_tracking", masterTrackings);
  if (error) throw error;
}

async function updateNoteDB(masterTracking, note) {
  const { error } = await sb.from("shipments").update({ note }).eq("master_tracking", masterTracking);
  if (error) throw error;
}

// Update billing fields
async function updateBillingDB(masterTracking, billing) {
  const { error } = await sb.from("shipments").update({
    cost: billing.cost ?? null,
    customs_duty: billing.customsDuty ?? null,
    brokerage: billing.brokerage ?? null,
    cost_currency: billing.costCurrency || "EUR",
    customs_duty_currency: billing.customsDutyCurrency || "EUR",
    brokerage_currency: billing.brokerageCurrency || "EUR",
    mrn: billing.mrn ?? null,
    entry_no: billing.entryNo ?? null,
    notes_billing: billing.notesBilling ?? null,
  }).eq("master_tracking", masterTracking);
  if (error) throw error;
}

// Auto-archive delivered shipments older than 30 days (instead of deleting)
async function autoArchiveOldDelivered() {
  const { data, error } = await sb
    .from("shipments")
    .select("id, date, status, archived")
    .eq("status", "delivered")
    .eq("archived", false);
  if (error) return 0;

  const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const toArchive = data.filter(s => {
    const ts = parseDateForSort(s.date);
    return ts > 0 && ts < cutoff;
  }).map(s => s.id);

  if (!toArchive.length) return 0;
  await sb.from("shipments").update({ archived: true }).in("id", toArchive);
  return toArchive.length;
}

// ── ATTACHMENTS ──────────────────────────────────────────
async function uploadAttachment(masterTracking, file) {
  const ext = file.name.split(".").pop();
  const fileName = `${masterTracking}_${Date.now()}_${Math.random().toString(36).slice(2,7)}.${ext}`;
  const { error: uploadError } = await sb.storage
    .from("attachments")
    .upload(fileName, file, { cacheControl: "3600", upsert: false });
  if (uploadError) throw uploadError;

  const { data: urlData, error: urlError } = await sb.storage
    .from("attachments")
    .createSignedUrl(fileName, 60 * 60 * 24 * 365);
  if (urlError) throw urlError;

  return { url: urlData.signedUrl, name: file.name, path: fileName };
}

async function saveAttachmentsList(masterTracking, attachments) {
  // Store as JSON in attachment_url field (legacy field repurposed as JSON list)
  await sb.from("shipments").update({
    attachment_url: JSON.stringify(attachments),
    attachment_name: attachments.length > 0 ? `${attachments.length} file` : null,
  }).eq("master_tracking", masterTracking);
}

async function deleteAttachmentFile(path) {
  try {
    await sb.storage.from("attachments").remove([path]);
  } catch {}
}


function parseAttachments(url, name) {
  if (!url) return [];
  // Try parsing as JSON array (new format)
  try {
    const parsed = JSON.parse(url);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  // Legacy single URL format
  return [{ url, name: name || "Allegato", path: extractPathFromUrl(url) }];
}

function extractPathFromUrl(url) {
  const m = url.match(/\/attachments\/([^?]+)/);
  return m ? m[1] : null;
}
