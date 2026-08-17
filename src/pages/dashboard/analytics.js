// src/pages/dashboard/analytics.js — Analytics & Reporting (Pro-only)
// ─────────────────────────────────────────────────────────────────
// The page answers four questions, in this order, top to bottom:
//
//   1. WHAT NEEDS ATTENTION?  → Insights strip
//   2. WHAT HAPPENED?         → KPI row for the selected period
//   3. HOW ARE WE DOING?      → Member growth + revenue trend
//   4. WHAT SHOULD I DO?      → Member health, plan performance, dues ageing
//
// Anything that does not answer one of those is not on the page. That is
// why the old gender split is gone: it was a chart, but not a decision.
//
// EVERY NUMBER IS DERIVED FROM REAL DATA. There are no sample values and
// no invented trends. Where a comparison cannot be computed — no previous
// period, no prior payments — the delta is omitted rather than shown as
// 0% or "100%". Where a whole panel has nothing behind it, the panel says
// so in words instead of drawing an empty chart.
// ─────────────────────────────────────────────────────────────────

import { S } from './state.js';
import {
  memberStatus, outstandingAmount, daysLeft,
  escHtml, fmtCurrency, fmtCurrencyShort,
} from './helpers.js';

// Selected period survives re-renders within the session.
let _range = 'month';
let _customFrom = '';
let _customTo = '';

const RANGES = [
  { id: 'today',     label: 'Today' },
  { id: 'week',      label: 'This Week' },
  { id: 'month',     label: 'This Month' },
  { id: 'lastMonth', label: 'Last Month' },
  { id: 'year',      label: 'This Year' },
  { id: 'custom',    label: 'Custom' },
];

const DAY = 86400000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Resolves the selected range to a concrete [from, to) window, plus the
 * equal-length window immediately before it for period-on-period deltas.
 */
function resolveRange() {
  const now = new Date();
  let from, to;

  switch (_range) {
    case 'today':
      from = startOfDay(now);
      to = new Date(from.getTime() + DAY);
      break;
    case 'week': {
      // Week starts Monday — the Indian gym week, and what "this week"
      // means to an owner looking at a Saturday.
      const dow = (now.getDay() + 6) % 7;
      from = new Date(startOfDay(now).getTime() - dow * DAY);
      to = new Date(from.getTime() + 7 * DAY);
      break;
    }
    case 'lastMonth':
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      to = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'year':
      from = new Date(now.getFullYear(), 0, 1);
      to = new Date(now.getFullYear() + 1, 0, 1);
      break;
    case 'custom': {
      const f = _customFrom ? new Date(_customFrom) : null;
      const t = _customTo ? new Date(_customTo) : null;
      if (f && t && !isNaN(f) && !isNaN(t) && f <= t) {
        from = startOfDay(f);
        to = new Date(startOfDay(t).getTime() + DAY);
        break;
      }
      // Incomplete custom range — fall through to this month rather than
      // rendering a nonsense window.
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      break;
    }
    case 'month':
    default:
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }

  const span = to - from;
  return { from, to, prevFrom: new Date(from - span), prevTo: from };
}

/**
 * Splits a window into chart buckets, choosing the grain from the span so
 * a one-week view is not drawn as a single bar and a year is not drawn as
 * 365 of them.
 */
function buildBuckets(from, to) {
  const spanDays = Math.round((to - from) / DAY);
  const out = [];

  if (spanDays <= 14) {
    for (let t = from.getTime(); t < to.getTime(); t += DAY) {
      const d = new Date(t);
      out.push({
        label: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        from: d, to: new Date(t + DAY),
      });
    }
  } else if (spanDays <= 92) {
    for (let t = from.getTime(); t < to.getTime(); t += 7 * DAY) {
      const d = new Date(t);
      const end = new Date(Math.min(t + 7 * DAY, to.getTime()));
      out.push({
        label: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        from: d, to: end,
      });
    }
  } else {
    const cur = new Date(from.getFullYear(), from.getMonth(), 1);
    while (cur < to) {
      const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      out.push({
        label: cur.toLocaleDateString('en-IN', { month: 'short' }),
        from: new Date(cur), to: new Date(Math.min(next.getTime(), to.getTime())),
      });
      cur.setMonth(cur.getMonth() + 1);
    }
  }
  return out;
}

const inWindow = (value, from, to) => {
  if (!value) return false;
  const t = new Date(value).getTime();
  return !isNaN(t) && t >= from.getTime() && t < to.getTime();
};

export function renderAnalytics(c) {
  const members = S.members || [];
  const payHistory = S.payHistory || [];
  const { from, to, prevFrom, prevTo } = resolveRange();

  // ── Point-in-time member counts ───────────────────────────────
  // These describe the roster as it stands today, not the window: an
  // owner asking "how many active members do I have" means right now.
  const statusOf = new Map(members.map(m => [m, memberStatus(m)]));
  const countStatus = (s) => members.filter(m => statusOf.get(m) === s).length;

  const total = members.length;
  const activeCount = countStatus('Active') + countStatus('Expiring');
  const health = [
    { label: 'Active',      n: countStatus('Active'),    tone: 'green'  },
    { label: 'Expiring',    n: countStatus('Expiring'),  tone: 'amber'  },
    { label: 'Payment Due', n: countStatus('Due'),       tone: 'red'    },
    { label: 'Expired',     n: countStatus('Expired'),   tone: 'muted'  },
    { label: 'Trial',       n: countStatus('Trial'),     tone: 'purple' },
    { label: 'Cancelled',   n: countStatus('Cancelled'), tone: 'muted'  },
  ].filter(h => h.n > 0);

  // ── Window metrics ────────────────────────────────────────────
  const joinedIn = (a, b) => members.filter(m => inWindow(m.join_date || m.created_at, a, b)).length;
  const revenueIn = (a, b) => payHistory
    .filter(p => inWindow(p.paid_at, a, b))
    .reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);

  const newMembers = joinedIn(from, to);
  const prevNewMembers = joinedIn(prevFrom, prevTo);
  const revenue = revenueIn(from, to);
  const prevRevenue = revenueIn(prevFrom, prevTo);

  const duesMembers = members.filter(m => !m.cancelled_at && outstandingAmount(m) > 0);
  const totalDues = duesMembers.reduce((s, m) => s + outstandingAmount(m), 0);

  // ── Renewal rate over the window ──────────────────────────────
  // A renewal is any payment from a member who had already paid before.
  // There is no payment_type column, so it is derived rather than read.
  const firstPaidAt = new Map();
  payHistory.forEach(p => {
    if (!p.paid_at || !p.member_id) return;
    const t = new Date(p.paid_at).getTime();
    if (isNaN(t)) return;
    const prev = firstPaidAt.get(p.member_id);
    if (prev === undefined || t < prev) firstPaidAt.set(p.member_id, t);
  });
  const renewals = payHistory.filter(p => {
    if (!inWindow(p.paid_at, from, to) || !p.member_id) return false;
    return new Date(p.paid_at).getTime() > (firstPaidAt.get(p.member_id) ?? Infinity);
  }).length;
  const expirationsInWindow = members.filter(m => inWindow(m.expiry_date, from, to)).length;
  const hasRenewalData = expirationsInWindow > 0;
  const renewalRate = hasRenewalData ? Math.round((renewals / expirationsInWindow) * 100) : null;

  // ── Charts ────────────────────────────────────────────────────
  const buckets = buildBuckets(from, to);
  const joinSeries = buckets.map(b => joinedIn(b.from, b.to));
  const revSeries = buckets.map(b => revenueIn(b.from, b.to));
  const hasJoins = joinSeries.some(v => v > 0);
  const hasRevenue = revSeries.some(v => v > 0);

  // ── Plan performance ──────────────────────────────────────────
  // Revenue is attributed through the member who paid, so a plan's
  // revenue reflects money actually received in the window.
  const memberById = new Map(members.map(m => [m.id, m]));
  const planStats = new Map();
  const bumpPlan = (name, key, amount) => {
    if (!name) return;
    const row = planStats.get(name) || { name, members: 0, revenue: 0 };
    row[key] += amount;
    planStats.set(name, row);
  };
  members.filter(m => !m.cancelled_at).forEach(m => bumpPlan(m.plan_name, 'members', 1));
  payHistory.filter(p => inWindow(p.paid_at, from, to)).forEach(p => {
    const m = memberById.get(p.member_id);
    bumpPlan(m?.plan_name, 'revenue', parseFloat(p.amount) || 0);
  });
  const planRows = [...planStats.values()].sort((a, b) => b.revenue - a.revenue || b.members - a.members);
  const planRevMax = Math.max(...planRows.map(r => r.revenue), 1);

  // ── Payment health ────────────────────────────────────────────
  const modes = ['Cash', 'Card', 'Online'].map(mode => ({
    mode,
    n: members.filter(m => m.payment_mode === mode).length,
  })).filter(x => x.n > 0);
  const modeTotal = modes.reduce((s, x) => s + x.n, 0);

  // Ageing is measured from expiry, which is the only date the schema
  // gives us for "how long has this been owed".
  const ageing = [
    { label: '0–7 days',  n: 0, amount: 0 },
    { label: '8–30 days', n: 0, amount: 0 },
    { label: '30+ days',  n: 0, amount: 0 },
  ];
  duesMembers.forEach(m => {
    const dl = daysLeft(m);
    if (dl === null || dl >= 0) return;          // not yet overdue
    const overdue = -dl;
    const slot = overdue <= 7 ? 0 : overdue <= 30 ? 1 : 2;
    ageing[slot].n += 1;
    ageing[slot].amount += outstandingAmount(m);
  });
  const hasAgeing = ageing.some(a => a.n > 0);

  // ── Insights ──────────────────────────────────────────────────
  const insights = [];
  const expiringSoon = members.filter(m => {
    const dl = daysLeft(m);
    return !m.cancelled_at && dl !== null && dl >= 0 && dl <= 7;
  }).length;
  if (expiringSoon > 0) {
    insights.push({
      tone: 'amber',
      text: `${expiringSoon} membership${expiringSoon === 1 ? '' : 's'} expire${expiringSoon === 1 ? 's' : ''} in the next 7 days.`,
    });
  }
  if (prevRevenue > 0 && revenue > 0) {
    const delta = Math.round(((revenue - prevRevenue) / prevRevenue) * 100);
    if (Math.abs(delta) >= 5) {
      insights.push({
        tone: delta > 0 ? 'green' : 'red',
        text: `Revenue is ${Math.abs(delta)}% ${delta > 0 ? 'higher' : 'lower'} than the previous period.`,
      });
    }
  }
  if (totalDues > 0) {
    insights.push({
      tone: 'red',
      text: `${fmtCurrency(totalDues)} is outstanding across ${duesMembers.length} member${duesMembers.length === 1 ? '' : 's'}.`,
    });
  }
  if (ageing[2].n > 0) {
    insights.push({
      tone: 'red',
      text: `${ageing[2].n} member${ageing[2].n === 1 ? '' : 's'} ${ageing[2].n === 1 ? 'is' : 'are'} more than 30 days overdue.`,
    });
  }
  if (planRows.length > 1 && planRows[0].revenue > 0) {
    insights.push({
      tone: 'blue',
      text: `${planRows[0].name} generated the most revenue this period (${fmtCurrency(planRows[0].revenue)}).`,
    });
  }
  if (newMembers > 0 && prevNewMembers > 0 && newMembers > prevNewMembers) {
    insights.push({
      tone: 'green',
      text: `${newMembers} new members joined, up from ${prevNewMembers} last period.`,
    });
  }

  // ── Render ────────────────────────────────────────────────────
  c.innerHTML = `<div class="content-inner page-enter">
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-title">Analytics</div>
        <div class="page-sub">${escHtml(rangeCaption(from, to))}</div>
      </div>
    </div>

    <div class="an-rangebar" role="group" aria-label="Reporting period">
      ${RANGES.map(r => `
        <button type="button" class="an-range${_range === r.id ? ' is-active' : ''}"
          data-range="${r.id}" aria-pressed="${_range === r.id}">${r.label}</button>`).join('')}
    </div>
    ${_range === 'custom' ? `
      <div class="an-custom">
        <label class="an-custom-field">
          <span>From</span>
          <input type="date" class="form-input" id="an-from" value="${escHtml(_customFrom)}">
        </label>
        <label class="an-custom-field">
          <span>To</span>
          <input type="date" class="form-input" id="an-to" value="${escHtml(_customTo)}">
        </label>
        ${!(_customFrom && _customTo)
          ? `<p class="an-custom-hint">Pick both dates — showing this month until you do.</p>` : ''}
      </div>` : ''}

    ${insights.length ? `
      <section class="an-insights" aria-label="Insights">
        ${insights.slice(0, 4).map(i => `
          <div class="an-insight an-insight-${i.tone}">
            <span class="an-insight-dot"></span>${escHtml(i.text)}
          </div>`).join('')}
      </section>` : `
      <section class="an-insights">
        <div class="an-insight an-insight-muted">
          <span class="an-insight-dot"></span>No insights available yet — they appear once you have members and recorded payments.
        </div>
      </section>`}

    <div class="an-kpis">
      ${kpi('Total Members', total, 'All members on record', null, 'brand')}
      ${kpi('Active Members', activeCount, `${pctOf(activeCount, total)} of the roster`, null, 'green')}
      ${kpi('New Members', newMembers, 'Joined this period', delta(newMembers, prevNewMembers), 'brand')}
      ${kpi('Revenue', fmtCurrencyShort(revenue), 'Payments received', delta(revenue, prevRevenue), 'green')}
      ${kpi('Pending Dues', fmtCurrencyShort(totalDues),
            duesMembers.length ? `Across ${duesMembers.length} member${duesMembers.length === 1 ? '' : 's'}` : 'Nothing outstanding',
            null, totalDues > 0 ? 'red' : 'green')}
      ${kpi('Renewal Rate', hasRenewalData ? `${renewalRate}%` : '—',
            hasRenewalData ? `${renewals} of ${expirationsInWindow} expiries renewed` : 'No memberships expired this period',
            null, 'purple')}
    </div>

    <div class="grid-2 an-charts">
      <div class="card card-sm">
        <div class="card-header"><div class="card-title">Member Growth</div></div>
        ${hasJoins
          ? barChart(joinSeries, buckets.map(b => b.label), v => String(v), 'var(--brand)')
          : panelEmpty('No members joined in this period.')}
      </div>
      <div class="card card-sm">
        <div class="card-header"><div class="card-title">Revenue Trend</div></div>
        ${hasRevenue
          ? barChart(revSeries, buckets.map(b => b.label), v => (v > 0 ? fmtCurrencyShort(v) : ''), 'var(--green)')
          : panelEmpty('No payments recorded in this period.')}
      </div>
    </div>

    <div class="grid-2 an-charts">
      <div class="card card-sm">
        <div class="card-header"><div class="card-title">Member Health</div></div>
        ${health.length
          ? `<div class="an-health">${health.map(h => healthRow(h, total)).join('')}</div>`
          : panelEmpty('No members yet.')}
      </div>

      <div class="card card-sm">
        <div class="card-header"><div class="card-title">Plan Performance</div></div>
        ${planRows.length
          ? `<table class="an-table">
              <thead><tr><th>Plan</th><th class="num">Members</th><th class="num">Revenue</th></tr></thead>
              <tbody>
                ${planRows.slice(0, 6).map(r => `
                  <tr>
                    <td>
                      <span class="an-plan-name">${escHtml(r.name)}</span>
                      <span class="an-plan-bar" style="--w:${Math.round(r.revenue / planRevMax * 100)}%"></span>
                    </td>
                    <td class="num">${r.members}</td>
                    <td class="num">${r.revenue > 0 ? escHtml(fmtCurrency(r.revenue)) : '—'}</td>
                  </tr>`).join('')}
              </tbody>
            </table>`
          : panelEmpty('No plans assigned to members yet.')}
      </div>
    </div>

    <div class="grid-2 an-charts">
      <div class="card card-sm">
        <div class="card-header"><div class="card-title">Payment Methods</div></div>
        ${modes.length
          ? `<div class="an-health">${modes.map(m => healthRow(
              { label: m.mode, n: m.n, tone: m.mode === 'Cash' ? 'green' : m.mode === 'Card' ? 'blue' : 'purple' },
              modeTotal)).join('')}</div>`
          : panelEmpty('No payment method recorded yet.')}
      </div>

      <div class="card card-sm">
        <div class="card-header"><div class="card-title">Overdue Dues</div></div>
        ${hasAgeing
          ? `<div class="an-ageing">
              ${ageing.filter(a => a.n > 0).map(a => `
                <div class="an-ageing-row">
                  <span class="an-ageing-label">${a.label}</span>
                  <span class="an-ageing-n">${a.n} member${a.n === 1 ? '' : 's'}</span>
                  <span class="an-ageing-amt">${escHtml(fmtCurrency(a.amount))}</span>
                </div>`).join('')}
            </div>`
          : panelEmpty(totalDues > 0
              ? 'Dues are outstanding but nothing is past its expiry date yet.'
              : 'No overdue dues. Everyone is paid up.')}
      </div>
    </div>
  </div>`;

  injectAnalyticsStyles();

  // ── Wiring ────────────────────────────────────────────────────
  c.querySelectorAll('.an-range').forEach(btn => {
    btn.addEventListener('click', () => {
      _range = btn.dataset.range;
      renderAnalytics(c);
    });
  });
  const onCustom = () => {
    _customFrom = c.querySelector('#an-from')?.value || '';
    _customTo = c.querySelector('#an-to')?.value || '';
    renderAnalytics(c);
  };
  c.querySelector('#an-from')?.addEventListener('change', onCustom);
  c.querySelector('#an-to')?.addEventListener('change', onCustom);
}

// ── Components ──────────────────────────────────────────────────

function rangeCaption(from, to) {
  const end = new Date(to.getTime() - 1);
  const fmt = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return from.toDateString() === end.toDateString() ? fmt(from) : `${fmt(from)} — ${fmt(end)}`;
}

const pctOf = (n, total) => (total > 0 ? `${Math.round(n / total * 100)}%` : '0%');

/**
 * A period-on-period delta, or null when there is nothing honest to
 * compare against. Returning null is the point: a 0% or 100% badge
 * invented from an empty previous period is worse than no badge.
 */
function delta(current, previous) {
  if (!previous || previous <= 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return null;
  return { pct, up: pct > 0 };
}

function kpi(label, value, sub, d, tone) {
  return `<div class="stat-card" style="--stat-dot:var(--${tone});">
    <div class="stat-card-accent" style="background:var(--${tone});"></div>
    <div class="stat-card-label">${escHtml(label)}</div>
    <div class="stat-card-value">${escHtml(String(value))}</div>
    <div class="stat-card-sub">
      ${d ? `<span class="${d.up ? 'up' : 'down'}">${d.up ? '▲' : '▼'} ${Math.abs(d.pct)}%</span>` : ''}
      <span>${escHtml(sub)}</span>
    </div>
  </div>`;
}

function panelEmpty(message) {
  return `<p class="an-empty">${escHtml(message)}</p>`;
}

function healthRow({ label, n, tone }, total) {
  const pct = total > 0 ? Math.round(n / total * 100) : 0;
  return `<div class="an-health-row">
    <span class="an-health-dot an-dot-${tone}"></span>
    <span class="an-health-label">${escHtml(label)}</span>
    <span class="an-health-track"><span class="an-health-fill an-fill-${tone}" style="--w:${pct}%"></span></span>
    <span class="an-health-n">${n}</span>
    <span class="an-health-pct">${pct}%</span>
  </div>`;
}

/**
 * Bars are drawn with CSS heights rather than SVG so they inherit the
 * theme's colours and stay legible at any container width. Labels thin
 * out automatically: past ~14 buckets only every other one is printed,
 * which is what stopped the old 12-month chart overlapping itself.
 */
function barChart(series, labels, fmtValue, colour) {
  const max = Math.max(...series, 1);
  const stride = series.length > 14 ? Math.ceil(series.length / 8) : 1;
  return `<div class="an-chart">
    ${series.map((v, i) => `
      <div class="an-bar-col" title="${escHtml(labels[i])}: ${escHtml(fmtValue(v) || '0')}">
        <span class="an-bar-val">${escHtml(fmtValue(v))}</span>
        <span class="an-bar" style="--h:${Math.round(v / max * 100)}%;--c:${colour};"></span>
        <span class="an-bar-label">${i % stride === 0 ? escHtml(labels[i]) : ''}</span>
      </div>`).join('')}
  </div>`;
}

// ── Styles ──────────────────────────────────────────────────────
function injectAnalyticsStyles() {
  if (document.getElementById('an-styles')) return;
  const s = document.createElement('style');
  s.id = 'an-styles';
  s.textContent = `
.an-rangebar{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:var(--space-5);}
.an-range{padding:7px 14px;border-radius:var(--radius-pill);border:1px solid var(--border-default);
  background:transparent;color:var(--text-secondary);font-family:var(--font-sans);
  font-size:var(--text-base);font-weight:var(--font-medium);cursor:pointer;
  transition:background-color var(--duration-fast) var(--ease-out),color var(--duration-fast) var(--ease-out),border-color var(--duration-fast) var(--ease-out);}
.an-range:hover{color:var(--text-primary);border-color:var(--border-strong);background:var(--surface-2);}
.an-range.is-active{background:var(--brand-fade);color:var(--brand-text);border-color:var(--brand);font-weight:var(--font-semibold);}
.an-custom{display:flex;flex-wrap:wrap;align-items:flex-end;gap:var(--space-4);margin-bottom:var(--space-5);}
.an-custom-field{display:flex;flex-direction:column;gap:6px;}
.an-custom-field span{font-size:var(--text-sm);color:var(--text-tertiary);font-weight:var(--font-medium);}
.an-custom-field .form-input{width:170px;}
.an-custom-hint{font-size:var(--text-sm);color:var(--text-tertiary);margin:0 0 6px;}

.an-insights{display:grid;gap:8px;margin-bottom:var(--space-5);}
.an-insight{display:flex;align-items:flex-start;gap:10px;padding:11px 14px;
  border:1px solid var(--border-subtle);border-radius:var(--radius-md);
  background:var(--surface-1);font-size:var(--text-md);color:var(--text-secondary);line-height:var(--leading-snug);}
.an-insight-dot{width:7px;height:7px;border-radius:50%;margin-top:6px;flex-shrink:0;background:var(--text-quaternary);}
.an-insight-green .an-insight-dot{background:var(--green);}
.an-insight-red .an-insight-dot{background:var(--red);}
.an-insight-amber .an-insight-dot{background:var(--amber);}
.an-insight-blue .an-insight-dot{background:var(--brand);}

/* Six KPIs, stepped 6 → 3 → 2. Every count divides 6 exactly, so the row
   never leaves a single orphaned card on a line of its own — which is
   what auto-fit did at 1280 and 1024. */
.an-kpis{display:grid;grid-template-columns:repeat(6,1fr);
  gap:var(--space-4);margin-bottom:var(--space-5);}
@media (max-width:1240px){.an-kpis{grid-template-columns:repeat(3,1fr);}}
@media (max-width:680px){.an-kpis{grid-template-columns:repeat(2,1fr);}}
/* At six across a card is ~200px wide; the global 36px stat size would
   let "₹12.5K" crowd the padding. */
.an-kpis .stat-card{padding:var(--space-5);}
.an-kpis .stat-card-value{font-size:var(--text-3xl);}
.an-kpis .stat-card-sub{font-size:var(--text-xs);flex-wrap:wrap;}
.an-charts{margin-bottom:var(--space-5);}
.an-empty{margin:0;padding:28px 4px;text-align:center;color:var(--text-tertiary);
  font-size:var(--text-md);line-height:var(--leading-normal);}

/* Chart */
.an-chart{display:flex;align-items:flex-end;gap:4px;height:168px;padding-top:4px;}
.an-bar-col{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:5px;height:100%;justify-content:flex-end;}
.an-bar-val{font-size:var(--text-xs);color:var(--text-tertiary);font-variant-numeric:tabular-nums;
  white-space:nowrap;line-height:1;}
/* No height transition: bars are rebuilt by innerHTML with their final
   --h already set, so there is no start value to animate from and the
   transition never fires. Same dead pattern removed in c33cf91. */
.an-bar{width:100%;background:var(--c);border-radius:3px 3px 0 0;min-height:3px;height:var(--h);
  flex-shrink:0;}
.an-bar-label{font-size:var(--text-xs);color:var(--text-quaternary);white-space:nowrap;
  line-height:1;height:12px;overflow:hidden;}

/* Health / method rows */
.an-health{display:grid;gap:12px;}
.an-health-row{display:flex;align-items:center;gap:10px;}
.an-health-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
.an-health-label{font-size:var(--text-base);color:var(--text-secondary);width:96px;flex-shrink:0;}
.an-health-track{flex:1;height:6px;background:var(--surface-2);border-radius:3px;overflow:hidden;min-width:40px;}
.an-health-fill{display:block;height:100%;width:var(--w);border-radius:3px;}
.an-health-n{font-size:var(--text-base);font-weight:var(--font-semibold);color:var(--text-primary);
  font-variant-numeric:tabular-nums;width:34px;text-align:right;}
.an-health-pct{font-size:var(--text-sm);color:var(--text-quaternary);width:38px;text-align:right;
  font-variant-numeric:tabular-nums;}
.an-dot-green{background:var(--green);} .an-fill-green{background:var(--green);}
.an-dot-amber{background:var(--amber);} .an-fill-amber{background:var(--amber);}
.an-dot-red{background:var(--red);}     .an-fill-red{background:var(--red);}
.an-dot-purple{background:var(--purple);} .an-fill-purple{background:var(--purple);}
.an-dot-blue{background:var(--brand);}  .an-fill-blue{background:var(--brand);}
.an-dot-muted{background:var(--text-quaternary);} .an-fill-muted{background:var(--text-quaternary);}

/* Plan table */
.an-table{width:100%;border-collapse:collapse;}
.an-table th{text-align:left;font-size:var(--text-sm);font-weight:var(--font-medium);
  color:var(--text-tertiary);padding:0 0 10px;border-bottom:1px solid var(--border-subtle);}
.an-table th.num,.an-table td.num{text-align:right;font-variant-numeric:tabular-nums;}
.an-table td{padding:11px 0;border-bottom:1px solid var(--border-subtle);
  font-size:var(--text-base);color:var(--text-primary);}
.an-table tr:last-child td{border-bottom:none;}
.an-plan-name{display:block;}
.an-plan-bar{display:block;height:3px;width:var(--w);min-width:2px;background:var(--brand);
  border-radius:2px;margin-top:6px;opacity:0.75;}

/* Ageing */
.an-ageing{display:grid;gap:12px;}
.an-ageing-row{display:flex;align-items:center;gap:12px;padding:10px 12px;
  background:var(--surface-2);border-radius:var(--radius-md);}
.an-ageing-label{font-size:var(--text-base);color:var(--text-secondary);width:84px;flex-shrink:0;}
.an-ageing-n{font-size:var(--text-sm);color:var(--text-tertiary);flex:1;}
.an-ageing-amt{font-size:var(--text-base);font-weight:var(--font-semibold);color:var(--red);
  font-variant-numeric:tabular-nums;}

@media (max-width:900px){
  .an-charts{grid-template-columns:1fr;}
}
@media (max-width:560px){
  .an-rangebar{gap:5px;}
  .an-range{padding:6px 11px;font-size:var(--text-sm);}
  .an-chart{height:140px;}
  .an-bar-val{display:none;}
  .an-health-label{width:78px;font-size:var(--text-sm);}
  .an-custom-field .form-input{width:100%;}
  .an-custom-field{flex:1;min-width:140px;}
}
`;
  document.head.appendChild(s);
}
