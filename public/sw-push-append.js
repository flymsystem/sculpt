/* ═══════════════════════════════════════════════════════════════════
   APPEND THIS BLOCK TO THE BOTTOM OF  public/sw.js

   Do NOT replace your existing sw.js — it holds the caching strategy and
   the SKIP_WAITING handler that index.html depends on. These are purely
   additive event listeners; a service worker can have as many 'push' and
   'notificationclick' listeners as you like.

   After appending, bump whatever CACHE_NAME / version constant your
   sw.js uses so browsers actually pick up the new worker.
   ══════════════════════════════════════════════════════════════════ */

// ── Web Push: a notification arrived ──────────────────────────────
self.addEventListener('push', function (event) {
  var payload = { title: 'Flym', body: '', section: '', tag: 'flym-notification' };

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
    icon: '/favicon-192.png',
    badge: '/favicon-48.png',
    tag: payload.tag || 'flym-notification',
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
    self.registration.showNotification(payload.title || 'Flym', options)
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
              client.postMessage({ type: 'FLYM_NOTIFICATION_CLICK', url: target });
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
  // console.log('[Flym SW] notification dismissed', event.notification.tag);
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
          try { client.postMessage({ type: 'FLYM_PUSH_RESUBSCRIBE' }); } catch (e) {}
        });
      })
  );
});
