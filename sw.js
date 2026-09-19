const CACHE = "webshot-v4";
const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/game.js",
  "./manifest.webmanifest",
  "./favicon.png",
  "./favicon.ico",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./assets/hero.png",
  "./assets/thug.png",
  "./assets/thug-wrapped.png",
  "./assets/gunner.png",
  "./assets/gunner-wrapped.png",
  "./assets/city.jpg",
  "./assets/rooftop.jpg",
  "./assets/water-tower.png",
  "./assets/ac-unit.png",
  "./assets/web-burst.png",
  "./assets/heart.png",
  "./assets/play.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (!res || res.status !== 200 || res.type === "opaque") return res;
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return res;
      });
    })
  );
});
