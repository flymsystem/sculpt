// Flym Service Worker — v4
// ─────────────────────────────────────────────────────────────────
// Fixes for v3 root causes:
//  1. Activate no longer deletes the CURRENT cache — only older ones.
//     Previously it wiped ALL caches on every activate, killing JS
//     chunks the running page was still executing → hamburger/touch
//     stopped responding on iOS PWA.
//  2. skipWaiting is NOT called automatically. New SW waits until
//     the page tells it to activate (via SKIP_WAITING message).
//     This prevents mid-modal / mid-form reloads.
//  3. Only ONE reload trigger — controllerchange in the page. No
//     duplicate SW_UPDATED postMessage reload race.
//  4. HTML is network-first with a cache fallback for offline.
//  5. Hashed assets are cached forever; index.html always fresh.
// CACHE_VERSION is stamped at build time by vite_config.js.
// ─────────────────────────────────────────────────────────────────

const CACHE_VERSION = 'flym-1781415943375';
const CACHE_NAME    = CACHE_VERSION;

// ── Install ──────────────────────────────────────────────────────
// Do NOT skipWaiting automatically. Waits for the page to opt-in.
self.addEventListener('install', (e) => {
  // no-op — no pre-caching, no skipWaiting
});

// ── Activate ─────────────────────────────────────────────────────
// Delete ONLY caches whose name doesn't match CACHE_NAME.
// The current cache is preserved so any in-flight fetches from the
// running page continue to resolve.
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k !== CACHE_NAME)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// ── Fetch ────────────────────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  const req = e.request;

  // Only handle GET
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // Skip cross-origin except fonts (which are stable)
  const isSameOrigin = url.origin === self.location.origin;
  const isFontHost   = url.hostname === 'fonts.googleapis.com' ||
                       url.hostname === 'fonts.gstatic.com';

  // Never touch Supabase, Google APIs (non-font), any /auth or /api path
  if (
    url.hostname.includes('supabase') ||
    (url.hostname.includes('googleapis') && !isFontHost) ||
    url.pathname.startsWith('/auth') ||
    url.pathname.startsWith('/api')
  ) {
    return;
  }

  if (!isSameOrigin && !isFontHost) return;

  // ── HTML / navigation: network-first, cache fallback for offline
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          // Cache latest HTML for offline fallback only
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put('/', clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((m) => m || caches.match('/')))
    );
    return;
  }

  // ── Static assets: cache-first, network fallback, background refresh
  if (
    req.destination === 'script' ||
    req.destination === 'style'  ||
    req.destination === 'image'  ||
    req.destination === 'font'
  ) {
    e.respondWith(
      caches.match(req).then((cached) => {
        // Serve cached immediately if available
        const fetchPromise = fetch(req).then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
          }
          return res;
        }).catch(() => cached); // offline → fallback to cache
        return cached || fetchPromise;
      })
    );
  }
});

// ── Message: page can request the waiting SW to activate ─────────
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
