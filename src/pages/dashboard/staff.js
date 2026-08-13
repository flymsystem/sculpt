// src/pages/dashboard/staff.js — Staff management page
import { S } from './state.js';
import { escHtml, fmtDate, av2, bindDateInput, fmtDateInput, parseDateInput, renderError } from './helpers.js';
import { getStaff, addStaff, updateStaff, deleteStaff, getAttendance, upsertAttendance, getSalaryPayments, addSalaryPayment, deleteSalaryPayment, getAttendanceRange, getStaffMonthlyPaid } from '../../lib/staff.js';
import { showToast } from '../../components/toast.js';
import { openModal, closeModal, modalFooter, bindModalCancel } from '../../components/modal.js';
import { showConfirm } from '../../components/confirm.js';
import { showPrintPreview } from '../../components/print-preview.js';
import { pickPhoto } from '../../components/photo-picker.js';
import { openPhotoLightbox } from '../../components/photo-lightbox.js';
import { saveStaffPhoto, removeStaffPhoto } from './photo.js';
import { supabase } from '../../lib/supabase.js';
import { createStaffLogin } from '../../lib/auth.js';
import { hasAccess } from '../../lib/permissions.js';
import { hasFeature } from '../../lib/tiers.js';

let _nav;
export function setStaffNav(fn) { _nav = fn; }

const STAFF_ROLES = ['Trainer', 'Receptionist', 'Manager', 'Cleaner', 'Other'];

let _staffSearch = '';

// ── Staff sub-tabs ─────────────────────────────────────────────────
let _staffTab = 'roster';  // roster | attendance | salary | analytics

export async function renderStaff(c) {
  const gymId = S.gym?.id;

  // Load staff data. Used to swallow a failed fetch into an empty
  // array, indistinguishable on screen from a gym that genuinely has no
  // staff yet — and since the condition below only re-fetches when
  // S.staff is empty, a transient failure would stick at "0 staff" until
  // the next full dashboard reload.
  if (gymId && (!S.staff || S.staff.length === 0)) {
    try {
      S.staff = await getStaff(gymId);
    } catch (e) {
      console.warn('[Flym] Staff fetch:', e.message);
      renderError(c, { onRetry: () => renderStaff(c) });
      return;
    }
  }

  c.innerHTML = `<div class="content-inner page-enter">
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-title">Staff Management</div>
        <div class="page-sub">${(S.staff||[]).length} staff member${(S.staff||[]).length !== 1 ? 's' : ''}</div>
      </div>
      <button class="btn btn-primary" id="btn-add-staff" type="button">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
        Add Staff
      </button>
    </div>

    <div class="staff-tabs" style="display:flex;gap:4px;margin-bottom:20px;background:var(--surface-1);padding:4px;border-radius:var(--radius-md);border:1px solid var(--border-subtle);">
      <button class="staff-tab-btn ${_staffTab==='roster'?'active':''}" data-tab="roster" type="button">Staff Roster</button>
      <button class="staff-tab-btn ${_staffTab==='attendance'?'active':''}" data-tab="attendance" type="button">Daily Attendance</button>
      <button class="staff-tab-btn ${_staffTab==='salary'?'active':''}" data-tab="salary" type="button">Salary</button>
      <button class="staff-tab-btn ${_staffTab==='analytics'?'active':''}" data-tab="analytics" type="button">Analytics</button>
    </div>

    <div id="staff-content"></div>
  </div>`;

  _injectStaffStyles();

  document.getElementById('btn-add-staff')?.addEventListener('click', () => openAddStaffModal());
  document.querySelectorAll('.staff-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _staffTab = btn.dataset.tab;
      document.querySelectorAll('.staff-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === _staffTab));
      renderStaffTab();
    });
  });

  renderStaffTab();
}

function renderStaffTab() {
  const sc = document.getElementById('staff-content');
  if (!sc) return;
  ({
    roster: renderRoster,
    attendance: renderAttendance,
    salary: renderSalary,
    analytics: renderAnalytics,
  }[_staffTab] || renderRoster)(sc);
}

// ═══════════════════════════════════════════════════════════════════
// ROSTER TAB
// ═══════════════════════════════════════════════════════════════════
function renderRoster(c) {
  const staff = S.staff || [];
  if (!staff.length) {
    c.innerHTML = `<div class="empty-state" style="padding:48px 20px;text-align:center;">
      <div style="font-size:48px;margin-bottom:16px;">\uD83D\uDC65</div>
      <div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">No staff added yet</div>
      <div style="font-size:13px;color:var(--text-tertiary);">Add your trainers, receptionists and other staff to manage attendance and salary.</div>
    </div>`;
    return;
  }

  const q = (_staffSearch || '').toLowerCase();
  const filtered = q ? staff.filter(s =>
    (s.full_name || '').toLowerCase().includes(q) ||
    (s.phone || '').includes(q) ||
    (s.role || '').toLowerCase().includes(q)
  ) : staff;

  c.innerHTML = `
    <div style="margin-bottom:14px;">
      <input class="form-input" id="staff-search-input" type="text" placeholder="Search staff by name, phone, or role..."
        style="width:100%;max-width:400px;" value="${escHtml(_staffSearch)}">
    </div>
    <div class="members-table-wrap">
      <div class="members-table-scroll">
        <table class="members-table" role="table">
          <thead><tr>
            <th>Name</th>
            <th>Role</th>
            <th class="hide-mobile">Phone</th>
            <th class="hide-mobile">Aadhaar</th>
            <th class="hide-mobile">Salary</th>
            <th class="hide-mobile">Joined</th>
            <th style="text-align:right;">Actions</th>
          </tr></thead>
          <tbody id="staff-tbody">${filtered.map(s => staffRow(s)).join('')}</tbody>
        </table>
      </div>
      ${q && !filtered.length ? '<div style="padding:24px;text-align:center;color:var(--text-tertiary);font-size:13px;">No staff match your search.</div>' : ''}
    </div>`;

  // Bind search
  const searchEl = document.getElementById('staff-search-input');
  let _debounce;
  searchEl?.addEventListener('input', () => {
    clearTimeout(_debounce);
    _debounce = setTimeout(() => { _staffSearch = searchEl.value; renderRoster(c); }, 250);
  });

  document.getElementById('staff-tbody')?.addEventListener('click', async (e) => {
    const loginBtn = e.target.closest('[data-staff-login]');
    const editBtn = e.target.closest('[data-staff-edit]');
    const delBtn = e.target.closest('[data-staff-del]');
    const photoBtn = e.target.closest('[data-staff-photo]');
    const uploadBtn = e.target.closest('[data-staff-upload]');
    if (loginBtn) { e.stopPropagation(); openCreateLoginModal(loginBtn.dataset.staffLogin); return; }
    if (editBtn) { e.stopPropagation(); openEditStaffModal(editBtn.dataset.staffEdit); return; }
    if (delBtn) { e.stopPropagation(); confirmDeleteStaff(delBtn.dataset.staffDel); return; }
    if (photoBtn) { e.stopPropagation(); openPhotoLightbox(photoBtn.dataset.staffPhoto); return; }
    if (uploadBtn) {
      e.stopPropagation();
      const staffId = uploadBtn.dataset.staffUpload;
      try {
        const result = await pickPhoto();
        if (!result) return;
        showToast('Uploading photo\u2026', 'blue');
        const photoUrl = await saveStaffPhoto(result.dataUrl, S.gym.id, staffId);
        const idx = (S.staff || []).findIndex(x => String(x.id) === String(staffId));
        if (idx > -1) S.staff[idx].photo_url = photoUrl;
        renderStaffTab();
        showToast('Photo updated!', 'green');
      } catch(err) { showToast(err.message || 'Upload failed', 'red'); }
      return;
    }
  });
}

function staffRow(s) {
  const roleBadge = {
    Trainer: 'badge-blue', Receptionist: 'badge-green',
    Manager: 'badge-amber', Cleaner: 'badge-muted', Other: 'badge-muted'
  }[s.role] || 'badge-muted';

  const aadhaarRaw = s.aadhaar || '';
  const aadhaarDisplay = aadhaarRaw.length >= 4
    ? 'XXXX XXXX ' + escHtml(aadhaarRaw.slice(-4))
    : '\u2014';

  const isOwner = (S.role || 'owner') === 'owner';
  const isPro = hasFeature(S.tier || 'core', 'staff_login');
  const loginBadge = s.login_enabled
    ? `<span class="badge badge-green" style="font-size:9px;margin-left:6px;">Login</span>`
    : '';
  const loginBtn = isOwner && isPro && !s.login_enabled
    ? `<button class="btn btn-sm" data-staff-login="${escHtml(String(s.id))}" title="Create Login" style="background:var(--brand-fade);color:var(--brand-text);border:1px solid var(--brand-fade-strong);padding:5px 8px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg></button>`
    : '';

  return `<tr>
    <td>
      <div style="display:flex;align-items:center;gap:10px;">
        ${s.photo_url
          ? `<div class="member-avatar" style="overflow:hidden;padding:0;cursor:pointer;" data-staff-photo="${escHtml(s.photo_url)}"><img src="${escHtml(s.photo_url)}" style="width:100%;height:100%;object-fit:cover;"></div>`
          : `<div class="member-avatar">${av2(s.full_name)}</div>`}
        <div style="font-weight:500;color:var(--text-primary);font-size:14px;">${escHtml(s.full_name)}${loginBadge}</div>
      </div>
    </td>
    <td><span class="badge ${roleBadge}">${escHtml(s.role)}</span></td>
    <td class="hide-mobile" style="font-size:13px;color:var(--text-tertiary);">${escHtml(s.phone || '\u2014')}</td>
    <td class="hide-mobile" style="font-size:12px;color:var(--text-tertiary);font-family:monospace;">${aadhaarDisplay}</td>
    <td class="hide-mobile" style="font-size:13px;font-weight:500;color:var(--text-primary);">\u20B9${Number(s.salary_amount || 0).toLocaleString('en-IN')}</td>
    <td class="hide-mobile" style="font-size:12px;color:var(--text-tertiary);">${fmtDate(s.join_date)}</td>
    <td>
      <div class="action-btns" style="gap:4px;justify-content:flex-end;">
        ${loginBtn}
        ${isOwner ? `<button class="btn btn-sm btn-ghost" data-staff-upload="${escHtml(String(s.id))}" title="Upload Photo"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></button>` : ''}
        ${isOwner ? `<button class="btn btn-sm btn-ghost" data-staff-edit="${escHtml(String(s.id))}" title="Edit"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>` : ''}
        ${isOwner ? `<button class="btn btn-sm" data-staff-del="${escHtml(String(s.id))}" style="background:var(--red-fade);color:var(--red);border:1px solid var(--red-strong);padding:5px 8px;" title="Remove"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>` : ''}
      </div>
    </td>
  </tr>`;
}

// ═══════════════════════════════════════════════════════════════════
// ATTENDANCE TAB
// ═══════════════════════════════════════════════════════════════════
async function renderAttendance(c) {
  const gymId = S.gym?.id;
  const today = new Date().toISOString().split('T')[0];
  const staff = S.staff || [];

  c.innerHTML = `<div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
      <label style="font-size:13px;font-weight:500;color:var(--text-secondary);">Date:</label>
      <input type="date" class="form-input" id="att-date" value="${today}" style="width:auto;max-width:180px;flex-shrink:0;">
      <button class="btn btn-ghost btn-sm" id="att-today" type="button" style="flex-shrink:0;">Today</button>
      <div style="flex:1;min-width:8px;"></div>
      <button class="btn btn-primary btn-sm" id="att-save-all" type="button" style="flex-shrink:0;">Save Attendance</button>
    </div>
    <div id="att-grid">${staff.length ? '<div style="color:var(--text-tertiary);font-size:13px;">Loading attendance...</div>' : '<div style="color:var(--text-tertiary);font-size:13px;">No staff to show attendance for.</div>'}</div>
  </div>`;

  const dateEl = document.getElementById('att-date');
  const loadAttendance = async () => {
    const date = dateEl?.value || today;
    if (!gymId || !staff.length) return;
    try {
      const records = await getAttendance(gymId, date);
      renderAttendanceGrid(records, staff, date);
    } catch(e) { console.error('[Staff] Attendance load:', e); }
  };

  dateEl?.addEventListener('change', loadAttendance);
  document.getElementById('att-today')?.addEventListener('click', () => {
    if (dateEl) { dateEl.value = today; loadAttendance(); }
  });
  document.getElementById('att-save-all')?.addEventListener('click', () => saveAllAttendance(dateEl?.value || today));

  if (staff.length) loadAttendance();
}

function renderAttendanceGrid(records, staff, _date) {
  const grid = document.getElementById('att-grid');
  if (!grid) return;

  const recordMap = {};
  records.forEach(r => { recordMap[r.staff_id] = r; });

  const isMobile = window.innerWidth <= 768;
  grid.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;">
    ${staff.map(s => {
      const r = recordMap[s.id] || {};
      const status = r.status || '';
      const statusColor = status === 'Present' ? 'var(--green)' : status === 'Absent' ? 'var(--red)' : status === 'Half-day' ? 'var(--amber)' : status === 'Leave' ? 'var(--purple)' : 'var(--text-quaternary)';
      if (isMobile) {
        return `<div class="att-row settings-card" data-staff-id="${escHtml(String(s.id))}" style="padding:14px;margin-bottom:0;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
            <div class="member-avatar" style="width:36px;height:36px;font-size:12px;flex-shrink:0;">${av2(s.full_name)}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:500;font-size:14px;color:var(--text-primary);">${escHtml(s.full_name)}</div>
              <div style="font-size:11px;color:var(--text-tertiary);">${escHtml(s.role)}</div>
            </div>
            <div style="width:8px;height:8px;border-radius:50%;background:${statusColor};flex-shrink:0;"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr;gap:8px;">
            <select class="form-input att-status" style="width:100%;padding:10px 12px;font-size:14px;">
              <option value="" ${!status ? 'selected' : ''}>Not marked</option>
              <option value="Present" ${status==='Present' ? 'selected' : ''}>✅ Present</option>
              <option value="Absent" ${status==='Absent' ? 'selected' : ''}>❌ Absent</option>
              <option value="Half-day" ${status==='Half-day' ? 'selected' : ''}>🌗 Half-day</option>
              <option value="Leave" ${status==='Leave' ? 'selected' : ''}>🏖️ Leave</option>
            </select>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div>
                <div style="font-size:10px;color:var(--text-quaternary);margin-bottom:4px;font-weight:500;">Check In</div>
                <input type="time" class="form-input att-checkin" value="${escHtml(r.check_in || '')}" style="width:100%;padding:10px 12px;font-size:14px;" placeholder="In" title="Check-in time">
              </div>
              <div>
                <div style="font-size:10px;color:var(--text-quaternary);margin-bottom:4px;font-weight:500;">Check Out</div>
                <input type="time" class="form-input att-checkout" value="${escHtml(r.check_out || '')}" style="width:100%;padding:10px 12px;font-size:14px;" placeholder="Out" title="Check-out time">
              </div>
            </div>
          </div>
        </div>`;
      }
      return `<div class="att-row settings-card" data-staff-id="${escHtml(String(s.id))}" style="display:flex;align-items:center;gap:12px;padding:12px 16px;margin-bottom:0;">
        <div class="member-avatar" style="width:36px;height:36px;font-size:12px;flex-shrink:0;">${av2(s.full_name)}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:500;font-size:14px;color:var(--text-primary);">${escHtml(s.full_name)}</div>
          <div style="font-size:11px;color:var(--text-tertiary);">${escHtml(s.role)}</div>
        </div>
        <select class="form-input att-status" style="width:auto;min-width:100px;padding:6px 10px;font-size:12px;">
          <option value="" ${!status ? 'selected' : ''}>Not marked</option>
          <option value="Present" ${status==='Present' ? 'selected' : ''}>Present</option>
          <option value="Absent" ${status==='Absent' ? 'selected' : ''}>Absent</option>
          <option value="Half-day" ${status==='Half-day' ? 'selected' : ''}>Half-day</option>
          <option value="Leave" ${status==='Leave' ? 'selected' : ''}>Leave</option>
        </select>
        <input type="time" class="form-input att-checkin" value="${escHtml(r.check_in || '')}" style="width:auto;max-width:110px;padding:6px 8px;font-size:12px;" placeholder="In" title="Check-in time">
        <input type="time" class="form-input att-checkout" value="${escHtml(r.check_out || '')}" style="width:auto;max-width:110px;padding:6px 8px;font-size:12px;" placeholder="Out" title="Check-out time">
      </div>`;
    }).join('')}
  </div>`;
}

async function saveAllAttendance(date) {
  const gymId = S.gym?.id;
  if (!gymId) return;
  const rows = document.querySelectorAll('.att-row');
  const btn = document.getElementById('att-save-all');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  let saved = 0;
  for (const row of rows) {
    const staffId = row.dataset.staffId;
    const status = row.querySelector('.att-status')?.value;
    if (!status) continue; // skip unmarked
    const checkIn = row.querySelector('.att-checkin')?.value || null;
    const checkOut = row.querySelector('.att-checkout')?.value || null;
    try {
      await upsertAttendance(gymId, staffId, date, status, checkIn, checkOut);
      saved++;
    } catch(e) { console.error('[Staff] Save attendance:', e); }
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Save Attendance'; }
  showToast(`Attendance saved for ${saved} staff`, 'green');
}

// ═══════════════════════════════════════════════════════════════════
// SALARY TAB
// ═══════════════════════════════════════════════════════════════════
async function renderSalary(c) {
  const gymId = S.gym?.id;
  const staff = S.staff || [];
  const curMonth = new Date().toISOString().slice(0, 7);

  c.innerHTML = `<div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
      <label style="font-size:13px;font-weight:500;color:var(--text-secondary);">Month:</label>
      <input type="month" class="form-input" id="sal-month" value="${curMonth}" style="width:auto;max-width:180px;">
      <div style="flex:1;"></div>
      <button class="btn btn-primary btn-sm" id="btn-pay-salary" type="button">Pay Salary</button>
    </div>
    <div id="sal-grid" style="display:flex;flex-direction:column;gap:8px;">
      <div style="color:var(--text-tertiary);font-size:13px;">Loading salary data...</div>
    </div>
    <div style="margin-top:24px;">
      <div style="font-weight:600;font-size:var(--text-md);color:var(--text-primary);margin-bottom:12px;">Payment History</div>
      <div id="sal-history"></div>
    </div>
  </div>`;

  document.getElementById('btn-pay-salary')?.addEventListener('click', () => openPaySalaryModal());
  document.getElementById('sal-month')?.addEventListener('change', loadSalaryData);

  async function loadSalaryData() {
    const month = document.getElementById('sal-month')?.value || curMonth;
    const grid = document.getElementById('sal-grid');
    const histEl = document.getElementById('sal-history');
    if (!gymId || !staff.length) {
      if (grid) grid.innerHTML = `<div style="color:var(--text-tertiary);font-size:13px;">No staff added yet.</div>`;
      return;
    }

    // Get per-staff payment summary for selected month
    const summaries = await Promise.all(staff.map(async s => {
      const { paid, advance } = await getStaffMonthlyPaid(gymId, s.id, month);
      return { ...s, paid, advance, balance: Math.max(0, (s.salary_amount || 0) - paid - advance) };
    }));

    if (grid) {
      grid.innerHTML = summaries.map(s => {
        const pct = s.salary_amount > 0 ? Math.min(100, Math.round(((s.paid + s.advance) / s.salary_amount) * 100)) : 0;
        const statusColor = s.balance <= 0 ? 'var(--green)' : s.paid + s.advance > 0 ? 'var(--amber)' : 'var(--text-tertiary)';
        const statusLabel = s.balance <= 0 ? 'Paid' : s.paid + s.advance > 0 ? 'Partial' : 'Unpaid';
        return `<div class="settings-card" style="padding:14px 18px;margin-bottom:0;">
          <div style="display:flex;align-items:center;gap:12px;">
            <div class="member-avatar" style="width:36px;height:36px;font-size:12px;flex-shrink:0;">${av2(s.full_name)}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:500;font-size:14px;color:var(--text-primary);">${escHtml(s.full_name)}</div>
              <div style="font-size:11px;color:var(--text-tertiary);">${escHtml(s.role)} \u00B7 Salary: \u20B9${Number(s.salary_amount || 0).toLocaleString('en-IN')}</div>
            </div>
            <div style="text-align:right;">
              <span style="font-size:12px;font-weight:600;color:${statusColor};">${statusLabel}</span>
              <div style="font-size:11px;color:var(--text-tertiary);">\u20B9${Number(s.paid + s.advance).toLocaleString('en-IN')} / \u20B9${Number(s.salary_amount || 0).toLocaleString('en-IN')}</div>
            </div>
          </div>
          <div style="margin-top:8px;height:4px;background:var(--surface-2);border-radius:2px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${statusColor};border-radius:2px;transition:width 0.3s;"></div>
          </div>
          ${s.advance > 0 ? `<div style="font-size:11px;color:var(--amber);margin-top:4px;">Advance: \u20B9${Number(s.advance).toLocaleString('en-IN')}</div>` : ''}
        </div>`;
      }).join('');
    }

    // Payment history
    try {
      const payments = await getSalaryPayments(gymId);
      if (histEl) {
        if (!payments.length) {
          histEl.innerHTML = `<div style="color:var(--text-tertiary);font-size:13px;padding:20px 0;">No salary payments yet.</div>`;
        } else {
          histEl.innerHTML = `<div class="members-table-wrap"><div class="members-table-scroll">
            <table class="members-table"><thead><tr>
              <th>Staff</th><th>Amount</th><th class="hide-mobile">Mode</th><th class="hide-mobile">Type</th><th>Date</th><th style="text-align:right;">Actions</th>
            </tr></thead><tbody>
            ${payments.slice(0, 50).map(p => `<tr>
              <td style="font-weight:500;font-size:13px;">${escHtml(p.staff?.full_name || '\u2014')}</td>
              <td style="font-weight:600;color:var(--text-primary);">\u20B9${Number(p.amount).toLocaleString('en-IN')}</td>
              <td class="hide-mobile"><span class="badge ${p.payment_mode==='Cash'?'badge-amber':p.payment_mode==='Card'?'badge-purple':'badge-blue'}">${escHtml(p.payment_mode)}</span></td>
              <td class="hide-mobile">${p.is_advance ? '<span class="badge badge-amber">Advance</span>' : '<span class="badge badge-green">Salary</span>'}</td>
              <td style="font-size:12px;color:var(--text-tertiary);">${fmtDate(p.payment_date)}</td>
              <td style="text-align:right;">
                <div style="display:flex;gap:4px;justify-content:flex-end;">
                  <button class="btn btn-sm btn-ghost" data-sal-invoice="${escHtml(String(p.id))}" title="Invoice"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></button>
                  <button class="btn btn-sm" data-sal-wa="${escHtml(String(p.id))}" style="background:var(--green-fade);color:var(--green);border:1px solid var(--green-strong);padding:5px 8px;" title="WhatsApp"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></button>
                  <button class="btn btn-sm" data-sal-del="${escHtml(String(p.id))}" style="background:var(--red-fade);color:var(--red);border:1px solid var(--red-strong);padding:5px 8px;" title="Delete"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg></button>
                </div>
              </td>
            </tr>`).join('')}
            </tbody></table>
          </div></div>`;

          // Bind history actions
          histEl.addEventListener('click', async (e) => {
            const invoiceBtn = e.target.closest('[data-sal-invoice]');
            const waBtn = e.target.closest('[data-sal-wa]');
            const delBtn = e.target.closest('[data-sal-del]');
            if (invoiceBtn) { showSalaryInvoice(invoiceBtn.dataset.salInvoice, payments); return; }
            if (waBtn) { sendSalaryWhatsApp(waBtn.dataset.salWa, payments); return; }
            if (delBtn) { await confirmDeletePayment(delBtn.dataset.salDel); return; }
          });
        }
      }
    } catch(e) { console.error('[Staff] History load:', e); }
  }

  loadSalaryData();
}

// ═══════════════════════════════════════════════════════════════════
// ANALYTICS TAB
// ═══════════════════════════════════════════════════════════════════
async function renderAnalytics(c) {
  const gymId = S.gym?.id;
  const staff = S.staff || [];
  if (!gymId || !staff.length) {
    c.innerHTML = `<div style="color:var(--text-tertiary);font-size:13px;padding:20px 0;">Add staff members to see analytics.</div>`;
    return;
  }

  // Get last 30 days attendance
  const today = new Date();
  const thirtyAgo = new Date(today); thirtyAgo.setDate(thirtyAgo.getDate() - 30);
  const endDate = today.toISOString().split('T')[0];
  const startDate = thirtyAgo.toISOString().split('T')[0];

  let records = [];
  try { records = await getAttendanceRange(gymId, startDate, endDate); } catch(e) {}

  // Build per-staff stats
  const statsMap = {};
  staff.forEach(s => { statsMap[s.id] = { name: s.full_name, role: s.role, present: 0, absent: 0, halfday: 0, leave: 0, total: 0 }; });
  records.forEach(r => {
    if (!statsMap[r.staff_id]) return;
    statsMap[r.staff_id].total++;
    if (r.status === 'Present') statsMap[r.staff_id].present++;
    else if (r.status === 'Absent') statsMap[r.staff_id].absent++;
    else if (r.status === 'Half-day') statsMap[r.staff_id].halfday++;
    else if (r.status === 'Leave') statsMap[r.staff_id].leave++;
  });

  const statsList = Object.values(statsMap);
  const maxDays = 30;

  c.innerHTML = `<div>
    <div style="font-size:13px;color:var(--text-tertiary);margin-bottom:16px;">Last 30 days attendance summary</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:12px;">
      ${statsList.map(s => {
        const pct = maxDays > 0 ? Math.round((s.present / maxDays) * 100) : 0;
        const barColor = pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)';
        return `<div class="settings-card" style="padding:16px 18px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div>
              <div style="font-weight:600;font-size:14px;color:var(--text-primary);">${escHtml(s.name)}</div>
              <div style="font-size:11px;color:var(--text-tertiary);">${escHtml(s.role)}</div>
            </div>
            <div style="font-size:20px;font-weight:700;color:${barColor};">${pct}%</div>
          </div>
          <div style="height:6px;background:var(--surface-2);border-radius:3px;overflow:hidden;margin-bottom:10px;">
            <div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;transition:width 0.3s;"></div>
          </div>
          <div style="display:flex;gap:12px;font-size:11px;color:var(--text-tertiary);">
            <span style="color:var(--green);">Present: ${s.present}</span>
            <span style="color:var(--red);">Absent: ${s.absent}</span>
            <span style="color:var(--amber);">Half: ${s.halfday}</span>
            <span>Leave: ${s.leave}</span>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════════════════════════
function openAddStaffModal() {
  const roleOpts = STAFF_ROLES.map(r => `<option value="${r}">${r}</option>`).join('');
  openModal({
    title: 'Add Staff Member',
    size: 'md',
    mobileCompact: true,
    body: `
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
        <div id="stf-photo-preview" style="width:60px;height:60px;border-radius:50%;background:var(--surface-3);
             display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;
             border:2px dashed var(--border-default);flex-shrink:0;">
          <span style="font-size:10px;color:var(--text-tertiary);text-align:center;line-height:1.2;">Add<br>Photo</span>
        </div>
        <div style="font-size:12px;color:var(--text-quaternary);">Tap to upload photo (optional)</div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Full Name *</label>
          <input class="form-input" id="stf-name" placeholder="e.g. Ravi Kumar"></div>
        <div class="form-group"><label class="form-label">Role *</label>
          <select class="form-input" id="stf-role" style="color:var(--white);">${roleOpts}</select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Phone</label>
          <div style="display:flex;align-items:center;gap:0;">
            <span style="background:var(--panel2);border:1px solid var(--border);border-right:none;
              padding:0 12px;height:42px;display:flex;align-items:center;font-size:13px;
              color:var(--muted);border-radius:var(--radius-sm) 0 0 var(--radius-sm);
              white-space:nowrap;flex-shrink:0;">+91</span>
            <input class="form-input" id="stf-phone" placeholder="9876543210" maxlength="10"
              oninput="this.value=this.value.replace(/\\D/g,'').slice(0,10);"
              style="border-radius:0 var(--radius-sm) var(--radius-sm) 0;border-left:none;">
          </div></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Aadhaar Number <span style="color:var(--muted);font-weight:400;font-size:11px;">(optional)</span></label>
          <input class="form-input" id="stf-aadhaar" placeholder="1234 5678 9012" maxlength="14"
            oninput="this.value=this.value.replace(/[^\\d]/g,'').replace(/(\\d{4})(?=\\d)/g,'$1 ').slice(0,14);"></div>
        <div class="form-group"><label class="form-label">Monthly Salary (\u20B9)</label>
          <input class="form-input" id="stf-salary" type="number" min="0" placeholder="0"></div>
      </div>
      <div class="form-group"><label class="form-label">Join Date</label>
        <input class="form-input date-input" id="stf-join" placeholder="DD/MM/YYYY" maxlength="10" autocomplete="off" data-today="true"></div>
      <div class="form-group"><label class="form-label">Notes</label>
        <input class="form-input" id="stf-notes" placeholder="Any notes..."></div>
      <div id="stf-error" style="display:none;color:var(--red);font-size:13px;background:var(--red-fade);border:1px solid var(--red-strong);padding:10px 13px;border-radius:2px;margin-top:4px;"></div>
    `,
    footer: modalFooter('Cancel', 'Add Staff \u2192', 'btn-stf-submit'),
    onOpen: () => {
      document.querySelectorAll('.date-input').forEach(el => bindDateInput(el));
      bindModalCancel();

      // Photo picker
      let pendingPhotoDataUrl = null;
      document.getElementById('stf-photo-preview')?.addEventListener('click', async () => {
        const result = await pickPhoto();
        if (result) {
          pendingPhotoDataUrl = result.dataUrl;
          const preview = document.getElementById('stf-photo-preview');
          if (preview) {
            preview.style.border = 'none';
            preview.innerHTML = `<img src="${result.dataUrl}" alt="" style="width:100%;height:100%;object-fit:cover;">`;
          }
        }
      });

      document.getElementById('btn-stf-submit')?.addEventListener('click', async () => {
        const name = document.getElementById('stf-name')?.value.trim();
        const errEl = document.getElementById('stf-error');
        if (!name) { errEl.textContent = 'Name is required.'; errEl.style.display = 'block'; return; }
        const btn = document.getElementById('btn-stf-submit');
        btn.disabled = true; btn.textContent = 'Adding\u2026';
        try {
          const data = {
            fullName: name,
            phone: document.getElementById('stf-phone')?.value ? '+91' + document.getElementById('stf-phone').value.replace(/\D/g, '').slice(0, 10) : null,
            role: document.getElementById('stf-role')?.value || 'Trainer',
            aadhaar: document.getElementById('stf-aadhaar')?.value.replace(/\s/g, '') || null,
            salaryAmount: document.getElementById('stf-salary')?.value || 0,
            joinDate: parseDateInput(document.getElementById('stf-join')?.value) || new Date().toISOString().split('T')[0],
            notes: document.getElementById('stf-notes')?.value.trim() || null,
          };
          const saved = await addStaff(S.gym.id, data);

          // Save photo if selected
          if (pendingPhotoDataUrl && saved?.id && S.gym?.id) {
            btn.textContent = 'Saving photo\u2026';
            try {
              await saveStaffPhoto(pendingPhotoDataUrl, S.gym.id, saved.id);
            } catch(photoErr) {
              console.warn('[Flym] Staff photo upload failed:', photoErr.message);
              showToast('Staff saved but photo upload failed \u2014 try re-uploading from the roster', 'amber');
            }
          }

          S.staff = await getStaff(S.gym.id);
          closeModal();
          _nav('staff');
          showToast(`${name} added to staff!`, 'green');
        } catch(e) { errEl.textContent = e.message; errEl.style.display = 'block'; btn.disabled = false; btn.textContent = 'Add Staff \u2192'; }
      });
    }
  });
}

function openEditStaffModal(id) {
  const s = (S.staff || []).find(x => String(x.id) === String(id));
  if (!s) return;
  const roleOpts = STAFF_ROLES.map(r => `<option value="${r}" ${s.role === r ? 'selected' : ''}>${r}</option>`).join('');
  openModal({
    title: `Edit \u2014 ${escHtml(s.full_name)}`,
    size: 'md',
    mobileCompact: true,
    body: `
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
        <div id="estf-photo-preview" style="width:60px;height:60px;border-radius:50%;background:var(--surface-3);
             display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;
             border:${s.photo_url ? 'none' : '2px dashed var(--border-default)'};flex-shrink:0;">
          ${s.photo_url
            ? `<img src="${escHtml(s.photo_url)}" alt="" style="width:100%;height:100%;object-fit:cover;">`
            : `<span style="font-size:10px;color:var(--text-tertiary);text-align:center;line-height:1.2;">Add<br>Photo</span>`}
        </div>
        <div>
          <div style="font-size:12px;color:var(--text-quaternary);">Tap to change photo</div>
          ${s.photo_url ? `<button type="button" id="estf-photo-remove" style="background:none;border:none;color:var(--red);font-size:11px;cursor:pointer;padding:2px 0;margin-top:2px;">Remove photo</button>` : ''}
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Full Name *</label>
          <input class="form-input" id="estf-name" value="${escHtml(s.full_name)}"></div>
        <div class="form-group"><label class="form-label">Role *</label>
          <select class="form-input" id="estf-role" style="color:var(--white);">${roleOpts}</select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Phone</label>
          <div style="display:flex;align-items:center;gap:0;">
            <span style="background:var(--panel2);border:1px solid var(--border);border-right:none;
              padding:0 12px;height:42px;display:flex;align-items:center;font-size:13px;
              color:var(--muted);border-radius:var(--radius-sm) 0 0 var(--radius-sm);
              white-space:nowrap;flex-shrink:0;">+91</span>
            <input class="form-input" id="estf-phone" maxlength="10"
              oninput="this.value=this.value.replace(/\\D/g,'').slice(0,10);"
              style="border-radius:0 var(--radius-sm) var(--radius-sm) 0;border-left:none;"
              value="${escHtml((s.phone || '').replace(/^\+?91/, '').trim())}">
          </div></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Aadhaar Number</label>
          <input class="form-input" id="estf-aadhaar" value="${escHtml((s.aadhaar || '').replace(/(.{4})(?=.)/g, '$1 '))}" maxlength="14"
            oninput="this.value=this.value.replace(/[^\\d]/g,'').replace(/(\\d{4})(?=\\d)/g,'$1 ').slice(0,14);"></div>
        <div class="form-group"><label class="form-label">Monthly Salary (\u20B9)</label>
          <input class="form-input" id="estf-salary" type="number" min="0" value="${s.salary_amount || ''}"></div>
      </div>
      <div class="form-group"><label class="form-label">Join Date</label>
        <input class="form-input date-input" id="estf-join" placeholder="DD/MM/YYYY" maxlength="10" autocomplete="off" value="${s.join_date ? fmtDateInput(s.join_date) : ''}"></div>
      <div class="form-group"><label class="form-label">Notes</label>
        <input class="form-input" id="estf-notes" value="${escHtml(s.notes || '')}"></div>
      <div id="estf-error" style="display:none;color:var(--red);font-size:13px;background:var(--red-fade);border:1px solid var(--red-strong);padding:10px 13px;border-radius:2px;margin-top:4px;"></div>
    `,
    footer: modalFooter('Cancel', 'Save Changes \u2192', 'btn-estf-submit'),
    onOpen: () => {
      document.querySelectorAll('.date-input').forEach(el => bindDateInput(el));
      bindModalCancel();

      // Photo picker
      let pendingPhotoDataUrl = null;
      let removePhoto = false;
      document.getElementById('estf-photo-preview')?.addEventListener('click', async () => {
        const result = await pickPhoto();
        if (result) {
          pendingPhotoDataUrl = result.dataUrl;
          removePhoto = false;
          const preview = document.getElementById('estf-photo-preview');
          if (preview) {
            preview.style.border = 'none';
            preview.innerHTML = `<img src="${result.dataUrl}" alt="" style="width:100%;height:100%;object-fit:cover;">`;
          }
          // Show remove button if it was hidden
          const rmBtn = document.getElementById('estf-photo-remove');
          if (!rmBtn) {
            const wrapper = document.getElementById('estf-photo-preview')?.parentElement?.nextElementSibling;
            if (wrapper) {
              const newRm = document.createElement('button');
              newRm.type = 'button';
              newRm.id = 'estf-photo-remove';
              newRm.style.cssText = 'background:none;border:none;color:var(--red);font-size:11px;cursor:pointer;padding:2px 0;margin-top:2px;display:block;';
              newRm.textContent = 'Remove photo';
              newRm.addEventListener('click', handleRemove);
              wrapper.appendChild(newRm);
            }
          }
        }
      });

      function handleRemove() {
        removePhoto = true;
        pendingPhotoDataUrl = null;
        const preview = document.getElementById('estf-photo-preview');
        if (preview) {
          preview.style.border = '2px dashed var(--border-default)';
          preview.innerHTML = `<span style="font-size:10px;color:var(--text-tertiary);text-align:center;line-height:1.2;">Add<br>Photo</span>`;
        }
        document.getElementById('estf-photo-remove')?.remove();
      }

      document.getElementById('estf-photo-remove')?.addEventListener('click', handleRemove);

      document.getElementById('btn-estf-submit')?.addEventListener('click', async () => {
        const name = document.getElementById('estf-name')?.value.trim();
        const errEl = document.getElementById('estf-error');
        if (!name) { errEl.textContent = 'Name is required.'; errEl.style.display = 'block'; return; }
        const btn = document.getElementById('btn-estf-submit');
        btn.disabled = true; btn.textContent = 'Saving\u2026';
        try {
          await updateStaff(id, S.gym.id, {
            fullName: name,
            phone: document.getElementById('estf-phone')?.value ? '+91' + document.getElementById('estf-phone').value.replace(/\D/g, '').slice(0, 10) : null,
            role: document.getElementById('estf-role')?.value || 'Trainer',
            aadhaar: document.getElementById('estf-aadhaar')?.value.replace(/\s/g, '') || null,
            salaryAmount: document.getElementById('estf-salary')?.value || 0,
            joinDate: parseDateInput(document.getElementById('estf-join')?.value),
            notes: document.getElementById('estf-notes')?.value.trim() || null,
          });

          // Handle photo changes
          if (pendingPhotoDataUrl && S.gym?.id) {
            btn.textContent = 'Saving photo\u2026';
            try {
              await saveStaffPhoto(pendingPhotoDataUrl, S.gym.id, id);
            } catch(photoErr) {
              console.warn('[Flym] Staff photo upload failed:', photoErr.message);
              showToast('Staff saved but photo upload failed \u2014 try re-uploading', 'amber');
            }
          } else if (removePhoto && S.gym?.id) {
            btn.textContent = 'Removing photo\u2026';
            try {
              await removeStaffPhoto(S.gym.id, id);
            } catch(rmErr) {
              console.warn('[Flym] Staff photo remove failed:', rmErr.message);
            }
          }

          S.staff = await getStaff(S.gym.id);
          closeModal();
          _nav('staff');
          showToast('Staff updated!', 'green');
        } catch(e) { errEl.textContent = e.message; errEl.style.display = 'block'; btn.disabled = false; btn.textContent = 'Save Changes \u2192'; }
      });
    }
  });
}

async function confirmDeleteStaff(id) {
  const s = (S.staff || []).find(x => String(x.id) === String(id));
  if (!s) return;
  const ok = await showConfirm({
    title: 'Remove Staff?',
    message: `Remove ${s.full_name} from your staff? Their attendance and payment records are preserved.`,
    confirmLabel: 'Remove',
    confirmVariant: 'danger',
  });
  if (!ok) return;
  try {
    await deleteStaff(id, S.gym.id);
    S.staff = (S.staff || []).filter(x => String(x.id) !== String(id));
    _nav('staff');
    showToast('Staff removed', 'green');
  } catch(e) { showToast(e.message || 'Remove failed', 'red'); }
}

function openPaySalaryModal() {
  const staff = S.staff || [];
  if (!staff.length) { showToast('Add staff members first', 'amber'); return; }
  const staffOpts = staff.map(s => `<option value="${s.id}" data-name="${escHtml(s.full_name)}" data-salary="${s.salary_amount || 0}">${escHtml(s.full_name)} (\u20B9${Number(s.salary_amount || 0).toLocaleString('en-IN')})</option>`).join('');

  openModal({
    title: 'Pay Salary',
    size: 'md',
    body: `
      <div class="form-group"><label class="form-label">Staff Member *</label>
        <select class="form-input" id="pay-staff" style="color:var(--white);">${staffOpts}</select></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Amount (\u20B9) *</label>
          <input class="form-input" id="pay-amount" type="number" min="0" placeholder="Enter amount"></div>
        <div class="form-group"><label class="form-label">Extra Amount (\u20B9) <span style="color:var(--muted);font-weight:400;font-size:11px;">(bonus / incentive)</span></label>
          <input class="form-input" id="pay-extra" type="number" min="0" value="0" placeholder="0"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Payment Mode</label>
          <select class="form-input" id="pay-mode" style="color:var(--white);">
            <option value="Cash">Cash</option><option value="Online">Online</option><option value="Card">Card</option>
          </select></div>
        <div class="form-group"><label class="form-label">Payment Date</label>
          <input class="form-input date-input" id="pay-date" placeholder="DD/MM/YYYY" maxlength="10" autocomplete="off" data-today="true"></div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:10px 14px;background:var(--surface-2);border-radius:var(--radius-md);">
        <label class="flym-switch" style="margin:0;"><input type="checkbox" id="pay-advance"><span class="flym-switch-slider"></span></label>
        <div><span style="font-size:13px;color:var(--text-secondary);">This is an advance payment</span></div>
      </div>
      <div class="form-group"><label class="form-label">Remarks</label>
        <input class="form-input" id="pay-notes" placeholder="Optional remarks..."></div>
      <div id="pay-error" style="display:none;color:var(--red);font-size:13px;background:var(--red-fade);border:1px solid var(--red-strong);padding:10px 13px;border-radius:2px;"></div>
    `,
    footer: modalFooter('Cancel', 'Record Payment \u2192', 'btn-pay-submit'),
    onOpen: () => {
      document.querySelectorAll('.date-input').forEach(el => bindDateInput(el));
      // Auto-fill salary amount when staff selected
      document.getElementById('pay-staff')?.addEventListener('change', function() {
        const opt = this.options[this.selectedIndex];
        document.getElementById('pay-amount').value = opt?.dataset.salary || '';
      });
      // Pre-fill with first staff member's salary
      const firstOpt = document.getElementById('pay-staff')?.options[0];
      if (firstOpt) document.getElementById('pay-amount').value = firstOpt.dataset.salary || '';

      bindModalCancel();
      document.getElementById('btn-pay-submit')?.addEventListener('click', async () => {
        const errEl = document.getElementById('pay-error');
        const staffEl = document.getElementById('pay-staff');
        const staffId = staffEl?.value;
        const staffName = staffEl?.options[staffEl.selectedIndex]?.dataset.name || '';
        const amount = document.getElementById('pay-amount')?.value;
        if (!amount || parseFloat(amount) <= 0) { errEl.textContent = 'Enter an amount.'; errEl.style.display = 'block'; return; }

        const btn = document.getElementById('btn-pay-submit');
        btn.disabled = true; btn.textContent = 'Processing...';
        try {
          const extraAmt = parseFloat(document.getElementById('pay-extra')?.value) || 0;
          const totalPay = parseFloat(amount) + extraAmt;
          await addSalaryPayment(S.gym.id, {
            staffId,
            staffName,
            amount: totalPay,
            extraAmount: extraAmt,
            paymentDate: parseDateInput(document.getElementById('pay-date')?.value) || new Date().toISOString().split('T')[0],
            paymentMode: document.getElementById('pay-mode')?.value || 'Cash',
            isAdvance: document.getElementById('pay-advance')?.checked || false,
            notes: document.getElementById('pay-notes')?.value.trim() || null,
          });
          closeModal();
          _nav('staff');
          showToast(`\u20B9${Number(amount).toLocaleString('en-IN')} paid to ${staffName}`, 'green');
        } catch(e) { errEl.textContent = e.message; errEl.style.display = 'block'; btn.disabled = false; btn.textContent = 'Record Payment \u2192'; }
      });
    }
  });
}

async function confirmDeletePayment(paymentId) {
  const ok = await showConfirm({
    title: 'Delete Payment?',
    message: 'This will remove the payment record and its linked expense entry.',
    confirmLabel: 'Delete',
    confirmVariant: 'danger',
  });
  if (!ok) return;
  try {
    await deleteSalaryPayment(paymentId, S.gym.id);
    showToast('Payment deleted', 'green');
    _nav('staff');
  } catch(e) { showToast(e.message || 'Delete failed', 'red'); }
}

// ── Salary Invoice ───────────────────────────────────────────────
function showSalaryInvoice(paymentId, payments) {
  const p = payments.find(x => String(x.id) === String(paymentId));
  if (!p) return;
  const gymName = S.gym?.name || 'Gym';
  const staffName = p.staff?.full_name || 'Staff';
  const dateStr = fmtDate(p.payment_date);

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Salary Receipt</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'Inter','Segoe UI',sans-serif;color:#1a1a2e;padding:24px;max-width:500px;margin:0 auto;}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #2A8FFF;}
  .title{font-size:18px;font-weight:700;margin-bottom:16px;text-align:center;text-transform:uppercase;letter-spacing:0.05em;}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;font-size:13px;}
  .row-label{color:#666;} .row-value{font-weight:600;}
  .total{font-size:18px;font-weight:700;text-align:center;margin:20px 0;padding:14px;background:#f5f7fa;border-radius:8px;}
  .footer{margin-top:20px;font-size:11px;color:#999;text-align:center;padding-top:14px;border-top:1px solid #eee;}
</style></head><body>
  <div class="header">
    <div style="font-size:22px;font-weight:200;letter-spacing:-2px;color:#2A8FFF;font-family:'Helvetica Neue',sans-serif;">flym</div>
    <div style="text-align:right;font-size:12px;color:#555;">
      <div style="font-weight:600;">${escHtml(gymName)}</div>
      ${S.gym?.city ? `<div>${escHtml(S.gym.city)}</div>` : ''}
    </div>
  </div>
  <div class="title">Salary Payment Receipt</div>
  <div class="row"><span class="row-label">Staff Name</span><span class="row-value">${escHtml(staffName)}</span></div>
  <div class="row"><span class="row-label">Role</span><span class="row-value">${escHtml(p.staff?.role || '\u2014')}</span></div>
  <div class="row"><span class="row-label">Payment Date</span><span class="row-value">${dateStr}</span></div>
  <div class="row"><span class="row-label">Payment Mode</span><span class="row-value">${escHtml(p.payment_mode)}</span></div>
  <div class="row"><span class="row-label">Type</span><span class="row-value">${p.is_advance ? 'Advance' : 'Salary'}</span></div>
  ${p.notes ? `<div class="row"><span class="row-label">Notes</span><span class="row-value">${escHtml(p.notes)}</span></div>` : ''}
  <div class="total">\u20B9${Number(p.amount).toLocaleString('en-IN')}</div>
  <div class="footer">
    <div>This is a computer-generated receipt.</div>
    <div style="margin-top:4px;">${escHtml(gymName)} \u00B7 Powered by Flym</div>
  </div>
</body></html>`;

  showPrintPreview('Salary Receipt', html);
}

function sendSalaryWhatsApp(paymentId, payments) {
  const p = payments.find(x => String(x.id) === String(paymentId));
  if (!p) return;
  const staffMember = (S.staff || []).find(s => String(s.id) === String(p.staff_id));
  const phone = (staffMember?.phone || '').replace(/\D/g, '');
  if (!phone) { showToast('No phone number for this staff member', 'red'); return; }

  const gymName = S.gym?.name || 'Gym';
  const msg = `Hi ${staffMember?.full_name || 'Staff'} \uD83D\uDC4B

Your salary payment from *${gymName}* has been processed:

\u2705 Amount: \u20B9${Number(p.amount).toLocaleString('en-IN')}
\u2705 Type: ${p.is_advance ? 'Advance' : 'Salary'}
\u2705 Mode: ${p.payment_mode}
\u2705 Date: ${fmtDate(p.payment_date)}
${p.notes ? `\u2705 Note: ${p.notes}\n` : ''}
Thank you for your work! \uD83D\uDCAA

\u2014 ${gymName}`;

  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  showToast('WhatsApp opened!', 'green');
}

// ── Create Login Modal ────────────────────────────────────────────
function openCreateLoginModal(staffId) {
  const staff = (S.staff || []).find(s => String(s.id) === String(staffId));
  if (!staff) return;

  openModal({
    title: `Create Login for ${escHtml(staff.full_name)}`,
    size: 'sm',
    body: `<div class="modal-form">
      <div style="background:var(--brand-fade);border:1px solid var(--brand-fade-strong);border-radius:var(--radius-md);padding:12px 14px;margin-bottom:16px;font-size:12px;color:var(--brand-text);line-height:1.6;">
        This will create a login account for <strong>${escHtml(staff.full_name)}</strong>. They will be able to log in to Flym with limited staff access.
      </div>
      <div class="form-group">
        <label class="form-label">Login Email *</label>
        <input class="form-input" id="sl-email" type="email" placeholder="staff@email.com" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="form-label">Password * <span style="font-weight:400;color:var(--text-quaternary);font-size:11px;">(min 6 characters)</span></label>
        <input class="form-input" id="sl-password" type="password" placeholder="Create a password" autocomplete="new-password" minlength="6">
      </div>
      <div id="sl-error" style="display:none;color:var(--red);font-size:13px;background:var(--red-fade);border:1px solid var(--red-strong);padding:10px 13px;border-radius:var(--radius-sm);margin-top:8px;"></div>
    </div>`,
    footer: `<button class="btn btn-ghost" data-modal-cancel>Cancel</button>
      <button class="btn btn-primary" id="sl-submit">Create Login</button>`,
    onOpen: () => {
      bindModalCancel();
      document.getElementById('sl-submit')?.addEventListener('click', async () => {
        const email = document.getElementById('sl-email')?.value?.trim();
        const password = document.getElementById('sl-password')?.value;
        const errEl = document.getElementById('sl-error');
        errEl.style.display = 'none';

        if (!email || !email.includes('@')) {
          errEl.textContent = 'Please enter a valid email address.';
          errEl.style.display = 'block';
          return;
        }
        if (!password || password.length < 6) {
          errEl.textContent = 'Password must be at least 6 characters.';
          errEl.style.display = 'block';
          return;
        }

        const btn = document.getElementById('sl-submit');
        btn.disabled = true;
        btn.textContent = 'Creating\u2026';

        try {
          const result = await createStaffLogin(staffId, email, password);
          closeModal();

          // Update local state
          const idx = (S.staff || []).findIndex(s => String(s.id) === String(staffId));
          if (idx > -1) {
            S.staff[idx].login_enabled = true;
            S.staff[idx].user_id = result.userId;
          }

          renderStaffTab();
          showToast(`Login created for ${staff.full_name} (${result.email})`, 'green');
        } catch (err) {
          errEl.textContent = err.message || 'Failed to create login. Please try again.';
          errEl.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Create Login';
        }
      });
    }
  });
}

// ── Styles ────────────────────────────────────────────────────────
function _injectStaffStyles() {
  if (document.getElementById('flym-staff-styles')) return;
  const s = document.createElement('style');
  s.id = 'flym-staff-styles';
  s.textContent = `
    .staff-tab-btn {
      flex:1; padding:8px 12px; border:none; background:transparent;
      color:var(--text-tertiary); font-size:13px; font-weight:500;
      border-radius:var(--radius-sm); cursor:pointer;
      transition:all 0.15s ease;
      font-family:var(--font-head);
    }
    .staff-tab-btn.active {
      background:var(--brand-fade); color:var(--brand-text);
      font-weight:600;
    }
    .staff-tab-btn:hover:not(.active) {
      color:var(--text-secondary); background:var(--surface-2);
    }
    @media (max-width: 768px) {
      .staff-tab-btn { font-size:12px; padding:8px 4px; min-height:40px; }
    }
    @media (max-width: 360px) {
      .staff-tab-btn { font-size:11px; padding:7px 3px; }
    }
  `;
  document.head.appendChild(s);
}