/* eslint-env serviceworker */
// sw.js — offline support (PWA). This file is never imported by the app:
// the `pwaServiceWorker` plugin in vite.config.js copies it to dist/sw.js,
// filling the two placeholders below in with the hashed build output.
//
// Caching rules, in the order the fetch handler applies them:
//   audio/…        never touched — voiceover is streamed with range requests
//   navigations    the precached app shell, network only as a fallback
//   assets/…       cache-first (filenames are content-hashed)
//   chapters/…     stale-while-revalidate — instant, refreshed in the
//                  background so server-side edits still land without a build
//   Google Fonts   cache-first (files) / stale-while-revalidate (the css)
// Everything else falls through to the network untouched.

const VERSION = '__VERSION__';
const SHELL = __SHELL__;

// Hosts differ on `Vary` (Vite's preview sends `Vary: Origin`, so a <script
// crossorigin> request would not match the copy stored without an Origin
// header). Nothing here varies by request header: key everything by URL.
const MATCH = { ignoreVary: true };

const SHELL_CACHE = `ketab-shell-${VERSION}`;
const CONTENT_CACHE = 'ketab-content';       // chapters + fonts: outlives releases
const KEEP = [SHELL_CACHE, CONTENT_CACHE];

// ---------- install: precache the shell, then warm the whole book ----------

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL.map((url) => store(cache, url).catch(() => {})));
    await warmBook();
  })());
});

// A response that arrived through a redirect cannot be replayed for a
// navigation request, so re-wrap the body before it goes into the cache.
async function store(cache, url) {
  const res = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
  if (!res.ok) throw new Error(`precache ${url}: ${res.status}`);
  await cache.put(url, res.redirected ? await unredirect(res) : res);
}

async function unredirect(res) {
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

// Pull the manifest and every chapter file into the content cache, so the
// book is readable offline after a single visit (the text is small; audio
// is deliberately left out).
async function warmBook() {
  try {
    const cache = await caches.open(CONTENT_CACHE);
    const res = await fetch(new Request('./chapters/manifest.json', { cache: 'reload' }));
    if (!res.ok) return;
    const manifest = await res.clone().json();
    await cache.put('./chapters/manifest.json', res);
    const files = [
      ...(manifest.chapters || []).map((c) => c.file),
      manifest.book && manifest.book.about,
    ].filter(Boolean);
    await Promise.all(files.map((f) => cache.add(f).catch(() => {})));
  } catch { /* offline at install time: runtime caching will fill in */ }
}

// ---------- activate: drop superseded shells ----------

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('ketab-') && !KEEP.includes(k)).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// The page asks for this once the reader taps «به‌روزرسانی».
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ---------- fetch ----------

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin && /(^|\/)audio\//.test(url.pathname)) return;   // streamed, ranged, large

  if (req.mode === 'navigate') { event.respondWith(appShell(req)); return; }

  if (sameOrigin) {
    if (/(^|\/)chapters\//.test(url.pathname)) { event.respondWith(swr(event, CONTENT_CACHE)); return; }
    if (/(^|\/)assets\//.test(url.pathname)) { event.respondWith(cacheFirst(event, SHELL_CACHE)); return; }
    event.respondWith(swr(event, SHELL_CACHE));
    return;
  }

  if (url.hostname === 'fonts.gstatic.com') { event.respondWith(cacheFirst(event, CONTENT_CACHE)); return; }
  if (url.hostname === 'fonts.googleapis.com') { event.respondWith(swr(event, CONTENT_CACHE)); return; }
});

async function appShell(req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = (await cache.match('./index.html', MATCH)) || (await cache.match('./', MATCH));
  if (cached) return cached;
  try { return await fetch(req); } catch { return offlinePage(); }
}

async function cacheFirst(event, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request, MATCH);
  if (cached) return cached;
  try {
    const res = await fetch(event.request);
    if (keepable(res)) event.waitUntil(cache.put(event.request, res.clone()).catch(() => {}));
    return res;
  } catch {
    return unavailable();
  }
}

function swr(event, cacheName) {
  return (async () => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(event.request, MATCH);
    const fresh = fetch(event.request)
      .then((res) => {
        if (keepable(res)) cache.put(event.request, res.clone()).catch(() => {});
        return res;
      })
      .catch(() => null);
    if (cached) { event.waitUntil(fresh); return cached; }
    return (await fresh) || unavailable();
  })();
}

// Opaque (cross-origin, no-cors) font responses have status 0 but replay fine.
const keepable = (res) => !!res && (res.ok || res.type === 'opaque');

const unavailable = () =>
  new Response('', { status: 504, statusText: 'offline' });

const offlinePage = () =>
  new Response(
    '<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>بی‌اینترنت</title>' +
    '<body style="font-family:serif;display:grid;place-items:center;height:100vh;margin:0;color:#111">' +
    '<p>این صفحه هنوز برای خواندنِ بی‌اینترنت ذخیره نشده است.</p>',
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
