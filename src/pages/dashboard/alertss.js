import { S } from './state.js';
import { expiryDate, memberStatus, outstandingAmount, escHtml, escAttr, av2, fmtDate, fmtCurrency } from './helpers.js';
import { scard } from './overview.js';
import { openRenewModal, openInvoiceModal, openWAModal } from './member-modals.js';

function renderMemberAlerts(c) {
  const reminderDays = S.gym?.reminder_days || 7;
  let alertFilter = 'all';
  let sortBy = 'urgency';

  // ── Helper: does this member have a pending payment? ──────────
  // Uses payment_status directly (not memberStatus) so expired members
  // with outstanding dues are included — matching Finance logic.
  function hasPendingPayment(m) {
    return !m.cancelled_at && (m.payment_status === 'Due' || m.payment_status === 'Partial');
  }

  function getAlertMembers() {
    return S.members.filter(m => {
      const st = memberStatus(m);
      // Include: Expired, Expiring, Due, Partial (via memberStatus), OR has pending payment
      // hasPendingPayment catches expired members with outstanding dues too
      return st === 'Expired' || st === 'Expiring' || st === 'Due' || st === 'Partial' || hasPendingPayment(m);
    }).sort((a, b) => {
      if (sortBy === 'name') return (a.full_name || '').localeCompare(b.full_name || '');
      // FIX: Use outstandingAmount() instead of balance_due ?? plan_price
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
    // FIX: Use outstandingAmount() — only sums members with pending payment,
    // not ALL alert members. Old code used balance_due ?? plan_price on all
    // alert members, inflating the total for expired-but-fully-paid members.
    const totalDue = allAlerts
      .filter(m => hasPendingPayment(m))
      .reduce((s, m) => s + outstandingAmount(m), 0);
    const list = filteredAlerts();

    c.innerHTML = `<div class="content-inner page-enter">
      <div class="page-header">
        <div class="page-header-left">
          <div class="page-title">Member Alerts</div>
          <div class="page-sub">${allAlerts.length} member${allAlerts.length !== 1 ? 's' : ''} need attention \u00B7 ${fmtCurrency(totalDue)} outstanding</div>
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
              <span class="empty-icon">\u2705</span>
              <div class="empty-title">All clear!</div>
              <p>No alerts match this filter. Your members are in good standing.</p>
            </div>`
          : list.map((m, i) => renderAlertCard(m, i)).join('')}
      </div>

      ${list.length > 0 ? `<div style="margin-top:var(--space-5);padding:var(--space-4) var(--space-5);background:var(--surface-1);border:1px solid var(--border-subtle);border-radius:var(--radius-md);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-3);">
        <div style="font-size:var(--text-sm);color:var(--text-tertiary);">Showing ${list.length} of ${allAlerts.length} alerts</div>
        <div style="font-size:var(--text-sm);font-weight:600;color:var(--text-primary);">Total Outstanding: ${fmtCurrency(totalDue)}</div>
      </div>` : ''}
    </div>`;

    document.querySelectorAll('.alert-filter-pill').forEach(pill => {
      pill.addEventListener('click', () => { alertFilter = pill.dataset.filter; render(); });
    });
    document.getElementById('alert-sort')?.addEventListener('change', (e) => {
      sortBy = e.target.value; render();
    });
  }

  function renderAlertCard(m, idx) {
    const st = memberStatus(m);
    const exp = expiryDate(m);
    const mType = m.member_type || m.memberType || 'Paid';
    const isTrialMember = mType === 'Trial';
    const isPendingPayment = hasPendingPayment(m);

    let accentColor, statusText;
    if (st === 'Expired') {
      const daysAgo = exp ? Math.abs(Math.ceil((exp - new Date()) / 86400000)) : 0;
      accentColor = daysAgo > 14 ? 'var(--red)' : 'var(--amber)';
      statusText = 'Expired ' + daysAgo + 'd ago';
    } else if (st === 'Expiring') {
      const dl = exp ? Math.ceil((exp - new Date()) / 86400000) : 0;
      accentColor = dl <= 2 ? 'var(--red)' : 'var(--amber)';
      statusText = dl === 0 ? 'Expires today' : dl === 1 ? 'Expires tomorrow' : 'Expiring in ' + dl + 'd';
    } else if (st === 'Partial') {
      accentColor = 'var(--amber)';
      statusText = 'Partial Payment';
    } else {
      accentColor = 'var(--purple)';
      statusText = 'Payment Due';
    }

    // Show payment due badge alongside status for expired members with pending payment
    const paymentDueBadge = isPendingPayment && (st === 'Expired' || st === 'Expiring')
      ? ` <span class="badge badge-purple badge-dot">Payment Due</span>`
      : '';

    const fmtExp = exp ? fmtDate(exp.toISOString().split('T')[0]) : '\u2014';
    // FIX: Use outstandingAmount() instead of balance_due ?? plan_price
    const amount = outstandingAmount(m);

    return `<div class="alert-card ${st === 'Expired' ? 'critical' : ''}" style="border-left-color:${accentColor};margin-bottom:var(--space-3);animation:fadeUp ${Math.min(150 + idx * 30, 400)}ms var(--ease-out) both;">
      <div style="display:flex;align-items:center;gap:14px;flex:1;min-width:0;">
        ${m.photo_url
          ? `<div class="member-avatar" style="overflow:hidden;padding:0;"><img src="${escHtml(m.photo_url)}" alt="" style="width:100%;height:100%;object-fit:cover;"></div>`
          : `<div class="member-avatar">${av2(m.full_name || m.name)}</div>`}
        <div style="min-width:0;flex:1;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-weight:600;font-size:14px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(m.full_name || m.name)}</span>
            <span class="badge ${st === 'Expired' ? 'badge-red' : st === 'Expiring' ? 'badge-amber' : st === 'Partial' ? 'badge-amber' : 'badge-purple'} badge-dot">${statusText}</span>${paymentDueBadge}
          </div>
          <div style="font-size:12px;color:var(--text-tertiary);display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;">
            <span>${escHtml(m.plan_name || m.plan || '\u2014')}</span>
            <span style="color:var(--border-strong);">\u00B7</span>
            <span>Expiry: ${fmtExp}</span>
            ${amount > 0 ? `<span style="color:var(--border-strong);">\u00B7</span>
            <span style="font-weight:600;color:var(--text-primary);">${fmtCurrency(amount)}</span>` : ''}
          </div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
        ${!isTrialMember ? `<button class="btn btn-sm btn-primary" onclick="window._renew('${escAttr(m.id)}')" style="font-size:12px;padding:6px 12px;">Renew</button>` : ''}
        <button class="btn btn-sm btn-ghost" onclick="window._inv('${escAttr(m.id)}')" style="font-size:12px;padding:6px 10px;">Invoice</button>
        <button class="btn btn-sm btn-success-soft" onclick="window._wa('${escAttr(m.id)}')" style="font-size:12px;padding:6px 10px;">Remind</button>
      </div>
    </div>`;
  }

  window._renew = id => openRenewModal(id);
  window._inv = id => openInvoiceModal(id);
  window._wa = id => openWAModal(id);
  render();
}

export { renderMemberAlerts };
