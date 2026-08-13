// src/pages/dashboard/broadcast.js
// ─────────────────────────────────────────────────────────────────
// Bulk WhatsApp Broadcast — compose, select members, pay, send
// ─────────────────────────────────────────────────────────────────
import { S } from './state.js';
import { escHtml, av2, memberStatus, showSectionLoading } from './helpers.js';
import { showToast } from '../../components/toast.js';
import {
  calculateBroadcastCost,
  createBroadcastOrder,
  openRazorpayCheckout,
  processBroadcast,
  getBroadcasts,
  getBroadcastRecipients,
  getBroadcastStatus,
} from '../../lib/broadcast.js';

let _broadcastStep = 'compose'; // compose | select | review | sending | history
let _broadcastMsg = '';
let _selectedIds = new Set();
let _filterStatus = '';
let _filterPlan = '';
let _searchQuery = '';
let _activeBroadcastId = null;
let _pollTimer = null;
let _historyData = [];

function cleanup() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  _selectedIds = new Set();
  _broadcastStep = 'compose';
  _activeBroadcastId = null;
}

// ── Main render ─────────────────────────────────────────────────

async function renderBroadcast(c) {
  cleanup();
  _broadcastStep = 'compose';
  _broadcastMsg = '';
  _filterStatus = '';
  _filterPlan = '';
  _searchQuery = '';

  render(c);
}

function render(c) {
  if (!c) c = document.getElementById('gym-content');
  if (!c) return;

  const step = _broadcastStep;

  if (step === 'history') {
    renderHistory(c);
    return;
  }

  if (step === 'sending') {
    renderSending(c);
    return;
  }

  // Steps: compose → select → review
  const stepLabels = [
    { id: 'compose', label: 'Compose', num: '1' },
    { id: 'select', label: 'Select Members', num: '2' },
    { id: 'review', label: 'Review & Pay', num: '3' },
  ];

  const stepIdx = stepLabels.findIndex(s => s.id === step);

  c.innerHTML = `<div class="content-inner page-enter">
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-title">WhatsApp Broadcast</div>
        <div class="page-sub">Send announcements to all your members at once</div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost" id="bc-history-btn" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          History
        </button>
      </div>
    </div>

    <!-- Step indicator -->
    <div style="display:flex;align-items:center;gap:0;margin-bottom:24px;" id="bc-steps">
      ${stepLabels.map((s, i) => {
        const done = i < stepIdx;
        const active = i === stepIdx;
        const circleStyle = done
          ? 'background:var(--green);color:#fff;'
          : active
            ? 'background:var(--brand);color:#fff;'
            : 'background:var(--surface-2);color:var(--text-tertiary);border:1px solid var(--border);';
        const labelColor = active ? 'var(--text-primary)' : 'var(--text-tertiary)';
        const line = i < stepLabels.length - 1
          ? `<div style="flex:1;height:2px;background:${done ? 'var(--green)' : 'var(--border)'};margin:0 8px;"></div>`
          : '';
        return `<div style="display:flex;align-items:center;gap:6px;${i > 0 ? 'flex:1;' : ''}">
          <div style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0;${circleStyle}">
            ${done ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : s.num}
          </div>
          <span style="font-size:13px;font-weight:${active ? '600' : '400'};color:${labelColor};white-space:nowrap;">${s.label}</span>
          ${line}
        </div>`;
      }).join('')}
    </div>

    <div id="bc-body"></div>
  </div>`;

  document.getElementById('bc-history-btn')?.addEventListener('click', () => {
    _broadcastStep = 'history';
    render(c);
  });

  const body = document.getElementById('bc-body');
  if (step === 'compose') renderCompose(body, c);
  else if (step === 'select') renderSelect(body, c);
  else if (step === 'review') renderReview(body, c);
}

// ── Step 1: Compose ─────────────────────────────────────────────

function renderCompose(el, root) {
  const gymName = S.gym?.name || 'Your Gym';
  const sampleName = S.members[0]?.full_name || S.members[0]?.name || 'Rahul';
  const templates = [
    { label: 'General Announcement', text: `Hi {name}! \uD83D\uDCE2\n\n[Your announcement here]\n\nThank you!\n${gymName}` },
    { label: 'Holiday Closure', text: `Hi {name}!\n\nThis is to inform you that *${gymName}* will be closed on [date] for [reason].\n\nWe will reopen on [date] at our regular hours.\n\nThank you for your understanding! \uD83D\uDE4F` },
    { label: 'New Batch / Class', text: `Hi {name}! \uD83C\uDFCB\uFE0F\n\nWe are excited to announce a new [batch/class] at *${gymName}*!\n\n\uD83D\uDCC5 Starting: [date]\n\u23F0 Time: [time]\n\uD83D\uDCCD Location: [location]\n\nLimited spots available. Contact us to register!\n\nSee you there! \uD83D\uDCAA` },
    { label: 'Offer / Discount', text: `Hi {name}! \uD83C\uDF89\n\nGreat news from *${gymName}*!\n\n\uD83C\uDF1F [Offer details here]\n\n\u23F3 Valid until: [date]\n\nDon\u2019t miss out! Visit us or reply to this message.\n\nSee you at the gym! \uD83D\uDCAA` },
  ];

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
      <!-- Left: compose -->
      <div class="card" style="padding:20px;">
        <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">Compose Message</div>
        <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:16px;">
          Use <code style="background:var(--brand-fade);color:var(--brand-text);padding:1px 5px;border-radius:3px;font-size:11px;">{name}</code> to personalize with each member\u2019s name
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;">
          ${templates.map((t, i) => `<button class="btn btn-ghost btn-sm bc-tpl-btn" data-idx="${i}" type="button" style="font-size:11px;">${escHtml(t.label)}</button>`).join('')}
        </div>

        <textarea class="form-input" id="bc-message" rows="10"
          style="resize:vertical;font-size:13px;line-height:1.6;font-family:var(--font-sans);"
          placeholder="Type your message here...">${escHtml(_broadcastMsg)}</textarea>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
          <span id="bc-charcount" style="font-size:11px;color:var(--text-quaternary);">0 / 4096</span>
          <button class="btn btn-primary" id="bc-next-1" type="button">Next: Select Members \u2192</button>
        </div>
      </div>

      <!-- Right: preview -->
      <div class="card" style="padding:20px;">
        <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:12px;">Preview</div>
        <div style="background:var(--surface-2);border-radius:12px;padding:16px;min-height:200px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border);">
            <div style="width:32px;height:32px;border-radius:50%;background:rgba(0,230,118,0.15);display:flex;align-items:center;justify-content:center;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
            </div>
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--text-primary);">WhatsApp Preview</div>
              <div style="font-size:11px;color:var(--text-tertiary);">How ${escHtml(sampleName)} will see it</div>
            </div>
          </div>
          <div id="bc-preview" style="font-size:13px;color:var(--text-secondary);line-height:1.7;white-space:pre-wrap;word-break:break-word;"></div>
        </div>
      </div>
    </div>
  `;

  // Mobile: stack vertically
  const grid = el.querySelector('div[style*="grid-template-columns"]');
  if (grid && window.innerWidth < 768) {
    grid.style.gridTemplateColumns = '1fr';
  }

  const textarea = document.getElementById('bc-message');
  const preview = document.getElementById('bc-preview');
  const charcount = document.getElementById('bc-charcount');

  function updatePreview() {
    const raw = textarea.value;
    const personalized = raw.replace(/\{name\}/g, sampleName).replace(/\{gym\}/g, gymName);
    preview.textContent = personalized || 'Your message will appear here...';
    const len = raw.length;
    charcount.textContent = `${len.toLocaleString()} / 4,096`;
    charcount.style.color = len > 4096 ? 'var(--red)' : 'var(--text-quaternary)';
  }

  textarea.addEventListener('input', updatePreview);
  updatePreview();

  // Template buttons
  el.querySelectorAll('.bc-tpl-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      textarea.value = templates[parseInt(btn.dataset.idx)].text;
      updatePreview();
    });
  });

  // Next
  document.getElementById('bc-next-1').addEventListener('click', () => {
    const msg = textarea.value.trim();
    if (!msg) { showToast('Please enter a message', 'red'); return; }
    if (msg.length > 4096) { showToast('Message exceeds 4096 characters', 'red'); return; }
    _broadcastMsg = msg;
    _broadcastStep = 'select';
    render(root);
  });
}

// ── Step 2: Select Members ──────────────────────────────────────

function renderSelect(el, root) {
  const allMembers = (S.members || []).filter(m => {
    if (!m.is_active && m.is_active !== undefined && m.is_active !== null) return false;
    if (m.cancelled_at) return false;
    return true;
  });

  function getFiltered() {
    let list = allMembers;
    if (_filterStatus) {
      list = list.filter(m => memberStatus(m) === _filterStatus);
    }
    if (_filterPlan) {
      list = list.filter(m => (m.plan_name || m.plan || '') === _filterPlan);
    }
    if (_searchQuery) {
      const q = _searchQuery.toLowerCase();
      list = list.filter(m => {
        const name = (m.full_name || m.name || '').toLowerCase();
        const phone = (m.phone || '').toLowerCase();
        return name.includes(q) || phone.includes(q);
      });
    }
    return list;
  }

  function renderList() {
    const filtered = getFiltered();
    const withPhone = filtered.filter(m => m.phone && m.phone.replace(/\D/g, '').length >= 10);
    const noPhone = filtered.length - withPhone.length;
    const allSelected = withPhone.length > 0 && withPhone.every(m => _selectedIds.has(m.id));

    const plans = [...new Set(allMembers.map(m => m.plan_name || m.plan).filter(Boolean))].sort();
    const statuses = ['Active', 'Expiring', 'Expired', 'Due', 'Trial'];

    el.innerHTML = `
      <div class="card" style="padding:20px;">
        <!-- Top bar -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
          <div>
            <div style="font-size:14px;font-weight:600;color:var(--text-primary);">Select Recipients</div>
            <div style="font-size:12px;color:var(--text-tertiary);margin-top:2px;">
              ${_selectedIds.size.toLocaleString()} selected
              ${noPhone > 0 ? ` \u00B7 <span style="color:var(--amber);">${noPhone} without phone (auto-skipped)</span>` : ''}
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <button class="btn btn-ghost btn-sm" id="bc-back-1" type="button">\u2190 Back</button>
            <button class="btn btn-primary btn-sm" id="bc-next-2" type="button">
              Next: Review \u2192
            </button>
          </div>
        </div>

        <!-- Filters -->
        <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center;">
          <div style="position:relative;flex:1;min-width:180px;max-width:300px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input class="form-input" id="bc-search" type="text" placeholder="Search by name or phone"
              value="${escHtml(_searchQuery)}"
              style="padding-left:32px;font-size:12px;height:34px;">
          </div>
          <select class="form-input" id="bc-filter-status" style="width:auto;font-size:12px;height:34px;min-width:100px;">
            <option value="">All Statuses</option>
            ${statuses.map(s => `<option value="${s}" ${_filterStatus === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
          <select class="form-input" id="bc-filter-plan" style="width:auto;font-size:12px;height:34px;min-width:120px;">
            <option value="">All Plans</option>
            ${plans.map(p => `<option value="${escHtml(p)}" ${_filterPlan === p ? 'selected' : ''}>${escHtml(p)}</option>`).join('')}
          </select>
          <button class="btn btn-ghost btn-sm" id="bc-select-all" type="button" style="font-size:11px;">
            ${allSelected ? 'Deselect All' : 'Select All'}
          </button>
        </div>

        <!-- Member list -->
        <div style="max-height:400px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-md);">
          <table class="data-table">
            <thead>
              <tr style="position:sticky;top:0;z-index:1;">
                <th style="width:40px;text-align:center;">
                  <input type="checkbox" id="bc-check-all" ${allSelected ? 'checked' : ''} style="cursor:pointer;">
                </th>
                <th>Member</th>
                <th class="hide-mobile">Phone</th>
                <th class="hide-mobile">Plan</th>
                <th class="text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.length === 0
                ? `<tr><td colspan="5" style="padding:40px;text-align:center;color:var(--text-tertiary);font-size:13px;">No members match your filters</td></tr>`
                : filtered.map(m => {
                    const hasPhone = m.phone && m.phone.replace(/\D/g, '').length >= 10;
                    const checked = _selectedIds.has(m.id);
                    const st = memberStatus(m);
                    const stBadge = { Active:'badge-green', Expiring:'badge-amber', Expired:'badge-red', Due:'badge-red', Partial:'badge-amber', Trial:'badge-amber' }[st] || 'badge-muted';
                    const displayName = m.full_name || m.name || '';
                    return `<tr style="${!hasPhone ? 'opacity:0.45;' : ''}">
                      <td class="text-center" style="padding:8px 10px;">
                        <input type="checkbox" class="bc-member-chk" data-id="${m.id}"
                          ${checked ? 'checked' : ''} ${!hasPhone ? 'disabled title="No phone number"' : ''}
                          style="cursor:${hasPhone ? 'pointer' : 'not-allowed'};">
                      </td>
                      <td style="padding:8px 12px;">
                        <div style="display:flex;align-items:center;gap:8px;">
                          <div class="member-avatar" style="width:28px;height:28px;font-size:10px;">${av2(displayName)}</div>
                          <div>
                            <div style="font-size:13px;font-weight:500;color:var(--text-primary);">${escHtml(displayName)}</div>
                            ${!hasPhone ? '<div style="font-size:10px;color:var(--red);">No phone</div>' : ''}
                          </div>
                        </div>
                      </td>
                      <td class="hide-mobile" style="padding:8px 12px;font-size:12px;color:var(--text-secondary);">${escHtml(m.phone || '\u2014')}</td>
                      <td class="hide-mobile" style="padding:8px 12px;font-size:12px;color:var(--text-secondary);">${escHtml(m.plan_name || m.plan || '\u2014')}</td>
                      <td class="text-center" style="padding:8px 12px;"><span class="badge ${stBadge}" style="font-size:10px;">${st}</span></td>
                    </tr>`;
                  }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Bind events
    document.getElementById('bc-back-1')?.addEventListener('click', () => {
      _broadcastStep = 'compose';
      render(root);
    });

    document.getElementById('bc-next-2')?.addEventListener('click', () => {
      if (_selectedIds.size === 0) { showToast('Select at least one member', 'red'); return; }
      _broadcastStep = 'review';
      render(root);
    });

    document.getElementById('bc-search')?.addEventListener('input', (e) => {
      _searchQuery = e.target.value;
      renderList();
    });

    document.getElementById('bc-filter-status')?.addEventListener('change', (e) => {
      _filterStatus = e.target.value;
      renderList();
    });

    document.getElementById('bc-filter-plan')?.addEventListener('change', (e) => {
      _filterPlan = e.target.value;
      renderList();
    });

    // Select All
    const selectAllBtn = document.getElementById('bc-select-all');
    const checkAll = document.getElementById('bc-check-all');

    function toggleAll() {
      if (allSelected) {
        withPhone.forEach(m => _selectedIds.delete(m.id));
      } else {
        withPhone.forEach(m => _selectedIds.add(m.id));
      }
      renderList();
    }

    selectAllBtn?.addEventListener('click', toggleAll);
    checkAll?.addEventListener('change', toggleAll);

    // Individual checkboxes
    el.querySelectorAll('.bc-member-chk').forEach(chk => {
      chk.addEventListener('change', () => {
        const id = chk.dataset.id;
        if (chk.checked) _selectedIds.add(id);
        else _selectedIds.delete(id);
        renderList();
      });
    });
  }

  renderList();
}

// ── Step 3: Review & Pay ────────────────────────────────────────

function renderReview(el, root) {
  const gymName = S.gym?.name || 'Your Gym';
  const allMembers = S.members || [];
  const selectedMembers = allMembers.filter(m => _selectedIds.has(m.id) && m.phone && m.phone.replace(/\D/g, '').length >= 10);
  const cost = calculateBroadcastCost(selectedMembers.length);

  // Sample preview with first member
  const sample = selectedMembers[0];
  const previewMsg = _broadcastMsg
    .replace(/\{name\}/g, sample?.full_name || sample?.name || 'Member')
    .replace(/\{gym\}/g, gymName);

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
      <!-- Left: Summary -->
      <div>
        <div class="card" style="padding:20px;margin-bottom:16px;">
          <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:16px;">Broadcast Summary</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
            <div style="background:var(--surface-2);padding:14px;border-radius:var(--radius-md);text-align:center;">
              <div style="font-size:24px;font-weight:700;color:var(--brand-text);">${selectedMembers.length.toLocaleString()}</div>
              <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">Recipients</div>
            </div>
            <div style="background:var(--surface-2);padding:14px;border-radius:var(--radius-md);text-align:center;">
              <div style="font-size:24px;font-weight:700;color:var(--green);">${cost.costDisplay}</div>
              <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">Total Cost</div>
            </div>
          </div>
          <div style="font-size:12px;color:var(--text-tertiary);line-height:1.8;padding:12px;background:var(--surface-2);border-radius:var(--radius-md);">
            <div style="display:flex;justify-content:space-between;">
              <span>Per message</span>
              <span style="color:var(--text-secondary);">${cost.perMsgDisplay}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span>Recipients</span>
              <span style="color:var(--text-secondary);">\u00D7 ${selectedMembers.length.toLocaleString()}</span>
            </div>
            <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:8px;margin-top:8px;">
              <span style="font-weight:600;color:var(--text-primary);">Total</span>
              <span style="font-weight:600;color:var(--green);">${cost.costDisplay}</span>
            </div>
          </div>
        </div>

        <div style="display:flex;gap:8px;">
          <button class="btn btn-ghost" id="bc-back-2" type="button" style="flex:1;">\u2190 Back</button>
          <button class="btn" id="bc-pay-btn" type="button" style="flex:2;background:rgba(0,230,118,0.15);color:var(--green);border:1px solid rgba(0,230,118,0.3);font-weight:600;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="margin-right:4px;"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
            Pay ${cost.costDisplay} & Send
          </button>
        </div>
        <div id="bc-pay-error" style="display:none;color:var(--red);font-size:12px;margin-top:10px;padding:10px;background:var(--red-fade);border-radius:var(--radius-md);border:1px solid var(--red-strong);"></div>
      </div>

      <!-- Right: Message preview -->
      <div class="card" style="padding:20px;">
        <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:12px;">Message Preview</div>
        <div style="background:var(--surface-2);border-radius:12px;padding:16px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border);">
            <div style="width:32px;height:32px;border-radius:50%;background:rgba(0,230,118,0.15);display:flex;align-items:center;justify-content:center;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
            </div>
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--text-primary);">To: ${escHtml(sample?.full_name || sample?.name || 'Member')}</div>
              <div style="font-size:11px;color:var(--text-tertiary);">${escHtml(sample?.phone || '')}</div>
            </div>
          </div>
          <div style="font-size:13px;color:var(--text-secondary);line-height:1.7;white-space:pre-wrap;word-break:break-word;">${escHtml(previewMsg)}</div>
        </div>
        <div style="font-size:11px;color:var(--text-quaternary);margin-top:10px;line-height:1.6;">
          Each member receives this message with their name personalized. Messages are delivered via WhatsApp Business API.
        </div>
      </div>
    </div>
  `;

  // Mobile: stack
  const grid = el.querySelector('div[style*="grid-template-columns"]');
  if (grid && window.innerWidth < 768) {
    grid.style.gridTemplateColumns = '1fr';
  }

  document.getElementById('bc-back-2')?.addEventListener('click', () => {
    _broadcastStep = 'select';
    render(root);
  });

  // Pay & Send
  document.getElementById('bc-pay-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('bc-pay-btn');
    const errEl = document.getElementById('bc-pay-error');
    errEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Creating order\u2026';

    try {
      // Send IDs only. The Edge Function resolves names and phone
      // numbers from the database itself, so the browser can't dictate
      // who gets messaged and the charge matches what will be sent.
      const memberIds = selectedMembers.map(m => m.id);

      // 1. Create broadcast + Razorpay order
      const orderData = await createBroadcastOrder(S.gym.id, _broadcastMsg, memberIds);

      // The server may resolve fewer recipients than were selected \u2014 a
      // member cancelled or removed on another device since this list
      // was loaded. Say so before taking payment, rather than letting
      // the count silently change between the review screen and the bill.
      const resolved = orderData.total_recipients;
      if (resolved !== memberIds.length) {
        const diff = memberIds.length - resolved;
        showToast(`${diff} selected member${diff === 1 ? '' : 's'} can no longer be messaged (cancelled, removed, or no phone). Charging for ${resolved}.`, 'amber');
      }

      btn.textContent = 'Opening payment\u2026';

      // 2. Open Razorpay checkout
      const paymentResult = await openRazorpayCheckout({
        orderId: orderData.razorpay_order_id,
        keyId: orderData.razorpay_key_id,
        amountPaise: orderData.amount_paise,
        gymName: gymName,
        recipientCount: orderData.total_recipients,
      });

      btn.textContent = 'Verifying payment\u2026';

      // 3. Process broadcast (verify payment + start sending)
      _activeBroadcastId = orderData.broadcast_id;
      await processBroadcast(orderData.broadcast_id, paymentResult);

      showToast('Payment successful! Sending messages\u2026', 'green');

      // 4. Switch to sending view
      _broadcastStep = 'sending';
      render(root);

    } catch (err) {
      console.error('[Broadcast] Payment error:', err);
      const msg = err.message || 'Payment failed. Please try again.';
      if (msg !== 'Payment cancelled') {
        errEl.textContent = msg;
        errEl.style.display = 'block';
      }
      btn.disabled = false;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="margin-right:4px;"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>Pay ${cost.costDisplay} & Send`;
    }
  });
}

// ── Sending Progress ────────────────────────────────────────────

function renderSending(c) {
  c.innerHTML = `<div class="content-inner page-enter">
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-title">WhatsApp Broadcast</div>
        <div class="page-sub">Sending messages\u2026</div>
      </div>
    </div>

    <div class="card" style="padding:32px;text-align:center;max-width:520px;margin:0 auto;">
      <div id="bc-send-icon" style="font-size:40px;margin-bottom:16px;">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="1.5" stroke-linecap="round" style="animation:spin 1.5s linear infinite;">
          <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
        </svg>
      </div>
      <div id="bc-send-title" style="font-size:18px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">Sending Messages</div>
      <div id="bc-send-sub" style="font-size:13px;color:var(--text-tertiary);margin-bottom:24px;">Your broadcast is being delivered\u2026</div>

      <!-- Progress bar -->
      <div style="background:var(--surface-2);border-radius:8px;height:12px;overflow:hidden;margin-bottom:12px;">
        <div id="bc-progress-bar" style="height:100%;background:var(--green);border-radius:8px;transition:width 0.5s ease;width:0%;"></div>
      </div>
      <div id="bc-progress-text" style="font-size:13px;color:var(--text-secondary);margin-bottom:24px;">0 / 0</div>

      <div id="bc-send-stats" style="display:none;display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
        <div style="background:rgba(0,230,118,0.08);padding:12px;border-radius:var(--radius-md);">
          <div id="bc-stat-sent" style="font-size:20px;font-weight:700;color:var(--green);">0</div>
          <div style="font-size:11px;color:var(--text-tertiary);">Delivered</div>
        </div>
        <div style="background:var(--red-fade);padding:12px;border-radius:var(--radius-md);">
          <div id="bc-stat-failed" style="font-size:20px;font-weight:700;color:var(--red);">0</div>
          <div style="font-size:11px;color:var(--text-tertiary);">Failed</div>
        </div>
      </div>

      <div id="bc-done-actions" style="display:none;">
        <button class="btn btn-primary" id="bc-new-broadcast" type="button" style="margin-right:8px;">New Broadcast</button>
        <button class="btn btn-ghost" id="bc-view-history" type="button">View History</button>
      </div>
    </div>
  </div>

  <style>
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>`;

  // Start polling
  if (_pollTimer) clearInterval(_pollTimer);
  let pollCount = 0;

  async function poll() {
    if (!_activeBroadcastId) return;
    try {
      const status = await getBroadcastStatus(_activeBroadcastId);
      if (!status) return;

      const total = status.total_recipients || 1;
      const sent = status.sent_count || 0;
      const failed = status.failed_count || 0;
      const processed = sent + failed;
      const pct = Math.round((processed / total) * 100);

      const bar = document.getElementById('bc-progress-bar');
      const text = document.getElementById('bc-progress-text');
      const statSent = document.getElementById('bc-stat-sent');
      const statFailed = document.getElementById('bc-stat-failed');

      if (bar) bar.style.width = pct + '%';
      if (text) text.textContent = `${processed.toLocaleString()} / ${total.toLocaleString()}`;
      if (statSent) statSent.textContent = sent.toLocaleString();
      if (statFailed) statFailed.textContent = failed.toLocaleString();

      const statsEl = document.getElementById('bc-send-stats');
      if (statsEl) statsEl.style.display = 'grid';

      // Check if done
      if (status.status === 'completed' || status.status === 'partially_failed' || status.status === 'failed') {
        if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }

        const icon = document.getElementById('bc-send-icon');
        const title = document.getElementById('bc-send-title');
        const sub = document.getElementById('bc-send-sub');
        const actions = document.getElementById('bc-done-actions');

        if (status.status === 'completed') {
          if (icon) icon.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
          if (title) title.textContent = 'Broadcast Sent!';
          if (sub) sub.textContent = `All ${sent.toLocaleString()} messages delivered successfully`;
          if (bar) bar.style.background = 'var(--green)';
        } else if (status.status === 'partially_failed') {
          if (icon) icon.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
          if (title) title.textContent = 'Broadcast Partially Sent';
          if (sub) sub.textContent = `${sent.toLocaleString()} delivered, ${failed.toLocaleString()} failed`;
          if (bar) bar.style.background = 'var(--amber)';
        } else {
          if (icon) icon.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
          if (title) title.textContent = 'Broadcast Failed';
          if (sub) sub.textContent = 'There was an error sending messages. Please contact support.';
          if (bar) bar.style.background = 'var(--red)';
        }

        if (actions) actions.style.display = 'block';
        showToast(status.status === 'completed' ? 'Broadcast sent successfully!' : `Broadcast done: ${sent} sent, ${failed} failed`, status.status === 'completed' ? 'green' : 'amber');
      }

      pollCount++;
      // Stop polling after 10 minutes (200 polls × 3s).
      // Sending is chunked server-side, so a large broadcast legitimately
      // runs longer than this. Say so, rather than leaving a frozen
      // progress bar and letting the owner assume it broke.
      if (pollCount > 200 && _pollTimer) {
        clearInterval(_pollTimer);
        _pollTimer = null;
        const sub = document.getElementById('bc-send-sub');
        if (sub) {
          sub.textContent = 'Still sending in the background. You can close this page — '
            + 'check Broadcast → History for the final result.';
        }
        showToast('Sending continues in the background — check History for the result', 'amber');
      }
    } catch (err) {
      console.warn('[Broadcast] Poll error:', err);
    }
  }

  _pollTimer = setInterval(poll, 3000);
  poll(); // immediate first poll

  document.getElementById('bc-new-broadcast')?.addEventListener('click', () => {
    cleanup();
    _broadcastStep = 'compose';
    _broadcastMsg = '';
    _selectedIds = new Set();
    render(c);
  });

  document.getElementById('bc-view-history')?.addEventListener('click', () => {
    _broadcastStep = 'history';
    render(c);
  });
}

// ── History ─────────────────────────────────────────────────────

async function renderHistory(c) {
  showSectionLoading(c, 'Broadcast History');

  try {
    _historyData = await getBroadcasts(S.gym?.id);
  } catch (err) {
    console.warn('[Broadcast] History fetch error:', err);
    _historyData = [];
  }

  const statusBadge = (s) => {
    const map = {
      payment_pending: 'badge-amber',
      paid: 'badge-blue',
      sending: 'badge-blue',
      completed: 'badge-green',
      partially_failed: 'badge-amber',
      failed: 'badge-red',
    };
    const labels = {
      payment_pending: 'Payment Pending',
      paid: 'Paid',
      sending: 'Sending\u2026',
      completed: 'Completed',
      partially_failed: 'Partial',
      failed: 'Failed',
    };
    return `<span class="badge ${map[s] || 'badge-muted'}">${labels[s] || s}</span>`;
  };

  c.innerHTML = `<div class="content-inner page-enter">
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-title">Broadcast History</div>
        <div class="page-sub">${_historyData.length} broadcast${_historyData.length !== 1 ? 's' : ''} sent</div>
      </div>
      <div>
        <button class="btn btn-primary" id="bc-new-from-history" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Broadcast
        </button>
      </div>
    </div>

    ${_historyData.length === 0
      ? `<div class="card" style="padding:48px;text-align:center;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-quaternary)" stroke-width="1.5" stroke-linecap="round" style="margin:0 auto 16px;">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          </svg>
          <div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:6px;">No broadcasts yet</div>
          <div style="font-size:13px;color:var(--text-tertiary);margin-bottom:16px;">Send your first WhatsApp broadcast to get started</div>
        </div>`
      : `<div style="display:flex;flex-direction:column;gap:12px;">
          ${_historyData.map(b => {
            const date = new Date(b.created_at);
            const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            const timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
            const msgPreview = (b.message || '').replace(/\{name\}/g, 'Member').slice(0, 100);
            const costDisplay = '\u20B9' + ((b.amount_paise || 0) / 100).toLocaleString('en-IN');
            return `<div class="card bc-history-card" data-bid="${b.id}" style="padding:16px;cursor:pointer;transition:border-color 0.15s;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
                <div>
                  <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${dateStr} \u00B7 ${timeStr}</div>
                  <div style="font-size:12px;color:var(--text-tertiary);margin-top:2px;">${escHtml(msgPreview)}${(b.message || '').length > 100 ? '\u2026' : ''}</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                  ${statusBadge(b.status)}
                </div>
              </div>
              <div style="display:flex;gap:16px;font-size:12px;color:var(--text-tertiary);">
                <span style="color:var(--text-secondary);font-weight:500;">${(b.total_recipients || 0).toLocaleString()} recipients</span>
                ${b.sent_count > 0 ? `<span style="color:var(--green);">\u2713 ${b.sent_count.toLocaleString()} sent</span>` : ''}
                ${b.failed_count > 0 ? `<span style="color:var(--red);">\u2717 ${b.failed_count.toLocaleString()} failed</span>` : ''}
                <span>${costDisplay}</span>
              </div>
            </div>`;
          }).join('')}
        </div>`
    }
  </div>`;

  document.getElementById('bc-new-from-history')?.addEventListener('click', () => {
    cleanup();
    _broadcastStep = 'compose';
    _broadcastMsg = '';
    _selectedIds = new Set();
    render(c);
  });

  // Click to expand broadcast detail
  c.querySelectorAll('.bc-history-card').forEach(card => {
    card.addEventListener('click', () => openBroadcastDetail(card.dataset.bid, c));
  });
}

async function openBroadcastDetail(broadcastId, rootC) {
  const broadcast = _historyData.find(b => b.id === broadcastId);
  if (!broadcast) return;

  showSectionLoading(rootC, 'Broadcast Detail');

  let recipients = [];
  try {
    recipients = await getBroadcastRecipients(broadcastId);
  } catch (err) {
    console.warn('[Broadcast] Recipients fetch error:', err);
  }

  const date = new Date(broadcast.created_at);
  const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const costDisplay = '\u20B9' + ((broadcast.amount_paise || 0) / 100).toLocaleString('en-IN');

  rootC.innerHTML = `<div class="content-inner page-enter">
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-title">Broadcast Detail</div>
        <div class="page-sub">${dateStr}</div>
      </div>
      <button class="btn btn-ghost" id="bc-detail-back" type="button">\u2190 Back to History</button>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;">
      <div class="card" style="padding:20px;">
        <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:12px;">Message</div>
        <div style="font-size:13px;color:var(--text-secondary);line-height:1.7;white-space:pre-wrap;word-break:break-word;background:var(--surface-2);padding:14px;border-radius:var(--radius-md);">${escHtml(broadcast.message)}</div>
      </div>
      <div class="card" style="padding:20px;">
        <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:12px;">Stats</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));gap:10px;">
          <div style="text-align:center;padding:12px;background:var(--surface-2);border-radius:var(--radius-md);">
            <div style="font-size:20px;font-weight:700;color:var(--text-primary);">${(broadcast.total_recipients || 0).toLocaleString()}</div>
            <div style="font-size:10px;color:var(--text-tertiary);">Total</div>
          </div>
          <div style="text-align:center;padding:12px;background:rgba(0,230,118,0.08);border-radius:var(--radius-md);">
            <div style="font-size:20px;font-weight:700;color:var(--green);">${(broadcast.sent_count || 0).toLocaleString()}</div>
            <div style="font-size:10px;color:var(--text-tertiary);">Sent</div>
          </div>
          <div id="bc-detail-delivered" style="text-align:center;padding:12px;background:rgba(0,230,118,0.08);border-radius:var(--radius-md);display:none;">
            <div style="font-size:20px;font-weight:700;color:var(--green);">0</div>
            <div style="font-size:10px;color:var(--text-tertiary);">Delivered</div>
          </div>
          <div id="bc-detail-read" style="text-align:center;padding:12px;background:rgba(30,111,204,0.1);border-radius:var(--radius-md);display:none;">
            <div style="font-size:20px;font-weight:700;color:var(--brand-text);">0</div>
            <div style="font-size:10px;color:var(--text-tertiary);">Read</div>
          </div>
          <div style="text-align:center;padding:12px;background:var(--red-fade);border-radius:var(--radius-md);">
            <div style="font-size:20px;font-weight:700;color:var(--red);">${(broadcast.failed_count || 0).toLocaleString()}</div>
            <div style="font-size:10px;color:var(--text-tertiary);">Failed</div>
          </div>
        </div>
        <div style="font-size:12px;color:var(--text-tertiary);margin-top:12px;">Amount paid: <strong style="color:var(--text-secondary);">${costDisplay}</strong></div>
        ${broadcast.razorpay_payment_id ? `<div style="font-size:11px;color:var(--text-quaternary);margin-top:4px;">Payment ID: ${escHtml(broadcast.razorpay_payment_id)}</div>` : ''}
      </div>
    </div>

    <!-- Recipients list -->
    <div class="card" style="padding:20px;">
      <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:14px;">
        Recipients (${(broadcast.total_recipients || recipients.length).toLocaleString()})
        ${recipients.length < (broadcast.total_recipients || 0)
          ? `<span style="font-weight:400;font-size:12px;color:var(--text-tertiary);">— showing first ${recipients.length.toLocaleString()}</span>`
          : ''}
      </div>
      <div style="max-height:400px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-md);">
        <table class="data-table">
          <thead>
            <tr style="position:sticky;top:0;z-index:1;">
              <th>Member</th>
              <th>Phone</th>
              <th class="text-center">Status</th>
              <th class="hide-mobile">Time</th>
            </tr>
          </thead>
          <tbody>
            ${recipients.length === 0
              ? `<tr><td colspan="4" style="padding:24px;text-align:center;color:var(--text-tertiary);font-size:13px;">No recipients found</td></tr>`
              : recipients.map(r => {
                  const stMap = {
                    read:      { badge: 'badge-blue',  label: 'Read' },
                    delivered: { badge: 'badge-green',  label: 'Delivered' },
                    sent:      { badge: 'badge-green', label: 'Sent' },
                    failed:    { badge: 'badge-red',   label: 'Failed' },
                    pending:   { badge: 'badge-muted', label: 'Pending' },
                  };
                  const stInfo = stMap[r.status] || stMap.pending;
                  const stBadge = stInfo.badge;
                  const stLabel = stInfo.label;
                  const timeStr = r.sent_at ? new Date(r.sent_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '\u2014';
                  return `<tr>
                    <td style="font-size:13px;color:var(--text-primary);">${escHtml(r.member_name || 'Member')}</td>
                    <td style="font-size:12px;color:var(--text-secondary);">${escHtml(r.phone)}</td>
                    <td class="text-center"><span class="badge ${stBadge}" style="font-size:10px;">${stLabel}</span>
                      ${r.error_message ? `<div style="font-size:10px;color:var(--red);margin-top:2px;">${escHtml(r.error_message.slice(0, 60))}</div>` : ''}
                    </td>
                    <td class="hide-mobile" style="font-size:12px;color:var(--text-tertiary);">${timeStr}</td>
                  </tr>`;
                }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;

  // Show delivered/read counts if any recipients have those statuses
  const deliveredCount = recipients.filter(r => r.status === 'delivered' || r.status === 'read').length;
  const readCount = recipients.filter(r => r.status === 'read').length;
  const deliveredEl = document.getElementById('bc-detail-delivered');
  const readEl = document.getElementById('bc-detail-read');
  if (deliveredCount > 0 && deliveredEl) {
    deliveredEl.style.display = 'block';
    deliveredEl.querySelector('div').textContent = deliveredCount.toLocaleString();
  }
  if (readCount > 0 && readEl) {
    readEl.style.display = 'block';
    readEl.querySelector('div').textContent = readCount.toLocaleString();
  }

  // Mobile: stack grid
  const grid = rootC.querySelector('div[style*="grid-template-columns: 1fr 1fr"]');
  if (grid && window.innerWidth < 768) {
    grid.style.gridTemplateColumns = '1fr';
  }

  document.getElementById('bc-detail-back')?.addEventListener('click', () => {
    _broadcastStep = 'history';
    render(rootC);
  });
}

export { renderBroadcast, cleanup as cleanupBroadcast };
