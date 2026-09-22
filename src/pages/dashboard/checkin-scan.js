// src/pages/dashboard/checkin-scan.js — staff/trainer camera scan
// ─────────────────────────────────────────────────────────────────
// This is the first screen of a staff session and, most days, the
// only one they use: they arrive, point the phone at the desk display,
// and leave. It is designed for that — one job, one primary action,
// thumb-reachable, legible at arm's length in a gym's lighting.
//
// Four states, one at a time, never two:
//   scanning  — live camera, corner brackets, a moving scan line
//   working   — the RPC is in flight; the scanner is already stopped
//   result    — success or refusal, with the one action that follows
//   blocked   — no camera / permission denied, with a retry
//
// The camera is stopped the instant ANY result lands, success or not
// (see handleDecode) — the scanner has no idea whether a decoded code
// was accepted, so leaving it running lets the same still-visible code
// fire a second overlapping check-in. "Scan Again" starts a genuinely
// new session instead. This is a real bug that shipped once; see
// CLAUDE.md.
//
// The "Today" strip is this staff member's OWN row only
// (getStaffAttendanceForDate), never the gym's grid — a staff phone
// has no business holding every colleague's attendance.
// ─────────────────────────────────────────────────────────────────
import { S } from './state.js';
import { staffCheckin } from '../../lib/checkin.js';
import { startScanner } from '../../lib/qr.js';
import { getStaffAttendanceForDate } from '../../lib/staff.js';
import { showToast } from '../../components/toast.js';
import {
  SCAN_ICON, scanFrameHTML, setScanState, setScanHint, showScanBlocked, injectScanFrameStyles,
} from '../../components/scan-frame.js';
import { escHtml, todayLocalISO } from './helpers.js';

let _stopScanner = null;
let _busy = false;
let _container = null;

// The viewfinder, its four states and its icons all live in
// components/scan-frame.js — shared with the member portal's check-in,
// which is the same interaction for a different person. See the header
// there for why it isn't owned by either page.
// A Postgres `time` reads back as "06:07:23" (migration 131 truncates
// it to whole seconds). Show hours and minutes only — seconds are
// noise on a "you're in since…" line — and fail soft on anything
// unexpected rather than printing "Invalid Date".
function fmtClock(t) {
  if (!t) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t));
  if (!m) return '';
  let h = Number(m[1]);
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m[2]} ${suffix}`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function renderCheckinScan(container) {
  window.__sculptRegisterCleanup?.(stopCheckinScan);
  injectScanFrameStyles();
  injectScanStyles();
  _container = container;
  _busy = false;

  const name = (S.staffRecord?.full_name || '').split(' ')[0] || 'there';

  container.innerHTML = `
    <div class="content-inner scan-page page-enter">

      <div class="scan-greeting">
        <div class="scan-greeting-hi">${escHtml(greeting())}, ${escHtml(name)}</div>
        <div class="scan-greeting-sub">Point your camera at the desk screen to mark your attendance.</div>
      </div>

      <!-- Today strip: filled in by loadToday(), reserved here so the
           card doesn't pop in and shove the viewfinder down (CLS). -->
      <div class="scan-today" id="scan-today" aria-live="polite">
        <div class="scan-today-slot"><span class="scan-skel"></span></div>
        <div class="scan-today-slot"><span class="scan-skel"></span></div>
      </div>

      ${scanFrameHTML({
        videoId: 'checkin-scan-video',
        hintId: 'checkin-scan-status',
        retryId: 'scan-retry',
        working: 'Checking you in…',
      })}

      <div class="scan-result" id="checkin-scan-result" role="status" aria-live="polite"></div>
    </div>`;

  document.getElementById('scan-retry')?.addEventListener('click', () => renderCheckinScan(container));

  startCamera();
  loadToday();
}

const setState = (state) => setScanState(state);
const setHint = (text) => setScanHint('checkin-scan-status', text);

function startCamera() {
  const video = document.getElementById('checkin-scan-video');
  if (!video) return;

  startScanner(
    video,
    (raw) => handleDecode(raw),
    (err) => showScanBlocked(err),
  ).then((stop) => { _stopScanner = stop; });
}

// ── Today strip ──────────────────────────────────────────────────
// Deliberately non-blocking and deliberately quiet on failure: the
// scanner must work even if this query doesn't. A staff member whose
// strip failed to load can still scan; one who can't scan has nothing.
async function loadToday(row) {
  const el = document.getElementById('scan-today');
  if (!el) return;

  const gymId = S.gym?.id;
  const staffId = S.staffRecord?.id;
  if (!gymId || !staffId) { el.remove(); return; }

  try {
    const r = row !== undefined ? row : await getStaffAttendanceForDate(gymId, staffId, todayLocalISO());
    const inAt = fmtClock(r?.check_in);
    const outAt = fmtClock(r?.check_out);
    el.classList.toggle('is-in', !!inAt && !outAt);
    el.innerHTML = `
      <div class="scan-today-slot ${inAt ? 'is-set' : ''}">
        <span class="scan-today-ico">${SCAN_ICON.arrowIn}</span>
        <span class="scan-today-label">In</span>
        <span class="scan-today-val">${inAt ? escHtml(inAt) : '—'}</span>
      </div>
      <div class="scan-today-slot ${outAt ? 'is-set' : ''}">
        <span class="scan-today-ico">${SCAN_ICON.arrowOut}</span>
        <span class="scan-today-label">Out</span>
        <span class="scan-today-val">${outAt ? escHtml(outAt) : '—'}</span>
      </div>`;
  } catch {
    el.remove();
  }
}

async function handleDecode(raw) {
  if (_busy) return;
  const m = /^SCULPT1:([^:]+):([0-9a-f]{32})$/.exec(String(raw || ''));
  if (!m) {
    setHint('That code isn’t a check-in code.');
    return;
  }

  // Stop the scanner the moment a code is decoded, not just on success —
  // otherwise the same still-visible code gets re-detected and re-submitted
  // while the first request is settling (or after it errors), producing
  // overlapping requests and a flickering result. See the matching fix and
  // rationale in src/pages/member/index.js. A "Scan Again" action below
  // is what starts a genuinely new scan session afterwards.
  _busy = true;
  stopCheckinScan();
  setState('working');
  try {
    const { status, message } = await staffCheckin(m[2]);
    const ok = status === 'CHECKED_IN' || status === 'CHECKED_OUT';
    showResult(message, ok, status);
    showToast(message, ok ? 'green' : 'amber');
    // The row just changed server-side; re-read it so the strip agrees
    // with what the person was just told.
    if (ok) loadToday();
  } catch (err) {
    showResult(err.message || 'Check-in failed', false);
    showToast(err.message || 'Check-in failed', 'red');
  }
}

// "Scan Again" is offered on EVERY terminal outcome, not just errors.
// handleDecode() stops the scanner the instant any result lands (see
// the comment there), so after a successful check-in the camera is off
// and this button is the only way back to a live scanner. A staff
// session has no sidebar to navigate away and back through, so without
// it a trainer who checked in this morning had no way to scan out at
// the end of the day short of reloading the app.
function showResult(message, ok, status) {
  const resultEl = document.getElementById('checkin-scan-result');
  if (!resultEl) return;

  setState(ok ? 'done' : 'refused');

  const title = status === 'CHECKED_OUT' ? 'Checked out' : ok ? 'Checked in' : 'Not checked in';

  resultEl.innerHTML = `
    <div class="scan-result-card ${ok ? 'is-ok' : 'is-bad'}">
      <div class="scan-result-icon">${ok ? SCAN_ICON.check : SCAN_ICON.alert}</div>
      <div class="scan-result-text">
        <div class="scan-result-title">${escHtml(title)}</div>
        <div class="scan-result-msg">${escHtml(message)}</div>
      </div>
    </div>
    <button class="btn btn-primary scan-again" id="checkin-scan-again" type="button">Scan Again</button>`;

  document.getElementById('checkin-scan-again')?.addEventListener('click', () => {
    if (_container) renderCheckinScan(_container);
  });
}

export function stopCheckinScan() {
  if (_stopScanner) { _stopScanner(); _stopScanner = null; }
}

// ── Styles ───────────────────────────────────────────────────────
// Injected rather than added to dashboard.css because this page is a
// staff session's whole world and nothing else in the app uses any of
// it. Every value is a token — see src/styles/tokens.css — except the
// viewfinder's own black, which is camera chrome, not UI surface.
let _scanStylesInjected = false;
function injectScanStyles() {
  if (_scanStylesInjected || document.getElementById('sculpt-scan-styles')) return;
  _scanStylesInjected = true;
  const st = document.createElement('style');
  st.id = 'sculpt-scan-styles';
  st.textContent = `
    .scan-page{max-width:460px;margin:0 auto;display:flex;flex-direction:column;gap:16px;}

    .scan-greeting-hi{font-size:22px;font-weight:700;letter-spacing:-0.02em;color:var(--text-primary);}
    .scan-greeting-sub{font-size:13px;line-height:1.5;color:var(--text-tertiary);margin-top:4px;max-width:34ch;}

    /* Today strip — two equal slots so In and Out never reflow past
       each other as values arrive. Tabular figures keep the times from
       shifting width digit to digit. */
    .scan-today{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
    .scan-today-slot{display:flex;align-items:center;gap:8px;min-height:52px;padding:10px 14px;
      background:var(--surface-1);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);}
    .scan-today-ico{display:flex;width:16px;height:16px;color:var(--text-quaternary);flex-shrink:0;}
    .scan-today-ico svg{width:100%;height:100%;}
    .scan-today-label{font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-quaternary);}
    .scan-today-val{margin-left:auto;font-size:15px;font-weight:600;color:var(--text-tertiary);font-variant-numeric:tabular-nums;}
    .scan-today-slot.is-set .scan-today-val{color:var(--text-primary);}
    .scan-today-slot.is-set .scan-today-ico{color:var(--green);}
    .scan-skel{display:block;width:100%;height:14px;border-radius:var(--radius-pill);background:var(--surface-3);opacity:0.6;}

    /* The viewfinder's own styles live in components/scan-frame.js.
       What follows is only this page's furniture around it. */

    /* Result */
    .scan-result:empty{display:none;}
    .scan-result-card{display:flex;align-items:center;gap:14px;padding:16px;
      border-radius:var(--radius-lg);border:1px solid var(--border-subtle);background:var(--surface-1);
      animation:scanResultIn 260ms cubic-bezier(0.16,1,0.3,1);}
    .scan-result-card.is-ok{border-color:var(--green-strong);background:var(--green-fade);}
    .scan-result-card.is-bad{border-color:var(--amber-strong);background:var(--amber-fade);}
    .scan-result-icon{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
    .scan-result-icon svg{width:19px;height:19px;}
    .is-ok .scan-result-icon{background:var(--green-fade);color:var(--green);}
    .is-bad .scan-result-icon{background:var(--amber-fade);color:var(--amber);}
    .scan-result-title{font-size:15px;font-weight:700;color:var(--text-primary);letter-spacing:-0.01em;}
    .is-ok .scan-result-title{color:var(--green);}
    .is-bad .scan-result-title{color:var(--amber);}
    .scan-result-msg{font-size:13px;line-height:1.45;color:var(--text-secondary);margin-top:2px;}
    @keyframes scanResultIn{from{opacity:0;transform:translateY(8px) scale(0.98);}to{opacity:1;transform:none;}}

    .scan-again{width:100%;min-height:50px;margin-top:12px;font-size:15px;}
    .scan-again:active{transform:scale(0.985);}

    @media (prefers-reduced-motion:reduce){
      .scan-result-card{animation:none;}
    }
  `;
  document.head.appendChild(st);
}
