// ── DATABASE LAYER ───────────────────────────────────────

// ── AUTH ─────────────────────────────────────────────────
async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  await supabase.auth.signOut();
  state.user = null;
  state.shipments = [];
  state.notes = {};
  showLoginScreen();
}

async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// ── SHIPMENTS ────────────────────────────────────────────

// Map DB row (snake_case) → app object (camelCase)
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
    eventsLoaded: false,
  };
}

// Map app object → DB row
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
  };
}

async function loadShipmentsFromDB() {
  const { data, error } = await supabase
    .from("shipments")
    .select("*")
    .order("date", { ascending: false });
  if (error) throw error;
  return data.map(dbToApp);
}

async function insertShipments(shipments) {
  if (!shipments.length) return [];
  const rows = shipments.map(appToDb);
  const { data, error } = await supabase
    .from("shipments")
    .insert(rows)
    .select();
  if (error) throw error;
  return data.map(dbToApp);
}

async function updateShipmentDB(masterTracking, updates) {
  const { data, error } = await supabase
    .from("shipments")
    .update(appToDb(updates))
    .eq("master_tracking", masterTracking)
    .select()
    .single();
  if (error) throw error;
  return dbToApp(data);
}

async function deleteShipmentDB(masterTracking) {
  const { error } = await supabase
    .from("shipments")
    .delete()
    .eq("master_tracking", masterTracking);
  if (error) throw error;
}

async function bulkDeleteDB(masterTrackings) {
  const { error } = await supabase
    .from("shipments")
    .delete()
    .in("master_tracking", masterTrackings);
  if (error) throw error;
}

async function bulkUpdateStatusDB(masterTrackings, newStatus) {
  const progress = { delivered: 100, transit: 60, exception: 40, pending: 15 }[newStatus] || 15;
  const { error } = await supabase
    .from("shipments")
    .update({ status: newStatus, progress })
    .in("master_tracking", masterTrackings);
  if (error) throw error;
}

async function updateNoteDB(masterTracking, note) {
  const { error } = await supabase
    .from("shipments")
    .update({ note })
    .eq("master_tracking", masterTracking);
  if (error) throw error;
}

// Cleanup old delivered shipments (>30 days)
async function cleanupOldDeliveredDB() {
  const { data, error } = await supabase
    .from("shipments")
    .select("id, date, status")
    .eq("status", "delivered");
  if (error) return 0;

  const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const toDelete = data.filter(s => {
    const ts = parseDateForSort(s.date);
    return ts > 0 && ts < cutoff;
  }).map(s => s.id);

  if (!toDelete.length) return 0;

  await supabase.from("shipments").delete().in("id", toDelete);
  return toDelete.length;
}
