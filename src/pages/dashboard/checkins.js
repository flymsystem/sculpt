// src/pages/dashboard/checkins.js — Check-ins section: attendance log
// (View A) and the not-seen-recently follow-up list (View B). Both
// views carry equal weight per the brief — the follow-up list is a
// tab alongside the log, not buried behind it.
//
// The log shows MEMBERS AND STAFF in one stream (2026-09-22). They
// live in two different tables with two different shapes —
// member_checkins has one timestamptz row per scan, staff_attendance
// has one row per staff member per DAY with `time` columns for in and
// out — so mergeRows() below normalises both into a common shape and
// sorts on a single derived timestamp. Before this, a staff scan
// landed only in Staff -> Daily Attendance and the owner reasonably
// assumed the desk QR had not worked.
//
// Only staff rows that carry a check_in time appear here. A row with
// status 'Present' and no time is the owner having marked someone by
// hand in the Daily Attendance grid — a roster fact, not a check-in,
// and putting it in a log of scans would misreport who was actually
// at the desk.
import { S, DEFAULT_FOLLOWUP_WA_TEMPLATE } from './state.js';
import { escHtml, fmtDate, todayLocalISO } from './helpers.js';
import { getAttendanceLog, subscribeAttendanceLog, getCheckinFollowup, manualCheckin } from '../../lib/checkin.js';
import { getAttendanceRange } from '../../lib/staff.js';
import { showToast } from '../../components/toast.js';

let _stopRealtime = null;
let _activeView = 'log';
let _who = 'all';  // all | members | staff — Attendance Log audience filter

export function renderCheckins(container) {
  window.__sculptRegisterCleanup?.(stopCheckinsRealtime);
  injectCheckinsStyles();
  _activeView = 'log';
  _who = 'all';

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
    <div class="ci-who" role="group" aria-label="Show">
      <button type="button" class="ci-who-btn active" data-who="all" aria-pressed="true">Everyone</button>
      <button type="button" class="ci-who-btn" data-who="members" aria-pressed="false">Members</button>
      <button type="button" class="ci-who-btn" data-who="staff" aria-pressed="false">Staff</button>
    </div>
    <div id="ci-log-table"><div class="loading-inline"><div class="spinner"></div></div></div>`;

  const load = () => loadLogTable();
  wrap.querySelectorAll('[data-who]').forEach((btn) => {
    btn.addEventListener('click', () => {
      _who = btn.dataset.who;
      wrap.querySelectorAll('[data-who]').forEach(b => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      load();
    });
  });
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
    // Both fetches are bounded by their own libs and both are filtered
    // by the same date range, so "Everyone" costs one extra query on a
    // table holding at most (staff x days) rows.
    const wantMembers = _who !== 'staff';
    const wantStaff = _who !== 'members';

    const [memberRows, staffRows] = await Promise.all([
      wantMembers
        ? getAttendanceLog(S.gym.id, {
            search,
            startDate: start ? `${start}T00:00:00` : undefined,
            endDate: end ? `${end}T23:59:59` : undefined,
          })
        : Promise.resolve([]),
      // Staff attendance is keyed by a plain `date` column, which is
      // exactly what the two date inputs already hold — no T00:00:00
      // padding. A failure here must not take the member log down with
      // it: this page's first job is still the member log.
      wantStaff && start && end
        ? getAttendanceRange(S.gym.id, start, end).catch(() => [])
        : Promise.resolve([]),
    ]);

    const rows = mergeRows(memberRows, staffRows, search);

    if (!rows.length) {
      tableWrap.innerHTML = `<div class="ci-empty">No check-ins in this range.</div>`;
      return;
    }

    tableWrap.innerHTML = `
      <div class="ci-table-scroll">
        <table class="members-table" role="table">
          <thead><tr>
            <th scope="col">Name</th>
            <th scope="col">Time</th>
            <th scope="col">Status</th>
            <th scope="col" class="hide-mobile">Source</th>
          </tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
                <td>
                  <div class="ci-name-line">
                    <span style="font-weight:500;color:var(--text-primary);font-size:13px;">${escHtml(r.name)}</span>
                    <span class="ci-kind ci-kind-${r.kind}">${r.kind === 'staff' ? 'Staff' : 'Member'}</span>
                  </div>
                  <div style="font-size:11px;color:var(--text-tertiary);">${escHtml(r.sub || '')}</div>
                </td>
                <td style="font-size:12px;color:var(--text-tertiary);font-variant-numeric:tabular-nums;">${escHtml(r.when)}</td>
                <td><span class="badge ${r.badge}">${escHtml(r.label)}</span></td>
                <td class="hide-mobile" style="font-size:12px;color:var(--text-tertiary);text-transform:capitalize;">${escHtml(r.source)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    tableWrap.innerHTML = `<div class="ci-empty">Could not load the attendance log. ${escHtml(err.message || '')}</div>`;
  }
}

const MEMBER_STATUS_LABEL = {
  ok: 'Checked In',
  denied_expired: 'Denied — Expired',
  denied_cancelled: 'Denied — Cancelled',
  denied_inactive: 'Denied — Inactive',
};

function clockOf(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  if (!m) return '';
  let h = Number(m[1]);
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m[2]} ${suffix}`;
}

// Normalise two very different row shapes into one sortable list.
// `sortAt` is a real timestamp for members and a synthesised one for
// staff (their `date` plus their `check_in` time) — without that
// synthesis a staff row would sort to midnight and every staff
// check-in would clump at the bottom of its day regardless of when it
// actually happened.
function mergeRows(memberRows, staffRows, search) {
  const out = [];

  for (const r of memberRows) {
    const ok = r.status === 'ok';
    out.push({
      kind: 'member',
      name: r.members?.full_name || 'Unknown',
      sub: r.members?.phone || '',
      sortAt: new Date(r.checked_in_at).getTime(),
      when: `${fmtDate(r.checked_in_at)} · ${new Date(r.checked_in_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`,
      label: MEMBER_STATUS_LABEL[r.status] || r.status,
      badge: ok ? 'badge-green' : 'badge-red',
      source: r.source || '',
    });
  }

  for (const r of staffRows) {
    // No check_in time = marked by hand in the Daily Attendance grid,
    // not a scan. See the note at the top of this file.
    if (!r.check_in) continue;
    const inAt = clockOf(r.check_in);
    const outAt = clockOf(r.check_out);
    out.push({
      kind: 'staff',
      name: r.staff?.full_name || 'Unknown',
      sub: r.staff?.role || '',
      sortAt: new Date(`${r.date}T${String(r.check_in).slice(0, 8)}`).getTime(),
      when: `${fmtDate(r.date)} · ${inAt}${outAt ? ` \u2192 ${outAt}` : ''}`,
      label: r.status === 'Present' ? (outAt ? 'In & Out' : 'Checked In') : (r.status || 'Checked In'),
      badge: r.status === 'Present' ? 'badge-green' : 'badge-amber',
      source: 'desk qr',
    });
  }

  // getAttendanceLog() filters member rows by name itself; staff rows
  // have to be filtered here or a search would return every staff row
  // alongside the matching members.
  const q = (search || '').trim().toLowerCase();
  const filtered = q ? out.filter(r => r.name.toLowerCase().includes(q)) : out;

  return filtered.sort((a, b) => b.sortAt - a.sortAt);
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
    /* Audience filter — a segmented control, not a fourth tab: it
       narrows the log you are already looking at rather than switching
       to a different view. */
    .ci-who { display:inline-flex; gap:4px; padding:4px; margin-bottom:14px; background:var(--surface-1); border:1px solid var(--border-subtle); border-radius:var(--radius-md); }
    .ci-who-btn { min-height:34px; padding:0 14px; background:none; border:none; border-radius:var(--radius-sm); color:var(--text-tertiary); font-family:inherit; font-size:12.5px; font-weight:600; cursor:pointer; transition:color var(--duration-fast) var(--ease-out), background-color var(--duration-fast) var(--ease-out); }
    .ci-who-btn:hover { color:var(--text-secondary); }
    .ci-who-btn.active { color:var(--brand-text); background:var(--brand-fade); }
    .ci-name-line { display:flex; align-items:center; gap:7px; min-width:0; }
    .ci-kind { flex-shrink:0; font-size:9.5px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; padding:2px 6px; border-radius:var(--radius-pill); }
    .ci-kind-member { background:var(--surface-3); color:var(--text-tertiary); }
    .ci-kind-staff { background:var(--brand-fade); color:var(--brand-text); }
    /* .members-table carries min-width:620px (components.css) so the
       members list can keep six columns on a phone by scrolling. This
       log has three, and that min-width pushed Status — whether the
       scan was accepted, the whole point of the row — off the right
       edge behind a horizontal scrollbar. Let it fit instead, and let
       the time cell wrap rather than forcing the table wide. */
    @media (max-width:560px) {
      .ci-table-scroll .members-table { min-width:0; }
      .ci-table-scroll .members-table td:nth-child(2) { white-space:normal; }
      .ci-table-scroll .members-table th, .ci-table-scroll .members-table td { padding:11px 10px; }
    }
  `;
  document.head.appendChild(style);
}
