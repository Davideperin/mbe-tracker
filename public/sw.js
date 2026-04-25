const CACHE = "shipment-tracker-v" + Date.now();
const ASSETS = ["/", "/index.html", "/app.js", "/db.js", "/supabase-config.js", "/style.css", "/manifest.json"];

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
  // Network-first for HTML and JS files (always check for updates)
  if (e.request.url.match(/\.(html|js|css|json)$/) || e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          // Update cache in background
          const respClone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, respClone));
          return resp;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  // Cache-first for other assets (images, etc.)
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});
