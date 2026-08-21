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

export async function renderMemberReceipts(container, membership) {
  container.innerHTML = `<div class="loading-inline"><div class="spinner"></div></div>`;

  const [payments, files] = await Promise.all([
    getMyReceipts().catch((err) => { console.error('[Sculpt] getMyReceipts failed:', err.message); return []; }),
    listMemberInvoices(membership.gym_id, membership.member_id).catch(() => []),
  ]);

  if (!payments.length) {
    container.innerHTML = `<div class="mp-empty">No payments recorded yet.</div>`;
    return;
  }

  container.innerHTML = `
    ${files.length ? `
      <div class="mp-receipts-files">
        <div class="mp-section-label">Downloadable Receipts</div>
        ${files.map(f => `
          <a class="mp-file-row" href="${escHtml(f.url)}" target="_blank" rel="noopener">
            <span>${escHtml(f.name)}</span>
            <span class="mp-file-download">Download →</span>
          </a>`).join('')}
      </div>` : ''}
    <div class="mp-section-label">Payment History</div>
    <div class="mp-visit-list">
      ${payments.map(p => `
        <div class="mp-visit-row">
          <div>
            <div class="mp-visit-date">${escHtml(fmtDate(p.paid_at))}</div>
            <div style="font-size:11px;color:var(--text-tertiary);">${escHtml(p.plan_name || p.notes || 'Payment')}</div>
          </div>
          <div style="font-weight:700;color:var(--text-primary);">₹${Number(p.amount || 0).toLocaleString('en-IN')}</div>
        </div>`).join('')}
    </div>`;
}
