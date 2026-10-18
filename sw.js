// 2027 simple site, October 2026. Retire cached pages only within this app.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('barford-golf-2027-')).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
// Navigation and scripts must bypass the HTTP cache as well as Cache Storage.
// Otherwise a cached organiser page can load code for an older map format.
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (request.mode === 'navigate' || request.destination === 'script' || request.destination === 'style') {
    event.respondWith(fetch(request, { cache: 'no-store' }));
  }
});
