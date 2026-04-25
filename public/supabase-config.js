// ── SUPABASE CONFIG ──────────────────────────────────────
const SUPABASE_URL = "https://ilxsbmbdlxcqmcijnnee.supabase.co";
const SUPABASE_KEY = "sb_publishable_SQgyiNF7RMTf65_5o3o3-g_uuPTpdJR";

// Initialize Supabase client (loaded from CDN in HTML)
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
