// src/pages/dashboard/checkin-display.js — desk kiosk QR screen
import { S } from './state.js';
import { issueCheckinToken } from '../../lib/checkin.js';
import { generateQR } from '../../lib/qr.js';
import { escHtml } from './helpers.js';

// HANDOVER.md §6 and the button's own label both say 3 seconds — this
// used to say 2500 (a copy-paste of an earlier draft's value that never
// got reconciled with the label), which is itself a security bug: 2.5s
// of "hold" is closer to a deliberate double-tap than a sustained
// gesture. Do not shorten this again without updating both HANDOVER and
// the label in lockstep.
const EXIT_HOLD_MS = 3000;

let _rotateTimer = null;
let _wakeLock = null;
let _exitStart = 0;
let _exitRAF = null;
// The pointerId currently "owns" the hold, or null when nothing is being
// held. Needed because pointerup/pointercancel/lostpointercapture are
// global-ish events — without checking pointerId a second finger touching
// anywhere on the kiosk (or a stray synthetic event) could cancel (or
// worse, on some browsers' quirks, appear to satisfy) a hold started by
// a different contact.
let _exitPointerId = null;

export function renderCheckinDisplay(container) {
  window.__sculptRegisterCleanup?.(stopCheckinDisplay);

  // The tablet this runs on sits unattended in a public area, signed into
  // an account that can see member phone numbers, Aadhaar photos and
  // collect payments. A single-tap "Exit" would let anyone walking past
  // drop straight into that account. Hold-to-exit (below) is the gate;
  // hiding the sidebar/topbar here is the second layer — without it,
  // the mobile swipe-open gesture in sidebar.js could still slide the
  // real dashboard nav out from underneath this full-screen overlay.
  document.getElementById('page-gym')?.classList.add('checkin-kiosk-active');

  container.innerHTML = `
    <div id="checkin-kiosk" style="position:fixed;inset:0;z-index:500;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;text-align:center;">
      <button id="checkin-exit" aria-label="Hold for 3 seconds to exit the display" style="position:absolute;top:18px;right:18px;overflow:hidden;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);color:#fff;border-radius:10px;padding:10px 16px;font-size:13px;cursor:pointer;-webkit-user-select:none;user-select:none;touch-action:none;-webkit-touch-callout:none;">
        <span id="checkin-exit-progress" style="position:absolute;inset:0;width:0%;background:rgba(255,107,107,0.45);"></span>
        <span style="position:relative;">Hold to exit (3s)</span>
      </button>
      <img src="/logo-128.png" alt="" width="64" height="64" style="opacity:0.9;">
      <div id="checkin-gym-name" style="color:#fff;font-family:var(--font-head, sans-serif);font-size:22px;letter-spacing:0.04em;text-transform:uppercase;">${escHtml(S.gym?.name || '')}</div>
      <div id="checkin-qr-wrap" style="background:#fff;border-radius:24px;padding:28px;box-shadow:0 0 60px rgba(42,143,255,0.25);">
        <img id="checkin-qr-img" width="420" height="420" style="display:block;width:min(420px,70vw);height:auto;" alt="Scan to check in">
      </div>
      <div style="color:#8fa0b8;font-size:15px;">Scan with the app to check in</div>
      <div id="checkin-offline" style="display:none;color:#ff6b6b;font-size:15px;font-weight:600;">
        ⚠️ Offline — code has stopped refreshing. Ask staff to check in manually.
      </div>
    </div>`;

  bindExitHold();
  startRotation();
  acquireWakeLock();
  document.addEventListener('visibilitychange', reacquireWakeLockOnVisible);
}

// ── Hold-to-exit ─────────────────────────────────────────────────
// Deliberately not a click: a passerby tapping "Exit" once must not
// land on an account that can see member phone numbers, Aadhaar
// photos and collect payments. Holding for EXIT_HOLD_MS fills the
// button with a visible progress bar so it reads as an intentional
// gesture, not a hidden trap — releasing early cancels with no effect.
//
// WHY POINTER EVENTS, AND WHY setPointerCapture: this used to be plain
// pointerdown/pointerup/pointerleave/pointercancel with no capture, which
// is exactly the "works sometimes" bug report. A human finger held on a
// screen for 3 real seconds is never perfectly still — it drifts a few
// pixels, and on a ~110×40px button that's enough to cross the element's
// edge. Without setPointerCapture, that drift fires `pointerleave`
// (previously wired to cancelExitHold) and silently kills the hold
// partway through, so the same deliberate 3-second press "works" on one
// attempt and "does nothing" on the next depending on how still the
// finger happened to stay — not a real bug in the person holding it, a
// bug in this listener setup. setPointerCapture(pointerId) on
// pointerdown routes every subsequent event for that pointer (move, up,
// cancel) to this element regardless of where the contact point wanders,
// which is the whole fix. `pointerleave` is intentionally not listened
// for any more; capture makes it meaningless here, and keeping it around
// would silently reintroduce the same bug.
//
// The rest of the listeners exist because a hold can be interrupted in
// ways that are not "the user let go on purpose", and every one of them
// MUST cancel — leaving the timer running past release/interruption
// would turn a bug into a bypass of the security gate:
//   - pointercancel: the browser itself aborts the gesture (e.g. it
//     decided this is a scroll/pinch instead), so this pointer no
//     longer represents an intentional hold at all.
//   - lostpointercapture: capture was taken away from us — by the
//     platform, by a second simultaneous touch, or anything else — so
//     we can no longer be sure the up/cancel event will still reach us.
//     Treat losing capture as losing the hold.
//   - visibilitychange (hidden): the kiosk app was backgrounded or the
//     tablet screen locked mid-hold. requestAnimationFrame keeps running
//     in some embedded/kiosk browser shells even while hidden, so this
//     is not covered "for free" by rAF simply not firing — it needs its
//     own explicit check.
//   - scroll: if anything on the page scrolls while a pointer is down,
//     that pointer is driving a scroll gesture, not a deliberate hold on
//     this button — a scroll must never let a hold complete underneath
//     it. (The kiosk view has nothing to scroll, but this is unattended
//     hardware; don't rely on that staying true.)
function bindExitHold() {
  const btn = document.getElementById('checkin-exit');
  if (!btn) return;
  btn.addEventListener('pointerdown', onExitPointerDown);
  btn.addEventListener('pointerup', onExitPointerRelease);
  btn.addEventListener('pointercancel', onExitPointerRelease);
  btn.addEventListener('lostpointercapture', onExitPointerRelease);
  // Long-press on touch devices can pop a text-selection/context-menu
  // callout mid-hold, which both looks broken and can eat the pointerup
  // that would otherwise cancel cleanly. Suppress it outright on this
  // button — nothing here is text to select or a link to inspect.
  btn.addEventListener('contextmenu', preventDefault);
  // Keyboard access (Enter/Space) for anyone tabbing to the button —
  // held down via keydown repeat would be unreliable across browsers,
  // so keyboard users get the same hold behaviour via keydown→timer
  // and keyup→cancel instead of relying on repeat events. There's no
  // real "pointerId" for a key press; KEYBOARD_POINTER_ID is a sentinel
  // so the same begin/cancel plumbing (and its pointerId ownership
  // check) works for both input styles without a parallel code path.
  btn.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && _exitPointerId === null) {
      e.preventDefault();
      beginExitHold(KEYBOARD_POINTER_ID);
    }
  });
  btn.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.key === ' ') cancelExitHold(KEYBOARD_POINTER_ID);
  });
  // capture:true so this sees the scroll before anything might stop its
  // propagation; passive:true because it only ever reads, never blocks,
  // the scroll itself.
  window.addEventListener('scroll', onExitScrollCancel, { capture: true, passive: true });
  document.addEventListener('visibilitychange', onExitVisibilityCancel);
}

function unbindExitHold() {
  window.removeEventListener('scroll', onExitScrollCancel, { capture: true });
  document.removeEventListener('visibilitychange', onExitVisibilityCancel);
  // The button itself is torn down along with #checkin-kiosk whenever the
  // container is re-rendered (router.go / stopCheckinDisplay), which also
  // drops its own listeners — only the window/document ones outlive it.
}

function preventDefault(e) { e.preventDefault(); }

const KEYBOARD_POINTER_ID = 'keyboard';

function onExitPointerDown(e) {
  // A hold is already in progress (a second finger, or a stray repeat
  // event) — ignore rather than restart the timer, which would let a
  // second contact silently extend or reset an in-flight hold.
  if (_exitPointerId !== null) return;
  // Best-effort: capture can legitimately fail (e.g. a pointerId the
  // platform doesn't recognise as an active contact) without meaning the
  // gesture itself is invalid — the hold still runs, just without the
  // drift protection above. Never let a capture failure abort the hold.
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* not fatal */ }
  beginExitHold(e.pointerId);
}

function onExitPointerRelease(e) {
  if (e.pointerId !== _exitPointerId) return;
  cancelExitHold(e.pointerId);
}

function onExitScrollCancel() {
  if (_exitPointerId !== null) cancelExitHold(_exitPointerId);
}

function onExitVisibilityCancel() {
  if (document.visibilityState === 'hidden' && _exitPointerId !== null) cancelExitHold(_exitPointerId);
}

function beginExitHold(pointerId) {
  _exitPointerId = pointerId;
  _exitStart = performance.now();
  updateExitProgress();
}

function updateExitProgress() {
  const elapsed = performance.now() - _exitStart;
  const pct = Math.min(100, (elapsed / EXIT_HOLD_MS) * 100);
  const bar = document.getElementById('checkin-exit-progress');
  if (bar) bar.style.width = pct + '%';
  if (pct >= 100) {
    _exitRAF = null;
    _exitPointerId = null;
    stopCheckinDisplay();
    window._navTo?.('overview');
    return;
  }
  _exitRAF = requestAnimationFrame(updateExitProgress);
}

function cancelExitHold(pointerId) {
  // Guard against a release event for a pointer that isn't the one
  // currently driving the hold (e.g. a delayed event arriving after a
  // different pointer already completed or cancelled it).
  if (pointerId !== undefined && pointerId !== _exitPointerId) return;
  if (_exitRAF) cancelAnimationFrame(_exitRAF);
  _exitRAF = null;
  _exitPointerId = null;
  const bar = document.getElementById('checkin-exit-progress');
  if (bar) bar.style.width = '0%';
}

async function refreshCode() {
  const wrap = document.getElementById('checkin-qr-wrap');
  const offline = document.getElementById('checkin-offline');
  const img = document.getElementById('checkin-qr-img');
  if (!wrap || !img) return; // page navigated away mid-flight

  try {
    const { token } = await issueCheckinToken();
    const payload = `SCULPT1:${S.gym?.gym_code || ''}:${token}`;
    img.src = await generateQR(payload);
    if (offline) offline.style.display = 'none';
    wrap.style.opacity = '1';
  } catch (err) {
    console.error('[Sculpt] check-in token refresh failed:', err.message);
    if (offline) offline.style.display = 'block';
    wrap.style.opacity = '0.4';
  }
}

function startRotation() {
  refreshCode();
  _rotateTimer = setInterval(refreshCode, 30_000);
}

async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) _wakeLock = await navigator.wakeLock.request('screen');
  } catch (_) { /* not fatal — screen may just dim on some devices */ }
}

function reacquireWakeLockOnVisible() {
  if (document.visibilityState === 'visible' && document.getElementById('checkin-kiosk')) {
    acquireWakeLock();
  }
}

export function stopCheckinDisplay() {
  if (_rotateTimer) clearInterval(_rotateTimer);
  _rotateTimer = null;
  if (_exitRAF) cancelAnimationFrame(_exitRAF);
  _exitRAF = null;
  _exitPointerId = null;
  if (_wakeLock) { _wakeLock.release().catch(() => {}); _wakeLock = null; }
  document.removeEventListener('visibilitychange', reacquireWakeLockOnVisible);
  unbindExitHold();
  document.getElementById('page-gym')?.classList.remove('checkin-kiosk-active');
}
