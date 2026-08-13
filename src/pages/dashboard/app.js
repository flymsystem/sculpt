// src/app.js
import './styles/global.css';
import './styles/components.css';

import { renderLanding }        from './pages/landing.js';
import { renderLogin }          from './pages/login.js';
import { renderGymDashboard }   from './pages/dashboard/index.js';
import { renderAdminDashboard } from './pages/admin-dashboard.js';
import { renderVerify }         from './pages/verify.js';
import { getAuthUser, getMyProfile, onAuthStateChange } from './lib/auth.js';
import { ensureFreshSession } from './lib/supabase.js';

const APP_BASE = new URL(import.meta.env.BASE_URL || '/', window.location.origin);

function appPath(path) {
  return new URL(path.replace(/^\//, ''), APP_BASE).pathname;
}

// ── Auth state listener ───────────────────────────────────────────
onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
    window.__flymSession = null;
    router.go('landing');
  }
});

// ── Global error boundary ─────────────────────────────────────────
window.addEventListener('unhandledrejection', (e) => {
  console.error('[Flym] Unhandled promise rejection:', e.reason);
  e.preventDefault();
});
window.addEventListener('error', (e) => {
  console.error('[Flym] Uncaught error:', e.error);
});

// ── PWA lifecycle: refresh auth when tab becomes visible ──────────
let _lastVisibilityCheck = 0;
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  const now = Date.now();
  if (now - _lastVisibilityCheck < 10_000) return;
  _lastVisibilityCheck = now;

  if (window.__flymSession) {
    const ok = await ensureFreshSession();
    if (!ok) {
      window.__flymSession = null;
      if (router.current !== 'landing' && router.current !== 'login' && router.current !== 'verify') {
        router.go('login');
      }
    }
  }
});

window.addEventListener('pageshow', async (e) => {
  if (e.persisted && window.__flymSession) {
    const ok = await ensureFreshSession();
    if (!ok) {
      window.__flymSession = null;
      router.go('login');
    }
  }
});

// ── Theme controller ──────────────────────────────────────────────
window.__flymThemeController = {
  get() { return document.documentElement.getAttribute('data-theme') || 'dark'; },
  set(theme) {
    if (theme !== 'dark' && theme !== 'light') return;
    document.documentElement.classList.add('theme-switching');
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('flym-theme', theme); } catch (_) {}
    window.__flymTheme = theme;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.documentElement.classList.remove('theme-switching');
    }));
    window.dispatchEvent(new CustomEvent('flym:themechange', { detail: { theme } }));
  },
  toggle() { this.set(this.get() === 'dark' ? 'light' : 'dark'); },
};
window.addEventListener('storage', (e) => {
  if (e.key === 'flym-theme' && e.newValue) window.__flymThemeController.set(e.newValue);
});

// ── URL helpers ───────────────────────────────────────────────────
const PAGE_TO_PATH = {
  landing: '/',
  login:   '/login',
  gym:     '/dashboard',
  admin:   '/admin',
  verify:  '/verify',
};
const PATH_TO_PAGE = {
  '/':          'landing',
  '/login':     'login',
  '/dashboard': 'gym',
  '/admin':     'admin',
  '/verify':    'verify',
};

function pageFromPath(path) {
  const clean = path.replace(/\/$/, '') || '/';
  if (clean.startsWith('/dashboard')) return 'gym';
  if (clean.startsWith('/admin'))     return 'admin';
  if (clean.startsWith('/verify'))    return 'verify';
  return PATH_TO_PAGE[clean] || null;
}

function pushURL(page) {
  const path = PAGE_TO_PATH[page] || '/';
  if (window.location.pathname !== path) {
    history.pushState({ page }, '', path);
  }
}

// ── Cleanup registry ──────────────────────────────────────────────
const _cleanupTasks = new Set();
window.__flymRegisterCleanup = (fn) => {
  if (typeof fn === 'function') _cleanupTasks.add(fn);
};
window.__flymRunCleanup = () => {
  _cleanupTasks.forEach((fn) => { try { fn(); } catch (_) {} });
  _cleanupTasks.clear();
};

// Legacy window-global cleanup (existing modules still assign these)
const LEGACY_GLOBALS = [
  '__aDeact','__aViewGym','__aSendWA','__aMarkSent','__beDelEntry','cpVal',
  '_navTo',
  '_inv','_wa','_renew','_clearBal','_editPlan','_delPlan','_dupPlan',
  '__renewDelAddon','_editExpense','_delExpense','_editAddonTpl','_delAddonTpl',
  '__pendingAddPhoto','__pendingEditPhoto',
];

// ── Router ────────────────────────────────────────────────────────
export const router = {
  current: null,
  _navigating: false,
  _navId: 0,

  go(page, opts = {}) {
    if (this._navigating && page === this.current) return;
    this._navigating = true;
    this._navId++;
    const previous = this.current;
    this.current = page;
    window.scrollTo(0, 0);

    if (!opts._fromPopState) pushURL(page);

    // Landing theme cleanup
    if (page !== 'landing') {
      const cleanup = window.__flymLandingCleanup;
      const restore = window.__flymLandingRestoreTheme;
      window.__flymLandingCleanup = null;
      window.__flymLandingRestoreTheme = null;
      if (cleanup) { try { cleanup(); } catch (_) {} }
      if (restore) { try { restore(); } catch (_) {} }
    }

    // Run registered cleanup tasks
    window.__flymRunCleanup();

    // Clear legacy window globals from previous page
    LEGACY_GLOBALS.forEach((k) => { delete window[k]; });

    const routes = {
      landing: () => renderLanding(router),
      login:   () => renderLogin(router),
      gym:     () => renderGymDashboard(router),
      admin:   () => renderAdminDashboard(router),
      verify:  () => renderVerify(router),
    };

    const render = routes[page];
    if (!render) {
      this._navigating = false;
      if (previous !== 'landing') { this.go('landing'); return; }
      return;
    }

    const thisNavId = this._navId;
    try {
      const result = render();
      if (result && typeof result.catch === 'function') {
        result.then(() => {
          if (this._navId === thisNavId) this._navigating = false;
        }).catch((err) => {
          console.error(`[Flym router] Async error on "${page}":`, err);
          if (this._navId === thisNavId) this._navigating = false;
          if (page !== 'login' && page !== 'landing') this.go('login');
        });
        return;
      }
    } catch (err) {
      console.error(`[Flym router] Render error on "${page}":`, err);
      this._navigating = false;
      if (page !== 'landing' && previous !== 'landing') { this.go('landing'); return; }
      const root = document.getElementById('root');
      if (root) {
        root.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;min-height:100dvh;padding:32px;text-align:center;color:var(--text-secondary,#9CA3AF);font-family:sans-serif;gap:12px;"><div style="font-size:16px;font-weight:600;color:var(--text-primary,#F4F5F7);">Something went wrong</div><div style="font-size:13px;line-height:1.6;max-width:320px;">Please refresh the page. If this keeps happening, contact support at flym.system@gmail.com.</div><button onclick="location.reload()" style="margin-top:12px;padding:10px 20px;border-radius:8px;background:#2A8FFF;color:#fff;border:none;font-size:14px;font-weight:500;cursor:pointer;">Refresh</button></div>';
      }
    }

    this._navigating = false;
  }
};

// ── Back/forward button support ───────────────────────────────────
window.addEventListener('popstate', (e) => {
  const page = (e.state && e.state.page)
    ? e.state.page
    : pageFromPath(window.location.pathname);

  if (page) {
    if ((page === 'gym' || page === 'admin') && !window.__flymSession) {
      router.go('login', { _fromPopState: true });
      return;
    }
    router.go(page, { _fromPopState: true });
  } else {
    router.go('landing', { _fromPopState: true });
  }
});

// ── Bootstrap ─────────────────────────────────────────────────────
async function boot() {
  const startPage = pageFromPath(window.location.pathname);

  // Public verify page — bypass auth entirely
  if (startPage === 'verify') {
    router.go('verify');
    return;
  }

  let user = null;
  try {
    user = await getAuthUser();
  } catch (err) {
    console.warn('[Flym boot] getAuthUser failed:', err?.message);
    user = null;
  }

  if (user) {
    try {
      const profile = await getMyProfile(user.id);
      const { role, gym, branches, staffRecord } = profile;
      Object.defineProperty(window, '__flymSession', {
        value: { role, gym, branches: branches || [], staffRecord: staffRecord || null },
        writable: true, enumerable: false, configurable: true,
      });
      // Staff and owner both go to 'gym' (dashboard), admin goes to 'admin'
      router.go(role === 'admin' ? 'admin' : 'gym');
      return;
    } catch (err) {
      console.error('[Flym boot] getMyProfile failed:', err?.message);
      const root = document.getElementById('root');
      if (root) {
        root.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;min-height:100dvh;padding:32px;text-align:center;font-family:Inter,sans-serif;gap:14px;">
            <div style="font-size:40px;">\u26A0\uFE0F</div>
            <div style="font-size:17px;font-weight:600;color:#F4F5F7;">Could not load your profile</div>
            <div style="font-size:13px;color:#9CA3AF;line-height:1.65;max-width:340px;">
              Your login is valid, but we couldn\u2019t reach the database. Please check your internet connection.
            </div>
            <div style="display:flex;gap:10px;margin-top:8px;">
              <button onclick="location.reload()" style="padding:10px 18px;border-radius:8px;background:#2A8FFF;color:#fff;border:none;font-size:14px;font-weight:500;cursor:pointer;">Retry</button>
              <button onclick="localStorage.removeItem('flym-session');location.href='${appPath('/login')}'" style="padding:10px 18px;border-radius:8px;background:transparent;color:#9CA3AF;border:1px solid rgba(255,255,255,0.14);font-size:14px;font-weight:500;cursor:pointer;">Sign out</button>
            </div>
          </div>`;
      }
      return;
    }
  }

  // Not authenticated
  window.__flymSession = null;
  if (startPage === 'gym' || startPage === 'admin' || startPage === 'login') {
    router.go('login');
  } else {
    router.go('landing');
  }
}

boot();
