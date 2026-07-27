// Service worker for offline support - network-first for every same-origin
// GET request, falling back to a cached copy only when the network is
// unavailable, and re-caching every successful response as it comes in.
//
// Deliberately NOT cache-first: this project got bitten more than once by
// a *dev server* serving stale JS/CSS from the browser's own HTTP cache
// (see specs/02-swara-keyboard-finder.md's "Data loading") - a cache-first
// service worker would reintroduce that same staleness risk permanently,
// baked into an installed app the human can't just hard-refresh their way
// out of. Network-first means anyone with connectivity always gets
// current content; the cache exists purely for when they don't have any.

const CACHE_NAME = "raga-finder-v2"; // bump whenever the precache list below changes

const PRECACHE_URLS = [
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/ragas.js",
  "./js/audio.js",
  "./js/notation.js",
  // One entry per input style. cache.addAll() is all-or-nothing - a single
  // 404 rejects the whole install and leaves the app with no offline copy
  // at all - so this list has to track src/js/inputs/ exactly. It listed
  // assembler.js for a while after that style was merged into Buttons and
  // its file deleted, which silently disabled precaching entirely.
  "./js/inputs/piano.js",
  "./js/inputs/buttons.js",
  "./js/inputs/wheel.js",
  "../data/ragas.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Only same-origin GETs (our own app files) go through the cache -
  // cross-origin requests (the Forum Google Font) are left to the browser's
  // own normal handling, since falling back to the system font if that
  // ever fails offline is already an accepted, graceful degradation (see
  // "Visual design").
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
