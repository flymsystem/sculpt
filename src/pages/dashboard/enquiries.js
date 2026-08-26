// src/pages/dashboard/enquiries.js
// ─────────────────────────────────────────────────────────────────
// Walk-in enquiry tracking — list, add, edit, call, WhatsApp follow-up
//
// 2026-08 changes:
//   * 'Google Maps' source (see lib/enquiries.js ENQUIRY_SOURCES)
//   * One-tap Call button on every enquiry row
// ─────────────────────────────────────────────────────────────────
import { S } from './state.js';
import { escHtml, av2, showSectionLoading, renderError } from './helpers.js';
import { getEnquiries, addEnquiry, updateEnquiry, deleteEnquiry, ENQUIRY_SOURCES, ENQUIRY_STATUSES } from '../../lib/enquiries.js';
import { showToast } from '../../components/toast.js';
import { openModal, closeModal, modalFooter, bindModalCancel } from '../../components/modal.js';
import { callBtn, normalizePhone, formatPhone } from '../../components/call-button.js';
import { openAddModal } from './member-modals.js';

const DEFAULT_FOLLOWUP_TEMPLATE =
  'Hi {name}! 👋\n\nThanks for visiting *{gym}*! We\'d love to have you as a member.\n\nWe have some great plans that might interest you. Would you like to know more?\n\nFeel free to reach out anytime! 💪';

function statusBadge(status) {
  const map = { New:'badge-blue', Contacted:'badge-amber', Converted:'badge-green', Lost:'badge-muted' };
  return `<span class="badge ${map[status]||'badge-muted'}">${escHtml(status)}</span>`;
}

function sourceBadge(source) {
  const icons = {
    'Walk-in':'🚶', 'Google Maps':'📍', Google:'🔍', Instagram:'📸',
    Referral:'🤝', Facebook:'📱', WhatsApp:'💬', Other:'📋',
  };
  // white-space:nowrap — a two-word source like "Google Maps" used to
  // wrap one word per line inside the flexible name row on narrow
  // screens (AUDIT.md C5). It's a label, it should stay one unit.
  return `<span class="enq-source-badge">${icons[source]||'📋'} ${escHtml(source||'Walk-in')}</span>`;
}

let _enqStylesInjected = false;
function _injectEnquiryStyles() {
  if (_enqStylesInjected) return;
  _enqStylesInjected = true;
  const s = document.createElement('style');
  s.id = 'sculpt-enquiry-styles';
  s.textContent = `
    .enq-source-badge{font-size:12px;color:var(--text-secondary);white-space:nowrap;}
    /* Card is a vertical stack from the start — the old layout put the
       avatar, name/badges, contact line, and every action button in one
       horizontal flex row with no wrap boundary, so on a 320-375px phone
       the action buttons overlapped the phone number and the source
       badge/timestamp wrapped mid-value (AUDIT.md C5). Each piece now
       gets its own row and the action row is the only one allowed to
       wrap, onto full lines of its own. */
    .enq-card{display:flex;flex-direction:column;gap:10px;padding:14px 16px;}
    .enq-card-head{display:flex;align-items:flex-start;gap:12px;min-width:0;}
    .enq-card-head .member-avatar{flex-shrink:0;}
    .enq-card-body{flex:1;min-width:0;}
    .enq-name-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
    .enq-name-row .enq-name{font-weight:600;font-size:14px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;}
    .enq-meta{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:5px;}
    .enq-meta-item{font-size:12px;color:var(--text-tertiary);white-space:nowrap;display:inline-flex;align-items:center;gap:4px;}
    .enq-notes{font-size:12px;color:var(--text-secondary);margin-top:4px;font-style:italic;overflow-wrap:break-word;}
    .enq-actions{display:flex;flex-wrap:wrap;gap:6px;border-top:1px solid var(--border-subtle);padding-top:10px;}
    .enq-actions .btn{white-space:nowrap;}
    @media (max-width:480px){
      /* Below 480px every action button also carries a visible text
         label, not just an icon + tooltip — tooltips don't exist on
         touch, and this row now has the vertical room for it. */
      .enq-actions{gap:8px;}
      .enq-actions .btn{flex:1 1 auto;justify-content:center;padding:7px 10px !important;}
    }
  `;
  document.head.appendChild(s);
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
  if (diff < 172800000) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day:'numeric', month:'short' });
}

async function renderEnquiries(c) {
  _injectEnquiryStyles();
  showSectionLoading(c, 'Enquiries');
  const gymId = S.gym?.id;
  if (!gymId) return;

  // A failed fetch used to fall back to S.enquiries || [] and render
  // silently — on first load that's an empty list with no indication
  // anything went wrong, indistinguishable from a gym with genuinely no
  // enquiries. Now it says so, with a retry.
  try {
    S.enquiries = await getEnquiries(gymId);
  } catch (err) {
    console.warn('[Sculpt] Enquiry fetch:', err);
    renderError(c, { onRetry: () => renderEnquiries(c) });
    return;
  }

  render();

  function render(filterStatus) {
    filterStatus = filterStatus || '';
    const list = filterStatus
      ? S.enquiries.filter(e => e.status === filterStatus)
      : S.enquiries;

    const newCount       = S.enquiries.filter(e => e.status === 'New').length;
    const contactedCount = S.enquiries.filter(e => e.status === 'Contacted').length;
    const convertedCount = S.enquiries.filter(e => e.status === 'Converted').length;
    const lostCount      = S.enquiries.filter(e => e.status === 'Lost').length;
    const total          = S.enquiries.length;

    // Mini funnel stats
    const conversionRate = total > 0 ? Math.round((convertedCount / total) * 100) : 0;

    c.innerHTML = `<div class="content-inner page-enter">

      <div class="page-header">
        <div class="page-header-left">
          <div class="page-title">Enquiries</div>
          <div class="page-sub">${total} enquir${total !== 1 ? 'ies' : 'y'} · ${newCount} new</div>
        </div>
        <button class="btn btn-primary" id="btn-add-enq">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
          Add Enquiry
        </button>
      </div>

      <!-- Funnel stats -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:var(--space-5);">
        <div class="card card-sm" style="padding:12px;text-align:center;cursor:pointer;${filterStatus===''?'border:1px solid var(--brand);':'border:1px solid var(--border-subtle);'}" data-enq-filter="">
          <div style="font-size:22px;font-weight:700;color:var(--brand);">${total}</div>
          <div style="font-size:11px;color:var(--text-tertiary);">Total</div>
        </div>
        <div class="card card-sm" style="padding:12px;text-align:center;cursor:pointer;${filterStatus==='New'?'border:1px solid var(--blue-light);':'border:1px solid var(--border-subtle);'}" data-enq-filter="New">
          <div style="font-size:22px;font-weight:700;color:var(--blue-light);">${newCount}</div>
          <div style="font-size:11px;color:var(--text-tertiary);">New</div>
        </div>
        <div class="card card-sm" style="padding:12px;text-align:center;cursor:pointer;${filterStatus==='Contacted'?'border:1px solid var(--amber);':'border:1px solid var(--border-subtle);'}" data-enq-filter="Contacted">
          <div style="font-size:22px;font-weight:700;color:var(--amber);">${contactedCount}</div>
          <div style="font-size:11px;color:var(--text-tertiary);">Contacted</div>
        </div>
        <div class="card card-sm" style="padding:12px;text-align:center;cursor:pointer;${filterStatus==='Converted'?'border:1px solid var(--green);':'border:1px solid var(--border-subtle);'}" data-enq-filter="Converted">
          <div style="font-size:22px;font-weight:700;color:var(--green);">${convertedCount}</div>
          <div style="font-size:11px;color:var(--text-tertiary);">Converted</div>
        </div>
        <div class="card card-sm" style="padding:12px;text-align:center;cursor:pointer;${filterStatus==='Lost'?'border:1px solid var(--text-tertiary);':'border:1px solid var(--border-subtle);'}" data-enq-filter="Lost">
          <div style="font-size:22px;font-weight:700;color:var(--text-tertiary);">${lostCount}</div>
          <div style="font-size:11px;color:var(--text-tertiary);">Lost</div>
        </div>
      </div>

      ${conversionRate > 0 ? `<div style="font-size:12px;color:var(--text-tertiary);margin-bottom:var(--space-4);">
        Conversion rate: <strong style="color:var(--green);">${conversionRate}%</strong>
      </div>` : ''}

      <!-- Enquiry list -->
      <div id="enq-list">
        ${list.length === 0
          ? `<div style="padding:48px 20px;text-align:center;color:var(--text-tertiary);">
              ${filterStatus ? 'No enquiries with this status.' : 'No enquiries yet. Add your first walk-in enquiry!'}
            </div>`
          : list.map(e => {
            const waDisabled = !e.phone;
            const safeName = escHtml(e.name);
            return `<div class="card card-sm enq-card" data-enq-id="${e.id}">
              <div class="enq-card-head">
                <div class="member-avatar">${av2(e.name)}</div>
                <div class="enq-card-body">
                  <div class="enq-name-row">
                    <span class="enq-name" title="${safeName}">${safeName}</span>
                    ${statusBadge(e.status)}
                    ${sourceBadge(e.source)}
                  </div>
                  <div class="enq-meta">
                    ${e.phone
                      ? `<a href="tel:${escHtml(normalizePhone(e.phone))}" class="sculpt-tel enq-meta-item" onclick="event.stopPropagation();">📞 ${escHtml(formatPhone(e.phone))}</a>`
                      : '<span class="enq-meta-item" style="color:var(--text-quaternary);">No phone</span>'}
                    <span class="enq-meta-item">🕐 ${fmtTime(e.created_at)}</span>
                    ${e.followed_up_at ? `<span class="enq-meta-item" style="color:var(--green);">✓ Followed up ${fmtTime(e.followed_up_at)}</span>` : ''}
                  </div>
                  ${e.notes ? `<div class="enq-notes">${escHtml(e.notes)}</div>` : ''}
                </div>
              </div>
              <div class="enq-actions">
                ${callBtn(e.phone, { label: true })}
                ${e.status !== 'Converted' ? `<button class="btn btn-sm" data-enq-convert="${e.id}" title="Convert to member" aria-label="Convert ${safeName} to member" style="background:var(--brand-fade);color:var(--brand-text);border:1px solid var(--brand-fade-strong);padding:5px 8px;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="margin-right:4px;vertical-align:-2px;"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg><span>Convert</span>
                </button>` : ''}
                <button class="btn btn-sm" data-enq-wa="${e.id}" title="Follow up on WhatsApp" aria-label="Follow up with ${safeName} on WhatsApp" ${waDisabled?'disabled':''} style="background:var(--green-fade);color:var(--green);border:1px solid var(--green-strong);padding:5px 8px;${waDisabled?'opacity:0.4;cursor:not-allowed;':''}">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="margin-right:4px;vertical-align:-2px;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg><span>WhatsApp</span>
                </button>
                <button class="btn btn-sm btn-ghost" data-enq-edit="${e.id}" title="Edit" aria-label="Edit ${safeName}" style="padding:5px 8px;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="margin-right:4px;vertical-align:-2px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><span>Edit</span>
                </button>
                <button class="btn btn-sm" data-enq-del="${e.id}" title="Remove" aria-label="Remove ${safeName}" style="background:var(--red-fade);color:var(--red);border:1px solid var(--red-strong);padding:5px 8px;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="margin-right:4px;vertical-align:-2px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg><span>Remove</span>
                </button>
              </div>
            </div>`;
          }).join('')}
      </div>

    </div>`;

    // ── Bind events ───────────────────────────────────
    document.getElementById('btn-add-enq')?.addEventListener('click', openAddEnquiryModal);

    // Filter pills
    document.querySelectorAll('[data-enq-filter]').forEach(el => {
      el.addEventListener('click', () => render(el.dataset.enqFilter));
    });

    // List actions (delegated).
    // NOTE: [data-call] buttons are handled by the global handler in
    // components/call-button.js — deliberately not intercepted here.
    const listEl = document.getElementById('enq-list');
    if (listEl) {
      listEl.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-call]')) return;
        const waBtn      = ev.target.closest('[data-enq-wa]');
        const editBtn    = ev.target.closest('[data-enq-edit]');
        const delBtn     = ev.target.closest('[data-enq-del]');
        const convertBtn = ev.target.closest('[data-enq-convert]');
        if (waBtn)      { ev.stopPropagation(); openFollowUpWA(waBtn.dataset.enqWa);   return; }
        if (editBtn)    { ev.stopPropagation(); openEditEnquiryModal(editBtn.dataset.enqEdit); return; }
        if (delBtn)     { ev.stopPropagation(); confirmDeleteEnquiry(delBtn.dataset.enqDel); return; }
        if (convertBtn) { ev.stopPropagation(); convertToMember(convertBtn.dataset.enqConvert); return; }
      });
    }
  }

  // ── Add enquiry modal ─────────────────────────────
  function openAddEnquiryModal() {
    const sourceOpts = ENQUIRY_SOURCES.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
    openModal({
      title: 'Add Enquiry',
      size: 'sm',
      mobileCompact: true,
      body: `
        <div class="form-group">
          <label class="form-label">Name *</label>
          <input class="form-input" id="enq-name" placeholder="e.g. Rahul">
        </div>
        <div class="form-group">
          <label class="form-label">Phone <span style="color:var(--muted);font-weight:400;font-size:11px;">(for calls &amp; WhatsApp follow-up)</span></label>
          <div style="display:flex;align-items:center;gap:0;">
            <span style="background:var(--panel2);border:1px solid var(--border);border-right:none;
              padding:0 12px;height:42px;display:flex;align-items:center;font-size:13px;
              color:var(--muted);border-radius:var(--radius-sm) 0 0 var(--radius-sm);
              white-space:nowrap;flex-shrink:0;">+91</span>
            <input class="form-input" id="enq-phone" placeholder="9876543210" maxlength="10"
              inputmode="numeric"
              oninput="this.value=this.value.replace(/\\D/g,'').slice(0,10);"
              style="border-radius:0 var(--radius-sm) var(--radius-sm) 0;border-left:none;">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Source</label>
          <select class="form-input" id="enq-source" style="color:var(--white);">${sourceOpts}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <input class="form-input" id="enq-notes" placeholder="Interested in 3-month plan, asked about PT…">
        </div>
        <div id="enq-error" style="display:none;color:var(--red);font-size:13px;
             background:rgba(255,77,77,0.08);border:1px solid rgba(255,77,77,0.3);
             padding:10px 13px;border-radius:2px;margin-top:4px;"></div>
      `,
      footer: modalFooter('Cancel', 'Add Enquiry →', 'btn-enq-submit'),
      onOpen: () => {
        bindModalCancel();
        document.getElementById('btn-enq-submit')?.addEventListener('click', async () => {
          const btn = document.getElementById('btn-enq-submit');
          const errEl = document.getElementById('enq-error');
          const name = document.getElementById('enq-name')?.value.trim();
          const phone = document.getElementById('enq-phone')?.value.trim();
          const source = document.getElementById('enq-source')?.value;
          const notes = document.getElementById('enq-notes')?.value.trim();

          if (!name) {
            errEl.textContent = 'Name is required'; errEl.style.display = 'block'; return;
          }

          btn.disabled = true; btn.textContent = 'Adding…';
          try {
            const saved = await addEnquiry(gymId, {
              name,
              phone: phone ? '+91' + phone : null,
              source, notes
            });
            S.enquiries = [saved, ...(S.enquiries || [])];
            closeModal();
            render();
            showToast(`${name} added to enquiries!`, 'green');
          } catch (err) {
            errEl.textContent = err.message; errEl.style.display = 'block';
            btn.disabled = false; btn.textContent = 'Add Enquiry →';
          }
        });
      }
    });
  }

  // ── Edit enquiry modal ────────────────────────────
  function openEditEnquiryModal(id) {
    const e = (S.enquiries || []).find(x => String(x.id) === String(id));
    if (!e) return;
    // If this row carries a legacy source no longer in the list, keep it
    // selectable so editing doesn't silently rewrite it.
    const sources = ENQUIRY_SOURCES.includes(e.source) || !e.source
      ? ENQUIRY_SOURCES
      : [...ENQUIRY_SOURCES, e.source];
    const sourceOpts = sources.map(s => `<option value="${escHtml(s)}" ${e.source===s?'selected':''}>${escHtml(s)}</option>`).join('');
    const statusOpts = ENQUIRY_STATUSES.map(s => `<option value="${s}" ${e.status===s?'selected':''}>${s}</option>`).join('');

    openModal({
      title: `Edit — ${escHtml(e.name)}`,
      size: 'sm',
      mobileCompact: true,
      body: `
        <div class="form-group">
          <label class="form-label">Name *</label>
          <input class="form-input" id="enq-e-name" value="${escHtml(e.name)}">
        </div>
        <div class="form-group">
          <label class="form-label">Phone</label>
          <div style="display:flex;align-items:center;gap:0;">
            <span style="background:var(--panel2);border:1px solid var(--border);border-right:none;
              padding:0 12px;height:42px;display:flex;align-items:center;font-size:13px;
              color:var(--muted);border-radius:var(--radius-sm) 0 0 var(--radius-sm);
              white-space:nowrap;flex-shrink:0;">+91</span>
            <input class="form-input" id="enq-e-phone" maxlength="10" inputmode="numeric"
              oninput="this.value=this.value.replace(/\\D/g,'').slice(0,10);"
              style="border-radius:0 var(--radius-sm) var(--radius-sm) 0;border-left:none;"
              value="${escHtml((e.phone||'').replace(/^\+?91/,'').trim())}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Source</label>
            <select class="form-input" id="enq-e-source" style="color:var(--white);">${sourceOpts}</select></div>
          <div class="form-group"><label class="form-label">Status</label>
            <select class="form-input" id="enq-e-status" style="color:var(--white);">${statusOpts}</select></div>
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <input class="form-input" id="enq-e-notes" value="${escHtml(e.notes||'')}">
        </div>
        <div id="enq-e-error" style="display:none;color:var(--red);font-size:13px;
             background:rgba(255,77,77,0.08);border:1px solid rgba(255,77,77,0.3);
             padding:10px 13px;border-radius:2px;margin-top:4px;"></div>
      `,
      footer: modalFooter('Cancel', 'Save Changes →', 'btn-enq-e-submit'),
      onOpen: () => {
        bindModalCancel();
        document.getElementById('btn-enq-e-submit')?.addEventListener('click', async () => {
          const btn = document.getElementById('btn-enq-e-submit');
          const errEl = document.getElementById('enq-e-error');
          const name = document.getElementById('enq-e-name')?.value.trim();
          const phone = document.getElementById('enq-e-phone')?.value.trim();
          const source = document.getElementById('enq-e-source')?.value;
          const status = document.getElementById('enq-e-status')?.value;
          const notes = document.getElementById('enq-e-notes')?.value.trim();

          if (!name) {
            errEl.textContent = 'Name is required'; errEl.style.display = 'block'; return;
          }

          btn.disabled = true; btn.textContent = 'Saving…';
          try {
            const saved = await updateEnquiry(id, gymId, {
              name, phone: phone ? '+91' + phone : null,
              source, status, notes
            });
            const idx = S.enquiries.findIndex(x => String(x.id) === String(id));
            if (idx > -1) S.enquiries[idx] = saved;
            closeModal(); render();
            showToast('Enquiry updated!', 'green');
          } catch (err) {
            errEl.textContent = err.message; errEl.style.display = 'block';
            btn.disabled = false; btn.textContent = 'Save Changes →';
          }
        });
      }
    });
  }

  // ── Convert to member (FIX-PROMPT.md item 20) ─────
  // Opens Add Member pre-filled with the enquiry's name/phone; only
  // marks the enquiry Converted once a member is actually created —
  // cancelling the Add Member modal leaves the enquiry untouched.
  function convertToMember(id) {
    const e = (S.enquiries || []).find(x => String(x.id) === String(id));
    if (!e) return;
    openAddModal({
      prefill: { name: e.name, phone: e.phone },
      onSaved: async () => {
        try {
          const saved = await updateEnquiry(id, gymId, { status: 'Converted' });
          const idx = S.enquiries.findIndex(x => String(x.id) === String(id));
          if (idx > -1) S.enquiries[idx] = saved;
        } catch (err) {
          console.warn('[Sculpt] Could not mark enquiry converted:', err.message);
        }
      },
    });
  }

  // ── WhatsApp follow-up ─────────────────────────────
  function openFollowUpWA(id) {
    const e = (S.enquiries || []).find(x => String(x.id) === String(id));
    if (!e || !e.phone) return;
    const gymName = S.gym?.name || 'our gym';

    // Use gym's custom template or default
    const rawTpl = S.gym?.wa_template_enquiry || DEFAULT_FOLLOWUP_TEMPLATE;

    openModal({
      title: 'Follow Up — WhatsApp',
      size: 'sm',
      mobileCompact: true,
      body: `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
          <div class="member-avatar">${av2(e.name)}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:14px;color:var(--text-primary);">${escHtml(e.name)}</div>
            <div style="font-size:12px;color:var(--text-tertiary);">${escHtml(formatPhone(e.phone))}</div>
          </div>
          ${callBtn(e.phone, { label: true })}
        </div>
        <div class="form-group">
          <label class="form-label">Message</label>
          <textarea class="form-input" id="enq-wa-msg" rows="6" style="resize:vertical;font-size:13px;line-height:1.5;">${escHtml(rawTpl.replace(/\{name\}/g, e.name).replace(/\{gym\}/g, gymName))}</textarea>
        </div>
        <div style="font-size:11px;color:var(--text-quaternary);margin-top:4px;">
          Edit the message above, then tap Send to open WhatsApp.
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="modal-cancel" style="flex:1;">Cancel</button>
        <button class="btn" id="btn-enq-wa-send" style="flex:1;background:var(--green);color:#fff;border:none;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="margin-right:6px;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          Send on WhatsApp
        </button>
      `,
      onOpen: () => {
        bindModalCancel();
        document.getElementById('btn-enq-wa-send')?.addEventListener('click', async () => {
          const msg = document.getElementById('enq-wa-msg')?.value || '';
          const phone = e.phone.replace(/\D/g, '');
          const fullPhone = phone.startsWith('91') ? phone : '91' + phone;
          const url = `https://wa.me/${fullPhone}?text=${encodeURIComponent(msg)}`;
          window.open(url, '_blank');

          // Mark as followed up + update status to Contacted if still New
          try {
            const updates = { followed_up_at: new Date().toISOString() };
            if (e.status === 'New') updates.status = 'Contacted';
            const saved = await updateEnquiry(id, gymId, updates);
            const idx = S.enquiries.findIndex(x => String(x.id) === String(id));
            if (idx > -1) S.enquiries[idx] = saved;
          } catch (_) { /* silent — fire and forget */ }

          closeModal();
          render();
          showToast('Opening WhatsApp…', 'green');
        });
      }
    });
  }

  // ── Delete enquiry ─────────────────────────────────
  function confirmDeleteEnquiry(id) {
    const e = (S.enquiries || []).find(x => String(x.id) === String(id));
    if (!e) return;
    openModal({
      title: 'Remove Enquiry',
      size: 'sm',
      body: `
        <div style="text-align:center;padding:8px 0 4px;">
          <div style="font-size:36px;margin-bottom:14px;">🗑️</div>
          <div style="font-size:15px;font-weight:600;color:var(--white);margin-bottom:8px;">Remove ${escHtml(e.name)}?</div>
          <div style="font-size:13px;color:var(--muted);line-height:1.6;">
            This enquiry will be removed from your list.
          </div>
        </div>`,
      footer: `
        <button class="btn btn-ghost" id="modal-cancel" style="flex:1;">Cancel</button>
        <button class="btn btn-danger-soft" id="btn-enq-del-confirm" style="flex:1;">Remove</button>`,
      onOpen: () => {
        bindModalCancel();
        document.getElementById('btn-enq-del-confirm')?.addEventListener('click', async () => {
          const btn = document.getElementById('btn-enq-del-confirm');
          btn.disabled = true; btn.textContent = 'Removing…';
          try {
            await deleteEnquiry(id, gymId);
            S.enquiries = S.enquiries.filter(x => String(x.id) !== String(id));
            closeModal(); render();
            showToast('Enquiry removed', 'green');
          } catch (err) {
            closeModal();
            showToast(err.message || 'Remove failed', 'red');
          }
        });
      }
    });
  }
}


export { renderEnquiries };
