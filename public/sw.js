const CACHE_NAME = "denislearn-v4";
const scopePath = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const withScope = (path) => `${scopePath}${path}`;
const CORE_ASSETS = [withScope("/"), withScope("/data/cards.json"), withScope("/manifest.webmanifest")];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS).catch(() => undefined))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;
  const mustBeFresh =
    event.request.mode === "navigate" ||
    (sameOrigin &&
      (url.pathname.endsWith("/data/cards.json") ||
        url.pathname.endsWith("/manifest.webmanifest") ||
        url.pathname.endsWith("/sw.js") ||
        url.pathname.includes("/_next/")));

  if (mustBeFresh) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => undefined);
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => undefined);
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
