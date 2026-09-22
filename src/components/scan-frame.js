// src/components/scan-frame.js — the QR viewfinder, shared by both
// people who ever scan anything in this app: a staff member marking
// their own attendance (pages/dashboard/checkin-scan.js) and a member
// checking in (pages/member/index.js).
// ─────────────────────────────────────────────────────────────────
// It lives in components/ rather than in either page because the two
// pages sit in different import trees — pages/member must not import
// from pages/dashboard beyond helpers, and pages/dashboard must not
// import from pages/member at all. A shared viewfinder in one of them
// would be an import in the wrong direction; a copy in each would
// drift, and the last time these two scan flows drifted it cost us the
// double-check-in bug (see CLAUDE.md on stopping the scanner).
//
// The frame is a state machine driven by one attribute, data-state:
//
//   scanning  live camera, corner brackets, sweeping line, hint pill
//   working   request in flight; the camera is already stopped
//   done      accepted — brackets dim, nothing is still "looking"
//   refused   rejected — same, the result card below says why
//   blocked   no camera / permission denied, with a cause and a retry
//
// Callers own the video element's stream (startScanner in lib/qr.js)
// and the result UI underneath; this module owns the box and its
// states, nothing else.
// ─────────────────────────────────────────────────────────────────

// Inline SVG in the same feather-ish family as the rest of the app —
// never emoji. These carry meaning at a glance (a green tick vs. an
// amber alert IS the message), and emoji render differently on every
// device a gym's members walk in with.
export const SCAN_ICON = {
  scan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16.5" x2="12" y2="16.5"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  arrowIn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>',
  arrowOut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  dumbbell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M7 6v12M2.8 9.5v5M17 6v12M21.2 9.5v5"/><line x1="7" y1="12" x2="17" y2="12"/></svg>',
};

/**
 * Markup for the viewfinder. The caller supplies ids so it can find its
 * own video element and hint; everything else is addressed by class.
 *
 * @param {object} opts
 * @param {string} opts.videoId   id for the <video> the scanner attaches to
 * @param {string} opts.hintId    id for the status pill's text
 * @param {string} opts.retryId   id for the "Try Again" button in the blocked state
 * @param {string} [opts.hint]    initial hint text
 * @param {string} [opts.working] label shown while a scan is being checked
 */
export function scanFrameHTML({ videoId, hintId, retryId, hint = 'Looking for the code…', working = 'Checking…' }) {
  return `
    <div class="scan-frame" data-state="scanning">
      <video id="${videoId}" autoplay playsinline muted aria-label="Camera viewfinder"></video>
      <div class="scan-brackets" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="scan-line" aria-hidden="true"></div>

      <div class="scan-overlay scan-overlay-working" aria-hidden="true">
        <div class="scan-spinner"></div>
        <div class="scan-overlay-title">${working}</div>
      </div>
      <div class="scan-overlay scan-overlay-blocked">
        <div class="scan-overlay-icon">${SCAN_ICON.camera}</div>
        <div class="scan-overlay-title scan-blocked-title">Camera unavailable</div>
        <div class="scan-overlay-msg scan-blocked-msg"></div>
        <button class="btn btn-secondary scan-retry" id="${retryId}" type="button">Try Again</button>
      </div>

      <div class="scan-hint" id="${hintId}" role="status" aria-live="polite">
        ${SCAN_ICON.scan}<span>${hint}</span>
      </div>
    </div>`;
}

/** Move the frame containing `el` (or the only one on screen) to a state. */
export function setScanState(state, root = document) {
  root.querySelector('.scan-frame')?.setAttribute('data-state', state);
}

/** Replace the hint pill's text without disturbing its icon. */
export function setScanHint(hintId, text) {
  const el = document.getElementById(hintId);
  if (el) el.innerHTML = `${SCAN_ICON.scan}<span></span>`;
  const span = el?.querySelector('span');
  if (span) span.textContent = text;
}

/**
 * Fill in the blocked state from a getUserMedia-ish error and switch to
 * it. A camera failure is a dead end on both of these screens — it is
 * the whole point of the page — so it gets a cause and a retry, not a
 * line of grey text under a black box.
 */
export function showScanBlocked(err, root = document) {
  setScanState('blocked', root);
  const raw = String(err?.message || '');
  const denied = /denied|notallowed|permission/i.test(raw);
  const title = root.querySelector('.scan-blocked-title');
  const msg = root.querySelector('.scan-blocked-msg');
  if (title) title.textContent = denied ? 'Camera access is off' : 'Camera unavailable';
  if (msg) {
    msg.textContent = denied
      ? 'Allow camera access for this site in your browser settings, then try again.'
      : (raw || 'No camera could be opened on this device.');
  }
}

let _injected = false;
export function injectScanFrameStyles() {
  if (_injected || document.getElementById('sculpt-scan-frame-styles')) return;
  _injected = true;
  const st = document.createElement('style');
  st.id = 'sculpt-scan-frame-styles';
  st.textContent = `
    .scan-frame{position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-xl);overflow:hidden;
      background:#0B0B0D;border:1px solid var(--border-subtle);
      box-shadow:0 18px 40px -24px rgba(0,0,0,0.9);}
    .scan-frame video{width:100%;height:100%;object-fit:cover;display:block;}
    .scan-frame[data-state="blocked"] video{opacity:0;}

    /* Corner brackets: the aiming affordance. Borders on four absolutely
       placed corners rather than an SVG, so they scale with the frame
       and inherit the brand colour. */
    .scan-brackets i{position:absolute;width:38px;height:38px;border:3px solid var(--brand);opacity:0.9;}
    .scan-brackets i:nth-child(1){top:18px;left:18px;border-right:0;border-bottom:0;border-radius:12px 0 0 0;}
    .scan-brackets i:nth-child(2){top:18px;right:18px;border-left:0;border-bottom:0;border-radius:0 12px 0 0;}
    .scan-brackets i:nth-child(3){bottom:18px;left:18px;border-right:0;border-top:0;border-radius:0 0 0 12px;}
    .scan-brackets i:nth-child(4){bottom:18px;right:18px;border-left:0;border-top:0;border-radius:0 0 12px 0;}

    .scan-line{position:absolute;left:18px;right:18px;height:2px;border-radius:2px;
      background:linear-gradient(90deg,transparent,var(--brand),transparent);
      box-shadow:0 0 12px var(--brand);animation:scanSweep 2.6s ease-in-out infinite;}
    @keyframes scanSweep{0%,100%{transform:translateY(40px);}50%{transform:translateY(calc(100% + 40px));}}

    /* Only the scanning state shows the aiming furniture. */
    .scan-frame:not([data-state="scanning"]) .scan-line,
    .scan-frame:not([data-state="scanning"]) .scan-hint{opacity:0;visibility:hidden;}
    .scan-frame[data-state="blocked"] .scan-brackets{opacity:0.25;}
    /* The camera is off once a result is in — a fully lit viewfinder
       would keep implying it is still looking. */
    .scan-frame[data-state="done"] .scan-brackets,
    .scan-frame[data-state="refused"] .scan-brackets{opacity:0.3;}

    .scan-hint{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);
      display:inline-flex;align-items:center;gap:8px;max-width:calc(100% - 32px);
      padding:9px 14px;border-radius:var(--radius-pill);
      background:rgba(10,10,12,0.72);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
      border:1px solid rgba(255,255,255,0.12);color:#fff;font-size:12.5px;font-weight:500;
      transition:opacity var(--duration-fast) var(--ease-out);}
    .scan-hint svg{width:15px;height:15px;flex-shrink:0;opacity:0.85;}
    .scan-hint span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

    /* Overlays share one box; data-state picks which is visible. */
    .scan-overlay{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;
      gap:12px;padding:28px;text-align:center;background:rgba(8,8,10,0.86);
      backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);}
    .scan-frame[data-state="working"] .scan-overlay-working{display:flex;}
    .scan-frame[data-state="blocked"] .scan-overlay-blocked{display:flex;}
    .scan-overlay-icon{width:40px;height:40px;color:var(--text-tertiary);}
    .scan-overlay-icon svg{width:100%;height:100%;}
    .scan-overlay-title{font-size:15px;font-weight:600;color:#fff;}
    .scan-overlay-msg{font-size:13px;line-height:1.5;color:rgba(255,255,255,0.68);max-width:30ch;}
    .scan-retry{min-height:44px;margin-top:4px;}

    .scan-spinner{width:30px;height:30px;border-radius:50%;
      border:2.5px solid rgba(255,255,255,0.18);border-top-color:var(--brand);
      animation:scanSpin 0.8s linear infinite;}
    @keyframes scanSpin{to{transform:rotate(360deg);}}

    /* A sweeping line and a spinning ring are exactly what
       prefers-reduced-motion is about; the states stay distinguishable
       without them. */
    @media (prefers-reduced-motion:reduce){
      .scan-line{animation:none;top:50%;}
      .scan-spinner{animation-duration:2s;}
    }
  `;
  document.head.appendChild(st);
}
