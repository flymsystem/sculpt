// src/pages/login.js  —  v4 UNIFIED LOGIN
// ─────────────────────────────────────────────────────────────────
// v4 CHANGES:
//  1. Real <form> element so iOS/Chrome password managers fire the
//     autofill / save-password flow (bare inputs never trigger it).
//  2. Real input name attributes ('email', 'password') for autofill.
//  3. autocapitalize=off / spellcheck=false on email — prevents iOS
//     capitalizing the first character.
//  4. inputmode="email" on the email field for the right keyboard.
//  5. Password-toggle button no longer submits the form.
// ─────────────────────────────────────────────────────────────────

import { signIn } from '../lib/auth.js';
import { supabase } from '../lib/supabase.js';
import { showToast } from '../components/toast.js';

// Client-side rate limiting for login attempts
let _loginAttempts = 0;
let _lockoutUntil = 0;

export function renderLogin(router) {

  document.getElementById('root').innerHTML = `
    <div id="page-login">
      <div class="login-grid" aria-hidden="true"></div>
      <div class="login-glow" aria-hidden="true"></div>

      <form class="login-card" id="login-form" novalidate autocomplete="on">
        <div class="login-logo">
          <img src="/icon-192.png" alt="D Sculpt Fitness" width="72" height="72"
            style="border-radius:14px;display:block;margin:0 auto;">
        </div>

        <h1 class="login-title">Welcome to D Sculpt Fitness</h1>
        <div class="login-sub">Sign in with your credentials</div>

        <div class="login-error" id="login-error" role="alert" aria-live="polite"></div>

        <div class="form-group">
          <label class="form-label" for="login-email">Email</label>
          <input type="email" class="form-input" id="login-email" name="email"
            placeholder="you@gym.com" autocomplete="username" inputmode="email"
            autocapitalize="off" autocorrect="off" spellcheck="false"
            required aria-required="true">
        </div>
        <div class="form-group">
          <label class="form-label" for="login-pass">Password</label>
          <div style="position:relative;">
            <input type="password" class="form-input" id="login-pass" name="password"
              placeholder="••••••••" autocomplete="current-password"
              required aria-required="true"
              style="padding-right:44px;">
            <button id="toggle-pass" type="button" aria-label="Show password"
              style="position:absolute;right:12px;top:50%;transform:translateY(-50%);
                     background:none;border:none;color:var(--muted);cursor:pointer;padding:4px;
                     min-width:32px;min-height:32px;display:flex;align-items:center;justify-content:center;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          </div>
        </div>

        <button class="btn btn-primary btn-full" id="login-submit" type="submit" style="margin-top:6px;height:46px;">
          <span id="login-btn-text">Sign In →</span>
          <span id="login-spinner" class="spinner" aria-hidden="true"
            style="display:none;width:16px;height:16px;border-width:2px;"></span>
        </button>

        <div style="text-align:right;margin-top:10px;">
          <button type="button" id="forgot-pw" style="background:none;border:none;color:var(--muted);font-size:12px;cursor:pointer;padding:0;text-decoration:underline;text-underline-offset:3px;">Forgot password?</button>
        </div>

        <div class="login-back">
          <button type="button" id="back-home" style="background:none;border:none;color:inherit;font:inherit;cursor:pointer;padding:0;">← Back to home</button>
        </div>
      </form>
    </div>
  `;

  injectLoginStyles();

  const form = document.getElementById('login-form');
  form.addEventListener('submit', (e) => { e.preventDefault(); doLogin(router); });

  // Password show/hide
  document.getElementById('toggle-pass').addEventListener('click', () => {
    const inp = document.getElementById('login-pass');
    const btn = document.getElementById('toggle-pass');
    const showing = inp.type === 'text';
    inp.type = showing ? 'password' : 'text';
    btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  });

  document.getElementById('back-home').addEventListener('click', () => router.go('landing'));

  // Forgot password
  document.getElementById('forgot-pw').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    if (!email || !email.includes('@')) {
      showError('Enter your email address above, then tap Forgot password.');
      return;
    }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/login',
      });
      if (error) throw error;
      clearError();
      showToast('Password reset link sent to your email!', 'green');
    } catch (err) {
      showError(err.message || 'Could not send reset link. Please try again.');
    }
  });

  // Autofocus email field, but only if the browser didn't already autofill
  setTimeout(() => {
    const emailEl = document.getElementById('login-email');
    if (emailEl && !emailEl.value) emailEl.focus();
  }, 100);
}

// ── Login handler ────────────────────────────────────────────────
async function doLogin(router) {
  const btn = document.getElementById('login-submit');
  if (btn?.disabled) return;

  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;

  clearError();

  if (!email) { showError('Please enter your email address.'); return; }
  if (!pass)  { showError('Please enter your password.'); return; }
  if (!email.includes('@')) { showError('Please enter a valid email address.'); return; }

  // Client-side rate limiting: exponential backoff after 3 failures
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
    const loginPromise   = signIn(email, pass);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('__TIMEOUT__')), 30000)
    );

    const { role, gym, branches } = await Promise.race([loginPromise, timeoutPromise]);

    // Reset rate limit on success
    _loginAttempts = 0;
    _lockoutUntil = 0;

    Object.defineProperty(window, '__sculptSession', {
      value: { role, gym, branches: branches || [] },
      writable: true, enumerable: false, configurable: true,
    });
    setTimeout(() => router.go('gym'), 150);

  } catch (err) {
    let msg = err.message || 'Login failed. Please try again.';
    if (msg === '__TIMEOUT__' || msg.toLowerCase().includes('timed out')) {
      msg = 'Connection timed out. This usually means your network is blocking the request. Try switching from WiFi to mobile data (or vice versa), or disabling VPN.';
    } else if (msg.toLowerCase().includes('invalid login') ||
        msg.toLowerCase().includes('invalid credentials') ||
        msg.toLowerCase().includes('email not confirmed')) {
      msg = 'Incorrect email or password. Please check and try again.';
    } else if (msg.toLowerCase().includes('network') || msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('load failed')) {
      msg = 'Network error. Please check your internet connection and try again.';
    } else if (msg.toLowerCase().includes('too many requests') || msg.toLowerCase().includes('rate limit')) {
      msg = 'Too many login attempts. Please wait a few minutes and try again.';
    } else if (msg.toLowerCase().includes('user not found') || msg.toLowerCase().includes('no user')) {
      msg = 'No account found with this email. Please check the email address.';
    }
    // Escalate rate limit on failure
    _loginAttempts++;
    if (_loginAttempts >= 3) {
      const delaySec = Math.min(60, 5 * Math.pow(2, _loginAttempts - 3)); // 5s, 10s, 20s, 40s, 60s
      _lockoutUntil = Date.now() + delaySec * 1000;
      msg += ` Please wait ${delaySec}s before trying again.`;
    }

    showError(msg);
    setLoading(false);
  }
}

// ── Helpers ──────────────────────────────────────────────────────
function showError(msg) {
  const el = document.getElementById('login-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

function clearError() {
  const el = document.getElementById('login-error');
  if (el) { el.textContent = ''; el.style.display = 'none'; }
}

function setLoading(on) {
  const btn     = document.getElementById('login-submit');
  const btnText = document.getElementById('login-btn-text');
  const spinner = document.getElementById('login-spinner');
  if (!btn) return;
  btn.disabled          = on;
  btnText.style.display = on ? 'none'         : 'inline';
  spinner.style.display = on ? 'inline-block' : 'none';
  btn.setAttribute('aria-busy', String(on));
}

// ── Styles ───────────────────────────────────────────────────────
function injectLoginStyles() {
  if (document.getElementById('login-styles')) return;
  const style = document.createElement('style');
  style.id = 'login-styles';
  style.textContent = `
    #page-login {
      min-height: 100vh; min-height: 100dvh;
      display: flex; align-items: center; justify-content: center;
      position: relative; overflow: hidden; padding: 20px;
      padding-top: max(20px, env(safe-area-inset-top, 0px));
      padding-bottom: max(20px, env(safe-area-inset-bottom, 0px));
    }
    .login-grid {
      position: fixed; inset: 0; pointer-events: none;
      background-image:
        linear-gradient(rgba(42,143,255,0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(42,143,255,0.03) 1px, transparent 1px);
      background-size: 44px 44px;
    }
    .login-glow {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);
      width: 500px; height: 500px;
      background: radial-gradient(circle, rgba(42,143,255,0.07) 0%, transparent 65%);
      pointer-events: none;
    }
    .login-card {
      position: relative; z-index: 2; width: 420px; max-width: 100%;
      background: var(--panel2); border: 1px solid var(--border);
      border-radius: var(--radius-md); padding: 44px 40px;
      animation: fadeUp 0.45s ease both;
      display: block;
    }
    .login-logo   { display: flex; justify-content: center; margin-bottom: 28px; }
    .login-title  { font-family: var(--font-head); font-size: 22px; font-weight: 700; text-align: center; margin: 0 0 6px; color: var(--text-primary); }
    .login-sub    { font-size: 13px; color: var(--muted); text-align: center; margin-bottom: 28px; }

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
      .login-card { padding: 32px 22px; }
    }
  `;
  document.head.appendChild(style);
}
