import { S } from './state.js';
import { daysLeft, memberStatus, outstandingAmount, isNewThisMonth, escHtml, fmtCurrency, fmtCurrencyShort, timeAgo, pctChange, isSameLocalDay } from './helpers.js';
import { hasAccess, can } from '../../lib/permissions.js';

let _nav, _filterTable;
export function setOverviewHandlers(h) { _nav = h.nav; _filterTable = h.filterTable; }

function renderOverview(c) {
  const role = S.role || 'owner';
  const isStaff = role === 'staff';
  const showFinancials = !isStaff; // staff cannot see revenue/financial data

  const tot=S.members.length, act=S.members.filter(m=>memberStatus(m)==='Active').length;
  const due=S.members.filter(m=>!m.cancelled_at&&(m.payment_status==='Due'||m.payment_status==='Partial')).length;
  const exp=S.members.filter(m=>memberStatus(m)==='Expiring').length;
  const trial=S.members.filter(m=>(m.member_type||m.memberType)==='Trial').length;
  const newThisMo=S.members.filter(isNewThisMonth).length;
  const activeRate=Math.round(act/Math.max(tot,1)*100);
  const cancelled=S.members.filter(m=>m.cancelled_at).length;

  const today=new Date();
  const todayPayments=(S.payHistory||[]).filter(p=>isSameLocalDay(p.paid_at, today));
  const todayRevenue=todayPayments.reduce((s,p)=>s+(parseFloat(p.amount)||0),0);
  const todayAdmissions=S.members.filter(m=>isSameLocalDay(m.join_date, today)).length;

  const thisMonth=today.getMonth(), thisYear=today.getFullYear();
  const lastMonth=thisMonth===0?11:thisMonth-1, lastMonthYear=thisMonth===0?thisYear-1:thisYear;
  const thisMonthMembers=S.members.filter(m=>{const d=new Date(m.join_date||m.created_at);return d.getMonth()===thisMonth&&d.getFullYear()===thisYear;}).length;
  const lastMonthMembers=S.members.filter(m=>{const d=new Date(m.join_date||m.created_at);return d.getMonth()===lastMonth&&d.getFullYear()===lastMonthYear;}).length;
  const growthPct=pctChange(thisMonthMembers,lastMonthMembers);

  const pendingAmount=S.members.filter(m=>!m.cancelled_at&&(m.payment_status==='Due'||m.payment_status==='Partial'))
    .reduce((s,m)=>s+outstandingAmount(m),0);
  const thisMonthRevenue=(S.payHistory||[]).filter(p=>{if(!p.paid_at)return false;const d=new Date(p.paid_at);return d.getMonth()===thisMonth&&d.getFullYear()===thisYear;}).reduce((s,p)=>s+(parseFloat(p.amount)||0),0);

  const todayExpenses=(S.expenses||[]).filter(e=>isSameLocalDay(e.expense_date, today)).reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
  const todayProfit=todayRevenue-todayExpenses;

  const trends=computeOverviewTrends();

  // The label used to read `Math.min(S.members.length, 8) events`, which
  // counted MEMBERS, not events — it said "8 events" above a list of 3.
  // recentActivity() caps at 8, so count what it actually renders.
  const activityHtml = recentActivity(showFinancials);
  const activityCount = (activityHtml.match(/class="activity-item"/g) || []).length;

  c.innerHTML = `<div class="content-inner page-enter">
    <div class="overview-hero">
      <div>
        <div class="section-title">Overview</div>
        <div class="section-sub">Your gym at a glance · ${today.toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'})}</div>
      </div>
    </div>

    ${(() => {
      const expiringToday=S.members.filter(m=>{const d=daysLeft(m);return d!==null&&d===0;});
      const expiredRecent=S.members.filter(m=>{const d=daysLeft(m);return d!==null&&d<0&&d>=-3;});
      const urgent=[...expiringToday,...expiredRecent];
      if(!urgent.length)return '';
      return `<div style="background:var(--surface-1);border:1px solid var(--amber-strong);border-radius:var(--radius-lg);padding:16px 20px;margin-bottom:var(--space-5);display:flex;align-items:flex-start;gap:14px;animation:fadeUp 0.3s var(--ease-out);">
        <div style="width:36px;height:36px;border-radius:var(--radius-md);background:var(--amber-fade);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" stroke-width="2" stroke-linecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;color:var(--text-primary);font-size:14px;margin-bottom:4px;">${expiringToday.length} member${expiringToday.length!==1?'s':''} expiring today${expiredRecent.length?`, ${expiredRecent.length} expired in last 3 days`:''}</div>
          <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;">${urgent.slice(0,5).map(m=>`<strong>${escHtml(m.full_name||m.name)}</strong>`).join(', ')}${urgent.length>5?' and '+(urgent.length-5)+' more':''}</div>
        </div>
        <button class="btn btn-sm" onclick="window._navTo&&window._navTo('alerts')" style="background:var(--amber);color:#000;border:none;white-space:nowrap;flex-shrink:0;font-size:11px;padding:6px 14px;font-weight:600;">View Alerts</button>
      </div>`;
    })()}

    <div class="grid-4" style="margin-bottom:var(--space-5);">
      ${scard('Total Members',tot,'var(--brand)',growthPct!==0?`<span class="${growthPct>0?'trend-up':'trend-down'}">${Math.abs(growthPct)}%</span> vs last month`:`+${newThisMo} this month`,'','members','',trends.total,'var(--brand)')}
      ${scard('Active',act,'var(--green)',`${activeRate}% active rate`,'','members','Active',trends.active,'var(--green)')}
      ${scard('Payment Due',due,'var(--red)',due>0 && showFinancials ?fmtCurrency(pendingAmount)+' pending':due>0?due+' members pending':'All clear',due>0?'down':'','alerts','',trends.due,'var(--red)')}
      ${scard('Expiring Soon',exp,'var(--amber)',trial>0?`${trial} on trial`:`Next ${S.gym?.reminder_days||7} days`,'','alerts','',trends.exp,'var(--amber)')}
    </div>

    ${showFinancials ? `<div class="mini-stat-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-3);margin-bottom:var(--space-7);min-width:0;">
      ${miniStat("Today’s Revenue",fmtCurrency(todayRevenue),'var(--green)','finance',true)}
      ${miniStat('This Month',fmtCurrency(thisMonthRevenue),'var(--brand)','finance')}
      ${miniStat('Admissions Today',todayAdmissions,'var(--purple)','members')}
      ${miniStat('Expenses Today',fmtCurrency(todayExpenses),'var(--amber)','expenses')}
      ${miniStat("Today’s Profit",fmtCurrency(todayProfit),todayProfit>=0?'var(--green)':'var(--red)','finance',true)}
      ${miniStat('Total Staff',(S.staff||[]).length,'var(--brand-text)','staff')}
    </div>` : `<div class="mini-stat-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-3);margin-bottom:var(--space-7);min-width:0;">
      ${miniStat('Admissions Today',todayAdmissions,'var(--purple)','members')}
      ${miniStat('New This Month',newThisMo,'var(--brand)','members')}
      ${miniStat('Total Staff',(S.staff||[]).length,'var(--brand-text)','staff')}
    </div>`}

    ${showFinancials ? (() => {
      const next30=S.members.filter(m=>{const d=daysLeft(m);return d!==null&&d>=0&&d<=30&&(m.member_type||'Paid')!=='Trial'&&!m.cancelled_at;});
      const forecastAmt=next30.reduce((s,m)=>s+(parseFloat(m.plan_price)||0),0);
      if(!next30.length)return '';
      return `<div class="mini-stat-clickable" data-mini-nav="alerts" role="button" tabindex="0" style="background:var(--surface-1);border:1px solid var(--brand-fade-strong);border-radius:var(--radius-lg);padding:16px 20px;margin-bottom:var(--space-7);display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="width:36px;height:36px;border-radius:var(--radius-md);background:var(--brand-fade);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="2" stroke-linecap="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          </div>
          <div>
            <div style="font-weight:600;color:var(--text-primary);font-size:14px;">Expected Renewals (Next 30 Days)</div>
            <div style="font-size:12px;color:var(--text-tertiary);">${next30.length} member${next30.length!==1?'s':''} due for renewal</div>
          </div>
        </div>
        <div style="font-size:24px;font-weight:700;color:var(--brand-text);font-variant-numeric:tabular-nums;">${fmtCurrency(forecastAmt)}</div>
      </div>`;
    })() : ''}

    <div class="grid-2">
      <div>
        <div class="overview-section-header">
          <div class="section-title-sm">Recent Activity</div>
          <span class="section-meta">${activityCount} event${activityCount!==1?'s':''}</span>
        </div>
        <div class="activity-feed">${activityHtml}</div>
      </div>
      <div>
        <div class="overview-section-header">
          <div class="section-title-sm">Monthly Trends</div>
          <div class="chart-tabs" id="chart-mode-tabs">
            <button class="chart-tab active" data-mode="joins">Admissions</button>
            ${showFinancials ? `<button class="chart-tab" data-mode="revenue">Revenue</button>` : ''}
            <button class="chart-tab" data-mode="renewals">Renewals</button>
            ${showFinancials ? `<button class="chart-tab" data-mode="expenses">Expenses</button>` : ''}
          </div>
        </div>
        <div class="card card-sm" style="margin-bottom:var(--space-5);">
          <div id="overview-chart-container">${miniBarChart('joins')}</div>
        </div>
        <div class="overview-section-header">
          <div class="section-title-sm">Plan Distribution</div>
          <span class="section-meta">${S.plans.length} plan${S.plans.length!==1?'s':''}</span>
        </div>
        <div class="card card-sm">${planDist()}</div>

        ${showFinancials ? `<div class="overview-section-header" style="margin-top:var(--space-5);">
          <div class="section-title-sm">Quick Insights</div>
        </div>
        <div class="card card-sm" style="padding:16px;">
          ${(() => {
            const total=S.members.length;
            const active=S.members.filter(m=>memberStatus(m)==='Active'||memberStatus(m)==='Expiring').length;
            const expired=S.members.filter(m=>memberStatus(m)==='Expired').length;
            const retRate=total>0?Math.round((active/total)*100):0;
            const avgRev=total>0?Math.round(S.members.filter(m=>!m.cancelled_at).reduce((s,m)=>s+(parseFloat(m.plan_price)||0),0)/Math.max(total-cancelled,1)):0;
            const cashCount=S.members.filter(m=>m.payment_mode==='Cash').length;
            const cardCount=S.members.filter(m=>m.payment_mode==='Card').length;
            const onlineCount=S.members.filter(m=>m.payment_mode==='Online').length;
            const genderM=S.members.filter(m=>m.gender==='Male').length;
            const genderF=S.members.filter(m=>m.gender==='Female').length;

            return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <div class="stat-tile">
                  <div class="stat-tile-value" style="font-size:20px;color:${retRate>=70?'var(--green)':retRate>=40?'var(--amber)':'var(--red)'};">${retRate}%</div>
                  <div class="stat-tile-label">Retention Rate</div>
                </div>
                <div class="stat-tile">
                  <div class="stat-tile-value" style="color:var(--brand);">${fmtCurrencyShort(avgRev)}</div>
                  <div class="stat-tile-label">Avg. per Member</div>
                </div>
                <div class="stat-tile">
                  <div class="stat-tile-value" style="font-size:14px;font-weight:600;color:var(--text-primary);">${cashCount} / ${cardCount} / ${onlineCount}</div>
                  <div class="stat-tile-label">Cash / Card / Online</div>
                </div>
                <div class="stat-tile">
                  <div class="stat-tile-value" style="font-size:16px;font-weight:600;color:var(--text-primary);">${expired}</div>
                  <div class="stat-tile-label">Need Re-engagement</div>
                </div>
              </div>
              ${cancelled>0?`<div style="margin-top:12px;padding:12px;background:var(--surface-2);border-radius:var(--radius-md);">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;"><div style="font-size:11px;color:var(--text-tertiary);">Membership Status</div><div style="font-size:11px;color:var(--text-quaternary);">${cancelled} cancelled</div></div>
                <div style="display:flex;height:8px;border-radius:4px;overflow:hidden;gap:2px;">
                  <div style="width:${Math.round(active/Math.max(total,1)*100)}%;background:var(--green);border-radius:4px;" title="Active: ${active}"></div>
                  <div style="width:${Math.round(expired/Math.max(total,1)*100)}%;background:var(--amber);border-radius:4px;" title="Expired: ${expired}"></div>
                  <div style="width:${Math.round(cancelled/Math.max(total,1)*100)}%;background:var(--red);border-radius:4px;" title="Cancelled: ${cancelled}"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-tertiary);margin-top:5px;">
                  <span style="display:flex;align-items:center;gap:4px;"><span style="width:6px;height:6px;border-radius:50%;background:var(--green);"></span>Active ${active}</span>
                  <span style="display:flex;align-items:center;gap:4px;"><span style="width:6px;height:6px;border-radius:50%;background:var(--amber);"></span>Expired ${expired}</span>
                  <span style="display:flex;align-items:center;gap:4px;"><span style="width:6px;height:6px;border-radius:50%;background:var(--red);"></span>Cancelled ${cancelled}</span>
                </div>
              </div>`:''}
              ${genderM+genderF>0?`<div style="margin-top:12px;padding:12px;background:var(--surface-2);border-radius:var(--radius-md);">
                <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:6px;">Gender Split</div>
                <div style="display:flex;height:6px;border-radius:3px;overflow:hidden;">
                  <div style="width:${Math.round(genderM/(genderM+genderF)*100)}%;background:var(--brand);"></div>
                  <div style="flex:1;background:var(--purple);"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-tertiary);margin-top:4px;">
                  <span>Male ${genderM}</span><span>Female ${genderF}</span>
                </div>
              </div>`:''}`;
          })()}
        </div>` : ''}
      </div>
    </div>
  </div>`;

  bindScardClicks();
  bindMiniStatClicks();
  document.querySelectorAll('#chart-mode-tabs .chart-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#chart-mode-tabs .chart-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const container = document.getElementById('overview-chart-container');
      if (container) container.innerHTML = miniBarChart(tab.dataset.mode);
    });
  });
}

/**
 * Mini stat tile.
 * @param {string} navKey  optional dashboard section to navigate to on tap.
 *                         Access is checked in nav() itself, so a staff user
 *                         tapping a locked tile lands on the Access Restricted
 *                         screen rather than a broken page.
 */
/**
 * @param {boolean} emphasize — AUDIT.md C9: every mini-stat rendered at
 * identical weight, so "Today's Revenue" — the number an owner actually
 * opens the app to check — looked exactly as important as "Total Staff".
 * A bounded fix short of restructuring the whole overview grid: the two
 * money figures (today's revenue, today's profit) get a bigger value and
 * a faint accent wash; the rest are unchanged.
 */
function miniStat(label, value, color, navKey = '', emphasize = false) {
  const clickable = navKey
    ? `class="mini-stat-clickable" data-mini-nav="${escHtml(navKey)}" role="button" tabindex="0" title="Open ${escHtml(label)}"`
    : '';
  // Solid border-left accent, not color-mix() — not used anywhere else in
  // this codebase, and this app deliberately targets older/cheap Android
  // browsers. No reason to introduce an unvetted CSS feature for a
  // cosmetic accent when a plain border does the same job.
  const leftBorder = emphasize ? `border-left:3px solid ${color};` : '';
  return `<div ${clickable} style="background:var(--surface-1);border:1px solid var(--border-subtle);${leftBorder}border-radius:var(--radius-md);padding:12px 14px;display:flex;flex-direction:column;gap:4px;overflow:hidden;min-width:0;">
    <div style="font-size:11px;color:var(--text-tertiary);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:4px;">
      <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;">${label}</span>
      ${navKey ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="flex-shrink:0;opacity:.45;"><polyline points="9 18 15 12 9 6"/></svg>` : ''}
    </div>
    <div style="font-size:${emphasize ? '20px' : '17px'};font-weight:700;color:${color};font-variant-numeric:tabular-nums;letter-spacing:var(--tracking-tight);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${value}</div>
  </div>`;
}

function bindMiniStatClicks() {
  document.querySelectorAll('[data-mini-nav]').forEach(el => {
    const go = () => {
      const key = el.dataset.miniNav;
      if (key && _nav) _nav(key);
    };
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });
}

function computeOverviewTrends() {
  const now=new Date(), buckets=[];
  for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);buckets.push({y:d.getFullYear(),m:d.getMonth()});}
  const cutoffs=buckets.map(b=>new Date(b.y,b.m+1,0));
  const total=new Array(6).fill(0),active=new Array(6).fill(0),due=new Array(6).fill(0),exp=new Array(6).fill(0);
  S.members.forEach(m=>{const d=new Date(m.join_date||m.created_at);if(isNaN(d))return;const st=memberStatus(m);
    const pSt=m.payment_status||m.status;
    for(let i=0;i<6;i++){if(d<=cutoffs[i])total[i]++;if(d.getFullYear()===buckets[i].y&&d.getMonth()===buckets[i].m){if(st==='Active')active[i]++;if(pSt==='Due'||pSt==='Partial')due[i]++;if(st==='Expiring')exp[i]++;}}
  });
  return {total,active,due,exp};
}

function sparkline(values,color){
  if(!values||!values.length)return '';
  const max=Math.max(...values,1),min=Math.min(...values,0),range=Math.max(max-min,1),w=120,h=28,pad=2;
  const stepX=(w-pad*2)/Math.max(values.length-1,1);
  const points=values.map((v,i)=>{const x=pad+i*stepX,y=h-pad-((v-min)/range)*(h-pad*2);return `${x.toFixed(1)},${y.toFixed(1)}`;});
  const linePath=`M ${points.join(' L ')}`;
  const fillPath=`${linePath} L ${(pad+(values.length-1)*stepX).toFixed(1)},${h-pad} L ${pad},${h-pad} Z`;
  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="color:${color};"><path class="sparkline-fill" d="${fillPath}"></path><path d="${linePath}" stroke="${color}" style="stroke-linecap:round;stroke-linejoin:round;"></path></svg>`;
}

function scard(label,value,accent,sub,_subCls='',navKey='',navFilter='',trend=null,trendColor='var(--brand)'){
  const clickable=navKey?`data-nav="${navKey}" data-filter="${navFilter}"`:'';
  return `<div class="stat-card ${navKey?'stat-card-clickable':''}" ${clickable} style="--stat-dot:${accent};">
    <div class="stat-card-accent" style="background:${accent};"></div>
    <div class="stat-card-label">${label}</div>
    <div class="stat-card-value">${value}</div>
    <div class="stat-card-sub">${sub}</div>
    ${trend?sparkline(trend,trendColor):''}
  </div>`;
}

function bindScardClicks(){
  document.querySelectorAll('.stat-card-clickable').forEach(card=>{
    card.addEventListener('click',function(){
      const navKey=this.dataset.nav,navFilter=this.dataset.filter;
      if(!navKey)return;_nav(navKey);
      if(navFilter)setTimeout(()=>{const el=document.getElementById('sf-status');if(el){el.value=navFilter;_filterTable();}},80);
    });
  });
}

function recentActivity(showFinancials=true){
  const items=[];
  S.members.slice().sort((a,b)=>new Date(b.created_at||b.join_date)-new Date(a.created_at||a.join_date)).slice(0,4).forEach(m=>{
    const mType=m.member_type||m.memberType||'Paid';
    items.push({time:m.created_at||m.join_date,iconBg:mType==='Trial'?'var(--amber-fade)':mType==='Unpaid'?'var(--red-fade)':'var(--green-fade)',iconColor:mType==='Trial'?'var(--amber)':mType==='Unpaid'?'var(--red)':'var(--green)',
      iconSvg:`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`,
      text:`<strong>${escHtml(m.full_name||m.name)}</strong> joined — ${escHtml(m.plan_name||m.plan||mType)}`});
  });
  // Only show payment activity to owners
  if (showFinancials) {
    (S.payHistory||[]).slice(0,4).forEach(p=>{
      items.push({time:p.paid_at,iconBg:'var(--brand-fade)',iconColor:'var(--brand)',
        iconSvg:`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
        text:`<strong>${escHtml(p.members?.full_name||'Member')}</strong> paid ${fmtCurrency(p.amount)} — ${escHtml(p.plan_name||'')}`});
    });
  }
  items.sort((a,b)=>new Date(b.time)-new Date(a.time));
  const top=items.slice(0,8);
  if(!top.length)return `<div class="empty-state" style="padding:32px;"><span class="empty-icon">📋</span><div class="empty-title">No activity yet</div><p>Add your first member to see activity here</p></div>`;
  return top.map(item=>`<div class="activity-item">
    <div class="activity-icon" style="background:${item.iconBg};color:${item.iconColor};">${item.iconSvg}</div>
    <div class="activity-content"><div class="activity-text">${item.text}</div><div class="activity-time">${timeAgo(item.time)}</div></div>
  </div>`).join('');
}

function miniBarChart(mode='joins'){
  const now=new Date(),months=[];
  for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);months.push({label:d.toLocaleString('en-IN',{month:'short'}),year:d.getFullYear(),month:d.getMonth()});}
  let vals;
  if(mode==='revenue'){vals=months.map(mo=>(S.payHistory||[]).filter(p=>{if(!p.paid_at)return false;const d=new Date(p.paid_at);return d.getMonth()===mo.month&&d.getFullYear()===mo.year;}).reduce((s,p)=>s+(parseFloat(p.amount)||0),0));}
  else if(mode==='renewals'){vals=months.map(mo=>(S.payHistory||[]).filter(p=>{if(!p.paid_at)return false;const d=new Date(p.paid_at);return d.getMonth()===mo.month&&d.getFullYear()===mo.year;}).length);}
  else if(mode==='expenses'){vals=months.map(mo=>(S.expenses||[]).filter(e=>{if(!e.expense_date)return false;const d=new Date(e.expense_date);return d.getMonth()===mo.month&&d.getFullYear()===mo.year;}).reduce((s,e)=>s+(parseFloat(e.amount)||0),0));}
  else{vals=months.map(mo=>S.members.filter(m=>{const d=new Date(m.join_date||m.created_at);return!isNaN(d)&&d.getMonth()===mo.month&&d.getFullYear()===mo.year;}).length);}
  const mx=Math.max(...vals,1);
  const formatVal=(v)=>{if(mode==='revenue'||mode==='expenses'){if(v>=100000)return '₹'+(v/100000).toFixed(0)+'L';if(v>=1000)return '₹'+(v/1000).toFixed(0)+'K';return '₹'+v;}return v>0?v:'';};
  return `<div style="display:flex;align-items:flex-end;gap:6px;height:110px;padding-top:8px;">
    ${vals.map((v,i)=>{const isLast=i===vals.length-1;const heightPct=Math.max((v/mx)*100,v>0?6:0);
      return `<div style="flex:1 1 0;min-width:38px;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;" title="${mode==='revenue'||mode==='expenses'?fmtCurrencyShort(v):v+' '+mode}">
        <div style="font-size:10px;color:var(--text-tertiary);font-variant-numeric:tabular-nums;min-height:14px;font-weight:500;white-space:nowrap;">${v>0?formatVal(v):''}</div>
        <div style="flex:1;width:100%;display:flex;align-items:flex-end;">
          <div style="width:100%;height:${heightPct}%;background:${isLast?'var(--brand)':'var(--brand-fade-strong)'};border-radius:4px 4px 2px 2px;transition:height 0.5s var(--ease-out);"></div>
        </div>
        <div style="font-size:10px;color:var(--text-tertiary);font-weight:500;white-space:nowrap;">${months[i].label}</div>
      </div>`;
    }).join('')}
  </div>`;
}

function planDist(){
  const counts={};
  S.members.forEach(m=>{const p=m.plan_name||m.plan||'Trial';counts[p]=(counts[p]||0)+1;});
  const tot=S.members.length||1;
  const cols=['var(--brand)','var(--green)','var(--amber)','var(--purple)','var(--red)'];
  const entries=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  if(!entries.length)return `<div class="empty-state" style="padding:24px;"><span class="empty-icon">📁</span><p>No members yet</p></div>`;
  return entries.map(([plan,cnt],i)=>{const pct=Math.round(cnt/tot*100);
    return `<div style="margin-bottom:14px;"><div style="display:flex;justify-content:space-between;align-items:center;font-size:var(--text-md);margin-bottom:6px;">
      <span style="color:var(--text-primary);font-weight:500;">${escHtml(plan)}</span>
      <span style="color:var(--text-tertiary);font-variant-numeric:tabular-nums;"><span style="color:var(--text-primary);font-weight:500;">${cnt}</span> <span style="margin-left:6px;">${pct}%</span></span>
    </div><div style="height:6px;background:var(--surface-2);border-radius:var(--radius-pill);overflow:hidden;">
      <div style="height:100%;width:${pct}%;background:${cols[i%cols.length]};border-radius:var(--radius-pill);transition:width 0.5s var(--ease-out);"></div>
    </div></div>`;
  }).join('');
}

export { renderOverview, scard };
