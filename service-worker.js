/* service-worker.js
   Gold Portfolio – GitHub Pages / PWA
   - ALWAYS network for live data (price/history) + NO caching of those files
   - Cache-first for app shell assets
*/

const VERSION = "v4"; // <-- WICHTIG: hochzählen, damit iOS/Chrome sicher neu laden
const CACHE_NAME = `gold-portfolio-${VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./service-worker.js",
  "./icon-192.png",
  "./icon-512.png",
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
    const keys = await caches.keys();
    await Promise.all(
      keys.map((k) => (k.startsWith("gold-portfolio-") && k !== CACHE_NAME) ? caches.delete(k) : Promise.resolve())
    );
    await self.clients.claim();
  })());
});

// Helpers
async function networkOnlyWithFallback(request, { timeoutMs = 10000 } = {}) {
  const cache = await caches.open(CACHE_NAME);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // absolut live
    const fresh = await fetch(request, { cache: "no-store", signal: controller.signal });
    clearTimeout(timer);
    return fresh;
  } catch (e) {
    clearTimeout(timer);
    // fallback: wenn offline, nimm notfalls die letzte Version aus Cache (egal ob query-string anders)
    const cached = await cache.match(request, { ignoreSearch: true });
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

async function networkFirstHtml(request, { timeoutMs = 8000 } = {}) {
  const cache = await caches.open(CACHE_NAME);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fresh = await fetch(request, { cache: "no-store", signal: controller.signal });
    clearTimeout(timer);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (e) {
    clearTimeout(timer);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw e;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // ✅ LIVE DATA: niemals cachen, immer network (mit Offline-Fallback aus Cache)
  const isPrice = url.pathname.endsWith("/data/price.json");
  const isHistory = url.pathname.endsWith("/data/history.jsonl");

  if (isPrice || isHistory) {
    event.respondWith(networkOnlyWithFallback(req, { timeoutMs: 12000 }));
    return;
  }

  // HTML: network-first (damit Updates schnell kommen)
  const accept = req.headers.get("accept") || "";
  const isHTML =
    accept.includes("text/html") ||
    url.pathname.endsWith(".html") ||
    url.pathname === "/" ||
    url.pathname.endsWith("/");

  if (isHTML) {
    event.respondWith(networkFirstHtml(req, { timeoutMs: 8000 }));
    return;
  }

  // Assets: cache-first
  event.respondWith(cacheFirst(req));
});
