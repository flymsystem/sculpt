// src/pages/dashboard/index.js — Main orchestrator
import { S } from './state.js';
import { getMembers, getPaymentHistory } from '../../lib/members.js';
import { getPlans } from '../../lib/plans.js';
import { getAddonTemplates } from '../../lib/addon-templates.js';
import { getAllExpenses } from '../../lib/expenses.js';
import { getStaff } from '../../lib/staff.js';
import { demoPlans, demoMembers, escHtml, ico } from './helpers.js';
import { hasAccess } from '../../lib/permissions.js';
import { pushDashboardSection, replaceDashboardSection } from '../../app.js';
import '../../styles/dashboard.css';
import '../../styles/mobile-fixes.css';   // MUST stay after dashboard.css — it overrides it

// Section renderers
import { renderOverview, setOverviewHandlers } from './overview.js';
import { renderMembers, setModalHandlers, filterTable } from './members.js';
import { openAddModal, openEditModal, confirmDelete, confirmCancelMembership, openRenewModal, openMemberDetailModal, openWAModal, openInvoiceModal, openClearBalanceModal, setNavHandler as setModalNav, setPhotoHandler } from './member-modals.js';
import { renderPlans, renderPlansShowcase, setNavHandler as setPlanNav } from './plans.js';
import { renderGymConfig, setNavHandler as setSettingsNav } from './settings.js';
import { renderFinance, setNavHandler as setFinanceNav } from './finance.js';
import { renderBackup } from './backup.js';
import { renderMemberAlerts } from './alerts.js';
import { renderExpenses } from './expenses-page.js';
import { renderEnquiries } from './enquiries.js';
import { renderStaff, setStaffNav } from './staff.js';
import { renderAnalytics } from './analytics.js';
import { renderCheckinDisplay, stopCheckinDisplay } from './checkin-display.js';
import { renderCheckinScan, stopCheckinScan } from './checkin-scan.js';
import { renderCheckins, stopCheckinsRealtime } from './checkins.js';
import { buildSidebar, bindSidebar, bindThemeToggle, setSidebarNav, setSidebarReload, closeMobileSidebar } from './sidebar.js';
import { saveMemberPhoto } from './photo.js';

// Notifications + one-tap calling
import { bellMarkup, mountNotificationBell, cleanupNotificationBell, setNotificationNav } from '../../components/notification-bell.js';
import { initCallHandler, injectCallStyles, linkifyPhones, observeModals } from '../../components/call-button.js';

const LOGIN_PATH = new URL('login', new URL(import.meta.env.BASE_URL || '/', window.location.origin)).pathname;

// ── Wire cross-module dependencies ───────────────────
setModalHandlers({ openAddModal, openEditModal, confirmDelete, confirmCancelMembership, openRenewModal, openWAModal, openInvoiceModal, openMemberDetailModal, openClearBalanceModal });
setModalNav(nav);
setPhotoHandler(saveMemberPhoto);
setPlanNav(nav);
setSettingsNav(nav);
setFinanceNav(nav);
setStaffNav(nav);
setSidebarNav(nav);
setSidebarReload(renderGymDashboard);
setOverviewHandlers({ nav, filterTable });
setNotificationNav(nav);
// Expose nav globally so inline onclick handlers (View Alerts banner) can call it
if (typeof window !== 'undefined') window._navTo = nav;

// ── Main entry point ─────────────────────────────────
export async function renderGymDashboard(router) {
  const root = document.getElementById('root');
  const sessionData = window.__sculptSession;

  // Allow both owner and staff roles
  if (!sessionData || !['owner', 'staff'].includes(sessionData.role) || !sessionData.gym) {
    root.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:16px;padding:32px;text-align:center;">
      <div style="font-size:40px;">🔒</div>
      <div style="font-size:17px;font-weight:600;color:var(--white);">Access Denied</div>
      <div style="font-size:13px;color:var(--muted);max-width:320px;line-height:1.6;">
        You need to be logged in as a gym owner or staff to access this page.
      </div>
      <button class="btn btn-primary" onclick="location.href='${LOGIN_PATH}'" style="margin-top:8px;">Go to Login</button>
    </div>`;
    return;
  }

  // Reset state
  S.gym = sessionData.gym;
  S.role = sessionData.role;
  S.staffRecord = sessionData.staffRecord || null;
  S.members = [];
  S.plans = [];
  S.payHistory = [];
  S.addonTemplates = [];
  S.expenses = [];
  S.enquiries = [];
  S.staff = [];
  S.branches = sessionData.branches || [];
  S.section = 'overview';

  const gymName = S.gym?.name || 'Your Gym';
  const av = gymName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();

  // Branch indicator in topbar for multi-branch users
  const branchCount = S.branches.length;
  const branchIndicator = branchCount > 1
    ? `<span style="font-size:10px;color:var(--blue-light);background:var(--blue-glow2);padding:2px 6px;border-radius:10px;margin-left:6px;">${branchCount} branches</span>`
    : '';

  root.innerHTML = `
    <div id="page-gym" class="app-layout">
      <div id="gym-sidebar"></div>
      <div class="app-main">
        <div class="topbar">
          <button class="hamburger-btn" id="hamburger-btn" aria-label="Menu" aria-expanded="false" aria-controls="gym-sidebar">
            <span></span><span></span><span></span>
          </button>
          <div class="topbar-title" id="topbar-title">Dashboard${branchIndicator}</div>
          <div class="topbar-right">
            <div class="topbar-search-hint" id="cmd-trigger" title="Search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>Search<kbd>Ctrl+K</kbd></div>
            <div class="topbar-date" id="topbar-date"></div>
            ${bellMarkup()}
            <button class="theme-toggle" id="theme-toggle" title="Toggle theme" aria-label="Toggle theme">
              <svg id="theme-icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
              <svg id="theme-icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            </button>
            <div class="topbar-avatar" title="${escHtml(gymName)}">${av}</div>
            <button id="topbar-logout-btn" title="Sign Out"
              style="background:none;border:1px solid var(--border);color:var(--muted);
                cursor:pointer;border-radius:var(--radius-sm);padding:6px 8px;
                display:flex;align-items:center;gap:5px;font-size:11px;
                font-family:var(--font-head);font-weight:700;letter-spacing:0.05em;">
              ${ico('logout')}<span>LOGOUT</span>
            </button>
          </div>
        </div>
        <div class="sidebar-overlay" id="sidebar-overlay"></div>
        <div class="app-content" id="gym-content">
          <div class="loading-inline"><div class="spinner"></div></div>
        </div>
      </div>
    </div>`;

  document.getElementById('gym-sidebar').innerHTML = buildSidebar(gymName, S.gym?.gym_code || '', S.gym?.logo_url || '');
  bindSidebar(router);
  bindThemeToggle();
  bindCommandPalette();

  // ── One-tap calling: global delegated handler + modal observer ──
  // initCallHandler() and observeModals() are both idempotent, so a
  // branch switch that re-runs this function won't stack listeners.
  injectCallStyles();
  initCallHandler();
  observeModals();

  // ── Notifications ───────────────────────────────────────────────
  // Deliberately not awaited — a slow notifications query must never
  // hold up the dashboard render.
  mountNotificationBell().catch(err => console.warn('[Sculpt] bell:', err.message));

  // Service worker tells us which section a tapped push wants
  if ('serviceWorker' in navigator && !window.__sculptSwMsgBound) {
    window.__sculptSwMsgBound = true;
    navigator.serviceWorker.addEventListener('message', (ev) => {
      if (ev.data?.type === 'SCULPT_NOTIFICATION_CLICK' && ev.data.url) {
        const m = String(ev.data.url).match(/\/dashboard\/([a-z][\w-]*)/);
        if (m) nav(m[1]);
      }
    });
  }

  // Tear the bell down on unload so the realtime channel + timers die cleanly
  if (!window.__sculptBellUnloadBound) {
    window.__sculptBellUnloadBound = true;
    window.addEventListener('beforeunload', cleanupNotificationBell);
  }

  document.getElementById('topbar-date').textContent = new Date().toLocaleDateString('en-IN',
    { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  // Read initial section from URL (e.g. /dashboard/members → 'members')
  const urlMatch = window.location.pathname.match(/^\/dashboard\/([a-z][\w-]*)$/);
  const initialSection = (urlMatch && VALID_SECTIONS.has(urlMatch[1])) ? urlMatch[1] : 'overview';

  await loadData().then(() => {
    nav(initialSection, { _fromPopState: true }); // don't push — URL is already correct
    replaceDashboardSection(initialSection);       // ensure history state is set
  }).catch(() => {});
}

// ── Data loading ─────────────────────────────────────
async function loadData() {
  const gymId = S.gym?.id;
  try {
    if (gymId) {
      // Staff loads less data — skip expenses if no access
      const isStaff = S.role === 'staff';

      const fetches = [
        getMembers(gymId),
        getPlans(gymId),
        getPaymentHistory(gymId).catch(() => []),
        getAddonTemplates(gymId).catch(() => []),
        isStaff ? Promise.resolve([]) : getAllExpenses(gymId).catch(() => []),
        getStaff(gymId).catch(() => []),
      ];

      const [members, plans, payHistory, addonTemplates, expenses, staff] = await Promise.all(fetches);
      S.members        = members        || [];
      S.plans          = plans          || [];
      S.payHistory     = payHistory     || [];
      S.addonTemplates = addonTemplates  || [];
      S.expenses       = expenses       || [];
      S.staff          = staff          || [];

    } else {
      S.plans   = demoPlans();
      S.members = demoMembers();
    }
  } catch (e) {
    console.error('[Sculpt] loadData error:', e.message);
    if (gymId) {
      const c = document.getElementById('gym-content');
      if (c) c.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
          height:60vh;gap:16px;padding:32px;text-align:center;">
          <div style="font-size:40px;">⚠️</div>
          <div style="font-size:17px;font-weight:600;color:var(--white);">Could not load your data</div>
          <div style="font-size:13px;color:var(--muted);max-width:340px;line-height:1.7;">
            Please check your internet connection and try again.
          </div>
          <button class="btn btn-primary" onclick="location.reload()" style="margin-top:8px;">
            🔄 Retry
          </button>
        </div>`;
      throw e;
    } else {
      S.plans   = demoPlans();
      S.members = demoMembers();
    }
  }
}

// ── Access denied page ──────────────────────────────
function renderAccessDenied(c, sectionName) {
  c.innerHTML = `<div class="content-inner page-enter" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:50vh;gap:16px;text-align:center;">
    <div style="font-size:40px;">🔒</div>
    <div style="font-size:17px;font-weight:600;color:var(--text-primary);">Access Restricted</div>
    <div style="font-size:13px;color:var(--text-tertiary);max-width:320px;line-height:1.6;">
      You don’t have permission to access ${escHtml(sectionName || 'this section')}. Contact your gym owner for access.
    </div>
    <button class="btn btn-primary btn-sm" onclick="window._navTo&&window._navTo('overview')">Back to Dashboard</button>
  </div>`;
}

// Valid dashboard sections (for URL validation)
const VALID_SECTIONS = new Set([
  'overview','members','enquiries','alerts','staff',
  'finance','expenses','plans','plans-showcase','gymconfig',
  'backup','analytics','checkin-display','checkin-scan','checkins'
]);

// ── Navigation ───────────────────────────────────────
function nav(id, opts = {}) {
  // Validate section ID — fall back to overview for unknown sections
  if (!VALID_SECTIONS.has(id)) id = 'overview';

  const c = document.getElementById('gym-content');
  if (!c) return;


  S.section = id;

  // Both check-in pages hold a resource (rotation timer / camera
  // stream) that must die the instant the user navigates away, or the
  // camera stays on / the token keeps rotating in the background.
  if (id !== 'checkin-display') stopCheckinDisplay();
  if (id !== 'checkin-scan') stopCheckinScan();
  if (id !== 'checkins') stopCheckinsRealtime();

  // Push URL for this section (skip if triggered by browser back/forward)
  if (!opts._fromPopState) {
    pushDashboardSection(id);
  }

  // Update topbar title
  const titles = { overview:'Dashboard', members:'All Members', enquiries:'Enquiries', alerts:'Member Alerts',
    staff:'Staff', finance:'Finance', expenses:'Expenses', plans:'Plan Settings',
    'plans-showcase':'Plans Showcase', gymconfig:'Gym Settings',
    backup:'Data & Backup', analytics:'Analytics',
    'checkin-display':'Desk Display', 'checkin-scan':'Check In', checkins:'Check-ins' };
  const tb = document.getElementById('topbar-title');
  if (tb) tb.textContent = titles[id] || 'Dashboard';

  // Highlight sidebar
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.id === id));

  // A browser-back that lands on a different dashboard section bypasses
  // bindSidebar()'s click handler entirely (window._navTo calls nav()
  // directly — see app.js's popstate listener), so the mobile drawer, if
  // open, would otherwise stay open behind the newly-rendered section.
  closeMobileSidebar();

  // ── Role-based access guard ──
  const role = S.role || 'owner';

  // Permission map: section -> permission key
  const permMap = {
    finance:     'finance',
    staff:       'staff_management',
    gymconfig:   'settings',
    backup:      'backup',
    plans:       'plans',
    analytics:   'analytics',
  };


  // Check permission
  const permKey = permMap[id];
  if (permKey) {
    const access = hasAccess(role, permKey);
    if (!access) { renderAccessDenied(c, titles[id]); updateFAB(id); return; }
    // Plans: staff has 'view' access — render showcase instead of settings
    if (id === 'plans' && role === 'staff') { renderPlansShowcase(c); updateFAB(id); return; }
  }


  // Render the section
  ({ overview:renderOverview, members:renderMembers, enquiries:renderEnquiries, alerts:renderMemberAlerts,
     staff:renderStaff, finance:renderFinance, expenses:renderExpenses, plans:renderPlans,
     'plans-showcase':renderPlansShowcase, gymconfig:renderGymConfig,
     backup:renderBackup,
     analytics:renderAnalytics,
     'checkin-display':renderCheckinDisplay,
     'checkin-scan':renderCheckinScan,
     checkins:renderCheckins }[id] || renderOverview)(c);

  // Update FAB context
  updateFAB(id);

  // Make every phone number on the freshly-rendered page tappable.
  // Deferred a tick because renderEnquiries / renderStaff / renderBackup are
  // async — without this we'd linkify the loading spinner and nothing else.
  setTimeout(() => linkifyPhones('#gym-content'), 0);
  setTimeout(() => linkifyPhones('#gym-content'), 400);
}

// ── Command Palette (Ctrl+K) ─────────────────────────────
let _cmdLastFocused = null;

function openCommandPalette() {
  if (document.getElementById('sculpt-cmd-overlay')) return;
  // Restored on close — Ctrl+K can be pressed from anywhere, so whatever
  // had focus (a table row, a nav item, the search hint button) gets it
  // back rather than silently dropping focus to <body>.
  _cmdLastFocused = document.activeElement;

  // Filter nav pages based on role + tier
  const allPages = [
    { id:'overview', label:'Dashboard', icon:'grid' },
    { id:'members', label:'All Members', icon:'users' },
    { id:'enquiries', label:'Enquiries', icon:'clipboard' },
    { id:'alerts', label:'Member Alerts', icon:'bell' },
    { id:'staff', label:'Staff', icon:'users' },
    { id:'finance', label:'Finance', icon:'finance' },
    { id:'expenses', label:'Expenses', icon:'card' },
    { id:'plans', label:'Plan Settings', icon:'check' },
    { id:'plans-showcase', label:'Plans Showcase', icon:'check' },
    { id:'gymconfig', label:'Gym Settings', icon:'cog' },
    { id:'backup', label:'Data & Backup', icon:'lock' },
    { id:'analytics', label:'Analytics', icon:'chart' },
  ];

  // Filter based on role
  const role = S.role || 'owner';
  const permMap = {
    finance:'finance', staff:'staff_management', gymconfig:'settings',
    backup:'backup', plans:'plans', analytics:'analytics',
  };

  const navPages = allPages.filter(p => {
    const pk = permMap[p.id];
    if (pk && !hasAccess(role, pk)) return false;
    return true;
  });

  const memberItems = S.members.slice(0, 50).map(m => ({
    id: 'member:' + m.id,
    label: m.full_name || m.name,
    sub: m.plan_name || m.member_type || '',
    type: 'member'
  }));

  const overlay = document.createElement('div');
  overlay.id = 'sculpt-cmd-overlay';
  overlay.className = 'cmd-overlay';
  overlay.innerHTML = `<div class="cmd-palette" role="dialog" aria-modal="true" aria-label="Command palette">
    <div class="cmd-input-wrap">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input class="cmd-input" id="cmd-input" placeholder="Search members, pages…" autocomplete="off" autofocus
        role="combobox" aria-expanded="true" aria-controls="cmd-results" aria-autocomplete="list">
    </div>
    <div class="cmd-results" id="cmd-results" role="listbox" aria-label="Results"></div>
    <div class="cmd-footer"><span>Navigate</span> <span class="cmd-kbd">↑↓</span> <span>Select</span> <span class="cmd-kbd">↵</span> <span>Close</span> <span class="cmd-kbd">Esc</span></div>
  </div>`;
  document.body.appendChild(overlay);

  const input = document.getElementById('cmd-input');
  const results = document.getElementById('cmd-results');
  let activeIdx = 0;

  function renderResults(query) {
    const q = (query || '').toLowerCase().trim();
    let items = [];
    if (!q) {
      items = navPages.map(p => ({ ...p, type: 'page' }));
    } else {
      navPages.forEach(p => { if (p.label.toLowerCase().includes(q)) items.push({ ...p, type: 'page' }); });
      memberItems.forEach(m => { if (m.label.toLowerCase().includes(q)) items.push(m); });
    }
    activeIdx = 0;
    if (!items.length) { results.innerHTML = `<div class="cmd-empty">No results for "${escHtml(query)}"</div>`; input.removeAttribute('aria-activedescendant'); return; }
    results.innerHTML = items.slice(0, 12).map((item, i) => `<div class="cmd-item ${i === 0 ? 'active' : ''}" id="cmd-item-${i}" role="option" aria-selected="${i === 0}" data-idx="${i}" data-id="${escHtml(item.id)}" data-type="${item.type || 'page'}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${item.type === 'member' ? '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' : '<circle cx="12" cy="12" r="10"/>'}</svg>
      <span class="cmd-item-label">${escHtml(item.label)}${item.sub ? ` <span style="color:var(--text-quaternary);font-size:11px;">— ${escHtml(item.sub)}</span>` : ''}</span>
      ${item.type === 'page' ? '<span class="cmd-item-hint">page</span>' : '<span class="cmd-item-hint">member</span>'}
    </div>`).join('');
    input.setAttribute('aria-activedescendant', 'cmd-item-0');
  }

  function selectItem() {
    const active = results.querySelector('.cmd-item.active');
    if (!active) return;
    closeCommandPalette();
    if (active.dataset.type === 'member') {
      nav('members');
    } else {
      nav(active.dataset.id);
    }
  }

  function updateActive() {
    results.querySelectorAll('.cmd-item').forEach((el, i) => {
      const isActive = i === activeIdx;
      el.classList.toggle('active', isActive);
      el.setAttribute('aria-selected', String(isActive));
    });
    results.querySelector('.cmd-item.active')?.scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', `cmd-item-${activeIdx}`);
  }

  renderResults('');
  input.focus();

  input.addEventListener('input', () => renderResults(input.value));
  input.addEventListener('keydown', (e) => {
    const count = results.querySelectorAll('.cmd-item').length;
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = (activeIdx + 1) % Math.max(count, 1); updateActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = (activeIdx - 1 + count) % Math.max(count, 1); updateActive(); }
    else if (e.key === 'Enter') { e.preventDefault(); selectItem(); }
    else if (e.key === 'Escape') closeCommandPalette();
    // The search input is the only focusable element in the palette —
    // Tab has nowhere useful to go, so keep focus on it rather than
    // letting it escape to whatever the browser considers "next"
    // (often the address bar or nothing at all).
    else if (e.key === 'Tab') { e.preventDefault(); }
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCommandPalette(); });
}

function closeCommandPalette() {
  document.getElementById('sculpt-cmd-overlay')?.remove();
  // Restore focus to whatever opened it — a table row, the sidebar, the
  // search-hint button — instead of leaving keyboard focus on <body>.
  if (_cmdLastFocused && typeof _cmdLastFocused.focus === 'function') {
    _cmdLastFocused.focus();
  }
  _cmdLastFocused = null;
}

function bindCommandPalette() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      if (document.getElementById('sculpt-cmd-overlay')) closeCommandPalette();
      else openCommandPalette();
    }
    if (e.key === 'Escape') closeCommandPalette();
  });
  document.getElementById('cmd-trigger')?.addEventListener('click', openCommandPalette);
}

// ── Floating Action Button ───────────────────────────────
let fabMenuOpen = false;
function updateFAB(section) {
  let fab = document.getElementById('sculpt-fab');
  const fabMenu = document.getElementById('sculpt-fab-menu');
  if (fabMenu) fabMenu.remove();
  fabMenuOpen = false;

  // Only show FAB if user can add members
  if (!hasAccess(S.role || 'owner', 'add_member')) {
    if (fab) fab.remove();
    return;
  }

  if (!fab) {
    fab = document.createElement('button');
    fab.id = 'sculpt-fab';
    fab.className = 'fab';
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    document.body.appendChild(fab);
    fab.addEventListener('click', toggleFABMenu);
  }
}

function toggleFABMenu() {
  const existing = document.getElementById('sculpt-fab-menu');
  if (existing) { existing.remove(); fabMenuOpen = false; return; }
  fabMenuOpen = true;

  const section = S.section;
  const actions = [];
  if (hasAccess(S.role || 'owner', 'add_member')) {
    actions.push({ label:'Add Member', action:() => openAddModal() });
  }
  if (section === 'expenses' && hasAccess(S.role || 'owner', 'expenses')) {
    actions.push({ label:'Add Expense', action:() => document.getElementById('btn-add-expense')?.click() });
  }

  if (actions.length === 0) return;

  const menu = document.createElement('div');
  menu.id = 'sculpt-fab-menu';
  menu.className = 'fab-menu';
  menu.innerHTML = actions.map(a => `<div class="fab-menu-item" data-action="${escHtml(a.label)}">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    ${escHtml(a.label)}
  </div>`).join('');
  document.body.appendChild(menu);

  menu.querySelectorAll('.fab-menu-item').forEach((item, i) => {
    item.addEventListener('click', () => {
      menu.remove(); fabMenuOpen = false;
      if (actions[i]) actions[i].action();
    });
  });

  setTimeout(() => {
    const handler = (e) => { if (!menu.contains(e.target) && e.target.id !== 'sculpt-fab') { menu.remove(); fabMenuOpen = false; document.removeEventListener('click', handler); } };
    document.addEventListener('click', handler);
  }, 10);
}

// Wire up after dashboard renders
const _origRender = renderGymDashboard;
