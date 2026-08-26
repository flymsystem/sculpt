import { S, _memberPage, PAGE_SIZE, setMemberPage } from './state.js';
import { expiryDate, memberStatus, escHtml, fmtDate, av2 } from './helpers.js';
import { openPhotoLightbox } from '../../components/photo-lightbox.js';
import { hasAccess } from '../../lib/permissions.js';

import { showConfirm } from '../../components/confirm.js';
import { showToast } from '../../components/toast.js';
import { deleteMember, getMembers } from '../../lib/members.js';

// Multi-select state
const _selected = new Set();
let _selectMode = false;

// Modal functions injected by index.js to avoid circular deps
let _openAddModal, _openEditModal, _confirmDelete, _confirmCancelMembership,
    _openRenewModal, _openWAModal, _openInvoiceModal, _openMemberDetailModal,
    _openClearBalanceModal;
export function setModalHandlers(h) {
  _openAddModal           = h.openAddModal;
  _openEditModal          = h.openEditModal;
  _confirmDelete          = h.confirmDelete;
  _confirmCancelMembership= h.confirmCancelMembership;
  _openRenewModal         = h.openRenewModal;
  _openWAModal            = h.openWAModal;
  _openInvoiceModal       = h.openInvoiceModal;
  _openMemberDetailModal  = h.openMemberDetailModal;
  _openClearBalanceModal  = h.openClearBalanceModal;
}

let _searchTimer = null;
function _debouncedFilter() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => { setMemberPage(1); filterTable(); }, 150);
}

function _injectMembersStyles() {
  if (document.getElementById('sculpt-members-styles')) return;
  const s = document.createElement('style');
  s.id = 'sculpt-members-styles';
  s.textContent = `
    .show-mobile-only { display: none !important; }
    .member-row:focus { outline: 2px solid var(--brand); outline-offset: -2px; border-radius: 2px; }
    .member-row:focus:not(:focus-visible) { outline: none; }
    .member-row.row-selected { background: var(--brand-fade) !important; }
    .multi-del-bar { display:flex; align-items:center; gap:12px; padding:10px 16px; background:var(--red-fade);
      border:1px solid var(--red-strong); border-radius:var(--radius-md); margin-bottom:12px; }
    .multi-del-bar .count { font-size:13px; font-weight:600; color:var(--red); }
    .multi-del-bar .btn-desel { font-size:12px; color:var(--text-tertiary); background:none; border:none;
      cursor:pointer; text-decoration:underline; padding:0; }
    .sel-chk { width:16px; height:16px; accent-color:var(--brand); cursor:pointer; margin:0; flex-shrink:0; }
    .col-sel { display:none; }
    .select-mode .col-sel { display:table-cell; }
    @media (max-width: 768px) {
      .members-table { min-width: 0 !important; }
      .members-table th, .members-table td { padding: 10px 8px; }
      .show-mobile-only { display: inline-flex !important; }
      .action-btns { justify-content: flex-end; gap: 4px; }
    }
  `;
  document.head.appendChild(s);
}

function renderMembers(c) {
  _injectMembersStyles();
  const role = S.role || 'owner';
  const canAdd = hasAccess(role, 'add_member');
  const canDelete = hasAccess(role, 'delete_member');

  const nameCounts = {};
  S.plans.forEach(p => { nameCounts[p.name] = (nameCounts[p.name]||0)+1; });
  const planOpts = S.plans.map(p => {
    let label = p.name;
    if (nameCounts[p.name] > 1) label += ` (\u20B9${Number(p.price).toLocaleString('en-IN')})`;
    return `<option value="${escHtml(String(p.id))}">${escHtml(label)}</option>`;
  }).join('');

  _selected.clear();
  _selectMode = false;
  closeOverflowMenu();
  if (typeof window.__sculptRegisterCleanup === 'function') window.__sculptRegisterCleanup(closeOverflowMenu);

  c.innerHTML = `<div class="content-inner page-enter">

    <div class="page-header">
      <div class="page-header-left">
        <div class="page-title">All Members</div>
        <div class="page-sub">${S.members.length} member${S.members.length !== 1 ? 's' : ''} \u00B7 ${S.members.filter(m=>memberStatus(m)==='Active').length} active</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        ${canDelete ? `<button class="btn btn-ghost" id="btn-select-mode" type="button" style="padding:8px 14px;font-size:13px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true" style="margin-right:4px;vertical-align:-2px;"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>Select
        </button>` : ''}
        ${canAdd ? `<button class="btn btn-primary" id="btn-add-m" type="button" aria-label="Add new member">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          Add Member
        </button>` : ''}
      </div>
    </div>

    <div id="multi-del-bar" class="multi-del-bar" style="display:none;">
      <span class="count" id="multi-del-count">0 selected</span>
      <button class="btn btn-sm" id="btn-multi-del" type="button"
        style="background:var(--red-fade);color:var(--red);border:1px solid var(--red-strong);padding:5px 14px;font-size:12px;font-weight:600;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="margin-right:4px;vertical-align:-2px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>Remove Selected
      </button>
      <button class="btn-desel" id="btn-exit-select" type="button">Cancel</button>
    </div>

    <div class="members-filters" role="search">
      <label class="sr-only" for="msearch">Search members</label>
      <input type="search" class="form-input mf-search" id="msearch" name="search"
        placeholder="Search name, phone, email or app number\u2026" autocomplete="off">
      <label class="sr-only" for="sf-status">Filter by status</label>
      <select class="form-input" id="sf-status">
        <option value="">All Status</option>
        <option value="Active">Active</option>
        <option value="Trial">Trial</option>
        <option value="Expiring">Expiring</option>
        <option value="Expired">Expired</option>
        <option value="Due">Due</option>
        <option value="Cancelled">Cancelled</option>
      </select>
      <label class="sr-only" for="sf-plan">Filter by plan</label>
      <select class="form-input" id="sf-plan">
        <option value="">All Plans</option>
        ${planOpts}
      </select>
      <button type="button" class="mf-more-toggle" id="mf-more-toggle" aria-expanded="false" aria-controls="mf-more">
        <span id="mf-more-label">More filters</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="mf-more" id="mf-more">
        <label class="sr-only" for="sf-joindate">Filter by join date</label>
        <input type="date" class="form-input mf-date" id="sf-joindate" title="Filter by join date">
        <label class="sr-only" for="sf-addedby">Filter by who added them</label>
        <select class="form-input" id="sf-addedby">
          <option value="">Added By: Anyone</option>
          ${[...new Set(S.members.map(m => m.added_by_name).filter(Boolean))].sort().map(n => `<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="members-table-wrap" id="members-table-wrap">
      <div id="members-pagination" style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--border-subtle);font-size:13px;color:var(--text-tertiary);"></div>
      <div class="members-table-scroll">
        <table class="members-table" role="table" aria-label="Members list">
          <thead><tr>
            ${canDelete ? `<th scope="col" class="col-sel" style="width:36px;"><input type="checkbox" class="sel-chk" id="sel-all" title="Select all on this page"></th>` : ''}
            <th scope="col">Member</th>
            <th scope="col" class="hide-mobile">Type</th>
            <th scope="col" class="hide-mobile">Plan</th>
            <th scope="col" class="hide-mobile">Join Date</th>
            <th scope="col">Expiry</th>
            <th scope="col" class="hide-mobile">Payment</th>
            <th scope="col">Status</th>
            <th scope="col" style="text-align:right;">Actions</th>
          </tr></thead>
          <tbody id="mtbody"></tbody>
        </table>
      </div>
    </div>

  </div>`;

  setMemberPage(1);

  fillTable(S.members);
  document.getElementById('btn-add-m')?.addEventListener('click', () => _openAddModal && _openAddModal());
  document.getElementById('msearch').addEventListener('input', _debouncedFilter);
  document.getElementById('sf-status').addEventListener('change', () => { setMemberPage(1); filterTable(); });
  document.getElementById('sf-plan').addEventListener('change', () => { setMemberPage(1); filterTable(); });
  document.getElementById('sf-joindate').addEventListener('change', () => { setMemberPage(1); filterTable(); });
  document.getElementById('sf-addedby')?.addEventListener('change', () => { setMemberPage(1); filterTable(); });

  // "More filters" toggle (mobile only — display:none on desktop where
  // .mf-more is always expanded, see components.css). Starts closed
  // every render; if a join-date or added-by filter is already active
  // (e.g. carried over from before a re-render), open it immediately so
  // an active filter is never hidden without any visible sign it's set.
  const mfMoreBtn = document.getElementById('mf-more-toggle');
  const mfMore = document.getElementById('mf-more');
  const mfMoreLabel = document.getElementById('mf-more-label');
  function setMoreFiltersOpen(open) {
    mfMore.classList.toggle('is-open', open);
    mfMoreBtn.classList.toggle('is-open', open);
    mfMoreBtn.setAttribute('aria-expanded', String(open));
    mfMoreLabel.textContent = open ? 'Fewer filters' : 'More filters';
  }
  mfMoreBtn?.addEventListener('click', () => setMoreFiltersOpen(!mfMore.classList.contains('is-open')));
  if (document.getElementById('sf-joindate').value || document.getElementById('sf-addedby')?.value) {
    setMoreFiltersOpen(true);
  }

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
      const photoBtn = e.target.closest('[data-photo]');
      const overflowBtn = e.target.closest('[data-overflow]');
      if (photoBtn) { e.stopPropagation(); openPhotoLightbox(photoBtn.dataset.photo); return; }
      if (waBtn)   { e.stopPropagation(); _openWAModal && _openWAModal(waBtn.dataset.wa); return; }
      if (invBtn)  { e.stopPropagation(); _openInvoiceModal && _openInvoiceModal(invBtn.dataset.inv); return; }
      if (editBtn) { e.stopPropagation(); _openEditModal && _openEditModal(editBtn.dataset.edit); return; }
      if (delBtn)  { e.stopPropagation(); _confirmDelete && _confirmDelete(delBtn.dataset.del); return; }
      if (renewBtn){ e.stopPropagation(); _openRenewModal && _openRenewModal(renewBtn.dataset.renew); return; }
      if (balBtn)  { e.stopPropagation(); _openClearBalanceModal && _openClearBalanceModal(balBtn.dataset.bal); return; }
      if (cancelMemBtn) { e.stopPropagation(); _confirmCancelMembership && _confirmCancelMembership(cancelMemBtn.dataset.cancelmem); return; }
      if (overflowBtn) { e.stopPropagation(); toggleOverflowMenu(overflowBtn); return; }
      const row = e.target.closest('.member-row');
      if (row && row.dataset.id) { _openMemberDetailModal && _openMemberDetailModal(row.dataset.id); }
    });
  }

  // ── Multi-select wiring ─────────────────────────────────
  if (canDelete) {
    const _enterSelectMode = () => {
      _selectMode = true;
      document.getElementById('members-table-wrap')?.classList.add('select-mode');
      document.getElementById('multi-del-bar').style.display = 'flex';
      document.getElementById('btn-select-mode').style.display = 'none';
      _syncSelectionUI();
    };
    const _exitSelectMode = () => {
      _selectMode = false;
      _selected.clear();
      document.querySelectorAll('.row-sel').forEach(chk => {
        chk.checked = false;
        chk.closest('.member-row')?.classList.remove('row-selected');
      });
      const selAll = document.getElementById('sel-all');
      if (selAll) selAll.checked = false;
      document.getElementById('members-table-wrap')?.classList.remove('select-mode');
      document.getElementById('multi-del-bar').style.display = 'none';
      document.getElementById('btn-select-mode').style.display = '';
      _syncSelectionUI();
    };

    // Toggle button
    document.getElementById('btn-select-mode')?.addEventListener('click', _enterSelectMode);

    // Row checkboxes (delegated)
    tableWrap?.addEventListener('change', (e) => {
      const chk = e.target.closest('.row-sel');
      if (!chk) return;
      const id = chk.dataset.sel;
      if (chk.checked) _selected.add(id); else _selected.delete(id);
      chk.closest('.member-row')?.classList.toggle('row-selected', chk.checked);
      _syncSelectionUI();
    });

    // Select-all header checkbox
    document.getElementById('sel-all')?.addEventListener('change', (e) => {
      const checked = e.target.checked;
      document.querySelectorAll('.row-sel').forEach(chk => {
        chk.checked = checked;
        const id = chk.dataset.sel;
        if (checked) _selected.add(id); else _selected.delete(id);
        chk.closest('.member-row')?.classList.toggle('row-selected', checked);
      });
      _syncSelectionUI();
    });

    // Cancel / exit select mode
    document.getElementById('btn-exit-select')?.addEventListener('click', _exitSelectMode);

    // Batch delete
    document.getElementById('btn-multi-del')?.addEventListener('click', () => {
      if (!_selected.size) return;
      const names = [..._selected].map(id => {
        const m = S.members.find(x => String(x.id) === id);
        return m ? (m.full_name || m.name) : '';
      }).filter(Boolean);
      const preview = names.length <= 5
        ? names.map(n => escHtml(n)).join(', ')
        : names.slice(0,5).map(n => escHtml(n)).join(', ') + ` and ${names.length - 5} more`;

      showConfirm({
        title: `Remove ${_selected.size} member${_selected.size > 1 ? 's' : ''}?`,
        message: `This will remove: ${preview}. Their records are preserved for history and reports.`,
        confirmLabel: `Remove ${_selected.size}`,
        danger: true,
        onConfirm: async () => {
          const ids = [..._selected];
          let ok = 0, fail = 0;
          for (const id of ids) {
            try {
              if (S.gym?.id) await deleteMember(id, S.gym.id);
              ok++;
            } catch { fail++; }
          }
          // Refresh from DB
          if (S.gym?.id) {
            try { S.members = await getMembers(S.gym.id); } catch {}
          }
          _exitSelectMode();
          filterTable();
          if (fail > 0) showToast(`Removed ${ok}, failed ${fail}`, 'amber');
          else showToast(`${ok} member${ok > 1 ? 's' : ''} removed`, 'green');
        }
      });
    });
  }
}

function fillTable(list) {
  const tbody = document.getElementById('mtbody');
  const pagEl = document.getElementById('members-pagination');
  if (!tbody) return;

  const role = S.role || 'owner';
  const canEdit   = hasAccess(role, 'edit_member');
  const canDelete = hasAccess(role, 'delete_member');
  // cancel_member permission is checked inside toggleOverflowMenu() now
  // (the Cancel/Reactivate action moved into the ⋯ overflow menu), not
  // here — fillTable() no longer renders that button directly.
  const canRenew  = hasAccess(role, 'renew_member');

  const totalItems = list.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  if (_memberPage > totalPages) setMemberPage(totalPages);
  const start = (_memberPage - 1) * PAGE_SIZE;
  const pageList = list.slice(start, start + PAGE_SIZE);

  if (!pageList.length) {
    // Two different situations, two different messages. Telling an owner
    // whose search matched nothing to "add their first member" reads as a
    // bug; telling an owner with an empty gym to "clear filters" is worse.
    const gymIsEmpty = S.members.length === 0;
    tbody.innerHTML = `<tr><td colspan="${canDelete ? 9 : 8}" class="empty-state">
      <span class="empty-icon" aria-hidden="true">\uD83D\uDC65</span>
      ${gymIsEmpty
        ? `<div class="empty-title">No members yet</div>
           <p>Add your first member to start managing your gym.</p>`
        : `<div class="empty-title">No members match these filters</div>
           <p>Try a different search term, or clear the filters to see all
              ${S.members.length} member${S.members.length === 1 ? '' : 's'}.</p>
           <button class="btn btn-ghost btn-sm" id="members-clear-filters" type="button">Clear filters</button>`}
    </td></tr>`;
    if (pagEl) pagEl.innerHTML = '';
    document.getElementById('members-clear-filters')?.addEventListener('click', () => {
      const search = document.getElementById('msearch');
      const status = document.getElementById('sf-status');
      const plan = document.getElementById('sf-plan');
      const joined = document.getElementById('sf-joindate');
      if (search) search.value = '';
      if (status) status.value = '';
      if (plan) plan.value = '';
      if (joined) joined.value = '';
      setMemberPage(1);
      filterTable();
    });
    return;
  }

  tbody.innerHTML = pageList.map(m => {
    const st     = memberStatus(m);
    const exp    = expiryDate(m);
    const mType  = m.member_type || m.memberType || 'Paid';
    const stBadge = {
      Active:'badge-green', Expiring:'badge-amber', Expired:'badge-red',
      Due:'badge-red', Partial:'badge-amber', Trial:'badge-amber', Cancelled:'badge-muted'
    }[st] || 'badge-muted';
    const expColor = st==='Expired'?'var(--red)':st==='Expiring'?'var(--amber)':'var(--text-tertiary)';
    const displayName = m.full_name || m.name || '';
    const safeName = escHtml(displayName);

    // ── Action buttons (role-gated) ─────────────────────────
    const waBtn = `<button class="btn btn-sm" data-wa="${escHtml(String(m.id))}" type="button"
      title="Send WhatsApp reminder" aria-label="Send WhatsApp reminder to ${safeName}"
      style="background:var(--green-fade);color:var(--green);border:1px solid var(--green-strong);padding:5px 8px;">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
    </button>`;

    const editBtn = canEdit ? `<button class="btn btn-sm btn-ghost" data-edit="${escHtml(String(m.id))}" type="button"
      title="Edit" aria-label="Edit ${safeName}" style="padding:5px 8px;">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
    </button>` : '';

    const renewBtn = canRenew && (st === 'Expired' || st === 'Expiring') && mType !== 'Trial' && !m.cancelled_at
      ? `<button class="btn btn-sm" data-renew="${escHtml(String(m.id))}" type="button"
          title="Renew membership" aria-label="Renew membership for ${safeName}"
          style="background:var(--brand-fade);color:var(--brand-text);border:1px solid var(--brand-fade-strong);padding:5px 8px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>` : '';

    // Invoice, Clear Balance, Cancel/Reactivate and Delete used to each
    // render as their own always-visible icon (AUDIT.md C3: "too many
    // action icons per row"). They're real actions but not ones taken on
    // most rows most of the time, so they now live behind a single \u22EF
    // overflow menu (built per-member in bindOverflowMenu() below,
    // recomputed from S.members rather than serialized into the row's
    // markup). WhatsApp reminder, Edit, and (when applicable) Renew stay
    // as direct icons because they're the actions actually taken on a
    // typical row.
    const moreBtn = `<button class="btn btn-sm btn-ghost" data-overflow="${escHtml(String(m.id))}" type="button"
      aria-haspopup="menu" aria-expanded="false"
      title="More actions" aria-label="More actions for ${safeName}"
      style="padding:5px 8px;">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
        <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
      </svg>
    </button>`;

    const appNum = m.application_number
      ? `<div style="font-size:10px;color:var(--brand-text);background:var(--brand-fade);padding:1px 5px;border-radius:3px;margin-top:1px;display:inline-block;">#${escHtml(m.application_number)}</div>`
      : '';

    const isChecked = _selected.has(String(m.id));
    return `<tr class="member-row${isChecked ? ' row-selected' : ''}" data-id="${escHtml(String(m.id))}" tabindex="0" style="cursor:pointer;" title="Click to view details" aria-label="View details for ${safeName}">
      ${canDelete ? `<td class="col-sel" style="width:36px;" onclick="event.stopPropagation()"><input type="checkbox" class="sel-chk row-sel" data-sel="${escHtml(String(m.id))}" ${isChecked ? 'checked' : ''}></td>` : ''}
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          ${m.photo_url
            ? `<div class="member-avatar" data-photo="${escHtml(m.photo_url)}" style="overflow:hidden;padding:0;cursor:zoom-in;" title="Click to view photo"><img src="${escHtml(m.photo_url)}" alt="" style="width:100%;height:100%;object-fit:cover;"></div>`
            : `<div class="member-avatar" aria-hidden="true">${av2(displayName)}</div>`}
          <div style="min-width:0;">
            <div style="font-weight:500;color:var(--text-primary);font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;">${safeName}</div>
            <div style="font-size:11px;color:var(--text-tertiary);">${escHtml(m.phone||'\u2014')}</div>
            ${appNum}
          </div>
        </div>
      </td>
      <td class="hide-mobile"><span class="badge ${mType==='Trial'?'badge-amber':mType==='Paid'?'badge-blue':'badge-red'}">${escHtml(mType)}</span></td>
      <td class="hide-mobile">
        ${m.plan_name||m.plan
          ? `<span style="font-size:13px;font-weight:500;color:var(--text-primary);">${escHtml(m.plan_name||m.plan)}</span>`
          : `<span style="color:var(--text-quaternary);font-size:12px;">\u2014</span>`}
      </td>
      <td class="hide-mobile" style="font-size:12px;color:var(--text-tertiary);">${fmtDate(m.join_date)}</td>
      <td style="font-size:12px;color:${expColor};font-weight:${st==='Expired'||st==='Expiring'?'600':'400'};">
        ${exp ? fmtDate(exp) : '\u2014'}
      </td>
      <td class="hide-mobile">
        <span class="badge ${(m.payment_mode||m.payMode)==='Cash'?'badge-amber':(m.payment_mode||m.payMode)==='Card'?'badge-purple':'badge-blue'}">
          ${escHtml((m.payment_mode||m.payMode||'\u2014').replace('Online Payment','Online'))}
        </span>
      </td>
      <td><span class="badge ${stBadge}">${escHtml(st)}</span></td>
      <td class="col-actions">
        <div class="action-btns" style="gap:3px;flex-wrap:nowrap;justify-content:flex-end;">
          ${renewBtn}${waBtn}${editBtn}${moreBtn}
        </div>
      </td>
    </tr>`;
  }).join('');

  if (pagEl) {
    if (totalPages <= 1) {
      pagEl.innerHTML = `<span>Showing all ${totalItems} member${totalItems!==1?'s':''}</span><span></span>`;
    } else {
      pagEl.innerHTML = `
        <span>Showing ${start+1}\u2013${Math.min(start+PAGE_SIZE, totalItems)} of ${totalItems}</span>
        <div style="display:flex;gap:6px;align-items:center;">
          <button class="btn btn-ghost btn-sm" id="pg-prev" type="button" ${_memberPage<=1?'disabled aria-disabled="true"':''} style="padding:4px 10px;font-size:12px;" aria-label="Previous page">\u2190 Prev</button>
          <span style="font-size:12px;font-weight:500;color:var(--text-secondary);" aria-live="polite">Page ${_memberPage} of ${totalPages}</span>
          <button class="btn btn-ghost btn-sm" id="pg-next" type="button" ${_memberPage>=totalPages?'disabled aria-disabled="true"':''} style="padding:4px 10px;font-size:12px;" aria-label="Next page">Next \u2192</button>
        </div>`;
      document.getElementById('pg-prev')?.addEventListener('click', () => { setMemberPage(_memberPage - 1); filterTable(); });
      document.getElementById('pg-next')?.addEventListener('click', () => { setMemberPage(_memberPage + 1); filterTable(); });
    }
  }

  _syncSelectionUI();
}

// ── Row overflow menu (⋯) ───────────────────────────────
// The table's horizontal scroller (.members-table-scroll) has
// overflow-x:auto, which would clip an absolutely-positioned dropdown
// the same way .topbar's overflow:hidden clips anything not attached to
// <body> (see CLAUDE.md). This menu is appended to <body> and positioned
// with getBoundingClientRect() instead of living inside the table.
let _overflowMenuEl = null;
let _overflowCloseHandlers = null;
function closeOverflowMenu() {
  if (_overflowMenuEl) { _overflowMenuEl.remove(); _overflowMenuEl = null; }
  if (_overflowCloseHandlers) {
    document.removeEventListener('click', _overflowCloseHandlers.click, true);
    document.removeEventListener('keydown', _overflowCloseHandlers.key, true);
    window.removeEventListener('scroll', _overflowCloseHandlers.scroll, true);
    window.removeEventListener('resize', _overflowCloseHandlers.scroll, true);
    _overflowCloseHandlers = null;
  }
  document.querySelectorAll('[data-overflow][aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}

function toggleOverflowMenu(btn) {
  if (_overflowMenuEl) { const wasForThisBtn = _overflowMenuEl.dataset.for === btn.dataset.overflow; closeOverflowMenu(); if (wasForThisBtn) return; }

  const id = btn.dataset.overflow;
  const m = S.members.find(x => String(x.id) === id);
  if (!m) return;
  const role = S.role || 'owner';
  const canCancel = hasAccess(role, 'cancel_member');
  const canDelete = hasAccess(role, 'delete_member');
  const safeName = escHtml(m.full_name || m.name || '');

  const items = [];
  items.push({ action:'inv', label:'Invoice', danger:false });
  if ((parseFloat(m.balance_due)||0) > 0) {
    items.push({ action:'bal', label:`Clear balance (₹${Number(m.balance_due).toLocaleString('en-IN')} due)`, danger:false });
  }
  if (canCancel) {
    items.push(m.cancelled_at
      ? { action:'cancelmem', label:'Reactivate membership', danger:false }
      : { action:'cancelmem', label:'Cancel membership', danger:false });
  }
  if (canDelete) items.push({ action:'del', label:'Remove member', danger:true });
  if (!items.length) return;

  const menu = document.createElement('div');
  menu.className = 'row-overflow-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', `More actions for ${safeName}`);
  menu.dataset.for = id;
  menu.innerHTML = items.map(it => `<button type="button" role="menuitem" class="row-overflow-item${it.danger ? ' danger' : ''}" data-action="${it.action}">${it.label}</button>`).join('');
  document.body.appendChild(menu);

  const r = btn.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  let top = r.bottom + 4;
  let left = r.right - menuRect.width;
  if (left < 8) left = 8;
  if (top + menuRect.height > window.innerHeight - 8) top = r.top - menuRect.height - 4;
  menu.style.top = `${Math.max(8, top)}px`;
  menu.style.left = `${left}px`;

  btn.setAttribute('aria-expanded', 'true');
  _overflowMenuEl = menu;

  menu.querySelectorAll('.row-overflow-item').forEach(item => {
    item.addEventListener('click', () => {
      const action = item.dataset.action;
      closeOverflowMenu();
      if (action === 'inv') _openInvoiceModal && _openInvoiceModal(id);
      else if (action === 'bal') _openClearBalanceModal && _openClearBalanceModal(id);
      else if (action === 'cancelmem') _confirmCancelMembership && _confirmCancelMembership(id);
      else if (action === 'del') _confirmDelete && _confirmDelete(id);
    });
  });

  const clickHandler = (e) => { if (!menu.contains(e.target) && e.target !== btn) closeOverflowMenu(); };
  const keyHandler = (e) => { if (e.key === 'Escape') { closeOverflowMenu(); btn.focus(); } };
  const scrollHandler = () => closeOverflowMenu();
  setTimeout(() => {
    document.addEventListener('click', clickHandler, true);
    document.addEventListener('keydown', keyHandler, true);
    window.addEventListener('scroll', scrollHandler, true);
    window.addEventListener('resize', scrollHandler, true);
  }, 0);
  _overflowCloseHandlers = { click: clickHandler, key: keyHandler, scroll: scrollHandler };
  menu.querySelector('.row-overflow-item')?.focus();
}

function _syncSelectionUI() {
  const bar = document.getElementById('multi-del-bar');
  const countEl = document.getElementById('multi-del-count');
  const delBtn = document.getElementById('btn-multi-del');
  if (bar) bar.style.display = _selectMode ? 'flex' : 'none';
  if (countEl) countEl.textContent = _selected.size > 0 ? `${_selected.size} selected` : 'Select members';
  if (delBtn) delBtn.disabled = _selected.size === 0;
  // Sync header checkbox
  const pageCheckboxes = document.querySelectorAll('.row-sel');
  const selAll = document.getElementById('sel-all');
  if (selAll && pageCheckboxes.length > 0) {
    const allChecked = [...pageCheckboxes].every(c => c.checked);
    selAll.checked = allChecked && pageCheckboxes.length > 0;
  }
}

function filterTable() {
  const q  = (document.getElementById('msearch')?.value||'').toLowerCase().trim();
  const sf = document.getElementById('sf-status')?.value||'';
  const pf = document.getElementById('sf-plan')?.value||'';
  const jd = document.getElementById('sf-joindate')?.value||'';
  const ab = document.getElementById('sf-addedby')?.value||'';

  fillTable(S.members.filter(m => {
    const st    = memberStatus(m);
    const mType = m.member_type||m.memberType||'Paid';
    const name  = (m.full_name||m.name||'').toLowerCase();
    const appNo = (m.application_number||'').toLowerCase();
    const matchQ  = !q || name.includes(q) || (m.phone||'').includes(q) || (m.email||'').toLowerCase().includes(q) || appNo.includes(q);

    let matchSt;
    if (!sf) {
      matchSt = true;
    } else if (sf === 'Due') {
      matchSt = !m.cancelled_at && (m.payment_status === 'Due' || m.payment_status === 'Partial');
    } else if (sf === 'Trial') {
      matchSt = mType === 'Trial';
    } else {
      matchSt = st === sf;
    }

    let matchPf = true;
    if (pf) {
      if (m.plan_id) {
        matchPf = String(m.plan_id) === pf;
      } else {
        const planObj = S.plans.find(p => String(p.id) === pf);
        matchPf = planObj ? (m.plan_name||m.plan) === planObj.name : false;
      }
    }
    const matchJd = !jd || m.join_date === jd;
    const matchAb = !ab || m.added_by_name === ab;
    return matchQ && matchSt && matchPf && matchJd && matchAb;
  }));
}

export { renderMembers, fillTable, filterTable };