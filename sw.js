/* =============================================================================
   sw.js — "the butler"
   Offline support (WiFi dead zones) + version updates for the
   Anesthesia Procedure Reference app.

   HOW VERSIONING WORKS (read this before each deploy)
   ---------------------------------------------------
   Bump VERSION below on EVERY deploy that changes index.html. That single edit:
     • creates a fresh app cache,
     • deletes the previous version's cache on activate, and
     • tells any open copy a new version is ready (the page shows a "Refresh" banner).
   Online users also always get the freshest index.html (network-first below), so a
   bump mainly refreshes the *offline* copy and the precached shell.

   IMPORTANT: this only runs when the app is served over https:// (or localhost) —
   i.e. the Netlify deploy. Opening index.html by double-click (file://) is unaffected;
   the registration script in index.html no-ops there, so local use still works.
   ============================================================================= */

const VERSION   = 'apr-2026-06-04-r35';        // <-- BUMP THIS ON EVERY DEPLOY (e.g. apr-2026-07-01)
const APP_CACHE  = `apr-app-${VERSION}`;    // versioned: wiped & rebuilt on each bump
const FONT_CACHE = 'apr-fonts-v1';          // versionless: fonts rarely change, keep across bumps

/* Same-origin files to precache so the app opens with zero network. */
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './favicon32.png',
  './appletouchicon.png',
  './icon152.png',
  './icon167.png',
  './icon120.png',
];

/* Google Fonts (CSS host + font-file host) — runtime-cached for dead-zone use. */
const FONT_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

/* ---- install: precache the shell ---- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    // allSettled (not addAll) so one missing/renamed icon can't fail the whole install.
    await Promise.allSettled(APP_SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    // Do NOT skipWaiting here — we let the page offer a "Refresh" banner instead,
    // so a clinician reading mid-case is never reloaded out from under them.
  })());
});

/* ---- activate: drop old version caches, take control, announce update ---- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (k !== APP_CACHE && k !== FONT_CACHE) return caches.delete(k);
    }));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) => c.postMessage({ type: 'APR_UPDATED', version: VERSION }));
  })());
});

/* ---- fetch: routing ---- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                 // never intercept POST etc.
  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Google Fonts: stale-while-revalidate into a persistent cache.
  if (FONT_ORIGINS.includes(url.origin)) {
    event.respondWith((async () => {
      const cache = await caches.open(FONT_CACHE);
      const cached = await cache.match(req);
      const fetching = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await fetching) || new Response('', { status: 504 });
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;  // leave other cross-origin alone

  // The HTML document / navigations: NETWORK-FIRST so online = always freshest app,
  // with the cached shell as the dead-zone fallback.
  const isDoc = req.mode === 'navigate' ||
                req.destination === 'document' ||
                url.pathname === '/' ||
                url.pathname.endsWith('/') ||
                url.pathname.endsWith('index.html');
  if (isDoc) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(APP_CACHE);
        cache.put('./index.html', fresh.clone());   // keep the offline copy current
        return fresh;
      } catch (e) {
        const cache = await caches.open(APP_CACHE);
        return (await cache.match(req)) ||
               (await cache.match('./index.html')) ||
               (await cache.match('./')) ||
               new Response('<h1>Offline</h1><p>No cached copy yet — open the app once on WiFi.</p>',
                            { status: 503, headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  // Other same-origin assets (icons, manifest): CACHE-FIRST, backfill on miss.
  event.respondWith((async () => {
    const cache = await caches.open(APP_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      return cached || new Response('', { status: 504 });
    }
  })());
});

/* ---- message: page asks the waiting worker to take over now (Refresh banner) ---- */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'APR_SKIP_WAITING') self.skipWaiting();
});
