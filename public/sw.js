/* 123Dzo native service worker: explicit static assets only, no business cache. */
'use strict';
const CACHE = '123dzo-static-v1';
const ASSETS = ['/offline.html', '/icon-192x192.png', '/icon-512x512.png', '/icon-maskable-512.png', '/apple-touch-icon.png', '/sounds/ting-ting.wav'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('123dzo-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/') || req.headers.get('RSC') === '1') return;
  // RSC/prefetch/API must preserve real network failure/status, never HTML fallback.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req, { cache: 'no-store' }).catch(async () => (await caches.match('/offline.html')) || Response.error()));
  } else if (!url.search && ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(req).then(cached => cached || fetch(req)));
  }
});
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { /* generic content only */ }
  const tag = payload && typeof payload.tag === 'string' && /^notification-[0-9a-f-]{36}$/i.test(payload.tag) ? payload.tag : '123dzo-work';
  event.waitUntil(self.registration.showNotification('123Dzô · Có công việc cần kiểm tra', {
    body: 'Mở màn hình Phục vụ để xem thông tin mới nhất.', icon: '/icon-192x192.png', badge: '/icon-192x192.png',
    tag, data: { url: '/staff' },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      const url = new URL(client.url);
      if (url.origin === self.location.origin && url.pathname === '/staff') { await client.focus(); return; }
    }
    await self.clients.openWindow(new URL('/staff', self.location.origin).href);
  })());
});
