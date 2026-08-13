// src/pages/dashboard/index.js — Main orchestrator
import { S } from './state.js';
import { getMembers, getPaymentHistory } from '../../lib/members.js';
import { getPlans } from '../../lib/plans.js';
import { getAddonTemplates } from '../../lib/addon-templates.js';
import { demoPlans, demoMembers, ico } from './helpers.js';
import '../../styles/dashboard.css';

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
import { renderContact } from './contact.js';
import { buildSidebar, bindSidebar, bindThemeToggle, setSidebarNav } from './sidebar.js';
import { saveMemberPhoto } from './photo.js';

// ── Wire cross-module dependencies ───────────────────
setModalHandlers({ openAddModal, openEditModal, confirmDelete, confirmCancelMembership, openRenewModal, openWAModal, openInvoiceModal, openMemberDetailModal, openClearBalanceModal });
setModalNav(nav);
setPhotoHandler(saveMemberPhoto);
setPlanNav(nav);
setSettingsNav(nav);
setFinanceNav(nav);
setSidebarNav(nav);
setOverviewHandlers({ nav, filterTable });
// Expose nav globally so inline onclick handlers (View Alerts banner) can call it
if (typeof window !== 'undefined') window._navTo = nav;

// ── Main entry point ─────────────────────────────────
export async function renderGymDashboard(router) {
  const root = document.getElementById('root');
  const sessionData = window.__flymSession;

  if (!sessionData || sessionData.role !== 'owner' || !sessionData.gym) {
    root.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:16px;padding:32px;text-align:center;">
      <div style="font-size:40px;">🔒</div>
      <div style="font-size:17px;font-weight:600;color:var(--white);">Access Denied</div>
      <div style="font-size:13px;color:var(--muted);max-width:320px;line-height:1.6;">
        You need to be logged in as a gym owner to access this page.
      </div>
      <button class="btn btn-primary" onclick="location.hash='#login'" style="margin-top:8px;">Go to Login</button>
    </div>`;
    return;
  }

  // Reset state
  S.gym = sessionData.gym;
  S.members = [];
  S.plans = [];
  S.payHistory = [];
  S.addonTemplates = [];
  S.expenses = [];
  S.section = 'overview';

  const gymName = S.gym?.name || 'Your Gym';
  const av = gymName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();

  root.innerHTML = `
    <div id="page-gym" class="app-layout">
      <div id="gym-sidebar"></div>
      <div class="app-main">
        <div class="topbar">
          <button class="hamburger-btn" id="hamburger-btn" aria-label="Menu">
            <span></span><span></span><span></span>
          </button>
          <div class="topbar-title" id="topbar-title">Dashboard</div>
          <div class="topbar-right">
            <div class="topbar-date" id="topbar-date"></div>
            <button class="theme-toggle" id="theme-toggle" title="Toggle theme" aria-label="Toggle theme">
              <svg id="theme-icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
              <svg id="theme-icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            </button>
            <div class="topbar-avatar" title="${gymName}">${av}</div>
            <button id="topbar-logout-btn" title="Sign Out"
              style="background:none;border:1px solid var(--border);color:var(--muted);
                cursor:pointer;border-radius:var(--radius-sm);padding:6px 8px;
                display:none;align-items:center;gap:5px;font-size:11px;
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
  document.getElementById('topbar-date').textContent = new Date().toLocaleDateString('en-IN',
    { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  await loadData().then(() => nav('overview')).catch(() => {});
}

// ── Data loading ─────────────────────────────────────
async function loadData() {
  const gymId = S.gym?.id;
  try {
    if (gymId) {
      const [members, plans, payHistory, addonTemplates] = await Promise.all([
        getMembers(gymId), getPlans(gymId), getPaymentHistory(gymId).catch(() => []),
        getAddonTemplates(gymId).catch(() => [])
      ]);
      S.members        = members        || [];
      S.plans          = plans          || [];
      S.payHistory     = payHistory     || [];
      S.addonTemplates = addonTemplates  || [];
    } else {
      S.plans   = demoPlans();
      S.members = demoMembers();
    }
  } catch (e) {
    console.error('[Flym] loadData error:', e.message);
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

// ── Navigation ───────────────────────────────────────
function nav(id) {
  const c = document.getElementById('gym-content');
  if (!c) return;
  S.section = id;

  // Update topbar title
  const titles = { overview:'Dashboard', members:'All Members', alerts:'Member Alerts',
    finance:'Finance', expenses:'Expenses', plans:'Plan Settings',
    'plans-showcase':'Plans Showcase', gymconfig:'Gym Settings',
    backup:'Data & Backup', contact:'Contact Us' };
  const tb = document.getElementById('topbar-title');
  if (tb) tb.textContent = titles[id] || 'Dashboard';

  // Highlight sidebar
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.id === id));

  ({ overview:renderOverview, members:renderMembers, alerts:renderMemberAlerts,
     finance:renderFinance, expenses:renderExpenses, plans:renderPlans,
     'plans-showcase':renderPlansShowcase, gymconfig:renderGymConfig,
     backup:renderBackup, contact:renderContact }[id] || renderOverview)(c);
}
