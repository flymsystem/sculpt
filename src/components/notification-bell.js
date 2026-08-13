// src/components/notification-bell.js
// ─────────────────────────────────────────────────────────────────
// Topbar notification bell + dropdown panel.
//
// ── 2026-08-12 REWRITE — read this before changing anything ──────
// v1 had two bugs found by browser testing, both worth remembering:
//
//  1. The panel lived INSIDE .notif-wrap in the topbar. `.topbar` has
//     `overflow:hidden`, which clips absolutely-positioned descendants,
//     and the topbar's stacking context meant `.app-content` painted
//     straight over the panel. On desktop it opened but was completely
//     unclickable. On mobile it happened to work only because the
//     media query switched it to position:fixed.
//     → FIX: the panel is now a PORTAL. It's appended to <body>, not
//       to the topbar, so no ancestor can clip it or paint over it.
//       It's positioned from the bell's bounding rect each time it opens.
//
//  2. Visibility used the `hidden` attribute, but the CSS said
//     `.notif-panel { display: flex }`. Author CSS beats the UA
//     stylesheet's `[hidden] { display: none }`, so the panel was
//     visible from page load and `hidden = true` did nothing. Close,
//     ESC, outside-click and toggle all silently failed.
//     → FIX: visibility is a CLASS (.is-open) and the base rule is
//       `display: none`. Never use the bare `hidden` attribute for
//       something you've also styled with `display:`.
//
// Conventions:
//  * Delegated listeners only — no window globals, nothing for the
//    cleanup array in app.js.
//  * escHtml() on every piece of user-entered text before innerHTML.
//  * cleanupNotificationBell() removes the portal, the timers and the
//    realtime channel. Safe to call repeatedly.
// ─────────────────────────────────────────────────────────────────
import {
  getNotifications, getUnreadCount, markRead, deleteNotification,
  clearAllNotifications, subscribeToNotifications,
} from '../lib/notifications.js';
import {
  enablePush, disablePush, isSubscribed, unavailableReason,
} from '../lib/push.js';
import { S } from '../pages/dashboard/state.js';
import { escHtml } from '../pages/dashboard/helpers.js';
import { showToast } from './toast.js';

const POLL_MS = 60_000;        // refresh unread count every minute
const MOBILE_MAX = 640;

let _unsubRealtime = null;
let _pollTimer = null;
let _navHandler = null;
let _items = [];
let _unread = 0;
let _panel = null;      // portaled into <body>
let _backdrop = null;   // portaled into <body>
let _bound = false;

export function setNotificationNav(fn) { _navHandler = fn; }

// ── Sound ─────────────────────────────────────────────────────────
// Generated with Web Audio so there's no asset to ship or cache-bust.
let _audioCtx = null;
function playChime() {
  try {
    if (localStorage.getItem('flym-notif-sound') === 'off') return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!_audioCtx) _audioCtx = new Ctx();
    if (_audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {});

    const now = _audioCtx.currentTime;
    [880, 1174.66].forEach((freq, i) => {
      const osc = _audioCtx.createOscillator();
      const gain = _audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.11);
      gain.gain.setValueAtTime(0.0001, now + i * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.16, now + i * 0.11 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.11 + 0.30);
      osc.connect(gain); gain.connect(_audioCtx.destination);
      osc.start(now + i * 0.11);
      osc.stop(now + i * 0.11 + 0.32);
    });
  } catch (_) { /* audio is a nicety, never a blocker */ }
}

function vibrate() {
  try { navigator.vibrate?.([40, 60, 40]); } catch (_) {}
}

// ── Markup ────────────────────────────────────────────────────────
const BELL_SVG = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;

/**
 * Only the BUTTON goes in the topbar. The panel is created separately
 * and portaled to <body> — see the header comment for why.
 */
export function bellMarkup() {
  return `<div class="notif-wrap">
    <button class="notif-bell" id="notif-bell-btn" type="button"
            aria-label="Notifications" aria-haspopup="dialog" aria-expanded="false" title="Notifications">
      ${BELL_SVG}
      <span class="notif-badge" id="notif-badge" style="display:none;">0</span>
    </button>
  </div>`;
}

function buildPanel() {
  // Remove any panel left over from a previous mount (branch switch).
  document.getElementById('notif-panel')?.remove();
  document.getElementById('notif-backdrop')?.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'notif-backdrop';
  backdrop.className = 'notif-backdrop';

  const panel = document.createElement('div');
  panel.id = 'notif-panel';
  panel.className = 'notif-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Notifications');
  panel.innerHTML = `
    <div class="notif-panel-head">
      <span class="notif-panel-title">Notifications</span>
      <div class="notif-panel-actions">
        <button class="notif-link" data-notif-act="sound" id="notif-sound-btn" type="button" title="Toggle sound">Sound</button>
        <button class="notif-link" data-notif-act="readall" type="button">Mark all read</button>
        <button class="notif-close" data-notif-act="close" type="button" aria-label="Close notifications">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
    <div class="notif-push-row" id="notif-push-row"></div>
    <div class="notif-list" id="notif-list"></div>
    <div class="notif-panel-foot">
      <button class="notif-link notif-link-danger" data-notif-act="clearall" type="button">Clear all</button>
    </div>`;

  document.body.appendChild(backdrop);
  document.body.appendChild(panel);
  _panel = panel;
  _backdrop = backdrop;
  return panel;
}

function typeAccent(type) {
  return ({
    expired: 'var(--red)', payment_due: 'var(--purple)', expiring: 'var(--amber)',
    enquiry: 'var(--blue-light)', payment: 'var(--green)', birthday: 'var(--brand)',
    broadcast: 'var(--brand)', staff: 'var(--brand)',
  })[type] || 'var(--text-tertiary)';
}

function relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 172_800_000) return 'yesterday';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function renderList() {
  const el = document.getElementById('notif-list');
  if (!el) return;

  if (!_items.length) {
    el.innerHTML = `<div class="notif-empty">
      <div class="notif-empty-icon">${BELL_SVG}</div>
      <div class="notif-empty-title">You're all caught up</div>
      <div class="notif-empty-sub">Renewals, dues and new enquiries will show up here.</div>
    </div>`;
    return;
  }

  el.innerHTML = _items.map(n => `<div class="notif-item ${n.is_read ? '' : 'unread'}"
      role="button" tabindex="0"
      data-notif-id="${escHtml(String(n.id))}"
      data-notif-section="${escHtml(n.link_section || '')}">
    <span class="notif-dot" style="background:${typeAccent(n.type)};"></span>
    <div class="notif-body">
      <div class="notif-title">${escHtml(n.title || '')}</div>
      ${n.body ? `<div class="notif-sub">${escHtml(n.body)}</div>` : ''}
      <div class="notif-time">${escHtml(relTime(n.created_at))}</div>
    </div>
    <button class="notif-dismiss" data-notif-del="${escHtml(String(n.id))}" type="button" aria-label="Dismiss">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>`).join('');
}

function renderBadge() {
  const badge = document.getElementById('notif-badge');
  const bell = document.getElementById('notif-bell-btn');
  if (!badge) return;
  if (_unread > 0) {
    badge.style.display = '';
    badge.textContent = _unread > 99 ? '99+' : String(_unread);
  } else {
    badge.style.display = 'none';
  }
  bell?.classList.toggle('has-unread', _unread > 0);
  if (bell) {
    bell.setAttribute('aria-label',
      _unread > 0 ? `Notifications, ${_unread} unread` : 'Notifications');
  }
}

async function renderPushRow() {
  const row = document.getElementById('notif-push-row');
  if (!row) return;

  const reason = unavailableReason();
  if (reason) {
    row.innerHTML = `<div class="notif-push-hint">${escHtml(reason)}</div>`;
    return;
  }

  const on = await isSubscribed();
  row.innerHTML = on
    ? `<div class="notif-push-hint notif-push-on">
         <span>Push is on for this device.</span>
         <button class="notif-link" data-notif-act="push-off" type="button">Turn off</button>
       </div>`
    : `<div class="notif-push-hint">
         <span>Get alerts on this device even when Flym is closed.</span>
         <button class="notif-link notif-link-primary" data-notif-act="push-on" type="button">Enable</button>
       </div>`;
}

function renderSoundBtn() {
  const btn = document.getElementById('notif-sound-btn');
  if (!btn) return;
  const off = localStorage.getItem('flym-notif-sound') === 'off';
  btn.textContent = off ? 'Sound off' : 'Sound on';
  btn.classList.toggle('is-muted', off);
}

// ── Data ──────────────────────────────────────────────────────────
async function refresh({ full = false } = {}) {
  const gymId = S.gym?.id;
  if (!gymId) return;
  if (full) _items = await getNotifications(gymId, 50);
  _unread = await getUnreadCount(gymId);
  renderBadge();
  if (full) renderList();
}

// ── Where notification GENERATION lives now ───────────────────────
// It used to happen here: every 15 minutes, the browser walked the whole
// member list, built up to 3 rows per member, and posted them all in one
// upsert. At 100,000 members with 20% needing attention that is a
// ~20,000-row write, several megabytes, fired from a phone, every 15
// minutes, forever — failing on a weak connection, retrying on the next
// tick, and burning the owner's mobile data in the background.
//
// The generate-notifications Edge Function already does exactly this
// job, server-side, on a nightly cron, for every gym whether anyone has
// Flym open or not. Two implementations of the same rules is also how
// dedupe keys drift apart and owners get notified twice.
//
// The bell is now read-only: fetch, display, mark read. buildNotificationRows()
// stays in lib/notifications.js as the tested reference for those rules.

// ── Open / close ──────────────────────────────────────────────────
function isPanelOpen() {
  return !!_panel && _panel.classList.contains('is-open');
}

/**
 * Anchor the portaled panel under the bell.
 * Desktop: right-aligned to the bell. Mobile: full-width sheet.
 * Recomputed on every open, and on scroll/resize while open.
 */
function positionPanel() {
  if (!_panel) return;
  const bell = document.getElementById('notif-bell-btn');
  if (!bell) return;
  const r = bell.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (vw <= MOBILE_MAX) {
    _panel.style.left = '8px';
    _panel.style.right = '8px';
    _panel.style.width = 'auto';
    _panel.style.top = `${Math.round(r.bottom + 8)}px`;
    _panel.style.maxHeight = `${Math.round(vh - r.bottom - 24)}px`;
    return;
  }

  const width = 370;
  // Right-align to the bell, but never let it run off either edge.
  let left = Math.round(r.right - width);
  left = Math.max(8, Math.min(left, vw - width - 8));
  _panel.style.left = `${left}px`;
  _panel.style.right = 'auto';
  _panel.style.width = `${width}px`;
  _panel.style.top = `${Math.round(r.bottom + 10)}px`;
  _panel.style.maxHeight = `${Math.round(Math.min(vh - r.bottom - 32, 560))}px`;
}

function openPanel() {
  if (!_panel) return;
  _panel.classList.add('is-open');
  document.getElementById('notif-bell-btn')?.setAttribute('aria-expanded', 'true');
  positionPanel();
  renderList();
  renderSoundBtn();
  renderPushRow();
  refresh({ full: true });

  // Backdrop is MOBILE ONLY, on purpose. On desktop a full-screen
  // overlay — even a transparent one — swallows the first click on
  // anything else in the app (sidebar, table rows, the bell itself).
  // Desktop outside-click is handled by _docClick instead.
  if (window.innerWidth <= MOBILE_MAX) {
    _backdrop?.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
}

function closePanel() {
  if (!_panel) return;
  _panel.classList.remove('is-open');
  _backdrop?.classList.remove('is-open');
  document.getElementById('notif-bell-btn')?.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}

function togglePanel() {
  isPanelOpen() ? closePanel() : openPanel();
}

// ── Handlers (module-scoped so cleanup can remove them) ───────────
function _docClick(ev) {
  // Bell toggles.
  if (ev.target.closest('#notif-bell-btn')) {
    ev.preventDefault();
    ev.stopPropagation();
    togglePanel();
    return;
  }
  // Anything outside an open panel closes it.
  if (isPanelOpen() && !ev.target.closest('#notif-panel')) {
    closePanel();
  }
}

function _docKey(ev) {
  if (ev.key === 'Escape' && isPanelOpen()) {
    ev.stopPropagation();
    closePanel();
    document.getElementById('notif-bell-btn')?.focus();
  }
}

function _reposition() {
  if (isPanelOpen()) positionPanel();
}

async function _panelClick(ev) {
  const delBtn = ev.target.closest('[data-notif-del]');
  if (delBtn) {
    ev.stopPropagation();
    const id = delBtn.dataset.notifDel;
    try {
      await deleteNotification(id, S.gym?.id);
      _items = _items.filter(n => String(n.id) !== String(id));
      renderList();
      await refresh({ full: false });
    } catch (err) { showToast(err.message || 'Could not dismiss', 'red'); }
    return;
  }

  const actBtn = ev.target.closest('[data-notif-act]');
  if (actBtn) {
    ev.stopPropagation();
    const act = actBtn.dataset.notifAct;

    if (act === 'close') { closePanel(); return; }

    if (act === 'readall') {
      await markRead(null);
      _items = _items.map(n => ({ ...n, is_read: true }));
      renderList();
      await refresh({ full: false });
      return;
    }

    if (act === 'clearall') {
      try {
        await clearAllNotifications(S.gym?.id);
        _items = [];
        renderList();
        await refresh({ full: false });
        showToast('Notifications cleared', 'green');
      } catch (err) { showToast(err.message || 'Could not clear', 'red'); }
      return;
    }

    if (act === 'sound') {
      const off = localStorage.getItem('flym-notif-sound') === 'off';
      localStorage.setItem('flym-notif-sound', off ? 'on' : 'off');
      renderSoundBtn();
      if (off) playChime();   // was off, now on — demo the sound
      return;
    }

    if (act === 'push-on') {
      actBtn.disabled = true; actBtn.textContent = 'Enabling…';
      const res = await enablePush(S.gym?.id);
      if (res.ok) { showToast('Push notifications enabled', 'green'); playChime(); }
      else showToast(res.reason || 'Could not enable push', 'amber');
      renderPushRow();
      return;
    }

    if (act === 'push-off') {
      await disablePush();
      showToast('Push notifications turned off', 'green');
      renderPushRow();
      return;
    }
    return;
  }

  // Body of a notification → mark read + navigate
  const item = ev.target.closest('[data-notif-id]');
  if (item) {
    const id = item.dataset.notifId;
    const section = item.dataset.notifSection;
    await markRead([id]);
    const hit = _items.find(n => String(n.id) === String(id));
    if (hit) hit.is_read = true;
    renderList();
    await refresh({ full: false });
    if (section && _navHandler) { closePanel(); _navHandler(section); }
  }
}

function _panelKey(ev) {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const item = ev.target.closest('[data-notif-id]');
  if (item) { ev.preventDefault(); item.click(); }
}

// ── Mount ─────────────────────────────────────────────────────────
export async function mountNotificationBell() {
  injectStyles();
  cleanupNotificationBell();   // safe re-mount (branch switch)

  if (!document.getElementById('notif-bell-btn')) {
    console.warn('[Flym] notification bell: no #notif-bell-btn in the DOM — did bellMarkup() get rendered?');
    return;
  }

  buildPanel();

  await refresh({ full: true });

  // One document-level listener handles the bell AND outside-click.
  // Bubble phase, not capture — capture fires before the target and made
  // the old version fight itself.
  document.addEventListener('click', _docClick);
  document.addEventListener('keydown', _docKey);
  window.addEventListener('resize', _reposition);
  window.addEventListener('scroll', _reposition, true);

  _panel.addEventListener('click', _panelClick);
  _panel.addEventListener('keydown', _panelKey);
  _backdrop.addEventListener('click', closePanel);

  _bound = true;

  // Realtime — new row arrives → badge + chime
  _unsubRealtime = subscribeToNotifications(S.gym?.id, (row) => {
    _items = [row, ..._items].slice(0, 50);
    _unread += 1;
    renderBadge();
    if (isPanelOpen()) renderList();
    if (document.visibilityState === 'visible') { playChime(); vibrate(); }
  });

  _pollTimer = setInterval(() => refresh({ full: isPanelOpen() }), POLL_MS);
}

export function cleanupNotificationBell() {
  if (_unsubRealtime) { try { _unsubRealtime(); } catch (_) {} _unsubRealtime = null; }
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }

  if (_bound) {
    document.removeEventListener('click', _docClick);
    document.removeEventListener('keydown', _docKey);
    window.removeEventListener('resize', _reposition);
    window.removeEventListener('scroll', _reposition, true);
    _bound = false;
  }

  _panel?.remove();
  _backdrop?.remove();
  _panel = null;
  _backdrop = null;
  document.body.style.overflow = '';
}

// ── Styles ────────────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById('flym-notif-styles')) return;
  const s = document.createElement('style');
  s.id = 'flym-notif-styles';
  s.textContent = `
  .notif-wrap { position: relative; display: flex; align-items: center; }

  .notif-bell {
    position: relative; background: none; border: 1px solid var(--border);
    color: var(--muted); cursor: pointer; border-radius: var(--radius-sm);
    padding: 6px 8px; display: flex; align-items: center; justify-content: center;
    transition: color .15s ease, border-color .15s ease, background .15s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .notif-bell:hover { color: var(--text-primary); border-color: var(--border-strong); }
  .notif-bell.has-unread { color: var(--brand-text); border-color: var(--brand-fade-strong); }
  .notif-bell.has-unread svg { animation: notifSwing 2.4s ease-in-out infinite; transform-origin: 50% 4px; }
  .notif-bell:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
  @keyframes notifSwing {
    0%, 70%, 100% { transform: rotate(0deg); }
    75% { transform: rotate(11deg); } 80% { transform: rotate(-9deg); }
    85% { transform: rotate(6deg); }  90% { transform: rotate(-4deg); }
  }
  @media (prefers-reduced-motion: reduce) { .notif-bell.has-unread svg { animation: none; } }

  .notif-badge {
    position: absolute; top: -5px; right: -5px; min-width: 17px; height: 17px;
    padding: 0 4px; border-radius: 9px; background: var(--red); color: #fff;
    font-size: 10px; font-weight: 700; line-height: 17px; text-align: center;
    font-variant-numeric: tabular-nums; box-shadow: 0 0 0 2px var(--surface-bg);
    pointer-events: none;
  }

  /* ── Portaled to <body>. Do NOT nest this back inside the topbar. ──
     Visibility is a class, never the [hidden] attribute — an author
     'display' rule beats [hidden] and the panel would never close. */
  .notif-backdrop {
    display: none; position: fixed; inset: 0; z-index: 9998;
    background: transparent;
  }
  .notif-backdrop.is-open { display: block; }

  .notif-panel {
    display: none;
    position: fixed; z-index: 9999;
    background: var(--surface-1);
    border: 1px solid var(--border-default, var(--border));
    border-radius: var(--radius-lg); box-shadow: 0 18px 48px rgba(0,0,0,.5);
    flex-direction: column; overflow: hidden;
  }
  .notif-panel.is-open {
    display: flex;
    animation: notifPop .16s var(--ease-out, ease-out);
  }
  @keyframes notifPop { from { opacity: 0; transform: translateY(-6px) scale(.985); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .notif-panel.is-open { animation: none; } }

  .notif-panel-head {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 12px 14px; border-bottom: 1px solid var(--border-subtle); flex-shrink: 0;
  }
  .notif-panel-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .notif-panel-actions { display: flex; align-items: center; gap: 10px; }

  .notif-link {
    background: none; border: none; padding: 4px 2px; cursor: pointer;
    font-size: 11px; font-weight: 500; color: var(--text-tertiary);
    font-family: inherit; white-space: nowrap;
  }
  .notif-link:hover { color: var(--text-primary); }
  .notif-link-primary { color: var(--brand-text); font-weight: 600; }
  .notif-link-danger:hover { color: var(--red); }
  .notif-link.is-muted { color: var(--text-quaternary); text-decoration: line-through; }

  .notif-close {
    background: none; border: none; color: var(--text-tertiary); cursor: pointer;
    padding: 4px; display: flex; align-items: center; border-radius: 4px;
    min-width: 28px; min-height: 28px; justify-content: center;
  }
  .notif-close:hover { color: var(--text-primary); background: var(--surface-2); }

  .notif-push-row { flex-shrink: 0; }
  .notif-push-hint {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 9px 14px; font-size: 11px; line-height: 1.5;
    color: var(--text-tertiary); background: var(--surface-2);
    border-bottom: 1px solid var(--border-subtle);
  }
  .notif-push-hint.notif-push-on { color: var(--green); }

  .notif-list { overflow-y: auto; flex: 1 1 auto; -webkit-overflow-scrolling: touch; min-height: 0; }

  .notif-item {
    display: flex; align-items: flex-start; gap: 10px; padding: 11px 14px;
    border-bottom: 1px solid var(--border-subtle); cursor: pointer;
    transition: background .12s ease;
  }
  .notif-item:hover { background: var(--surface-2); }
  .notif-item.unread { background: var(--brand-fade); }
  .notif-item.unread:hover { background: var(--brand-fade-strong); }
  .notif-item:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }

  .notif-dot { width: 7px; height: 7px; border-radius: 50%; margin-top: 6px; flex-shrink: 0; }
  .notif-body { flex: 1; min-width: 0; }
  .notif-title { font-size: 12.5px; font-weight: 500; color: var(--text-primary); line-height: 1.45; }
  .notif-sub { font-size: 11.5px; color: var(--text-tertiary); line-height: 1.5; margin-top: 2px; }
  .notif-time { font-size: 10.5px; color: var(--text-quaternary); margin-top: 3px; }

  .notif-dismiss {
    background: none; border: none; color: var(--text-quaternary); cursor: pointer;
    padding: 4px; opacity: 0; transition: opacity .12s ease; flex-shrink: 0;
    border-radius: 4px; min-width: 26px; min-height: 26px;
    display: flex; align-items: center; justify-content: center;
  }
  .notif-item:hover .notif-dismiss { opacity: 1; }
  .notif-dismiss:hover { color: var(--red); background: var(--surface-3); }

  .notif-empty { padding: 40px 24px; text-align: center; }
  .notif-empty-icon { color: var(--text-quaternary); margin-bottom: 10px; }
  .notif-empty-title { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
  .notif-empty-sub { font-size: 11.5px; color: var(--text-quaternary); margin-top: 4px; line-height: 1.5; }

  .notif-panel-foot {
    padding: 9px 14px; border-top: 1px solid var(--border-subtle);
    display: flex; justify-content: flex-end; flex-shrink: 0;
  }

  /* Mobile: full-width sheet, bigger tap targets, dimmed backdrop */
  @media (max-width: ${MOBILE_MAX}px) {
    .notif-backdrop.is-open { background: rgba(0,0,0,.45); }
    .notif-dismiss { opacity: 1; }
    .notif-close { min-width: 34px; min-height: 34px; }
    .notif-link { padding: 6px 4px; font-size: 12px; }
    .notif-item { padding: 13px 14px; }
  }
  `;
  document.head.appendChild(s);
}