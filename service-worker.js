/* service-worker.js
   Gold Portfolio – GitHub Pages / PWA
   - Network-first for live data (price/history)
   - Cache-first for app shell (offline-ready)
*/

const VERSION = "v3"; // <-- hochzählen, wenn du SW sicher neu ausrollen willst
const CACHE_NAME = `gold-portfolio-${VERSION}`;

// App-Shell: passe ggf. an deine echten Dateinamen an
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./service-worker.js",
  "./icon-192.png",
  "./icon-512.png",
  // falls du separate Dateien hast, ergänzen:
  // "./styles.css",
  // "./app.js",
  // "./engine.js",
  // "./data/price.json",      // optional: würde bei Offline helfen, aber wir holen live per network-first
  // "./data/history.jsonl"    // optional
];

// Sofort aktiv werden
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Alte Caches löschen
    const keys = await caches.keys();
    await Promise.all(
      keys.map((k) => (k.startsWith("gold-portfolio-") && k !== CACHE_NAME) ? caches.delete(k) : Promise.resolve())
    );
    await self.clients.claim();
  })());
});

// Helpers
async function networkFirst(request, { timeoutMs = 8000 } = {}) {
  const cache = await caches.open(CACHE_NAME);

  // Timeout-Wrapper (damit iOS nicht ewig hängt)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Wichtig: keine Browser-Cache-Zwischenstufe
    const fresh = await fetch(request, { cache: "no-store", signal: controller.signal });
    clearTimeout(timer);

    // Nur erfolgreiche GETs cachen
    if (fresh && fresh.ok && request.method === "GET") {
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (e) {
    clearTimeout(timer);
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) return cached;
    throw e;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: false });
  if (cached) return cached;

  const fresh = await fetch(request);
  if (fresh && fresh.ok && request.method === "GET") {
    cache.put(request, fresh.clone());
  }
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Nur GET cachen/handlen
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Nur auf derselben Origin arbeiten (GitHub Pages)
  if (url.origin !== self.location.origin) return;

  // ✅ LIVE-DATEN: IMMER Network-First (entscheidend für Preis-Updates!)
  // Achtung: pathname kann je nach Repo-Subpath so aussehen:
  // /<repo>/data/price.json
  const isPrice = url.pathname.endsWith("/data/price.json");
  const isHistory = url.pathname.endsWith("/data/history.jsonl");

  if (isPrice || isHistory) {
    event.respondWith(networkFirst(req, { timeoutMs: 10000 }));
    return;
  }

  // HTML: network-first (damit neue Versionen schneller kommen), fallback cache
  const accept = req.headers.get("accept") || "";
  const isHTML = accept.includes("text/html") || url.pathname.endsWith(".html") || url.pathname === "/" || url.pathname.endsWith("/");

  if (isHTML) {
    event.respondWith(networkFirst(req, { timeoutMs: 8000 }));
    return;
  }

  // Sonst: app shell / assets cache-first
  event.respondWith(cacheFirst(req));
});
