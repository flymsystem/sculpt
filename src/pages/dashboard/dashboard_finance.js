import { S } from './state.js';
import { showSectionLoading } from './helpers.js';
import { getExpensesByRange, getAllExpenses, getMonthlyExpenseTotals, getCategoryIcon } from '../../lib/expenses.js';

let _nav;
export function setNavHandler(fn) { _nav = fn; }

function renderFinance(c, period) {
  period = period || 'month';
  const gymId = S.gym?.id;
  const now = new Date();

  function getPeriodBounds(p) {
    const y=now.getFullYear(),mo=now.getMonth(),d=now.getDate();
    const dow=now.getDay(); const mon=new Date(y,mo,d-((dow+6)%7));
    const sun=new Date(mon); sun.setDate(mon.getDate()+6);
    const pMon=new Date(mon); pMon.setDate(mon.getDate()-7);
    const pSun=new Date(mon); pSun.setDate(mon.getDate()-1);
    switch(p){
      case'today':return{start:new Date(y,mo,d),end:now,prev:{start:new Date(y,mo,d-1),end:new Date(y,mo,d-1,23,59,59)},label:'Today'};
      case'week':return{start:mon,end:sun,prev:{start:pMon,end:pSun},label:'This Week'};
      case'month':return{start:new Date(y,mo,1),end:new Date(y,mo+1,0),prev:{start:new Date(y,mo-1,1),end:new Date(y,mo,0)},label:'This Month'};
      case'lastmonth':return{start:new Date(y,mo-1,1),end:new Date(y,mo,0),prev:{start:new Date(y,mo-2,1),end:new Date(y,mo-1,0)},label:'Last Month'};
      case'year':return{start:new Date(y,0,1),end:new Date(y,11,31),prev:{start:new Date(y-1,0,1),end:new Date(y-1,11,31)},label:'This Year'};
      default:return{start:null,end:null,prev:null,label:'All Time'};
    }
  }
  function fmtISO(d){return d?d.toISOString().split('T')[0]:null;}
  function inRange(ds,start,end){if(!ds||!start)return true;const d=new Date(ds+'T00:00:00');return d>=start&&d<=end;}

  const bounds = getPeriodBounds(period);

  // Revenue from payment_history (accurate — tied to actual payment dates)
  function phInRange(ph, start, end) {
    if (!ph.paid_at || !start) return true;
    const d = new Date(ph.paid_at);
    return d >= start && d <= end;
  }
  const paidPH = (S.payHistory||[]).filter(p => phInRange(p, bounds.start, bounds.end));
  const totalRev = paidPH.reduce((s,p) => s + (parseFloat(p.amount)||0), 0);
  const prevPH = bounds.prev ? (S.payHistory||[]).filter(p => phInRange(p, bounds.prev.start, bounds.prev.end)) : [];
  const prevRev = prevPH.reduce((s,p) => s + (parseFloat(p.amount)||0), 0);

  // Due amounts still come from current member state
  const dueMbrs = S.members.filter(m => (m.payment_status==='Due' || m.payment_status==='Partial'));
  const totalDue = dueMbrs.reduce((s,m) => s + (parseFloat(m.plan_price)||0), 0);

  // Cash vs Card vs Online breakdown from payment_history
  const cashT = paidPH.filter(p => p.payment_mode==='Cash').reduce((s,p) => s + (parseFloat(p.amount)||0), 0);
  const cardT = paidPH.filter(p => p.payment_mode==='Card').reduce((s,p) => s + (parseFloat(p.amount)||0), 0);
  const onlineT = paidPH.filter(p => p.payment_mode==='Online').reduce((s,p) => s + (parseFloat(p.amount)||0), 0);
  const cashPct = totalRev > 0 ? Math.round((cashT/totalRev)*100) : 0;
  const cardPct = totalRev > 0 ? Math.round((cardT/totalRev)*100) : 0;
  const newMbrs = S.members.filter(m => inRange(m.join_date, bounds.start, bounds.end)).length;
  function gPct(c2,p2){if(p2===0)return c2>0?100:0;return Math.round(((c2-p2)/p2)*100);}
  function gHTML(pct){if(pct===0)return'<span style="font-size:12px;color:var(--text-tertiary);">—</span>';const col=pct>0?'var(--green)':'var(--red)';return`<span style="font-size:12px;color:${col};font-weight:500;">${pct>0?'↑':'↓'} ${Math.abs(pct)}%</span>`;}
  const revG = gPct(totalRev,prevRev);
  function computeMonthlyRev(n){const r=[];for(let i=n-1;i>=0;i--){const dd=new Date(now.getFullYear(),now.getMonth()-i,1);const e2=new Date(dd.getFullYear(),dd.getMonth()+1,0);const lb=dd.toLocaleDateString('en-IN',{month:'short',year:'2-digit'});const tot=(S.payHistory||[]).filter(p=>{if(!p.paid_at)return false;const pd=new Date(p.paid_at);return pd>=dd&&pd<=e2;}).reduce((s,p)=>s+(parseFloat(p.amount)||0),0);r.push({label:lb,total:tot});}return r;}

  async function loadAndRender() {
    // Show loading skeleton immediately so user sees instant feedback
    if (!c.querySelector('.finance-stats')) {
      showSectionLoading(c, 'Finance');
    }

    let totalExp=0,prevExp2=0,catBreakdown={},monthlyExpT=[];
    try{
      let pExps=[];
      if(bounds.start){pExps=await getExpensesByRange(gymId,fmtISO(bounds.start),fmtISO(bounds.end));}
      else{pExps=await getAllExpenses(gymId);}
      totalExp=pExps.reduce((s,e)=>s+parseFloat(e.amount),0);
      if(bounds.prev){const pe=await getExpensesByRange(gymId,fmtISO(bounds.prev.start),fmtISO(bounds.prev.end));prevExp2=pe.reduce((s,e)=>s+parseFloat(e.amount),0);}
      pExps.forEach(e=>{catBreakdown[e.category]=(catBreakdown[e.category]||0)+parseFloat(e.amount);});
      monthlyExpT=await getMonthlyExpenseTotals(gymId,6);
    }catch(err){console.warn('[Flym] Expense fetch:',err);}

    const netP=totalRev-totalExp;const expG=gPct(totalExp,prevExp2);const profitG=gPct(netP,prevRev-prevExp2);
    const monthlyRev=computeMonthlyRev(6);
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

    c.innerHTML = `<div class="content-inner page-enter">
      <div class="page-header"><div class="page-header-left"><div class="page-title">Finance</div>
        <div class="page-sub">${bounds.label}</div></div></div>
      <div class="finance-period-bar">
        ${['today','week','month','lastmonth','year','all'].map(p=>`<button class="period-btn ${period===p?'active':''}" data-fin-p="${p}">${
          p==='today'?'Today':p==='week'?'This Week':p==='month'?'This Month':p==='lastmonth'?'Last Month':p==='year'?'This Year':'All Time'}</button>`).join('')}
      </div>
      <div class="finance-stats">
        <div class="finance-stat"><div class="finance-stat-label">Revenue</div><div class="finance-stat-val" style="color:var(--green);">₹${totalRev.toLocaleString('en-IN')}</div><div class="finance-stat-sub">${gHTML(revG)}</div></div>
        <div class="finance-stat"><div class="finance-stat-label">Expenses</div><div class="finance-stat-val" style="color:var(--red);">₹${totalExp.toLocaleString('en-IN')}</div><div class="finance-stat-sub">${gHTML(expG)}</div></div>
        <div class="finance-stat"><div class="finance-stat-label">Net Profit</div><div class="finance-stat-val" style="color:${netP>=0?'var(--brand)':'var(--red)'};">₹${netP.toLocaleString('en-IN')}</div><div class="finance-stat-sub">${gHTML(profitG)}</div></div>
        <div class="finance-stat"><div class="finance-stat-label">Pending Dues</div><div class="finance-stat-val" style="color:var(--amber);">₹${totalDue.toLocaleString('en-IN')}</div><div class="finance-stat-sub">${dueMbrs.length} member${dueMbrs.length!==1?'s':''}</div></div>
      </div>
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
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span style="width:8px;height:8px;border-radius:50%;background:var(--brand);"></span><span style="font-size:13px;color:var(--text-secondary);">Cash ₹${cashT.toLocaleString('en-IN')}</span></div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span style="width:8px;height:8px;border-radius:50%;background:var(--amber);"></span><span style="font-size:13px;color:var(--text-secondary);">Card ₹${cardT.toLocaleString('en-IN')}</span></div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;"><span style="width:8px;height:8px;border-radius:50%;background:var(--green);"></span><span style="font-size:13px;color:var(--text-secondary);">Online ₹${onlineT.toLocaleString('en-IN')}</span></div>
              <div style="font-size:13px;color:var(--text-tertiary);">New members: <span style="color:var(--text-primary);font-weight:600;">${newMbrs}</span></div>
            </div>
          </div>
        </div>
      </div>
      ${sortedCats.length>0?`<div class="settings-card" style="margin-top:20px;">
        <div class="settings-card-title" style="margin-bottom:12px;">Top Expense Categories</div>
        ${sortedCats.map(([cat,amt])=>{const pct2=Math.round((amt/totalExp)*100);const barW=Math.max(2,(amt/maxCat)*100);const icon=getCategoryIcon(cat);
          return`<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;"><span style="font-size:16px;width:24px;text-align:center;">${icon}</span><span style="font-size:13px;color:var(--text-secondary);width:100px;">${cat}</span><div style="flex:1;height:8px;background:var(--surface-2);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${barW}%;background:var(--brand);border-radius:4px;"></div></div><span style="font-size:13px;font-weight:600;color:var(--text-primary);font-variant-numeric:tabular-nums;width:80px;text-align:right;">₹${amt.toLocaleString('en-IN')}</span><span style="font-size:11px;color:var(--text-tertiary);width:36px;text-align:right;">${pct2}%</span></div>`;}).join('')}
      </div>`:''}
    </div>`;

    document.querySelectorAll('[data-fin-p]').forEach(btn=>{
      btn.addEventListener('click',()=>renderFinance(document.getElementById('gym-content'),btn.dataset.finP));
    });
  }
  loadAndRender();
}



export { renderFinance };
