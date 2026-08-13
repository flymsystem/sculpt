import { S } from './state.js';
import { daysLeft, memberStatus, isNewThisMonth, escHtml, timeAgo } from './helpers.js';

// Cross-module handlers injected by index.js
let _nav, _filterTable;
export function setOverviewHandlers(h) { _nav = h.nav; _filterTable = h.filterTable; }

function renderOverview(c) {
  const tot  = S.members.length;
  const act  = S.members.filter(m => memberStatus(m) === 'Active').length;
  const due  = S.members.filter(m => ['Due','Expired'].includes(memberStatus(m))).length;
  const exp  = S.members.filter(m => memberStatus(m) === 'Expiring').length;
  const trial= S.members.filter(m => m.member_type === 'Trial' || m.memberType === 'Trial').length;
  const newThisMo = S.members.filter(isNewThisMonth).length;
  const activeRate = Math.round(act / Math.max(tot, 1) * 100);

  // Compute 6-month sparklines for each stat (cumulative member counts)
  const trends = computeOverviewTrends();

  c.innerHTML = `<div class="content-inner page-enter">

    <div class="overview-hero">
      <div>
        <div class="section-title">Overview</div>
        <div class="section-sub">Your gym at a glance · ${new Date().toLocaleDateString('en-IN',{day:'numeric',month:'long'})}</div>
      </div>
    </div>

    ${(() => {
      const expiringToday = S.members.filter(m => { const d = daysLeft(m); return d !== null && d === 0; });
      const expiredRecent = S.members.filter(m => { const d = daysLeft(m); return d !== null && d < 0 && d >= -3; });
      const urgent = [...expiringToday, ...expiredRecent];
      if (!urgent.length) return '';
      return `<div style="background:var(--surface-2);border:1px solid var(--amber-strong);border-radius:var(--radius-md);padding:14px 18px;margin-bottom:var(--space-5);display:flex;align-items:flex-start;gap:12px;">
        <span style="font-size:20px;flex-shrink:0;">🔔</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;color:var(--amber);font-size:14px;margin-bottom:4px;">${expiringToday.length} member${expiringToday.length!==1?'s':''} expiring today${expiredRecent.length ? `, ${expiredRecent.length} expired in last 3 days` : ''}</div>
          <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;">${urgent.slice(0,5).map(m => `<strong>${escHtml(m.full_name||m.name)}</strong>`).join(', ')}${urgent.length>5?' and '+(urgent.length-5)+' more':''}</div>
        </div>
        <button class="btn btn-sm" onclick="window._navTo&&window._navTo('alerts')" style="background:var(--amber);color:#000;border:none;white-space:nowrap;flex-shrink:0;font-size:11px;padding:6px 12px;">View Alerts</button>
      </div>`;
    })()}

    <div class="grid-4" style="margin-bottom:var(--space-7);">
      ${scard('Total Members',  tot, 'var(--brand)', `+${newThisMo} this month`, '', 'members', '', trends.total, 'var(--brand)')}
      ${scard('Active',          act, 'var(--green)', `${activeRate}% active rate`,           '', 'members', 'Active', trends.active, 'var(--green)')}
      ${scard('Payment Due',     due, 'var(--red)',   due>0?'Needs attention':'All clear',   'down', 'alerts', '', trends.due,    'var(--red)')}
      ${scard('Expiring Soon',   exp, 'var(--amber)', trial>0 ? `${trial} on trial` : 'Next 7 days', '', 'alerts', '', trends.exp,  'var(--amber)')}
    </div>

    ${(() => {
      const next30 = S.members.filter(m => { const d = daysLeft(m); return d !== null && d >= 0 && d <= 30 && (m.member_type||'Paid') !== 'Trial'; });
      const forecastAmt = next30.reduce((s, m) => s + (parseFloat(m.plan_price) || 0), 0);
      if (!next30.length) return '';
      return `<div style="background:var(--brand-fade);border:1px solid var(--brand-fade-strong);border-radius:var(--radius-md);padding:14px 18px;margin-bottom:var(--space-5);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:20px;">📊</span>
          <div>
            <div style="font-weight:600;color:var(--brand-text);font-size:14px;">Expected Renewals (Next 30 Days)</div>
            <div style="font-size:12px;color:var(--text-tertiary);">${next30.length} member${next30.length!==1?'s':''} due for renewal</div>
          </div>
        </div>
        <div style="font-size:24px;font-weight:700;color:var(--brand-text);font-variant-numeric:tabular-nums;">₹${forecastAmt.toLocaleString('en-IN')}</div>
      </div>`;
    })()}

    <div class="grid-2">
      <div>
        <div class="overview-section-header">
          <div class="section-title-sm">Recent activity</div>
          <span class="section-meta">${Math.min(S.members.length, 6)} of ${S.members.length}</span>
        </div>
        <div class="activity-feed">${recentActivity()}</div>
      </div>
      <div>
        <div class="overview-section-header">
          <div class="section-title-sm">Monthly joins</div>
          <span class="section-meta">Last 6 months</span>
        </div>
        <div class="card card-sm" style="margin-bottom:var(--space-5);">
          ${miniBarChart()}
        </div>
        <div class="overview-section-header">
          <div class="section-title-sm">Plan distribution</div>
          <span class="section-meta">${S.plans.length} plan${S.plans.length!==1?'s':''}</span>
        </div>
        <div class="card card-sm">${planDist()}</div>

        <div class="overview-section-header" style="margin-top:var(--space-5);">
          <div class="section-title-sm">Quick insights</div>
        </div>
        <div class="card card-sm" style="padding:16px;">
          ${(() => {
            const total = S.members.length;
            const active = S.members.filter(m => memberStatus(m) === 'Active' || memberStatus(m) === 'Expiring').length;
            const expired = S.members.filter(m => memberStatus(m) === 'Expired').length;
            const retRate = total > 0 ? Math.round((active / total) * 100) : 0;
            const avgRev = total > 0 ? Math.round(S.members.reduce((s,m) => s + (parseFloat(m.plan_price)||0), 0) / total) : 0;
            const cashCount = S.members.filter(m => m.payment_mode === 'Cash').length;
            const cardCount = S.members.filter(m => m.payment_mode === 'Card').length;
            const onlineCount = S.members.filter(m => m.payment_mode === 'Online').length;
            const genderM = S.members.filter(m => m.gender === 'Male').length;
            const genderF = S.members.filter(m => m.gender === 'Female').length;

            return `
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div style="padding:10px;background:var(--surface-2);border-radius:var(--radius-md);text-align:center;">
                  <div style="font-size:20px;font-weight:700;color:${retRate>=70?'var(--green)':retRate>=40?'var(--amber)':'var(--red)'};">${retRate}%</div>
                  <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">Retention Rate</div>
                </div>
                <div style="padding:10px;background:var(--surface-2);border-radius:var(--radius-md);text-align:center;">
                  <div style="font-size:20px;font-weight:700;color:var(--brand);">₹${avgRev.toLocaleString('en-IN')}</div>
                  <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">Avg. per Member</div>
                </div>
                <div style="padding:10px;background:var(--surface-2);border-radius:var(--radius-md);text-align:center;">
                  <div style="font-size:16px;font-weight:600;color:var(--text-primary);">${cashCount} / ${cardCount} / ${onlineCount}</div>
                  <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">Cash / Card / Online</div>
                </div>
                <div style="padding:10px;background:var(--surface-2);border-radius:var(--radius-md);text-align:center;">
                  <div style="font-size:16px;font-weight:600;color:var(--text-primary);">${expired}</div>
                  <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">Need Re-engagement</div>
                </div>
              </div>
              ${genderM + genderF > 0 ? `
              <div style="margin-top:12px;padding:10px;background:var(--surface-2);border-radius:var(--radius-md);">
                <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:6px;">Gender Split</div>
                <div style="display:flex;height:6px;border-radius:3px;overflow:hidden;">
                  <div style="width:${Math.round(genderM/(genderM+genderF)*100)}%;background:var(--brand);"></div>
                  <div style="flex:1;background:var(--purple);"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-tertiary);margin-top:4px;">
                  <span>Male ${genderM}</span><span>Female ${genderF}</span>
                </div>
              </div>` : ''}`;
          })()}
        </div>
      </div>
    </div>
  </div>`;
  // Wire stat card navigation after innerHTML is set
  bindScardClicks();
}

// Sparkline-friendly trend computation: 6 buckets, cumulative or windowed
function computeOverviewTrends() {
  const now = new Date();
  const buckets = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ y: d.getFullYear(), m: d.getMonth() });
  }
  const inBucket = (m, idx) => {
    const d = new Date(m.join_date || m.created_at);
    if (isNaN(d)) return false;
    const b = buckets[idx];
    return d.getFullYear() === b.y && d.getMonth() === b.m;
  };
  // Cumulative total at end of each month
  const total = buckets.map((_, i) =>
    S.members.filter(m => {
      const d = new Date(m.join_date || m.created_at);
      if (isNaN(d)) return false;
      const cutoff = new Date(buckets[i].y, buckets[i].m + 1, 0);
      return d <= cutoff;
    }).length
  );
  // Per-month: new joins
  const active = buckets.map((_, i) =>
    S.members.filter(m => inBucket(m, i) && memberStatus(m) === 'Active').length
  );
  const due = buckets.map((_, i) =>
    S.members.filter(m => inBucket(m, i) && ['Due', 'Expired'].includes(memberStatus(m))).length
  );
  const exp = buckets.map((_, i) =>
    S.members.filter(m => inBucket(m, i) && memberStatus(m) === 'Expiring').length
  );
  return { total, active, due, exp };
}

// Generates an inline SVG sparkline
function sparkline(values, color) {
  if (!values || !values.length) return '';
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const w = 120;
  const h = 28;
  const pad = 2;
  const stepX = (w - pad * 2) / Math.max(values.length - 1, 1);
  const points = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const linePath = `M ${points.join(' L ')}`;
  const fillPath = `${linePath} L ${(pad + (values.length - 1) * stepX).toFixed(1)},${h - pad} L ${pad},${h - pad} Z`;
  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true" style="color:${color};">
    <path class="sparkline-fill" d="${fillPath}"></path>
    <path d="${linePath}" stroke="${color}" style="stroke-linecap:round;stroke-linejoin:round;"></path>
  </svg>`;
}

function scard(label, value, accent, sub, subCls='', navKey='', navFilter='', trend=null, trendColor='var(--brand)') {
  const clickable = navKey ? `data-nav="${navKey}" data-filter="${navFilter}"` : '';
  return `<div class="stat-card ${navKey ? 'stat-card-clickable' : ''}" ${clickable}
    style="--stat-dot:${accent};">
    <div class="stat-card-accent" style="background:${accent};"></div>
    <div class="stat-card-label">${label}</div>
    <div class="stat-card-value">${value}</div>
    <div class="stat-card-sub"><span class="${subCls}">${sub}</span></div>
    ${trend ? sparkline(trend, trendColor) : ''}
  </div>`;
}

// Single delegated listener — added once per overview render, safe to re-add
function bindScardClicks() {
  // Remove any previous to avoid stacking
  document.querySelectorAll('.stat-card-clickable').forEach(card => {
    card.addEventListener('click', function() {
      const navKey    = this.dataset.nav;
      const navFilter = this.dataset.filter;
      if (!navKey) return;
      _nav(navKey);
      // Apply filter after navigation renders the new page
      if (navFilter) {
        setTimeout(() => {
          const el = document.getElementById('sf-status');
          if (el) { el.value = navFilter; _filterTable(); }
        }, 80);
      }
    });
  });
}

function recentActivity() {
  // Combine recent members + recent payments for a richer activity feed
  const items = [];

  // Recent member additions
  S.members.slice().sort((a,b) => new Date(b.created_at||b.join_date) - new Date(a.created_at||a.join_date)).slice(0,4).forEach(m => {
    items.push({
      time: m.created_at || m.join_date,
      icon: '👤',
      color: {Trial:'var(--amber)',Unpaid:'var(--red)'}[m.member_type||m.memberType]||'var(--green)',
      text: `<strong>${escHtml(m.full_name||m.name)}</strong> joined — ${escHtml(m.plan_name||m.plan||m.member_type||'Trial')}`
    });
  });

  // Recent payments
  (S.payHistory||[]).slice(0,4).forEach(p => {
    items.push({
      time: p.paid_at,
      icon: '💰',
      color: 'var(--brand)',
      text: `<strong>${escHtml(p.members?.full_name||'Member')}</strong> paid ₹${Number(p.amount).toLocaleString('en-IN')} — ${escHtml(p.plan_name||'')}`
    });
  });

  // Sort by time, take top 8
  items.sort((a,b) => new Date(b.time) - new Date(a.time));
  const top = items.slice(0, 8);

  if (!top.length) return '<div class="empty-state" style="padding:24px;"><p>No activity yet</p></div>';
  return top.map(item => `
    <div class="activity-item">
      <div class="activity-dot" style="background:${item.color};"></div>
      <div class="activity-text">${item.text}</div>
      <div class="activity-time">${timeAgo(item.time)}</div>
    </div>`).join('');

  // Async: also try to load from activity_log table and update DOM
}

function miniBarChart() {
  // Real data: last 6 calendar months
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ label: d.toLocaleString('en-IN', { month: 'short' }), year: d.getFullYear(), month: d.getMonth() });
  }
  const vals = months.map(mo =>
    S.members.filter(m => {
      const d = new Date(m.join_date || m.created_at);
      return !isNaN(d) && d.getMonth() === mo.month && d.getFullYear() === mo.year;
    }).length
  );
  const mx = Math.max(...vals, 1);
  return `<div style="display:flex;align-items:flex-end;gap:6px;height:100px;padding-top:8px;">
    ${vals.map((v, i) => {
      const isLast = i === vals.length - 1;
      const heightPct = Math.max((v / mx) * 100, v > 0 ? 6 : 0);
      return `
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;" title="${v} member${v!==1?'s':''}">
          <div style="font-size:11px;color:var(--text-tertiary);font-variant-numeric:tabular-nums;min-height:14px;">${v > 0 ? v : ''}</div>
          <div style="flex:1;width:100%;display:flex;align-items:flex-end;">
            <div style="width:100%;height:${heightPct}%;
                 background:${isLast ? 'var(--brand)' : 'var(--brand-fade-strong)'};
                 border-radius:4px 4px 2px 2px;
                 transition:height 0.4s var(--ease-out);"></div>
          </div>
          <div style="font-size:11px;color:var(--text-tertiary);">${months[i].label}</div>
        </div>`;
    }).join('')}
  </div>`;
}

function planDist() {
  const counts={};
  S.members.forEach(m => { const p=m.plan_name||m.plan||'Trial'; counts[p]=(counts[p]||0)+1; });
  const tot=S.members.length||1;
  const cols=['var(--brand)','var(--green)','var(--amber)','var(--purple)','var(--red)'];
  const entries=Object.entries(counts).sort((a,b) => b[1] - a[1]);
  if(!entries.length) return '<p style="color:var(--text-tertiary);font-size:var(--text-md);text-align:center;padding:20px 0;">No members yet</p>';
  return entries.map(([plan,cnt],i)=>{
    const pct = Math.round(cnt/tot*100);
    return `
    <div style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:var(--text-md);margin-bottom:6px;">
        <span style="color:var(--text-primary);font-weight:500;">${plan}</span>
        <span style="color:var(--text-tertiary);font-variant-numeric:tabular-nums;">
          <span style="color:var(--text-primary);font-weight:500;">${cnt}</span>
          <span style="margin-left:6px;">${pct}%</span>
        </span>
      </div>
      <div style="height:6px;background:var(--surface-2);border-radius:var(--radius-pill);overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${cols[i%cols.length]};border-radius:var(--radius-pill);transition:width 0.5s var(--ease-out);"></div>
      </div>
    </div>`;
  }).join('');
}


export { renderOverview, scard };
