import { S, DEFAULT_WA_TEMPLATE } from './state.js';
import { expiryDate, daysLeft, memberStatus, escHtml, fmtDate, av2, bindDateInput, fmtDateInput, parseDateInput, parseMemberAddons, planTotalPrice, genInvoiceNo, memberTotal, parsePlanData, todayLocalISO } from './helpers.js';
import { getMembers, getPaymentHistory, addMember, updateMember, deleteMember, logReminder, clearBalance, renewMember, cancelMembership, reactivateMembership, checkDuplicatePhone, generateMemberId, findMemberById } from '../../lib/members.js';
import { showToast } from '../../components/toast.js';
import { openModal, closeModal, modalFooter, bindModalCancel } from '../../components/modal.js';
import { supabase } from '../../lib/supabase.js';
import { pickPhoto, pickAadharCard } from '../../components/photo-picker.js';
import { showPrintPreview } from '../../components/print-preview.js';
import { openPhotoLightbox } from '../../components/photo-lightbox.js';
import { showConfirm } from '../../components/confirm.js';
import { removeMemberPhoto, saveAadharPhoto, removeAadharPhoto } from './photo.js';
import { generateInvoicePdfBlob } from '../../lib/invoice-pdf.js';
import { uploadInvoicePdf } from '../../lib/invoices.js';
import { hasAccess } from '../../lib/permissions.js';

let _nav, _saveMemberPhoto;
export function setNavHandler(fn) { _nav = fn; }
export function setPhotoHandler(fn) { _saveMemberPhoto = fn; }

function openAddModal() {
  const today = new Date().toISOString().split('T')[0];
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

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Aadhar ID <span style="color:var(--muted);font-weight:400;font-size:11px;">(optional)</span></label>
          <input class="form-input" id="m-aadhar" placeholder="e.g. 1234 5678 9012" maxlength="14"
            oninput="let d=this.value.replace(/\D/g,'').slice(0,12);this.value=d.replace(/(\d{4})(?=\d)/g,'$1 ');"
            inputmode="numeric">
        </div>
        <div class="form-group">
          <label class="form-label">Application No. <span style="color:var(--muted);font-weight:400;font-size:11px;">(optional)</span></label>
          <input class="form-input" id="m-appnum" placeholder="e.g. 001, A-101">
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

  // ── Duplicate phone check (Feature 3) ──
  if (rawPhone && S.gym?.id) {
    try {
      const dupName = await checkDuplicatePhone(S.gym.id, rawPhone);
      if (dupName) {
        show(`This phone number is already registered to ${dupName}. Cannot add duplicate.`);
        return;
      }
    } catch (e) {
      console.warn('[Flym] Duplicate phone check failed:', e.message);
      // Non-blocking — allow save if the check itself errors
    }
  }

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
    applicationNumber: document.getElementById('m-appnum')?.value.trim()||null,
    aadharNumber:     document.getElementById('m-aadhar')?.value.replace(/\s/g,'')||null,
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

  // Generate client-side UUID as idempotency key — if the request times out
  // but the server committed, retrying won't create duplicates (PK conflict).
  const clientId = generateMemberId();
  data._clientId = clientId;

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
    // Always refresh from DB to get latest state (members + payment history)
    try { S.members = await getMembers(S.gym.id); } catch(e) { /* use local */ }
    try { S.payHistory = await getPaymentHistory(S.gym.id); } catch(e) { /* best-effort */ }
    closeModal();
    _nav('members');
    if (saved._paymentRecorded === false) {
      showToast(`${name} added but payment record failed — check Finance page`, 'amber');
    } else {
      showToast(`${name} added as ${mType} member!`, 'green');
    }
  } catch (err) {
    // ── Orphan detection ──────────────────────────────────────────
    // If the error is a network timeout, the member may have been
    // created on the server. Check by looking up the client-generated
    // UUID. If found, treat as success (connection was slow, not failed).
    const gymId = S.gym?.id;
    if (gymId) {
      btn.textContent = 'Checking…';
      try {
        const orphan = await findMemberById(gymId, clientId);
        if (orphan) {
          // Member WAS created — the error was just a network timeout.
          console.warn(`[Flym] Orphan detected: member ${clientId} exists despite network error`);
          try { S.members = await getMembers(gymId); } catch(_) {}
          try { S.payHistory = await getPaymentHistory(gymId); } catch(_) {}
          closeModal();
          _nav('members');
          showToast(`${name} added (connection was slow)`, 'green');
          return;
        }
      } catch (_) {
        // Orphan check itself failed (still no network) — fall through to error
      }
    }
    show(err.message || 'Something went wrong. Please check your connection and try again.');
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
    title: `Edit — ${escHtml(m.full_name||m.name||'')}`,
    size: 'lg',
    mobileCompact: true,
    body: `
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
        <div id="e-photo-preview" style="width:60px;height:60px;border-radius:50%;background:var(--surface-3);
             display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;
             border:${m.photo_url ? 'none' : '2px dashed var(--border-default)'};flex-shrink:0;">
          ${m.photo_url
            ? `<img src="${escHtml(m.photo_url)}" alt="" style="width:100%;height:100%;object-fit:cover;">`
            : `<span style="font-size:10px;color:var(--text-tertiary);text-align:center;line-height:1.2;">Add<br>Photo</span>`}
        </div>
        <div>
          <div style="font-size:12px;color:var(--text-quaternary);">Tap to change photo</div>
          ${m.photo_url ? `<button type="button" id="e-photo-remove" style="background:none;border:none;color:var(--red);font-size:11px;cursor:pointer;padding:2px 0;margin-top:2px;">Remove photo</button>` : ''}
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Full Name *</label>
          <input class="form-input" id="e-name" value="${escHtml(m.full_name||m.name||'')}"></div>
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
        <div class="form-group"><label class="form-label">Date of Birth</label>
          <input class="form-input date-input" id="e-dob" placeholder="DD/MM/YYYY" maxlength="10" autocomplete="off" value="${m.date_of_birth ? fmtDateInput(m.date_of_birth) : ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Join Date</label>
          <input class="form-input date-input" id="e-join" placeholder="DD/MM/YYYY" maxlength="10" autocomplete="off" value="${m.join_date ? fmtDateInput(m.join_date) : ''}"></div>
        <div class="form-group"><label class="form-label">Gender</label>
          <select class="form-input filter-select" id="e-gender" style="width:100%;color:var(--white);">
            <option value="">Select</option>
            <option ${m.gender==='Male'?'selected':''}>Male</option>
            <option ${m.gender==='Female'?'selected':''}>Female</option>
            <option ${m.gender==='Other'?'selected':''}>Other</option>
          </select></div>
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
      <div class="form-row">
        <div class="form-group"><label class="form-label">Aadhar ID <span style="color:var(--muted);font-weight:400;font-size:11px;">(optional)</span></label>
          <input class="form-input" id="e-aadhar" placeholder="e.g. 1234 5678 9012" maxlength="14"
            oninput="let d=this.value.replace(/\D/g,'').slice(0,12);this.value=d.replace(/(\d{4})(?=\d)/g,'$1 ');"
            inputmode="numeric"
            value="${escHtml(m.aadhar_number ? m.aadhar_number.replace(/(\d{4})(?=\d)/g,'$1 ') : '')}"></div>
        <div class="form-group"><label class="form-label">Application No. <span style="color:var(--muted);font-weight:400;font-size:11px;">(optional)</span></label>
          <input class="form-input" id="e-appnum" value="${escHtml(m.application_number||'')}"></div>
      </div>
      <div class="form-group"><label class="form-label">Notes</label>
        <input class="form-input" id="e-notes" value="${escHtml(m.notes||'')}"></div>

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

      // Remove photo handler
      let photoRemoved = false;
      document.getElementById('e-photo-remove')?.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const ok = await showConfirm({
          title: 'Remove photo?',
          message: `This will delete the photo from storage. You can add a new one anytime.`,
          confirmLabel: 'Remove',
          confirmVariant: 'danger',
        });
        if (!ok) return;
        try {
          if (m.id && S.gym?.id) {
            await removeMemberPhoto(S.gym.id, m.id);
            m.photo_url = null;
            const idx = S.members.findIndex(x => String(x.id) === String(m.id));
            if (idx > -1) S.members[idx].photo_url = null;
          }
          photoRemoved = true;
          pendingEditPhotoDataUrl = null;
          const preview = document.getElementById('e-photo-preview');
          if (preview) {
            preview.style.border = '2px dashed var(--border-default)';
            preview.innerHTML = `<span style="font-size:10px;color:var(--text-tertiary);text-align:center;line-height:1.2;">Add<br>Photo</span>`;
          }
          document.getElementById('e-photo-remove')?.remove();
          showToast('Photo removed', 'green');
        } catch (err) { showToast(err.message || 'Failed to remove photo', 'red'); }
      });

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

        // ── Duplicate phone check on edit (Feature 3) ──
        // Only check if phone changed from the original
        const originalPhone = (m.phone||'').replace(/^\+?91/,'').trim();
        if (rawPhone && rawPhone !== originalPhone && S.gym?.id) {
          try {
            const dupName = await checkDuplicatePhone(S.gym.id, rawPhone, m.id);
            if (dupName) {
              errEl.textContent = `This phone number is already registered to ${dupName}. Cannot save duplicate.`;
              errEl.style.display = 'block';
              return;
            }
          } catch (e) {
            console.warn('[Flym] Duplicate phone check failed:', e.message);
          }
        }

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
          dateOfBirth:         parseDateInput(document.getElementById('e-dob')?.value)||null,
          gender:              document.getElementById('e-gender')?.value||null,
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
          applicationNumber:   document.getElementById('e-appnum')?.value.trim()||null,
          aadharNumber:        document.getElementById('e-aadhar')?.value.replace(/\s/g,'')||null,
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
  const role = S.role || 'owner';
  if (!hasAccess(role, 'delete_member')) {
    showToast('You do not have permission to remove members', 'red');
    return;
  }
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
  const role = S.role || 'owner';
  if (!hasAccess(role, 'cancel_member')) {
    showToast('You do not have permission to cancel memberships', 'red');
    return;
  }
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
  const todayISO = todayLocalISO();

  function computeExp(months, baseISO){
    const base = baseISO || todayISO;
    const [y, mo, da] = base.split('-').map(Number);
    const d = new Date(y, mo - 1, da);
    d.setMonth(d.getMonth() + (parseInt(months) || 1));
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
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
          ? `<div class="member-avatar" style="width:44px;height:44px;overflow:hidden;padding:0;"><img src="${escHtml(m.photo_url)}" alt="" style="width:100%;height:100%;object-fit:cover;"></div>`
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
          // renewMember() does the member update + the payment row in ONE
          // transaction (migration 033), so a dropped connection can no
          // longer extend a membership without recording the money.
          const renewed = await renewMember(m.id, gymId, {
            fullName:m.full_name||m.name, phone:m.phone, email:m.email,
            dateOfBirth:m.date_of_birth, gender:m.gender, joinDate:renewISO,
            planId:selPlanId, planName:selPlanName, planPrice:totalP, planDurationMonths:durN,
            memberAddons:renewAddons.length>0?JSON.stringify(renewAddons):null,
            paymentMode:selMode, paymentStatus:newStatus,
            memberType:m.member_type||m.memberType||'Paid', notes:m.notes,
            discountAmount:discount, balanceDue:balanceDue,
            amountPaid:paidNow,
            paymentNotes:renewAddons.length>0?`Addons: ${JSON.stringify(renewAddons)}`:'Membership renewal',
            wasCancelled:!!m.cancelled_at,
          });
          const renewPaymentOk = renewed._paymentRecorded !== false;
          S.members=await getMembers(gymId);
          try{S.payHistory=await getPaymentHistory(gymId);}catch(e){/* best-effort */}
          closeModal();
          _nav(S.section||'members');
          if(!renewPaymentOk){showToast(`${m.full_name||m.name} renewed but payment record failed — check Finance`,'amber');}
          else{showToast(`${m.full_name||m.name} renewed!`,'green');}
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
  const pd      = plan ? parsePlanData(plan) : { featuresList: '' };
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
  const stBadge = {Active:'badge-green',Expiring:'badge-amber',Expired:'badge-red',Due:'badge-red',Partial:'badge-amber',Trial:'badge-amber'}[st]||'badge-muted';
  const mType   = m.member_type||m.memberType||'Paid';
  const typeBadge = {Paid:'badge-blue',Unpaid:'badge-red',Trial:'badge-amber'}[mType]||'badge-blue';
  const av      = av2(m.full_name||m.name);

  const cancelledBadge = m.cancelled_at ? `<span class="badge badge-red" style="gap:3px;">Cancelled</span>` : '';
  const payStatusBadge = m.payment_status === 'Paid'
    ? `<span class="badge badge-green">${escHtml(m.payment_status)}</span>`
    : m.payment_status === 'Partial'
    ? `<span class="badge badge-amber">${escHtml(m.payment_status)}</span>`
    : m.payment_status === 'Due'
    ? `<span class="badge badge-red">${escHtml(m.payment_status)}</span>`
    : '';

  openModal({
    title: 'Member Details',
    size: 'md',
    mobileCompact: true,
    body: `
      <!-- Profile Header -->
      <div style="display:flex;align-items:center;gap:14px;padding-bottom:16px;border-bottom:1px solid var(--border-subtle);margin-bottom:16px;">
        <div class="member-avatar" style="width:56px;height:56px;font-size:20px;flex-shrink:0;overflow:hidden;${m.photo_url?'padding:0;':''}">${m.photo_url ? `<img src="${escHtml(m.photo_url)}" alt="" style="width:100%;height:100%;object-fit:cover;">` : av}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:17px;font-weight:700;color:var(--text-primary);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(m.full_name||m.name)}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
            <span class="badge ${typeBadge}">${mType}</span>
            <span class="badge ${stBadge}">${st}</span>
            ${cancelledBadge}
          </div>
        </div>
      </div>

      <!-- Days Left / Status Hero -->
      ${days !== null ? `<div style="background:var(--surface-2);border-radius:var(--radius-md);padding:14px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;border-left:3px solid ${daysColor};">
        <div>
          <div style="font-size:11px;color:var(--text-tertiary);font-weight:500;margin-bottom:2px;">${days < 0 ? 'Expired' : 'Membership Expiry'}</div>
          <div style="font-size:15px;font-weight:700;color:${daysColor};">${daysStr}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:2px;">Expiry Date</div>
          <div style="font-size:13px;font-weight:500;color:var(--text-primary);">${expStr}</div>
        </div>
      </div>` : ''}

      <!-- Contact -->
      <div style="margin-bottom:16px;">
        <div style="font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-quaternary);margin-bottom:8px;">Contact</div>
        ${mRow('Phone',  m.phone ? `<a href="tel:${m.phone}" style="color:var(--brand-text);text-decoration:none;font-weight:500;">${escHtml(m.phone)}</a>` : '—')}
        ${m.email ? mRow('Email', `<a href="mailto:${m.email}" style="color:var(--brand-text);text-decoration:none;">${escHtml(m.email)}</a>`) : ''}
        ${m.gender ? mRow('Gender', escHtml(m.gender)) : ''}
        ${dobStr   ? mRow('Date of Birth', dobStr) : ''}
        ${m.aadhar_number ? mRow('Aadhar ID', `<span style="font-family:var(--font-mono);color:var(--text-primary);letter-spacing:0.05em;font-size:12px;">${escHtml(m.aadhar_number.replace(/(\d{4})(?=\d)/g,'$1 '))}</span>`) : ''}
        ${m.application_number ? mRow('App No.', `<span style="font-family:var(--font-mono);color:var(--brand-text);background:var(--brand-fade);padding:2px 6px;border-radius:3px;font-size:12px;">#${escHtml(m.application_number)}</span>`) : ''}
      </div>

      <!-- Aadhaar Card — the upload control stays hidden until "+ Add" is tapped -->
      <div style="margin-bottom:16px;" id="md-aadhar-section">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
          <div style="font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-quaternary);">Aadhaar Card</div>
          ${m.aadhar_photo_url ? '' : `<button type="button" id="md-aadhar-toggle" style="background:none;border:none;color:var(--brand-text);font-size:11px;font-weight:600;cursor:pointer;padding:2px 0;font-family:inherit;">+ Add</button>`}
        </div>
        ${m.aadhar_photo_url ? `
        <div style="position:relative;border-radius:var(--radius-md);overflow:hidden;background:var(--surface-2);cursor:pointer;border:1px solid var(--border-subtle);" id="md-aadhar-preview">
          <img src="${escHtml(m.aadhar_photo_url)}" alt="Aadhaar Card" style="width:100%;height:auto;display:block;border-radius:var(--radius-md);">
          <div style="position:absolute;bottom:0;left:0;right:0;display:flex;gap:0;">
            <button id="md-aadhar-view" style="flex:1;padding:8px;background:rgba(0,0,0,0.65);color:#fff;border:none;font-size:12px;font-weight:500;cursor:pointer;font-family:var(--font-sans);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;gap:4px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              View
            </button>
            <button id="md-aadhar-reupload" style="flex:1;padding:8px;background:rgba(0,0,0,0.65);color:var(--brand-text);border:none;border-left:1px solid rgba(255,255,255,0.15);font-size:12px;font-weight:500;cursor:pointer;font-family:var(--font-sans);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;gap:4px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Replace
            </button>
            <button id="md-aadhar-remove" style="flex:0 0 auto;padding:8px 12px;background:rgba(0,0,0,0.65);color:var(--red);border:none;border-left:1px solid rgba(255,255,255,0.15);font-size:12px;font-weight:500;cursor:pointer;font-family:var(--font-sans);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;gap:4px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
        ` : `
        <button id="md-aadhar-upload" style="width:100%;padding:14px 16px;background:var(--surface-2);border:1.5px dashed var(--border-default);
          border-radius:var(--radius-md);color:var(--text-secondary);cursor:pointer;font-family:var(--font-sans);
          font-size:13px;display:flex;align-items:center;justify-content:center;gap:8px;transition:all 0.15s;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Upload Aadhaar Card
        </button>
        `}
      </div>

      <!-- Membership -->
      <div style="margin-bottom:16px;">
        <div style="font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-quaternary);margin-bottom:8px;">Membership</div>
        ${mRow('Plan',      escHtml(m.plan_name||m.plan||'—'))}
        ${plan ? mRow('Duration', (plan.duration_months||plan.duration)+' month'+((plan.duration_months||plan.duration)>1?'s':'')) : ''}
        ${mRow('Join Date',  joinStr)}
        ${mType==='Trial' && m.trial_days ? mRow('Trial Days', m.trial_days+' days') : ''}
      </div>

      <!-- Payment -->
      <div style="margin-bottom:16px;">
        <div style="font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-quaternary);margin-bottom:8px;">Payment</div>
        ${mRow('Plan Price', total>0 ? `<span style="font-weight:700;color:var(--text-primary);">₹${Number(total).toLocaleString('en-IN')}</span>` : '—')}
        ${mRow('Mode',       escHtml(m.payment_mode||m.payMode||'—'))}
        ${mRow('Status',     payStatusBadge || escHtml(m.payment_status||m.status||'—'))}
        ${parseFloat(m.discount_amount)>0 ? mRow('Discount', `<span style="color:var(--green);font-weight:500;">−₹${Number(m.discount_amount).toLocaleString('en-IN')}</span>`) : ''}
        ${parseFloat(m.balance_due)>0 ? mRow('Balance Due', `<span style="color:var(--red);font-weight:700;">₹${Number(m.balance_due).toLocaleString('en-IN')}</span>`) : ''}
        ${memberAddons.length ? mRow('Add-ons', memberAddons.map(a=>escHtml(a.name)+' <span style="color:var(--text-tertiary);">+₹'+Number(a.price).toLocaleString('en-IN')+'</span>').join(' · ')) : ''}
      </div>

      <!-- Payment History (loaded async after modal opens) -->
      <div style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;padding:8px 0;" id="md-ph-toggle">
          <div style="font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-quaternary);">Payment History</div>
          <span style="font-size:10px;color:var(--text-quaternary);" id="md-ph-arrow">▼</span>
        </div>
        <div id="md-ph-container" style="display:none;">
          <div style="padding:12px;text-align:center;color:var(--text-tertiary);font-size:12px;">Loading…</div>
        </div>
      </div>

      ${m.notes ? `
      <div style="margin-bottom:8px;">
        <div style="font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-quaternary);margin-bottom:8px;">Notes</div>
        <div style="background:var(--surface-2);border-radius:var(--radius-md);padding:12px 14px;font-size:13px;color:var(--text-secondary);line-height:1.6;white-space:pre-wrap;">${escHtml(m.notes)}</div>
      </div>` : ''}`,
    footer: (() => {
      const _role = S.role || 'owner';
      const _canEdit = hasAccess(_role, 'edit_member');
      const _canCancel = hasAccess(_role, 'cancel_member');
      const _canDelete = hasAccess(_role, 'delete_member');
      const _canRenew = hasAccess(_role, 'renew_member');
      const cancelBtn = _canCancel ? (m.cancelled_at
            ? `<button class="btn" id="md-cancelmem-btn" style="min-width:0;background:var(--green-fade);color:var(--green);border:1px solid var(--green-strong);">Reactivate</button>`
            : `<button class="btn" id="md-cancelmem-btn" style="min-width:0;background:var(--surface-3);color:var(--text-secondary);border:1px solid var(--border-default);">Cancel</button>`) : '';
      const editBtn = _canEdit ? `<button class="btn btn-ghost" id="md-edit-btn" style="min-width:0;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit</button>` : '';
      const topCols = [true, _canEdit, _canCancel].filter(Boolean).length;
      return `<div style="display:flex;flex-direction:column;gap:8px;width:100%;">
        <div style="display:grid;grid-template-columns:repeat(${topCols},1fr);gap:8px;">
          <button class="btn btn-ghost" id="modal-cancel" style="min-width:0;">Close</button>
          ${editBtn}
          ${cancelBtn}
        </div>
        <div style="display:grid;grid-template-columns:${parseFloat(m.balance_due)>0?'1fr 1fr 1fr 1fr':'1fr 1fr 1fr'};gap:8px;">
          ${_canRenew && mType !== 'Trial' ? `<button class="btn" id="md-renew-btn" style="min-width:0;background:var(--brand-fade);color:var(--brand-text);border:1px solid var(--brand-fade-strong);">Renew</button>` : ''}
          ${parseFloat(m.balance_due)>0 ? `<button class="btn" id="md-bal-btn" style="min-width:0;background:var(--amber-fade);color:var(--amber);border:1px solid var(--amber-strong);">Clear Bal</button>` : ''}
          <button class="btn btn-success-soft" id="md-wa-btn" style="min-width:0;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:3px;vertical-align:-2px;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg> Remind</button>
          <button class="btn btn-primary" id="md-inv-btn" style="min-width:0;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:3px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Invoice</button>
        </div>
        ${_canDelete ? `<div style="display:grid;grid-template-columns:1fr;gap:8px;">
          <button class="btn" id="md-del-btn" style="min-width:0;background:rgba(255,77,77,0.08);color:var(--red);border:1px solid rgba(255,77,77,0.25);font-size:12px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Remove Member</button>
        </div>` : ''}
      </div>`;
    })(),
    onOpen: () => {
      bindModalCancel();

      // ── Payment History toggle + async load ──
      let phLoaded = false;
      document.getElementById('md-ph-toggle')?.addEventListener('click', async () => {
        const container = document.getElementById('md-ph-container');
        const arrow = document.getElementById('md-ph-arrow');
        if (!container) return;
        const isHidden = container.style.display === 'none';
        container.style.display = isHidden ? 'block' : 'none';
        if (arrow) arrow.textContent = isHidden ? '▲' : '▼';
        if (isHidden && !phLoaded) {
          phLoaded = true;
          try {
            const { data: payments, error } = await supabase
              .from('payment_history')
              .select('*')
              .eq('gym_id', S.gym?.id)
              .eq('member_id', m.id)
              .order('paid_at', { ascending: false })
              .limit(50);
            if (error) throw error;
            if (!payments || payments.length === 0) {
              container.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text-tertiary);font-size:12px;">No payment records found</div>`;
              return;
            }
            const totalPaid = payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
            container.innerHTML = `
              <div style="margin-bottom:8px;padding:8px 10px;background:var(--surface-2);border-radius:var(--radius-sm);display:flex;justify-content:space-between;font-size:12px;">
                <span style="color:var(--text-tertiary);">${payments.length} payment${payments.length !== 1 ? 's' : ''}</span>
                <span style="font-weight:600;color:var(--green);">Total: ₹${totalPaid.toLocaleString('en-IN')}</span>
              </div>
              <div style="display:flex;flex-direction:column;gap:6px;">
                ${payments.map(p => {
                  const pDate = p.paid_at ? new Date(p.paid_at) : null;
                  const dateStr = pDate ? fmtDate(pDate.toISOString().split('T')[0]) : '—';
                  const modeBadge = p.payment_mode === 'Cash' ? 'badge-green' : p.payment_mode === 'Card' ? 'badge-amber' : 'badge-blue';
                  return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--surface-2);border-radius:var(--radius-sm);gap:8px;">
                    <div style="min-width:0;flex:1;">
                      <div style="font-size:12px;font-weight:500;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(p.plan_name || p.notes || 'Payment')}</div>
                      <div style="font-size:10px;color:var(--text-tertiary);">${dateStr}</div>
                    </div>
                    <span class="badge ${modeBadge}" style="font-size:9px;flex-shrink:0;">${p.payment_mode || '—'}</span>
                    <div style="font-weight:600;color:var(--green);font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap;">₹${Number(p.amount).toLocaleString('en-IN')}</div>
                  </div>`;
                }).join('')}
              </div>`;
          } catch (err) {
            container.innerHTML = `<div style="padding:12px;text-align:center;color:var(--red);font-size:12px;">Failed to load payment history</div>`;
          }
        }
      });

      document.getElementById('md-edit-btn')?.addEventListener('click', () => { closeModal(); openEditModal(memberId); });
      document.getElementById('md-cancelmem-btn')?.addEventListener('click', () => { closeModal(); confirmCancelMembership(memberId); });
      document.getElementById('md-renew-btn')?.addEventListener('click', () => { closeModal(); openRenewModal(memberId); });
      document.getElementById('md-bal-btn')?.addEventListener('click',  () => { closeModal(); openClearBalanceModal(memberId); });
      document.getElementById('md-wa-btn')?.addEventListener('click',   () => { closeModal(); openWAModal(memberId); });
      document.getElementById('md-inv-btn')?.addEventListener('click',  () => { closeModal(); openInvoiceModal(memberId); });
      document.getElementById('md-del-btn')?.addEventListener('click',  () => { closeModal(); confirmDelete(memberId); });

      // ── Aadhaar: keep the big upload dropzone out of the way ──
      // Requested behaviour: the member detail view shouldn't lead with an
      // upload prompt. When there's no photo yet, the control is collapsed
      // behind a small "+ Add" link and replaced by a one-line "Not uploaded".
      (function initAadharToggle() {
        const uploadBtn = document.getElementById('md-aadhar-upload');
        const toggle    = document.getElementById('md-aadhar-toggle');
        if (!uploadBtn || !toggle) return;
        uploadBtn.style.display = 'none';
        const emptyHint = document.createElement('div');
        emptyHint.id = 'md-aadhar-empty';
        emptyHint.style.cssText = 'font-size:12px;color:var(--text-quaternary);padding:2px 0;';
        emptyHint.textContent = 'Not uploaded';
        uploadBtn.parentNode?.insertBefore(emptyHint, uploadBtn);
        toggle.addEventListener('click', (e) => {
          e.stopPropagation();
          const isOpen = uploadBtn.style.display !== 'none';
          uploadBtn.style.display = isOpen ? 'none' : '';
          emptyHint.style.display = isOpen ? '' : 'none';
          toggle.textContent = isOpen ? '+ Add' : 'Cancel';
        });
      })();

      // ── Aadhaar card handlers ──
      // View full-size
      document.getElementById('md-aadhar-view')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (m.aadhar_photo_url) openPhotoLightbox(m.aadhar_photo_url);
      });
      // Also allow clicking the preview image itself to view
      document.getElementById('md-aadhar-preview')?.addEventListener('click', (e) => {
        // Only trigger if not clicking a button
        if (e.target.closest('button')) return;
        if (m.aadhar_photo_url) openPhotoLightbox(m.aadhar_photo_url);
      });
      // Upload (no existing photo)
      document.getElementById('md-aadhar-upload')?.addEventListener('click', async () => {
        const result = await pickAadharCard();
        if (!result) return;
        if (!S.gym?.id || !m.id) { showToast('Unable to save — gym or member not found', 'red'); return; }
        const btn = document.getElementById('md-aadhar-upload');
        if (btn) { btn.disabled = true; btn.innerHTML = `<span style="font-size:13px;">Uploading…</span>`; }
        try {
          const url = await saveAadharPhoto(result.dataUrl, S.gym.id, m.id);
          m.aadhar_photo_url = url;
          const idx = S.members.findIndex(x => String(x.id) === String(m.id));
          if (idx > -1) S.members[idx].aadhar_photo_url = url;
          showToast('Aadhaar card saved', 'green');
          closeModal();
          openMemberDetailModal(memberId); // Re-open to show the photo
        } catch (err) {
          showToast(err.message || 'Upload failed', 'red');
          if (btn) { btn.disabled = false; btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload Aadhaar Card`; }
        }
      });
      // Replace (has existing photo)
      document.getElementById('md-aadhar-reupload')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const result = await pickAadharCard();
        if (!result) return;
        if (!S.gym?.id || !m.id) return;
        showToast('Replacing…', 'amber');
        try {
          const url = await saveAadharPhoto(result.dataUrl, S.gym.id, m.id);
          m.aadhar_photo_url = url;
          const idx = S.members.findIndex(x => String(x.id) === String(m.id));
          if (idx > -1) S.members[idx].aadhar_photo_url = url;
          showToast('Aadhaar card replaced', 'green');
          closeModal();
          openMemberDetailModal(memberId);
        } catch (err) {
          showToast(err.message || 'Replace failed', 'red');
        }
      });
      // Remove
      document.getElementById('md-aadhar-remove')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await showConfirm({
          title: 'Remove Aadhaar photo?',
          message: `This will delete the Aadhaar card photo from storage. You can upload a new one anytime.`,
          confirmLabel: 'Remove',
          confirmVariant: 'danger',
        });
        if (!ok) return;
        if (!S.gym?.id || !m.id) return;
        try {
          await removeAadharPhoto(S.gym.id, m.id);
          m.aadhar_photo_url = null;
          const idx = S.members.findIndex(x => String(x.id) === String(m.id));
          if (idx > -1) S.members[idx].aadhar_photo_url = null;
          showToast('Aadhaar photo removed', 'green');
          closeModal();
          openMemberDetailModal(memberId);
        } catch (err) {
          showToast(err.message || 'Failed to remove', 'red');
        }
      });
    }
  });
}

// Small helper for modal detail rows
function mRow(label, value) {
  if (!value || value === '—') return '';
  return `<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:7px 0;border-bottom:1px solid var(--border-subtle);">
    <span style="font-size:12px;color:var(--text-tertiary);flex-shrink:0;min-width:90px;">${label}</span>
    <span style="font-size:13px;color:var(--text-primary);text-align:right;font-weight:500;word-break:break-word;min-width:0;">${value}</span>
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
          try { S.payHistory = await getPaymentHistory(S.gym.id); } catch(e) { /* best-effort */ }
          closeModal();
          _nav(S.section || 'members');
          // The balance was reduced before the payment row was written. If that
          // write failed, the money is collected but missing from Finance —
          // never report that as a plain success.
          if (saved && saved._paymentRecorded === false) {
            showToast(`Balance updated, but the ₹${amount.toLocaleString('en-IN')} payment did NOT save to Finance — record it manually`, 'amber');
          } else {
            showToast(`₹${amount.toLocaleString('en-IN')} payment recorded!`, 'green');
          }
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
        <input class="form-input" value="${escHtml(m.full_name||m.name||'')}" readonly></div>
      <div class="form-group"><label class="form-label">Phone</label>
        <input class="form-input" id="wa-phone" value="${m.phone||''}"></div>
      <div class="form-group"><label class="form-label">Message</label>
        <textarea class="form-input" id="wa-msg" rows="7" style="resize:vertical;">${escHtml(msg)}</textarea></div>
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
function buildInvoiceHTML(m, gymName, invoiceNo) {
  const exp     = expiryDate(m);
  const expStr  = exp ? exp.toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}) : '';
  invoiceNo = invoiceNo || genInvoiceNo();
  const _now = new Date();
  const dateStr = String(_now.getDate()).padStart(2,'0') + '/' + String(_now.getMonth()+1).padStart(2,'0') + '/' + _now.getFullYear();
  const joinStr = m.join_date ? new Date(m.join_date).toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}) : '';

  const memberAddons = parseMemberAddons(m);
  const basePlan = S.plans.find(p => m.plan_id ? String(p.id)===String(m.plan_id) : p.name===(m.plan_name||m.plan));
  const basePlanPrice = basePlan ? parseFloat(basePlan.price) : (parseFloat(m.plan_price) || 0);
  const addonTotal = memberAddons.reduce((s,a) => s + (parseFloat(a.price)||0), 0);
  const totalPrice = basePlanPrice + addonTotal;

  const discount   = parseFloat(m.discount_amount) || 0;
  const netTotal   = Math.max(0, totalPrice - discount);
  const balanceDue = parseFloat(m.balance_due) || 0;
  const amountPaid = Math.max(0, netTotal - balanceDue);
  const gstOn = !!S.gym?.gst_enabled;

  const gstPct   = gstOn ? (parseFloat(S.gym?.gst_percentage) || 18) : 0;
  const halfPct  = gstPct / 2;
  const fmtNum   = (v) => Number(v).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});

  // Build item rows (plan + addons)
  let rowNum = 0;
  const planDesc = (m.plan_name||m.plan||'Membership').toUpperCase();
  const planDateRange = (joinStr && expStr) ? `${joinStr} – ${expStr}` : '';

  // For each line item, compute taxable + GST
  const computeRow = (rate) => {
    if (gstOn) {
      const taxable = rate / (1 + gstPct / 100);
      const gst = rate - taxable;
      return { taxable, gst, amount: rate };
    }
    return { taxable: rate, gst: 0, amount: rate };
  };

  const planCalc = computeRow(basePlanPrice);
  rowNum++;
  let itemRowsHTML = `<tr>
    <td style="padding:10px 12px;border-bottom:1px solid #eee;vertical-align:top;">${rowNum}</td>
    <td style="padding:10px 12px;border-bottom:1px solid #eee;vertical-align:top;">
      <div style="font-weight:600;">${escHtml(planDesc)}</div>
      ${planDateRange ? `<div style="font-size:11px;color:#888;margin-top:2px;">${planDateRange}</div>` : ''}
    </td>
    <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center;vertical-align:top;">1</td>
    <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;vertical-align:top;">₹${fmtNum(basePlanPrice)}</td>
    ${gstOn ? `<td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;vertical-align:top;">₹${fmtNum(planCalc.taxable)}</td>` : ''}
    ${gstOn ? `<td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;vertical-align:top;">₹${fmtNum(planCalc.gst)}</td>` : ''}
    <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;vertical-align:top;font-weight:700;">₹${fmtNum(planCalc.amount)}</td>
  </tr>`;

  memberAddons.forEach(a => {
    rowNum++;
    const aC = computeRow(parseFloat(a.price)||0);
    itemRowsHTML += `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;">${rowNum}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;">${escHtml(a.name)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center;">1</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;">₹${fmtNum(parseFloat(a.price)||0)}</td>
      ${gstOn ? `<td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;">₹${fmtNum(aC.taxable)}</td>` : ''}
      ${gstOn ? `<td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;">₹${fmtNum(aC.gst)}</td>` : ''}
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:700;">₹${fmtNum(aC.amount)}</td>
    </tr>`;
  });

  // Summary calculations
  const taxableAmount = gstOn ? (netTotal / (1 + gstPct / 100)) : netTotal;
  const totalGST = gstOn ? (netTotal - taxableAmount) : 0;
  const halfGST = totalGST / 2;

  const payStatus = balanceDue > 0 ? (amountPaid > 0 ? 'PARTIAL' : 'DUE') : 'PAID';
  const statusColor = payStatus === 'PAID' ? '#16a34a' : payStatus === 'PARTIAL' ? '#d97706' : '#dc2626';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Invoice ${invoiceNo} — ${escHtml(m.full_name||m.name)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#222;background:#fff;}
    .page{max-width:620px;margin:0 auto;padding:36px 40px;}
    @media print{body{padding:0;}.page{padding:22px 26px;max-width:100%;}}
  </style>
</head>
<body>
<div class="page">

  <!-- HEADER -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;">
    <div style="display:flex;align-items:flex-start;gap:14px;flex:1;">
      ${S.gym?.logo_url ? `<img src="${escHtml(S.gym.logo_url)}" alt="" style="max-width:80px;max-height:60px;object-fit:contain;">` : ''}
      <div>
        <div style="font-size:18px;font-weight:700;color:#111;">${escHtml(gymName)}</div>
        ${S.gym?.address ? `<div style="font-size:11px;color:#666;margin-top:3px;line-height:1.5;max-width:320px;">${escHtml(S.gym.address)}${S.gym?.city ? ', '+escHtml(S.gym.city) : ''}</div>` : ''}
        ${gstOn && S.gym?.gstin ? `<div style="font-size:11px;color:#666;margin-top:2px;">GSTIN: ${escHtml(S.gym.gstin)}</div>` : ''}
      </div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:20px;font-weight:700;color:#333;letter-spacing:0.05em;">INVOICE</div>
      <div style="display:inline-block;margin-top:6px;padding:3px 14px;border:2px solid ${statusColor};border-radius:4px;font-size:12px;font-weight:700;color:${statusColor};letter-spacing:0.05em;">${payStatus}</div>
    </div>
  </div>

  <!-- BILL TO + INVOICE DETAILS -->
  <div style="display:flex;gap:16px;margin-bottom:24px;">
    <div style="flex:1;border:1px solid #ddd;border-radius:6px;padding:14px 16px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#888;margin-bottom:8px;">Bill To</div>
      <div style="font-size:15px;font-weight:700;color:#111;">${escHtml(m.full_name||m.name)}</div>
      ${m.phone ? `<div style="font-size:12px;color:#555;margin-top:3px;">${escHtml(m.phone)}</div>` : ''}
      ${m.email ? `<div style="font-size:12px;color:#555;margin-top:2px;">${escHtml(m.email)}</div>` : ''}
    </div>
    <div style="flex:1;border:1px solid #ddd;border-radius:6px;padding:14px 16px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#888;margin-bottom:8px;">Invoice Details</div>
      <div style="font-size:12px;color:#333;line-height:1.8;">
        <div><strong>Bill No:</strong> ${invoiceNo}</div>
        <div><strong>Date:</strong> ${dateStr}</div>
        ${gstOn ? `<div><strong>SAC:</strong> 999723</div>` : ''}
        <div><strong>Type:</strong> ${gstOn ? 'B2C' : ''} — Membership</div>
      </div>
    </div>
  </div>

  <!-- ITEMS TABLE -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:6px;">
    <thead>
      <tr style="border-bottom:2px solid #222;">
        <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#999;font-weight:600;">#</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#999;font-weight:600;">Description</th>
        <th style="padding:8px 12px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#999;font-weight:600;">Qty</th>
        <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#999;font-weight:600;">Rate</th>
        ${gstOn ? `<th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#999;font-weight:600;">Taxable Amt</th>` : ''}
        ${gstOn ? `<th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#999;font-weight:600;">GST (${gstPct}%)</th>` : ''}
        <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#999;font-weight:600;">Amount</th>
      </tr>
    </thead>
    <tbody>${itemRowsHTML}</tbody>
  </table>

  <!-- SUMMARY -->
  <div style="display:flex;justify-content:flex-end;margin-bottom:20px;">
    <div style="width:280px;">
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#444;">
        <span>Sub-Total</span><span>₹${fmtNum(totalPrice)}</span>
      </div>
      ${discount > 0 ? `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#dc2626;">
        <span>Discount</span><span>–₹${fmtNum(discount)}</span>
      </div>` : ''}
      ${gstOn ? `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#444;">
        <span>Taxable Amount</span><span>₹${fmtNum(taxableAmount)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#444;">
        <span>CGST @ ${halfPct}%</span><span>₹${fmtNum(halfGST)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#444;">
        <span>SGST @ ${halfPct}%</span><span>₹${fmtNum(halfGST)}</span>
      </div>` : ''}
      <div style="display:flex;justify-content:space-between;padding:12px 14px;margin-top:6px;background:#f0f7ff;border:1px solid #d0e3f7;border-radius:6px;">
        <span style="font-size:15px;font-weight:700;color:#111;">Grand Total</span>
        <span style="font-size:15px;font-weight:700;color:#2A8FFF;">₹${fmtNum(netTotal)}</span>
      </div>
    </div>
  </div>

  <!-- PAYMENT / STATUS ROW -->
  <div style="display:flex;gap:0;margin-bottom:22px;border:1px solid #eee;border-radius:6px;overflow:hidden;">
    <div style="flex:1;padding:12px 16px;border-right:1px solid #eee;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#888;margin-bottom:4px;">Payment Mode</div>
      <div style="font-size:14px;font-weight:600;color:#222;">${escHtml(m.payment_mode||m.payMode||'—')}</div>
    </div>
    <div style="flex:1;padding:12px 16px;border-right:1px solid #eee;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#888;margin-bottom:4px;">Amount Paid</div>
      <div style="font-size:14px;font-weight:600;color:#222;">₹${fmtNum(amountPaid)}</div>
    </div>
    <div style="flex:1;padding:12px 16px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#888;margin-bottom:4px;">Status</div>
      <div style="font-size:14px;font-weight:700;color:${statusColor};">${payStatus}</div>
    </div>
  </div>

  <!-- TERMS -->
  <div style="margin-bottom:24px;padding:14px 16px;border:1px solid #eee;border-radius:6px;">
    <div style="font-size:12px;font-weight:700;color:#555;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.04em;">Terms &amp; Conditions</div>
    <div style="font-size:11px;color:#888;line-height:1.8;">
    ${S.gym?.invoice_terms
      ? S.gym.invoice_terms.split('\n').filter(l => l.trim()).map(l => `<div>• ${escHtml(l.trim())}</div>`).join('')
      : `<div>• This receipt is issued on payment and is non-refundable.</div>
    <div>• Please retain this receipt for any future reference or dispute.</div>
    <div>• Membership is subject to the gym’s rules and conditions displayed on the premises.</div>
    <div>• No cash refunds will be provided for unused membership days.</div>
    <div>• The gym is not responsible for personal belongings left on the premises.</div>`}
    </div>
  </div>

  <!-- FOOTER -->
  <div style="text-align:center;padding-top:18px;border-top:1px solid #eee;color:#888;font-size:12px;line-height:1.8;">
    <div>Thank you for choosing <strong style="color:#333;">${escHtml(gymName)}</strong></div>
    <div style="color:#aaa;margin-top:2px;">We appreciate your trust in us. Stay fit, stay healthy!</div>
  </div>

</div>
</body>
</html>`;
}

function buildWhatsAppText(m, gymName) {
  return `Hi ${m.full_name||m.name}, here is your invoice from ${gymName}.`;
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
        Use <strong style="color:var(--green);">📱 WhatsApp</strong> to send a text summary with a PDF link.
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
      document.getElementById('inv-wa').addEventListener('click', async () => {
        const phone = m.phone?.replace(/\D/g,'');
        if (!phone) { showToast('No phone number for this member','red'); return; }

        const btn = document.getElementById('inv-wa');
        const originalLabel = btn.textContent;
        btn.disabled = true; btn.textContent = 'Preparing PDF…';

        // Open the tab now, synchronously, inside the click gesture — iOS/Safari
        // block window.open() once we go async below (PDF render + upload).
        // We fill in the real URL once it's ready.
        const win = window.open('', '_blank');

        let text = buildWhatsAppText(m, gym);
        try {
          const invoiceNo = genInvoiceNo();
          const html = buildInvoiceHTML(m, gym, invoiceNo);
          const blob = await generateInvoicePdfBlob(html);
          const url  = await uploadInvoicePdf(blob, S.gym.id, m.id, invoiceNo);
          if (url) text += `\n${url}`;
        } catch (err) {
          console.warn('[Flym] Invoice PDF failed, sending text only:', err.message);
          showToast('PDF failed — sent text only', 'amber');
        }

        const waLink = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
        if (win) win.location.href = waLink;
        else window.open(waLink, '_blank');

        btn.disabled = false; btn.textContent = originalLabel;
        closeModal(); showToast('WhatsApp opened!','green');
      });
    }
  });
}


export { openAddModal, submitAdd, openEditModal, confirmDelete, confirmCancelMembership, openRenewModal, openMemberDetailModal, openWAModal, buildInvoiceHTML, buildWhatsAppText, openInvoiceModal, openClearBalanceModal };