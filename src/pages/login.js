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
          <svg viewBox="90 128 410 162" width="90" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Flym" role="img">
                <path opacity="0.4" d="M124 188C221.333 134.667 340 122.667 480 152" stroke="#2A8FFF" stroke-width="3.5" stroke-linecap="round"/>
                <path d="M124 188C221.333 134.667 340 122.667 480 152" stroke="#2A8FFF" stroke-width="1.8" stroke-linecap="round"/>
                <path d="M480 161C484.971 161 489 156.971 489 152C489 147.029 484.971 143 480 143C475.029 143 471 147.029 471 152C471 156.971 475.029 161 480 161Z" stroke="#2A8FFF" stroke-width="1.8"/>
                <path d="M480 155.5C481.933 155.5 483.5 153.933 483.5 152C483.5 150.067 481.933 148.5 480 148.5C478.067 148.5 476.5 150.067 476.5 152C476.5 153.933 478.067 155.5 480 155.5Z" fill="#2A8FFF"/>
                <path d="M141.144 254H138.184V148.328H141.144V254ZM100 180.888V177.928H112.876V161.056C112.876 158.096 113.32 155.728 114.208 153.952C115.096 152.324 116.428 151.14 117.908 150.252C119.388 149.364 121.016 148.92 122.792 148.624C124.568 148.476 126.196 148.328 127.824 148.328C129.156 148.328 130.34 148.476 131.376 148.624C132.412 148.772 133.3 148.92 134.188 148.92V151.88C132.708 151.732 131.524 151.584 130.488 151.436C129.304 151.436 128.268 151.288 127.232 151.288C122.496 151.288 119.388 152.176 117.908 153.952C116.428 155.728 115.836 158.392 115.836 162.092V177.928H132.264V180.888H115.836V254H112.876V180.888H100Z" fill="#2A8FFF"/>
                <path d="M210.557 178.224L176.961 266.58C174.889 271.76 172.669 275.312 170.005 277.236C167.341 279.012 163.197 280.048 157.425 280.048H155.205V277.236C155.797 277.236 156.389 277.384 156.981 277.384C161.273 277.384 164.677 276.792 167.193 275.608C169.561 274.424 171.485 272.056 172.965 268.356C174.741 264.36 176.517 259.328 178.589 253.26L146.769 178.224H150.025L180.217 250.004L207.597 178.224H210.557Z" fill="#2A8FFF"/>
                <path d="M220.803 178.224V196.132C224.799 183.108 233.087 176.596 245.815 176.596C251.735 176.596 256.767 178.076 260.615 181.184C264.463 184.292 266.979 188.584 268.459 194.208C272.603 182.368 280.743 176.448 292.879 176.448C300.871 176.448 306.939 178.668 310.935 183.404C314.783 187.992 316.855 194.356 316.855 202.496V254.148H313.747V201.46C313.747 194.652 311.971 189.176 308.419 185.328C304.867 181.332 299.687 179.408 292.731 179.408C285.627 179.408 279.855 181.628 275.563 186.364C271.271 190.952 269.199 197.02 269.199 204.568V254H266.239V202.644C266.239 195.54 264.463 189.916 261.207 185.624C257.803 181.48 252.475 179.26 245.371 179.26C237.971 179.26 232.051 182.072 227.611 187.696C223.023 193.32 220.803 200.572 220.803 209.748V254H217.843V178.224H220.803Z" fill="#2A8FFF"/>
              </svg>
        </div>

        <h1 class="login-title">Welcome to Flym</h1>
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

    Object.defineProperty(window, '__flymSession', {
      value: { role, gym, branches: branches || [] },
      writable: true, enumerable: false, configurable: true,
    });
    setTimeout(() => router.go(role === 'admin' ? 'admin' : 'gym'), 150);

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
