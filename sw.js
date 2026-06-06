/* =============================================================================
   sw.js — reusable network-first offline cache for a single-page HTML app.

   SAFE TO REUSE across multiple apps, INCLUDING several GitHub Pages projects
   that share one origin (e.g. bullgator1.github.io/appA/, /appB/, ...).

   >>> THE ONLY LINE YOU CHANGE PER APP IS THE NEXT ONE. <<<
   Give each app a unique prefix so apps on the same origin never clobber each
   other's cache.
   ============================================================================= */

const APP = 'anes-proc';        // <-- CHANGE THIS per app: 'preop-guide', 'tox-ref', etc.

/* -- nothing below needs editing -------------------------------------------- */

const CACHE = APP + '-v1';        // bump to -v2 only if you ever want a hard reset of THIS app

/* Minimal shell so the first offline open works. allSettled => a missing file
   never breaks install. Relative paths resolve under this app's own folder. */
const SHELL = ['./', './index.html', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Delete ONLY this app's own old cache versions (e.g. preop-guide-v1 when
    // we're now preop-guide-v2). Never touches caches belonging to other apps
    // on the same origin — that's what makes this safe to reuse everywhere.
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith(APP + '-') && k !== CACHE)
          .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // leave cross-origin (fonts/CDN) alone

  const isDoc = req.mode === 'navigate'
             || req.destination === 'document'
             || url.pathname.endsWith('/')
             || url.pathname.endsWith('index.html');

  if (isDoc) {
    // NETWORK-FIRST for the page — the live deploy is always the source of truth,
    // so the app can never "freeze" on a stale build when you're online.
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (e) {
        const cache = await caches.open(CACHE);
        return (await cache.match(req))
            || (await cache.match('./index.html'))
            || Response.error();
      }
    })());
    return;
  }

  // Other same-folder assets: network-first, fall back to cache when offline.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(req);
      cache.put(req, fresh.clone());
      return fresh;
    } catch (e) {
      return (await cache.match(req)) || Response.error();
    }
  })());
});
