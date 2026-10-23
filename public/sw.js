// Service worker: keeps the app shell and barcode renderer available offline.
// Card data itself is mirrored in IndexedDB by the app; logos are cached here.
const VERSION = 'v2';
const SHELL = `shell-${VERSION}`;
const LOGOS = 'logos';

const PRECACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/formats.js',
  '/manifest.webmanifest',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/js/dom.js',
  '/js/store.js',
  '/js/state.js',
  '/js/barcode.js',
  '/js/scan.js',
  '/js/views-auth.js',
  '/js/views-cards.js',
  '/js/views-import.js',
  '/js/views-settings.js',
  '/vendor/bwip-js/bwip-js.mjs',
  '/vendor/bwip-js/bwipp.mjs',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Logos are content-addressed, so a cached copy never goes stale.
  if (url.pathname.startsWith('/api/logos/') && !url.pathname.startsWith('/api/logos/search')) {
    event.respondWith(cacheFirst(LOGOS, req));
    return;
  }
  // Other API calls always go to the network; the app handles offline.
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req).then((res) => res ?? caches.match('/index.html')));
    return;
  }
  // Large vendored libraries rarely change: serve from cache, refresh behind.
  if (url.pathname.startsWith('/vendor/')) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
  // App code: fresh when online so updates apply on the next launch, cached
  // copy when offline or the server is slow to answer.
  event.respondWith(networkFirst(req).then((res) => res ?? fetch(req)));
});

async function networkFirst(req, timeoutMs = 3000) {
  const cache = await caches.open(SHELL);
  const network = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, timeoutMs));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch {}
  return (await cache.match(req, { ignoreSearch: true })) ?? network.catch(() => undefined);
}

async function cacheFirst(cacheName, req) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit ?? network;
}
