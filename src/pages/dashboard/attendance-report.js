// src/pages/dashboard/attendance-report.js
// ─────────────────────────────────────────────────────────────────
// Staff Attendance Report — monthly grid + per-staff summary,
// rendered as a clean printable A4 landscape page.
//
// Used by Data & Backup (backup.js). Uses showPrintPreview(), never
// window.open() — iOS PWA standalone mode has no back button.
// ─────────────────────────────────────────────────────────────────
import { S } from './state.js';
import { escHtml } from './helpers.js';
import { getAttendanceRange } from '../../lib/staff.js';
import { showToast } from '../../components/toast.js';
import { showPrintPreview } from '../../components/print-preview.js';

const MARKS = {
  Present:    { ch: 'P', bg: '#e6f7ec', fg: '#15803d' },
  Absent:     { ch: 'A', bg: '#fdeaea', fg: '#b91c1c' },
  'Half-day': { ch: 'H', bg: '#fff4e0', fg: '#b45309' },
  Leave:      { ch: 'L', bg: '#eef0ff', fg: '#4338ca' },
};

const WEEKEND_BG = '#f3f4f6';

function daysInMonth(year, month0) {
  return new Date(year, month0 + 1, 0).getDate();
}

function pad2(n) { return String(n).padStart(2, '0'); }

/** Settings-card markup for the Data & Backup page. */
export function attendanceReportCardHTML(curMonth) {
  return `<div class="settings-card">
    <div class="settings-card-title" style="margin-bottom:14px;">Staff Attendance Report</div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;line-height:1.6;">
      Day-by-day attendance grid for the whole team, with present/absent/leave totals and an attendance percentage per staff member.
    </div>
    <div style="margin-bottom:12px;">
      <label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px;">Month</label>
      <input type="month" id="bk-att-month" value="${escHtml(curMonth)}" class="form-input" style="padding:8px 10px;font-size:13px;">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <button class="btn btn-primary" id="btn-att-report">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        PDF Report
      </button>
      <button class="btn btn-ghost" id="btn-att-report-csv">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Excel (CSV)
      </button>
    </div>
    <div style="font-size:11px;color:var(--text-quaternary);margin-top:8px;">P = Present · A = Absent · H = Half-day · L = Leave</div>
  </div>`;
}

/** Fetch + shape the month's attendance. Returns null if there is nothing. */
async function loadMonth(month) {
  const gymId = S.gym?.id;
  if (!gymId) return null;

  const [year, mo] = month.split('-').map(Number);
  const month0 = mo - 1;
  const total = daysInMonth(year, month0);
  const startDate = `${year}-${pad2(mo)}-01`;
  const endDate   = `${year}-${pad2(mo)}-${pad2(total)}`;

  const records = await getAttendanceRange(gymId, startDate, endDate);
  const staff = (S.staff || []).slice().sort((a, b) =>
    (a.full_name || '').localeCompare(b.full_name || ''));

  if (!staff.length) return null;

  // staffId -> { 1: 'Present', 2: 'Absent', ... }
  const byStaff = {};
  staff.forEach(s => { byStaff[s.id] = {}; });
  (records || []).forEach(r => {
    if (!byStaff[r.staff_id]) return;
    const d = Number(String(r.date).slice(8, 10));
    if (d >= 1 && d <= total) byStaff[r.staff_id][d] = r.status;
  });

  const rows = staff.map(s => {
    const marks = byStaff[s.id] || {};
    let present = 0, absent = 0, half = 0, leave = 0;
    Object.values(marks).forEach(st => {
      if (st === 'Present') present++;
      else if (st === 'Absent') absent++;
      else if (st === 'Half-day') half++;
      else if (st === 'Leave') leave++;
    });
    const marked = present + absent + half + leave;
    // Half-day counts as 0.5 of a working day
    const credited = present + half * 0.5;
    const pct = marked > 0 ? Math.round((credited / marked) * 100) : 0;
    return {
      id: s.id,
      name: s.full_name || '—',
      role: s.role || '—',
      salary: Number(s.salary_amount) || 0,
      marks, present, absent, half, leave, marked, credited, pct,
    };
  });

  return { year, mo, month0, total, rows, recordCount: (records || []).length };
}

/** Build + open the printable PDF. */
export async function exportAttendancePDF(month) {
  const gymName = S.gym?.name || 'My Gym';
  const gymCode = S.gym?.gym_code || '';

  const data = await loadMonth(month);
  if (!data) { showToast('Add staff members first', 'amber'); return; }
  if (!data.recordCount) { showToast('No attendance recorded for this month', 'amber'); return; }

  const { year, month0, total, rows } = data;
  const monthLabel = new Date(year, month0, 1)
    .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const genStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

  // Header row: day numbers + weekday initials
  const dayCells = [];
  for (let d = 1; d <= total; d++) {
    const wd = new Date(year, month0, d).getDay();
    const isWeekend = wd === 0;
    dayCells.push(`<th style="padding:3px 0;width:19px;min-width:19px;font-size:8px;font-weight:600;color:${isWeekend ? '#b91c1c' : '#fff'};background:${isWeekend ? '#ffe4e4' : '#1A6FD4'};border:1px solid #d7dde6;text-align:center;line-height:1.25;">
      ${d}<br><span style="font-weight:400;opacity:.85;">${'SMTWTFS'[wd]}</span>
    </th>`);
  }

  const gridRows = rows.map((r, i) => {
    const cells = [];
    for (let d = 1; d <= total; d++) {
      const st = r.marks[d];
      const m = MARKS[st];
      const wd = new Date(year, month0, d).getDay();
      const bg = m ? m.bg : (wd === 0 ? WEEKEND_BG : '#fff');
      const fg = m ? m.fg : '#c9ced6';
      cells.push(`<td style="padding:3px 0;text-align:center;font-size:8.5px;font-weight:700;color:${fg};background:${bg};border:1px solid #e5e9ef;">${m ? m.ch : '·'}</td>`);
    }
    return `<tr style="page-break-inside:avoid;background:${i % 2 ? '#fbfcfd' : '#fff'};">
      <td style="padding:4px 7px;font-size:9.5px;font-weight:600;color:#1a1a2e;border:1px solid #e5e9ef;white-space:nowrap;position:sticky;left:0;background:inherit;">${escHtml(r.name)}</td>
      <td style="padding:4px 7px;font-size:8.5px;color:#6b7280;border:1px solid #e5e9ef;white-space:nowrap;">${escHtml(r.role)}</td>
      ${cells.join('')}
      <td style="padding:4px 6px;text-align:center;font-size:9px;font-weight:700;color:#15803d;border:1px solid #e5e9ef;background:#f6fbf8;">${r.present}</td>
      <td style="padding:4px 6px;text-align:center;font-size:9px;font-weight:700;color:#b91c1c;border:1px solid #e5e9ef;background:#fdf7f7;">${r.absent}</td>
      <td style="padding:4px 6px;text-align:center;font-size:9px;font-weight:700;color:#b45309;border:1px solid #e5e9ef;background:#fffbf4;">${r.half}</td>
      <td style="padding:4px 6px;text-align:center;font-size:9px;font-weight:700;color:#4338ca;border:1px solid #e5e9ef;background:#f8f9ff;">${r.leave}</td>
      <td style="padding:4px 6px;text-align:center;font-size:9.5px;font-weight:700;color:${r.pct >= 80 ? '#15803d' : r.pct >= 50 ? '#b45309' : '#b91c1c'};border:1px solid #e5e9ef;">${r.pct}%</td>
    </tr>`;
  }).join('');

  // Summary table
  const summaryRows = rows.map((r, i) => `<tr style="background:${i % 2 ? '#fbfcfd' : '#fff'};page-break-inside:avoid;">
    <td style="padding:7px 10px;font-size:11px;font-weight:600;color:#1a1a2e;border-bottom:1px solid #eef1f5;">${escHtml(r.name)}</td>
    <td style="padding:7px 10px;font-size:11px;color:#555;border-bottom:1px solid #eef1f5;">${escHtml(r.role)}</td>
    <td style="padding:7px 10px;font-size:11px;text-align:center;color:#15803d;font-weight:600;border-bottom:1px solid #eef1f5;">${r.present}</td>
    <td style="padding:7px 10px;font-size:11px;text-align:center;color:#b91c1c;font-weight:600;border-bottom:1px solid #eef1f5;">${r.absent}</td>
    <td style="padding:7px 10px;font-size:11px;text-align:center;color:#b45309;font-weight:600;border-bottom:1px solid #eef1f5;">${r.half}</td>
    <td style="padding:7px 10px;font-size:11px;text-align:center;color:#4338ca;font-weight:600;border-bottom:1px solid #eef1f5;">${r.leave}</td>
    <td style="padding:7px 10px;font-size:11px;text-align:center;color:#555;border-bottom:1px solid #eef1f5;">${r.marked}</td>
    <td style="padding:7px 10px;font-size:11px;text-align:center;font-weight:700;color:${r.pct >= 80 ? '#15803d' : r.pct >= 50 ? '#b45309' : '#b91c1c'};border-bottom:1px solid #eef1f5;">${r.pct}%</td>
  </tr>`).join('');

  const totPresent = rows.reduce((s, r) => s + r.present, 0);
  const totAbsent  = rows.reduce((s, r) => s + r.absent, 0);
  const totHalf    = rows.reduce((s, r) => s + r.half, 0);
  const totLeave   = rows.reduce((s, r) => s + r.leave, 0);
  const totMarked  = rows.reduce((s, r) => s + r.marked, 0);
  const overallPct = totMarked > 0
    ? Math.round((rows.reduce((s, r) => s + r.credited, 0) / totMarked) * 100) : 0;

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Staff Attendance — ${escHtml(gymName)} — ${escHtml(monthLabel)}</title>
<style>
  @page { size: A4 landscape; margin: 9mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color:#1a1a2e; margin:0; padding:18px; background:#fff; }
  table { width:100%; border-collapse:collapse; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  h2 { font-size:14px; color:#1A6FD4; margin:22px 0 8px; border-bottom:2px solid #1A6FD4; padding-bottom:4px; }
  @media print { body { padding:0; } .no-print { display:none !important; } }
</style></head><body>

<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:12px;margin-bottom:16px;border-bottom:2px solid #1A6FD4;">
  <div>
    <div style="font-size:24px;font-weight:200;letter-spacing:-1px;color:#1A6FD4;line-height:1;">flym</div>
    <div style="font-size:9px;color:#888;letter-spacing:.15em;text-transform:uppercase;margin-top:3px;">Staff Attendance Report</div>
  </div>
  <div style="text-align:right;font-size:10px;color:#666;line-height:1.7;">
    <strong style="color:#222;font-size:12px;">${escHtml(gymName)}</strong><br>
    ${gymCode ? escHtml(gymCode) + '<br>' : ''}Generated: ${escHtml(genStr)}
  </div>
</div>

<div style="font-size:19px;font-weight:700;margin-bottom:3px;">Attendance — ${escHtml(monthLabel)}</div>
<div style="font-size:11px;color:#666;margin-bottom:14px;">${rows.length} staff member${rows.length !== 1 ? 's' : ''} · ${total} days</div>

<div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:16px;padding:11px 16px;background:#f4f7fb;border-left:3px solid #1A6FD4;border-radius:4px;">
  <div><div style="font-size:9px;color:#888;text-transform:uppercase;letter-spacing:.06em;">Present</div><div style="font-size:14px;font-weight:700;color:#15803d;">${totPresent}</div></div>
  <div><div style="font-size:9px;color:#888;text-transform:uppercase;letter-spacing:.06em;">Absent</div><div style="font-size:14px;font-weight:700;color:#b91c1c;">${totAbsent}</div></div>
  <div><div style="font-size:9px;color:#888;text-transform:uppercase;letter-spacing:.06em;">Half-day</div><div style="font-size:14px;font-weight:700;color:#b45309;">${totHalf}</div></div>
  <div><div style="font-size:9px;color:#888;text-transform:uppercase;letter-spacing:.06em;">Leave</div><div style="font-size:14px;font-weight:700;color:#4338ca;">${totLeave}</div></div>
  <div><div style="font-size:9px;color:#888;text-transform:uppercase;letter-spacing:.06em;">Days Marked</div><div style="font-size:14px;font-weight:700;color:#222;">${totMarked}</div></div>
  <div><div style="font-size:9px;color:#888;text-transform:uppercase;letter-spacing:.06em;">Overall</div><div style="font-size:14px;font-weight:700;color:${overallPct >= 80 ? '#15803d' : '#b45309'};">${overallPct}%</div></div>
</div>

<h2>Daily Grid</h2>
<table style="table-layout:fixed;">
  <thead><tr>
    <th style="padding:4px 7px;text-align:left;font-size:8.5px;font-weight:600;color:#fff;background:#1A6FD4;border:1px solid #d7dde6;width:110px;">Staff</th>
    <th style="padding:4px 7px;text-align:left;font-size:8.5px;font-weight:600;color:#fff;background:#1A6FD4;border:1px solid #d7dde6;width:64px;">Role</th>
    ${dayCells.join('')}
    <th style="padding:4px;font-size:8px;font-weight:600;color:#fff;background:#15803d;border:1px solid #d7dde6;width:24px;">P</th>
    <th style="padding:4px;font-size:8px;font-weight:600;color:#fff;background:#b91c1c;border:1px solid #d7dde6;width:24px;">A</th>
    <th style="padding:4px;font-size:8px;font-weight:600;color:#fff;background:#b45309;border:1px solid #d7dde6;width:24px;">H</th>
    <th style="padding:4px;font-size:8px;font-weight:600;color:#fff;background:#4338ca;border:1px solid #d7dde6;width:24px;">L</th>
    <th style="padding:4px;font-size:8px;font-weight:600;color:#fff;background:#374151;border:1px solid #d7dde6;width:32px;">%</th>
  </tr></thead>
  <tbody>${gridRows}</tbody>
</table>

<div style="margin-top:8px;font-size:9px;color:#888;">
  <strong>Legend:</strong>
  <span style="background:#e6f7ec;color:#15803d;padding:1px 5px;border-radius:2px;font-weight:700;">P</span> Present ·
  <span style="background:#fdeaea;color:#b91c1c;padding:1px 5px;border-radius:2px;font-weight:700;">A</span> Absent ·
  <span style="background:#fff4e0;color:#b45309;padding:1px 5px;border-radius:2px;font-weight:700;">H</span> Half-day ·
  <span style="background:#eef0ff;color:#4338ca;padding:1px 5px;border-radius:2px;font-weight:700;">L</span> Leave ·
  <span style="color:#c9ced6;font-weight:700;">·</span> Not marked
  &nbsp;&nbsp;Attendance % counts a half-day as 0.5, over days actually marked.
</div>

<h2 style="page-break-before:auto;">Summary</h2>
<table>
  <thead><tr>
    ${['Staff', 'Role', 'Present', 'Absent', 'Half-day', 'Leave', 'Days Marked', 'Attendance %']
      .map((h, i) => `<th style="padding:8px 10px;text-align:${i < 2 ? 'left' : 'center'};font-size:10px;font-weight:600;color:#fff;background:#1A6FD4;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;">${h}</th>`).join('')}
  </tr></thead>
  <tbody>
    ${summaryRows}
    <tr style="background:#f4f7fb;font-weight:700;">
      <td style="padding:8px 10px;font-size:11px;border-top:2px solid #1A6FD4;">TOTAL</td>
      <td style="padding:8px 10px;border-top:2px solid #1A6FD4;"></td>
      <td style="padding:8px 10px;font-size:11px;text-align:center;color:#15803d;border-top:2px solid #1A6FD4;">${totPresent}</td>
      <td style="padding:8px 10px;font-size:11px;text-align:center;color:#b91c1c;border-top:2px solid #1A6FD4;">${totAbsent}</td>
      <td style="padding:8px 10px;font-size:11px;text-align:center;color:#b45309;border-top:2px solid #1A6FD4;">${totHalf}</td>
      <td style="padding:8px 10px;font-size:11px;text-align:center;color:#4338ca;border-top:2px solid #1A6FD4;">${totLeave}</td>
      <td style="padding:8px 10px;font-size:11px;text-align:center;border-top:2px solid #1A6FD4;">${totMarked}</td>
      <td style="padding:8px 10px;font-size:11px;text-align:center;border-top:2px solid #1A6FD4;">${overallPct}%</td>
    </tr>
  </tbody>
</table>

<div style="margin-top:26px;padding-top:12px;border-top:1px solid #ddd;font-size:9px;color:#999;text-align:center;">
  Generated by Flym · ${escHtml(gymName)} · ${escHtml(genStr)}<br>
  This document contains confidential staff data. Handle with care.
</div>
</body></html>`;

  showPrintPreview('Staff Attendance — ' + monthLabel, html);
}

/** CSV export of the same month. */
export async function exportAttendanceCSV(month) {
  const gymName = S.gym?.name || 'gym';
  const data = await loadMonth(month);
  if (!data) { showToast('Add staff members first', 'amber'); return; }
  if (!data.recordCount) { showToast('No attendance recorded for this month', 'amber'); return; }

  const { total, rows } = data;
  const esc = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const header = ['Staff', 'Role'];
  for (let d = 1; d <= total; d++) header.push(String(d));
  header.push('Present', 'Absent', 'Half-day', 'Leave', 'Days Marked', 'Attendance %');

  const lines = [header.map(esc).join(',')];
  rows.forEach(r => {
    const line = [r.name, r.role];
    for (let d = 1; d <= total; d++) line.push(MARKS[r.marks[d]]?.ch || '');
    line.push(r.present, r.absent, r.half, r.leave, r.marked, r.pct + '%');
    lines.push(line.map(esc).join(','));
  });

  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `attendance-${gymName.replace(/\s+/g, '-').toLowerCase()}-${month}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Attendance CSV downloaded', 'green');
}

/** Wire the two buttons. Call this from renderBackup() after innerHTML. */
export function bindAttendanceReport() {
  const curMonth = new Date().toISOString().slice(0, 7);

  document.getElementById('btn-att-report')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-att-report');
    const month = document.getElementById('bk-att-month')?.value || curMonth;
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    try {
      await exportAttendancePDF(month);
    } catch (err) {
      console.error('[Flym] Attendance report:', err);
      showToast('Failed to build attendance report', 'red');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> PDF Report`;
      }
    }
  });

  document.getElementById('btn-att-report-csv')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-att-report-csv');
    const month = document.getElementById('bk-att-month')?.value || curMonth;
    if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
    try {
      await exportAttendanceCSV(month);
    } catch (err) {
      console.error('[Flym] Attendance CSV:', err);
      showToast('Failed to export CSV', 'red');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Excel (CSV)`;
      }
    }
  });
}
