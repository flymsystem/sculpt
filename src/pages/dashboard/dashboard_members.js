import { S, _memberPage, PAGE_SIZE, setMemberPage } from './state.js';
import { expiryDate, memberStatus, escHtml, fmtDate, av2 } from './helpers.js';
import { openPhotoLightbox } from '../../components/photo-lightbox.js';

// Modal functions injected by index.js to avoid circular deps
let _openAddModal, _openEditModal, _confirmDelete, _confirmCancelMembership, _openRenewModal, _openWAModal, _openInvoiceModal, _openMemberDetailModal, _openClearBalanceModal;
export function setModalHandlers(h) { _openAddModal=h.openAddModal; _openEditModal=h.openEditModal; _confirmDelete=h.confirmDelete; _confirmCancelMembership=h.confirmCancelMembership; _openRenewModal=h.openRenewModal; _openWAModal=h.openWAModal; _openInvoiceModal=h.openInvoiceModal; _openMemberDetailModal=h.openMemberDetailModal; _openClearBalanceModal=h.openClearBalanceModal; }

function renderMembers(c) {
  const nameCounts = {};
  S.plans.forEach(p => { nameCounts[p.name] = (nameCounts[p.name]||0)+1; });
  const planOpts = S.plans.map(p => {
    let label = p.name;
    if (nameCounts[p.name] > 1) label += ` (₹${Number(p.price).toLocaleString('en-IN')})`;
    return `<option value="${p.id}">${label}</option>`;
  }).join('');

  c.innerHTML = `<div class="content-inner page-enter">

    <div class="page-header">
      <div class="page-header-left">
        <div class="page-title">All Members</div>
        <div class="page-sub">${S.members.length} member${S.members.length !== 1 ? 's' : ''} · ${S.members.filter(m=>memberStatus(m)==='Active').length} active</div>
      </div>
      <button class="btn btn-primary" id="btn-add-m">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
        Add Member
      </button>
    </div>

    <div class="members-filters">
      <input type="text" class="form-input" id="msearch"
        placeholder="Search name, phone or email…"
        style="flex:2;min-width:180px;padding:9px 14px;">
      <select class="form-input" id="sf-status" style="flex:1;min-width:120px;">
        <option value="">All Status</option>
        <option value="Active">Active</option>
        <option value="Trial">Trial</option>
        <option value="Expiring">Expiring</option>
        <option value="Expired">Expired</option>
        <option value="Due">Due</option>
        <option value="Cancelled">Cancelled</option>
      </select>
      <select class="form-input" id="sf-plan" style="flex:1;min-width:120px;">
        <option value="">All Plans</option>
        ${planOpts}
      </select>
    </div>

    <div class="members-table-wrap" id="members-table-wrap">
      <div class="members-table-scroll">
        <table class="members-table">
          <thead><tr>
            <th>Member</th>
            <th>Type</th>
            <th>Plan</th>
            <th>Join Date</th>
            <th>Expiry</th>
            <th>Payment</th>
            <th>Status</th>
            <th style="text-align:right;">Actions</th>
          </tr></thead>
          <tbody id="mtbody"></tbody>
        </table>
      </div>
      <div id="members-pagination" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-top:1px solid var(--border-subtle);font-size:13px;color:var(--text-tertiary);"></div>
    </div>

  </div>`;

  setMemberPage(1);

  fillTable(S.members);
  document.getElementById('btn-add-m').addEventListener('click', _openAddModal);
  document.getElementById('msearch').addEventListener('input', () => { setMemberPage(1); filterTable(); });
  document.getElementById('sf-status').addEventListener('change', () => { setMemberPage(1); filterTable(); });
  document.getElementById('sf-plan').addEventListener('change', () => { setMemberPage(1); filterTable(); });

  const tableWrap = document.getElementById('members-table-wrap');
  if (tableWrap) {
    tableWrap.addEventListener('click', function(e) {
      const waBtn   = e.target.closest('[data-wa]');
      const invBtn  = e.target.closest('[data-inv]');
      const editBtn = e.target.closest('[data-edit]');
      const delBtn  = e.target.closest('[data-del]');
      const renewBtn= e.target.closest('[data-renew]');
      const balBtn  = e.target.closest('[data-bal]');
      const cancelMemBtn = e.target.closest('[data-cancelmem]');
      const photoEl = e.target.closest('[data-photo]');
      if (photoEl) { e.stopPropagation(); openPhotoLightbox(photoEl.dataset.photo); return; }
      if (waBtn)    { e.stopPropagation(); _openWAModal(waBtn.dataset.wa);         return; }
      if (invBtn)   { e.stopPropagation(); _openInvoiceModal(invBtn.dataset.inv);  return; }
      if (editBtn)  { e.stopPropagation(); _openEditModal(editBtn.dataset.edit);   return; }
      if (delBtn)   { e.stopPropagation(); _confirmDelete(delBtn.dataset.del);     return; }
      if (renewBtn) { e.stopPropagation(); _openRenewModal(renewBtn.dataset.renew); return; }
      if (balBtn)   { e.stopPropagation(); _openClearBalanceModal(balBtn.dataset.bal); return; }
      if (cancelMemBtn) { e.stopPropagation(); _confirmCancelMembership(cancelMemBtn.dataset.cancelmem); return; }
      const row = e.target.closest('.member-row');
      if (row?.dataset.id) _openMemberDetailModal(row.dataset.id);
    });
  }
}

function fillTable(list) {
  const tbody = document.getElementById('mtbody');
  const pagEl = document.getElementById('members-pagination');
  if (!tbody) return;

  const totalItems = list.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  if (_memberPage > totalPages) setMemberPage(totalPages);
  const start = (_memberPage - 1) * PAGE_SIZE;
  const pageList = list.slice(start, start + PAGE_SIZE);

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:48px 20px;text-align:center;color:var(--text-tertiary);">
      No members found. Click <strong style="color:var(--text-primary);">Add Member</strong> to get started.</td></tr>`;
    if (pagEl) pagEl.innerHTML = '';
    return;
  }
  tbody.innerHTML = pageList.map(m => {
    const st     = memberStatus(m);
    const exp    = expiryDate(m);
    const mType  = m.member_type || m.memberType || 'Paid';
    const stBadge = {
      Active:'badge-green', Expiring:'badge-amber', Expired:'badge-red',
      Due:'badge-red', Trial:'badge-amber', Cancelled:'badge-muted'
    }[st] || 'badge-muted';
    const expColor = st==='Expired'?'var(--red)':st==='Expiring'?'var(--amber)':'var(--text-tertiary)';

    // Clean icon buttons
    const waBtn  = `<button class="btn btn-sm" data-wa="${m.id}" title="WhatsApp" style="background:var(--green-fade);color:var(--green);border:1px solid var(--green-strong);padding:5px 8px;">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
    </button>`;
    const invBtn = `<button class="btn btn-sm" data-inv="${m.id}" title="Invoice" style="background:var(--amber-fade);color:var(--amber);border:1px solid var(--amber-strong);padding:5px 8px;">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
    </button>`;
    const editBtn= `<button class="btn btn-sm btn-ghost" data-edit="${m.id}" title="Edit" style="padding:5px 8px;">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
    </button>`;
    const delBtn = `<button class="btn btn-sm" data-del="${m.id}" title="Remove" style="background:var(--red-fade);color:var(--red);border:1px solid var(--red-strong);padding:5px 8px;">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
    </button>`;
    const renewBtn = (st === 'Expired' || st === 'Expiring') && mType !== 'Trial' && !m.cancelled_at
      ? `<button class="btn btn-sm" data-renew="${m.id}" title="Renew membership" style="background:var(--brand-fade);color:var(--brand-text);border:1px solid var(--brand-fade-strong);padding:5px 8px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>` : '';
    const cancelMemBtn = m.cancelled_at
      ? `<button class="btn btn-sm" data-cancelmem="${m.id}" title="Reactivate membership" style="background:var(--green-fade);color:var(--green);border:1px solid var(--green-strong);padding:5px 8px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>`
      : `<button class="btn btn-sm btn-ghost" data-cancelmem="${m.id}" title="Cancel membership" style="padding:5px 8px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
        </button>`;
    const balBtn = (parseFloat(m.balance_due)||0) > 0
      ? `<button class="btn btn-sm" data-bal="${m.id}" title="Clear balance (₹${Number(m.balance_due).toLocaleString('en-IN')} due)" style="background:var(--amber-fade);color:var(--amber);border:1px solid var(--amber-strong);padding:5px 8px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </button>` : '';

    return `<tr class="member-row" data-id="${m.id}" style="cursor:pointer;" title="Click to view details">
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          ${m.photo_url
            ? `<div class="member-avatar" data-photo="${m.photo_url}" style="overflow:hidden;padding:0;cursor:zoom-in;"><img src="${m.photo_url}" style="width:100%;height:100%;object-fit:cover;"></div>`
            : `<div class="member-avatar">${av2(m.full_name||m.name)}</div>`}
          <div>
            <div style="font-weight:500;color:var(--text-primary);font-size:14px;">${escHtml(m.full_name||m.name)}</div>
            <div style="font-size:11px;color:var(--text-tertiary);">${m.phone||'—'}</div>
          </div>
        </div>
      </td>
      <td><span class="badge ${mType==='Trial'?'badge-amber':mType==='Paid'?'badge-blue':'badge-red'}">${mType}</span></td>
      <td>
        ${m.plan_name||m.plan
          ? `<span style="font-size:13px;font-weight:500;color:var(--text-primary);">${m.plan_name||m.plan}</span>`
          : `<span style="color:var(--text-quaternary);font-size:12px;">—</span>`}
      </td>
      <td style="font-size:12px;color:var(--text-tertiary);">${fmtDate(m.join_date)}</td>
      <td style="font-size:12px;color:${expColor};font-weight:${st==='Expired'||st==='Expiring'?'600':'400'};">
        ${exp ? exp.toLocaleDateString('en-IN') : '—'}
      </td>
      <td>
        <span class="badge ${(m.payment_mode||m.payMode)==='Cash'?'badge-amber':(m.payment_mode||m.payMode)==='Card'?'badge-purple':'badge-blue'}">
          ${(m.payment_mode||m.payMode||'—').replace('Online Payment','Online')}
        </span>
      </td>
      <td><span class="badge ${stBadge}">${st}</span></td>
      <td>
        <div class="action-btns" style="gap:3px;flex-wrap:nowrap;justify-content:flex-end;">
          ${renewBtn}${balBtn}${cancelMemBtn}${waBtn}${invBtn}${editBtn}${delBtn}
        </div>
      </td>
    </tr>`;
  }).join('');

  // Pagination controls
  if (pagEl) {
    if (totalPages <= 1) {
      pagEl.innerHTML = `<span>Showing all ${totalItems} member${totalItems!==1?'s':''}</span><span></span>`;
    } else {
      pagEl.innerHTML = `
        <span>Showing ${start+1}–${Math.min(start+PAGE_SIZE, totalItems)} of ${totalItems}</span>
        <div style="display:flex;gap:6px;align-items:center;">
          <button class="btn btn-ghost btn-sm" id="pg-prev" ${_memberPage<=1?'disabled':''} style="padding:4px 10px;font-size:12px;">← Prev</button>
          <span style="font-size:12px;font-weight:500;color:var(--text-secondary);">Page ${_memberPage} of ${totalPages}</span>
          <button class="btn btn-ghost btn-sm" id="pg-next" ${_memberPage>=totalPages?'disabled':''} style="padding:4px 10px;font-size:12px;">Next →</button>
        </div>`;
      document.getElementById('pg-prev')?.addEventListener('click', () => { setMemberPage(_memberPage - 1); filterTable(); document.getElementById('members-table-wrap')?.scrollIntoView({behavior:'smooth',block:'start'}); });
      document.getElementById('pg-next')?.addEventListener('click', () => { setMemberPage(_memberPage + 1); filterTable(); document.getElementById('members-table-wrap')?.scrollIntoView({behavior:'smooth',block:'start'}); });
    }
  }
}

function filterTable() {
  const q   = (document.getElementById('msearch')?.value||'').toLowerCase().trim();
  const sf  = document.getElementById('sf-status')?.value||'';
  const pf  = document.getElementById('sf-plan')?.value||''; // now a plan ID string
  fillTable(S.members.filter(m => {
    const st    = memberStatus(m);
    const mType = m.member_type||m.memberType||'Paid';
    const name  = (m.full_name||m.name||'').toLowerCase();
    // Search: name, phone or email
    const matchQ  = !q || name.includes(q) || (m.phone||'').includes(q) || (m.email||'').toLowerCase().includes(q);
    // Status filter
    const matchSt = !sf || st===sf || (sf==='Trial' && mType==='Trial');
    // Plan filter: match by plan_id (exact variant), fallback to name for legacy records
    let matchPf = true;
    if (pf) {
      if (m.plan_id) {
        matchPf = String(m.plan_id) === pf;
      } else {
        // Legacy: find plan by id and compare name
        const planObj = S.plans.find(p => String(p.id) === pf);
        matchPf = planObj ? (m.plan_name||m.plan) === planObj.name : false;
      }
    }
    return matchQ && matchSt && matchPf;
  }));
}



export { renderMembers, fillTable, filterTable };
