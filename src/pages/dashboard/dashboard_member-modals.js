import { S, DEFAULT_WA_TEMPLATE } from './state.js';
import { expiryDate, daysLeft, memberStatus, escHtml, fmtDate, av2, bindDateInput, fmtDateInput, parseDateInput, parseMemberAddons, planTotalPrice, genInvoiceNo, memberTotal } from './helpers.js';
import { getMembers, addMember, updateMember, deleteMember, logReminder, clearBalance, cancelMembership, reactivateMembership } from '../../lib/members.js';
import { showToast } from '../../components/toast.js';
import { openModal, closeModal, modalFooter, bindModalCancel } from '../../components/modal.js';
import { supabase } from '../../lib/supabase.js';
import { pickPhoto } from '../../components/photo-picker.js';
import { showPrintPreview } from '../../components/print-preview.js';

let _nav, _saveMemberPhoto;
export function setNavHandler(fn) { _nav = fn; }
export function setPhotoHandler(fn) { _saveMemberPhoto = fn; }

function openAddModal() {
  const planOpts = S.plans.map(p => {
    const total = planTotalPrice(p);
    return `<option value="${p.id}" data-price="${total}"
       data-dur="${p.duration_months||p.duration||1}"
       data-name="${p.name}">${p.name} — ₹${Number(total).toLocaleString('en-IN')}</option>`;
  }).join('');

  openModal({
    title: 'Add New Member',
    size: 'lg',
    mobileCompact: true,
    body: `
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
        <div id="m-photo-preview" style="width:60px;height:60px;border-radius:50%;background:var(--surface-3);
             display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;
             border:2px dashed var(--border-default);flex-shrink:0;" id="m-photo-btn">
          <span style="font-size:10px;color:var(--text-tertiary);text-align:center;line-height:1.2;">Add<br>Photo</span>
        </div>
        <div style="font-size:12px;color:var(--text-quaternary);">Tap to upload photo (optional)</div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Full Name *</label>
          <input class="form-input" id="m-name" placeholder="e.g. Rahul Sharma">
        </div>
        <div class="form-group">
          <label class="form-label">Phone <span style="color:var(--muted);font-weight:400;font-size:11px;">(optional)</span></label>
          <div style="display:flex;align-items:center;gap:0;">
            <span style="background:var(--panel2);border:1px solid var(--border);border-right:none;
              padding:0 12px;height:42px;display:flex;align-items:center;font-size:13px;
              color:var(--muted);border-radius:var(--radius-sm) 0 0 var(--radius-sm);
              white-space:nowrap;flex-shrink:0;">+91</span>
            <input class="form-input" id="m-phone" placeholder="9876543210" maxlength="10"
              oninput="this.value=this.value.replace(/\D/g,'').slice(0,10);"
              style="border-radius:0 var(--radius-sm) var(--radius-sm) 0;border-left:none;">
          </div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Email <span style="color:var(--muted);font-weight:400;font-size:11px;">(optional)</span></label>
          <input class="form-input" id="m-email" type="email" placeholder="email@example.com">
        </div>
        <div class="form-group">
          <label class="form-label">Date of Birth</label>
          <input class="form-input date-input" id="m-dob" placeholder="DD/MM/YYYY" maxlength="10" autocomplete="off">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Join Date *</label>
          <input class="form-input date-input" id="m-join" placeholder="DD/MM/YYYY" maxlength="10" autocomplete="off" data-today="true">
        </div>
        <div class="form-group">
          <label class="form-label">Gender</label>
          <select class="form-input filter-select" id="m-gender" style="width:100%;color:var(--white);">
            <option value="">Select</option>
            <option>Male</option><option>Female</option><option>Other</option>
          </select>
        </div>
      </div>
      <!-- Member type selector — the key new feature -->
      <div class="form-group">
        <label class="form-label">Member Type *</label>
        <div class="mtype-switch">
          <button type="button" class="mtype-btn active" data-type="Paid"   id="mt-paid">Paid Member</button>
          <button type="button" class="mtype-btn"        data-type="Unpaid" id="mt-unpaid">Unpaid / Due</button>
          <button type="button" class="mtype-btn"        data-type="Trial"  id="mt-trial">Trial / Free</button>
        </div>
      </div>

      <!-- Plan + payment fields (hidden for Trial) -->
      <div id="plan-fields">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Membership Plan *</label>
            <select class="form-input filter-select" id="m-plan" style="width:100%;color:var(--white);">
              <option value="">-- Select Plan --</option>
              ${planOpts}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Payment Mode</label>
            <select class="form-input filter-select" id="m-paymode" style="width:100%;color:var(--white);">
              <option value="Online">Online</option>
              <option value="Card">Card</option>
              <option value="Cash">Cash</option>
            </select>
          </div>
        </div>
        <!-- Add-ons: dynamically loaded from gym's available activities -->
        <div class="form-group" id="m-addons-wrap" style="display:none;">
          <label class="form-label">Extra Activities / Add-ons</label>
          <div id="m-addon-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
            ${(S.addonTemplates||[]).map(a =>
              `<button type="button" class="m-addon-chip" data-name="${escHtml(a.name)}" data-price="${a.default_price}"
                style="padding:5px 12px;border-radius:var(--radius-pill);font-size:var(--text-sm);
                background:var(--surface-3);border:1px solid var(--border-default);color:var(--text-secondary);
                cursor:pointer;transition:all var(--duration-fast) var(--ease-out);">
                ${escHtml(a.name)} +₹${parseFloat(a.default_price).toLocaleString('en-IN')}
              </button>`
            ).join('')}
          </div>
          <div id="m-addons-list" style="display:flex;flex-direction:column;gap:8px;"></div>
          <div style="display:flex;gap:8px;margin-top:8px;">
            <input class="form-input" id="m-addon-name" placeholder="Activity name (e.g. Cardio)" style="flex:2;">
            <input class="form-input" id="m-addon-price" type="number" min="0" placeholder="Price ₹" style="flex:1;">
            <button type="button" class="btn btn-ghost btn-sm" id="btn-m-add-addon">+ Add</button>
          </div>
          <div id="m-addon-total" style="margin-top:8px;padding:8px 12px;background:var(--bg2);border-radius:var(--radius-sm);font-size:13px;color:var(--muted);display:none;">
            Total: <strong style="color:var(--white);" id="m-addon-total-val"></strong>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Discount <span style="color:var(--muted);font-weight:400;font-size:11px;">(optional, ₹)</span></label>
            <input class="form-input" id="m-discount" type="number" min="0" placeholder="0">
          </div>
          <div class="form-group">
            <label class="form-label">Amount Paid Now (₹)</label>
            <input class="form-input" id="m-paid-now" type="number" min="0" placeholder="0">
          </div>
        </div>
        <div id="m-balance-note" style="display:none;font-size:12px;color:var(--amber);padding:8px 12px;background:var(--amber-fade);border-radius:var(--radius-sm);margin-bottom:12px;"></div>
      </div>

      <!-- Trial fields (hidden by default) -->
      <div id="trial-fields" style="display:none;">
        <div class="form-group">
          <label class="form-label">Free Trial Duration</label>
          <select class="form-input filter-select" id="m-trialdays-preset" style="width:100%;color:var(--white);">
            <option value="3">3 days</option>
            <option value="7" selected>7 days</option>
            <option value="custom">Custom…</option>
          </select>
        </div>
        <div class="form-group" id="trial-custom-wrap" style="display:none;">
          <label class="form-label">Custom Trial Days</label>
          <input class="form-input" id="m-trialdays" type="number" min="1" max="90" value="7"
            placeholder="Number of days">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Notes</label>
        <input class="form-input" id="m-notes" placeholder="Any special notes...">
      </div>

      <div id="m-error" style="display:none;color:var(--red);font-size:13px;
           background:rgba(255,77,77,0.08);border:1px solid rgba(255,77,77,0.3);
           padding:10px 13px;border-radius:2px;margin-top:4px;"></div>
    `,
    footer: modalFooter('Cancel', 'Add Member →', 'btn-add-submit'),
    onOpen: () => {
      // Set today's date in DD/MM/YYYY format for join date
      const joinEl = document.getElementById('m-join');
      if (joinEl && joinEl.dataset.today) {
        const t = new Date();
        joinEl.value = String(t.getDate()).padStart(2,'0') + '/'
          + String(t.getMonth()+1).padStart(2,'0') + '/' + t.getFullYear();
      }

      // Wire up auto-format for all date inputs in this modal
      document.querySelectorAll('.date-input').forEach(el => bindDateInput(el));

      // Photo picker handler
      let pendingAddPhotoDataUrl = null;
      document.getElementById('m-photo-preview')?.addEventListener('click', async () => {
        const result = await pickPhoto();
        if (result) {
          pendingAddPhotoDataUrl = result.dataUrl;
          const preview = document.getElementById('m-photo-preview');
          if (preview) {
            preview.style.border = 'none';
            preview.innerHTML = `<img src="${result.dataUrl}" style="width:100%;height:100%;object-fit:cover;">`;
          }
        }
      });
      // Store ref for submitAdd
      window.__pendingAddPhoto = () => pendingAddPhotoDataUrl;

      // Member type toggle
      let mType = 'Paid';
      let paidNowTouched = false;
      document.querySelectorAll('.mtype-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.mtype-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          mType = btn.dataset.type;
          document.getElementById('plan-fields').style.display  = mType==='Trial'?'none':'block';
          document.getElementById('trial-fields').style.display = mType==='Trial'?'block':'none';
          if (mType === 'Unpaid') {
            paidNowTouched = true;
            const el = document.getElementById('m-paid-now');
            if (el) el.value = 0;
            updateBalanceNote();
          } else if (mType === 'Paid') {
            paidNowTouched = false;
            syncPaidNow();
            updateBalanceNote();
          }
        });
      });

      // Discount / Amount Paid Now helpers
      function currentTotalDue() {
        const planEl = document.getElementById('m-plan');
        const planPrice = parseFloat(planEl?.options[planEl?.selectedIndex]?.dataset?.price || 0);
        const addonTotal = getMAddonRows().reduce((s, row) => s + (parseFloat(row.dataset.price)||0), 0);
        const discount = parseFloat(document.getElementById('m-discount')?.value) || 0;
        return Math.max(0, planPrice + addonTotal - discount);
      }
      function syncPaidNow() {
        const el = document.getElementById('m-paid-now');
        if (el && !paidNowTouched) el.value = currentTotalDue() || '';
      }
      function updateBalanceNote() {
        const total = currentTotalDue();
        const paid  = parseFloat(document.getElementById('m-paid-now')?.value) || 0;
        const bal   = Math.max(0, total - paid);
        const note  = document.getElementById('m-balance-note');
        if (!note) return;
        if (bal > 0) { note.style.display='block'; note.textContent = `Balance of ₹${bal.toLocaleString('en-IN')} will be marked as due.`; }
        else note.style.display = 'none';
      }
      document.getElementById('m-discount')?.addEventListener('input', () => { syncPaidNow(); updateBalanceNote(); });
      document.getElementById('m-paid-now')?.addEventListener('input', () => { paidNowTouched = true; updateBalanceNote(); });

      // Addon management helpers for Add Member modal
      function getMAddonRows() { return [...document.querySelectorAll('#m-addons-list .m-addon-row')]; }
      function updateMAddonTotal() {
        const planEl = document.getElementById('m-plan');
        const planPrice = parseFloat(planEl?.options[planEl?.selectedIndex]?.dataset?.price || 0);
        const addonTotal = getMAddonRows().reduce((s, row) => s + (parseFloat(row.dataset.price)||0), 0);
        const totalEl = document.getElementById('m-addon-total');
        const totalVal = document.getElementById('m-addon-total-val');
        if (getMAddonRows().length > 0) {
          totalEl.style.display = 'block';
          totalVal.textContent = '₹' + Number(planPrice + addonTotal).toLocaleString('en-IN');
        } else { totalEl.style.display = 'none'; }
        syncPaidNow();
        updateBalanceNote();
      }
      function addMAddonRow(name, price) {
        name = (name || '').trim(); price = parseFloat(price) || 0;
        if (!name) {
          // Flash the name input red so user knows what's missing
          const nameEl = document.getElementById('m-addon-name');
          if (nameEl) {
            nameEl.style.borderColor = 'var(--red)';
            nameEl.focus();
            setTimeout(() => { nameEl.style.borderColor = ''; }, 1500);
          }
          return;
        }
        const list = document.getElementById('m-addons-list');
        const row = document.createElement('div');
        row.className = 'm-addon-row';
        row.dataset.name = name; row.dataset.price = price;
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--bg2);border-radius:var(--radius-sm);';
        row.innerHTML = `<span style="font-size:13px;color:var(--white);">${escHtml(name)}</span>
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:13px;color:var(--muted);">+₹${Number(price).toLocaleString('en-IN')}</span>
            <button type="button" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px;padding:0 2px;" class="m-addon-remove">✕</button>
          </div>`;
        row.querySelector('.m-addon-remove').addEventListener('click', () => { row.remove(); updateMAddonTotal(); });
        list.appendChild(row);
        updateMAddonTotal();
      }

      // When plan changes, show/hide addon section
      document.getElementById('m-plan')?.addEventListener('change', function() {
        const wrap = document.getElementById('m-addons-wrap');
        if (wrap) wrap.style.display = this.value ? 'block' : 'none';
        updateMAddonTotal();
      });

      document.getElementById('btn-m-add-addon')?.addEventListener('click', () => {
        const nameEl = document.getElementById('m-addon-name');
        const priceEl = document.getElementById('m-addon-price');
        addMAddonRow(nameEl.value, priceEl.value);
        nameEl.value = ''; priceEl.value = '';
      });
      document.getElementById('m-addon-name')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-m-add-addon')?.click(); }
      });
      document.getElementById('m-addon-price')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-m-add-addon')?.click(); }
      });

      // Addon template chip click handlers
      document.querySelectorAll('.m-addon-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const name = chip.dataset.name;
          const price = chip.dataset.price;
          // Don't add duplicate
          const existing = [...document.querySelectorAll('#m-addons-list .m-addon-row')];
          if (existing.some(row => row.dataset.name === name)) return;
          addMAddonRow(name, price);
          chip.style.background = 'var(--brand-fade)';
          chip.style.borderColor = 'var(--brand)';
          chip.style.color = 'var(--brand-text)';
        });
      });

      // Wire trial days preset dropdown
      document.getElementById('m-trialdays-preset')?.addEventListener('change', function() {
        const wrap = document.getElementById('trial-custom-wrap');
        if (this.value === 'custom') {
          wrap.style.display = 'block';
        } else {
          wrap.style.display = 'none';
          document.getElementById('m-trialdays').value = this.value;
        }
      });
      // Set default hidden input value
      document.getElementById('m-trialdays').value = '7';

      bindModalCancel();
      document.getElementById('btn-add-submit').addEventListener('click', () => submitAdd(mType));
    }
  });
}

async function submitAdd(mType) {
  const name  = document.getElementById('m-name')?.value.trim();
  const rawPhone = document.getElementById('m-phone')?.value.replace(/\D/g,'').slice(0,10);
  const phone = rawPhone ? '+91' + rawPhone : '';
  const join  = parseDateInput(document.getElementById('m-join')?.value);
  const errEl = document.getElementById('m-error');

  const show = msg => { errEl.textContent=msg; errEl.style.display='block'; };
  errEl.style.display = 'none';

  if (!name)  { show('Full name is required.'); return; }
  if (rawPhone && rawPhone.length !== 10) { show('Phone must be exactly 10 digits.'); return; }
  if (!join)  { show('Join date is required.'); return; }

  let planId='', planName='', planPrice=0, planDur=0, payMode='Online', payStatus='Paid';
  let memberAddons = [];

  if (mType === 'Trial') {
    planName   = 'Trial';
    payStatus  = 'Paid';
  } else {
    const planEl = document.getElementById('m-plan');
    planId   = planEl?.value;
    const opt = planEl?.options[planEl.selectedIndex];
    planName  = opt?.dataset.name || '';
    planPrice = parseFloat(opt?.dataset.price || 0);
    planDur   = parseInt(opt?.dataset.dur || 0);
    payMode   = document.getElementById('m-paymode')?.value || 'Online';

    if (!planId) { show('Please select a membership plan.'); return; }

    // Collect chosen addons
    memberAddons = [...document.querySelectorAll('#m-addons-list .m-addon-row')].map(row => ({
      name: row.dataset.name, price: parseFloat(row.dataset.price) || 0,
    }));
  }

  // Total price = base plan + member's chosen addons
  const addonTotal = memberAddons.reduce((s, a) => s + a.price, 0);
  const totalPlanPrice = planPrice + addonTotal;

  // Discount + amount actually collected now (defaults to full amount due)
  const discount = mType==='Trial' ? 0 : (parseFloat(document.getElementById('m-discount')?.value) || 0);
  const netDue = Math.max(0, totalPlanPrice - discount);
  let paidNow = document.getElementById('m-paid-now')?.value;
  paidNow = (paidNow !== '' && paidNow != null) ? parseFloat(paidNow) : netDue;
  if (isNaN(paidNow) || paidNow < 0) paidNow = 0;
  if (paidNow > netDue) paidNow = netDue;
  const balanceDue = Math.max(0, netDue - paidNow);
  if (mType !== 'Trial') {
    payStatus = balanceDue <= 0 ? 'Paid' : (paidNow <= 0 ? 'Due' : 'Partial');
  }

  const trialDays = mType==='Trial' ? Math.max(1, parseInt(document.getElementById('m-trialdays')?.value||7)) : 0;
  if (mType==='Trial') {
    const rawDays = parseInt(document.getElementById('m-trialdays')?.value||7);
    if (isNaN(rawDays) || rawDays < 1) { show('Trial period must be at least 1 day.'); return; }
  }

  const btn = document.getElementById('btn-add-submit');
  if (btn?.disabled) return; // guard against double-submit
  btn.disabled=true; btn.textContent='Adding...';

  // Build the data object
  const data = {
    fullName: name, phone,
    email:            document.getElementById('m-email')?.value.trim()||null,
    dateOfBirth:      parseDateInput(document.getElementById('m-dob')?.value)||null,
    gender:           document.getElementById('m-gender')?.value||null,
    joinDate:         join,
    planId:           planId||null,
    planName,
    planPrice:        mType==='Trial' ? totalPlanPrice : netDue,
    planDurationMonths: mType==='Trial' ? 0 : planDur,
    paymentMode:      mType==='Trial'?null:payMode,
    paymentStatus:    payStatus,
    memberType:       mType,
    trialDays,
    memberAddons:     memberAddons.length ? JSON.stringify(memberAddons) : null,
    notes:            document.getElementById('m-notes')?.value.trim()||null,
    discountAmount:   discount,
    balanceDue:       mType==='Trial' ? 0 : balanceDue,
    amountPaidNow:    mType==='Trial' ? 0 : paidNow,
  };

  // For trial, compute expiry as join + trialDays
  if (mType==='Trial' && trialDays>0) {
    const d = new Date(join);
    d.setDate(d.getDate()+trialDays);
    data.expiryDate = d.toISOString().split('T')[0];
  }

  try {
    const gymId = S.gym?.id;
    let saved;
    if (gymId) {
      saved = await addMember(gymId, data);
    } else {
      // Demo mode
      const expD = planDur>0
        ? (() => { const d=new Date(join); d.setMonth(d.getMonth()+planDur); return d.toISOString().split('T')[0]; })()
        : (data.expiryDate || null);
      saved = {
        id: Date.now().toString(),
        full_name: name, phone,
        join_date: join,
        plan_name: planName, plan_price: data.planPrice,
        plan_duration_months: planDur,
        payment_mode: payMode, payment_status: payStatus,
        member_type: mType,
        member_addons: data.memberAddons,
        discount_amount: discount,
        balance_due: data.balanceDue,
        expiry_date: expD,
        created_at: new Date().toISOString(),
      };
    }
    S.members.unshift(saved);
    // Save photo if selected — wait for it before closing
    const photoDataUrl = window.__pendingAddPhoto?.();
    if (photoDataUrl && saved.id && S.gym?.id) {
      btn.textContent = 'Saving photo…';
      try {
        await _saveMemberPhoto(photoDataUrl, S.gym.id, saved.id);
      } catch (err) {
        console.warn('[Flym] Photo upload failed:', err.message);
        showToast('Member saved but photo upload failed — try editing the member to re-upload', 'amber');
      }
    }
    // Always refresh from DB to get latest state
    try { S.members = await getMembers(S.gym.id); } catch(e) { /* use local */ }
    closeModal();
    _nav('members');
    showToast(`${name} added as ${mType} member!`, 'green');
  } catch (err) {
    show(err.message);
    btn.disabled=false; btn.textContent='Add Member →';
  }
}

// ════════════════════════════════════════════════════════════════
// EDIT MEMBER MODAL  (was a stub — now implemented)
// ════════════════════════════════════════════════════════════════
function openEditModal(id) {
  const m = S.members.find(x => String(x.id)===String(id));
  if (!m) return;

  const planOpts = S.plans.map(p => {
    const total = planTotalPrice(p);
    const isSelected = m.plan_id ? String(m.plan_id) === String(p.id) : (m.plan_name || m.plan) === p.name;
    return `<option value="${p.id}" data-price="${total}"
       data-dur="${p.duration_months||p.duration||1}"
       data-name="${p.name}"
       ${isSelected ? 'selected' : ''}>${p.name} — ₹${Number(total).toLocaleString('en-IN')}</option>`;
  }).join('');

  const mType = m.member_type || m.memberType || 'Paid';

  openModal({
    title: `Edit — ${m.full_name||m.name}`,
    size: 'lg',
    mobileCompact: true,
    body: `
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
        <div id="e-photo-preview" style="width:60px;height:60px;border-radius:50%;background:var(--surface-3);
             display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;
             border:${m.photo_url ? 'none' : '2px dashed var(--border-default)'};flex-shrink:0;">
          ${m.photo_url
            ? `<img src="${m.photo_url}" style="width:100%;height:100%;object-fit:cover;">`
            : `<span style="font-size:10px;color:var(--text-tertiary);text-align:center;line-height:1.2;">Add<br>Photo</span>`}
        </div>
        <div style="font-size:12px;color:var(--text-quaternary);">Tap to change photo</div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Full Name *</label>
          <input class="form-input" id="e-name" value="${m.full_name||m.name||''}"></div>
        <div class="form-group"><label class="form-label">Phone <span style="color:var(--muted);font-weight:400;font-size:11px;">(optional)</span></label>
          <div style="display:flex;align-items:center;gap:0;">
            <span style="background:var(--panel2);border:1px solid var(--border);border-right:none;
              padding:0 12px;height:42px;display:flex;align-items:center;font-size:13px;
              color:var(--muted);border-radius:var(--radius-sm) 0 0 var(--radius-sm);
              white-space:nowrap;flex-shrink:0;">+91</span>
            <input class="form-input" id="e-phone" maxlength="10"
              oninput="this.value=this.value.replace(/\D/g,'').slice(0,10);"
              style="border-radius:0 var(--radius-sm) var(--radius-sm) 0;border-left:none;"
              value="${escHtml((m.phone||'').replace(/^\+?91/,'').trim())}">
          </div></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Email</label>
          <input class="form-input" id="e-email" type="email" value="${m.email||''}"></div>
        <div class="form-group"><label class="form-label">Join Date</label>
          <input class="form-input date-input" id="e-join" placeholder="DD/MM/YYYY" maxlength="10" autocomplete="off" value="${m.join_date ? fmtDateInput(m.join_date) : ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Plan</label>
          <select class="form-input filter-select" id="e-plan" style="width:100%;color:var(--white);">
            <option value="">-- No Plan --</option>${planOpts}
          </select>
        </div>
        <div class="form-group"><label class="form-label">Payment Mode</label>
          <select class="form-input filter-select" id="e-paymode" style="width:100%;color:var(--white);">
            <option value="Cash" ${(m.payment_mode||m.payMode)==='Cash'?'selected':''}>Cash</option>
            <option value="Card" ${(m.payment_mode||m.payMode)==='Card'?'selected':''}>Card</option>
            <option value="Online" ${(m.payment_mode||m.payMode)==='Online'?'selected':''}>Online</option>
          </select>
        </div>
      </div>
      <!-- Member's chosen add-ons -->
      <div class="form-group" id="e-addons-wrap" style="${(m.plan_name||m.plan) ? '' : 'display:none;'}">
        <label class="form-label">Extra Activities / Add-ons</label>
        <div id="e-addon-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
          ${(S.addonTemplates||[]).map(a =>
            `<button type="button" class="e-addon-chip" data-name="${escHtml(a.name)}" data-price="${a.default_price}"
              style="padding:5px 12px;border-radius:var(--radius-pill);font-size:var(--text-sm);
              background:var(--surface-3);border:1px solid var(--border-default);color:var(--text-secondary);
              cursor:pointer;">${escHtml(a.name)} +₹${parseFloat(a.default_price).toLocaleString('en-IN')}</button>`
          ).join('')}
        </div>
        <div id="e-addons-list" style="display:flex;flex-direction:column;gap:8px;">
          ${parseMemberAddons(m).map(a => `
            <div class="e-addon-row" data-name="${escHtml(a.name)}" data-price="${a.price}" style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--bg2);border-radius:var(--radius-sm);">
              <span style="font-size:13px;color:var(--white);">${escHtml(a.name)}</span>
              <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:13px;color:var(--muted);">+₹${Number(a.price).toLocaleString('en-IN')}</span>
                <button type="button" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px;padding:0 2px;" class="e-addon-remove">✕</button>
              </div>
            </div>`).join('')}
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <input class="form-input" id="e-addon-name" placeholder="Activity name" style="flex:2;">
          <input class="form-input" id="e-addon-price" type="number" min="0" placeholder="Price ₹" style="flex:1;">
          <button type="button" class="btn btn-ghost btn-sm" id="btn-e-add-addon">+ Add</button>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Member Type</label>
          <div class="mtype-switch" id="e-mtype-switch">
            <button type="button" class="mtype-btn ${mType==='Paid'  ?'active':''}" data-type="Paid">Paid Member</button>
            <button type="button" class="mtype-btn ${mType==='Unpaid'?'active':''}" data-type="Unpaid">Unpaid / Due</button>
            <button type="button" class="mtype-btn ${mType==='Trial' ?'active':''}" data-type="Trial">Trial / Free</button>
          </div>
          <input type="hidden" id="e-mtype" value="${mType}">
        </div>
        <div class="form-group"><label class="form-label">Payment Status</label>
          <select class="form-input filter-select" id="e-pstatus" style="width:100%;color:var(--white);">
            <option value="Paid"    ${(m.payment_status||m.status)==='Paid'   ?'selected':''}>Paid</option>
            <option value="Due"     ${(m.payment_status||m.status)==='Due'    ?'selected':''}>Due</option>
            <option value="Partial" ${(m.payment_status||m.status)==='Partial'?'selected':''}>Partial</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Discount <span style="color:var(--muted);font-weight:400;font-size:11px;">(₹)</span></label>
          <input class="form-input" id="e-discount" type="number" min="0" placeholder="0" value="${m.discount_amount>0?m.discount_amount:''}"></div>
        <div class="form-group"><label class="form-label">Balance Due <span style="color:var(--muted);font-weight:400;font-size:11px;">(₹)</span></label>
          <input class="form-input" id="e-balance" type="number" min="0" placeholder="0" value="${m.balance_due>0?m.balance_due:''}"></div>
      </div>
      <div class="form-group"><label class="form-label">Notes</label>
        <input class="form-input" id="e-notes" value="${m.notes||''}"></div>

      <div id="e-error" style="display:none;color:var(--red);font-size:13px;
           background:rgba(255,77,77,0.08);border:1px solid rgba(255,77,77,0.3);
           padding:10px 13px;border-radius:2px;margin-top:4px;"></div>
    `,
    footer: modalFooter('Cancel', 'Save Changes →', 'btn-edit-submit'),
    onOpen: () => {
      document.querySelectorAll('.date-input').forEach(el => bindDateInput(el));

      // Photo picker handler for edit
      let pendingEditPhotoDataUrl = null;
      document.getElementById('e-photo-preview')?.addEventListener('click', async () => {
        const result = await pickPhoto();
        if (result) {
          pendingEditPhotoDataUrl = result.dataUrl;
          const preview = document.getElementById('e-photo-preview');
          if (preview) {
            preview.style.border = 'none';
            preview.innerHTML = `<img src="${result.dataUrl}" style="width:100%;height:100%;object-fit:cover;">`;
          }
        }
      });
      window.__pendingEditPhoto = () => pendingEditPhotoDataUrl;

      // Wire member type toggle buttons
      document.querySelectorAll('#e-mtype-switch .mtype-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#e-mtype-switch .mtype-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          document.getElementById('e-mtype').value = btn.dataset.type;
        });
      });

      // Addon management for edit modal
      function bindEAddonRemove() {
        document.querySelectorAll('#e-addons-list .e-addon-remove').forEach(btn => {
          btn.addEventListener('click', () => btn.closest('.e-addon-row').remove());
        });
      }
      function addEAddonRow(name, price) {
        name = (name || '').trim(); price = parseFloat(price) || 0;
        if (!name) {
          const nameEl = document.getElementById('e-addon-name');
          if (nameEl) {
            nameEl.style.borderColor = 'var(--red)';
            nameEl.focus();
            setTimeout(() => { nameEl.style.borderColor = ''; }, 1500);
          }
          return;
        }
        const list = document.getElementById('e-addons-list');
        const row = document.createElement('div');
        row.className = 'e-addon-row';
        row.dataset.name = name; row.dataset.price = price;
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--bg2);border-radius:var(--radius-sm);';
        row.innerHTML = `<span style="font-size:13px;color:var(--white);">${escHtml(name)}</span>
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:13px;color:var(--muted);">+₹${Number(price).toLocaleString('en-IN')}</span>
            <button type="button" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px;padding:0 2px;" class="e-addon-remove">✕</button>
          </div>`;
        row.querySelector('.e-addon-remove').addEventListener('click', () => row.remove());
        list.appendChild(row);
      }
      bindEAddonRemove();
      document.getElementById('btn-e-add-addon')?.addEventListener('click', () => {
        const nameEl = document.getElementById('e-addon-name');
        const priceEl = document.getElementById('e-addon-price');
        addEAddonRow(nameEl.value, priceEl.value);
        nameEl.value = ''; priceEl.value = '';
      });
      document.getElementById('e-addon-name')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-e-add-addon')?.click(); }
      });
      document.getElementById('e-addon-price')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-e-add-addon')?.click(); }
      });
      // Edit addon template chip click handlers
      document.querySelectorAll('.e-addon-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const name = chip.dataset.name;
          const price = chip.dataset.price;
          const existing = [...document.querySelectorAll('#e-addons-list .e-addon-row')];
          if (existing.some(row => row.dataset.name === name)) return;
          addEAddonRow(name, price);
          chip.style.background = 'var(--brand-fade)';
          chip.style.borderColor = 'var(--brand)';
          chip.style.color = 'var(--brand-text)';
        });
      });
      document.getElementById('e-plan')?.addEventListener('change', function() {
        const wrap = document.getElementById('e-addons-wrap');
        if (wrap) wrap.style.display = this.value ? '' : 'none';
      });

      bindModalCancel();
      document.getElementById('btn-edit-submit').addEventListener('click', async () => {
        const name     = document.getElementById('e-name')?.value.trim();
        const rawPhone = document.getElementById('e-phone')?.value.replace(/\D/g,'').slice(0,10);
        const phone    = rawPhone ? '+91' + rawPhone : '';
        const planEl= document.getElementById('e-plan');
        const opt   = planEl?.options[planEl.selectedIndex];
        const errEl = document.getElementById('e-error');
        if (!name) { errEl.textContent='Full name is required.'; errEl.style.display='block'; return; }
        if (rawPhone && rawPhone.length !== 10) { errEl.textContent='Phone must be exactly 10 digits.'; errEl.style.display='block'; return; }

        // Collect current addons from edit modal rows
        const editAddons = [...document.querySelectorAll('#e-addons-list .e-addon-row')].map(row => ({
          name: row.dataset.name, price: parseFloat(row.dataset.price) || 0,
        }));
        // Use plan base price from the dropdown option OR look up the plan's base price.
        // NEVER use m.plan_price as fallback — it has old addons baked in.
        const selectedPlan = planEl?.value ? S.plans.find(p => String(p.id) === planEl.value) : null;
        const basePlanPrice = parseFloat(opt?.dataset.price || (selectedPlan ? selectedPlan.price : 0));
        const addonTotal = editAddons.reduce((s, a) => s + a.price, 0);
        const editDiscount = parseFloat(document.getElementById('e-discount')?.value) || 0;
        const editBalance  = parseFloat(document.getElementById('e-balance')?.value) || 0;

        const updates = {
          fullName:            name,
          phone,
          email:               document.getElementById('e-email')?.value.trim()||null,
          joinDate:            parseDateInput(document.getElementById('e-join')?.value),
          planId:              planEl?.value||null,
          planName:            opt?.dataset.name||m.plan_name||m.plan||null,
          planPrice:           Math.max(0, basePlanPrice + addonTotal - editDiscount),
          planDurationMonths:  parseInt(opt?.dataset.dur||m.plan_duration_months||0),
          paymentMode:         document.getElementById('e-paymode')?.value,
          paymentStatus:       document.getElementById('e-pstatus')?.value,
          memberType:          document.getElementById('e-mtype')?.value,
          memberAddons:        editAddons.length ? JSON.stringify(editAddons) : null,
          notes:               document.getElementById('e-notes')?.value.trim()||null,
          discountAmount:      editDiscount,
          balanceDue:          editBalance,
        };

        const btn=document.getElementById('btn-edit-submit');
        btn.disabled=true; btn.textContent='Saving...';
        try {
          if (S.gym?.id) {
            const saved = await updateMember(id, S.gym.id, updates);
            const idx = S.members.findIndex(x=>String(x.id)===String(id));
            if (idx>-1) S.members[idx]=saved;
          } else {
            const idx = S.members.findIndex(x=>String(x.id)===String(id));
            if (idx>-1) S.members[idx]={...S.members[idx], full_name:name, phone,
              plan_id: updates.planId, plan_name:updates.planName, plan_price:updates.planPrice,
              plan_duration_months: updates.planDurationMonths,
              join_date: updates.joinDate,
              member_addons:updates.memberAddons,
              payment_mode:updates.paymentMode,
              payment_status:updates.paymentStatus, member_type:updates.memberType, notes:updates.notes,
              discount_amount:updates.discountAmount, balance_due:updates.balanceDue};
          }
          // Save photo if changed — wait for it before closing
          const editPhotoDataUrl = window.__pendingEditPhoto?.();
          if (editPhotoDataUrl && m.id && S.gym?.id) {
            btn.textContent = 'Saving photo…';
            try {
              await _saveMemberPhoto(editPhotoDataUrl, S.gym.id, m.id);
              S.members = await getMembers(S.gym.id);
            } catch (err) { showToast('Photo save failed', 'amber'); }
          }
          closeModal(); _nav('members'); showToast('Member updated!','green');
        } catch(err) { errEl.textContent=err.message; errEl.style.display='block'; btn.disabled=false; btn.textContent='Save Changes →'; }
      });
    }
  });
}

function confirmDelete(id) {
  const m = S.members.find(x => String(x.id) === String(id));
  if (!m) return;
  const name = escHtml(m.full_name || m.name);
  const st   = memberStatus(m);
  openModal({
    title: 'Remove Member',
    size: 'sm',
    body: `
      <div style="text-align:center;padding:8px 0 4px;">
        <div style="font-size:36px;margin-bottom:14px;">⚠️</div>
        <div style="font-size:15px;font-weight:600;color:var(--white);margin-bottom:8px;">Remove ${name}?</div>
        <div style="font-size:13px;color:var(--muted);line-height:1.6;">
          This member (${st}) will be removed from your active list.<br>
          Their records are preserved for your history and reports.
        </div>
      </div>`,
    footer: `
      <button class="btn btn-ghost" id="modal-cancel" style="flex:1;">Cancel</button>
      <button class="btn btn-danger-soft" id="btn-confirm-del" style="flex:1;">Remove</button>`,
    onOpen: () => {
      bindModalCancel();
      document.getElementById('btn-confirm-del').addEventListener('click', async () => {
        const btn = document.getElementById('btn-confirm-del');
        btn.disabled = true; btn.textContent = 'Removing…';
        try {
          if (S.gym?.id) await deleteMember(id, S.gym.id);
          S.members = S.members.filter(x => String(x.id) !== String(id));
          closeModal();
          _nav('members');

          // Show undo toast
          const undoId = 'undo-del-' + Date.now();
          let undone = false;
          const toast = document.getElementById('flym-toast') || (() => { const t = document.createElement('div'); t.id = 'flym-toast'; t.className = 'toast'; document.body.appendChild(t); return t; })();
          toast.innerHTML = `<div class="toast-dot" style="background:var(--red)"></div>
            <span class="toast-msg">Member removed</span>
            <button id="${undoId}" style="margin-left:12px;background:none;border:1px solid var(--text-secondary);color:var(--text-primary);padding:3px 10px;border-radius:4px;font-size:12px;cursor:pointer;font-weight:600;">Undo</button>`;
          toast.classList.add('show');
          document.getElementById(undoId)?.addEventListener('click', async () => {
            if (undone) return;
            undone = true;
            try {
              await supabase.from('members').update({ is_active: true }).eq('id', id).eq('gym_id', S.gym.id);
              S.members = await getMembers(S.gym.id);
              _nav('members');
              showToast('Member restored!', 'green');
            } catch(e) { showToast('Undo failed', 'red'); }
          });
          setTimeout(() => { if (!undone) toast.classList.remove('show'); }, 6000);
        } catch (err) {
          closeModal();
          showToast(err.message || 'Delete failed', 'red');
        }
      });
    }
  });
}

// ════════════════════════════════════════════════════════════════
// CANCEL MEMBERSHIP — distinct from Remove. Member stays visible
// in the Members table with a "Cancelled" badge; nothing is deleted.
// ════════════════════════════════════════════════════════════════
function confirmCancelMembership(id) {
  const m = S.members.find(x => String(x.id) === String(id));
  if (!m) return;
  const name = escHtml(m.full_name || m.name);

  // Already cancelled → reactivate directly, no confirmation needed
  if (m.cancelled_at) {
    (async () => {
      try {
        const gymId = S.gym?.id;
        const saved = gymId ? await reactivateMembership(id, gymId) : { ...m, cancelled_at: null };
        const idx = S.members.findIndex(x => String(x.id) === String(id));
        if (idx > -1) S.members[idx] = { ...S.members[idx], ...saved };
        _nav(S.section || 'members');
        showToast(`${m.full_name||m.name}'s membership reactivated`, 'green');
      } catch (err) { showToast(err.message || 'Failed to reactivate', 'red'); }
    })();
    return;
  }

  openModal({
    title: 'Cancel Membership',
    size: 'sm',
    body: `
      <div style="text-align:center;padding:8px 0 4px;">
        <div style="font-size:36px;margin-bottom:14px;">🚫</div>
        <div style="font-size:15px;font-weight:600;color:var(--white);margin-bottom:8px;">Cancel membership for ${name}?</div>
        <div style="font-size:13px;color:var(--muted);line-height:1.6;">
          They'll stay in your Members list with a <strong>Cancelled</strong> badge.<br>
          Nothing is deleted — their record and history are kept.
        </div>
      </div>`,
    footer: `
      <button class="btn btn-ghost" id="modal-cancel" style="flex:1;">Back</button>
      <button class="btn btn-danger-soft" id="btn-confirm-cancelmem" style="flex:1;">Cancel Membership</button>`,
    onOpen: () => {
      bindModalCancel();
      document.getElementById('btn-confirm-cancelmem').addEventListener('click', async () => {
        const btn = document.getElementById('btn-confirm-cancelmem');
        btn.disabled = true; btn.textContent = 'Cancelling…';
        try {
          const gymId = S.gym?.id;
          const saved = gymId ? await cancelMembership(id, gymId) : { ...m, cancelled_at: new Date().toISOString() };
          const idx = S.members.findIndex(x => String(x.id) === String(id));
          if (idx > -1) S.members[idx] = { ...S.members[idx], ...saved };
          closeModal();
          _nav(S.section || 'members');

          // Undo toast
          const undoId = 'undo-cancelmem-' + Date.now();
          let undone = false;
          const toast = document.getElementById('flym-toast') || (() => { const t = document.createElement('div'); t.id = 'flym-toast'; t.className = 'toast'; document.body.appendChild(t); return t; })();
          toast.innerHTML = `<div class="toast-dot" style="background:var(--amber)"></div>
            <span class="toast-msg">Membership cancelled</span>
            <button id="${undoId}" style="margin-left:12px;background:none;border:1px solid var(--text-secondary);color:var(--text-primary);padding:3px 10px;border-radius:4px;font-size:12px;cursor:pointer;font-weight:600;">Undo</button>`;
          toast.classList.add('show');
          document.getElementById(undoId)?.addEventListener('click', async () => {
            if (undone) return;
            undone = true;
            try {
              if (S.gym?.id) await reactivateMembership(id, S.gym.id);
              const idx2 = S.members.findIndex(x => String(x.id) === String(id));
              if (idx2 > -1) S.members[idx2] = { ...S.members[idx2], cancelled_at: null };
              _nav(S.section || 'members');
              showToast('Membership reactivated!', 'green');
            } catch (e) { showToast('Undo failed', 'red'); }
          });
          setTimeout(() => { if (!undone) toast.classList.remove('show'); }, 6000);
        } catch (err) {
          closeModal();
          showToast(err.message || 'Failed to cancel membership', 'red');
        }
      });
    }
  });
}

// ════════════════════════════════════════════════════════════════
// RENEW MEMBERSHIP (one-click renewal for expired/expiring members)
// ════════════════════════════════════════════════════════════════
function openRenewModal(id) {
  const m = S.members.find(x => String(x.id) === String(id));
  if (!m) return;
  const gymId = S.gym?.id;
  const today = new Date();
  const todayISO = today.toISOString().split('T')[0];

  function computeExp(months, baseISO){const d=new Date((baseISO||todayISO)+'T00:00:00');d.setMonth(d.getMonth()+(parseInt(months)||1));return d.toISOString().split('T')[0];}
  function fmtD(iso){if(!iso)return'—';const d=new Date(iso+'T00:00:00');return d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});}

  const planOpts=S.plans.map(p=>`<option value="${p.id}" data-price="${p.price}" data-dur="${p.duration_months}" ${String(p.id)===String(m.plan_id)?'selected':''}>${p.name} — ₹${parseFloat(p.price).toLocaleString('en-IN')} / ${p.duration_months}mo</option>`).join('');
  const initPlan=S.plans.find(p=>String(p.id)===String(m.plan_id));
  const initPrice=initPlan?parseFloat(initPlan.price):(parseFloat(m.plan_price)||0);
  const initDur=initPlan?initPlan.duration_months:(m.plan_duration_months||1);
  const name=escHtml(m.full_name||m.name);

  // Only show recurring addon templates in renew
  const recurringAddons=(S.addonTemplates||[]).filter(a=>!a.is_one_time);
  const addonChips=recurringAddons.length>0?`<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">${recurringAddons.map(a=>`<button type="button" class="renew-addon-chip" data-name="${a.name}" data-price="${a.default_price}" style="padding:5px 12px;border-radius:var(--radius-pill);font-size:var(--text-sm);background:var(--surface-3);border:1px solid var(--border-default);color:var(--text-secondary);cursor:pointer;">${a.name} +₹${parseFloat(a.default_price).toLocaleString('en-IN')}</button>`).join('')}</div>`:'';

  openModal({
    title:'Renew Membership',
    mobileCompact: true,
    body:`<div class="modal-form">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">
        ${m.photo_url
          ? `<div class="member-avatar" data-photo="${m.photo_url}" style="width:44px;height:44px;overflow:hidden;padding:0;cursor:zoom-in;"><img src="${m.photo_url}" style="width:100%;height:100%;object-fit:cover;"></div>`
          : `<div class="member-avatar" style="width:44px;height:44px;font-size:15px;">${av2(m.full_name||m.name)}</div>`}
        <div><div style="font-weight:600;font-size:var(--text-lg);color:var(--text-primary);">${name}</div>
        <div style="font-size:var(--text-sm);color:var(--text-tertiary);">${m.phone||''}</div></div>
      </div>
      <div class="form-group"><label class="form-label">Plan</label>
        <select class="form-input" id="renew-plan">${planOpts}</select></div>
      <div class="form-group"><label class="form-label">Renewal Date <span style="color:var(--text-quaternary);font-weight:400;font-size:11px;">(starts from)</span></label>
        <input type="date" class="form-input" id="renew-date" value="${todayISO}" max="${todayISO}"></div>
      <div class="form-group"><label class="form-label">Discount <span style="color:var(--text-quaternary);font-weight:400;font-size:11px;">(optional, ₹)</span></label>
        <input type="number" min="0" class="form-input" id="renew-discount" placeholder="0"></div>
      <div id="renew-summary" style="background:var(--surface-2);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:14px 16px;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-subtle);margin-bottom:8px;">
          <span style="color:var(--text-secondary);font-size:var(--text-sm);">Duration</span>
          <span id="renew-dur-label" style="font-weight:500;font-size:var(--text-sm);color:var(--text-primary);">${initDur} month${initDur>1?'s':''}</span></div>
        <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-subtle);margin-bottom:8px;">
          <span style="color:var(--text-secondary);font-size:var(--text-sm);">New expiry</span>
          <span id="renew-exp-label" style="font-weight:500;font-size:var(--text-sm);color:var(--green);">${fmtD(computeExp(initDur, todayISO))}</span></div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;">
          <span style="color:var(--text-secondary);font-size:var(--text-sm);">Total</span>
          <span id="renew-total-label" style="font-size:var(--text-xl);font-weight:700;color:var(--text-primary);font-variant-numeric:tabular-nums;">₹${initPrice.toLocaleString('en-IN')}</span></div>
      </div>
      <div style="margin-bottom:16px;">
        <label class="form-label">Add-ons <span style="color:var(--text-quaternary);font-weight:400;">(optional)</span></label>
        ${addonChips}
        <div id="renew-addons-list" style="margin-bottom:8px;"></div>
        <div style="display:flex;gap:8px;align-items:center;">
          <input id="renew-addon-name" type="text" placeholder="Custom add-on" class="form-input" style="flex:2;padding:7px 10px;font-size:var(--text-sm);">
          <input id="renew-addon-price" type="number" placeholder="₹" min="0" class="form-input" style="flex:1;padding:7px 10px;font-size:var(--text-sm);">
          <button id="renew-addon-add" class="btn btn-sm" style="background:var(--brand-fade);color:var(--brand-text);border:1px solid var(--brand-fade-strong);">+ Add</button>
        </div>
      </div>
      <div class="form-group"><label class="form-label">Payment Mode</label>
        <select class="form-input" id="renew-paymode"><option value="Cash" ${m.payment_mode==='Cash'?'selected':''}>Cash</option><option value="Card" ${m.payment_mode==='Card'?'selected':''}>Card</option><option value="Online" ${m.payment_mode==='Online'?'selected':''}>Online</option></select></div>
      <div class="form-group"><label class="form-label">Amount Paid Now (₹)</label>
        <input type="number" min="0" class="form-input" id="renew-paid-now" placeholder="0"></div>
      <div id="renew-balance-note" style="display:none;font-size:12px;color:var(--amber);padding:8px 12px;background:var(--amber-fade);border-radius:var(--radius-sm);margin-bottom:14px;"></div>
      <div style="font-size:var(--text-sm);color:var(--text-tertiary);padding:10px 12px;background:var(--surface-2);border-radius:var(--radius-md);line-height:1.5;">Sets join date to the selected renewal date. Payment status is set from the amount paid now. One-time fees (Admission) are not carried over.</div>
    </div>`,
    footer:`<button class="btn btn-ghost" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="renew-confirm-btn">Renew →</button>`,
    onOpen() {
      bindModalCancel();
      document.querySelector('[data-photo]')?.addEventListener('click', (e) => { e.stopPropagation(); openPhotoLightbox(e.currentTarget.dataset.photo); });
      let renewAddons=[];
      let renewBasePrice=initPrice;
      let renewDur=initDur;
      let paidNowTouched=false;

      function updateSummary(){
        const addonT=renewAddons.reduce((s,a)=>s+a.price,0);
        const discount=parseFloat(document.getElementById('renew-discount')?.value)||0;
        const tot=Math.max(0, renewBasePrice+addonT-discount);
        const dateEl=document.getElementById('renew-date');
        const baseISO=dateEl?.value||todayISO;
        const el1=document.getElementById('renew-dur-label');
        const el2=document.getElementById('renew-exp-label');
        const el3=document.getElementById('renew-total-label');
        if(el1)el1.textContent=`${renewDur} month${renewDur>1?'s':''}`;
        if(el2)el2.textContent=fmtD(computeExp(renewDur, baseISO));
        if(el3)el3.textContent=`₹${tot.toLocaleString('en-IN')}`;
        if(!paidNowTouched){const pEl=document.getElementById('renew-paid-now'); if(pEl) pEl.value = tot || '';}
        updateBalanceNote(tot);
      }
      function updateBalanceNote(tot){
        const total = tot != null ? tot : (parseFloat((document.getElementById('renew-total-label')?.textContent||'').replace(/[^0-9.]/g,''))||0);
        const paid  = parseFloat(document.getElementById('renew-paid-now')?.value) || 0;
        const bal   = Math.max(0, total - paid);
        const note  = document.getElementById('renew-balance-note');
        if (!note) return;
        if (bal > 0) { note.style.display='block'; note.textContent = `Balance of ₹${bal.toLocaleString('en-IN')} will remain due.`; }
        else note.style.display = 'none';
      }
      function renderAddonRows(){
        const list=document.getElementById('renew-addons-list');if(!list)return;
        if(renewAddons.length===0){list.innerHTML='';return;}
        list.innerHTML=renewAddons.map((a,i)=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--surface-3);border-radius:var(--radius-sm);margin-bottom:5px;gap:8px;">
          <span style="font-size:var(--text-sm);color:var(--text-primary);flex:1;">${a.name}</span>
          <span style="font-size:var(--text-sm);color:var(--green);font-weight:500;">+₹${a.price.toLocaleString('en-IN')}</span>
          <button onclick="window.__renewDelAddon(${i})" style="background:none;border:none;cursor:pointer;color:var(--text-tertiary);font-size:14px;padding:2px 4px;">✕</button>
        </div>`).join('');
      }
      window.__renewDelAddon=(i)=>{renewAddons.splice(i,1);renderAddonRows();updateSummary();};

      document.getElementById('renew-plan')?.addEventListener('change',(e)=>{
        const opt=e.target.selectedOptions[0];
        renewBasePrice=parseFloat(opt?.dataset.price||0);renewDur=parseInt(opt?.dataset.dur||1);updateSummary();
      });
      document.getElementById('renew-date')?.addEventListener('change',updateSummary);
      document.getElementById('renew-discount')?.addEventListener('input',updateSummary);
      document.getElementById('renew-paid-now')?.addEventListener('input',()=>{paidNowTouched=true;updateBalanceNote();});
      updateSummary();
      document.querySelectorAll('.renew-addon-chip').forEach(chip=>{
        chip.addEventListener('click',()=>{
          const n=chip.dataset.name;if(renewAddons.some(a=>a.name===n))return;
          renewAddons.push({name:n,price:parseFloat(chip.dataset.price)||0});
          chip.style.background='var(--brand-fade)';chip.style.borderColor='var(--brand)';chip.style.color='var(--brand-text)';
          renderAddonRows();updateSummary();
        });
      });
      function tryAdd(){
        const nEl=document.getElementById('renew-addon-name'),pEl=document.getElementById('renew-addon-price');
        const n=(nEl?.value||'').trim(),p=parseFloat(pEl?.value)||0;
        if(!n){if(nEl){nEl.style.borderColor='var(--red)';setTimeout(()=>nEl.style.borderColor='',1200);}return;}
        renewAddons.push({name:n,price:p});if(nEl)nEl.value='';if(pEl)pEl.value='';nEl?.focus();
        renderAddonRows();updateSummary();
      }
      document.getElementById('renew-addon-add')?.addEventListener('click',tryAdd);
      document.getElementById('renew-addon-name')?.addEventListener('keydown',e=>{if(e.key==='Enter')tryAdd();});
      document.getElementById('renew-addon-price')?.addEventListener('keydown',e=>{if(e.key==='Enter')tryAdd();});

      document.getElementById('renew-confirm-btn')?.addEventListener('click', async()=>{
        const planEl=document.getElementById('renew-plan');const paymodeEl=document.getElementById('renew-paymode');
        const dateEl=document.getElementById('renew-date');
        const renewISO=dateEl?.value||todayISO;
        const btn=document.getElementById('renew-confirm-btn');
        const selOpt=planEl?.selectedOptions[0];const selPlanId=planEl?.value;
        const selPlan=S.plans.find(p=>String(p.id)===selPlanId);
        const selPlanName=selPlan?.name||m.plan_name||m.plan;
        const baseP=parseFloat(selOpt?.dataset.price||0);const durN=parseInt(selOpt?.dataset.dur||1);
        const addonT=renewAddons.reduce((s,a)=>s+a.price,0);
        const discount=parseFloat(document.getElementById('renew-discount')?.value)||0;
        const totalP=Math.max(0, baseP+addonT-discount);
        let paidNow=parseFloat(document.getElementById('renew-paid-now')?.value);
        if(isNaN(paidNow)||paidNow<0)paidNow=0;
        if(paidNow>totalP)paidNow=totalP;
        const balanceDue=Math.max(0,totalP-paidNow);
        const newStatus = balanceDue<=0 ? 'Paid' : (paidNow<=0?'Due':'Partial');
        const selMode=paymodeEl?.value||'Cash';
        if(btn){btn.disabled=true;btn.textContent='Renewing…';}
        try{
          await updateMember(m.id,gymId,{fullName:m.full_name||m.name,phone:m.phone,email:m.email,
            dateOfBirth:m.date_of_birth,gender:m.gender,joinDate:renewISO,
            planId:selPlanId,planName:selPlanName,planPrice:totalP,planDurationMonths:durN,
            memberAddons:renewAddons.length>0?JSON.stringify(renewAddons):null,
            paymentMode:selMode,paymentStatus:newStatus,memberType:m.member_type||m.memberType||'Paid',notes:m.notes,
            discountAmount:discount,balanceDue:balanceDue});
          if(paidNow>0){
            supabase.from('payment_history').insert({gym_id:gymId,member_id:m.id,amount:paidNow,
              payment_mode:selMode,plan_id:selPlanId,plan_name:selPlanName,
              paid_at:renewISO+'T00:00:00',
              notes:renewAddons.length>0?`Addons: ${JSON.stringify(renewAddons)}`:'Membership renewal'})
              .then(({error:phErr})=>{if(phErr)console.warn('[Flym] payment_history insert failed:',phErr.message);})
              .catch(err=>console.warn('[Flym] payment_history insert failed:',err.message));
          }
          S.members=await getMembers(gymId);closeModal();
          _nav(S.section||'members');
          showToast(`${m.full_name||m.name} renewed!`,'green');
        }catch(err){if(btn){btn.disabled=false;btn.textContent='Renew →';}showToast(err.message||'Renewal failed','red');}
      });
    }
  });
}


// ════════════════════════════════════════════════════════════════
// FULL MEMBER DETAIL MODAL (click any row → see everything)
// ════════════════════════════════════════════════════════════════
function openMemberDetailModal(memberId) {
  const m = S.members.find(x => String(x.id) === String(memberId));
  if (!m) return;

  const plan    = S.plans.find(p => m.plan_id ? String(p.id) === String(m.plan_id) : p.name === (m.plan_name||m.plan));
  const memberAddons = parseMemberAddons(m);
  const exp     = expiryDate(m);
  const expStr  = exp ? exp.toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' }) : '—';
  const joinStr = m.join_date ? (() => { const [y,mo,d]=m.join_date.split('-').map(Number); return new Date(y,mo-1,d).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'}); })() : '—';
  const dobStr  = m.date_of_birth ? (() => { const [y,mo,d]=m.date_of_birth.split('-').map(Number); return new Date(y,mo-1,d).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'}); })() : null;
  const total   = parseFloat(m.plan_price) || 0;
  const days    = daysLeft(m);
  const daysStr = days===null ? '—' : days<0 ? `Expired ${Math.abs(days)}d ago` : days===0 ? 'Expires today' : `${days} days left`;
  const daysColor = days!==null && days<0 ? 'var(--red)' : days!==null && days<=7 ? 'var(--amber)' : 'var(--green)';
  const st      = memberStatus(m);
  const stBadge = {Active:'badge-green',Expiring:'badge-amber',Expired:'badge-red',Due:'badge-red',Trial:'badge-amber'}[st]||'badge-muted';
  const mType   = m.member_type||m.memberType||'Paid';
  const typeBadge = {Paid:'badge-blue',Unpaid:'badge-red',Trial:'badge-amber'}[mType]||'badge-blue';
  const av      = av2(m.full_name||m.name);

  openModal({
    title: 'Member Details',
    size: 'md',
    mobileCompact: true,
    body: `
      <!-- Header: avatar + name + badges -->
      <div style="display:flex;align-items:center;gap:14px;padding-bottom:16px;border-bottom:1px solid var(--border);margin-bottom:16px;">
        <div class="member-avatar" ${m.photo_url ? `data-photo="${m.photo_url}"` : ''} style="width:52px;height:52px;font-size:20px;flex-shrink:0;overflow:hidden;${m.photo_url?'padding:0;cursor:zoom-in;':''}">${m.photo_url ? `<img src="${m.photo_url}" style="width:100%;height:100%;object-fit:cover;">` : av}</div>
        <div style="min-width:0;">
          <div style="font-size:17px;font-weight:700;color:var(--white);margin-bottom:5px;">${escHtml(m.full_name||m.name)}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <span class="badge ${typeBadge}">${mType}</span>
            <span class="badge ${stBadge}">${st}</span>
            ${days!==null ? `<span style="font-size:12px;color:${daysColor};font-weight:500;">${daysStr}</span>` : ''}
          </div>
        </div>
      </div>

      <!-- Contact info -->
      <div style="margin-bottom:16px;">
        <div style="font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:10px;">Contact</div>
        ${mRow('📞 Phone',  m.phone ? `<a href="tel:${m.phone}" style="color:var(--blue-light);text-decoration:none;">${escHtml(m.phone)}</a>` : '—')}
        ${m.email ? mRow('✉️ Email', `<a href="mailto:${m.email}" style="color:var(--blue-light);text-decoration:none;">${escHtml(m.email)}</a>`) : ''}
        ${m.gender ? mRow('👤 Gender', escHtml(m.gender)) : ''}
        ${dobStr   ? mRow('🎂 Date of Birth', dobStr) : ''}
      </div>

      <!-- Membership -->
      <div style="margin-bottom:16px;">
        <div style="font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:10px;">Membership</div>
        ${mRow('📦 Plan',      escHtml(m.plan_name||m.plan||'—'))}
        ${plan ? mRow('⏱ Duration', (plan.duration_months||plan.duration)+' month'+ ((plan.duration_months||plan.duration)>1?'s':'')) : ''}
        ${mRow('📅 Join Date',  joinStr)}
        ${mRow('📅 Expiry',     `<span style="color:${daysColor};font-weight:500;">${expStr}</span>`)}
        ${mType==='Trial' && m.trial_days ? mRow('🔖 Trial Days', m.trial_days+' days') : ''}
      </div>

      <!-- Payment -->
      <div style="margin-bottom:16px;">
        <div style="font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:10px;">Payment</div>
        ${mRow('💰 Plan Price', total>0 ? `<strong style="color:var(--white);">₹${Number(total).toLocaleString('en-IN')}</strong>` : '—')}
        ${mRow('💳 Mode',       escHtml(m.payment_mode||m.payMode||'—'))}
        ${mRow('✅ Status',     escHtml(m.payment_status||m.status||'—'))}
        ${parseFloat(m.discount_amount)>0 ? mRow('🏷️ Discount', `<span style="color:var(--green);">−₹${Number(m.discount_amount).toLocaleString('en-IN')}</span>`) : ''}
        ${parseFloat(m.balance_due)>0 ? mRow('⚠️ Balance Due', `<span style="color:var(--red);font-weight:700;">₹${Number(m.balance_due).toLocaleString('en-IN')}</span>`) : ''}
        ${memberAddons.length ? mRow('➕ Add-ons', memberAddons.map(a=>`${escHtml(a.name)} <span style="color:var(--muted);">+₹${Number(a.price).toLocaleString('en-IN')}</span>`).join(' · ')) : ''}
      </div>

      ${m.notes ? `
      <div style="background:var(--bg2);border-radius:8px;padding:12px 14px;font-size:13px;color:var(--muted);line-height:1.6;">
        <span style="color:var(--muted2);font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;display:block;margin-bottom:4px;">Notes</span>
        <span style="white-space:pre-wrap;">${escHtml(m.notes)}</span>
      </div>` : ''}`,
    footer: `
      <button class="btn btn-ghost"         id="modal-cancel"           style="flex:1;">Close</button>
      <button class="btn btn-ghost"         id="md-edit-btn"            style="flex:1;">✏️ Edit</button>
      ${m.cancelled_at
        ? `<button class="btn" id="md-cancelmem-btn" style="flex:1;background:var(--green-fade);color:var(--green);border:1px solid var(--green-strong);">🔄 Reactivate</button>`
        : `<button class="btn" id="md-cancelmem-btn" style="flex:1;background:var(--surface-3);color:var(--text-secondary);border:1px solid var(--border-default);">🚫 Cancel</button>`}
      ${parseFloat(m.balance_due)>0 ? `<button class="btn" id="md-bal-btn" style="flex:1;background:var(--amber-fade);color:var(--amber);border:1px solid var(--amber-strong);">💵 Clear Balance</button>` : ''}
      <button class="btn btn-success-soft"  id="md-wa-btn"              style="flex:1;">📱 Remind</button>
      <button class="btn btn-primary"       id="md-inv-btn"             style="flex:1;">🧾 Invoice</button>`,
    onOpen: () => {
      bindModalCancel();
      document.querySelector('[data-photo]')?.addEventListener('click', (e) => { e.stopPropagation(); openPhotoLightbox(e.currentTarget.dataset.photo); });
      document.getElementById('md-edit-btn')?.addEventListener('click', () => { closeModal(); openEditModal(memberId); });
      document.getElementById('md-cancelmem-btn')?.addEventListener('click', () => { closeModal(); confirmCancelMembership(memberId); });
      document.getElementById('md-bal-btn')?.addEventListener('click',  () => { closeModal(); openClearBalanceModal(memberId); });
      document.getElementById('md-wa-btn')?.addEventListener('click',   () => { closeModal(); openWAModal(memberId); });
      document.getElementById('md-inv-btn')?.addEventListener('click',  () => { closeModal(); openInvoiceModal(memberId); });
    }
  });
}

// Small helper for modal detail rows
function mRow(label, value) {
  if (!value || value === '—') return '';
  return `<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:0.5px solid var(--border);">
    <span style="font-size:12px;color:var(--muted);flex-shrink:0;min-width:110px;">${label}</span>
    <span style="font-size:13px;color:var(--white);text-align:right;font-weight:500;word-break:break-word;">${value}</span>
  </div>`;
}

// ════════════════════════════════════════════════════════════════
// CLEAR BALANCE MODAL — settle outstanding due (partial or full)
// ════════════════════════════════════════════════════════════════
function openClearBalanceModal(id) {
  const m = S.members.find(x => String(x.id) === String(id));
  if (!m) return;
  const balance = parseFloat(m.balance_due) || 0;
  if (balance <= 0) { showToast('No balance due for this member', 'amber'); return; }

  openModal({
    title: 'Clear Balance',
    size: 'sm',
    body: `
      <div style="text-align:center;padding:4px 0 14px;">
        <div style="font-size:13px;color:var(--text-tertiary);margin-bottom:4px;">Balance Due</div>
        <div style="font-size:28px;font-weight:700;color:var(--red);">₹${balance.toLocaleString('en-IN')}</div>
      </div>
      <div class="form-group"><label class="form-label">Amount Received Now (₹)</label>
        <input class="form-input" id="cb-amount" type="number" min="1" max="${balance}" value="${balance}"></div>
      <div class="form-group"><label class="form-label">Payment Mode</label>
        <select class="form-input" id="cb-paymode">
          <option value="Online" ${m.payment_mode!=='Cash'&&m.payment_mode!=='Card'?'selected':''}>Online</option>
          <option value="Card" ${m.payment_mode==='Card'?'selected':''}>Card</option>
          <option value="Cash" ${m.payment_mode==='Cash'?'selected':''}>Cash</option>
        </select></div>
      <div id="cb-error" style="display:none;color:var(--red);font-size:13px;
           background:rgba(255,77,77,0.08);border:1px solid rgba(255,77,77,0.3);
           padding:10px 13px;border-radius:2px;"></div>
    `,
    footer: `<button class="btn btn-ghost" data-modal-cancel>Cancel</button>
      <button class="btn btn-primary" id="cb-confirm">Clear Balance →</button>`,
    onOpen: () => {
      bindModalCancel();
      document.getElementById('cb-confirm')?.addEventListener('click', async () => {
        const btn = document.getElementById('cb-confirm');
        const errEl = document.getElementById('cb-error');
        errEl.style.display = 'none';
        const amount = parseFloat(document.getElementById('cb-amount')?.value);
        const mode   = document.getElementById('cb-paymode')?.value || 'Online';
        if (isNaN(amount) || amount <= 0) { errEl.textContent='Enter an amount greater than zero.'; errEl.style.display='block'; return; }
        if (amount > balance) { errEl.textContent=`Cannot exceed balance due (₹${balance.toLocaleString('en-IN')}).`; errEl.style.display='block'; return; }
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          const saved = await clearBalance(id, S.gym.id, amount, mode);
          const idx = S.members.findIndex(x => String(x.id) === String(id));
          if (idx > -1) S.members[idx] = { ...S.members[idx], ...saved };
          closeModal();
          _nav(S.section || 'members');
          showToast(`₹${amount.toLocaleString('en-IN')} payment recorded!`, 'green');
        } catch (err) {
          errEl.textContent = err.message || 'Failed to record payment.';
          errEl.style.display = 'block';
          btn.disabled = false; btn.textContent = 'Clear Balance →';
        }
      });
    }
  });
}

window._clearBal = openClearBalanceModal;

// ════════════════════════════════════════════════════════════════
// WHATSAPP REMINDER MODAL
// ════════════════════════════════════════════════════════════════
function openWAModal(id) {
  const m = S.members.find(x=>String(x.id)===String(id));
  if (!m) return;
  const exp    = expiryDate(m);
  const expStr = exp ? exp.toLocaleDateString('en-IN') : 'soon';
  const gym    = S.gym?.name || 'our gym';

  // Use saved template if available, otherwise use the default
  const tpl = S.gym?.wa_template || DEFAULT_WA_TEMPLATE;
  const memberAddons = parseMemberAddons(m);
  const addonStr = memberAddons.length ? '\n➕ Add-ons: ' + memberAddons.map(a => `${a.name} (+₹${Number(a.price).toLocaleString('en-IN')})`).join(', ') : '';
  const msg = (tpl
    .replace(/\{name\}/g,  m.full_name || m.name || '')
    .replace(/\{plan\}/g,  m.plan_name || m.plan || 'membership')
    .replace(/\{gym\}/g,   gym)
    .replace(/\{date\}/g,  expStr)) + addonStr;

  openModal({
    title: 'Send WhatsApp Reminder',
    mobileCompact: true,
    body: `
      <div class="form-group"><label class="form-label">Member</label>
        <input class="form-input" value="${m.full_name||m.name}" readonly></div>
      <div class="form-group"><label class="form-label">Phone</label>
        <input class="form-input" id="wa-phone" value="${m.phone||''}"></div>
      <div class="form-group"><label class="form-label">Message</label>
        <textarea class="form-input" id="wa-msg" rows="7" style="resize:vertical;">${msg}</textarea></div>
    `,
    footer: `<button class="btn btn-ghost" id="modal-cancel">Cancel</button>
      <button class="btn" id="wa-send" style="background:rgba(0,230,118,0.15);color:var(--green);
        border:1px solid rgba(0,230,118,0.3);">📱 Open WhatsApp</button>`,
    onOpen: () => {
      bindModalCancel();
      document.getElementById('wa-send').addEventListener('click', async () => {
        const phone = document.getElementById('wa-phone').value.replace(/\D/g,'');
        const text  = document.getElementById('wa-msg').value;
        if (!phone) { showToast('Enter phone number','red'); return; }
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
        if (S.gym?.id) await logReminder(S.gym.id, id, text).catch(()=>{});
        closeModal(); showToast('WhatsApp opened!','green');
      });
    }
  });
}

// ════════════════════════════════════════════════════════════════
// INVOICE MODAL  — NEW FEATURE
// ════════════════════════════════════════════════════════════════
function buildInvoiceHTML(m, gymName) {
  const exp     = expiryDate(m);
  const expStr  = exp ? exp.toLocaleDateString('en-IN') : '—';
  const invoiceNo = genInvoiceNo();
  const dateStr   = new Date().toLocaleDateString('en-IN', {day:'2-digit',month:'2-digit',year:'numeric'});
  const joinStr   = m.join_date ? fmtDate(m.join_date) : '—';

  // Parse addons from the member (per-member addons)
  const memberAddons = parseMemberAddons(m);
  const basePlan = S.plans.find(p => m.plan_id ? String(p.id)===String(m.plan_id) : p.name===(m.plan_name||m.plan));
  const basePlanPrice = basePlan ? parseFloat(basePlan.price) : (parseFloat(m.plan_price) || 0);
  const addonTotal = memberAddons.reduce((s,a) => s + (parseFloat(a.price)||0), 0);
  const totalPrice = basePlanPrice + addonTotal;

  const planRow = `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #eee;">
            <div style="font-weight:600;color:#222;">${escHtml((m.plan_name||m.plan||'Membership Plan').toUpperCase())}</div>
            ${exp ? `<div style="font-size:11px;color:#888;margin-top:2px;">From ${joinStr} till ${expStr}</div>` : ''}
          </td>
          <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;vertical-align:top;">₹${Number(basePlanPrice).toLocaleString('en-IN')}</td>
        </tr>`;
  const addonRows = memberAddons.length
    ? memberAddons.map(a => `
        <tr>
          <td style="padding:8px 0;color:#555;border-bottom:1px solid #eee;">${escHtml(a.name)}</td>
          <td style="padding:8px 0;text-align:right;border-bottom:1px solid #eee;">₹${Number(a.price).toLocaleString('en-IN')}</td>
        </tr>`).join('')
    : '';

  // Discount + balance (member-level, set at Add/Edit/Renew or via Clear Balance)
  const discount   = parseFloat(m.discount_amount) || 0;
  const netTotal   = Math.max(0, totalPrice - discount);
  const balanceDue = parseFloat(m.balance_due) || 0;
  const amountPaid = Math.max(0, netTotal - balanceDue);
  const gstOn = !!S.gym?.gst_enabled;

  let gstRows = '';
  if (gstOn) {
    const base   = netTotal / 1.18;
    const gstAmt = netTotal - base;
    gstRows = `
        <tr><td style="padding:6px 0;color:#666;">CGST @ 9%</td><td style="padding:6px 0;text-align:right;color:#666;">₹${(gstAmt/2).toLocaleString('en-IN',{maximumFractionDigits:2})}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">SGST @ 9%</td><td style="padding:6px 0;text-align:right;color:#666;">₹${(gstAmt/2).toLocaleString('en-IN',{maximumFractionDigits:2})}</td></tr>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Receipt ${invoiceNo} — ${escHtml(m.full_name||m.name)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#222;background:#fff;}
    .page{max-width:620px;margin:0 auto;padding:36px 40px;}
    .header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:22px;}
    .header-logo img{max-width:160px;max-height:60px;width:auto;height:auto;object-fit:contain;}
    .header-info{text-align:right;}
    .gym-name{font-size:17px;font-weight:700;color:#111;}
    .gym-sub{font-size:11.5px;color:#777;margin-top:2px;line-height:1.5;}
    .receipt-title{font-size:21px;font-weight:700;color:#2A8FFF;margin-bottom:16px;}
    .bill-bar{background:#1E6FCC;color:#fff;border-radius:6px;padding:14px 18px;
      display:flex;justify-content:space-between;flex-wrap:wrap;gap:14px;margin-bottom:22px;}
    .bill-bar-label{font-size:10px;text-transform:uppercase;letter-spacing:.1em;opacity:.85;margin-bottom:4px;}
    .bill-bar-name{font-size:14px;font-weight:700;}
    .bill-bar-sub{font-size:11.5px;opacity:.9;margin-top:2px;}
    .bill-bar-meta{text-align:right;font-size:12px;line-height:1.7;}
    .purchase-table{width:100%;border-collapse:collapse;margin-bottom:18px;}
    .purchase-table th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;
      color:#999;padding-bottom:8px;border-bottom:2px solid #222;font-weight:600;}
    .purchase-table th:last-child{text-align:right;}
    .purchase-table .sum-row td{padding:7px 0;color:#444;}
    .purchase-table .sum-row td:last-child{text-align:right;}
    .purchase-table .grand-row td{padding-top:12px;border-top:2px solid #111;font-weight:700;font-size:15px;}
    .purchase-table .grand-row td:last-child{text-align:right;color:#2A8FFF;}
    .pm-block{background:#f9fafb;border-radius:6px;padding:12px 16px;margin-bottom:18px;font-size:12.5px;}
    .pm-title{font-weight:700;color:#333;margin-bottom:4px;}
    .terms-block{font-size:11px;color:#888;line-height:1.8;margin-bottom:20px;}
    .terms-title{font-weight:700;color:#666;margin-bottom:6px;font-size:11.5px;}
    .footer{text-align:center;padding-top:18px;border-top:1px solid #eee;color:#999;font-size:11px;line-height:1.8;}
    @media print{
      body{padding:0;}
      .page{padding:22px 26px;max-width:100%;}
      .no-print{display:none!important;}
    }
  </style>
</head>
<body>
<div class="page">
  <!-- Header -->
  <div class="header">
    <div class="header-logo">${S.gym?.logo_url ? `<img src="${S.gym.logo_url}">` : `<div class="gym-name">${escHtml(gymName)}</div>`}</div>
    <div class="header-info">
      <div class="gym-name">${escHtml(gymName)}</div>
      ${S.gym?.address ? `<div class="gym-sub">${escHtml(S.gym.address)}${S.gym?.city ? ', '+escHtml(S.gym.city) : ''}</div>` : ''}
      ${(S.gym?.phone || S.gym?.phone2) ? `<div class="gym-sub">Phone: ${[S.gym?.phone, S.gym?.phone2].filter(Boolean).map(escHtml).join(' / ')}</div>` : ''}
      ${S.gym?.email ? `<div class="gym-sub">Email: ${escHtml(S.gym.email)}</div>` : ''}
      ${gstOn && S.gym?.gstin ? `<div class="gym-sub">GSTIN:- ${escHtml(S.gym.gstin)}</div>` : ''}
    </div>
  </div>

  <div class="receipt-title">Payment Receipt</div>

  <!-- Bill To bar -->
  <div class="bill-bar">
    <div>
      <div class="bill-bar-label">Bill To</div>
      <div class="bill-bar-name">${escHtml(m.full_name||m.name)}</div>
      ${m.phone ? `<div class="bill-bar-sub">${escHtml(m.phone)}</div>` : ''}
    </div>
    <div class="bill-bar-meta">
      <div>Bill Number: ${invoiceNo}</div>
      <div>Bill Date: ${dateStr}</div>
      <div>Receipt Type: Membership Payment</div>
    </div>
  </div>

  <!-- Purchase Details -->
  <table class="purchase-table">
    <thead><tr><th>Purchase Details</th><th>Amount</th></tr></thead>
    <tbody>
      ${planRow}
      ${addonRows}
      <tr class="sum-row"><td>Sub-Total</td><td>₹${Number(totalPrice).toLocaleString('en-IN')}</td></tr>
      ${discount>0 ? `<tr class="sum-row"><td>Discount</td><td>−₹${discount.toLocaleString('en-IN')}</td></tr>` : ''}
      ${gstRows}
      <tr class="grand-row"><td>Grand Total</td><td>₹${Number(netTotal).toLocaleString('en-IN')}</td></tr>
      <tr class="sum-row"><td>Paid Amount</td><td>₹${amountPaid.toLocaleString('en-IN')}</td></tr>
      <tr class="sum-row"><td>Due Amount</td><td style="${balanceDue>0?'color:#dc2626;font-weight:700;':''}">₹${balanceDue.toLocaleString('en-IN')}</td></tr>
    </tbody>
  </table>

  <!-- Payment mode -->
  <div class="pm-block">
    <div class="pm-title">Payment Mode Details</div>
    <div>${escHtml(m.payment_mode||m.payMode||'—')}: ₹${amountPaid.toLocaleString('en-IN')}</div>
  </div>

  <!-- Terms -->
  <div class="terms-block">
    <div class="terms-title">Terms &amp; Conditions</div>
    <div>• This receipt is issued on payment and is non-refundable.</div>
    <div>• Please retain this receipt for any future reference or dispute.</div>
    <div>• Membership is subject to the gym's rules and conditions displayed on the premises.</div>
  </div>

  <!-- Footer -->
  <div class="footer">
    <div>Thank you for choosing <strong>${escHtml(gymName)}</strong>! 💪</div>
    <div style="margin-top:4px;color:#bbb;">— ${escHtml(gymName)} Team</div>
  </div>
</div>
</body>
</html>`;
}

function buildWhatsAppText(m, gymName) {
  const exp     = expiryDate(m);
  const expStr  = exp ? exp.toLocaleDateString('en-IN') : '—';
  const joinStr = m.join_date ? fmtDate(m.join_date) : '—';
  const memberAddons = parseMemberAddons(m);
  const addonLine = memberAddons.length
    ? `✅ Add-ons: ${memberAddons.map(a => `${a.name} (+₹${Number(a.price).toLocaleString('en-IN')})`).join(', ')}\n`
    : '';
  const balanceDue  = parseFloat(m.balance_due) || 0;
  const amountPaid  = Math.max(0, (memberTotal(m)||0) - balanceDue);
  const balanceLine = balanceDue > 0 ? `✅ Balance Due: ₹${balanceDue.toLocaleString('en-IN')}\n` : '';
  const phoneLine   = S.gym?.phone ? [S.gym.phone, S.gym.phone2].filter(Boolean).join(' / ') : null;

  return `Hi ${m.full_name||m.name} 👋

Thanks for being part of the ${gymName} family! Here's a quick summary of your membership:

✅ Plan: ${m.plan_name||m.plan||'—'}
✅ Amount Paid: ₹${amountPaid.toLocaleString('en-IN')}
${balanceLine}✅ Start Date: ${joinStr}
✅ End Date: ${expStr}
${addonLine}
${phoneLine ? `If you have any questions, feel free to reach us at ${phoneLine}.\n` : ''}Keep showing up — see you at the gym! 💪

Stay Strong,
${gymName}`;
}

function openInvoiceModal(id) {
  const m   = S.members.find(x=>String(x.id)===String(id));
  if (!m) return;
  const gym = S.gym?.name || 'Flym Gym';
  const price = memberTotal(m) > 0 ? `₹${Number(memberTotal(m)).toLocaleString('en-IN')}` : '—';

  openModal({
    title: '🧾 Invoice / Bill',
    size: 'md',
    mobileCompact: true,
    body: `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;
           padding:14px 16px;background:var(--bg2);border-radius:var(--radius-sm);">
        <div class="member-avatar">${av2(m.full_name||m.name)}</div>
        <div>
          <div style="font-weight:600;font-size:15px;">${escHtml(m.full_name||m.name)}</div>
          <div style="font-size:12px;color:var(--muted);">${escHtml(m.plan_name||m.plan||'—')} · ${price}</div>
        </div>
        <span class="badge badge-green ml-auto">Ready</span>
      </div>
      <div style="font-size:13px;color:var(--muted);padding:12px 14px;background:var(--bg2);border-radius:var(--radius-sm);">
        Use <strong style="color:var(--white);">🖨️ Print / PDF</strong> for a professional invoice. 
        Use <strong style="color:var(--green);">📱 WhatsApp</strong> to send as a text message.
      </div>
    `,
    footer: `
      <div style="display:flex;gap:8px;flex-wrap:wrap;width:100%;">
        <button class="btn btn-ghost" id="modal-cancel" style="flex:1;min-width:70px;">Close</button>
        <button class="btn btn-ghost" id="inv-copy" style="flex:1;min-width:80px;">📋 Copy</button>
        <button class="btn btn-primary" id="inv-print" style="flex:1;min-width:120px;">🖨️ Print / PDF</button>
        <button class="btn" id="inv-wa" style="flex:1;min-width:120px;background:rgba(0,230,118,0.15);color:var(--green);border:1px solid rgba(0,230,118,0.3);">📱 WhatsApp</button>
      </div>
    `,
    onOpen: () => {
      bindModalCancel();
      document.getElementById('inv-copy').addEventListener('click', () => {
        navigator.clipboard.writeText(buildWhatsAppText(m, gym));
        showToast('Invoice copied!','green');
      });
      document.getElementById('inv-print').addEventListener('click', () => {
        showPrintPreview('Receipt Preview', buildInvoiceHTML(m, gym));
      });
      document.getElementById('inv-wa').addEventListener('click', () => {
        const phone = m.phone?.replace(/\D/g,'');
        if (!phone) { showToast('No phone number for this member','red'); return; }
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(buildWhatsAppText(m, gym))}`, '_blank');
        closeModal(); showToast('WhatsApp opened!','green');
      });
    }
  });
}


export { openAddModal, submitAdd, openEditModal, confirmDelete, confirmCancelMembership, openRenewModal, openMemberDetailModal, openWAModal, buildInvoiceHTML, buildWhatsAppText, openInvoiceModal, openClearBalanceModal };
