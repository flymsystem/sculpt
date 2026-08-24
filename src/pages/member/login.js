// src/pages/member/login.js — member login: application number + phone.
//
// Built for someone on a phone who was sent a WhatsApp message and has
// never used this app before. Two fields, one button, forgiving of a
// wrong number (see ui copy below) without ever hinting which of the
// two fields was wrong — see supabase/functions/member-signin/index.ts
// for why that's a hard security rule, not a UX nicety.
import { memberSignIn } from '../../lib/member-auth.js';

let _attempts = 0;
let _lockoutUntil = 0;

export function renderMemberLogin(router) {
  document.getElementById('root').innerHTML = `
    <div id="page-login">
      <div class="login-glow" aria-hidden="true"></div>

      <form class="login-card" id="member-login-form" novalidate autocomplete="on">
        <div class="login-logo">
          <img src="/logo-256.png" alt="D Sculpt Fitness" width="120" height="120"
            style="display:block;margin:0 auto;">
        </div>

        <h1 class="login-title">Welcome back</h1>
        <div class="login-sub">Sign in with the details from your welcome message</div>

        <div class="login-error" id="member-login-error" role="alert" aria-live="polite"></div>

        <div class="form-group">
          <label class="form-label" for="member-appnum">Application Number</label>
          <input type="text" class="form-input" id="member-appnum" name="applicationNumber"
            placeholder="SC-0001-A2B" autocomplete="off" autocapitalize="characters"
            autocorrect="off" spellcheck="false" required aria-required="true" maxlength="11"
            style="text-transform:uppercase;letter-spacing:0.04em;font-family:var(--font-mono);">
          <div class="form-hint" id="member-appnum-hint"></div>
        </div>
        <div class="form-group">
          <label class="form-label" for="member-phone">Phone Number</label>
          <input type="tel" class="form-input" id="member-phone" name="phone"
            placeholder="98765 43210" autocomplete="tel" inputmode="numeric" maxlength="10"
            required aria-required="true">
          <div class="form-hint" id="member-phone-hint"></div>
        </div>

        <button class="btn btn-primary btn-full" id="member-login-submit" type="submit" disabled style="margin-top:6px;height:46px;">
          <span id="member-login-btn-text">Continue →</span>
          <span id="member-login-spinner" class="spinner" aria-hidden="true"
            style="display:none;width:16px;height:16px;border-width:2px;"></span>
        </button>

        <div style="text-align:center;margin-top:16px;font-size:12px;color:var(--text-tertiary);line-height:1.6;">
          Can't find your application number? Ask the front desk to resend it.
        </div>

        <div class="login-back">
          <button type="button" id="member-back-home" style="background:none;border:none;color:inherit;font:inherit;cursor:pointer;padding:0;">← Back to home</button>
        </div>
      </form>
    </div>
  `;

  injectMemberLoginStyles();

  const form = document.getElementById('member-login-form');
  form.addEventListener('submit', (e) => { e.preventDefault(); doMemberLogin(router); });
  document.getElementById('member-back-home').addEventListener('click', () => router.go('landing'));

  document.getElementById('member-phone').addEventListener('input', onPhoneInput);
  document.getElementById('member-appnum').addEventListener('input', onAppNumInput);
  updateSubmitState();

  setTimeout(() => document.getElementById('member-appnum')?.focus(), 100);
}

// People paste from Contacts — a pasted "+91 98765 43210" or "091-98765-43210"
// must resolve to the same 10 digits as typing them, so this keeps the LAST
// 10 digits of whatever's in the field rather than rejecting the paste or
// truncating from the front (which would keep the country code instead).
function onPhoneInput(e) {
  const digits = e.target.value.replace(/\D/g, '').slice(-10);
  if (digits !== e.target.value) e.target.value = digits;
  updateSubmitState();
}

// SC-####-XXX: letters/digits/hyphens only, force uppercase as they type.
function onAppNumInput(e) {
  const clean = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 11);
  if (clean !== e.target.value) e.target.value = clean;
  updateSubmitState();
}

const APPNUM_RE = /^SC-\d{4}-[A-Z0-9]{3}$/;

function updateSubmitState() {
  const phone = document.getElementById('member-phone')?.value || '';
  const appNum = document.getElementById('member-appnum')?.value || '';
  const phoneHint = document.getElementById('member-phone-hint');
  const appNumHint = document.getElementById('member-appnum-hint');
  const btn = document.getElementById('member-login-submit');

  if (phoneHint) {
    phoneHint.textContent = phone.length === 0 ? '' :
      phone.length < 10 ? `${10 - phone.length} more digit${10 - phone.length === 1 ? '' : 's'}` : '';
  }
  if (appNumHint) {
    appNumHint.textContent = appNum.length === 0 || APPNUM_RE.test(appNum)
      ? '' : 'Format: SC-0001-A2B';
  }

  const ready = phone.length === 10 && APPNUM_RE.test(appNum);
  if (btn) btn.disabled = !ready;
}

async function doMemberLogin(router) {
  const btn = document.getElementById('member-login-submit');
  if (btn?.disabled) return;

  const appNum = document.getElementById('member-appnum').value.trim();
  const phone  = document.getElementById('member-phone').value.trim();

  clearError();

  if (!appNum) { showError('Please enter your application number.'); return; }
  if (!phone)  { showError('Please enter your phone number.'); return; }

  const now = Date.now();
  if (_lockoutUntil > now) {
    const secsLeft = Math.ceil((_lockoutUntil - now) / 1000);
    showError(`Too many attempts. Please wait ${secsLeft} seconds before trying again.`);
    return;
  }

  setLoading(true);

  if (!navigator.onLine) {
    showError('No internet connection. Please check your WiFi or mobile data and try again.');
    setLoading(false);
    return;
  }

  try {
    await memberSignIn(appNum, phone);
    _attempts = 0;
    _lockoutUntil = 0;
    window.__sculptMemberSession = true;
    setTimeout(() => router.go('member'), 150);
  } catch (err) {
    // The server already returns the same generic message for a wrong
    // application number vs a wrong phone number — this screen must not
    // re-introduce a distinction the server deliberately removed.
    let msg = err.message || 'Sign in failed. Please try again.';
    if (/too many attempts/i.test(msg)) {
      // Server-side rate limit already fired — no need to also layer a
      // client-side one on top for this response.
    } else {
      _attempts++;
      if (_attempts >= 3) {
        const delaySec = Math.min(60, 5 * Math.pow(2, _attempts - 3));
        _lockoutUntil = Date.now() + delaySec * 1000;
        msg += ` Please wait ${delaySec}s before trying again.`;
      }
    }
    showError(msg);
    setLoading(false);
  }
}

function showError(msg) {
  const el = document.getElementById('member-login-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

function clearError() {
  const el = document.getElementById('member-login-error');
  if (el) { el.textContent = ''; el.style.display = 'none'; }
}

function setLoading(on) {
  const btn = document.getElementById('member-login-submit');
  const btnText = document.getElementById('member-login-btn-text');
  const spinner = document.getElementById('member-login-spinner');
  if (!btn) return;
  btn.disabled = on;
  btnText.style.display = on ? 'none' : 'inline';
  spinner.style.display = on ? 'inline-block' : 'none';
  btn.setAttribute('aria-busy', String(on));
}

// Reuses the exact #page-login / .login-card visual language from
// src/pages/login.js so the member login doesn't introduce a second
// visual style for "a login screen" — see CLAUDE.md "Design system".
function injectMemberLoginStyles() {
  if (document.getElementById('member-login-styles')) return;
  const style = document.createElement('style');
  style.id = 'member-login-styles';
  style.textContent = `
    #page-login {
      min-height: 100vh; min-height: 100dvh;
      display: flex; align-items: center; justify-content: center;
      position: relative; overflow: hidden; padding: 20px;
      padding-top: max(20px, env(safe-area-inset-top, 0px));
      padding-bottom: max(20px, env(safe-area-inset-bottom, 0px));
    }
    .login-glow {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);
      width: 500px; height: 500px;
      background: radial-gradient(circle, rgba(10,132,255,0.10) 0%, transparent 65%);
      pointer-events: none;
    }
    .login-card {
      position: relative; z-index: 2; width: 440px; max-width: 100%;
      background: var(--panel2); border: 1px solid var(--border);
      border-radius: var(--radius-lg); padding: 48px 40px 40px;
      box-shadow: var(--shadow-lg);
      animation: fadeUp 0.45s ease both;
      display: block;
    }
    .login-logo   { display: flex; justify-content: center; margin-bottom: 24px; }
    .login-logo img { width: 120px; height: 120px; }
    .login-title  { font-family: var(--font-head); font-size: var(--text-3xl); font-weight: var(--font-bold); letter-spacing: var(--tracking-tight); text-align: center; margin: 0 0 6px; color: var(--text-primary); }
    .login-sub    { font-size: var(--text-md); color: var(--text-tertiary); text-align: center; margin-bottom: 30px; }
    #page-login .form-input { height: 46px; border-radius: var(--radius-md); }
    #page-login .form-input:focus-visible,
    #page-login .form-input:focus {
      outline: none; border-color: var(--border-focus);
      box-shadow: var(--shadow-focus);
    }
    #member-login-submit[disabled] { opacity: 0.55; cursor: not-allowed; }
    .form-hint {
      min-height: 15px; font-size: 11px; color: var(--text-tertiary);
      margin-top: 4px; line-height: 1.4;
    }
    .login-error {
      display: none; background: rgba(255,77,77,0.08);
      border: 1px solid rgba(255,77,77,0.3); color: var(--red);
      font-size: 13px; padding: 10px 13px;
      border-radius: var(--radius-sm); margin-bottom: 14px; line-height: 1.5;
    }
    .login-back {
      text-align: center; margin-top: 20px;
      font-size: 12px; color: var(--muted);
    }
    .login-back button:hover { color: var(--white); }
    @media (max-width: 480px) {
      .login-card { padding: 36px 22px 28px; }
      .login-logo img { width: 96px; height: 96px; }
      .login-logo { margin-bottom: 20px; }
    }
  `;
  document.head.appendChild(style);
}
