// src/pages/dashboard/checkins.js — Check-ins section: attendance log
// (View A) and the not-seen-recently follow-up list (View B). Both
// views carry equal weight per the brief — the follow-up list is a
// tab alongside the log, not buried behind it.
import { S, DEFAULT_FOLLOWUP_WA_TEMPLATE } from './state.js';
import { escHtml, fmtDate, todayLocalISO } from './helpers.js';
import { getAttendanceLog, subscribeAttendanceLog, getCheckinFollowup, manualCheckin } from '../../lib/checkin.js';
import { showToast } from '../../components/toast.js';

let _stopRealtime = null;
let _activeView = 'log';

export function renderCheckins(container) {
  window.__sculptRegisterCleanup?.(stopCheckinsRealtime);
  injectCheckinsStyles();
  _activeView = 'log';

  container.innerHTML = `<div class="content-inner page-enter">
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-title">Check-ins</div>
        <div class="page-sub">Attendance log and the members you haven't seen in a while</div>
      </div>
    </div>

    <div class="ci-tabbar" role="tablist">
      <button class="ci-tab active" data-view="log" role="tab" aria-selected="true">Attendance Log</button>
      <button class="ci-tab" data-view="followup" role="tab" aria-selected="false">Not Seen Recently</button>
    </div>

    <div id="ci-view"></div>
  </div>`;

  document.querySelectorAll('.ci-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ci-tab').forEach(b => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', String(b === btn));
      });
      _activeView = btn.dataset.view;
      renderActiveView();
    });
  });

  renderActiveView();
}

function renderActiveView() {
  const wrap = document.getElementById('ci-view');
  if (!wrap) return;
  stopCheckinsRealtime();
  if (_activeView === 'log') renderLogView(wrap);
  else renderFollowupView(wrap);
}

// ── View A — Attendance log ────────────────────────────────────
async function renderLogView(wrap) {
  const today = todayLocalISO();
  wrap.innerHTML = `
    <div class="ci-filters">
      <input type="search" class="form-input" id="ci-search" placeholder="Search by name…" autocomplete="off">
      <input type="date" class="form-input" id="ci-start" value="${today}">
      <input type="date" class="form-input" id="ci-end" value="${today}">
      <button class="btn btn-ghost btn-sm" id="ci-today">Today</button>
    </div>
    <div id="ci-log-table"><div class="loading-inline"><div class="spinner"></div></div></div>`;

  const load = () => loadLogTable();
  document.getElementById('ci-search')?.addEventListener('input', debounce(load, 250));
  document.getElementById('ci-start')?.addEventListener('change', load);
  document.getElementById('ci-end')?.addEventListener('change', load);
  document.getElementById('ci-today')?.addEventListener('click', () => {
    document.getElementById('ci-start').value = today;
    document.getElementById('ci-end').value = today;
    load();
  });

  await load();

  if (S.gym?.id) {
    _stopRealtime = subscribeAttendanceLog(S.gym.id, () => load());
  }
}

async function loadLogTable() {
  const tableWrap = document.getElementById('ci-log-table');
  if (!tableWrap || !S.gym?.id) return;
  const search = document.getElementById('ci-search')?.value || '';
  const start = document.getElementById('ci-start')?.value;
  const end = document.getElementById('ci-end')?.value;

  try {
    const rows = await getAttendanceLog(S.gym.id, {
      search,
      startDate: start ? `${start}T00:00:00` : undefined,
      endDate: end ? `${end}T23:59:59` : undefined,
    });

    if (!rows.length) {
      tableWrap.innerHTML = `<div class="ci-empty">No check-ins in this range.</div>`;
      return;
    }

    tableWrap.innerHTML = `
      <div class="ci-table-scroll">
        <table class="members-table" role="table">
          <thead><tr>
            <th scope="col">Member</th>
            <th scope="col">Time</th>
            <th scope="col">Status</th>
            <th scope="col" class="hide-mobile">Source</th>
          </tr></thead>
          <tbody>
            ${rows.map(r => {
              const ok = r.status === 'ok';
              const label = { ok: 'Checked In', denied_expired: 'Denied — Expired', denied_cancelled: 'Denied — Cancelled', denied_inactive: 'Denied — Inactive' }[r.status] || r.status;
              return `<tr>
                <td>
                  <div style="font-weight:500;color:var(--text-primary);font-size:13px;">${escHtml(r.members?.full_name || 'Unknown')}</div>
                  <div style="font-size:11px;color:var(--text-tertiary);">${escHtml(r.members?.phone || '')}</div>
                </td>
                <td style="font-size:12px;color:var(--text-tertiary);">${escHtml(fmtDate(r.checked_in_at))} · ${escHtml(new Date(r.checked_in_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }))}</td>
                <td><span class="badge ${ok ? 'badge-green' : 'badge-red'}">${escHtml(label)}</span></td>
                <td class="hide-mobile" style="font-size:12px;color:var(--text-tertiary);text-transform:capitalize;">${escHtml(r.source)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    tableWrap.innerHTML = `<div class="ci-empty">Could not load the attendance log. ${escHtml(err.message || '')}</div>`;
  }
}

// ── View B — Not seen recently ─────────────────────────────────
async function renderFollowupView(wrap) {
  wrap.innerHTML = `<div class="loading-inline"><div class="spinner"></div></div>`;
  if (!S.gym?.id) { wrap.innerHTML = `<div class="ci-empty">No gym loaded.</div>`; return; }

  const thresholdDays = S.gym?.checkin_followup_days ?? 21;

  try {
    const rows = await getCheckinFollowup(S.gym.id, null);
    if (!rows.length) {
      wrap.innerHTML = `<div class="ci-empty">Nobody has crossed the ${thresholdDays}-day threshold — everyone's been in recently. 🎉</div>`;
      return;
    }
    wrap.innerHTML = `
      <div class="ci-followup-note">Active members not seen in ${thresholdDays}+ days, newest join first excluded until they've had that long to visit.</div>
      <div class="ci-followup-list">
        ${rows.map(r => `
          <div class="ci-followup-row">
            <div style="min-width:0;flex:1;">
              <div style="font-weight:500;color:var(--text-primary);font-size:13px;">${escHtml(r.full_name)}</div>
              <div style="font-size:11px;color:var(--text-tertiary);">${escHtml(r.phone || '—')} · ${r.last_visit ? 'Last visit ' + escHtml(fmtDate(r.last_visit)) : 'Never checked in'} · ${r.days_since_last_visit} days</div>
            </div>
            <button class="btn btn-sm" style="background:rgba(0,230,118,0.15);color:var(--green);border:1px solid rgba(0,230,118,0.3);flex-shrink:0;"
              data-followup-id="${escHtml(r.member_id)}" data-followup-name="${escHtml(r.full_name)}" data-followup-phone="${escHtml(r.phone || '')}" data-followup-days="${r.days_since_last_visit}">
              📱 Follow Up
            </button>
          </div>`).join('')}
      </div>`;

    wrap.querySelectorAll('[data-followup-id]').forEach((btn) => {
      btn.addEventListener('click', () => sendFollowupWA(btn.dataset));
    });
  } catch (err) {
    wrap.innerHTML = `<div class="ci-empty">Could not load the follow-up list. ${escHtml(err.message || '')}</div>`;
  }
}

function sendFollowupWA({ followupName, followupPhone, followupDays }) {
  const phone = (followupPhone || '').replace(/\D/g, '');
  if (!phone) { showToast('No phone number on file for this member', 'red'); return; }
  const gym = S.gym?.name || 'our gym';
  const tpl = S.gym?.followup_wa_template || DEFAULT_FOLLOWUP_WA_TEMPLATE;
  const msg = tpl
    .replace(/\{name\}/g, followupName || '')
    .replace(/\{days\}/g, followupDays || '')
    .replace(/\{gym\}/g, gym);
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  showToast('WhatsApp opened!', 'green');
}

// Exposed for the offline-desk-tablet fallback (member detail / members
// list can call this directly) — see HANDOVER.md §6.
export async function checkInMemberManually(memberId) {
  if (!S.gym?.id) throw new Error('No gym loaded.');
  return manualCheckin(memberId, S.gym.id);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function stopCheckinsRealtime() {
  if (_stopRealtime) { _stopRealtime(); _stopRealtime = null; }
}

let _stylesInjected = false;
export function injectCheckinsStyles() {
  if (_stylesInjected || document.getElementById('checkins-styles')) return;
  _stylesInjected = true;
  const style = document.createElement('style');
  style.id = 'checkins-styles';
  style.textContent = `
    .ci-tabbar { display:flex; gap:6px; margin-bottom:16px; border-bottom:1px solid var(--border-subtle); }
    .ci-tab { padding:10px 4px; background:none; border:none; border-bottom:2px solid transparent; color:var(--text-tertiary); font-size:13px; font-weight:600; cursor:pointer; margin-right:18px; }
    .ci-tab.active { color:var(--brand-text); border-bottom-color:var(--brand-text); }
    .ci-filters { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
    .ci-filters input[type="search"] { flex:1; min-width:180px; }
    .ci-filters input[type="date"] { max-width:150px; }
    .ci-table-scroll { overflow-x:auto; }
    .ci-empty { text-align:center; color:var(--text-tertiary); padding:40px 20px; font-size:13px; }
    .ci-followup-note { font-size:12px; color:var(--text-tertiary); margin-bottom:12px; }
    .ci-followup-list { display:flex; flex-direction:column; gap:8px; }
    .ci-followup-row { display:flex; align-items:center; gap:12px; background:var(--surface-1); border:1px solid var(--border-subtle); border-radius:10px; padding:12px 14px; }
  `;
  document.head.appendChild(style);
}
