const CACHE = "mbe-tracker-v1";
const ASSETS = ["/", "/index.html", "/app.js", "/style.css", "/manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  // Network first for API calls
  if (e.request.url.includes("/api/")) {
    e.respondWith(fetch(e.request).catch(() => new Response(JSON.stringify({ ok: false, error: "Offline" }), { headers: { "Content-Type": "application/json" } })));
    return;
  }
  // Cache first for assets
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});
