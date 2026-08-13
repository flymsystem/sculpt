// Dashboard helpers — pure functions, no side effects
import { S } from './state.js';

/**
 * Local calendar-day "YYYY-MM-DD" string — NOT `new Date().toISOString().split('T')[0]`,
 * which reads UTC and is wrong for ~5.5 hours every day in IST (00:00–05:29 local
 * is still "yesterday" in UTC). Use this anywhere "today's date" means the gym
 * owner's local today, not UTC's.
 */
function todayLocalISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

/**
 * Formats a Date object to a local "YYYY-MM-DD" string without UTC conversion.
 * Use this instead of `d.toISOString().split('T')[0]` which shifts dates for
 * timezones ahead of UTC (IST midnight → previous day in UTC).
 */
function localISO(d) {
  if (!d || isNaN(d)) return null;
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

/**
 * True if dateVal falls on the same LOCAL calendar day as `ref` (defaults to now).
 * Handles bare "YYYY-MM-DD" dates (parsed as local, not UTC-midnight) and full
 * timestamps alike. Use this instead of string-prefix-matching an ISO string
 * against a UTC-derived "today" — that comparison silently breaks near IST midnight.
 */
function isSameLocalDay(dateVal, ref) {
  if (!dateVal) return false;
  ref = ref || new Date();
  let d;
  if (typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
    const [y, mo, da] = dateVal.split('-').map(Number);
    d = new Date(y, mo - 1, da);
  } else {
    d = new Date(dateVal);
  }
  if (isNaN(d)) return false;
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
}

function bindDateInput(el) {
  if (!el || el._dateBound) return;
  el._dateBound = true;
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  if (isMobile) {
    // FIX: Save value BEFORE changing type — mobile browsers clear the value
    // when switching from text to date because DD/MM/YYYY is invalid for type=date.
    // This was causing the Edit Member modal to lose the pre-filled join date.
    const savedVal = el.value;
    el.type = 'date'; el.removeAttribute('placeholder'); el.removeAttribute('maxlength');
    if (savedVal && savedVal.includes('/')) {
      const iso = parseDateInput(savedVal);
      if (iso) el.value = iso;
    } else if (savedVal && /^\d{4}-\d{2}-\d{2}$/.test(savedVal)) {
      el.value = savedVal;
    }
    if (el.dataset.today && !el.value) el.value = todayLocalISO();
    return;
  }
  el.addEventListener('input', function() {
    let val = this.value.replace(/[^\d]/g, '');
    let dd = val.substring(0,2), mm = val.substring(2,4), yyyy = val.substring(4,8);
    if (dd && parseInt(dd) > 31) dd = '31';
    if (mm && parseInt(mm) > 12) mm = '12';
    if (mm && parseInt(mm) < 1 && mm.length === 2) mm = '01';
    let out = dd;
    if (val.length >= 3) out += '/' + mm;
    if (val.length >= 5) out += '/' + yyyy;
    this.value = out;
  });
  el.addEventListener('blur', function() {
    const iso = parseDateInput(this.value);
    // Used to set only a red border + a `title` tooltip — title isn't an
    // accessible error mechanism (no screen-reader announcement, doesn't
    // appear at all on touch) and nothing told the user WHY until they
    // happened to hover. setFieldError() gives it a real, visible,
    // programmatically-associated message instead (AUDIT.md C8).
    if (this.value && !iso) { setFieldError(this, 'Enter date as DD/MM/YYYY.'); }
    else { clearFieldError(this); if (iso) this.value = fmtDateInput(iso); }
  });
  el.addEventListener('input', function() { clearFieldError(this); });
}
function fmtDateInput(iso) {
  if (!iso) return '';
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return parts[2] + '/' + parts[1] + '/' + parts[0];
}
function parseDateInput(val) {
  if (!val) return null;
  val = val.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const m = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const dd = m[1].padStart(2,'0'), mm = m[2].padStart(2,'0'), yyyy = m[3];
  if (parseInt(mm) < 1 || parseInt(mm) > 12) return null;
  if (parseInt(dd) < 1 || parseInt(dd) > 31) return null;
  return yyyy + '-' + mm + '-' + dd;
}
function parsePlanData(p) {
  try { const parsed = JSON.parse(p.features || '{}'); if (parsed && parsed.featuresList !== undefined) return { featuresList: parsed.featuresList || '' }; } catch(e) {}
  return { featuresList: p.features || '' };
}
function parseMemberAddons(m) {
  try { const raw = m.member_addons; if (!raw) return []; const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; } catch(e) { return []; }
}
function memberTotalPrice(m) { return parseFloat(m.plan_price) || 0; }
function planTotalPrice(p) { return parseFloat(p.price) || 0; }
function expiryDate(m) {
  if (m.expiry_date) { const [y,mo,d] = m.expiry_date.split('-').map(Number); if (y && mo && d) return new Date(y, mo-1, d); }
  const dur = m.plan_duration_months || m.duration;
  if (!m.join_date || !dur || dur < 1) return null;
  const [jy, jmo, jd] = m.join_date.split('-').map(Number);
  if (!jy) return null;
  const date = new Date(jy, jmo-1, jd); date.setMonth(date.getMonth() + parseInt(dur)); return date;
}
function daysLeft(m) { const e=expiryDate(m); if(!e) return null; return Math.ceil((e-new Date())/86400000); }

/**
 * Returns the member's lifecycle + payment status.
 *
 * Priority order:
 *   1. Cancelled  — `cancelled_at` is set
 *   2. Trial      — member_type=Trial (Expired if past expiry)
 *   3. Expired    — past expiry date (regardless of payment)
 *   4. Due        — payment_status='Due' (unpaid, takes priority over Expiring)
 *   5. Partial    — payment_status='Partial' (partial payment, takes priority over Expiring)
 *   6. Expiring   — within reminder_days of expiry
 *   7. Active     — default
 *
 * Key fix: Due/Partial now take priority over Expiring. A member whose plan is
 * expiring in 3 days AND has unpaid balance should surface the payment issue,
 * not just the expiry warning.
 */
function memberStatus(m) {
  if (m.cancelled_at) return 'Cancelled';
  const mType = m.member_type || m.memberType;
  const days = daysLeft(m);
  const pSt = m.payment_status || m.status;
  const warnDays = (S.gym?.reminder_days) || 7;

  if (mType === 'Trial') {
    if (days !== null && days < 0) return 'Expired';
    return 'Trial';
  }

  // Expired takes top priority among non-cancelled non-trial
  if (days !== null && days < 0) return 'Expired';

  // Payment issues surface before expiry warnings
  if (pSt === 'Due') return 'Due';
  if (pSt === 'Partial') return 'Due';

  // Expiring soon
  if (days !== null && days >= 0 && days <= warnDays) return 'Expiring';

  return 'Active';
}

/**
 * Returns the outstanding (collectible) amount for a member.
 * Trusts `balance_due` if explicitly set (even 0); falls back to `plan_price`
 * for pre-migration members who don't have the column yet.
 */
function outstandingAmount(m) {
  const bal = parseFloat(m.balance_due);
  // balance_due is explicitly set (including 0) — trust it
  if (!isNaN(bal) && bal >= 0) return bal;
  // Fallback for pre-migration members without balance_due column
  const pSt = m.payment_status || m.status;
  if (pSt === 'Due' || pSt === 'Partial') return parseFloat(m.plan_price) || 0;
  return 0;
}

function isNewThisMonth(m) {
  const d=new Date(m.join_date||m.created_at), n=new Date();
  return d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear();
}
function memberTotal(m) { return parseFloat(m.plan_price) || 0; }
function genInvoiceNo() {
  const now = new Date();
  const date = [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('');
  return `INV-${date}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
}
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function escAttr(s) {
  if (!s) return '';
  const jsEsc = String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return escHtml(jsEsc);
}

// DD/MM/YYYY consistently
function fmtDate(d) {
  if (!d) return '\u2014';
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, mo, dy] = d.split('-').map(Number);
    const date = new Date(y, mo - 1, dy);
    return String(date.getDate()).padStart(2,'0') + '/' + String(date.getMonth()+1).padStart(2,'0') + '/' + date.getFullYear();
  }
  const date = new Date(d);
  if (isNaN(date)) return '\u2014';
  return String(date.getDate()).padStart(2,'0') + '/' + String(date.getMonth()+1).padStart(2,'0') + '/' + date.getFullYear();
}
function fmtDateShort(d) {
  if (!d) return '\u2014';
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) { const [y,mo,dy]=d.split('-').map(Number); return new Date(y,mo-1,dy).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}); }
  return new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
}
function fmtCurrency(n) { return '\u20B9' + (parseFloat(n)||0).toLocaleString('en-IN'); }
function fmtCurrencyShort(n) {
  const num = parseFloat(n)||0;
  if (num >= 100000) return '\u20B9' + (num/100000).toFixed(1) + 'L';
  if (num >= 1000) return '\u20B9' + (num/1000).toFixed(1) + 'K';
  return '\u20B9' + num.toLocaleString('en-IN');
}
function av2(name) { return (name||'?').split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase(); }
function timeAgo(ds) {
  if (!ds) return '\u2014';
  const diff = Date.now() - new Date(ds);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDateShort(ds);
}
function ico(n) {
  const icons = {
    grid:`<svg class="nav-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`,
    users:`<svg class="nav-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    card:`<svg class="nav-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`,
    clock:`<svg class="nav-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    check:`<svg class="nav-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
    cog:`<svg class="nav-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>`,
    finance:`<svg class="nav-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
    lock:`<svg class="nav-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
    bell:`<svg class="nav-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
    logout:`<svg class="nav-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
    clipboard:`<svg class="nav-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>`,
    broadcast:`<svg class="nav-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
  };
  return icons[n]||'';
}
function demoPlans() {
  return [
    { id:'p1', name:'1 Month Plan', duration_months:1, price:1200, features:'Unlimited access,Locker room' },
    { id:'p2', name:'3 Month Plan', duration_months:3, price:3000, features:'Unlimited access,Locker room,Personal trainer' },
    { id:'p3', name:'Yearly Plan', duration_months:12, price:9999, features:'All access,Locker room,Personal trainer,Supplements' },
  ];
}
function demoMembers() {
  const today=new Date();
  const d=(offset)=>{const x=new Date(today);x.setDate(x.getDate()-offset);return x.toISOString().split('T')[0];};
  const exp=(joinOffset,months)=>{const x=new Date(today);x.setDate(x.getDate()-joinOffset);x.setMonth(x.getMonth()+months);return x.toISOString().split('T')[0];};
  return [
    { id:'m1', full_name:'Rahul Sharma', phone:'+91 98765 43210', join_date:d(30), plan_name:'3 Month Plan', plan_price:3500, plan_duration_months:3, payment_mode:'Cash', payment_status:'Paid', member_type:'Paid', expiry_date:exp(30,3), created_at:d(30), member_addons:'[{"name":"Cardio","price":500}]' },
    { id:'m2', full_name:'Priya Nair', phone:'+91 87654 32109', join_date:d(350), plan_name:'Yearly Plan', plan_price:9999, plan_duration_months:12, payment_mode:'Online', payment_status:'Paid', member_type:'Paid', expiry_date:exp(350,12), created_at:d(350) },
    { id:'m3', full_name:'Arun Menon', phone:'+91 76543 21098', join_date:d(28), plan_name:'1 Month Plan', plan_price:1200, plan_duration_months:1, payment_mode:'Cash', payment_status:'Due', member_type:'Unpaid', expiry_date:exp(28,1), created_at:d(28) },
    { id:'m4', full_name:'Suresh Kumar', phone:'+91 65432 10987', join_date:d(100), plan_name:'3 Month Plan', plan_price:3500, plan_duration_months:3, payment_mode:'Cash', payment_status:'Paid', member_type:'Paid', expiry_date:exp(100,3), created_at:d(100), member_addons:'[{"name":"Cardio","price":500}]' },
    { id:'m5', full_name:'Meera Pillai', phone:'+91 54321 09876', join_date:d(2), plan_name:null, plan_price:0, plan_duration_months:0, payment_mode:null, payment_status:'Paid', member_type:'Trial', expiry_date:exp(2,0), created_at:d(2) },
    { id:'m6', full_name:'Kiran Raj', phone:'+91 43210 98765', join_date:d(80), plan_name:'3 Month Plan', plan_price:3000, plan_duration_months:3, payment_mode:'Cash', payment_status:'Paid', member_type:'Paid', expiry_date:exp(80,3), created_at:d(80) },
  ];
}
function showSectionLoading(c, title) {
  c.innerHTML = `<div class="content-inner page-enter">
    <div class="page-header"><div class="page-header-left"><div class="page-title">${escHtml(title)}</div>
      <div class="page-sub" style="color:var(--text-tertiary);">Loading\u2026</div></div></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin-bottom:24px;">
      ${[1,2,3,4].map(()=>`<div class="skeleton-card"><div class="skeleton skeleton-text" style="width:60%;"></div><div class="skeleton" style="height:28px;width:40%;border-radius:4px;margin-bottom:8px;"></div><div class="skeleton skeleton-text" style="width:80%;"></div></div>`).join('')}
    </div>
    <div class="skeleton-card" style="padding:40px;display:flex;align-items:center;justify-content:center;">
      <div style="display:flex;align-items:center;gap:10px;color:var(--text-tertiary);font-size:var(--text-sm);"><div class="spinner"></div>Fetching data\u2026</div>
    </div>
  </div>`;
}

/**
 * Standard "nothing here yet" state. Was hand-copied into 9 different
 * pages with slightly different markup each time (AUDIT.md C4) \u2014 this is
 * the one version everything should converge on.
 *
 * @param {HTMLElement} c
 * @param {{icon?:string, title:string, hint?:string, actionLabel?:string, onAction?:Function}} opts
 */
function renderEmpty(c, { icon = '\ud83d\udcc2', title, hint = '', actionLabel = '', onAction } = {}) {
  c.innerHTML = `<div class="empty-state" style="padding:60px;">
    <span class="empty-icon">${icon}</span>
    <div class="empty-title">${escHtml(title)}</div>
    ${hint ? `<p>${escHtml(hint)}</p>` : ''}
    ${actionLabel ? `<button class="btn btn-primary btn-sm" id="empty-state-action">${escHtml(actionLabel)}</button>` : ''}
  </div>`;
  if (actionLabel && onAction) {
    c.querySelector('#empty-state-action')?.addEventListener('click', onAction);
  }
}

/**
 * Standard section-load-failed state, with a working Retry button.
 * Never render stale data silently \u2014 if a fetch failed, say so instead
 * of showing whatever the array happened to hold before.
 *
 * @param {HTMLElement} c
 * @param {{message?:string, onRetry?:Function}} opts
 */
function renderError(c, { message = 'Please check your internet connection and try again.', onRetry } = {}) {
  c.innerHTML = `<div class="empty-state" style="padding:60px;">
    <span class="empty-icon">\u26a0\ufe0f</span>
    <div class="empty-title">Could not load this section</div>
    <p>${escHtml(message)}</p>
    ${onRetry ? `<button class="btn btn-primary btn-sm" id="section-error-retry">\ud83d\udd04 Retry</button>` : ''}
  </div>`;
  if (onRetry) c.querySelector('#section-error-retry')?.addEventListener('click', onRetry);
}

/**
 * Standard form-field error (AUDIT.md C8). Three inconsistent patterns
 * existed before this: a border that flashed red for 1200ms then
 * vanished, a toast that appeared away from the field and auto-dismissed,
 * and nothing at all. None set aria-invalid or tied the message to the
 * field, so a screen-reader user got no error at all in every case.
 *
 * The message persists until clearFieldError() is called — normally
 * wired to the field's own 'input' event, so it clears the moment the
 * user starts correcting it.
 *
 * @param {HTMLElement} inputEl
 * @param {string} message
 */
function setFieldError(inputEl, message) {
  if (!inputEl) return;
  clearFieldError(inputEl);
  inputEl.style.borderColor = 'var(--red)';
  inputEl.setAttribute('aria-invalid', 'true');
  const id = (inputEl.id || 'field') + '-error';
  const err = document.createElement('div');
  err.className = 'form-error';
  err.id = id;
  err.setAttribute('role', 'alert');
  err.textContent = message;
  inputEl.setAttribute('aria-describedby', id);
  inputEl.insertAdjacentElement('afterend', err);
}

/** Removes whatever setFieldError() added. Safe to call unconditionally. */
function clearFieldError(inputEl) {
  if (!inputEl) return;
  inputEl.style.borderColor = '';
  inputEl.removeAttribute('aria-invalid');
  const describedBy = inputEl.getAttribute('aria-describedby');
  inputEl.removeAttribute('aria-describedby');
  const err = describedBy ? document.getElementById(describedBy) : inputEl.nextElementSibling;
  if (err && err.classList.contains('form-error')) err.remove();
}

function pctChange(current, previous) {
  if (!previous || previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

export {
  bindDateInput, fmtDateInput, parseDateInput, todayLocalISO, localISO, isSameLocalDay,
  parsePlanData, parseMemberAddons, memberTotalPrice, planTotalPrice,
  expiryDate, daysLeft, memberStatus, outstandingAmount, isNewThisMonth, memberTotal,
  genInvoiceNo, escHtml, escAttr, fmtDate, fmtDateShort, fmtCurrency, fmtCurrencyShort,
  av2, timeAgo, ico,
  demoPlans, demoMembers, showSectionLoading, renderEmpty, renderError,
  setFieldError, clearFieldError,
  pctChange
};