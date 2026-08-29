// Service Worker — Ebon Crucible PWA
// Caches JS/CSS/HTML for offline shell, streams large assets from network.

const CACHE_NAME = 'ebon-crucible-v7';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Clean old cache versions
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip WebSocket, API calls, large model/animation files (always network)
  if (url.protocol === 'wss:' || url.protocol === 'ws:'
    || url.pathname.startsWith('/api/')
    || url.pathname.includes('/models/')
    || url.pathname.includes('/animations/')) {
    return;
  }

  // Cache-first for hashed JS/CSS assets (immutable — filename contains hash).
  // Never cache non-OK responses (404 during a partial deploy poisons the cache forever).
  if (url.pathname.match(/\.(js|css)$/) && url.pathname.includes('-')) {
    event.respondWith(
      caches.match(event.request).then((cached) =>
        cached || fetch(event.request).then((resp) => {
          if (resp && resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return resp;
        })
      )
    );
    return;
  }

  // Network-first for HTML (always get fresh version)
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for art/textures/audio (static assets, cache on first fetch)
  if (url.pathname.includes('/art/') || url.pathname.includes('/textures/')
    || url.pathname.includes('/audio/') || url.pathname.includes('/icons/')) {
    event.respondWith(
      caches.match(event.request).then((cached) =>
        cached || fetch(event.request).then((resp) => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return resp;
        })
      )
    );
    return;
  }
});
