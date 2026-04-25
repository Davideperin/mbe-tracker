// ── SUPABASE CONFIG ──────────────────────────────────────
const SUPABASE_URL = "https://ilxsbmbdlxcqmcijnnee.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlseHNibWJkbHhjcW1jaWpubmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNDQ3MDcsImV4cCI6MjA5MjcyMDcwN30.4UZdHQ4JIWM-u5iR59w6on70kblxB92J1WPoyxiAQNo";

// Initialize Supabase client
let supabase;
if (window.supabase && window.supabase.createClient) {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} else {
  console.error("Supabase library not loaded");
}
