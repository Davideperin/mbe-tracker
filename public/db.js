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
    attachmentUrl: row.attachment_url,
    attachmentName: row.attachment_name,
    archived: row.archived,
    currency: row.currency || "EUR",
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
    currency: s.currency || "EUR",
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
    .update({ status: newStatus, progress })
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
    currency: billing.currency || "EUR",
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
  const fileName = `${masterTracking}_${Date.now()}.${ext}`;
  const { error: uploadError } = await sb.storage
    .from("attachments")
    .upload(fileName, file, { cacheControl: "3600", upsert: false });
  if (uploadError) throw uploadError;

  // Get signed URL (valid for 1 year)
  const { data: urlData, error: urlError } = await sb.storage
    .from("attachments")
    .createSignedUrl(fileName, 60 * 60 * 24 * 365);
  if (urlError) throw urlError;

  // Save URL and original name in DB
  await sb.from("shipments").update({
    attachment_url: urlData.signedUrl,
    attachment_name: file.name,
  }).eq("master_tracking", masterTracking);

  return { url: urlData.signedUrl, name: file.name, path: fileName };
}

async function deleteAttachment(masterTracking, attachmentUrl) {
  // Extract filename from URL
  try {
    const match = attachmentUrl.match(/\/attachments\/([^?]+)/);
    if (match) {
      await sb.storage.from("attachments").remove([match[1]]);
    }
  } catch {}
  await sb.from("shipments").update({
    attachment_url: null,
    attachment_name: null,
  }).eq("master_tracking", masterTracking);
}
