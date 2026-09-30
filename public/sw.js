/* archypaint service worker — hand-written, ~1 KB of logic.
 * - Versioned cache per build (`?v=` on the script URL): a new build installs a new worker + cache; old caches are deleted on activate.
 * - install: precache the app shell plus every chunk listed in asset-manifest.json (including lazy ones), so the app works fully offline after one visit.
 * - navigations: network-first (fresh index.html when online), cached index.html when offline.
 * - everything else same-origin: cache-first (hashed assets are immutable), filled on first use.
 * - never calls skipWaiting by itself: an update waits until the page asks (message SKIP_WAITING), so it cannot cause reload loops.
 */
'use strict';
const V = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = 'archypaint-' + V;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];

function flatten(m) {
  const out = new Set();
  for (const k of Object.keys(m || {})) {
    const e = m[k];
    if (e && e.file) out.add('./' + e.file);
    for (const c of (e && e.css) || []) out.add('./' + c);
    for (const a of (e && e.assets) || []) out.add('./' + a);
  }
  return [...out];
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    let files = [];
    try { const r = await fetch('./asset-manifest.json', { cache: 'no-store' }); if (r.ok) files = flatten(await r.json()); } catch (_) { /* first paint still works; chunks cache on first use */ }
    await Promise.all([...new Set([...SHELL, ...files])].map(async (u) => {
      try { const r = await fetch(u, { cache: 'reload' }); if (r.ok) await cache.put(u, r); } catch (_) { /* one missing file must not fail the install */ }
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('archypaint-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function navigate(req) {
  const cache = await caches.open(CACHE);
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(req, { signal: ctl.signal });
    clearTimeout(t);
    if (res.ok) { cache.put('./index.html', res.clone()).catch(() => {}); return res; }
    throw new Error('bad status');
  } catch (_) {
    return (await cache.match('./index.html')) || (await cache.match('./')) || new Response('offline', { status: 503, statusText: 'offline' });
  }
}

async function asset(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (_) { return Response.error(); }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.endsWith('/sw.js')) return;
  event.respondWith(req.mode === 'navigate' ? navigate(req) : asset(req));
});
