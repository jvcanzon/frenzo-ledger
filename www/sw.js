// Keeps the app shell available offline; data always comes live from the database.
const CACHE = "frenzo-shell-v1";
const SHELL = ["./", "./index.html", "./js/config.js", "./js/adapter.js", "./js/login.js", "./vendor/supabase.js", "./vendor/jspdf.umd.min.js", "./vendor/jszip.min.js", "./vendor/xlsx.full.min.js", "./manifest.json", "./icons/icon-192.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // database calls go straight through
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
