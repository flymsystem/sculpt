import { S } from './state.js';
import { signOut, switchGym, getAuthUser, getMyProfile } from '../../lib/auth.js';
import { showToast } from '../../components/toast.js';
import { escHtml, memberStatus } from './helpers.js';
import { hasAccess } from '../../lib/permissions.js';

let _nav, _reloadDashboard;
export function setSidebarNav(fn) { _nav = fn; }
export function setSidebarReload(fn) { _reloadDashboard = fn; }

function bindThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  const sun = document.getElementById('theme-icon-sun');
  const moon = document.getElementById('theme-icon-moon');
  if (!btn || !sun || !moon) return;
  const updateIcon = () => {
    const t = window.__sculptThemeController?.get() || 'dark';
    sun.style.display = t === 'dark' ? 'block' : 'none';
    moon.style.display = t === 'light' ? 'block' : 'none';
  };
  updateIcon();
  btn.addEventListener('click', () => { window.__sculptThemeController?.toggle(); updateIcon(); if (S.section) setTimeout(() => _nav(S.section), 30); });
  window.addEventListener('sculpt:themechange', updateIcon);
}

function buildBranchSwitcher() {
  if (!S.branches || S.branches.length <= 1) return '';
  const current = S.branches.find(b => b.is_selected) || S.branches[0];
  const others = S.branches.filter(b => b.gym_id !== current.gym_id);
  return `<div class="branch-switcher" id="branch-switcher">
    <button class="branch-current" id="branch-current-btn" type="button" aria-haspopup="listbox" aria-expanded="false">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;color:var(--brand-text);"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
      <div style="flex:1;min-width:0;text-align:left;"><div style="font-size:13px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(current.name)}</div>
      ${current.city ? `<div style="font-size:10px;color:var(--text-tertiary);">${escHtml(current.city)}</div>` : ''}</div>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;color:var(--text-quaternary);transition:transform 0.2s;"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="branch-dropdown" id="branch-dropdown" role="listbox" style="display:none;">
      ${others.map(b => `<div class="branch-option" role="option" tabindex="0" data-gym-id="${b.gym_id}">
        <div style="display:flex;align-items:center;gap:8px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;color:var(--text-tertiary);"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          <div><div style="font-size:13px;font-weight:500;color:var(--text-primary);">${escHtml(b.name)}</div>
          ${b.city ? `<div style="font-size:10px;color:var(--text-tertiary);">${escHtml(b.city)}</div>` : ''}</div>
        </div>
        ${!b.is_active ? `<span style="font-size:9px;color:var(--red);margin-top:2px;display:block;padding-left:22px;">Inactive</span>` : ''}
      </div>`).join('')}
    </div>
  </div>`;
}


function getAlertCount() {
  return S.members.filter(m => { const st = memberStatus(m); return st === 'Expired' || st === 'Expiring' || st === 'Due'; }).length;
}

/**
 * Check if a nav item should be visible based on role + tier.
 * @param {string} sectionId - nav item data-id
 * @returns {boolean}
 */
function isNavVisible(sectionId) {
  const role = S.role || 'owner';

  // Permission check (role-based)
  const permMap = {
    overview:        'dashboard',
    members:         'members',
    enquiries:       'leads',
    alerts:          'members',
    staff:           'staff_management',
    finance:         'finance',
    expenses:        'expenses',
    'plans-showcase':'plans_showcase',
    plans:           'plans',
    gymconfig:       'settings',
    backup:          'backup',
    analytics:       'analytics',
    'checkin-display': 'attendance',
    'checkin-scan':    'attendance',
  };

  const perm = permMap[sectionId];
  if (perm && !hasAccess(role, perm)) return false;

  // Plan Settings requires full plan access (not just 'view')
  if (sectionId === 'plans') {
    const { can } = require_can();
    if (can(role, 'plans') !== 'full' && can(role, 'plans') !== true) return false;
  }


  return true;
}

// Inline import to avoid circular deps
function require_can() {
  // can() from permissions.js — imported at top
  const { can: canFn } = { can: (role, action) => {
    // Inline check for plans: owner=full, staff=view
    if (action === 'plans') return role === 'owner' ? 'full' : 'view';
    return true;
  }};
  return { can: canFn };
}

function buildSidebar(gymName, gymCode, logoUrl) {
  const navIco = (name) => {
    const icons = {
      grid:`<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
      users:`<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
      card:`<svg viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`,
      clock:`<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
      finance:`<svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
      check:`<svg viewBox="0 0 24 24"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
      cog:`<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
      lock:`<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
      bell:`<svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
      clipboard:`<svg viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>`,
      staff:`<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`,
      expense:`<svg viewBox="0 0 24 24"><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/><path d="M12 2L2 7l10 5 10-5L12 2z"/></svg>`,
      logout:`<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
      chart:`<svg viewBox="0 0 24 24"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>`,
    };
    return `<span class="nav-icon">${icons[name]||''}</span>`;
  };
  const alertCount = getAlertCount();
  const alertBadge = alertCount > 0 ? `<span class="nav-badge">${alertCount > 99 ? '99+' : alertCount}</span>` : '';

  const roleBadge = S.role === 'staff'
    ? `<span class="sidebar-badge" style="background:var(--blue-glow2);color:var(--blue-light);border-color:rgba(42,143,255,0.25);">STAFF</span>`
    : `<span class="sidebar-badge">GYM OWNER</span>`;


  // Build nav items conditionally based on role
  const navItems = [];

  // Overview — always visible
  navItems.push(`<div class="nav-section-label">Overview</div>`);
  navItems.push(`<div class="nav-item active" data-id="overview" role="button" tabindex="0">${navIco('grid')}Dashboard</div>`);

  // Members section
  if (isNavVisible('members') || isNavVisible('enquiries') || isNavVisible('alerts')) {
    navItems.push(`<div class="nav-section-label">Members</div>`);
    if (isNavVisible('members'))   navItems.push(`<div class="nav-item" data-id="members" role="button" tabindex="0">${navIco('users')}All Members</div>`);
    if (isNavVisible('enquiries')) navItems.push(`<div class="nav-item" data-id="enquiries" role="button" tabindex="0">${navIco('clipboard')}Enquiries</div>`);
    if (isNavVisible('alerts'))    navItems.push(`<div class="nav-item" data-id="alerts" role="button" tabindex="0">${navIco('clock')}Member Alerts${alertBadge}</div>`);
  }

  // Operations section
  const opsVisible = ['staff','finance','expenses'].filter(isNavVisible);
  if (opsVisible.length > 0) {
    navItems.push(`<div class="nav-section-label">Operations</div>`);
    if (isNavVisible('staff'))     navItems.push(`<div class="nav-item" data-id="staff" role="button" tabindex="0">${navIco('staff')}Staff</div>`);
    if (isNavVisible('finance'))   navItems.push(`<div class="nav-item" data-id="finance" role="button" tabindex="0">${navIco('finance')}Finance</div>`);
    if (isNavVisible('expenses'))  navItems.push(`<div class="nav-item" data-id="expenses" role="button" tabindex="0">${navIco('expense')}Expenses</div>`);
  }

  // Check-in section
  const checkinVisible = ['checkin-scan','checkin-display'].filter(isNavVisible);
  if (checkinVisible.length > 0) {
    navItems.push(`<div class="nav-section-label">Check-in</div>`);
    if (isNavVisible('checkin-scan'))    navItems.push(`<div class="nav-item" data-id="checkin-scan" role="button" tabindex="0">${navIco('check')}Check In</div>`);
    if (isNavVisible('checkin-display')) navItems.push(`<div class="nav-item" data-id="checkin-display" role="button" tabindex="0">${navIco('grid')}Desk Display</div>`);
  }

  // Showcase section
  if (isNavVisible('plans-showcase')) {
    navItems.push(`<div class="nav-section-label">Showcase</div>`);
    navItems.push(`<div class="nav-item" data-id="plans-showcase" role="button" tabindex="0">${navIco('check')}Plans</div>`);
  }

  // Analytics (Pro-only)
  if (isNavVisible('analytics')) {
    navItems.push(`<div class="nav-section-label">Insights</div>`);
    navItems.push(`<div class="nav-item" data-id="analytics" role="button" tabindex="0">${navIco('chart')}Analytics</div>`);
  }

  // Settings section (owner only)
  const settingsVisible = ['plans','gymconfig','backup'].filter(isNavVisible);
  if (settingsVisible.length > 0) {
    navItems.push(`<div class="nav-section-label">Settings</div>`);
    if (isNavVisible('plans'))     navItems.push(`<div class="nav-item" data-id="plans" role="button" tabindex="0">${navIco('check')}Plan Settings</div>`);
    if (isNavVisible('gymconfig')) navItems.push(`<div class="nav-item" data-id="gymconfig" role="button" tabindex="0">${navIco('cog')}Gym Settings</div>`);
    if (isNavVisible('backup'))    navItems.push(`<div class="nav-item" data-id="backup" role="button" tabindex="0">${navIco('lock')}Data &amp; Backup</div>`);
  }

  // Support — always visible
  navItems.push(`<div class="nav-section-label">Support</div>`);

  return `<div class="sidebar" role="navigation" aria-label="Main navigation">
    <div class="sidebar-logo">
      <!-- The badge carries the wordmark itself; at 40px the arced
           lettering was unreadable and it read as an app icon rather than
           the brand. logo-128 is the bare mark on transparency — the
           icon-*.png assets carry an opaque plate for the PWA and would
           show as a black square against the sidebar. Only shown when the
           gym hasn't uploaded its own branding in Gym Settings — otherwise
           this default mark duplicates the branded logo below it. -->
      ${!logoUrl ? `<img src="/logo-128.png" alt="D Sculpt Fitness" width="56" height="56"
        style="display:block;">` : ''}
    </div>
    <div class="sidebar-identity">
      ${logoUrl ? `<img src="${escHtml(logoUrl)}" alt="" style="max-width:220px;max-height:88px;width:auto;height:auto;object-fit:contain;object-position:left center;margin-bottom:10px;display:block;">` : ''}
      <div class="sidebar-identity-label">Active Gym</div>
      <div class="sidebar-identity-name">${escHtml(gymName)}</div>
      ${gymCode ? `<div class="sidebar-identity-code">${escHtml(gymCode)}</div>` : ''}
      <div class="sidebar-badges">${roleBadge}</div>
    </div>
    ${buildBranchSwitcher()}
    <nav class="sidebar-nav" aria-label="Sections">
      ${navItems.join('\n      ')}
    </nav>
    <div class="sidebar-footer">
      <button class="sidebar-logout" id="sidebar-logout" type="button">${navIco('logout')} Sign Out</button>
    </div>
  </div>`;
}

function bindSidebar(router) {
  document.querySelectorAll('#gym-sidebar .nav-item').forEach(item => {
    const activate = () => { _nav(item.dataset.id); closeMobileSidebar(); };
    item.addEventListener('click', activate);
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
  });
  const doLogout = async () => { await signOut().catch(() => {}); window.__sculptSession = null; router.go('landing'); };
  document.getElementById('sidebar-logout')?.addEventListener('click', doLogout);
  document.getElementById('topbar-logout-btn')?.addEventListener('click', doLogout);

  // Branch switcher
  const branchBtn = document.getElementById('branch-current-btn');
  const branchDrop = document.getElementById('branch-dropdown');
  if (branchBtn && branchDrop) {
    const toggle = () => { const isOpen = branchDrop.style.display !== 'none'; branchDrop.style.display = isOpen ? 'none' : 'block'; branchBtn.setAttribute('aria-expanded', String(!isOpen)); const arrow = branchBtn.querySelector('svg:last-child'); if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(180deg)'; };
    branchBtn.addEventListener('click', toggle);
    document.addEventListener('click', (e) => { if (!branchBtn.contains(e.target) && !branchDrop.contains(e.target)) { branchDrop.style.display = 'none'; branchBtn.setAttribute('aria-expanded', 'false'); } });
    document.querySelectorAll('.branch-option').forEach(opt => {
      const pick = async () => {
        const gymId = opt.dataset.gymId; branchDrop.style.display = 'none';
        showToast('Switching branch...', 'blue');
        try { await switchGym(gymId); const user = await getAuthUser(); if (user) { const profile = await getMyProfile(user.id); window.__sculptSession = { role: profile.role, gym: profile.gym, branches: profile.branches, staffRecord: profile.staffRecord || null }; if (_reloadDashboard) _reloadDashboard(router); else location.reload(); } } catch (err) { showToast(err.message || 'Switch failed', 'red'); }
      };
      opt.addEventListener('click', pick);
      opt.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
  }

  // Mobile hamburger
  const hamburger = document.getElementById('hamburger-btn');
  const overlay = document.getElementById('sidebar-overlay');
  const sidebar = document.querySelector('#gym-sidebar .sidebar');
  hamburger?.addEventListener('click', () => { const open = sidebar?.classList.toggle('sidebar-open'); overlay?.classList.toggle('active', open); hamburger.classList.toggle('open', open); });
  overlay?.addEventListener('click', closeMobileSidebar);

  // Swipe gestures
  if (window.__sculptTouchStart) document.removeEventListener('touchstart', window.__sculptTouchStart);
  if (window.__sculptTouchEnd) document.removeEventListener('touchend', window.__sculptTouchEnd);
  let _tsX = 0, _tsY = 0, _blocked = false;
  const isModalOpen = () => !!document.getElementById('sculpt-modal-overlay');
  const startedInHScroller = (target) => { let el = target; while (el && el !== document.body) { const style = getComputedStyle(el); if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && el.scrollWidth > el.clientWidth) return true; el = el.parentElement; } return false; };
  window.__sculptTouchStart = (e) => { if (!e.touches?.[0]) return; _tsX = e.touches[0].clientX; _tsY = e.touches[0].clientY; _blocked = isModalOpen() || startedInHScroller(e.target); };
  window.__sculptTouchEnd = (e) => { if (_blocked || isModalOpen() || !e.changedTouches?.[0]) return; const dx = e.changedTouches[0].clientX - _tsX; const dy = Math.abs(e.changedTouches[0].clientY - _tsY); const isSidebarOpen = sidebar?.classList.contains('sidebar-open'); if (Math.abs(dx) < 40 || dy > Math.abs(dx)) return; if (dx > 60 && _tsX < 30 && !isSidebarOpen) { sidebar?.classList.add('sidebar-open'); overlay?.classList.add('active'); hamburger?.classList.add('open'); } else if (dx < -60 && isSidebarOpen) closeMobileSidebar(); };
  document.addEventListener('touchstart', window.__sculptTouchStart, { passive: true });
  document.addEventListener('touchend', window.__sculptTouchEnd, { passive: true });
  if (typeof window.__sculptRegisterCleanup === 'function') {
    window.__sculptRegisterCleanup(() => { if (window.__sculptTouchStart) document.removeEventListener('touchstart', window.__sculptTouchStart); if (window.__sculptTouchEnd) document.removeEventListener('touchend', window.__sculptTouchEnd); delete window.__sculptTouchStart; delete window.__sculptTouchEnd; });
  }
}

function closeMobileSidebar() {
  document.querySelector('#gym-sidebar .sidebar')?.classList.remove('sidebar-open');
  document.getElementById('sidebar-overlay')?.classList.remove('active');
  const h = document.getElementById('hamburger-btn'); if (h) { h.classList.remove('open'); h.setAttribute('aria-expanded', 'false'); }
}

export { bindThemeToggle, buildSidebar, bindSidebar, closeMobileSidebar };