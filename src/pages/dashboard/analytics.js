// src/pages/dashboard/analytics.js — Analytics & Reporting (Pro-only)
import { S } from './state.js';
import { memberStatus, outstandingAmount, escHtml, fmtCurrency, fmtCurrencyShort } from './helpers.js';

export function renderAnalytics(c) {
  const members = S.members || [];
  const payHistory = S.payHistory || [];
  const plans = S.plans || [];
  const today = new Date();

  // ── Compute metrics ───────────────────────────────────────
  const total = members.length;
  const active = members.filter(m => { const s = memberStatus(m); return s === 'Active' || s === 'Expiring'; }).length;
  const expired = members.filter(m => memberStatus(m) === 'Expired').length;
  const due = members.filter(m => !m.cancelled_at && (m.payment_status === 'Due' || m.payment_status === 'Partial')).length;
  const cancelled = members.filter(m => m.cancelled_at).length;
  const trial = members.filter(m => (m.member_type || 'Paid') === 'Trial').length;

  const retentionRate = total > 0 ? Math.round((active / Math.max(total - cancelled, 1)) * 100) : 0;
  const avgRevPerMember = total > 0
    ? Math.round(members.filter(m => !m.cancelled_at).reduce((s, m) => s + (parseFloat(m.plan_price) || 0), 0) / Math.max(total - cancelled, 1))
    : 0;
  const totalPendingDues = members.filter(m => !m.cancelled_at && (m.payment_status === 'Due' || m.payment_status === 'Partial'))
    .reduce((s, m) => s + outstandingAmount(m), 0);

  // ── Monthly data (last 12 months) ─────────────────────────
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    months.push({ month: d.getMonth(), year: d.getFullYear(), label: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }) });
  }

  const monthlyJoins = months.map(m =>
    members.filter(mb => {
      const d = new Date(mb.join_date || mb.created_at);
      return d.getMonth() === m.month && d.getFullYear() === m.year;
    }).length
  );

  const monthlyRevenue = months.map(m =>
    payHistory.filter(p => {
      if (!p.paid_at) return false;
      const d = new Date(p.paid_at);
      return d.getMonth() === m.month && d.getFullYear() === m.year;
    }).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
  );

  const maxJoins = Math.max(...monthlyJoins, 1);
  const maxRevenue = Math.max(...monthlyRevenue, 1);

  // ── Plan distribution ─────────────────────────────────────
  const planCounts = {};
  members.filter(m => !m.cancelled_at && m.is_active !== false).forEach(m => {
    const name = m.plan_name || 'No Plan';
    planCounts[name] = (planCounts[name] || 0) + 1;
  });
  const planEntries = Object.entries(planCounts).sort((a, b) => b[1] - a[1]);
  const planTotal = planEntries.reduce((s, e) => s + e[1], 0);
  const planColors = ['var(--brand)', 'var(--green)', 'var(--amber)', 'var(--purple)', 'var(--red)', 'var(--blue-light)'];

  // ── Payment mode breakdown ────────────────────────────────
  const cashCount = members.filter(m => m.payment_mode === 'Cash').length;
  const cardCount = members.filter(m => m.payment_mode === 'Card').length;
  const onlineCount = members.filter(m => m.payment_mode === 'Online').length;
  const pmTotal = cashCount + cardCount + onlineCount || 1;

  // ── Gender breakdown ──────────────────────────────────────
  const genderM = members.filter(m => m.gender === 'Male').length;
  const genderF = members.filter(m => m.gender === 'Female').length;
  const genderO = total - genderM - genderF;

  // ── Renewal rate (members who renewed in last 3 months) ───
  // This used to filter on `p.payment_type === 'Renewal'`. There is no
  // payment_type column on payment_history — not in any migration, and
  // nothing in the app ever wrote one — so the filter was always false
  // and this Pro feature permanently reported "0% — 0 renewals",
  // implying the gym's retention was catastrophic.
  //
  // A renewal is derived instead: any payment from a member who had
  // already paid at least once before. That needs no schema change and
  // matches what a gym owner means by the word.
  const threeMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate());
  const firstPaidAt = new Map();
  payHistory.forEach(p => {
    if (!p.paid_at || !p.member_id) return;
    const t = new Date(p.paid_at).getTime();
    if (isNaN(t)) return;
    const prev = firstPaidAt.get(p.member_id);
    if (prev === undefined || t < prev) firstPaidAt.set(p.member_id, t);
  });
  const renewals = payHistory.filter(p => {
    if (!p.paid_at || !p.member_id) return false;
    const t = new Date(p.paid_at).getTime();
    if (isNaN(t) || t < threeMonthsAgo.getTime()) return false;
    return t > (firstPaidAt.get(p.member_id) ?? t);   // not their first payment
  }).length;
  const expirationsInPeriod = members.filter(m => {
    if (!m.expiry_date) return false;
    const d = new Date(m.expiry_date);
    return d >= threeMonthsAgo && d <= today;
  }).length;
  const renewalRate = expirationsInPeriod > 0 ? Math.round((renewals / expirationsInPeriod) * 100) : 0;

  // ── Render ────────────────────────────────────────────────
  c.innerHTML = `<div class="content-inner page-enter">
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-title">Analytics</div>
        <div class="page-sub">Insights and trends for your gym</div>
      </div>
    </div>

    <!-- KPI Cards -->
    <div class="grid-4" style="margin-bottom:var(--space-5);">
      ${kpiCard('Total Members', total, 'var(--brand)')}
      ${kpiCard('Active Rate', `${retentionRate}%`, retentionRate >= 70 ? 'var(--green)' : retentionRate >= 40 ? 'var(--amber)' : 'var(--red)')}
      ${kpiCard('Avg. Revenue/Member', fmtCurrencyShort(avgRevPerMember), 'var(--brand-text)')}
      ${kpiCard('Pending Dues', fmtCurrency(totalPendingDues), totalPendingDues > 0 ? 'var(--red)' : 'var(--green)')}
    </div>

    <div class="grid-2" style="margin-bottom:var(--space-5);">
      <!-- Member Growth Chart -->
      <div class="card card-sm">
        <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:16px;">Member Growth</div>
        <div style="display:flex;align-items:flex-end;gap:4px;height:140px;padding:0 4px;">
          ${monthlyJoins.map((v, i) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
            <div style="font-size:var(--text-xs);color:var(--text-tertiary);font-variant-numeric:tabular-nums;">${v || ''}</div>
            <div style="width:100%;background:var(--brand);border-radius:3px 3px 0 0;min-height:2px;height:${Math.round(v / maxJoins * 100)}%;opacity:${i === 11 ? 1 : 0.7};transition:height 0.3s;"></div>
            <div style="font-size:var(--text-xs);color:var(--text-tertiary);white-space:nowrap;">${months[i].label}</div>
          </div>`).join('')}
        </div>
      </div>

      <!-- Revenue Trend Chart -->
      <div class="card card-sm">
        <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:16px;">Revenue Trend</div>
        <div style="display:flex;align-items:flex-end;gap:4px;height:140px;padding:0 4px;">
          ${monthlyRevenue.map((v, i) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
            <div style="font-size:var(--text-xs);color:var(--text-tertiary);font-variant-numeric:tabular-nums;">${v > 0 ? fmtCurrencyShort(v) : ''}</div>
            <div style="width:100%;background:var(--green);border-radius:3px 3px 0 0;min-height:2px;height:${Math.round(v / maxRevenue * 100)}%;opacity:${i === 11 ? 1 : 0.7};transition:height 0.3s;"></div>
            <div style="font-size:var(--text-xs);color:var(--text-tertiary);white-space:nowrap;">${months[i].label}</div>
          </div>`).join('')}
        </div>
      </div>
    </div>

    <div class="grid-2" style="margin-bottom:var(--space-5);">
      <!-- Status Distribution -->
      <div class="card card-sm">
        <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:16px;">Member Status</div>
        ${statusBar(active, 'Active', 'var(--green)', total)}
        ${statusBar(expired, 'Expired', 'var(--amber)', total)}
        ${statusBar(due, 'Payment Due', 'var(--red)', total)}
        ${statusBar(trial, 'Trial', 'var(--purple)', total)}
        ${statusBar(cancelled, 'Cancelled', 'var(--text-quaternary)', total)}
      </div>

      <!-- Plan Popularity -->
      <div class="card card-sm">
        <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:16px;">Plan Distribution</div>
        ${planEntries.length === 0
          ? `<div style="font-size:13px;color:var(--text-tertiary);padding:20px 0;text-align:center;">No plan data yet</div>`
          : planEntries.slice(0, 6).map((e, i) => {
            const pct = Math.round(e[1] / planTotal * 100);
            return `<div style="margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                <span style="color:var(--text-secondary);font-weight:500;">${escHtml(e[0])}</span>
                <span style="color:var(--text-tertiary);">${e[1]} (${pct}%)</span>
              </div>
              <div style="height:6px;background:var(--surface-2);border-radius:3px;overflow:hidden;">
                <div style="height:100%;width:${pct}%;background:${planColors[i % planColors.length]};border-radius:3px;transition:width 0.3s;"></div>
              </div>
            </div>`;
          }).join('')
        }
      </div>
    </div>

    <div class="grid-3" style="margin-bottom:var(--space-5);">
      <!-- Payment Mode -->
      <div class="card card-sm" style="text-align:center;">
        <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:14px;">Payment Modes</div>
        <div style="display:flex;justify-content:center;gap:16px;">
          ${pmStat('Cash', cashCount, Math.round(cashCount / pmTotal * 100), 'var(--green)')}
          ${pmStat('Card', cardCount, Math.round(cardCount / pmTotal * 100), 'var(--brand)')}
          ${pmStat('Online', onlineCount, Math.round(onlineCount / pmTotal * 100), 'var(--purple)')}
        </div>
      </div>

      <!-- Gender Split -->
      <div class="card card-sm" style="text-align:center;">
        <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:14px;">Gender Split</div>
        <div style="display:flex;justify-content:center;gap:16px;">
          ${pmStat('Male', genderM, total > 0 ? Math.round(genderM / total * 100) : 0, 'var(--brand)')}
          ${pmStat('Female', genderF, total > 0 ? Math.round(genderF / total * 100) : 0, 'var(--amber)')}
          ${genderO > 0 ? pmStat('Other', genderO, Math.round(genderO / total * 100), 'var(--text-tertiary)') : ''}
        </div>
      </div>

      <!-- Renewal Rate -->
      <div class="card card-sm" style="text-align:center;">
        <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:14px;">Renewal Rate (3mo)</div>
        <div style="font-size:32px;font-weight:700;color:${renewalRate >= 60 ? 'var(--green)' : renewalRate >= 30 ? 'var(--amber)' : 'var(--red)'};font-variant-numeric:tabular-nums;line-height:1;">
          ${renewalRate}%
        </div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-top:6px;">${renewals} renewals / ${expirationsInPeriod} expirations</div>
      </div>
    </div>
  </div>`;
}

// ── Helper components ───────────────────────────────────────
function kpiCard(label, value, color) {
  return `<div class="card card-sm" style="text-align:center;padding:20px 14px;">
    <div style="font-size:24px;font-weight:700;color:${color};font-variant-numeric:tabular-nums;margin-bottom:4px;">${value}</div>
    <div style="font-size:11px;color:var(--text-tertiary);font-weight:500;">${escHtml(label)}</div>
  </div>`;
}

function statusBar(count, label, color, total) {
  const pct = total > 0 ? Math.round(count / total * 100) : 0;
  return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
    <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
    <span style="font-size:12px;color:var(--text-secondary);flex:1;">${escHtml(label)}</span>
    <span style="font-size:12px;color:var(--text-primary);font-weight:600;font-variant-numeric:tabular-nums;">${count}</span>
    <span style="font-size:11px;color:var(--text-quaternary);width:36px;text-align:right;">${pct}%</span>
  </div>`;
}

function pmStat(label, count, pct, color) {
  return `<div style="min-width:60px;">
    <div style="font-size:20px;font-weight:700;color:${color};font-variant-numeric:tabular-nums;">${count}</div>
    <div style="font-size:10px;color:var(--text-tertiary);margin-top:2px;">${escHtml(label)} (${pct}%)</div>
  </div>`;
}
