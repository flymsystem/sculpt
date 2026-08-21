import { S, DEFAULT_WA_TEMPLATE, DEFAULT_CREDENTIALS_WA_TEMPLATE, DEFAULT_FOLLOWUP_WA_TEMPLATE } from './state.js';
import { escHtml, escAttr } from './helpers.js';
import { supabase } from '../../lib/supabase.js';
import { getAddonTemplates, addAddonTemplate, updateAddonTemplate, deleteAddonTemplate } from '../../lib/addon-templates.js';
import { showToast } from '../../components/toast.js';
import { openModal, closeModal, bindModalCancel } from '../../components/modal.js';
import { pickLogo } from '../../components/photo-picker.js';
import { saveGymLogo } from './photo.js';

let _nav;
export function setNavHandler(fn) { _nav = fn; }

// Pending logo pick, set by applyLogoPending() (called from the dropzone
// click/drop handlers below) and read by the "Save Branding" button inside
// renderGymConfig(). Must live at module scope — applyLogoPending() is a
// module-level function and can't see variables declared inside renderGymConfig().
let pendingLogoDataUrl = null;
let pendingLogoMime = 'image/png';


function renderGymConfig(c) {
  // Fresh render — clear any stale pending logo pick from a previous visit
  pendingLogoDataUrl = null;
  pendingLogoMime = 'image/png';

  const g    = S.gym || {};
  const tpl  = g.wa_template   || DEFAULT_WA_TEMPLATE;
  const days = g.reminder_days ?? 7;
  const followupDays = g.checkin_followup_days ?? 21;

  const gstPct = parseFloat(g.gst_percentage) || 18;
  const discountEnabled = !!g.discount_enabled;
  const defaultDiscountPct = parseFloat(g.default_discount_pct) || 0;
  const DEFAULT_INVOICE_TERMS = `This receipt is issued on payment and is non-refundable.\nPlease retain this receipt for any future reference or dispute.\nMembership is subject to the gym\u2019s rules and conditions displayed on the premises.`;
  const invoiceTerms = g.invoice_terms || DEFAULT_INVOICE_TERMS;

  c.innerHTML = `<div class="content-inner page-enter">
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-title">Gym Settings</div>
        <div class="page-sub">Manage your gym info, branding, invoices, WhatsApp templates and security</div>
      </div>
    </div>

    <div class="settings-tabs" id="settings-tabs">
      <button class="settings-tab active" data-tab="general">General</button>
      <button class="settings-tab" data-tab="branding">Branding</button>
      <button class="settings-tab" data-tab="tax">GST &amp; Tax</button>
      <button class="settings-tab" data-tab="invoice">Invoice</button>
      <button class="settings-tab" data-tab="whatsapp">WhatsApp</button>
      <button class="settings-tab" data-tab="security">Security</button>
      <button class="settings-tab" data-tab="addons">Add-ons</button>
    </div>

    <div id="settings-panels">

    <!-- GENERAL -->
    <div class="settings-panel" data-panel="general">
    <div class="settings-grid">
      <div class="settings-card">
        <div class="settings-card-title">Gym Information</div>
        <div class="form-group"><label class="form-label">Gym Name</label>
          <input class="form-input" id="cfg-name" value="${escHtml(g.name||'')}"></div>
        <div class="form-group"><label class="form-label">Owner Name</label>
          <input class="form-input" id="cfg-owner" value="${escHtml(g.owner_name||'')}"></div>
        <div class="form-group"><label class="form-label">Phone</label>
          <input class="form-input" id="cfg-phone" value="${escHtml(g.phone||'')}"></div>
        <div class="form-group"><label class="form-label">Phone 2 <span style="color:var(--text-quaternary);font-weight:400;font-size:11px;">(optional, shown on invoices)</span></label>
          <input class="form-input" id="cfg-phone2" value="${escHtml(g.phone2||'')}"></div>
        <div class="form-group"><label class="form-label">City</label>
          <input class="form-input" id="cfg-city" value="${escHtml(g.city||'')}"></div>
        <div class="form-group"><label class="form-label">Address</label>
          <input class="form-input" id="cfg-addr" value="${escHtml(g.address||'')}"></div>
        <div id="cfg-err" style="display:none;color:var(--red);font-size:13px;margin-bottom:12px;
          padding:10px 14px;background:var(--red-fade);border-radius:var(--radius-md);
          border:1px solid var(--red-strong);"></div>
        <button class="btn btn-primary" id="btn-savegym">Save Changes</button>
      </div>

    </div>
    </div>

    <!-- BRANDING -->
    <div class="settings-panel" data-panel="branding" style="display:none;">
    <div class="settings-grid">
      <div class="settings-card">
        <div class="settings-card-title">Gym Logo</div>
        <div class="drop-zone" id="cfg-logo-dropzone" style="margin-bottom:16px;">
          <div id="cfg-logo-preview" style="width:160px;height:80px;margin:0 auto;display:flex;align-items:center;justify-content:center;overflow:hidden;">
            ${g.logo_url
              ? `<img src="${escHtml(g.logo_url)}" alt="" style="max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;">`
              : `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-quaternary)" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`}
          </div>
          <div class="drop-text">${g.logo_url ? 'Click or drag to replace' : 'Click or drag to upload logo'}</div>
          <div style="font-size:10px;color:var(--text-quaternary);margin-top:4px;">PNG with transparent background works best</div>
        </div>
        <div id="cfg-brand-err" style="display:none;color:var(--red);font-size:13px;margin-bottom:12px;
          padding:10px 14px;background:var(--red-fade);border-radius:var(--radius-md);border:1px solid var(--red-strong);"></div>
        <button class="btn btn-primary" id="btn-savebrand" style="width:100%;">Save Branding</button>
      </div>
      <div class="settings-card">
        <div class="settings-card-title">Brand Preview</div>
        <div style="padding:20px;background:var(--surface-2);border-radius:var(--radius-md);text-align:center;">
          <div style="font-size:11px;color:var(--text-quaternary);margin-bottom:10px;">How your logo appears on invoices</div>
          <div style="background:white;padding:16px;border-radius:var(--radius-sm);display:inline-block;">
            ${g.logo_url
              ? `<img src="${escHtml(g.logo_url)}" alt="" style="max-width:180px;max-height:60px;object-fit:contain;">`
              : `<div style="font-size:14px;color:#999;">No logo uploaded</div>`}
          </div>
        </div>
      </div>
    </div>
    </div>

    <!-- GST & TAX -->
    <div class="settings-panel" data-panel="tax" style="display:none;">
    <div class="settings-grid">
      <div class="settings-card">
        <div class="settings-card-title">GST Configuration</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding:12px 14px;background:var(--surface-2);border-radius:var(--radius-md);">
          <div>
            <div style="font-size:13px;color:var(--text-primary);font-weight:500;">GST Registered</div>
            <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">Enable to add GST breakdown on invoices</div>
          </div>
          <label class="sculpt-switch" style="margin:0;">
            <input type="checkbox" id="cfg-gst-enabled" ${g.gst_enabled?'checked':''}>
            <span class="sculpt-switch-slider"></span>
          </label>
        </div>
        <div id="cfg-gst-details" style="${g.gst_enabled?'':'display:none;'}">
          <div class="form-group">
            <label class="form-label">GSTIN</label>
            <input class="form-input" id="cfg-gstin" placeholder="22AAAAA0000A1Z5" value="${escHtml(g.gstin||'')}">
          </div>
          <div class="form-group">
            <label class="form-label">GST Percentage</label>
            <div style="display:flex;align-items:center;gap:8px;">
              <input class="form-input" id="cfg-gst-pct" type="number" min="0" max="100" step="0.5" value="${gstPct}" style="width:100px;">
              <span style="color:var(--text-tertiary);font-size:13px;">% (split equally as CGST + SGST)</span>
            </div>
            <div class="form-hint">Common: 18% (9% CGST + 9% SGST) or 12% (6% + 6%)</div>
          </div>
        </div>
        <button class="btn btn-primary" id="btn-savetax" style="width:100%;">Save Tax Settings</button>
      </div>
      <div class="settings-card">
        <div class="settings-card-title">GST Preview</div>
        <div id="gst-preview-calc" style="padding:16px;background:var(--surface-2);border-radius:var(--radius-md);">
          ${buildGSTPreview(gstPct, g.gst_enabled)}
        </div>
        <div style="font-size:11px;color:var(--text-quaternary);margin-top:8px;">Example calculation for a \u20B91,000 plan</div>
      </div>
    </div>
    </div>

    <!-- INVOICE SETTINGS -->
    <div class="settings-panel" data-panel="invoice" style="display:none;">
    <div class="settings-grid">
      <div class="settings-card">
        <div class="settings-card-title">Invoice Terms &amp; Conditions</div>
        <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:14px;line-height:1.6;">
          These appear at the bottom of every invoice. One term per line.
        </div>
        <div class="form-group">
          <textarea class="form-input" id="cfg-invoice-terms" rows="6" style="resize:vertical;" placeholder="This receipt is non-refundable.\nMembership is subject to gym rules.\nPlease retain for future reference.">${escHtml(invoiceTerms)}</textarea>
        </div>
        <button class="btn btn-primary" id="btn-save-invoice" style="width:100%;">Save Invoice Settings</button>
      </div>
      <div class="settings-card">
        <div class="settings-card-title">Discount Settings</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding:12px 14px;background:var(--surface-2);border-radius:var(--radius-md);">
          <div>
            <div style="font-size:13px;color:var(--text-primary);font-weight:500;">Enable Discounts</div>
            <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">Show discount field when adding/renewing members</div>
          </div>
          <label class="sculpt-switch" style="margin:0;">
            <input type="checkbox" id="cfg-discount-enabled" ${discountEnabled?'checked':''}>
            <span class="sculpt-switch-slider"></span>
          </label>
        </div>
        <div id="cfg-discount-details" style="${discountEnabled?'':'display:none;'}">
          <div class="form-group">
            <label class="form-label">Default Discount %</label>
            <input class="form-input" id="cfg-discount-pct" type="number" min="0" max="100" step="1" value="${defaultDiscountPct}" style="width:120px;">
            <div class="form-hint">Applied by default when adding a new member. Can be overridden per member.</div>
          </div>
        </div>
        <button class="btn btn-primary" id="btn-save-discount" style="width:100%;">Save Discount Settings</button>
      </div>
    </div>
    </div>

    <!-- WHATSAPP -->
    <div class="settings-panel" data-panel="whatsapp" style="display:none;">
    <div class="settings-grid">

        <!-- WhatsApp Template -->
        <div class="settings-card">
          <div class="settings-card-title">WhatsApp Template</div>
          <div class="form-group"><label class="form-label" for="wa-template">Manual Reminder Message</label>
            <textarea class="form-input wa-textarea" id="wa-template" rows="7">${escHtml(tpl)}</textarea>
          </div>
          <div class="wa-vars">
            <span class="wa-vars-label">Insert</span>
            <button type="button" class="wa-var-btn wa-var" data-var="{name}">{name}</button>
            <button type="button" class="wa-var-btn wa-var" data-var="{plan}">{plan}</button>
            <button type="button" class="wa-var-btn wa-var" data-var="{gym}">{gym}</button>
            <button type="button" class="wa-var-btn wa-var" data-var="{date}">{date}</button>
          </div>
          <p class="wa-note">
            For manual reminders only. Auto-reminders use a Meta-approved template.
          </p>
          <div class="form-group">
            <div class="form-label">Live Preview</div>
            <div class="wa-preview"><div id="wa-live-preview"></div></div>
          </div>
          <div class="form-group"><label class="form-label">Warning Window</label>
            <select class="form-input" id="wa-reminder-days">
              <option value="3"  ${days===3 ?'selected':''}>3 days before expiry</option>
              <option value="7"  ${days===7 ?'selected':''}>7 days before expiry</option>
              <option value="14" ${days===14?'selected':''}>14 days before expiry</option>
            </select>
          </div>
          <div id="wa-err" style="display:none;color:var(--red);font-size:13px;margin-bottom:12px;
            padding:10px 14px;background:var(--red-fade);border-radius:var(--radius-md);
            border:1px solid var(--red-strong);"></div>
          <button class="btn btn-primary btn-full" id="btn-savewa">Save Settings</button>
        </div>

        <!-- Birthday & Welcome Templates -->
        <div class="settings-card">
          <div class="settings-card-title">Birthday &amp; Welcome Messages</div>
          <div class="form-group"><label class="form-label" for="wa-birthday">Birthday Wish</label>
            <textarea class="form-input wa-textarea" id="wa-birthday" rows="4" placeholder="🎂 Happy Birthday {name}! Wishing you a wonderful day from all of us at {gym}. Stay fit! 💪">${escHtml(g.wa_birthday_template||'')}</textarea>
          </div>
          <div class="form-group"><label class="form-label" for="wa-welcome">Welcome Message (New Members)</label>
            <textarea class="form-input wa-textarea" id="wa-welcome" rows="4" placeholder="🏋️ Welcome to {gym}, {name}! Your {plan} plan is now active. Let's get started on your fitness journey! 💪">${escHtml(g.wa_welcome_template||'')}</textarea>
          </div>
          <div class="wa-vars">
            <span class="wa-vars-label">Variables</span>
            <code class="wa-var">{name}</code>
            <code class="wa-var">{gym}</code>
            <code class="wa-var">{plan}</code>
          </div>
          <button class="btn btn-primary btn-full" id="btn-save-extra-wa">Save Templates</button>
        </div>

        <!-- Check-in Messages -->
        <div class="settings-card">
          <div class="settings-card-title">Check-in Messages</div>
          <div class="form-group"><label class="form-label" for="wa-credentials">Login Details (sent when a member is added)</label>
            <textarea class="form-input wa-textarea" id="wa-credentials" rows="6">${escHtml(g.credentials_wa_template || DEFAULT_CREDENTIALS_WA_TEMPLATE)}</textarea>
          </div>
          <div class="wa-vars">
            <span class="wa-vars-label">Insert</span>
            <button type="button" class="wa-var-btn wa-var" data-var-target="wa-credentials" data-var="{name}">{name}</button>
            <button type="button" class="wa-var-btn wa-var" data-var-target="wa-credentials" data-var="{appnum}">{appnum}</button>
            <button type="button" class="wa-var-btn wa-var" data-var-target="wa-credentials" data-var="{gym}">{gym}</button>
            <button type="button" class="wa-var-btn wa-var" data-var-target="wa-credentials" data-var="{link}">{link}</button>
          </div>
          <div class="form-group" style="margin-top:14px;"><label class="form-label" for="wa-followup">Not-Seen-Recently Nudge</label>
            <textarea class="form-input wa-textarea" id="wa-followup" rows="5">${escHtml(g.followup_wa_template || DEFAULT_FOLLOWUP_WA_TEMPLATE)}</textarea>
          </div>
          <div class="wa-vars">
            <span class="wa-vars-label">Insert</span>
            <button type="button" class="wa-var-btn wa-var" data-var-target="wa-followup" data-var="{name}">{name}</button>
            <button type="button" class="wa-var-btn wa-var" data-var-target="wa-followup" data-var="{days}">{days}</button>
            <button type="button" class="wa-var-btn wa-var" data-var-target="wa-followup" data-var="{gym}">{gym}</button>
          </div>
          <div class="form-group" style="margin-top:14px;"><label class="form-label" for="cfg-followup-days">Not Seen Threshold</label>
            <select class="form-input" id="cfg-followup-days">
              <option value="7"  ${followupDays===7 ?'selected':''}>7 days</option>
              <option value="14" ${followupDays===14?'selected':''}>14 days</option>
              <option value="21" ${followupDays===21?'selected':''}>21 days (default)</option>
              <option value="30" ${followupDays===30?'selected':''}>30 days</option>
            </select>
          </div>
          <button class="btn btn-primary btn-full" id="btn-save-checkin-wa">Save Check-in Settings</button>
        </div>

      </div>
    </div>
    </div>

    <!-- SECURITY -->
    <div class="settings-panel" data-panel="security" style="display:none;">
    <div class="settings-grid">
      <div class="settings-card" style="border-left:3px solid var(--amber);">
        <div class="settings-card-title">Change Password</div>
        <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:14px;line-height:1.6;">
          Enter your current password to verify, then set a new one.
        </div>
        ${g.password_changed_at ? `<div style="font-size:11px;color:var(--text-quaternary);margin-bottom:14px;">Last changed: ${new Date(g.password_changed_at).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'})}</div>` : ''}
        <div class="form-group"><label class="form-label">Current Password *</label>
          <div style="position:relative;">
            <input class="form-input" id="cfg-old-pw" type="password" placeholder="Enter current password" autocomplete="current-password">
            <button type="button" class="pw-toggle" data-target="cfg-old-pw" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--text-tertiary);padding:4px;" aria-label="Show password">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
        </div>
        <div class="form-group"><label class="form-label">New Password *</label>
          <div style="position:relative;">
            <input class="form-input" id="cfg-new-pw" type="password" placeholder="Enter new password" autocomplete="new-password">
            <button type="button" class="pw-toggle" data-target="cfg-new-pw" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--text-tertiary);padding:4px;" aria-label="Show password">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
          <div class="pw-strength-bar" id="pw-strength" data-score="0"><span></span><span></span><span></span><span></span></div>
          <div id="pw-strength-text" style="font-size:11px;color:var(--text-quaternary);margin-top:4px;"></div>
        </div>
        <div class="form-group"><label class="form-label">Confirm New Password *</label>
          <input class="form-input" id="cfg-confirm-pw" type="password" placeholder="Re-enter new password" autocomplete="new-password"></div>
        <div id="cfg-pw-err" style="display:none;color:var(--red);font-size:13px;margin-bottom:12px;
          padding:10px 14px;background:var(--red-fade);border-radius:var(--radius-md);border:1px solid var(--red-strong);"></div>
        <div id="cfg-pw-ok" style="display:none;color:var(--green);font-size:13px;margin-bottom:12px;
          padding:10px 14px;background:var(--green-fade);border-radius:var(--radius-md);border:1px solid var(--green-strong);"></div>
        <button class="btn btn-primary" id="btn-changepw">Change Password</button>
      </div>
    </div>
    </div>

    <!-- ADDONS -->
    <div class="settings-panel" data-panel="addons" style="display:none;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div>
          <div style="font-weight:600;font-size:var(--text-md);color:var(--text-primary);">Add-on Templates</div>
          <div style="font-size:var(--text-sm);color:var(--text-tertiary);margin-top:2px;">Quick-add buttons for Renew &amp; Add Member modals</div>
        </div>
        <button class="btn btn-primary btn-sm" id="addon-tpl-add">+ Add</button>
      </div>
      <div id="addon-tpl-list">
        ${(S.addonTemplates||[]).length===0
          ? `<div class="empty-state" style="padding:32px;"><span class="empty-icon">\u26A1</span><div>No add-on templates yet. Create presets like Cardio, Admission, Locker.</div></div>`
          : (S.addonTemplates||[]).map(a => `<div class="settings-card" style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;margin-bottom:8px;">
            <div style="display:flex;align-items:center;gap:12px;">
              <span style="font-weight:600;color:var(--text-primary);">${escHtml(a.name)}</span>
              <span style="font-size:var(--text-sm);color:var(--brand-text);font-weight:500;">\u20B9${parseFloat(a.default_price).toLocaleString('en-IN')}</span>
              <span class="badge ${a.is_one_time?'badge-amber':'badge-green'}">${a.is_one_time?'One-time':'Recurring'}</span>
            </div>
            <div style="display:flex;gap:6px;">
              <button class="btn btn-ghost btn-sm" onclick="window._editAddonTpl('${escAttr(a.id)}')">Edit</button>
              <button class="btn btn-ghost btn-sm" onclick="window._delAddonTpl('${escAttr(a.id)}')" style="color:var(--red);">Delete</button>
            </div></div>`
          ).join('')}
      </div>
    </div>

    </div>
  </div>`;

  // ── Tab switching ────────────────────────────────────────────
  document.querySelectorAll('#settings-tabs .settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#settings-tabs .settings-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const panel = tab.dataset.tab;
      document.querySelectorAll('.settings-panel').forEach(p => {
        p.style.display = p.dataset.panel === panel ? '' : 'none';
      });
    });
  });

  // ── Password show/hide toggle ─────────────────────────────────
  document.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      const isPass = input.type === 'password';
      input.type = isPass ? 'text' : 'password';
      btn.style.color = isPass ? 'var(--brand)' : 'var(--text-tertiary)';
    });
  });

  // ── Password strength meter ──────────────────────────────────
  document.getElementById('cfg-new-pw')?.addEventListener('input', (e) => {
    const pw = e.target.value;
    let score = 0;
    if (pw.length >= 8) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^a-zA-Z0-9]/.test(pw)) score++;
    const bar = document.getElementById('pw-strength');
    const text = document.getElementById('pw-strength-text');
    if (bar) bar.setAttribute('data-score', String(score));
    const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
    const colors = ['', 'var(--red)', 'var(--amber)', 'var(--amber)', 'var(--green)'];
    if (text) { text.textContent = pw ? labels[score] || '' : ''; text.style.color = colors[score] || ''; }
  });

  // ── GST toggle shows/hides details ───────────────────────────
  document.getElementById('cfg-gst-enabled')?.addEventListener('change', (e) => {
    const wrap = document.getElementById('cfg-gst-details');
    if (wrap) wrap.style.display = e.currentTarget.checked ? '' : 'none';
    const preview = document.getElementById('gst-preview-calc');
    if (preview) preview.innerHTML = buildGSTPreview(parseFloat(document.getElementById('cfg-gst-pct')?.value) || 18, e.currentTarget.checked);
  });
  document.getElementById('cfg-gst-pct')?.addEventListener('input', (e) => {
    const preview = document.getElementById('gst-preview-calc');
    if (preview) preview.innerHTML = buildGSTPreview(parseFloat(e.target.value) || 18, document.getElementById('cfg-gst-enabled')?.checked);
  });

  // ── Discount toggle ──────────────────────────────────────────
  document.getElementById('cfg-discount-enabled')?.addEventListener('change', (e) => {
    const wrap = document.getElementById('cfg-discount-details');
    if (wrap) wrap.style.display = e.currentTarget.checked ? '' : 'none';
  });

  // ── WhatsApp live preview ────────────────────────────────────
  function updateWAPreview() {
    const tplVal = document.getElementById('wa-template')?.value || '';
    const preview = document.getElementById('wa-live-preview');
    if (!preview) return;
    const filled = tplVal
      .replace(/\{name\}/g, 'Rahul')
      .replace(/\{plan\}/g, '3 Month Plan')
      .replace(/\{gym\}/g, escHtml(g.name || 'Your Gym'))
      .replace(/\{date\}/g, '15/01/2025');
    preview.innerHTML = `<div class="wa-bubble">${escHtml(filled)}</div>`;
  }
  document.getElementById('wa-template')?.addEventListener('input', updateWAPreview);
  updateWAPreview();

  // ── Variable autocomplete for WA template ────────────────────
  document.querySelectorAll('.wa-var-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const textarea = document.getElementById(btn.dataset.varTarget || 'wa-template');
      if (!textarea) return;
      const v = btn.dataset.var;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value = textarea.value.substring(0, start) + v + textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + v.length;
      textarea.focus();
      if (textarea.id === 'wa-template') updateWAPreview();
    });
  });

  // ── Logo drag-drop ───────────────────────────────────────────
  const dropzone = document.getElementById('cfg-logo-dropzone');
  if (dropzone) {
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault(); dropzone.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) handleLogoFile(file);
    });
    dropzone.addEventListener('click', async () => {
      const result = await pickLogo();
      if (result) applyLogoPending(result.dataUrl, result.mime);
    });
  }

  function handleLogoFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => applyLogoPending(e.target.result, file.type);
    reader.readAsDataURL(file);
  }

  // ── Save tax settings ────────────────────────────────────────
  document.getElementById('btn-savetax')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Saving\u2026';
    try {
      const updates = {
        gst_enabled: !!document.getElementById('cfg-gst-enabled')?.checked,
        gstin: document.getElementById('cfg-gstin')?.value.trim() || null,
        gst_percentage: parseFloat(document.getElementById('cfg-gst-pct')?.value) || 18,
      };
      if (S.gym?.id) {
        const { error } = await supabase.from('gyms').update(updates).eq('id', S.gym.id);
        if (error) throw error;
      }
      S.gym = { ...S.gym, ...updates };
      if (window.__sculptSession?.gym) window.__sculptSession.gym = { ...window.__sculptSession.gym, ...updates };
      showToast('Tax settings saved!', 'green');
    } catch (err) { showToast(err.message || 'Save failed', 'red'); }
    finally { btn.disabled = false; btn.textContent = 'Save Tax Settings'; }
  });

  // ── Save invoice settings ─────────────────────────────────────
  document.getElementById('btn-save-invoice')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Saving\u2026';
    try {
      const updates = { invoice_terms: document.getElementById('cfg-invoice-terms')?.value.trim() || null };
      if (S.gym?.id) {
        const { error } = await supabase.from('gyms').update(updates).eq('id', S.gym.id);
        if (error) throw error;
      }
      S.gym = { ...S.gym, ...updates };
      showToast('Invoice settings saved!', 'green');
    } catch (err) { showToast(err.message || 'Save failed', 'red'); }
    finally { btn.disabled = false; btn.textContent = 'Save Invoice Settings'; }
  });

  // ── Save discount settings ───────────────────────────────────
  document.getElementById('btn-save-discount')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Saving\u2026';
    try {
      const updates = {
        discount_enabled: !!document.getElementById('cfg-discount-enabled')?.checked,
        default_discount_pct: parseFloat(document.getElementById('cfg-discount-pct')?.value) || 0,
      };
      if (S.gym?.id) {
        const { error } = await supabase.from('gyms').update(updates).eq('id', S.gym.id);
        if (error) throw error;
      }
      S.gym = { ...S.gym, ...updates };
      showToast('Discount settings saved!', 'green');
    } catch (err) { showToast(err.message || 'Save failed', 'red'); }
    finally { btn.disabled = false; btn.textContent = 'Save Discount Settings'; }
  });



  // ── Save gym information ──────────────────────────────────────
  document.getElementById('btn-savegym').addEventListener('click', async (e) => {
    const btn   = e.currentTarget;
    const errEl = document.getElementById('cfg-err');
    errEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const updates = {
        name:       document.getElementById('cfg-name').value.trim(),
        owner_name: document.getElementById('cfg-owner').value.trim(),
        phone:      document.getElementById('cfg-phone').value.trim() || null,
        phone2:     document.getElementById('cfg-phone2').value.trim() || null,
        city:       document.getElementById('cfg-city').value.trim()  || null,
        address:    document.getElementById('cfg-addr').value.trim()  || null,
      };
      if (!updates.name) throw new Error('Gym name cannot be empty.');

      if (S.gym?.id) {
        const { error } = await supabase
          .from('gyms')
          .update(updates)
          .eq('id', S.gym.id);
        if (error) throw error;
      }

      // ✅ Patch local state — re-navigation now shows saved values
      S.gym = { ...S.gym, ...updates };
      if (window.__sculptSession?.gym) window.__sculptSession.gym = { ...window.__sculptSession.gym, ...updates };

      showToast('Gym settings saved!', 'green');
    } catch (err) {
      console.error('[Sculpt] saveGym:', err);
      errEl.textContent = err.message || 'Save failed. Please try again.';
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Changes';
    }
  });

  // ── Change Password handler ──────────────────────────────────
  document.getElementById('btn-changepw')?.addEventListener('click', async (e) => {
    const btn   = e.currentTarget;
    const errEl = document.getElementById('cfg-pw-err');
    const okEl  = document.getElementById('cfg-pw-ok');
    errEl.style.display = 'none';
    okEl.style.display = 'none';

    const oldPw    = document.getElementById('cfg-old-pw')?.value;
    const newPw    = document.getElementById('cfg-new-pw')?.value;
    const confirmPw= document.getElementById('cfg-confirm-pw')?.value;

    if (!oldPw) { errEl.textContent = 'Enter your current password.'; errEl.style.display = 'block'; return; }
    if (!newPw || newPw.length < 8) { errEl.textContent = 'New password must be at least 8 characters.'; errEl.style.display = 'block'; return; }
    if (newPw === oldPw) { errEl.textContent = 'New password cannot be the same as your current password.'; errEl.style.display = 'block'; return; }
    if (newPw !== confirmPw) { errEl.textContent = 'New passwords do not match.'; errEl.style.display = 'block'; return; }

    btn.disabled = true; btn.textContent = 'Verifying\u2026';

    try {
      // Step 1: Verify old password by re-authenticating
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error('Could not find your account email.');

      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: oldPw,
      });
      if (signInErr) throw new Error('Incorrect current password.');

      // Step 2: Update Supabase Auth password
      btn.textContent = 'Updating\u2026';
      const { error: updateErr } = await supabase.auth.updateUser({ password: newPw });
      if (updateErr) throw updateErr;

      // Step 3: Sync owner_password in gyms table for admin visibility
      if (S.gym?.id) {
        const { error: dbErr } = await supabase
          .from('gyms')
          .update({ owner_password: newPw, password_changed_at: new Date().toISOString() })
          .eq('id', S.gym.id);
        if (dbErr) {
          // Auth succeeded but DB sync failed — attempt rollback to keep in sync
          try {
            await supabase.auth.updateUser({ password: oldPw });
            throw new Error('Password update failed (database sync error). Your password was not changed. Please try again.');
          } catch (rollbackErr) {
            // Rollback also failed — passwords are now out of sync
            throw new Error('Password was updated in login but the admin record could not be synced. Please contact the gym owner.');
          }
        }
      }

      // Clear inputs
      document.getElementById('cfg-old-pw').value = '';
      document.getElementById('cfg-new-pw').value = '';
      document.getElementById('cfg-confirm-pw').value = '';

      okEl.textContent = 'Password changed successfully!';
      okEl.style.display = 'block';
      showToast('Password changed!', 'green');
    } catch (err) {
      errEl.textContent = err.message || 'Password change failed.';
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false; btn.textContent = 'Change Password';
    }
  });

  // ── Branding bindings ─────────────────────────────────────────
  document.getElementById('btn-savebrand')?.addEventListener('click', async (e) => {
    const btn   = e.currentTarget;
    const errEl = document.getElementById('cfg-brand-err');
    errEl.style.display = 'none';
    btn.disabled = true; btn.textContent = 'Saving…';

    try {
      const updates = {};

      if (S.gym?.id) {
        if (pendingLogoDataUrl) {
          btn.textContent = 'Uploading logo\u2026';
          updates.logo_url = await saveGymLogo(pendingLogoDataUrl, S.gym.id, pendingLogoMime);
          const { error } = await supabase.from('gyms').update({ logo_url: updates.logo_url }).eq('id', S.gym.id);
          if (error) throw error;
        }
      }

      S.gym = { ...S.gym, ...updates };
      if (window.__sculptSession?.gym) window.__sculptSession.gym = { ...window.__sculptSession.gym, ...updates };

      showToast('Branding & tax settings saved!', 'green');
      _nav('gymconfig');
    } catch (err) {
      console.error('[Sculpt] saveBrand:', err);
      errEl.textContent = err.message || 'Save failed. Please try again.';
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Save Changes';
    }
  });

  // ── Save WhatsApp settings ────────────────────────────────────
  document.getElementById('btn-savewa').addEventListener('click', async (e) => {
    const btn   = e.currentTarget;
    const errEl = document.getElementById('wa-err');
    errEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const waUpdates = {
        wa_template:   document.getElementById('wa-template').value.trim() || DEFAULT_WA_TEMPLATE,
        reminder_days: parseInt(document.getElementById('wa-reminder-days').value, 10) || 7,
      };

      if (S.gym?.id) {
        const { error } = await supabase
          .from('gyms')
          .update(waUpdates)
          .eq('id', S.gym.id);
        if (error) throw error;
      }

      // ✅ Patch local state — re-navigation now shows saved values
      S.gym = { ...S.gym, ...waUpdates };
      if (window.__sculptSession?.gym) window.__sculptSession.gym = { ...window.__sculptSession.gym, ...waUpdates };

      showToast('WhatsApp settings saved!', 'green');
    } catch (err) {
      console.error('[Sculpt] saveWA:', err);
      errEl.textContent = err.message || 'Save failed. Please try again.';
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Settings';
    }
  });

  // ── Addon template bindings ─────────────────────────────────
  document.getElementById('btn-save-extra-wa')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const updates = {
        wa_birthday_template: document.getElementById('wa-birthday')?.value.trim() || null,
        wa_welcome_template:  document.getElementById('wa-welcome')?.value.trim() || null,
      };
      if (S.gym?.id) {
        const { error } = await supabase.from('gyms').update(updates).eq('id', S.gym.id);
        if (error) throw error;
      }
      S.gym = { ...S.gym, ...updates };
      showToast('Templates saved!', 'green');
    } catch(err) { showToast(err.message || 'Save failed', 'red'); }
    finally { btn.disabled = false; btn.textContent = 'Save Templates'; }
  });

  document.getElementById('btn-save-checkin-wa')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const updates = {
        credentials_wa_template: document.getElementById('wa-credentials')?.value.trim() || null,
        followup_wa_template:    document.getElementById('wa-followup')?.value.trim() || null,
        checkin_followup_days:   parseInt(document.getElementById('cfg-followup-days')?.value, 10) || 21,
      };
      if (S.gym?.id) {
        const { error } = await supabase.from('gyms').update(updates).eq('id', S.gym.id);
        if (error) throw error;
      }
      S.gym = { ...S.gym, ...updates };
      if (window.__sculptSession?.gym) window.__sculptSession.gym = { ...window.__sculptSession.gym, ...updates };
      showToast('Check-in settings saved!', 'green');
    } catch (err) { showToast(err.message || 'Save failed', 'red'); }
    finally { btn.disabled = false; btn.textContent = 'Save Check-in Settings'; }
  });

  document.getElementById('addon-tpl-add')?.addEventListener('click', () => openAddonTplModal());

  function openAddonTplModal(existing) {
    const isEdit = !!existing;
    openModal({
      title: isEdit ? 'Edit Add-on' : 'New Add-on Template',
      body: `<div class="modal-form">
        <div class="form-group"><label class="form-label">Name</label>
          <input class="form-input" id="atpl-name" value="${existing?.name||''}" placeholder="e.g. Cardio, Admission, Locker"></div>
        <div class="form-group"><label class="form-label">Default Price (₹)</label>
          <input class="form-input" id="atpl-price" type="number" min="0" value="${existing?.default_price||''}"></div>
        <div class="form-group" style="flex-direction:row;align-items:center;gap:10px;">
          <label class="sculpt-switch"><input type="checkbox" id="atpl-onetime" ${existing?.is_one_time?'checked':''}><span class="sculpt-switch-slider"></span></label>
          <div><span style="font-size:var(--text-sm);color:var(--text-secondary);">One-time fee</span>
            <div style="font-size:var(--text-xs);color:var(--text-quaternary);">Won't appear in Renew modal (e.g. Admission)</div></div>
        </div>
      </div>`,
      footer: `<button class="btn btn-ghost" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="atpl-save">${isEdit?'Save':'Add'}</button>`,
      onOpen() {
        bindModalCancel();
        document.getElementById('atpl-save')?.addEventListener('click', async () => {
          const btn2 = document.getElementById('atpl-save');
          if (btn2) { btn2.disabled=true; btn2.textContent='Saving…'; }
          try {
            const data = { name:document.getElementById('atpl-name')?.value, defaultPrice:document.getElementById('atpl-price')?.value, isOneTime:document.getElementById('atpl-onetime')?.checked };
            if (isEdit) await updateAddonTemplate(existing.id, S.gym.id, data);
            else await addAddonTemplate(S.gym.id, data);
            closeModal();
            S.addonTemplates = await getAddonTemplates(S.gym.id);
            showToast(isEdit?'Add-on updated':'Add-on template added','green');
            _nav('gymconfig');
          } catch(err) { showToast(err.message||'Save failed','red'); if(btn2){btn2.disabled=false;btn2.textContent=isEdit?'Save':'Add';} }
        });
      }
    });
  }

  window._editAddonTpl = (id) => { const a=(S.addonTemplates||[]).find(x=>String(x.id)===String(id)); if(a) openAddonTplModal(a); };
  window._delAddonTpl = async (id) => {
    try { await deleteAddonTemplate(id, S.gym.id); S.addonTemplates = await getAddonTemplates(S.gym.id); showToast('Add-on deleted','green'); _nav('gymconfig'); }
    catch(err) { showToast(err.message||'Delete failed','red'); }
  };
}


function buildGSTPreview(pct, enabled) {
  if (!enabled) return `<div style="text-align:center;color:var(--text-quaternary);padding:16px;">GST is disabled</div>`;
  const sample = 1000;
  const halfPct = pct / 2;
  const base = sample / (1 + pct / 100);
  const gst = sample - base;
  return `<div style="font-size:13px;line-height:2;">
    <div style="display:flex;justify-content:space-between;"><span style="color:var(--text-tertiary);">Plan Price</span><span style="color:var(--text-primary);font-weight:600;">\u20B91,000</span></div>
    <div style="display:flex;justify-content:space-between;"><span style="color:var(--text-tertiary);">Taxable Amount</span><span>\u20B9${base.toFixed(2)}</span></div>
    <div style="display:flex;justify-content:space-between;"><span style="color:var(--text-tertiary);">CGST @ ${halfPct}%</span><span>\u20B9${(gst/2).toFixed(2)}</span></div>
    <div style="display:flex;justify-content:space-between;"><span style="color:var(--text-tertiary);">SGST @ ${halfPct}%</span><span>\u20B9${(gst/2).toFixed(2)}</span></div>
    <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border-subtle);padding-top:6px;margin-top:6px;"><span style="font-weight:600;color:var(--text-primary);">Total</span><span style="font-weight:600;color:var(--text-primary);">\u20B91,000</span></div>
  </div>`;
}

function applyLogoPending(dataUrl, mime) {
  pendingLogoDataUrl = dataUrl;
  pendingLogoMime = mime;
  const preview = document.getElementById('cfg-logo-preview');
  if (preview) {
    preview.innerHTML = `<img src="${dataUrl}" style="max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;">`;
  }
  const dropText = document.querySelector('#cfg-logo-dropzone .drop-text');
  if (dropText) dropText.textContent = 'Logo selected \u2014 click Save to upload';
}

export { renderGymConfig };