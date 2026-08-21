// src/pages/dashboard/checkin-display.js — desk kiosk QR screen
import { S } from './state.js';
import { issueCheckinToken } from '../../lib/checkin.js';
import { generateQR } from '../../lib/qr.js';
import { escHtml } from './helpers.js';

const EXIT_HOLD_MS = 2500;

let _rotateTimer = null;
let _wakeLock = null;
let _exitStart = 0;
let _exitRAF = null;

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
      <button id="checkin-exit" aria-label="Hold for 3 seconds to exit the display" style="position:absolute;top:18px;right:18px;overflow:hidden;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);color:#fff;border-radius:10px;padding:10px 16px;font-size:13px;cursor:pointer;-webkit-user-select:none;user-select:none;touch-action:none;">
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
function bindExitHold() {
  const btn = document.getElementById('checkin-exit');
  if (!btn) return;
  btn.addEventListener('pointerdown', beginExitHold);
  btn.addEventListener('pointerup', cancelExitHold);
  btn.addEventListener('pointerleave', cancelExitHold);
  btn.addEventListener('pointercancel', cancelExitHold);
  // Keyboard access (Enter/Space) for anyone tabbing to the button —
  // held down via keydown repeat would be unreliable across browsers,
  // so keyboard users get the same hold behaviour via keydown→timer
  // and keyup→cancel instead of relying on repeat events.
  btn.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !_exitRAF) { e.preventDefault(); beginExitHold(); }
  });
  btn.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.key === ' ') cancelExitHold();
  });
}

function beginExitHold() {
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
    stopCheckinDisplay();
    window._navTo?.('overview');
    return;
  }
  _exitRAF = requestAnimationFrame(updateExitProgress);
}

function cancelExitHold() {
  if (_exitRAF) cancelAnimationFrame(_exitRAF);
  _exitRAF = null;
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
  if (_wakeLock) { _wakeLock.release().catch(() => {}); _wakeLock = null; }
  document.removeEventListener('visibilitychange', reacquireWakeLockOnVisible);
  document.getElementById('page-gym')?.classList.remove('checkin-kiosk-active');
}
