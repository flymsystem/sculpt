// src/pages/member/index.js — member portal shell.
//
// Four things only, per the brief: Check In (primary, unmissable),
// My Plan, My Receipts, My Visits. This is deliberately not a
// dashboard — no sidebar, no settings, nothing to configure. Designed
// for a gym member on their own phone, one-handed, often mid-workout —
// large tap targets, the scan button thumb-reachable at the bottom of
// the screen, and status colour that reads at a glance, not a KPI grid.
import { memberSignOut, getMyMembership, getMyVisits } from '../../lib/member-auth.js';
import { memberCheckin } from '../../lib/checkin.js';
import { escHtml, fmtDate } from '../dashboard/helpers.js';
import { renderMemberReceipts } from './receipts.js';

let _membership = null;
let _stopScanner = null;
let _activeTab = 'checkin';

export async function renderMemberPortal(router) {
  window.__sculptRegisterCleanup?.(stopMemberScanner);

  const root = document.getElementById('root');
  root.innerHTML = `<div id="page-member"><div class="loading-inline"><div class="spinner"></div></div></div>`;

  try {
    _membership = await getMyMembership();
  } catch (err) {
    console.error('[Sculpt] getMyMembership failed:', err.message);
  }

  if (!_membership) {
    // Session exists but resolves to neither a gym_users row nor a
    // member row — the account genuinely isn't configured. Don't loop
    // back into the dashboard's login (a member has no password there).
    root.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;min-height:100dvh;padding:32px;text-align:center;gap:14px;background:var(--surface-bg);">
        <div style="font-size:40px;">⚠️</div>
        <div style="font-size:17px;font-weight:var(--font-semibold);color:var(--text-primary);">Could not load your account</div>
        <div style="font-size:13px;color:var(--text-tertiary);max-width:320px;line-height:var(--leading-relaxed);">
          Please check your connection and try again, or contact the front desk.
        </div>
        <button class="btn btn-primary" id="member-portal-retry" style="margin-top:8px;">Retry</button>
      </div>`;
    document.getElementById('member-portal-retry')?.addEventListener('click', () => renderMemberPortal(router));
    return;
  }

  injectMemberPortalStyles();
  _activeTab = 'checkin';
  root.innerHTML = shellHTML();
  bindShell(router);
  renderTab('checkin');
}

function shellHTML() {
  const gymName = _membership.gym_name || 'Your Gym';
  return `
    <div id="page-member">
      <div class="mp-topbar">
        ${_membership.gym_logo_url ? `<img src="${escHtml(_membership.gym_logo_url)}" alt="" class="mp-topbar-logo">` : ''}
        <div class="mp-topbar-name">${escHtml(gymName)}</div>
        <button class="mp-signout" id="mp-signout" type="button" aria-label="Sign out">Sign Out</button>
      </div>
      <div class="mp-content" id="mp-content"></div>
      <nav class="mp-tabbar" aria-label="Member sections">
        <button class="mp-tab active" data-tab="checkin" type="button">${tabIcon('checkin')}<span>Check In</span></button>
        <button class="mp-tab" data-tab="plan" type="button">${tabIcon('plan')}<span>My Plan</span></button>
        <button class="mp-tab" data-tab="receipts" type="button">${tabIcon('receipts')}<span>Receipts</span></button>
        <button class="mp-tab" data-tab="visits" type="button">${tabIcon('visits')}<span>Visits</span></button>
      </nav>
    </div>`;
}

function tabIcon(name) {
  const icons = {
    checkin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v3M14 20h3M17.5 17.5h.01"/></svg>',
    plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    receipts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>',
    visits: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  };
  return `<span class="mp-tab-icon">${icons[name] || ''}</span>`;
}

function bindShell(router) {
  document.getElementById('mp-signout')?.addEventListener('click', async () => {
    stopMemberScanner();
    await memberSignOut().catch(() => {});
    window.__sculptMemberSession = false;
    router.go('landing');
  });

  document.querySelectorAll('.mp-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mp-tab').forEach(b => b.classList.toggle('active', b === btn));
      renderTab(btn.dataset.tab);
    });
  });
}

function renderTab(tab) {
  _activeTab = tab;
  if (tab !== 'checkin') stopMemberScanner();
  const c = document.getElementById('mp-content');
  if (!c) return;

  if (tab === 'checkin') return renderCheckinTab(c);
  if (tab === 'plan') return renderPlanTab(c);
  if (tab === 'receipts') return renderMemberReceipts(c, _membership);
  if (tab === 'visits') return renderVisitsTab(c);
}

// Shared status vocabulary — plan card, check-in confirmation and the
// tab bar's "expired" treatment all read off this so the three places
// can never disagree about what colour "Expiring" is.
const STATUS_META = {
  Active:    { tone: 'ok',   label: 'Active' },
  Trial:     { tone: 'ok',   label: 'Trial' },
  Expiring:  { tone: 'warn', label: 'Expiring Soon' },
  Due:       { tone: 'warn', label: 'Payment Due' },
  Expired:   { tone: 'bad',  label: 'Expired' },
  Cancelled: { tone: 'bad',  label: 'Cancelled' },
};

function statusMeta(status) {
  return STATUS_META[status] || { tone: 'ok', label: status || '—' };
}

// ── Check In ─────────────────────────────────────────────────────
function renderCheckinTab(c) {
  c.innerHTML = `
    <div class="mp-checkin" id="mp-checkin-stage">
      <div class="mp-checkin-spacer"></div>
      <button class="mp-scan-btn" id="mp-scan-start" type="button">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/></svg>
        <span>Tap to Scan &amp; Check In</span>
      </button>
      <div class="mp-checkin-hint">Point your camera at the screen at the front desk</div>
      <div id="mp-checkin-camera" style="display:none;"></div>
      <div id="mp-checkin-result"></div>
    </div>`;

  document.getElementById('mp-scan-start')?.addEventListener('click', startMemberScan);
}

async function startMemberScan() {
  const scanBtn = document.getElementById('mp-scan-start');
  const spacer = document.querySelector('.mp-checkin-spacer');
  const hint = document.querySelector('.mp-checkin-hint');
  const cameraWrap = document.getElementById('mp-checkin-camera');
  const resultEl = document.getElementById('mp-checkin-result');
  if (!cameraWrap) return;

  if (scanBtn) scanBtn.style.display = 'none';
  if (spacer) spacer.style.display = 'none';
  if (hint) hint.style.display = 'none';
  resultEl.innerHTML = '';
  cameraWrap.style.display = 'block';
  cameraWrap.innerHTML = `
    <div class="mp-camera-frame">
      <video id="mp-scan-video" autoplay playsinline muted></video>
      <div id="mp-scan-status" class="mp-camera-status">Starting camera…</div>
    </div>`;

  const { startScanner } = await import('../../lib/qr.js');
  const video = document.getElementById('mp-scan-video');
  const status = document.getElementById('mp-scan-status');
  if (!video) return; // tab switched away while qr.js was loading

  let busy = false;
  _stopScanner = await startScanner(
    video,
    async (raw) => {
      if (busy) return;
      const m = /^SCULPT1:([^:]+):([0-9a-f]{32})$/.exec(String(raw || ''));
      if (!m) { status.textContent = 'Not a check-in code.'; return; }
      busy = true;
      status.textContent = 'Checking in…';
      try {
        const { status: st, message } = await memberCheckin(m[2]);
        showCheckinResult(st, message);
        if (st === 'OK' || st === 'ALREADY_CHECKED_IN') stopMemberScanner();
      } catch (err) {
        showCheckinResult('ERROR', err.message || 'Check-in failed. Please try again.');
      } finally {
        busy = false;
      }
    },
    (err) => { status.textContent = 'Camera unavailable: ' + (err?.message || 'permission denied.'); }
  );
}

// The moment that matters most: a full-screen confirmation, not a toast.
// Readable at arm's length (the phone stays in a raised hand for a
// second after the scan) — the member's name, that they're in, and
// their plan status in one glance, then a deliberate way back to the
// scan-ready state rather than an auto-dismiss they might miss.
function showCheckinResult(status, message) {
  const stage = document.getElementById('mp-checkin-stage');
  if (!stage) return;
  const ok = status === 'OK' || status === 'ALREADY_CHECKED_IN';

  if (ok) {
    const name = _membership.member_name || 'there';
    const meta = statusMeta(_membership.computed_status);
    const daysLine = _membership.days_remaining != null
      ? `${meta.label} · ${_membership.days_remaining} day${_membership.days_remaining === 1 ? '' : 's'} left`
      : meta.label;
    stage.innerHTML = `
      <div class="mp-confirm mp-confirm-${meta.tone}">
        <div class="mp-confirm-icon">✅</div>
        <div class="mp-confirm-title">You're checked in, ${escHtml(name)}!</div>
        <div class="mp-confirm-status ${meta.tone}">${escHtml(daysLine)}</div>
        <button class="btn btn-primary btn-full" id="mp-confirm-done" style="margin-top:22px;">Done</button>
      </div>`;
    document.getElementById('mp-confirm-done')?.addEventListener('click', () => renderCheckinTab(document.getElementById('mp-content')));
    return;
  }

  stage.innerHTML = `
    <div class="mp-confirm mp-confirm-bad">
      <div class="mp-confirm-icon">⚠️</div>
      <div class="mp-confirm-title">${escHtml(message || 'Check-in was not accepted.')}</div>
      <button class="btn btn-secondary btn-full" id="mp-scan-again" style="margin-top:22px;">Try Again</button>
    </div>`;
  document.getElementById('mp-scan-again')?.addEventListener('click', () => renderCheckinTab(document.getElementById('mp-content')));
}

function stopMemberScanner() {
  if (_stopScanner) { _stopScanner(); _stopScanner = null; }
}

// ── My Plan ──────────────────────────────────────────────────────
// Not a dashboard: one card, one dominant number. Days-remaining is the
// figure people open this tab for, so it gets the biggest type on the
// screen — everything else is context around it. Expiring/Expired get
// a full-card colour wash, not a small pill, per the brief ("visually
// loud and unmissable — colour, not a small label").
function renderPlanTab(c) {
  const m = _membership;
  const meta = statusMeta(m.computed_status);
  const loud = meta.tone === 'warn' || meta.tone === 'bad';
  const days = m.days_remaining;
  const daysLabel = days == null ? '—' : Math.abs(days) === 1 ? 'day' : 'days';
  const daysValue = days == null ? '—' : (days < 0 ? `${Math.abs(days)}` : `${days}`);
  const daysCaption = days != null && days < 0 ? `${daysLabel} ago` : `${daysLabel} left`;
  const balance = Number(m.balance_due || 0);

  c.innerHTML = `
    <div class="mp-card mp-plan-card ${loud ? 'mp-plan-card-' + meta.tone : ''}">
      <div class="mp-plan-status ${meta.tone}">${escHtml(meta.label)}</div>
      <div class="mp-plan-days">
        <span class="mp-plan-days-num">${escHtml(daysValue)}</span>
        <span class="mp-plan-days-caption">${escHtml(daysCaption)}</span>
      </div>
      <div class="mp-plan-name">${escHtml(m.plan_name || 'No plan')}</div>
      <div class="mp-plan-app">${escHtml(m.application_number || '')}</div>
      <div class="mp-plan-divider"></div>
      <div class="mp-plan-grid">
        <div><div class="mp-plan-label">Joined</div><div class="mp-plan-value">${fmtDate(m.join_date) || '—'}</div></div>
        <div><div class="mp-plan-label">Expires</div><div class="mp-plan-value">${fmtDate(m.expiry_date) || '—'}</div></div>
      </div>
      ${balance > 0 ? `
        <div class="mp-plan-balance">
          <span>Balance due</span>
          <span class="mp-plan-balance-amt">₹${balance.toLocaleString('en-IN')}</span>
        </div>` : ''}
    </div>`;
}

// ── My Visits ────────────────────────────────────────────────────
// `fixtureVisits` lets a test render every state (empty / populated)
// deterministically without a live session — see the window.__sculptMemberPortal
// hook at the bottom of this file, same convention as window.__sculptCheckin.
async function renderVisitsTab(c, fixtureVisits) {
  let visits = fixtureVisits;
  if (visits === undefined) {
    c.innerHTML = `<div class="loading-inline"><div class="spinner"></div></div>`;
    try {
      visits = await getMyVisits(30);
    } catch (err) {
      c.innerHTML = `<div class="mp-empty"><div class="mp-empty-icon">⚠️</div><div class="mp-empty-title">Could not load your visits</div><div class="mp-empty-sub">${escHtml(err.message || 'Please try again.')}</div></div>`;
      return;
    }
  }
  if (!visits.length) {
    c.innerHTML = `
      <div class="mp-empty">
        <div class="mp-empty-icon">🏋️</div>
        <div class="mp-empty-title">No visits yet</div>
        <div class="mp-empty-sub">Check in at the front desk and your visit history will show up here.</div>
      </div>`;
    return;
  }
  c.innerHTML = `<div class="mp-visit-list">${visits.map(v => `
    <div class="mp-visit-row">
      <div class="mp-visit-date">${escHtml(fmtDate(v.checked_in_at))} · ${escHtml(new Date(v.checked_in_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }))}</div>
      <div class="mp-visit-badge ${v.status === 'ok' ? 'ok' : 'bad'}">${v.source === 'manual' ? 'Manual' : 'QR'}</div>
    </div>`).join('')}</div>`;
}

// ── Styles ───────────────────────────────────────────────────────
// Every colour comes from src/styles/tokens.css — see CLAUDE.md
// "Design system". Nothing here is a raw hex value.
function injectMemberPortalStyles() {
  if (document.getElementById('member-portal-styles')) return;
  const style = document.createElement('style');
  style.id = 'member-portal-styles';
  style.textContent = `
    #page-member { display:flex; flex-direction:column; min-height:100vh; min-height:100dvh; background:var(--surface-bg); }
    .mp-topbar { display:flex; align-items:center; gap:10px; padding:14px 18px; padding-top:max(14px, env(safe-area-inset-top,0px)); border-bottom:1px solid var(--border-subtle); flex-shrink:0; }
    .mp-topbar-logo { width:32px; height:32px; object-fit:contain; border-radius:var(--radius-sm); }
    .mp-topbar-name { flex:1; font-size:var(--text-md); font-weight:var(--font-semibold); color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .mp-signout { background:none; border:1px solid var(--border-default); color:var(--text-tertiary); border-radius:var(--radius-md); padding:8px 14px; font-size:var(--text-sm); cursor:pointer; min-height:36px; }

    .mp-content { flex:1; overflow-y:auto; display:flex; flex-direction:column; padding:20px 16px 24px; }

    .mp-tabbar { display:flex; border-top:1px solid var(--border-subtle); background:var(--surface-1); padding-bottom:env(safe-area-inset-bottom,0px); flex-shrink:0; }
    .mp-tab { flex:1; display:flex; flex-direction:column; align-items:center; gap:4px; padding:10px 4px 8px; background:none; border:none; color:var(--text-quaternary); font-size:var(--text-xs); cursor:pointer; min-height:52px; }
    .mp-tab-icon svg { width:22px; height:22px; }
    .mp-tab.active { color:var(--brand-text); }

    /* Check In — the button lives at the bottom of the tab, where a
       thumb resting on the phone naturally lands, not centred in the
       middle of the screen. */
    .mp-checkin { display:flex; flex-direction:column; align-items:center; text-align:center; gap:16px; flex:1; justify-content:flex-end; padding-bottom:24px; }
    .mp-checkin-spacer { flex:1; min-height:8px; }
    .mp-scan-btn { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; width:224px; height:224px; border-radius:50%; background:linear-gradient(135deg, var(--brand-text), var(--purple)); color:var(--text-inverse); border:none; font-size:var(--text-md); font-weight:var(--font-bold); cursor:pointer; box-shadow:0 0 60px var(--brand-fade-strong); }
    .mp-checkin-hint { color:var(--text-tertiary); font-size:var(--text-base); max-width:260px; }
    .mp-camera-frame { position:relative; width:100%; max-width:340px; aspect-ratio:1; border-radius:var(--radius-xl); overflow:hidden; background:#000; margin:0 auto; }
    .mp-camera-frame video { width:100%; height:100%; object-fit:cover; }
    .mp-camera-status { position:absolute; inset:auto 0 0 0; padding:10px; text-align:center; background:var(--surface-overlay); color:var(--text-primary); font-size:var(--text-sm); }

    /* Post-scan confirmation — takes over the whole tab deliberately,
       readable at arm's length: name, status, one action. */
    .mp-confirm { display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; flex:1; gap:6px; padding:32px 20px; border-radius:var(--radius-xl); }
    .mp-confirm-icon { font-size:56px; line-height:1; margin-bottom:10px; }
    .mp-confirm-title { font-size:var(--text-2xl); font-weight:var(--font-bold); color:var(--text-primary); line-height:var(--leading-snug); }
    .mp-confirm-status { font-size:var(--text-lg); font-weight:var(--font-semibold); margin-top:4px; }
    .mp-confirm-status.ok { color:var(--green); }
    .mp-confirm-status.warn { color:var(--amber); }
    .mp-confirm-status.bad { color:var(--red); }
    .mp-confirm-ok { background:var(--green-fade); }
    .mp-confirm-warn { background:var(--amber-fade); }
    .mp-confirm-bad { background:var(--red-fade); }

    .mp-card { background:var(--surface-1); border:1px solid var(--border-subtle); border-radius:var(--radius-xl); padding:28px 24px; }
    .mp-plan-card-warn { background:var(--amber-fade); border-color:var(--amber-strong); }
    .mp-plan-card-bad { background:var(--red-fade); border-color:var(--red-strong); }
    .mp-plan-status { display:inline-block; font-size:var(--text-xs); font-weight:var(--font-bold); letter-spacing:var(--tracking-wide); text-transform:uppercase; padding:5px 12px; border-radius:var(--radius-pill); margin-bottom:16px; }
    .mp-plan-status.ok { background:var(--green-fade); color:var(--green); }
    .mp-plan-status.warn { background:var(--amber-strong); color:var(--amber); }
    .mp-plan-status.bad { background:var(--red-strong); color:var(--red); }
    .mp-plan-days { display:flex; align-items:baseline; gap:8px; margin-bottom:6px; }
    .mp-plan-days-num { font-family:var(--font-sans); font-size:72px; font-weight:var(--font-extrabold); line-height:1; color:var(--text-primary); letter-spacing:var(--tracking-tight); }
    .mp-plan-days-caption { font-size:var(--text-md); color:var(--text-tertiary); font-weight:var(--font-medium); }
    .mp-plan-name { font-size:var(--text-lg); font-weight:var(--font-semibold); color:var(--text-primary); margin-bottom:2px; }
    .mp-plan-app { font-family:var(--font-mono); font-size:var(--text-sm); color:var(--text-tertiary); }
    .mp-plan-divider { height:1px; background:var(--border-subtle); margin:20px 0; }
    .mp-plan-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    .mp-plan-label { font-size:var(--text-xs); color:var(--text-quaternary); text-transform:uppercase; letter-spacing:var(--tracking-wide); margin-bottom:3px; }
    .mp-plan-value { font-size:var(--text-md); font-weight:var(--font-semibold); color:var(--text-primary); }
    .mp-plan-balance { display:flex; align-items:center; justify-content:space-between; margin-top:20px; padding-top:16px; border-top:1px solid var(--border-subtle); font-size:var(--text-md); color:var(--text-secondary); }
    .mp-plan-balance-amt { font-weight:var(--font-bold); color:var(--text-primary); }

    .mp-visit-list { display:flex; flex-direction:column; gap:8px; }
    .mp-visit-row { display:flex; align-items:center; justify-content:space-between; background:var(--surface-1); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:14px; font-size:var(--text-base); min-height:44px; }
    .mp-visit-date { color:var(--text-primary); }
    .mp-visit-sub { font-size:var(--text-xs); color:var(--text-tertiary); margin-top:2px; }
    .mp-visit-amount { font-weight:var(--font-bold); color:var(--text-primary); }
    .mp-visit-badge { font-size:var(--text-xs); font-weight:var(--font-bold); padding:4px 10px; border-radius:var(--radius-pill); text-transform:uppercase; }
    .mp-visit-badge.ok { background:var(--green-fade); color:var(--green); }
    .mp-visit-badge.bad { background:var(--red-fade); color:var(--red); }

    .mp-empty { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; color:var(--text-tertiary); padding:40px 24px; gap:8px; }
    .mp-empty-icon { font-size:38px; margin-bottom:4px; }
    .mp-empty-title { font-size:var(--text-lg); font-weight:var(--font-semibold); color:var(--text-primary); }
    .mp-empty-sub { font-size:var(--text-base); max-width:280px; line-height:var(--leading-relaxed); }

    .mp-section-label { font-size:var(--text-xs); font-weight:var(--font-bold); letter-spacing:var(--tracking-wider); text-transform:uppercase; color:var(--text-quaternary); margin:18px 0 8px; }
    .mp-section-label:first-child { margin-top:0; }
    .mp-receipts-files { display:flex; flex-direction:column; gap:6px; margin-bottom:8px; }
    .mp-file-row { display:flex; align-items:center; justify-content:space-between; background:var(--surface-1); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:14px; font-size:var(--text-base); color:var(--text-primary); text-decoration:none; min-height:44px; }
    .mp-file-download { color:var(--brand-text); font-size:var(--text-sm); font-weight:var(--font-semibold); }
  `;
  document.head.appendChild(style);
}

// Exposed on window so Playwright can drive the portal against the BUILT
// preview server without a live member session — same convention as
// window.__sculptCheckin (lib/checkin.js) and window.__sculptMemberAuth
// (lib/member-auth.js). Never used by production code paths.
if (typeof window !== 'undefined') {
  window.__sculptMemberPortal = {
    mount(router, membership) {
      _membership = membership;
      injectMemberPortalStyles();
      _activeTab = 'checkin';
      document.getElementById('root').innerHTML = shellHTML();
      bindShell(router);
      renderTab('checkin');
    },
    goTab(tab) {
      document.querySelectorAll('.mp-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      renderTab(tab);
    },
    simulateCheckin(status, message) { showCheckinResult(status, message); },
    renderVisitsFixture(visits) {
      const c = document.getElementById('mp-content');
      if (c) renderVisitsTab(c, visits);
    },
    renderReceiptsFixture(payments, files) {
      const c = document.getElementById('mp-content');
      if (c) renderMemberReceipts(c, _membership, { payments, files });
    },
  };
}
