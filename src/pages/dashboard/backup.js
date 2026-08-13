import { S } from './state.js';
import { escHtml, fmtDate, memberStatus, expiryDate, memberTotal, parseMemberAddons, outstandingAmount } from './helpers.js';
import { getAllExpenses, getExpenses, getExpensesByRange, EXPENSE_CATEGORIES } from '../../lib/expenses.js';
import { getPaymentHistory, getPaymentsByMonth, getAllMembers } from '../../lib/members.js';
import { showToast } from '../../components/toast.js';
import { showPrintPreview } from '../../components/print-preview.js';
import { attendanceReportCardHTML, bindAttendanceReport } from './attendance-report.js';

function renderBackup(c) {
  const gymName = S.gym?.name || 'My Gym';
  const gymCode = S.gym?.gym_code || '';
  const now = new Date();
  const curMonth = now.toISOString().slice(0, 7);
  const curYear = now.getFullYear();

  const planOpts = (S.plans || [])
    .filter(p => p.is_active !== false)
    .map(p => `<option value="${escHtml(p.name)}">${escHtml(p.name)}</option>`)
    .join('');

  const catOpts = EXPENSE_CATEGORIES
    .map(cat => `<option value="${cat.id}">${cat.icon} ${cat.label}</option>`)
    .join('');

  const yearOpts = [];
  for (let y = curYear; y >= curYear - 3; y--) yearOpts.push(`<option value="${y}">${y}</option>`);

  c.innerHTML = `<div class="content-inner page-enter">
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-title">Data &amp; Backup</div>
        <div class="page-sub">Export filtered reports for your records or accountant</div>
      </div>
    </div>

    <div class="settings-grid" style="align-items:start;">

      <!-- LEFT COLUMN: Exports -->
      <div style="display:flex;flex-direction:column;gap:var(--space-4);">

        <!-- MEMBERS EXPORT -->
        <div class="settings-card">
          <div class="settings-card-title" style="margin-bottom:14px;">Members Report</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
            <div>
              <label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px;">Status</label>
              <select id="bk-m-status" class="form-input" style="padding:8px 10px;font-size:13px;">
                <option value="all">All Members</option>
                <option value="active">Active</option>
                <option value="expired">Expired</option>
                <option value="expiring">Expiring Soon</option>
                <option value="trial">Trial</option>
              </select>
            </div>
            <div>
              <label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px;">Payment Mode</label>
              <select id="bk-m-paymode" class="form-input" style="padding:8px 10px;font-size:13px;">
                <option value="all">All</option>
                <option value="Cash">Cash Only</option>
                <option value="Card">Card Only</option>
                <option value="Online">Online Only</option>
              </select>
            </div>
            <div>
              <label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px;">Plan</label>
              <select id="bk-m-plan" class="form-input" style="padding:8px 10px;font-size:13px;">
                <option value="all">All Plans</option>
                ${planOpts}
              </select>
            </div>
            <div>
              <label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px;">Payment Status</label>
              <select id="bk-m-paystatus" class="form-input" style="padding:8px 10px;font-size:13px;">
                <option value="all">All</option>
                <option value="Paid">Paid</option>
                <option value="Due">Due</option>
                <option value="Partial">Partial</option>
              </select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <button class="btn btn-primary" id="btn-export-members">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              PDF Report
            </button>
            <button class="btn btn-ghost" id="btn-export-members-csv">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Excel (CSV)
            </button>
          </div>
        </div>

        <!-- PAYMENTS EXPORT -->
        <div class="settings-card">
          <div class="settings-card-title" style="margin-bottom:14px;">Payments Report</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
            <div>
              <label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px;">Month</label>
              <input type="month" id="bk-p-month" value="${curMonth}" class="form-input" style="padding:8px 10px;font-size:13px;">
            </div>
            <div>
              <label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px;">Payment Mode</label>
              <select id="bk-p-paymode" class="form-input" style="padding:8px 10px;font-size:13px;">
                <option value="all">All</option>
                <option value="Cash">Cash Only</option>
                <option value="Card">Card Only</option>
                <option value="Online">Online Only</option>
              </select>
            </div>
            <div>
              <label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px;">Plan</label>
              <select id="bk-p-plan" class="form-input" style="padding:8px 10px;font-size:13px;">
                <option value="all">All Plans</option>
                ${planOpts}
              </select>
            </div>
            <div>
              <label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px;">Payment Status</label>
              <select id="bk-p-paystatus" class="form-input" style="padding:8px 10px;font-size:13px;">
                <option value="all">All</option>
                <option value="Paid">Paid</option>
                <option value="Due">Due</option>
                <option value="Partial">Partial</option>
              </select>
            </div>
          </div>
          <button class="btn btn-primary" id="btn-export-payments" style="width:100%;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export Payments (PDF)
          </button>
        </div>

        <!-- EXPENSES EXPORT -->
        <div class="settings-card">
          <div class="settings-card-title" style="margin-bottom:14px;">Expenses Report</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
            <div>
              <label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px;">Month</label>
              <input type="month" id="bk-e-month" value="${curMonth}" class="form-input" style="padding:8px 10px;font-size:13px;">
            </div>
            <div>
              <label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px;">Category</label>
              <select id="bk-e-category" class="form-input" style="padding:8px 10px;font-size:13px;">
                <option value="all">All Categories</option>
                ${catOpts}
              </select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <button class="btn btn-primary" id="btn-export-expenses-pdf">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              PDF Report
            </button>
            <button class="btn btn-ghost" id="btn-export-expenses-csv">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              CSV for Accountant
            </button>
          </div>
          <div style="font-size:11px;color:var(--text-quaternary);margin-top:8px;">CSV is ready to share with your CA or import into Tally</div>
        </div>
      </div>

      <!-- RIGHT COLUMN: Year-end + Attendance + Full backup + Info -->
      <div style="display:flex;flex-direction:column;gap:var(--space-4);">

        <!-- YEAR-END SUMMARY -->
        <div class="settings-card">
          <div class="settings-card-title" style="margin-bottom:14px;">Year-End Summary</div>
          <div style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;line-height:1.6;">
            Complete financial overview for your CA at ITR time. Revenue, expenses, profit, and category breakdown — all in one PDF.
          </div>
          <div style="margin-bottom:12px;">
            <label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px;">Year</label>
            <select id="bk-year" class="form-input" style="padding:8px 10px;font-size:13px;">
              ${yearOpts.join('')}
            </select>
          </div>
          <button class="btn btn-primary" id="btn-export-yearend" style="width:100%;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export Year-End Summary (PDF)
          </button>
        </div>

        <!-- FINANCIAL REPORTS -->
        <div class="settings-card">
          <div class="settings-card-title" style="margin-bottom:14px;">Financial Reports</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
            <button class="btn btn-ghost" id="btn-outstanding" style="font-size:12px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Outstanding
            </button>
            <button class="btn btn-ghost" id="btn-pnl" style="font-size:12px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              P&amp;L Report
            </button>
            <button class="btn btn-ghost" id="btn-gst-summary" style="font-size:12px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
              GST Summary
            </button>
          </div>
          <div style="font-size:11px;color:var(--text-quaternary);margin-top:8px;">Uses the Year selection above for P&amp;L and GST reports</div>
        </div>

        <!-- STAFF ATTENDANCE -->
        ${attendanceReportCardHTML(curMonth)}

        <!-- FULL BACKUP -->
        <div class="settings-card">
          <div class="settings-card-title" style="margin-bottom:14px;">Full Data Backup</div>
          <div style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;line-height:1.6;">
            Download all your gym data. Includes members, plans, expenses, addon templates, and payment history.
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <button class="btn btn-ghost" id="btn-full-backup">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              JSON Backup
            </button>
            <button class="btn btn-primary" id="btn-full-backup-pdf">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              PDF Report
            </button>
          </div>
        </div>

        <!-- DATA INFO -->
        <div class="settings-card">
          <div class="settings-card-title">Data Retention</div>
          <div style="font-size:13px;color:var(--text-secondary);line-height:1.8;">
            <div style="padding:10px 0;border-bottom:1px solid var(--border-subtle);">
              <strong style="color:var(--text-primary);">Active Subscription</strong> — All data stored <strong style="color:var(--green);">indefinitely</strong>.
            </div>
            <div style="padding:10px 0;border-bottom:1px solid var(--border-subtle);">
              <strong style="color:var(--text-primary);">After Cancellation</strong> — Retained for <strong style="color:var(--amber);">90 days</strong>. Export before this window closes.
            </div>
            <div style="padding:10px 0;">
              <strong style="color:var(--text-primary);">Security</strong> — AES-256 encryption at rest and in transit. Multi-region replication.
            </div>
          </div>
        </div>

        <div class="settings-card" style="border-color:var(--brand-fade-strong);background:var(--brand-fade);">
          <div style="font-size:13px;color:var(--text-secondary);line-height:1.7;">
            Need data recovery? Contact us on WhatsApp:
            <a href="https://wa.me/919945791450" target="_blank"
              style="color:var(--green);text-decoration:none;font-weight:500;">+91 99457 91450</a>
          </div>
        </div>
      </div>

    </div>
  </div>`;

  // ── Staff attendance report (monthly grid + summary) ────────────
  bindAttendanceReport();

  // ── PDF EXPORT ENGINE ───────────────────────────────────────────
  function exportPDF(title, headers, rows, filename, meta = {}, subtitle = '') {
    const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
    const headerRow = headers.map(h =>
      `<th style="padding:9px 10px;text-align:left;font-size:11px;font-weight:600;color:#fff;background:#1A6FD4;border-bottom:2px solid #1A6FD4;text-transform:uppercase;letter-spacing:0.04em;white-space:nowrap;">${escHtml(h)}</th>`
    ).join('');
    const bodyRows = rows.length
      ? rows.map((r, i) => `<tr style="background:${i % 2 ? '#f9fafb' : '#fff'};page-break-inside:avoid;">${r.map(cell => `<td style="padding:8px 10px;font-size:11.5px;color:#222;border-bottom:1px solid #eee;vertical-align:top;">${escHtml(cell)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${headers.length}" style="padding:30px;text-align:center;color:#999;font-size:12px;">No records to display</td></tr>`;
    const summaryBlock = Object.keys(meta).length
      ? `<div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:24px;padding:14px 18px;background:#f4f7fb;border-left:3px solid #1A6FD4;border-radius:4px;">${Object.entries(meta).map(([k, v]) => `<div><div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;">${escHtml(k)}</div><div style="font-size:14px;color:#222;font-weight:600;">${escHtml(String(v))}</div></div>`).join('')}</div>` : '';
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${escHtml(title)} — ${escHtml(gymName)}</title>
<style>@page{size:A4;margin:14mm 12mm;}*{box-sizing:border-box;}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#222;margin:0;padding:24px;background:#fff;}table{width:100%;border-collapse:collapse;}thead{display:table-header-group;}tr{page-break-inside:avoid;}@media print{body{padding:0;}.no-print{display:none!important;}}</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;margin-bottom:22px;border-bottom:2px solid #1A6FD4;">
  <div><div style="font-size:26px;font-weight:200;letter-spacing:-1px;color:#1A6FD4;line-height:1;">flym</div><div style="font-size:10px;color:#888;letter-spacing:0.15em;text-transform:uppercase;margin-top:4px;">Smart Gym Management</div></div>
  <div style="text-align:right;font-size:11px;color:#666;line-height:1.7;"><strong style="color:#222;font-size:13px;">${escHtml(gymName)}</strong><br>${gymCode ? escHtml(gymCode) + '<br>' : ''}Generated: ${escHtml(dateStr)}</div>
</div>
<div style="font-size:20px;font-weight:700;margin-bottom:4px;color:#222;">${escHtml(title)}</div>
<div style="font-size:12px;color:#666;margin-bottom:18px;">${subtitle ? escHtml(subtitle) : 'Total records: <strong>' + rows.length + '</strong>'}</div>
${summaryBlock}
<table><thead><tr>${headerRow}</tr></thead><tbody>${bodyRows}</tbody></table>
<div style="margin-top:30px;padding-top:14px;border-top:1px solid #ddd;font-size:10px;color:#999;text-align:center;">Generated by Flym &middot; ${escHtml(gymName)} &middot; ${escHtml(dateStr)}<br>This document contains confidential data. Handle with care.</div>
</body></html>`;
    showPrintPreview(title, html);
    return true;
  }

  // ── HELPER: complete member list for exports ────────────────────
  // S.members is capped at 5,000 by getMembers() because it drives the
  // dashboard UI. Exports must never use it: a backup that quietly omits
  // members 5,001+ is worse than no backup, because the owner believes
  // they are covered. Fetched once per visit to this page and reused.
  let _exportMembers = null;
  async function exportMembers() {
    if (_exportMembers) return _exportMembers;
    if (!S.gym?.id) return S.members || [];
    _exportMembers = await getAllMembers(S.gym.id);
    return _exportMembers;
  }

  // ── HELPER: Filter members ──────────────────────────────────────
  function filterMembersForExport(members, opts) {
    return (members || []).filter(m => {
      if (opts.status !== 'all') {
        const s = memberStatus(m);
        if (opts.status === 'active'   && s !== 'Active') return false;
        if (opts.status === 'expired'  && s !== 'Expired') return false;
        if (opts.status === 'expiring' && s !== 'Expiring') return false;
        if (opts.status === 'trial'    && (m.member_type||m.memberType) !== 'Trial') return false;
      }
      if (opts.payMode !== 'all' && (m.payment_mode||'') !== opts.payMode) return false;
      if (opts.plan !== 'all' && (m.plan_name||'') !== opts.plan) return false;
      if (opts.payStatus !== 'all' && (m.payment_status||'') !== opts.payStatus) return false;
      return true;
    });
  }

  // ── MEMBERS EXPORT ──────────────────────────────────────────────
  document.getElementById('btn-export-members')?.addEventListener('click', async () => {
    const opts = {
      status:    document.getElementById('bk-m-status')?.value || 'all',
      payMode:   document.getElementById('bk-m-paymode')?.value || 'all',
      plan:      document.getElementById('bk-m-plan')?.value || 'all',
      payStatus: document.getElementById('bk-m-paystatus')?.value || 'all',
    };
    const filtered = filterMembersForExport(await exportMembers(), opts);
    if (!filtered.length) { showToast('No members match these filters', 'amber'); return; }

    const parts = [];
    if (opts.status !== 'all') parts.push(opts.status);
    if (opts.payMode !== 'all') parts.push(opts.payMode);
    if (opts.plan !== 'all') parts.push(opts.plan);
    if (opts.payStatus !== 'all') parts.push(opts.payStatus);
    const sub = parts.length ? `Filtered: ${parts.join(' · ')} · ${filtered.length} members` : `All members · ${filtered.length} total`;

    const active  = filtered.filter(m => memberStatus(m) === 'Active').length;
    const expired = filtered.filter(m => memberStatus(m) === 'Expired').length;
    const trial   = filtered.filter(m => (m.member_type||'Paid') === 'Trial').length;
    const headers = ['#','App #','Name','Phone','Join Date','Plan','Price','Discount','Balance Due','Expiry','Mode','Status','Type','Add-ons'];
    const rows = filtered.map((m, i) => {
      const exp = expiryDate(m);
      const addons = parseMemberAddons(m).map(a => `${a.name} (+₹${a.price})`).join(', ');
      const discount = parseFloat(m.discount_amount) || 0;
      const balance = parseFloat(m.balance_due) || 0;
      const st = memberStatus(m);
      const statusLabel = m.cancelled_at ? 'Cancelled' : st;
      return [i+1, m.application_number||'—', m.full_name||'', m.phone||'', fmtDate(m.join_date), m.plan_name||(m.member_type==='Trial'?'Trial':'—'),
        m.plan_price ? '₹'+Number(m.plan_price).toLocaleString('en-IN') : '—',
        discount > 0 ? '-₹'+discount.toLocaleString('en-IN') : '—',
        balance > 0 ? '₹'+balance.toLocaleString('en-IN') : '—',
        exp?fmtDate(exp.toISOString().split('T')[0]):'—', m.payment_mode||'—', statusLabel, m.member_type||'Paid', addons||'—'];
    });
    const meta = { 'Total':filtered.length, 'Active':active, 'Expired':expired, 'Trial':trial };
    const fn = (S.gym?.name||'gym').replace(/\s+/g,'_') + '_members';
    if (exportPDF('Members Report', headers, rows, fn, meta, sub)) showToast('Opening members PDF…', 'green');
  });

  // ── PAYMENTS EXPORT ─────────────────────────────────────────────
  document.getElementById('btn-export-payments')?.addEventListener('click', async () => {
    const month = document.getElementById('bk-p-month')?.value || curMonth;
    const payMode = document.getElementById('bk-p-paymode')?.value || 'all';
    const planFilter = document.getElementById('bk-p-plan')?.value || 'all';
    const payStatus = document.getElementById('bk-p-paystatus')?.value || 'all';

    const btn = document.getElementById('btn-export-payments');
    if (btn) { btn.disabled = true; btn.innerHTML = 'Loading…'; }

    try {
      const allM = await exportMembers();
      let records = await getPaymentsByMonth(S.gym.id, month);
      // Apply filters
      if (payMode !== 'all') records = records.filter(r => r.payment_mode === payMode);
      if (planFilter !== 'all') records = records.filter(r => r.plan_name === planFilter);
      if (payStatus !== 'all') {
        if (payStatus === 'Paid') records = records.filter(r => parseFloat(r.amount) > 0);
      }

      if (!records.length) {
        // Fallback to member data for this month
        const filtered = allM.filter(m => {
          if (m.member_type === 'Trial' || !m.plan_price) return false;
          if (!(m.join_date||'').startsWith(month)) return false;
          if (payMode !== 'all' && m.payment_mode !== payMode) return false;
          if (planFilter !== 'all' && m.plan_name !== planFilter) return false;
          if (payStatus !== 'all' && m.payment_status !== payStatus) return false;
          return true;
        });
        if (!filtered.length) { showToast('No payments found for this month', 'amber'); return; }

        const monthLabel = new Date(month+'-01').toLocaleDateString('en-IN',{month:'long',year:'numeric'});
        const collected = filtered
          .filter(m => !m.cancelled_at && m.payment_status === 'Paid')
          .reduce((s, m) => s + memberTotal(m), 0);
        const pending = filtered
          .filter(m => !m.cancelled_at && (m.payment_status === 'Due' || m.payment_status === 'Partial'))
          .reduce((s, m) => s + (m.payment_status === 'Partial' ? (parseFloat(m.balance_due) || 0) : memberTotal(m)), 0);
        const headers = ['#','App #','Member','Phone','Plan','Amount','Discount','Balance Due','Mode','Status','Join Date','Expiry'];
        const rows = filtered.map((m,i) => {
          const exp=expiryDate(m);
          const discount = parseFloat(m.discount_amount) || 0;
          const balance = parseFloat(m.balance_due) || 0;
          return [i+1, m.application_number||'—', m.full_name||'', m.phone||'', m.plan_name||'—',
            '₹'+Number(memberTotal(m)).toLocaleString('en-IN'),
            discount > 0 ? '-₹'+discount.toLocaleString('en-IN') : '—',
            balance > 0 ? '₹'+balance.toLocaleString('en-IN') : '—',
            m.payment_mode||'—', m.payment_status||'—',
            fmtDate(m.join_date), exp?fmtDate(exp.toISOString().split('T')[0]):'—'];
        });
        const meta = { 'Records':filtered.length, 'Collected':'₹'+Number(collected).toLocaleString('en-IN'), 'Pending':'₹'+Number(pending).toLocaleString('en-IN') };
        if (exportPDF('Payments Report', headers, rows, gymName.replace(/\s+/g,'_')+'_payments', meta, monthLabel)) showToast('Opening payments PDF…', 'green');
      } else {
        // Use real payment_history records
        const monthLabel = new Date(month+'-01').toLocaleDateString('en-IN',{month:'long',year:'numeric'});
        const total = records.reduce((s,r) => s + (parseFloat(r.amount)||0), 0);
        const cashT = records.filter(r=>r.payment_mode==='Cash').reduce((s,r)=>s+(parseFloat(r.amount)||0),0);
        const cardT = records.filter(r=>r.payment_mode==='Card').reduce((s,r)=>s+(parseFloat(r.amount)||0),0);
        const onlineT = records.filter(r=>r.payment_mode==='Online').reduce((s,r)=>s+(parseFloat(r.amount)||0),0);
        const headers = ['#','App #','Member','Phone','Plan','Amount','Mode','Date'];
        const rows = records.map((r,i) => {
          const name = r.members?.full_name || '—';
          const phone = r.members?.phone || '—';
          const linkedMember = allM.find(m => m.id === r.member_id);
          const appNo = linkedMember?.application_number || '—';
          const paidAt = r.paid_at ? fmtDate(r.paid_at) : '—';
          return [i+1, appNo, name, phone, r.plan_name||'—', '₹'+Number(parseFloat(r.amount)||0).toLocaleString('en-IN'), r.payment_mode||'—', paidAt];
        });
        const meta = { 'Total':'₹'+Number(total).toLocaleString('en-IN'), 'Cash':'₹'+Number(cashT).toLocaleString('en-IN'), 'Card':'₹'+Number(cardT).toLocaleString('en-IN'), 'Online':'₹'+Number(onlineT).toLocaleString('en-IN'), 'Records':records.length };
        if (exportPDF('Payments Report', headers, rows, gymName.replace(/\s+/g,'_')+'_payments_'+month, meta, monthLabel)) showToast('Opening payments PDF…', 'green');
      }
    } catch(err) { console.error('Payment export error:', err); showToast('Failed to export payments', 'red');
    } finally { if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export Payments (PDF)'; } }
  });

  // ── EXPENSES PDF EXPORT ─────────────────────────────────────────
  document.getElementById('btn-export-expenses-pdf')?.addEventListener('click', async () => {
    const month = document.getElementById('bk-e-month')?.value || curMonth;
    const category = document.getElementById('bk-e-category')?.value || 'all';
    const btn = document.getElementById('btn-export-expenses-pdf');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    try {
      let expenses = await getExpenses(S.gym.id, month);
      if (category !== 'all') expenses = expenses.filter(e => e.category === category);
      if (!expenses.length) { showToast('No expenses found for this month', 'amber'); return; }
      const monthLabel = new Date(month+'-01').toLocaleDateString('en-IN',{month:'long',year:'numeric'});
      const total = expenses.reduce((s,e) => s + (parseFloat(e.amount)||0), 0);
      const recurring = expenses.filter(e => e.is_recurring).length;
      const headers = ['#','Date','Category','Description','Amount','Recurring'];
      const rows = expenses.map((e,i) => {
        const d = new Date(e.expense_date+'T00:00:00');
        const catLabel = EXPENSE_CATEGORIES.find(c => c.id === e.category || c.label === e.category);
        return [i+1, d.toLocaleDateString('en-IN',{day:'2-digit',month:'short'}), catLabel?`${catLabel.icon} ${catLabel.label}`:e.category, e.description||'—', '₹'+(parseFloat(e.amount)||0).toLocaleString('en-IN'), e.is_recurring?'Yes':'No'];
      });
      const meta = { 'Total':'₹'+total.toLocaleString('en-IN'), 'Items':expenses.length, 'Recurring':recurring };
      if (exportPDF('Expenses Report', headers, rows, gymName.replace(/\s+/g,'_')+'_expenses_'+month, meta, monthLabel+(category!=='all'?' · '+category:'')))
        showToast('Opening expenses PDF…', 'green');
    } catch(err) { console.error('Expense PDF error:', err); showToast('Failed to export expenses', 'red');
    } finally { if (btn) { btn.disabled = false; btn.textContent = 'PDF Report'; } }
  });

  // ── EXPENSES CSV EXPORT ─────────────────────────────────────────
  document.getElementById('btn-export-expenses-csv')?.addEventListener('click', async () => {
    const month = document.getElementById('bk-e-month')?.value || curMonth;
    const category = document.getElementById('bk-e-category')?.value || 'all';
    const btn = document.getElementById('btn-export-expenses-csv');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    try {
      let expenses = await getExpenses(S.gym.id, month);
      if (category !== 'all') expenses = expenses.filter(e => e.category === category);
      if (!expenses.length) { showToast('No expenses found for this month', 'amber'); return; }
      const csvRows = ['Date,Category,Description,Amount,Recurring'];
      expenses.forEach(e => {
        const catLabel = EXPENSE_CATEGORIES.find(c => c.id === e.category || c.label === e.category);
        const catName = catLabel ? catLabel.label : e.category;
        const desc = (e.description||'').replace(/"/g,'""');
        const d = new Date(e.expense_date+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'});
        csvRows.push(`${d},"${catName}","${desc}",${parseFloat(e.amount)||0},${e.is_recurring?'Yes':'No'}`);
      });
      const total = expenses.reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
      csvRows.push(`,,Total,${total},`);
      const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const monthLabel = new Date(month+'-01').toLocaleDateString('en-IN',{month:'short',year:'numeric'}).replace(' ','-');
      const a = document.createElement('a');
      a.href = url; a.download = `expenses-${gymName.replace(/\s+/g,'-').toLowerCase()}-${monthLabel}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      showToast('CSV downloaded', 'green');
    } catch(err) { console.error('Expense CSV error:', err); showToast('Failed to export CSV', 'red');
    } finally { if (btn) { btn.disabled = false; btn.textContent = 'CSV for Accountant'; } }
  });

  // ── YEAR-END SUMMARY ───────────────────────────────────────────
  document.getElementById('btn-export-yearend')?.addEventListener('click', async () => {
    const year = parseInt(document.getElementById('bk-year')?.value || curYear);
    const btn = document.getElementById('btn-export-yearend');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    try {
      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;
      const [yearExpenses, yearPayments] = await Promise.all([
        getExpensesByRange(S.gym.id, startDate, endDate),
        getPaymentHistory(S.gym.id).catch(() => []),
      ]);

      // Revenue by month — from actual payment_history, not member plan prices
      const monthlyData = [];
      for (let mo = 0; mo < 12; mo++) {
        const mStart = new Date(year, mo, 1);
        const mEnd = new Date(year, mo + 1, 0, 23, 59, 59, 999);
        const label = mStart.toLocaleDateString('en-IN', { month: 'short' });
        const rev = (yearPayments||[]).filter(p => {
          if (!p.paid_at) return false;
          const pd = new Date(p.paid_at);
          return pd >= mStart && pd <= mEnd;
        }).reduce((s,p) => s + (parseFloat(p.amount)||0), 0);
        const mKey = `${year}-${String(mo+1).padStart(2,'0')}`;
        const exp = yearExpenses.filter(e => e.expense_month === mKey).reduce((s,e) => s + (parseFloat(e.amount)||0), 0);
        monthlyData.push({ label, rev, exp, profit: rev - exp });
      }

      const totalRev = monthlyData.reduce((s,m) => s + m.rev, 0);
      const totalExp = monthlyData.reduce((s,m) => s + m.exp, 0);
      const totalProfit = totalRev - totalExp;

      // Category breakdown
      const catTotals = {};
      yearExpenses.forEach(e => { catTotals[e.category] = (catTotals[e.category]||0) + (parseFloat(e.amount)||0); });
      const sortedCats = Object.entries(catTotals).sort((a,b) => b[1]-a[1]);

      // Member stats
      const allM = await exportMembers();
      const totalMembers = allM.length;
      const activeMembers = allM.filter(m => memberStatus(m) === 'Active').length;
      const newThisYear = allM.filter(m => m.join_date && m.join_date.startsWith(String(year))).length;

      const headers = ['Month', 'Revenue', 'Expenses', 'Net Profit'];
      const rows = monthlyData.map(m => [m.label, '₹'+m.rev.toLocaleString('en-IN'), '₹'+m.exp.toLocaleString('en-IN'), '₹'+m.profit.toLocaleString('en-IN')]);
      rows.push(['TOTAL', '₹'+totalRev.toLocaleString('en-IN'), '₹'+totalExp.toLocaleString('en-IN'), '₹'+totalProfit.toLocaleString('en-IN')]);

      if (sortedCats.length > 0) {
        rows.push(['', '', '', '']);
        rows.push(['Top Expense Categories', '', '', '']);
        sortedCats.slice(0, 8).forEach(([cat, amt]) => {
          const pct = totalExp > 0 ? Math.round((amt/totalExp)*100) : 0;
          const catLabel = EXPENSE_CATEGORIES.find(c => c.id === cat || c.label === cat);
          rows.push([catLabel ? catLabel.label : cat, '₹'+amt.toLocaleString('en-IN'), pct + '%', '']);
        });
      }

      const newLabel = `New (${year})`;
      const meta = {
        'Revenue': '₹'+totalRev.toLocaleString('en-IN'),
        'Expenses': '₹'+totalExp.toLocaleString('en-IN'),
        'Net Profit': '₹'+totalProfit.toLocaleString('en-IN'),
        'Members': totalMembers,
        'Active': activeMembers,
        [newLabel]: newThisYear,
      };
      const fn = gymName.replace(/\s+/g,'_') + '_year_end_' + year;
      if (exportPDF('Year-End Financial Summary — ' + year, headers, rows, fn, meta, 'Financial Year ' + year))
        showToast('Opening year-end summary…', 'green');
    } catch(err) { console.error('Year-end export error:', err); showToast('Failed to generate year-end summary', 'red');
    } finally { if (btn) { btn.disabled = false; btn.textContent = 'Export Year-End Summary (PDF)'; } }
  });

  // ── MEMBERS CSV EXPORT ──────────────────────────────────────────
  document.getElementById('btn-export-members-csv')?.addEventListener('click', async () => {
    const opts = {
      status: document.getElementById('bk-m-status')?.value || 'all',
      payMode: document.getElementById('bk-m-paymode')?.value || 'all',
      plan: document.getElementById('bk-m-plan')?.value || 'all',
      payStatus: document.getElementById('bk-m-paystatus')?.value || 'all',
    };
    const filtered = filterMembersForExport(await exportMembers(), opts);
    if (!filtered.length) { showToast('No members match these filters', 'amber'); return; }
    const headers = ['App #','Name','Phone','Join Date','Plan','Price','Discount','Balance Due','Expiry','Payment Mode','Payment Status','Member Type'];
    const rows = filtered.map(m => {
      const exp = expiryDate(m);
      const discount = parseFloat(m.discount_amount) || 0;
      const balance = parseFloat(m.balance_due) || 0;
      return [m.application_number||'', m.full_name||'', m.phone||'', fmtDate(m.join_date), m.plan_name||'', m.plan_price||'',
        discount || '', balance || '',
        exp ? fmtDate(exp.toISOString().split('T')[0]) : '', m.payment_mode||'', m.payment_status||'', m.member_type||'Paid'];
    });
    downloadCSV(headers, rows, gymName.replace(/\s+/g,'_') + '_members');
    showToast('CSV downloaded — open in Excel', 'green');
  });

  // ── OUTSTANDING PAYMENTS REPORT ───────────────────────────────
  document.getElementById('btn-outstanding')?.addEventListener('click', async () => {
    const outstanding = (await exportMembers()).filter(m => !m.cancelled_at && (m.payment_status === 'Due' || m.payment_status === 'Partial'));
    if (!outstanding.length) { showToast('No outstanding payments', 'green'); return; }
    const headers = ['#','App #','Name','Phone','Plan','Total','Paid','Balance Due','Status','Join Date'];
    const rows = outstanding.map((m, i) => {
      const total = parseFloat(m.plan_price) || 0;
      const balance = parseFloat((m.balance_due ?? total)) || 0;
      const paid = total - balance;
      return [i+1, m.application_number||'—', m.full_name||'', m.phone||'', m.plan_name||'',
        '₹'+total.toLocaleString('en-IN'), '₹'+paid.toLocaleString('en-IN'),
        '₹'+balance.toLocaleString('en-IN'), m.payment_status||'Due', fmtDate(m.join_date)];
    });
    const totalBal = outstanding.reduce((s,m) => s + outstandingAmount(m), 0);
    const meta = { 'Members': outstanding.length, 'Total Outstanding': '₹'+totalBal.toLocaleString('en-IN') };
    exportPDF('Outstanding Payments Report', headers, rows, gymName.replace(/\s+/g,'_') + '_outstanding', meta);
    showToast('Opening outstanding payments report', 'green');
  });

  // ── P&L REPORT ────────────────────────────────────────────────
  document.getElementById('btn-pnl')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-pnl');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    try {
      const year = parseInt(document.getElementById('bk-year')?.value) || curYear;
      const [allExpenses, payHistory] = await Promise.all([
        getAllExpenses(S.gym.id).catch(() => []),
        getPaymentHistory(S.gym.id).catch(() => []),
      ]);
      const months = [];
      for (let mo = 0; mo < 12; mo++) {
        const label = new Date(year, mo, 1).toLocaleString('en-IN', { month: 'short' });
        const rev = (payHistory||[]).filter(p => { const d = new Date(p.paid_at); return d.getMonth() === mo && d.getFullYear() === year; })
          .reduce((s,p) => s + (parseFloat(p.amount)||0), 0);
        const exp = (allExpenses||[]).filter(e => { const d = new Date(e.expense_date); return d.getMonth() === mo && d.getFullYear() === year; })
          .reduce((s,e) => s + (parseFloat(e.amount)||0), 0);
        months.push([label, '₹'+rev.toLocaleString('en-IN'), '₹'+exp.toLocaleString('en-IN'), '₹'+(rev-exp).toLocaleString('en-IN')]);
      }
      const totalRev = months.reduce((s,r) => s + parseInt(r[1].replace(/[^\d]/g,'')), 0);
      const totalExp = months.reduce((s,r) => s + parseInt(r[2].replace(/[^\d]/g,'')), 0);
      months.push(['TOTAL', '₹'+totalRev.toLocaleString('en-IN'), '₹'+totalExp.toLocaleString('en-IN'), '₹'+(totalRev-totalExp).toLocaleString('en-IN')]);
      const meta = { Revenue: '₹'+totalRev.toLocaleString('en-IN'), Expenses: '₹'+totalExp.toLocaleString('en-IN'), 'Net Profit': '₹'+(totalRev-totalExp).toLocaleString('en-IN') };
      exportPDF('Profit & Loss Statement — ' + year, ['Month','Revenue','Expenses','Net Profit'], months, gymName.replace(/\s+/g,'_') + '_pnl_' + year, meta);
      showToast('P&L report ready', 'green');
    } catch(err) { showToast('Failed: ' + (err.message||''), 'red'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'P&L Report'; } }
  });

  // ── GST SUMMARY REPORT ────────────────────────────────────────
  document.getElementById('btn-gst-summary')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-gst-summary');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    try {
      const year = parseInt(document.getElementById('bk-year')?.value) || curYear;
      const gstPct = parseFloat(S.gym?.gst_percentage) || 18;
      const halfPct = gstPct / 2;
      const payHistory = await getPaymentHistory(S.gym.id).catch(() => []);
      const months = [];
      for (let mo = 0; mo < 12; mo++) {
        const label = new Date(year, mo, 1).toLocaleString('en-IN', { month: 'short' });
        const rev = (payHistory||[]).filter(p => { const d = new Date(p.paid_at); return d.getMonth() === mo && d.getFullYear() === year; })
          .reduce((s,p) => s + (parseFloat(p.amount)||0), 0);
        if (rev === 0) continue;
        const base = rev / (1 + gstPct/100);
        const gst = rev - base;
        months.push([label, '₹'+rev.toLocaleString('en-IN'), '₹'+base.toFixed(0), '₹'+(gst/2).toFixed(0), '₹'+(gst/2).toFixed(0), '₹'+gst.toFixed(0)]);
      }
      const headers = ['Month', 'Total', 'Taxable', 'CGST @'+halfPct+'%', 'SGST @'+halfPct+'%', 'Total GST'];
      exportPDF('GST Summary — ' + year, headers, months, gymName.replace(/\s+/g,'_') + '_gst_' + year, { 'GST Rate': gstPct + '%', 'GSTIN': S.gym?.gstin || 'Not set' });
      showToast('GST summary ready', 'green');
    } catch(err) { showToast('Failed: ' + (err.message||''), 'red'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'GST Summary'; } }
  });

  // ── CSV DOWNLOAD HELPER ───────────────────────────────────────
  function downloadCSV(headers, rows, filename) {
    const BOM = '﻿'; // Excel UTF-8 BOM
    const escape = (v) => { const s = String(v ?? ''); return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = BOM + [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── FULL JSON BACKUP ────────────────────────────────────────────
  document.getElementById('btn-full-backup')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-full-backup');
    if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
    try {
      const [allExpenses, payHistory, allM] = await Promise.all([
        getAllExpenses(S.gym.id).catch(() => []),
        getPaymentHistory(S.gym.id).catch(() => []),
        exportMembers(),
      ]);
      const backup = {
        exported_at: new Date().toISOString(),
        gym: { name: S.gym?.name, gym_code: S.gym?.gym_code, id: S.gym?.id },
        members: allM.map(m => ({ application_number:m.application_number, full_name:m.full_name, phone:m.phone, email:m.email, date_of_birth:m.date_of_birth, gender:m.gender, plan_name:m.plan_name, plan_price:m.plan_price, discount_amount:m.discount_amount, balance_due:m.balance_due, member_type:m.member_type, payment_mode:m.payment_mode, payment_status:m.payment_status, join_date:m.join_date, expiry_date:m.expiry_date, member_addons:m.member_addons, notes:m.notes, is_active:m.is_active, cancelled_at:m.cancelled_at })),
        plans: S.plans.map(p => ({ name:p.name, price:p.price, duration_months:p.duration_months, features:p.features, is_featured:p.is_featured, is_active:p.is_active })),
        addon_templates: (S.addonTemplates||[]).map(t => ({ name:t.name, default_price:t.default_price, is_one_time:t.is_one_time, is_active:t.is_active })),
        expenses: (allExpenses||[]).map(e => ({ category:e.category, description:e.description, amount:e.amount, expense_date:e.expense_date, expense_month:e.expense_month, is_recurring:e.is_recurring })),
        payment_history: (payHistory||[]).map(p => ({ amount:p.amount, payment_mode:p.payment_mode, plan_name:p.plan_name, paid_at:p.paid_at, member_name:p.members?.full_name })),
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const dateStr = new Date().toISOString().slice(0,10);
      const a = document.createElement('a');
      a.href = url; a.download = `flym-backup-${gymName.replace(/\s+/g,'-').toLowerCase()}-${dateStr}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      showToast('Backup downloaded', 'green');
    } catch(err) { console.error('Backup error:', err); showToast('Failed to create backup', 'red');
    } finally { if (btn) { btn.disabled = false; btn.textContent = 'JSON Backup'; } }
  });

  // ── FULL BACKUP AS PDF ──────────────────────────────────────────
  document.getElementById('btn-full-backup-pdf')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-full-backup-pdf');
    if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
    try {
      const [allExpenses, payHistory, allM] = await Promise.all([
        getAllExpenses(S.gym.id).catch(() => []),
        getPaymentHistory(S.gym.id).catch(() => []),
        exportMembers(),
      ]);
      const dateStr = fmtDate(new Date().toISOString().split('T')[0]);

      // Members section
      const mHeaders = ['App #','Name','Phone','Plan','Price','Discount','Balance Due','Type','Payment','Status','Join','Expiry','Cancelled'];
      const mRows = allM.map(m => {
        const discount = parseFloat(m.discount_amount) || 0;
        const balance = parseFloat(m.balance_due) || 0;
        return [
          m.application_number||'—', m.full_name||'', m.phone||'', m.plan_name||'—',
          m.plan_price ? '₹'+Number(m.plan_price).toLocaleString('en-IN') : '—',
          discount > 0 ? '-₹'+discount.toLocaleString('en-IN') : '—',
          balance > 0 ? '₹'+balance.toLocaleString('en-IN') : '—',
          m.member_type||'Paid', m.payment_mode||'—', m.payment_status||'—',
          fmtDate(m.join_date), fmtDate(m.expiry_date),
          m.cancelled_at ? fmtDate(m.cancelled_at) : '—'
        ];
      });

      // Plans section
      const pHeaders = ['Plan Name','Duration','Price','Featured'];
      const pRows = S.plans.map(p => [
        p.name||'', (p.duration_months||1)+' months',
        '₹'+Number(p.price).toLocaleString('en-IN'),
        p.is_featured ? 'Yes' : 'No'
      ]);

      // Expenses summary
      const eHeaders = ['Date','Category','Description','Amount','Recurring'];
      const eRows = (allExpenses||[]).slice(0,200).map(e => [
        fmtDate(e.expense_date), e.category||'', e.description||'',
        '₹'+Number(e.amount).toLocaleString('en-IN'),
        e.is_recurring ? 'Yes' : 'No'
      ]);

      // Payment history
      const phHeaders = ['Date','App #','Member','Plan','Amount','Mode'];
      const phRows = (payHistory||[]).slice(0,200).map(p => {
        const linkedMember = allM.find(m => m.id === p.member_id);
        return [
          p.paid_at ? fmtDate(p.paid_at) : '—',
          linkedMember?.application_number || '—',
          p.members?.full_name||'—', p.plan_name||'—',
          '₹'+Number(p.amount).toLocaleString('en-IN'),
          p.payment_mode||'—'
        ];
      });

      function makeTable(headers, rows) {
        const hdr = headers.map(h => `<th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:600;color:#fff;background:#1A6FD4;text-transform:uppercase;letter-spacing:0.04em;white-space:nowrap;">${escHtml(h)}</th>`).join('');
        const body = rows.length
          ? rows.map((r,i) => `<tr style="background:${i%2?'#f9fafb':'#fff'};page-break-inside:avoid;">${r.map(cell => `<td style="padding:6px 10px;font-size:10px;color:#222;border-bottom:1px solid #eee;">${escHtml(String(cell))}</td>`).join('')}</tr>`).join('')
          : `<tr><td colspan="${headers.length}" style="padding:20px;text-align:center;color:#999;font-size:11px;">No records</td></tr>`;
        return `<table style="width:100%;border-collapse:collapse;margin-bottom:6px;"><thead><tr>${hdr}</tr></thead><tbody>${body}</tbody></table>`;
      }

      const totalRev = (payHistory||[]).reduce((s,p)=>s+(parseFloat(p.amount)||0),0);
      const totalExp = (allExpenses||[]).reduce((s,e)=>s+parseFloat(e.amount||0),0);
      const totalOutstanding = allM.filter(m=>!m.cancelled_at&&(m.payment_status==='Due'||m.payment_status==='Partial'))
        .reduce((s,m)=>s+outstandingAmount(m),0);
      const totalDiscount = allM.reduce((s,m)=>s+(parseFloat(m.discount_amount)||0),0);
      const cancelledCount = allM.filter(m=>m.cancelled_at).length;
      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Full Backup — ${escHtml(gymName)}</title>
<style>@page{size:A4 landscape;margin:10mm;}*{box-sizing:border-box;}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#222;margin:0;padding:20px;background:#fff;font-size:11px;}table{width:100%;border-collapse:collapse;}h2{font-size:15px;color:#1A6FD4;margin:20px 0 8px;border-bottom:2px solid #1A6FD4;padding-bottom:4px;}@media print{body{padding:0;}.no-print{display:none!important;}}</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;border-bottom:2px solid #1A6FD4;padding-bottom:12px;">
  <div><div style="font-size:24px;font-weight:200;color:#1A6FD4;">flym</div><div style="font-size:9px;color:#888;text-transform:uppercase;letter-spacing:0.15em;margin-top:3px;">Complete Data Backup</div></div>
  <div style="text-align:right;font-size:10px;color:#666;line-height:1.6;"><strong style="color:#222;font-size:12px;">${escHtml(gymName)}</strong><br>${gymCode?escHtml(gymCode)+'<br>':''}Generated: ${escHtml(dateStr)}</div>
</div>
<div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:18px;padding:10px 14px;background:#f4f7fb;border-left:3px solid #1A6FD4;border-radius:4px;">
  <div><div style="font-size:9px;color:#888;text-transform:uppercase;">Total Members</div><div style="font-size:14px;font-weight:600;">${allM.length}</div></div>
  <div><div style="font-size:9px;color:#888;text-transform:uppercase;">Active Plans</div><div style="font-size:14px;font-weight:600;">${S.plans.length}</div></div>
  <div><div style="font-size:9px;color:#888;text-transform:uppercase;">Total Revenue</div><div style="font-size:14px;font-weight:600;">₹${totalRev.toLocaleString('en-IN')}</div></div>
  <div><div style="font-size:9px;color:#888;text-transform:uppercase;">Total Expenses</div><div style="font-size:14px;font-weight:600;">₹${totalExp.toLocaleString('en-IN')}</div></div>
  <div><div style="font-size:9px;color:#888;text-transform:uppercase;">Outstanding</div><div style="font-size:14px;font-weight:600;color:#c00;">₹${totalOutstanding.toLocaleString('en-IN')}</div></div>
  <div><div style="font-size:9px;color:#888;text-transform:uppercase;">Discounts Given</div><div style="font-size:14px;font-weight:600;">₹${totalDiscount.toLocaleString('en-IN')}</div></div>
  ${cancelledCount > 0 ? `<div><div style="font-size:9px;color:#888;text-transform:uppercase;">Cancelled</div><div style="font-size:14px;font-weight:600;color:#c00;">${cancelledCount}</div></div>` : ''}
</div>
<h2>Members (${allM.length})</h2>${makeTable(mHeaders, mRows)}
<h2>Plans (${S.plans.length})</h2>${makeTable(pHeaders, pRows)}
<h2>Expenses (${(allExpenses||[]).length})</h2>${makeTable(eHeaders, eRows)}
<h2>Payment History (${(payHistory||[]).length})</h2>${makeTable(phHeaders, phRows)}
<div style="margin-top:24px;padding-top:10px;border-top:1px solid #ddd;font-size:9px;color:#999;text-align:center;">Generated by Flym · ${escHtml(gymName)} · ${escHtml(dateStr)} · Confidential</div>
</body></html>`;
      showPrintPreview('Full Data Backup', html);
      showToast('Backup ready — tap Print to save', 'green');
    } catch(err) { console.error('PDF backup error:', err); showToast('Failed to create PDF backup', 'red');
    } finally { if (btn) { btn.disabled = false; btn.textContent = 'PDF Report'; } }
  });
}


export { renderBackup };
