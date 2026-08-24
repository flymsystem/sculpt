// src/pages/member/receipts.js — My Receipts tab.
//
// Two independent lists shown together: the payment_history rows
// (always accurate — every payment has one) and any already-generated
// PDF files in the member's own storage folder (best-effort — see the
// comment on sculpt_my_receipts() in migration 108 for why there's no
// durable link between the two).
import { getMyReceipts } from '../../lib/member-auth.js';
import { listMemberInvoices } from '../../lib/invoices.js';
import { escHtml, fmtDate } from '../dashboard/helpers.js';

// `fixture` (optional { payments, files }) lets a test render every state
// deterministically without a live session — see the window.__sculptMemberPortal
// hook in ./index.js, same convention as window.__sculptCheckin.
export async function renderMemberReceipts(container, membership, fixture) {
  let payments, files;
  if (fixture) {
    ({ payments = [], files = [] } = fixture);
  } else {
    container.innerHTML = `<div class="loading-inline"><div class="spinner"></div></div>`;
    [payments, files] = await Promise.all([
      getMyReceipts().catch((err) => { console.error('[Sculpt] getMyReceipts failed:', err.message); return []; }),
      listMemberInvoices(membership.gym_id, membership.member_id).catch(() => []),
    ]);
  }

  const header = `
    <div class="mp-page-header">
      <div class="mp-page-title">Receipts</div>
      <div class="mp-page-sub">Your complete payment history for this membership.</div>
    </div>`;

  if (!payments.length) {
    container.innerHTML = `
      ${header}
      <div class="mp-empty">
        <div class="mp-empty-icon">🧾</div>
        <div class="mp-empty-title">No receipts yet</div>
        <div class="mp-empty-sub">Your payment history will appear here once your first payment is recorded.</div>
      </div>`;
    return;
  }

  // There is no durable link between a payment_history row and a
  // generated PDF (see the comment on sculpt_my_receipts() in migration
  // 108) — the payment list is always accurate, the file list is
  // best-effort, so they're shown as two honest sections rather than
  // guessing which PDF belongs to which payment.
  container.innerHTML = `
    ${header}
    <div class="mp-page-count">${payments.length} receipt${payments.length === 1 ? '' : 's'}</div>
    <div class="mp-receipt-list">
      ${payments.map(p => `
        <div class="mp-receipt-card">
          <div class="mp-receipt-card-main">
            <div class="mp-receipt-plan">${escHtml(p.plan_name || p.notes || 'Payment')}</div>
            <div class="mp-receipt-date">${escHtml(fmtDate(p.paid_at))}</div>
          </div>
          <div class="mp-receipt-card-side">
            <div class="mp-receipt-amount">₹${Number(p.amount || 0).toLocaleString('en-IN')}</div>
            <div class="mp-receipt-status">Paid</div>
          </div>
        </div>`).join('')}
    </div>
    ${files.length ? `
      <div class="mp-section-label">Downloadable Receipts</div>
      <div class="mp-receipts-files">
        ${files.map(f => `
          <a class="mp-file-row" href="${escHtml(f.url)}" target="_blank" rel="noopener">
            <span>${escHtml(f.name)}</span>
            <span class="mp-file-download">View / Download →</span>
          </a>`).join('')}
      </div>` : ''}`;
}
