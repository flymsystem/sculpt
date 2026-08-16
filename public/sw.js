// D Sculpt Fitness Service Worker — v4
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

const CACHE_VERSION = 'sculpt-1781415943375';
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

// ═══════════════════════════════════════════════════════════════════
// WEB PUSH
// ───────────────────────────────────────────────────────────────────
// These handlers used to live in a separate public/sw-push-append.js
// with a comment telling a human to paste them in here. Nothing ever
// did, and nothing in the build appended them either — so the app had a
// complete push pipeline (VAPID keys, subscription rows, the send-push
// and generate-notifications Edge Functions, a nightly cron) in which
// the last step silently discarded every message.
//
// The gym owner tapped "Enable", granted permission, got a green
// success toast, and then never received a single notification. Every
// layer reported success.
//
// They are inlined here now. Do not move them back out into a file that
// something has to remember to concatenate.
// ═══════════════════════════════════════════════════════════════════

// ── Web Push: a notification arrived ──────────────────────────────
self.addEventListener('push', function (event) {
  var payload = { title: 'D Sculpt Fitness', body: '', section: '', tag: 'sculpt-notification' };

  if (event.data) {
    try {
      payload = Object.assign(payload, event.data.json());
    } catch (e) {
      payload.body = event.data.text();
    }
  }

  var options = {
    body: payload.body || '',
    // Reuse the PWA icons already in public/ — no new assets needed.
    icon: '/icon-192.png',
    badge: '/icon-48.png',
    tag: payload.tag || 'sculpt-notification',
    // false = each new notification pops fresh (and plays the OS sound)
    // instead of silently replacing the previous one with the same tag.
    renotify: true,
    requireInteraction: false,
    vibrate: [40, 60, 40],
    timestamp: payload.ts || Date.now(),
    data: {
      section: payload.section || '',
      url: '/dashboard' + (payload.section ? '/' + payload.section : ''),
    },
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'D Sculpt Fitness', options)
  );
});

// ── Tap handling: focus an open tab, or open a new one ─────────────
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  if (event.action === 'dismiss') return;

  var target = (event.notification.data && event.notification.data.url) || '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if (client.url.indexOf(self.location.origin) === 0 && 'focus' in client) {
            // Tell the running app which section to open, then focus it.
            try {
              client.postMessage({ type: 'SCULPT_NOTIFICATION_CLICK', url: target });
            } catch (e) { /* ignore */ }
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(target);
      })
  );
});

// ── Optional: log dismissals (useful when debugging delivery) ──────
self.addEventListener('notificationclose', function (event) {
  // console.log('[Sculpt SW] notification dismissed', event.notification.tag);
});

// ── Push subscription rotated by the browser ──────────────────────
// Browsers occasionally rotate endpoints. When that happens the old row
// in push_subscriptions goes stale; send-push prunes it on the next 410.
// Re-subscribing needs the VAPID key, which the SW doesn't have, so we
// just tell the page to re-register on its next load.
self.addEventListener('pushsubscriptionchange', function (event) {
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clientList) {
        clientList.forEach(function (client) {
          try { client.postMessage({ type: 'SCULPT_PUSH_RESUBSCRIBE' }); } catch (e) {}
        });
      })
  );
});
