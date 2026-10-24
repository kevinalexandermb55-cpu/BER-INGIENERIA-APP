const CACHE_NAME = "ber-viaticos-v5";
const ASSETS = ["./index.html", "./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png", "./assets/ber-logo.png"];
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(ASSETS.map(async path => { try { await cache.add(path); } catch (_) {} }));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("ber-viaticos-") && k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try { const response = await fetch(event.request); const cache = await caches.open(CACHE_NAME); cache.put("./index.html", response.clone()); return response; }
      catch (_) { return (await caches.match(event.request)) || (await caches.match("./index.html")); }
    })());
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try { const response = await fetch(event.request); if (response.ok) { const cache = await caches.open(CACHE_NAME); cache.put(event.request, response.clone()); } return response; }
    catch (_) { return cached || Response.error(); }
  })());
});
