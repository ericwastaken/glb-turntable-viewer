// zipfs service worker: serves the contents of a user-dropped zip under
// virtual same-origin URLs (<page dir>/zipfs/<id>/<path>). The page unzips
// and puts each entry into the Cache API; this worker only answers fetches
// for those URLs from that cache. It never fetches anything remote and
// ignores every request outside /zipfs/.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || !url.pathname.includes('/zipfs/')) return;
  e.respondWith((async () => {
    const cache = await caches.open('zipfs');
    // ignoreSearch, because a URL inside the zip may arrive with a query the
    // cache key does not have: the viewer appends a cache-busting token to a
    // module import for ?dev=all, and a per-attempt one to make a RETRY reach
    // the network at all (AGENT.md §10.17). The path is the identity here —
    // nothing under /zipfs/ has a meaningful query string.
    const hit = await cache.match(e.request.url, { ignoreSearch: true });
    return hit || new Response(`zipfs: not found: ${url.pathname}`, { status: 404 });
  })());
});
