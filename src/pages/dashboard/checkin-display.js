// src/pages/dashboard/checkin-display.js — desk kiosk QR screen
import { S } from './state.js';
import { issueCheckinToken } from '../../lib/checkin.js';
import { generateQR } from '../../lib/qr.js';
import { escHtml } from './helpers.js';
import { nav } from './index.js';

// 2026-08-27 client demo: "Hold to exit (3s)" never worked. Root cause
// (proven, not guessed): this button called `window._navTo?.('overview')`,
// and `window._navTo` is assigned once at dashboard/index.js's MODULE TOP
// LEVEL — dynamic import() caches the module, so that assignment only
// ever runs on the dashboard's first mount. app.js's router.go() deletes
// every LEGACY_GLOBALS entry (including `_navTo`) on EVERY navigation.
// So the very first time a staff member left the dashboard and came back
// — near-certain before ever reaching the desk display during a live
// demo — `window._navTo` was permanently undefined for the rest of the
// session, the optional call silently did nothing, and the progress bar
// just filled to 100% and stopped. Client decision: replace the gesture
// with a plain Back button, and import `nav` directly here instead of
// going through the window global at all (dashboard/index.js also now
// re-assigns window._navTo on every render, for the other two call sites
// that are still inline onclick strings — see the comment there).
//
// SECURITY NOTE — read before touching this: the tablet this runs on
// sits unattended in a public area, signed into an account that can see
// member phone numbers, Aadhaar photos and collect payments. The 3-second
// hold existed specifically so a passerby couldn't drop into that account
// with one tap. A plain Back button removes that gate — see
// HANDOVER.md §6 and CHECKIN-PLAN.md for what this means going forward
// and the two mitigations raised there (staff PIN on exit; auto-return
// to kiosk after inactivity). Neither is implemented — this kiosk is now
// only as safe as physical supervision of the tablet.

let _rotateTimer = null;
let _wakeLock = null;

export function renderCheckinDisplay(container) {
  window.__sculptRegisterCleanup?.(stopCheckinDisplay);

  // Hiding the sidebar/topbar here is still a real layer — without it,
  // the mobile swipe-open gesture in sidebar.js could slide the real
  // dashboard nav out from underneath this full-screen overlay.
  document.getElementById('page-gym')?.classList.add('checkin-kiosk-active');

  container.innerHTML = `
    <div id="checkin-kiosk" style="position:fixed;inset:0;z-index:500;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;text-align:center;">
      <button id="checkin-exit" aria-label="Back to dashboard" style="position:absolute;top:18px;right:18px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);color:#fff;border-radius:10px;padding:10px 16px;font-size:13px;cursor:pointer;">
        ← Back
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

  document.getElementById('checkin-exit')?.addEventListener('click', () => {
    stopCheckinDisplay();
    nav('overview');
  });
  startRotation();
  acquireWakeLock();
  document.addEventListener('visibilitychange', reacquireWakeLockOnVisible);
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
  if (_wakeLock) { _wakeLock.release().catch(() => {}); _wakeLock = null; }
  document.removeEventListener('visibilitychange', reacquireWakeLockOnVisible);
  document.getElementById('page-gym')?.classList.remove('checkin-kiosk-active');
}
