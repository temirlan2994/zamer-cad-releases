// Service worker: makes the app installable and usable offline.
// Strategy: network-first (always fresh when online, updates the cache),
// falling back to cache when offline. Saves (/api/*) always go to the network.
// Bump CACHE when you want to force-clear old cached files.
const CACHE = "zamer-v267";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./app.js?v=267",
  "./styles.css?v=267",
  "./core/geometry.js?v=225",
  "./core/geometry.js",
  "./core/interaction.js?v=225",
  "./core/line-input.js",
  "./core/line-layers.js",
  "./core/polyline.js",
  "./core/line-edits.js",
  "./core/line-fillet.js",
  "./core/figure-edits.js",
  "./core/blocks.js",
  "./core/dxf.js",
  "./core/dxf-modern.js",
  "./core/dimensions.js",
  "./core/dimension-artwork.js",
  "./core/plan-annotations.js",
  "./core/plan-region.js",
  "./core/plan-region.js",
  "./core/annotation-text.js",
  "./core/survey.js",
  "./core/survey-panel.js",
  "./core/survey-laser.js",
  "./core/pdf.js",
  "./core/project-format.js",
  "./core/project-preview.js",
  "./core/project-settings.js",
  "./core/zip.js",
  "./core/dxf-writer.js",
  "./core/sync.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-180.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match("./index.html")),
      ),
  );
});
