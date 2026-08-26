// src/app.js
import './styles/global.css';
import './styles/components.css';

// ── Pages are loaded on demand ────────────────────────────────────
// These five modules are ~300 KB of source between them and no visitor
// ever needs more than one of them. Importing them statically meant the
// landing page downloaded the entire gym dashboard AND the admin
// product before it could render a single pixel — on a cheap Android on
// 3G, tens of seconds of staring at a blank screen.
//
// The router already handles a render function that returns a promise
// (see routes below), so making these async needs no other change.
// Lazily importing dashboard/index.js also breaks the static import
// cycle it had with this file via pushDashboardSection().
import { getAuthUser, getMyProfile, onAuthStateChange } from './lib/auth.js';
import { getMyMembership } from './lib/member-auth.js';
import { ensureFreshSession } from './lib/supabase.js';

const APP_BASE = new URL(import.meta.env.BASE_URL || '/', window.location.origin);

function appPath(path) {
  return new URL(path.replace(/^\//, ''), APP_BASE).pathname;
}

// ── Auth state listener ───────────────────────────────────────────
onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
    window.__sculptSession = null;
    window.__sculptMemberSession = false;
    router.go('landing');
  }
});

// ── Global error boundary ─────────────────────────────────────────
window.addEventListener('unhandledrejection', (e) => {
  console.error('[Sculpt] Unhandled promise rejection:', e.reason);
  e.preventDefault();
});
window.addEventListener('error', (e) => {
  console.error('[Sculpt] Uncaught error:', e.error);
});

// ── PWA lifecycle: refresh auth when tab becomes visible ──────────
// iOS Safari suspends background timers, so autoRefreshToken can miss
// its window and the next request would 401. This proactively refreshes.
let _lastVisibilityCheck = 0;
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  // Debounce: at most once every 10s
  const now = Date.now();
  if (now - _lastVisibilityCheck < 10_000) return;
  _lastVisibilityCheck = now;

  // If we think we're logged in, verify the session is still fresh
  if (window.__sculptSession || window.__sculptMemberSession) {
    const ok = await ensureFreshSession();
    if (!ok) {
      // Session expired while backgrounded — go to the right login
      // screen cleanly (a member session lost mid-background must not
      // land on the owner/staff email+password screen).
      const wasMember = !!window.__sculptMemberSession;
      window.__sculptSession = null;
      window.__sculptMemberSession = false;
      const dest = wasMember ? 'member-login' : 'login';
      if (router.current !== 'landing' && router.current !== dest) {
        router.go(dest);
      }
    }
  }
});

// Also handle bfcache restore (Safari back/forward)
window.addEventListener('pageshow', async (e) => {
  if (e.persisted && (window.__sculptSession || window.__sculptMemberSession)) {
    const ok = await ensureFreshSession();
    if (!ok) {
      const wasMember = !!window.__sculptMemberSession;
      window.__sculptSession = null;
      window.__sculptMemberSession = false;
      router.go(wasMember ? 'member-login' : 'login');
    }
  }
});

// ── Theme controller ──────────────────────────────────────────────
window.__sculptThemeController = {
  get() { return document.documentElement.getAttribute('data-theme') || 'dark'; },
  set(theme) {
    if (theme !== 'dark' && theme !== 'light') return;
    document.documentElement.classList.add('theme-switching');
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('sculpt-theme', theme); } catch (_) {}
    window.__sculptTheme = theme;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.documentElement.classList.remove('theme-switching');
    }));
    window.dispatchEvent(new CustomEvent('sculpt:themechange', { detail: { theme } }));
  },
  toggle() { this.set(this.get() === 'dark' ? 'light' : 'dark'); },
};
window.addEventListener('storage', (e) => {
  if (e.key === 'sculpt-theme' && e.newValue) window.__sculptThemeController.set(e.newValue);
});

// ── URL helpers ───────────────────────────────────────────────────
const PAGE_TO_PATH = {
  landing: '/',
  login:   '/login',
  gym:     '/dashboard',
  'member-login': '/member/login',
  member:  '/member',
};
const PATH_TO_PAGE = {
  '/':             'landing',
  '/login':        'login',
  '/dashboard':    'gym',
  '/member/login': 'member-login',
  '/member':       'member',
};

function pageFromPath(path) {
  const clean = path.replace(/\/$/, '') || '/';
  if (clean.startsWith('/dashboard')) return 'gym';
  return PATH_TO_PAGE[clean] || null;
}

// Extract dashboard section from path: /dashboard/members → 'members', /dashboard → null
function sectionFromPath(path) {
  const m = path.match(/^\/dashboard\/([a-z][\w-]*)$/);
  return m ? m[1] : null;
}

function pushURL(page) {
  const path = PAGE_TO_PATH[page] || '/';
  // For gym page: if already on a /dashboard/* path, preserve it (section
  // routing is handled by dashboard/index.js). Just ensure state is correct.
  if (page === 'gym' && window.location.pathname.startsWith('/dashboard')) {
    history.replaceState({ page: 'gym', section: sectionFromPath(window.location.pathname) || 'overview' }, '', window.location.pathname);
    return;
  }
  if (window.location.pathname !== path) {
    history.pushState({ page }, '', path);
  }
}

// Called by dashboard/index.js to push section-level URLs
export function pushDashboardSection(section) {
  const path = section && section !== 'overview'
    ? `/dashboard/${section}`
    : '/dashboard';
  if (window.location.pathname !== path) {
    history.pushState({ page: 'gym', section }, '', path);
  }
}

// Called by dashboard/index.js on initial load to set URL without adding history
export function replaceDashboardSection(section) {
  const path = section && section !== 'overview'
    ? `/dashboard/${section}`
    : '/dashboard';
  history.replaceState({ page: 'gym', section }, '', path);
}

// ── Cleanup registry ──────────────────────────────────────────────
// Any module that installs a window global or a document listener that
// needs to be torn down on page navigation should register it here.
// Router calls window.__sculptCleanup() before rendering the next page.
const _cleanupTasks = new Set();
window.__sculptRegisterCleanup = (fn) => {
  if (typeof fn === 'function') _cleanupTasks.add(fn);
};
window.__sculptRunCleanup = () => {
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

// ── Lazy route loading ────────────────────────────────────────────
/**
 * Wraps a dynamic import so the router can tell a *page* that threw
 * from a *chunk* that never arrived.
 *
 * The difference matters. A page error can reasonably bounce the user
 * to login. A failed chunk download — offline, or a stale index.html
 * pointing at a filename the last deploy replaced — cannot: the login
 * chunk would fail exactly the same way, and the user would be left
 * staring at a blank screen with no explanation.
 */
function lazyRoute(load, render) {
  return () => {
    showRouteLoading();
    return load().then(render, (err) => {
      console.error('[Sculpt router] chunk load failed:', err);
      const e = new Error('Could not load this page.');
      e.__chunkLoad = true;
      throw e;
    });
  };
}

/** Placeholder while a route chunk downloads. Pages overwrite #root. */
function showRouteLoading() {
  const root = document.getElementById('root');
  if (!root || root.dataset.routeLoading === '1') return;
  // Only paint a spinner into an EMPTY root. Mid-session navigation
  // keeps the current page visible rather than flashing to a spinner.
  if (root.childElementCount > 0) return;
  root.dataset.routeLoading = '1';
  root.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;min-height:100dvh;">' +
    '<div style="width:26px;height:26px;border:2px solid rgba(128,128,128,.25);border-top-color:#2A8FFF;' +
    'border-radius:50%;animation:sculptspin .7s linear infinite;"></div>' +
    '<style>@keyframes sculptspin{to{transform:rotate(360deg)}}</style></div>';
}

function showRouteLoadError() {
  const root = document.getElementById('root');
  if (!root) return;
  root.dataset.routeLoading = '';
  root.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;min-height:100dvh;padding:32px;text-align:center;font-family:Manrope,-apple-system,sans-serif;gap:12px;color:#9CA3AF;">
      <div style="font-size:36px;">📶</div>
      <div style="font-size:16px;font-weight:600;color:#F4F5F7;">Couldn’t load this page</div>
      <div style="font-size:13px;line-height:1.6;max-width:320px;">
        You may be offline, or the app was just updated. Refreshing should fix it.
      </div>
      <button onclick="location.reload()" style="margin-top:8px;padding:10px 20px;border-radius:8px;background:#2A8FFF;color:#fff;border:none;font-size:14px;font-weight:500;cursor:pointer;">Refresh</button>
    </div>`;
}

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

    // Landing theme cleanup — null the ref BEFORE calling to prevent
    // re-entrant double-cleanup on recursive router.go errors
    if (page !== 'landing') {
      const cleanup = window.__sculptLandingCleanup;
      const restore = window.__sculptLandingRestoreTheme;
      window.__sculptLandingCleanup = null;
      window.__sculptLandingRestoreTheme = null;
      if (cleanup) { try { cleanup(); } catch (_) {} }
      if (restore) { try { restore(); } catch (_) {} }
    }

    // Run registered cleanup tasks
    window.__sculptRunCleanup();

    // Clear legacy window globals from previous page
    LEGACY_GLOBALS.forEach((k) => { delete window[k]; });

    const routes = {
      landing: lazyRoute(() => import('./pages/landing.js'),          m => m.renderLanding(router)),
      login:   lazyRoute(() => import('./pages/login.js'),            m => m.renderLogin(router)),
      gym:     lazyRoute(() => import('./pages/dashboard/index.js'),  m => m.renderGymDashboard(router)),
      'member-login': lazyRoute(() => import('./pages/member/login.js'), m => m.renderMemberLogin(router)),
      member:  lazyRoute(() => import('./pages/member/index.js'),     m => m.renderMemberPortal(router)),
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
          // Only clear navigating if this is still the current nav
          if (this._navId === thisNavId) this._navigating = false;
        }).catch((err) => {
          console.error(`[Sculpt router] Async error on "${page}":`, err);
          if (this._navId === thisNavId) this._navigating = false;
          // A chunk that never downloaded can't be recovered by routing
          // somewhere else — that chunk would fail too. Say so instead.
          if (err && err.__chunkLoad) { showRouteLoadError(); return; }
          if (page !== 'login' && page !== 'landing') this.go('login');
        });
        return; // Don't clear _navigating synchronously for async renders
      }
    } catch (err) {
      console.error(`[Sculpt router] Render error on "${page}":`, err);
      this._navigating = false;
      if (page !== 'landing' && previous !== 'landing') { this.go('landing'); return; }
      const root = document.getElementById('root');
      if (root) {
        root.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;min-height:100dvh;padding:32px;text-align:center;color:var(--text-secondary,#9CA3AF);font-family:sans-serif;gap:12px;"><div style="font-size:16px;font-weight:600;color:var(--text-primary,#F4F5F7);">Something went wrong</div><div style="font-size:13px;line-height:1.6;max-width:320px;">Please refresh the page. If this keeps happening, please let the gym know.</div><button onclick="location.reload()" style="margin-top:12px;padding:10px 20px;border-radius:8px;background:#2A8FFF;color:#fff;border:none;font-size:14px;font-weight:500;cursor:pointer;">Refresh</button></div>';
      }
    }

    this._navigating = false;
  }
};

// Test-only hook, same convention as window._navTo (dashboard/index.js)
// and window.__sculptCheckin (lib/checkin.js) — lets Playwright drive a
// lazy route directly against the BUILT preview server (hashed chunk
// filenames rule out a plain dynamic import() from a test file) without
// needing a real login for pages, like the member portal, that expose
// their own fixture-mount hook once loaded. Never read by production code.
if (typeof window !== 'undefined') {
  window.__sculptRouter = router;
}

// ── Back/forward button support ───────────────────────────────────
window.addEventListener('popstate', (e) => {
  const page = (e.state && e.state.page)
    ? e.state.page
    : pageFromPath(window.location.pathname);

  // Chromium fires popstate not just for back/forward, but also when a
  // same-document fragment link (<a href="#why">) is clicked — even
  // though the route hasn't changed, only window.location.hash has. router.go()
  // has no early-out for "already on this page", so without this guard
  // every click on a landing-page nav link (#why, #programmes, ...) tore
  // the whole page down and rebuilt it, replaying the intro animation on
  // every menu click instead of just letting the browser scroll to the
  // anchor.
  if (page === router.current && page !== 'gym') return;

  if (!page) {
    router.go('landing', { _fromPopState: true });
    return;
  }

  if (page === 'gym' && !window.__sculptSession) {
    router.go('login', { _fromPopState: true });
    return;
  }

  // Dashboard section-level back/forward: if we're already on the dashboard
  // and the new URL is also a dashboard path, just switch sections without
  // tearing down and re-rendering the entire dashboard.
  if (page === 'gym' && router.current === 'gym' && typeof window._navTo === 'function') {
    const section = (e.state && e.state.section)
      || sectionFromPath(window.location.pathname)
      || 'overview';
    window._navTo(section, { _fromPopState: true });
    return;
  }

  router.go(page, { _fromPopState: true });
});

// ── Bootstrap ─────────────────────────────────────────────────────
async function boot() {
  const startPage = pageFromPath(window.location.pathname);

  let user = null;
  try {
    user = await getAuthUser();
  } catch (err) {
    // Network / getUser failure — treat as unauthenticated
    console.warn('[Sculpt boot] getAuthUser failed:', err?.message);
    user = null;
  }

  if (user) {
    let profile;
    try {
      profile = await getMyProfile(user.id);
    } catch (err) {
      // Profile fetch failure with a valid session — show soft error, do NOT
      // silently sign the user out. Landing page is a bad fallback here.
      console.error('[Sculpt boot] getMyProfile failed:', err?.message);
      const root = document.getElementById('root');
      if (root) {
        root.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;min-height:100dvh;padding:32px;text-align:center;font-family:Manrope,-apple-system,sans-serif;gap:14px;">
            <div style="font-size:40px;">⚠️</div>
            <div style="font-size:17px;font-weight:600;color:#F4F5F7;">Could not load your profile</div>
            <div style="font-size:13px;color:#9CA3AF;line-height:1.65;max-width:340px;">
              Your login is valid, but we couldn't reach the database. Please check your internet connection.
            </div>
            <div style="display:flex;gap:10px;margin-top:8px;">
              <button onclick="location.reload()" style="padding:10px 18px;border-radius:8px;background:#2A8FFF;color:#fff;border:none;font-size:14px;font-weight:500;cursor:pointer;">Retry</button>
              <button onclick="localStorage.removeItem('sculpt-session');location.href='${appPath('/login')}'" style="padding:10px 18px;border-radius:8px;background:transparent;color:#9CA3AF;border:1px solid rgba(255,255,255,0.14);font-size:14px;font-weight:500;cursor:pointer;">Sign out</button>
            </div>
          </div>`;
      }
      return;
    }

    if (profile) {
      const { role, gym, branches, staffRecord } = profile;
      Object.defineProperty(window, '__sculptSession', {
        // staffRecord was dropped here — getMyProfile() has returned it
        // for staff users since it was added (see lib/auth.js's v3
        // changelog), but this destructure never picked it up, so
        // S.staffRecord (dashboard/index.js) was null for every staff
        // session, in every browser, since that feature shipped. The
        // gym-switch path in sidebar.js already forwarded it correctly —
        // this was the only place that didn't.
        value: { role, gym, branches: branches || [], staffRecord: staffRecord || null },
        writable: true, enumerable: false, configurable: true,
      });
      router.go('gym');
      return;
    }

    // No gym_users row — this is the normal shape for a member account
    // (see getMyProfile in lib/auth.js). Check for a member row before
    // treating it as a genuinely unconfigured login.
    let membership = null;
    try {
      membership = await getMyMembership();
    } catch (err) {
      console.warn('[Sculpt boot] getMyMembership failed:', err?.message);
    }

    if (membership) {
      window.__sculptMemberSession = true;
      router.go('member');
      return;
    }

    // Neither a gym_users row nor a member row — a real "not configured"
    // account. This is reachable from either login screen, so route back
    // to whichever one the URL suggests rather than guessing.
    window.__sculptSession = null;
    window.__sculptMemberSession = false;
    if (startPage === 'member' || startPage === 'member-login') {
      router.go('member-login');
    } else {
      router.go('login');
    }
    return;
  }

  // Not authenticated
  window.__sculptSession = null;
  window.__sculptMemberSession = false;
  if (startPage === 'gym' || startPage === 'login') {
    router.go('login');
  } else if (startPage === 'member' || startPage === 'member-login') {
    router.go('member-login');
  } else {
    router.go('landing');
  }
}

boot();