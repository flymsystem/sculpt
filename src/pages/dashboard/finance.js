import { S } from './state.js';
import { showSectionLoading, escHtml, av2, fmtDate, fmtCurrency, localISO, outstandingAmount } from './helpers.js';
import { getExpensesByRange, getAllExpenses, getMonthlyExpenseTotals, getCategoryIcon } from '../../lib/expenses.js';
import { getPaymentHistory, getRevenueSummary, getRevenueMonthly, getRevenueRows } from '../../lib/members.js';
import { showToast } from '../../components/toast.js';

let _nav;
export function setNavHandler(fn) { _nav = fn; }

function renderFinance(c, period, customStart, customEnd) {
  period = period || 'month';
  const gymId = S.gym?.id;
  const now = new Date();

  // ── Helper: end-of-day for a Date (set to 23:59:59.999 local) ──
  function endOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  }

  function getPeriodBounds(p) {
    const y=now.getFullYear(),mo=now.getMonth(),d=now.getDate();
    const dow=now.getDay(); const mon=new Date(y,mo,d-((dow+6)%7));
    const sun=new Date(mon); sun.setDate(mon.getDate()+6);
    const pMon=new Date(mon); pMon.setDate(mon.getDate()-7);
    const pSun=new Date(mon); pSun.setDate(mon.getDate()-1);
    switch(p){
      case'today':return{start:new Date(y,mo,d),end:now,prev:{start:new Date(y,mo,d-1),end:new Date(y,mo,d-1,23,59,59,999)},label:'Today'};
      case'week':return{start:mon,end:endOfDay(sun),prev:{start:pMon,end:endOfDay(pSun)},label:'This Week'};
      case'month':return{start:new Date(y,mo,1),end:endOfDay(new Date(y,mo+1,0)),prev:{start:new Date(y,mo-1,1),end:endOfDay(new Date(y,mo,0))},label:'This Month'};
      case'lastmonth':return{start:new Date(y,mo-1,1),end:endOfDay(new Date(y,mo,0)),prev:{start:new Date(y,mo-2,1),end:endOfDay(new Date(y,mo-1,0))},label:'Last Month'};
      case'year':return{start:new Date(y,0,1),end:endOfDay(new Date(y,11,31)),prev:{start:new Date(y-1,0,1),end:endOfDay(new Date(y-1,11,31))},label:'This Year'};
      case'custom':{
        if (!customStart) return{start:null,end:null,prev:null,label:'Custom Range'};
        const cs = new Date(customStart+'T00:00:00');
        const ce = customEnd ? new Date(customEnd+'T23:59:59') : new Date(customStart+'T23:59:59');
        const lbl = customEnd && customEnd !== customStart
          ? cs.toLocaleDateString('en-IN',{day:'numeric',month:'short'})+' \u2013 '+ce.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})
          : cs.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
        return{start:cs,end:ce,prev:null,label:lbl};
      }
      default:return{start:null,end:null,prev:null,label:'All Time'};
    }
  }

  /**
   * Format a Date to local YYYY-MM-DD for DB queries.
   * FIX: Was using .toISOString().split('T')[0] which converts to UTC first —
   * IST midnight (e.g. July 1 00:00 IST) becomes June 30 18:30 UTC, producing
   * "2026-06-30" instead of "2026-07-01". This broke all period-based expense
   * queries by one day.
   */
  function fmtISO(d) { return localISO(d); }

  function inRange(ds,start,end){if(!ds||!start)return true;const d=new Date(ds+'T00:00:00');return d>=start&&d<=end;}

  const bounds = getPeriodBounds(period);

  // Revenue helpers (shared between sync setup and async render)
  function phInRange(ph, start, end) {
    if (!ph.paid_at || !start) return true;
    const d = new Date(ph.paid_at);
    return d >= start && d <= end;
  }
  function gPct(c2,p2){if(p2===0)return c2>0?100:0;return Math.round(((c2-p2)/p2)*100);}
  function gHTML(pct){if(pct===0)return'<span style="font-size:12px;color:var(--text-tertiary);">\u2014</span>';const col=pct>0?'var(--green)':'var(--red)';return`<span style="font-size:12px;color:${col};font-weight:500;">${pct>0?'\u2191':'\u2193'} ${Math.abs(pct)}%</span>`;}

  // Month buckets for the trend chart. Built locally so the labels and
  // the boundaries always come from the same calendar the rest of this
  // page uses; the server is only ever asked to sum between them.
  function buildMonthBuckets(n){
    const b=[];
    for(let i=n-1;i>=0;i--){
      const dd=new Date(now.getFullYear(),now.getMonth()-i,1);
      b.push({
        label: dd.toLocaleDateString('en-IN',{month:'short',year:'2-digit'}),
        start: dd,
        end:   endOfDay(new Date(dd.getFullYear(),dd.getMonth()+1,0)),
      });
    }
    return b;
  }
  // Fallback path only: sum the downloaded array into those buckets.
  function computeMonthlyRevLocal(buckets){
    return buckets.map(b=>({
      label: b.label,
      total: (S.payHistory||[]).filter(p=>{if(!p.paid_at)return false;const pd=new Date(p.paid_at);return pd>=b.start&&pd<=b.end;})
                               .reduce((s,p)=>s+(parseFloat(p.amount)||0),0),
    }));
  }

  async function loadAndRender() {
    // Show loading skeleton immediately so user sees instant feedback
    if (!c.querySelector('.finance-stats')) {
      showSectionLoading(c, 'Finance');
    }

    // ── Revenue ────────────────────
    // Preferred: Postgres does the summing (migration 035). One row
    // comes back instead of every payment the gym has ever taken.
    //
    // The period boundaries are computed HERE, locally, and passed to
    // the server — the server never decides what "this month" means. If
    // it did, its idea of a boundary and this one would disagree around
    // midnight and revenue would depend on which path ran. See the
    // header of migration 035.
    //
    // Falls back to downloading and summing in JS when 035 has not been
    // applied. Both paths must produce identical numbers.
    const monthBuckets = buildMonthBuckets(6);
    let totalRev, prevRev, cashT, cardT, onlineT, payCount;
    let revRows = null;           // server-shaped detail rows, or null
    let monthlyRevTotals = null;  // server-computed chart totals, or null
    let usedServerRevenue = false;

    try {
      const [summary, prevSummary, monthly] = await Promise.all([
        getRevenueSummary(gymId, bounds.start, bounds.end),
        bounds.prev ? getRevenueSummary(gymId, bounds.prev.start, bounds.prev.end) : Promise.resolve(null),
        getRevenueMonthly(gymId, monthBuckets),
      ]);
      if (summary && monthly) {
        totalRev = summary.total; payCount = summary.count;
        cashT = summary.cash; cardT = summary.card; onlineT = summary.online;
        prevRev = prevSummary ? prevSummary.total : 0;
        monthlyRevTotals = monthly;
        revRows = await getRevenueRows(gymId, bounds.start, bounds.end, 200, 0);
        usedServerRevenue = revRows !== null;
      }
    } catch (err) {
      console.warn('[Flym] Server-side revenue unavailable, falling back:', err.message);
    }

    let paidPH = [];
    if (!usedServerRevenue) {
      // ── Fallback: pre-035. Download everything and sum in JS. ──
      try {
        S.payHistory = await getPaymentHistory(gymId);
      } catch (err) {
        console.warn('[Flym] Payment history refresh failed, using cached:', err.message);
      }
      paidPH   = (S.payHistory||[]).filter(p => phInRange(p, bounds.start, bounds.end));
      totalRev = paidPH.reduce((s,p) => s + (parseFloat(p.amount)||0), 0);
      payCount = paidPH.length;
      const prevPH = bounds.prev ? (S.payHistory||[]).filter(p => phInRange(p, bounds.prev.start, bounds.prev.end)) : [];
      prevRev  = prevPH.reduce((s,p) => s + (parseFloat(p.amount)||0), 0);
      cashT    = paidPH.filter(p => p.payment_mode==='Cash').reduce((s,p) => s + (parseFloat(p.amount)||0), 0);
      cardT    = paidPH.filter(p => p.payment_mode==='Card').reduce((s,p) => s + (parseFloat(p.amount)||0), 0);
      onlineT  = paidPH.filter(p => p.payment_mode==='Online').reduce((s,p) => s + (parseFloat(p.amount)||0), 0);
    }
    const revG = gPct(totalRev,prevRev);

    // Due amounts — exclude cancelled members (their balance is no longer collectible)
    const dueMbrs = S.members.filter(m => (m.payment_status==='Due' || m.payment_status==='Partial') && !m.cancelled_at);
    const totalDue = dueMbrs.reduce((s,m) => s + outstandingAmount(m), 0);

    const cashPct = totalRev > 0 ? Math.round((cashT/totalRev)*100) : 0;
    const cardPct = totalRev > 0 ? Math.round((cardT/totalRev)*100) : 0;
    const newMbrs = S.members.filter(m => inRange(m.join_date, bounds.start, bounds.end)).length;

    // ── Revenue detail rows ───────────────────
    // Normalised to one shape so the markup doesn't care whether the
    // rows came from the server (035) or from the downloaded array.
    const detailRows = usedServerRevenue
      ? revRows
      : [...paidPH]
          .sort((a,b) => new Date(b.paid_at||0) - new Date(a.paid_at||0))
          .slice(0, 200)
          .map(p => ({
            memberName: p.members?.full_name || S.members.find(m => m.id === p.member_id)?.full_name || '\u2014',
            amount: p.amount, mode: p.payment_mode, planName: p.plan_name, paidAt: p.paid_at,
          }));

    function buildRevDetailRows() {
      const sorted = detailRows;
      if (!sorted.length) return '';
      return sorted.map(p => {
        const memberName = p.memberName || '\u2014';
        const modeLabel = p.mode || '\u2014';
        const modeBadge = p.mode === 'Cash' ? 'badge-green' : p.mode === 'Card' ? 'badge-amber' : 'badge-blue';
        return `<tr style="border-bottom:1px solid var(--border-subtle);">
          <td style="padding:10px 12px;">
            <div style="font-weight:500;font-size:13px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(memberName)}</div>
            <div style="font-size:11px;color:var(--text-tertiary);" class="hide-mobile">${escHtml(p.planName || '\u2014')}</div>
          </td>
          <td style="padding:10px 12px;font-size:12px;color:var(--text-secondary);" class="hide-mobile">${fmtDate(p.paidAt)}</td>
          <td style="padding:10px 12px;text-align:center;"><span class="badge ${modeBadge}" style="font-size:10px;">${escHtml(modeLabel)}</span></td>
          <td style="padding:10px 12px;text-align:right;font-weight:600;color:var(--green);font-size:13px;font-variant-numeric:tabular-nums;">${fmtCurrency(p.amount)}</td>
        </tr>`;
      }).join('');
    }

    let totalExp=0,prevExp2=0,catBreakdown={},monthlyExpT=[],periodExpenses=[];
    try{
      // Parallel fetch: current expenses, previous period, and monthly totals
      const expPromise = bounds.start ? getExpensesByRange(gymId,fmtISO(bounds.start),fmtISO(bounds.end)) : getAllExpenses(gymId);
      const prevPromise = bounds.prev ? getExpensesByRange(gymId,fmtISO(bounds.prev.start),fmtISO(bounds.prev.end)) : Promise.resolve([]);
      const monthlyPromise = getMonthlyExpenseTotals(gymId,6);
      const [pExps, prevExps, monthlyData] = await Promise.all([expPromise, prevPromise, monthlyPromise]);
      periodExpenses = pExps;
      totalExp=pExps.reduce((s,e)=>s+parseFloat(e.amount),0);
      prevExp2=prevExps.reduce((s,e)=>s+parseFloat(e.amount),0);
      pExps.forEach(e=>{catBreakdown[e.category]=(catBreakdown[e.category]||0)+parseFloat(e.amount);});
      monthlyExpT=monthlyData;
    }catch(err){console.warn('[Flym] Expense fetch:',err);}

    const netP=totalRev-totalExp;const expG=gPct(totalExp,prevExp2);const profitG=gPct(netP,prevRev-prevExp2);
    const monthlyRev = monthlyRevTotals
      ? monthBuckets.map((b,i)=>({ label:b.label, total: monthlyRevTotals[i] || 0 }))
      : computeMonthlyRevLocal(monthBuckets);
    const chartMax=Math.max(...monthlyRev.map(m=>m.total),...monthlyExpT.map(m=>m.total),1);

    const sortedCats=Object.entries(catBreakdown).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const maxCat=sortedCats.length>0?sortedCats[0][1]:1;

    const barChart=monthlyRev.map((r,i)=>{
      const eT2=monthlyExpT[i]?.total||0;
      const rH=Math.max(2,(r.total/chartMax)*140);
      const eH=Math.max(2,(eT2/chartMax)*140);
      return`<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;">
        <div style="display:flex;align-items:flex-end;gap:3px;height:150px;">
          <div style="width:18px;background:var(--brand);border-radius:3px 3px 0 0;height:${rH}px;"></div>
          <div style="width:18px;background:var(--red-fade);border:1px solid var(--red);border-radius:3px 3px 0 0;height:${eH}px;"></div>
        </div><span style="font-size:10px;color:var(--text-tertiary);">${r.label}</span>
      </div>`;}).join('');

    // ── Pending Dues detail rows ─────────────────────────────────
    // FIX: Use outstandingAmount() for consistent amount calculation
    const dueDetailRows = dueMbrs.map(m => {
      const amt = outstandingAmount(m);
      const statusLabel = m.payment_status === 'Partial' ? 'Partial' : 'Due';
      const statusBadge = m.payment_status === 'Partial' ? 'badge-amber' : 'badge-red';
      return `<tr style="border-bottom:1px solid var(--border-subtle);">
        <td style="padding:10px 12px;">
          <div style="display:flex;align-items:center;gap:10px;">
            ${m.photo_url
              ? `<div class="member-avatar" style="width:32px;height:32px;font-size:11px;overflow:hidden;padding:0;flex-shrink:0;"><img src="${escHtml(m.photo_url)}" alt="" style="width:100%;height:100%;object-fit:cover;"></div>`
              : `<div class="member-avatar" style="width:32px;height:32px;font-size:11px;flex-shrink:0;">${av2(m.full_name || m.name)}</div>`}
            <div style="min-width:0;">
              <div style="font-weight:500;font-size:13px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(m.full_name || m.name)}</div>
              <div style="font-size:11px;color:var(--text-tertiary);">${escHtml(m.phone || '\u2014')}</div>
            </div>
          </div>
        </td>
        <td style="padding:10px 12px;font-size:12px;color:var(--text-secondary);" class="hide-mobile">${escHtml(m.plan_name || m.plan || '\u2014')}</td>
        <td style="padding:10px 12px;text-align:center;"><span class="badge ${statusBadge}">${statusLabel}</span></td>
        <td style="padding:10px 12px;text-align:right;font-weight:600;color:var(--amber);font-size:13px;font-variant-numeric:tabular-nums;">${fmtCurrency(amt)}</td>
      </tr>`;
    }).join('');

    // ── Revenue detail rows ──────────────────────────────────────
    const revDetailRows = buildRevDetailRows();
    const revHasMore = payCount > 200;

    // ── Expense detail rows ──────────────────────────────────────
    const expSorted = [...periodExpenses].sort((a,b) => new Date(b.expense_date||0) - new Date(a.expense_date||0)).slice(0, 200);
    const expDetailRows = expSorted.map(e => {
      const icon = getCategoryIcon(e.category);
      return `<tr style="border-bottom:1px solid var(--border-subtle);">
        <td style="padding:10px 12px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:16px;width:24px;text-align:center;flex-shrink:0;">${icon}</span>
            <div style="min-width:0;">
              <div style="font-weight:500;font-size:13px;color:var(--text-primary);">${escHtml(e.category)}</div>
              ${e.description ? `<div style="font-size:11px;color:var(--text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(e.description)}</div>` : ''}
            </div>
          </div>
        </td>
        <td style="padding:10px 12px;font-size:12px;color:var(--text-secondary);" class="hide-mobile">${fmtDate(e.expense_date)}</td>
        <td style="padding:10px 12px;text-align:right;font-weight:600;color:var(--red);font-size:13px;font-variant-numeric:tabular-nums;">${fmtCurrency(e.amount)}</td>
      </tr>`;
    }).join('');
    const expHasMore = periodExpenses.length > 200;

    c.innerHTML = `<div class="content-inner page-enter">
      <div class="page-header"><div class="page-header-left"><div class="page-title">Finance</div>
        <div class="page-sub">${bounds.label}</div></div></div>
      <div class="finance-period-bar">
        ${['today','week','month','lastmonth','year','all'].map(p=>`<button class="period-btn ${period===p?'active':''}" data-fin-p="${p}">${
          p==='today'?'Today':p==='week'?'This Week':p==='month'?'This Month':p==='lastmonth'?'Last Month':p==='year'?'This Year':'All Time'}</button>`).join('')}
        <button class="period-btn ${period==='custom'?'active':''}" id="fin-custom-btn" style="border-style:${period==='custom'?'solid':'dashed'};">Custom</button>
      </div>
      <div id="fin-custom-range" style="display:${period==='custom'?'flex':'none'};gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap;">
        <input type="date" class="form-input" id="fin-custom-start" style="width:auto;padding:7px 12px;font-size:13px;" value="${customStart||''}" title="Start date">
        <span style="color:var(--text-tertiary);font-size:13px;">to</span>
        <input type="date" class="form-input" id="fin-custom-end" style="width:auto;padding:7px 12px;font-size:13px;" value="${customEnd||''}" title="End date">
        <button class="btn btn-sm btn-primary" id="fin-custom-apply" style="padding:7px 16px;">Apply</button>
      </div>
      <div class="finance-stats">
        <div class="finance-stat ${payCount > 0 ? 'stat-card-clickable' : ''}" id="fin-rev-card" style="cursor:${payCount > 0 ? 'pointer' : 'default'};" title="${payCount > 0 ? 'Click to view details' : ''}"><div class="finance-stat-label">Revenue</div><div class="finance-stat-val" style="color:var(--green);">\u20B9${totalRev.toLocaleString('en-IN')}</div><div class="finance-stat-sub">${gHTML(revG)} ${payCount > 0 ? `<span style="font-size:11px;color:var(--text-tertiary);margin-left:4px;">${payCount} payment${payCount!==1?'s':''}</span> <span style="font-size:10px;">\u25BC</span>` : ''}</div></div>
        <div class="finance-stat ${periodExpenses.length > 0 ? 'stat-card-clickable' : ''}" id="fin-exp-card" style="cursor:${periodExpenses.length > 0 ? 'pointer' : 'default'};" title="${periodExpenses.length > 0 ? 'Click to view details' : ''}"><div class="finance-stat-label">Expenses</div><div class="finance-stat-val" style="color:var(--red);">\u20B9${totalExp.toLocaleString('en-IN')}</div><div class="finance-stat-sub">${gHTML(expG)} ${periodExpenses.length > 0 ? `<span style="font-size:11px;color:var(--text-tertiary);margin-left:4px;">${periodExpenses.length} item${periodExpenses.length!==1?'s':''}</span> <span style="font-size:10px;">\u25BC</span>` : ''}</div></div>
        <div class="finance-stat"><div class="finance-stat-label">Net Profit</div><div class="finance-stat-val" style="color:${netP>=0?'var(--brand)':'var(--red)'};">\u20B9${netP.toLocaleString('en-IN')}</div><div class="finance-stat-sub">${gHTML(profitG)}</div></div>
        <div class="finance-stat ${dueMbrs.length > 0 ? 'stat-card-clickable' : ''}" id="fin-dues-card" style="cursor:${dueMbrs.length > 0 ? 'pointer' : 'default'};" title="${dueMbrs.length > 0 ? 'Click to view details' : ''}"><div class="finance-stat-label">Pending Dues</div><div class="finance-stat-val" style="color:var(--amber);">\u20B9${totalDue.toLocaleString('en-IN')}</div><div class="finance-stat-sub">${dueMbrs.length} member${dueMbrs.length!==1?'s':''} ${dueMbrs.length > 0 ? '<span style="font-size:10px;">\u25BC</span>' : ''}</div></div>
      </div>

      ${payCount > 0 ? `<div id="fin-rev-detail" style="display:none;margin-bottom:20px;animation:fadeUp 200ms var(--ease-out) both;">
        <div class="settings-card" style="padding:0;overflow:hidden;">
          <div style="padding:14px 16px;border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;justify-content:space-between;">
            <div style="font-size:14px;font-weight:600;color:var(--text-primary);">Revenue Breakdown</div>
            <div style="font-size:12px;color:var(--green);font-weight:600;">${fmtCurrency(totalRev)} total</div>
          </div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;">
              <thead><tr style="background:var(--surface-2);">
                <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Member</th>
                <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.04em;" class="hide-mobile">Date</th>
                <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Mode</th>
                <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Amount</th>
              </tr></thead>
              <tbody>${revDetailRows}</tbody>
            </table>
          </div>
          ${revHasMore ? `<div style="padding:10px 16px;text-align:center;font-size:12px;color:var(--text-tertiary);border-top:1px solid var(--border-subtle);">Showing 200 of ${payCount} payments</div>` : ''}
        </div>
      </div>` : ''}

      ${periodExpenses.length > 0 ? `<div id="fin-exp-detail" style="display:none;margin-bottom:20px;animation:fadeUp 200ms var(--ease-out) both;">
        <div class="settings-card" style="padding:0;overflow:hidden;">
          <div style="padding:14px 16px;border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;justify-content:space-between;">
            <div style="font-size:14px;font-weight:600;color:var(--text-primary);">Expenses Breakdown</div>
            <div style="font-size:12px;color:var(--red);font-weight:600;">${fmtCurrency(totalExp)} total</div>
          </div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;">
              <thead><tr style="background:var(--surface-2);">
                <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Expense</th>
                <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.04em;" class="hide-mobile">Date</th>
                <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Amount</th>
              </tr></thead>
              <tbody>${expDetailRows}</tbody>
            </table>
          </div>
          ${expHasMore ? `<div style="padding:10px 16px;text-align:center;font-size:12px;color:var(--text-tertiary);border-top:1px solid var(--border-subtle);">Showing 200 of ${periodExpenses.length} expenses</div>` : ''}
        </div>
      </div>` : ''}

      ${dueMbrs.length > 0 ? `<div id="fin-dues-detail" style="display:none;margin-bottom:20px;animation:fadeUp 200ms var(--ease-out) both;">
        <div class="settings-card" style="padding:0;overflow:hidden;">
          <div style="padding:14px 16px;border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;justify-content:space-between;">
            <div style="font-size:14px;font-weight:600;color:var(--text-primary);">Pending Dues Breakdown</div>
            <div style="font-size:12px;color:var(--amber);font-weight:600;">${fmtCurrency(totalDue)} total</div>
          </div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;">
              <thead><tr style="background:var(--surface-2);">
                <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Member</th>
                <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.04em;" class="hide-mobile">Plan</th>
                <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Status</th>
                <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Amount</th>
              </tr></thead>
              <tbody>${dueDetailRows}</tbody>
            </table>
          </div>
        </div>
      </div>` : ''}

      <div class="finance-charts">
        <div class="settings-card">
          <div class="settings-card-title" style="margin-bottom:12px;">Revenue vs Expenses</div>
          <div style="display:flex;gap:16px;margin-bottom:12px;">
            <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-tertiary);"><span style="width:10px;height:10px;background:var(--brand);border-radius:2px;"></span>Revenue</div>
            <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-tertiary);"><span style="width:10px;height:10px;background:var(--red);border-radius:2px;opacity:0.4;"></span>Expenses</div>
          </div>
          <div style="display:flex;align-items:flex-end;gap:8px;padding-top:8px;">${barChart}</div>
        </div>
        <div class="settings-card">
          <div class="settings-card-title" style="margin-bottom:12px;">Payment Split</div>
          <div style="display:flex;align-items:center;gap:24px;">
            <div style="width:100px;height:100px;border-radius:50%;background:conic-gradient(var(--brand) 0% ${cashPct}%, var(--amber) ${cashPct}% ${cashPct+cardPct}%, var(--green) ${cashPct+cardPct}% 100%);position:relative;">
              <div style="position:absolute;inset:25%;border-radius:50%;background:var(--surface-1);"></div>
            </div>
            <div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span style="width:8px;height:8px;border-radius:50%;background:var(--brand);"></span><span style="font-size:13px;color:var(--text-secondary);">Cash \u20B9${cashT.toLocaleString('en-IN')}</span></div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span style="width:8px;height:8px;border-radius:50%;background:var(--amber);"></span><span style="font-size:13px;color:var(--text-secondary);">Card \u20B9${cardT.toLocaleString('en-IN')}</span></div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;"><span style="width:8px;height:8px;border-radius:50%;background:var(--green);"></span><span style="font-size:13px;color:var(--text-secondary);">Online \u20B9${onlineT.toLocaleString('en-IN')}</span></div>
              <div style="font-size:13px;color:var(--text-tertiary);">New members: <span style="color:var(--text-primary);font-weight:600;">${newMbrs}</span></div>
            </div>
          </div>
        </div>
      </div>
      ${sortedCats.length>0?`<div class="settings-card" style="margin-top:20px;">
        <div class="settings-card-title" style="margin-bottom:12px;">Top Expense Categories</div>
        ${sortedCats.map(([cat,amt])=>{const pct2=Math.round((amt/totalExp)*100);const barW=Math.max(2,(amt/maxCat)*100);const icon=getCategoryIcon(cat);
          return`<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;"><span style="font-size:16px;width:24px;text-align:center;">${icon}</span><span style="font-size:13px;color:var(--text-secondary);width:100px;">${cat}</span><div style="flex:1;height:8px;background:var(--surface-2);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${barW}%;background:var(--brand);border-radius:4px;"></div></div><span style="font-size:13px;font-weight:600;color:var(--text-primary);font-variant-numeric:tabular-nums;width:80px;text-align:right;">\u20B9${amt.toLocaleString('en-IN')}</span><span style="font-size:11px;color:var(--text-tertiary);width:36px;text-align:right;">${pct2}%</span></div>`;}).join('')}
      </div>`:''}
    </div>`;

    document.querySelectorAll('[data-fin-p]').forEach(btn=>{
      btn.addEventListener('click',()=>renderFinance(document.getElementById('gym-content'),btn.dataset.finP));
    });
    // Custom date range
    document.getElementById('fin-custom-btn')?.addEventListener('click', () => {
      const rangeEl = document.getElementById('fin-custom-range');
      if (rangeEl) {
        const isHidden = rangeEl.style.display === 'none';
        rangeEl.style.display = isHidden ? 'flex' : 'none';
        if (isHidden) document.getElementById('fin-custom-start')?.focus();
      }
    });
    document.getElementById('fin-custom-apply')?.addEventListener('click', () => {
      const cs = document.getElementById('fin-custom-start')?.value;
      const ce = document.getElementById('fin-custom-end')?.value;
      if (!cs) { showToast('Please select a start date', 'amber'); return; }
      renderFinance(document.getElementById('gym-content'), 'custom', cs, ce || cs);
    });
    // Auto-apply when end date is changed via the native picker
    document.getElementById('fin-custom-end')?.addEventListener('change', () => {
      const cs = document.getElementById('fin-custom-start')?.value;
      const ce = document.getElementById('fin-custom-end')?.value;
      if (cs && ce) renderFinance(document.getElementById('gym-content'), 'custom', cs, ce);
    });

    // ── Toggle helper for detail panels ──────────────────────────
    function bindToggle(cardId, detailId) {
      document.getElementById(cardId)?.addEventListener('click', () => {
        const detail = document.getElementById(detailId);
        if (!detail) return;
        const arrow = document.querySelector(`#${cardId} .finance-stat-sub span:last-child`);
        if (detail.style.display === 'none') {
          detail.style.display = 'block';
          if (arrow) arrow.textContent = '\u25B2';
        } else {
          detail.style.display = 'none';
          if (arrow) arrow.textContent = '\u25BC';
        }
      });
    }

    bindToggle('fin-rev-card', 'fin-rev-detail');
    bindToggle('fin-exp-card', 'fin-exp-detail');
    bindToggle('fin-dues-card', 'fin-dues-detail');
  }
  loadAndRender();
}



export { renderFinance };