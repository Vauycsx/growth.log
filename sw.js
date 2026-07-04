/* growth.log — service worker
   Strategy:
   - App shell (HTML/manifest/icons): cache-first, falls back to network, refreshes cache in background
   - Everything else same-origin GET: network-first, falls back to cache, then to app shell offline page
   - Cross-origin (fonts, Supabase API, CDN scripts): network-first with cache fallback, never blocks on cache
   - Old cache versions are purged on activate
*/

const CACHE_VERSION = 'v5';
const CACHE_NAME = `growth-log-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192x192-any.png',
  './icons/icon-512x512-any.png',
  './icons/icon-512x512-maskable.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch(() => { /* ignore individual failures, don't block install */ })
        )
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function isAppShellRequest(url) {
  return APP_SHELL.some((path) => url.pathname.endsWith(path.replace('./', '/')) || url.pathname === '/');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // App shell: cache-first, refresh in background (stale-while-revalidate)
  if (sameOrigin && isAppShellRequest(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // Everything else: network-first, fall back to cache, then offline app shell
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.ok && sameOrigin) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return Response.error();
        })
      )
  );
});
