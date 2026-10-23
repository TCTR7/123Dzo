// Cache only a static offline page, never API responses, sessions or private HTML.
const CACHE = '123dzo-offline-v1';
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add('/offline.html')).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('123dzo-offline-') && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate' && event.request.method === 'GET') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
  }
});
