const CACHE = "gold-cache-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) =>
      c.addAll([
        "./",
        "./index.html",
        "./manifest.json",
        "./service-worker.js",
        "./data/price.json",
        "./data/history.jsonl",
        "./icon-192.png",
        "./icon-512.png"
      ]).catch(()=>{})
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k !== CACHE ? caches.delete(k) : Promise.resolve())))
    )
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Network-first for latest data
  if (url.pathname.endsWith("/data/price.json") || url.pathname.endsWith("/data/history.jsonl")) {
    event.respondWith(
      fetch(event.request).then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(event.request, copy));
        return r;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(event.request).then(hit => hit || fetch(event.request))
  );
});
