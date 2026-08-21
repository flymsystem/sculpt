// src/pages/member/index.js — member portal shell.
//
// Four things only, per the brief: Check In (primary, unmissable),
// My Plan, My Receipts, My Visits. This is deliberately not a
// dashboard — no sidebar, no settings, nothing to configure.
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
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;min-height:100dvh;padding:32px;text-align:center;gap:14px;">
        <div style="font-size:40px;">⚠️</div>
        <div style="font-size:17px;font-weight:600;color:var(--text-primary);">Could not load your account</div>
        <div style="font-size:13px;color:var(--text-tertiary);max-width:320px;line-height:1.6;">
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

// ── Check In ─────────────────────────────────────────────────────
function renderCheckinTab(c) {
  c.innerHTML = `
    <div class="mp-checkin">
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
  const hint = document.querySelector('.mp-checkin-hint');
  const cameraWrap = document.getElementById('mp-checkin-camera');
  const resultEl = document.getElementById('mp-checkin-result');
  if (!cameraWrap) return;

  if (scanBtn) scanBtn.style.display = 'none';
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

function showCheckinResult(status, message) {
  const cameraWrap = document.getElementById('mp-checkin-camera');
  const resultEl = document.getElementById('mp-checkin-result');
  const scanBtn = document.getElementById('mp-scan-start');
  const hint = document.querySelector('.mp-checkin-hint');
  if (cameraWrap) cameraWrap.style.display = 'none';
  const ok = status === 'OK' || status === 'ALREADY_CHECKED_IN';
  if (resultEl) {
    resultEl.innerHTML = `<div class="mp-checkin-outcome ${ok ? 'ok' : 'denied'}">
      <div class="mp-checkin-outcome-icon">${ok ? '✅' : '⚠️'}</div>
      <div>${escHtml(message)}</div>
      ${!ok ? '<button class="btn btn-secondary btn-sm" id="mp-scan-again">Try Again</button>' : ''}
    </div>`;
    document.getElementById('mp-scan-again')?.addEventListener('click', () => {
      if (scanBtn) scanBtn.style.display = '';
      if (hint) hint.style.display = '';
      resultEl.innerHTML = '';
    });
  }
  if (ok) {
    if (scanBtn) scanBtn.style.display = '';
    if (hint) hint.style.display = '';
  }
}

function stopMemberScanner() {
  if (_stopScanner) { _stopScanner(); _stopScanner = null; }
}

// ── My Plan ──────────────────────────────────────────────────────
function renderPlanTab(c) {
  const m = _membership;
  const statusClass = { Active: 'ok', Trial: 'ok', Expiring: 'warn', Due: 'warn', Expired: 'bad', Cancelled: 'bad' }[m.computed_status] || 'ok';
  c.innerHTML = `
    <div class="mp-card">
      <div class="mp-plan-status ${statusClass}">${escHtml(m.computed_status || '—')}</div>
      <div class="mp-plan-name">${escHtml(m.plan_name || 'No plan')}</div>
      <div class="mp-plan-app">${escHtml(m.application_number || '')}</div>
      <div class="mp-plan-grid">
        <div><div class="mp-plan-label">Joined</div><div class="mp-plan-value">${fmtDate(m.join_date) || '—'}</div></div>
        <div><div class="mp-plan-label">Expires</div><div class="mp-plan-value">${fmtDate(m.expiry_date) || '—'}</div></div>
        <div><div class="mp-plan-label">Days Left</div><div class="mp-plan-value">${m.days_remaining != null ? m.days_remaining : '—'}</div></div>
        <div><div class="mp-plan-label">Balance Due</div><div class="mp-plan-value">${m.balance_due ? '₹' + Number(m.balance_due).toLocaleString('en-IN') : '₹0'}</div></div>
      </div>
    </div>`;
}

// ── My Visits ────────────────────────────────────────────────────
async function renderVisitsTab(c) {
  c.innerHTML = `<div class="loading-inline"><div class="spinner"></div></div>`;
  let visits = [];
  try {
    visits = await getMyVisits(30);
  } catch (err) {
    c.innerHTML = `<div class="mp-empty">Could not load your visits. ${escHtml(err.message || '')}</div>`;
    return;
  }
  if (!visits.length) {
    c.innerHTML = `<div class="mp-empty">No visits recorded yet.</div>`;
    return;
  }
  c.innerHTML = `<div class="mp-visit-list">${visits.map(v => `
    <div class="mp-visit-row">
      <div class="mp-visit-date">${escHtml(fmtDate(v.checked_in_at))} · ${escHtml(new Date(v.checked_in_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }))}</div>
      <div class="mp-visit-badge ${v.status === 'ok' ? 'ok' : 'bad'}">${v.source === 'manual' ? 'Manual' : 'QR'}</div>
    </div>`).join('')}</div>`;
}

// ── Styles ───────────────────────────────────────────────────────
function injectMemberPortalStyles() {
  if (document.getElementById('member-portal-styles')) return;
  const style = document.createElement('style');
  style.id = 'member-portal-styles';
  style.textContent = `
    #page-member { display:flex; flex-direction:column; min-height:100vh; min-height:100dvh; background:var(--surface-bg,#0A0C10); }
    .mp-topbar { display:flex; align-items:center; gap:10px; padding:14px 18px; padding-top:max(14px, env(safe-area-inset-top,0px)); border-bottom:1px solid var(--border-subtle); flex-shrink:0; }
    .mp-topbar-logo { width:32px; height:32px; object-fit:contain; border-radius:6px; }
    .mp-topbar-name { flex:1; font-size:14px; font-weight:600; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .mp-signout { background:none; border:1px solid var(--border); color:var(--text-tertiary); border-radius:8px; padding:6px 12px; font-size:12px; cursor:pointer; }

    .mp-content { flex:1; overflow-y:auto; padding:20px 16px 24px; }

    .mp-tabbar { display:flex; border-top:1px solid var(--border-subtle); background:var(--surface-1,#12151B); padding-bottom:env(safe-area-inset-bottom,0px); flex-shrink:0; }
    .mp-tab { flex:1; display:flex; flex-direction:column; align-items:center; gap:4px; padding:10px 4px 8px; background:none; border:none; color:var(--text-quaternary); font-size:11px; cursor:pointer; }
    .mp-tab-icon svg { width:22px; height:22px; }
    .mp-tab.active { color:var(--brand-text,#2A8FFF); }

    .mp-checkin { display:flex; flex-direction:column; align-items:center; text-align:center; gap:16px; padding-top:8vh; }
    .mp-scan-btn { display:flex; flex-direction:column; align-items:center; gap:14px; width:220px; height:220px; border-radius:50%; background:linear-gradient(135deg, var(--brand-text,#2A8FFF), #6C4CFF); color:#fff; border:none; font-size:15px; font-weight:700; cursor:pointer; box-shadow:0 0 60px rgba(42,143,255,0.35); }
    .mp-checkin-hint { color:var(--text-tertiary); font-size:13px; max-width:260px; }
    .mp-camera-frame { position:relative; width:100%; max-width:340px; aspect-ratio:1; border-radius:20px; overflow:hidden; background:#000; margin:0 auto; }
    .mp-camera-frame video { width:100%; height:100%; object-fit:cover; }
    .mp-camera-status { position:absolute; inset:auto 0 0 0; padding:10px; text-align:center; background:rgba(0,0,0,0.6); color:#fff; font-size:12px; }
    .mp-checkin-outcome { display:flex; flex-direction:column; align-items:center; gap:10px; padding:28px 20px; border-radius:16px; font-size:15px; font-weight:600; }
    .mp-checkin-outcome-icon { font-size:34px; }
    .mp-checkin-outcome.ok { background:rgba(46,204,113,0.1); color:#2ecc71; }
    .mp-checkin-outcome.denied { background:rgba(255,107,107,0.1); color:#ff6b6b; }

    .mp-card { background:var(--surface-1,#12151B); border:1px solid var(--border-subtle); border-radius:16px; padding:24px; }
    .mp-plan-status { display:inline-block; font-size:11px; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; padding:4px 10px; border-radius:99px; margin-bottom:10px; }
    .mp-plan-status.ok { background:rgba(46,204,113,0.15); color:#2ecc71; }
    .mp-plan-status.warn { background:rgba(255,193,7,0.15); color:#ffc107; }
    .mp-plan-status.bad { background:rgba(255,107,107,0.15); color:#ff6b6b; }
    .mp-plan-name { font-size:20px; font-weight:700; color:var(--text-primary); margin-bottom:4px; }
    .mp-plan-app { font-family:var(--font-mono); font-size:12px; color:var(--text-tertiary); margin-bottom:18px; }
    .mp-plan-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    .mp-plan-label { font-size:11px; color:var(--text-quaternary); text-transform:uppercase; letter-spacing:0.04em; margin-bottom:2px; }
    .mp-plan-value { font-size:15px; font-weight:600; color:var(--text-primary); }

    .mp-visit-list { display:flex; flex-direction:column; gap:8px; }
    .mp-visit-row { display:flex; align-items:center; justify-content:space-between; background:var(--surface-1,#12151B); border:1px solid var(--border-subtle); border-radius:10px; padding:12px 14px; font-size:13px; }
    .mp-visit-date { color:var(--text-primary); }
    .mp-visit-badge { font-size:10px; font-weight:700; padding:3px 8px; border-radius:99px; text-transform:uppercase; }
    .mp-visit-badge.ok { background:rgba(46,204,113,0.15); color:#2ecc71; }
    .mp-visit-badge.bad { background:rgba(255,107,107,0.15); color:#ff6b6b; }

    .mp-empty { text-align:center; color:var(--text-tertiary); padding:40px 20px; font-size:13px; }

    .mp-section-label { font-size:11px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:var(--text-quaternary); margin:18px 0 8px; }
    .mp-section-label:first-child { margin-top:0; }
    .mp-receipts-files { display:flex; flex-direction:column; gap:6px; margin-bottom:8px; }
    .mp-file-row { display:flex; align-items:center; justify-content:space-between; background:var(--surface-1,#12151B); border:1px solid var(--border-subtle); border-radius:10px; padding:12px 14px; font-size:13px; color:var(--text-primary); text-decoration:none; }
    .mp-file-download { color:var(--brand-text,#2A8FFF); font-size:12px; font-weight:600; }
  `;
  document.head.appendChild(style);
}
