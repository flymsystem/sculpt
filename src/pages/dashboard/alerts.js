import { S } from './state.js';
import { expiryDate, memberStatus, escHtml, escAttr, av2, fmtDate, fmtCurrency, timeAgo, outstandingAmount } from './helpers.js';
import { scard } from './overview.js';
import { openRenewModal, openInvoiceModal, openWAModal, openMemberDetailModal } from './member-modals.js';
import { callBtn, formatPhone, normalizePhone } from '../../components/call-button.js';
import { getLastReminders } from '../../lib/members.js';
import { showConfirm } from '../../components/confirm.js';

// A repeat reminder inside this window needs an explicit confirm instead
// of firing immediately — AUDIT.md C8: nothing stopped a staff member
// from tapping Remind on the same member 5 times in a row, each one
// opening a fresh WhatsApp compose window.
const REMINDER_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours

// One card per alerting member, all built into a single innerHTML
// string, was fine at 200 members. At 100,000 with a realistic 25%
// expired/due rate it is 25,000 cards in one write: the tab hangs and
// then dies. Even 500 cards is a visible multi-second freeze on a cheap
// phone, and a page that scrolls badly forever afterwards.
const ALERTS_PAGE_SIZE = 50;

function renderMemberAlerts(c) {
  const reminderDays = S.gym?.reminder_days || 7;
  let alertFilter = 'all';
  let sortBy = 'urgency';
  let page = 1;
  let lastReminders = {}; // member_id -> ISO timestamp of most recent reminder, loaded async below

  if (S.gym?.id) {
    getLastReminders(S.gym.id).then(map => {
      lastReminders = map;
      render();
    }).catch(() => {});
  }

  // ── Helper: does this member have a pending payment? ──────────
  // Uses payment_status directly (not memberStatus) so expired members
  // with outstanding dues are included — matching Finance logic.
  function hasPendingPayment(m) {
    return !m.cancelled_at && (m.payment_status === 'Due' || m.payment_status === 'Partial');
  }

  function getAlertMembers() {
    return S.members.filter(m => {
      const st = memberStatus(m);
      // Include: Expired, Expiring, Due (via memberStatus), OR has pending payment
      return st === 'Expired' || st === 'Expiring' || st === 'Due' || hasPendingPayment(m);
    }).sort((a, b) => {
      if (sortBy === 'name') return (a.full_name || '').localeCompare(b.full_name || '');
      if (sortBy === 'amount') return outstandingAmount(b) - outstandingAmount(a);
      const ea = expiryDate(a), eb = expiryDate(b);
      if (ea && eb) return ea - eb;
      if (ea) return -1;
      return 1;
    });
  }

  function filteredAlerts() {
    const all = getAlertMembers();
    if (alertFilter === 'all') return all;
    if (alertFilter === 'expired') return all.filter(m => memberStatus(m) === 'Expired');
    if (alertFilter === 'expiring') return all.filter(m => memberStatus(m) === 'Expiring');
    // "Due" pill: members with pending payment (payment_status check, not memberStatus)
    if (alertFilter === 'due') return all.filter(m => hasPendingPayment(m));
    return all;
  }

  function render() {
    const allAlerts = getAlertMembers();
    const expired = allAlerts.filter(m => memberStatus(m) === 'Expired').length;
    const expiring = allAlerts.filter(m => memberStatus(m) === 'Expiring').length;
    // Payment Due count: members with actual outstanding payment, matches Finance
    const due = allAlerts.filter(m => hasPendingPayment(m)).length;
    const totalDue = allAlerts.filter(m => !m.cancelled_at).reduce((s, m) => s + outstandingAmount(m), 0);
    const list = filteredAlerts();
    const callable = allAlerts.filter(m => normalizePhone(m.phone)).length;
    const noPhoneCount = allAlerts.length - callable;

    const totalPages = Math.max(1, Math.ceil(list.length / ALERTS_PAGE_SIZE));
    if (page > totalPages) page = totalPages;
    const pageStart = (page - 1) * ALERTS_PAGE_SIZE;
    const pageList  = list.slice(pageStart, pageStart + ALERTS_PAGE_SIZE);

    c.innerHTML = `<div class="content-inner page-enter">
      <div class="page-header">
        <div class="page-header-left">
          <div class="page-title">Member Alerts</div>
          <div class="page-sub">${allAlerts.length} member${allAlerts.length !== 1 ? 's' : ''} need attention · ${fmtCurrency(totalDue)} outstanding${callable ? ` · <span title="${noPhoneCount} of ${allAlerts.length} have no phone number on file and can't be called">${callable} callable</span>` : ''}</div>
        </div>
      </div>

      <div class="grid-4" style="margin-bottom:var(--space-6);">
        ${scard('All Alerts', allAlerts.length, 'var(--brand)', fmtCurrency(totalDue) + ' total')}
        ${scard('Expired', expired, 'var(--red)', expired > 0 ? 'Past expiry date' : 'None')}
        ${scard('Expiring', expiring, 'var(--amber)', 'Within ' + reminderDays + ' days')}
        ${scard('Payment Due', due, 'var(--purple)', due > 0 ? due + ' unpaid' : 'No unpaid members')}
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);margin-bottom:var(--space-5);flex-wrap:wrap;">
        <div class="filter-pills">
          ${['all', 'expired', 'expiring', 'due'].map(f =>
            `<button class="filter-pill alert-filter-pill ${alertFilter === f ? 'active' : ''}" data-filter="${f}">${f === 'all' ? 'All (' + allAlerts.length + ')' : f === 'expired' ? 'Expired (' + expired + ')' : f === 'expiring' ? 'Expiring (' + expiring + ')' : 'Due (' + due + ')'}</button>`
          ).join('')}
        </div>
        <select class="filter-select" id="alert-sort" style="min-width:140px;">
          <option value="urgency" ${sortBy === 'urgency' ? 'selected' : ''}>Most Urgent</option>
          <option value="name" ${sortBy === 'name' ? 'selected' : ''}>Name A-Z</option>
          <option value="amount" ${sortBy === 'amount' ? 'selected' : ''}>Highest Amount</option>
        </select>
      </div>

      <div id="alert-cards-container">
        ${list.length === 0
          ? `<div class="empty-state" style="padding:60px;">
              <span class="empty-icon">✅</span>
              <div class="empty-title">All clear!</div>
              <p>No alerts match this filter. Your members are in good standing.</p>
            </div>`
          : pageList.map((m, i) => renderAlertCard(m, i)).join('')}
      </div>

      ${list.length > 0 ? `<div style="margin-top:var(--space-5);padding:var(--space-4) var(--space-5);background:var(--surface-1);border:1px solid var(--border-subtle);border-radius:var(--radius-md);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-3);">
        <div style="font-size:var(--text-sm);color:var(--text-tertiary);">Showing ${pageStart + 1}–${pageStart + pageList.length} of ${list.length}${list.length !== allAlerts.length ? ' filtered' : ''} alert${list.length !== 1 ? 's' : ''}</div>
        ${totalPages > 1 ? `<div style="display:flex;gap:var(--space-2);align-items:center;">
          <button class="btn btn-ghost btn-sm" id="alert-prev" type="button" ${page <= 1 ? 'disabled aria-disabled="true"' : ''} style="padding:4px 10px;font-size:12px;" aria-label="Previous page of alerts">← Prev</button>
          <span style="font-size:12px;font-weight:500;color:var(--text-secondary);" aria-live="polite">Page ${page} of ${totalPages}</span>
          <button class="btn btn-ghost btn-sm" id="alert-next" type="button" ${page >= totalPages ? 'disabled aria-disabled="true"' : ''} style="padding:4px 10px;font-size:12px;" aria-label="Next page of alerts">Next →</button>
        </div>` : ''}
        <div style="font-size:var(--text-sm);font-weight:600;color:var(--text-primary);">Total Outstanding: ${fmtCurrency(totalDue)}</div>
      </div>` : ''}
    </div>`;

    document.querySelectorAll('.alert-filter-pill').forEach(pill => {
      pill.addEventListener('click', () => { alertFilter = pill.dataset.filter; page = 1; render(); });
    });
    document.getElementById('alert-sort')?.addEventListener('change', (e) => {
      sortBy = e.target.value; page = 1; render();
    });
    document.getElementById('alert-prev')?.addEventListener('click', () => {
      if (page > 1) { page--; render(); c.scrollIntoView?.({ block: 'start' }); }
    });
    document.getElementById('alert-next')?.addEventListener('click', () => {
      page++; render(); c.scrollIntoView?.({ block: 'start' });
    });
  }

  function renderAlertCard(m, idx) {
    const st = memberStatus(m);
    const exp = expiryDate(m);
    const mType = m.member_type || m.memberType || 'Paid';
    const isTrialMember = mType === 'Trial';
    const isPendingPayment = hasPendingPayment(m);
    const tel = normalizePhone(m.phone);

    let accentColor, statusText;
    if (st === 'Expired') {
      const daysAgo = exp ? Math.abs(Math.ceil((exp - new Date()) / 86400000)) : 0;
      accentColor = daysAgo > 14 ? 'var(--red)' : 'var(--amber)';
      statusText = 'Expired ' + daysAgo + 'd ago';
    } else if (st === 'Expiring') {
      const dl = exp ? Math.ceil((exp - new Date()) / 86400000) : 0;
      accentColor = dl <= 2 ? 'var(--red)' : 'var(--amber)';
      statusText = dl === 0 ? 'Expires today' : dl === 1 ? 'Expires tomorrow' : 'Expiring in ' + dl + 'd';
    } else {
      accentColor = 'var(--purple)';
      statusText = 'Payment Due';
    }

    // Show payment due badge alongside status for expired members with pending payment
    const paymentDueBadge = isPendingPayment && st === 'Expired'
      ? ` <span class="badge badge-purple badge-dot">Payment Due</span>`
      : '';

    const fmtExp = exp ? fmtDate(exp.toISOString().split('T')[0]) : '—';
    const amount = outstandingAmount(m);
    const lastReminderISO = lastReminders[m.id];

    // Invoice only makes sense as a live document when money is actually
    // owed; an expired member with ₹0 outstanding has nothing to invoice
    // — AUDIT.md C8. Those rows get a "Details" action (opens the full
    // member record) instead, and Invoice moves out of the primary slot
    // for everyone else too — Renew is the one action that actually
    // resolves an alert.
    const showInvoice = amount > 0;

    return `<div class="alert-card ${st === 'Expired' ? 'critical' : ''}" style="border-left-color:${accentColor};margin-bottom:var(--space-3);animation:fadeUp ${Math.min(150 + idx * 30, 400)}ms var(--ease-out) both;">
      <div style="display:flex;align-items:center;gap:14px;flex:1;min-width:0;">
        ${m.photo_url
          ? `<div class="member-avatar" style="overflow:hidden;padding:0;"><img src="${escHtml(m.photo_url)}" alt="" style="width:100%;height:100%;object-fit:cover;"></div>`
          : `<div class="member-avatar">${av2(m.full_name || m.name)}</div>`}
        <div style="min-width:0;flex:1;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-weight:600;font-size:14px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(m.full_name || m.name)}</span>
            <span class="badge ${st === 'Expired' ? 'badge-red' : st === 'Expiring' ? 'badge-amber' : 'badge-purple'} badge-dot">${statusText}</span>${paymentDueBadge}
          </div>
          <div style="font-size:12px;color:var(--text-tertiary);display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;">
            ${tel
              ? `<a href="tel:${escHtml(tel)}" class="sculpt-tel" onclick="event.stopPropagation();">${escHtml(formatPhone(tel))}</a>`
              : `<span style="color:var(--red);font-weight:500;">No phone</span>`}
            <span style="color:var(--border-strong);">·</span>
            <span>${escHtml(m.plan_name || m.plan || '—')}</span>
            <span style="color:var(--border-strong);">·</span>
            <span>Expiry: ${fmtExp}</span>
            <span style="color:var(--border-strong);">·</span>
            <span style="font-weight:600;color:var(--text-primary);">${fmtCurrency(amount)} due</span>
            ${lastReminderISO ? `<span style="color:var(--border-strong);">·</span><span title="${escAttr(new Date(lastReminderISO).toLocaleString('en-IN'))}">Last reminded ${timeAgo(lastReminderISO)}</span>` : ''}
          </div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;">
        ${callBtn(m.phone)}
        ${!isTrialMember ? `<button class="btn btn-sm btn-primary" onclick="window._renew('${escAttr(m.id)}')" style="font-size:12px;padding:6px 12px;">Renew</button>` : ''}
        ${showInvoice
          ? `<button class="btn btn-sm btn-ghost" onclick="window._inv('${escAttr(m.id)}')" style="font-size:12px;padding:6px 10px;">Invoice</button>`
          : `<button class="btn btn-sm btn-ghost" onclick="window._details('${escAttr(m.id)}')" style="font-size:12px;padding:6px 10px;">Details</button>`}
        <button class="btn btn-sm btn-success-soft" onclick="window._wa('${escAttr(m.id)}')" style="font-size:12px;padding:6px 10px;" title="${lastReminderISO ? 'Last reminded ' + timeAgo(lastReminderISO) : 'No reminder sent yet'}">Remind</button>
      </div>
    </div>`;
  }

  window._renew = id => openRenewModal(id);
  window._inv = id => openInvoiceModal(id);
  window._details = id => openMemberDetailModal(id);
  window._wa = id => {
    const lastISO = lastReminders[id];
    const sinceMs = lastISO ? (Date.now() - new Date(lastISO).getTime()) : Infinity;
    if (sinceMs < REMINDER_COOLDOWN_MS) {
      const m = S.members.find(x => String(x.id) === String(id));
      showConfirm({
        title: 'Send another reminder?',
        message: `${escHtml(m?.full_name || m?.name || 'This member')} was already reminded ${timeAgo(lastISO)}. Sending again this soon can come across as spammy — send anyway?`,
        confirmLabel: 'Send Anyway',
        onConfirm: () => openWAModal(id),
      });
      return;
    }
    openWAModal(id);
  };
  render();
}

export { renderMemberAlerts };
