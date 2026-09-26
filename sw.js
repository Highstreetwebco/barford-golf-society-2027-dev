// Replace the retired 2027 offline app without touching other sites on this host.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('barford-golf-2027-')).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
// Fresh pages and data always come from the network for this baseline.
