/* =============================================================================
   sw.js — content-agnostic offline cache for the Anesthesia Procedure Reference.

   NO VERSION TO BUMP. This file never needs editing.
     • Online  → always serves the freshest file from the network and refreshes
                 its cached copy in the background.
     • Offline → serves the last copy it saw (WiFi dead zones / the OR).

   The app content ("the food") updates itself on every online load; the butler
   (this file) stays the same. Deploy ritual is just: commit index.html.

   Runs only over https:// (or localhost) — i.e. the Netlify deploy. Opening
   index.html by double-click (file://) is unaffected; the registration snippet
   in index.html no-ops there, so local use still works.
   ============================================================================= */

const CACHE      = 'apr-runtime';     // static name — intentionally never changes
const FONT_CACHE = 'apr-fonts';       // Google Fonts, runtime-cached
const FONT_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

/* Seed the shell so the very first offline open works even before a full load
   finishes. This is just a starting copy — network-first below keeps it fresh. */
const SHELL = [
  './', './index.html', './manifest.json',
  './favicon32.png', './appletouchicon.png',
  './icon152.png', './icon167.png', './icon120.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    self.skipWaiting();   // safe: no auto-reload handler, so nobody is reloaded mid-case
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Remove any caches from the old versioned design (apr-app-*) on first switchover.
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE && k !== FONT_CACHE) ? caches.delete(k) : null));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url; try { url = new URL(req.url); } catch (e) { return; }

  // Google Fonts: stale-while-revalidate.
  if (FONT_ORIGINS.includes(url.origin)) {
    event.respondWith((async () => {
      const cache = await caches.open(FONT_CACHE);
      const cached = await cache.match(req);
      const net = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await net) || new Response('', { status: 504 });
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  // The HTML document: NETWORK-FIRST — online always gets the freshest app, and
  // the cached copy is refreshed every time; offline falls back to last-seen.
  const isDoc = req.mode === 'navigate' || req.destination === 'document' ||
                url.pathname === '/' || url.pathname.endsWith('/') ||
                url.pathname.endsWith('index.html');
  if (isDoc) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (e) {
        const cache = await caches.open(CACHE);
        return (await cache.match(req)) || (await cache.match('./index.html')) ||
               (await cache.match('./')) ||
               new Response('<h1>Offline</h1><p>Open the app once on WiFi to cache it.</p>',
                            { status: 503, headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  // Other same-origin assets (icons, manifest): stale-while-revalidate, so they
  // self-update too with no version to manage.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const net = fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await net) || new Response('', { status: 504 });
  })());
});
