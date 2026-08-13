import { S } from './state.js';
import { signOut } from '../../lib/auth.js';

let _nav;
export function setSidebarNav(fn) { _nav = fn; }

function bindThemeToggle() {
  const btn  = document.getElementById('theme-toggle');
  const sun  = document.getElementById('theme-icon-sun');
  const moon = document.getElementById('theme-icon-moon');
  if (!btn || !sun || !moon) return;

  const updateIcon = () => {
    const t = window.__flymThemeController?.get() || 'dark';
    // Show the icon for what clicking will switch TO
    sun.style.display  = t === 'dark'  ? 'block' : 'none';
    moon.style.display = t === 'light' ? 'block' : 'none';
  };
  updateIcon();

  btn.addEventListener('click', () => {
    window.__flymThemeController?.toggle();
    updateIcon();
    // Re-render current section so any inline-styled charts pick up new colors
    if (S.section) setTimeout(() => _nav(S.section), 30);
  });

  // React to theme changes from other tabs
  window.addEventListener('flym:themechange', updateIcon);
}



function buildSidebar(gymName, gymCode, logoUrl) {
  const navIco = (name) => {
    const icons = {
      grid:    `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
      users:   `<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
      card:    `<svg viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`,
      clock:   `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
      finance: `<svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
      check:   `<svg viewBox="0 0 24 24"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
      cog:     `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
      lock:    `<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
      bell:    `<svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
      logout:  `<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
    };
    return `<span class="nav-icon">${icons[name]||''}</span>`;
  };

  return `<div class="sidebar">
    <div class="sidebar-logo">
      <span class="sidebar-logo-text">flym</span>
    </div>
    <div class="sidebar-identity">
      ${logoUrl ? `<img src="${logoUrl}" alt="" style="max-width:180px;max-height:60px;width:auto;height:auto;object-fit:contain;object-position:left center;margin-bottom:10px;display:block;">` : ''}
      <div class="sidebar-identity-label">Active Gym</div>
      <div class="sidebar-identity-name">${gymName}</div>
      ${gymCode ? `<div class="sidebar-identity-code">${gymCode}</div>` : ''}
      <span class="sidebar-badge">GYM OWNER</span>
    </div>
    <nav class="sidebar-nav">
      <div class="nav-section-label">Overview</div>
      <div class="nav-item active" data-id="overview">${navIco('grid')}Dashboard</div>

      <div class="nav-section-label">Members</div>
      <div class="nav-item" data-id="members">${navIco('users')}All Members</div>
      <div class="nav-item" data-id="alerts">${navIco('clock')}Member Alerts</div>

      <div class="nav-section-label">Finance</div>
      <div class="nav-item" data-id="finance">${navIco('finance')}Finance</div>
      <div class="nav-item" data-id="expenses">${navIco('finance')}Expenses</div>

      <div class="nav-section-label">Showcase</div>
      <div class="nav-item" data-id="plans-showcase">${navIco('check')}Plans</div>

      <div class="nav-section-label">Settings</div>
      <div class="nav-item" data-id="plans">${navIco('check')}Plan Settings</div>
      <div class="nav-item" data-id="gymconfig">${navIco('cog')}Gym Settings</div>
      <div class="nav-item" data-id="backup">${navIco('lock')}Data &amp; Backup</div>

      <div class="nav-section-label">Support</div>
      <div class="nav-item" data-id="contact">${navIco('bell')}Contact Us</div>
    </nav>
    <div class="sidebar-footer">
      <button class="sidebar-logout" id="sidebar-logout">
        ${navIco('logout')} Sign Out
      </button>
    </div>
  </div>`;
}

function bindSidebar(router) {
  document.querySelectorAll('#gym-sidebar .nav-item').forEach(item =>
    item.addEventListener('click', () => {
      _nav(item.dataset.id);
      closeMobileSidebar();
    }));
  const doLogout = async () => {
    await signOut().catch(()=>{});
    window.__flymSession = null;
    router.go('landing');
  };
  document.getElementById('sidebar-logout')?.addEventListener('click', doLogout);
  document.getElementById('topbar-logout-btn')?.addEventListener('click', doLogout);

  // Mobile hamburger
  const hamburger = document.getElementById('hamburger-btn');
  const overlay   = document.getElementById('sidebar-overlay');
  const sidebar   = document.querySelector('#gym-sidebar .sidebar');

  hamburger?.addEventListener('click', () => {
    const open = sidebar?.classList.toggle('sidebar-open');
    overlay?.classList.toggle('active', open);
    hamburger.classList.toggle('open', open);
  });
  overlay?.addEventListener('click', closeMobileSidebar);

  // Swipe gestures for sidebar on mobile
  // Use named functions stored on window so we can remove them on re-render
  if (window.__flymTouchStart) document.removeEventListener('touchstart', window.__flymTouchStart);
  if (window.__flymTouchEnd)   document.removeEventListener('touchend',   window.__flymTouchEnd);

  let _touchStartX = 0;
  let _touchStartY = 0;

  window.__flymTouchStart = (e) => {
    _touchStartX = e.touches[0].clientX;
    _touchStartY = e.touches[0].clientY;
  };

  window.__flymTouchEnd = (e) => {
    const dx = e.changedTouches[0].clientX - _touchStartX;
    const dy = Math.abs(e.changedTouches[0].clientY - _touchStartY);
    const isSidebarOpen = sidebar?.classList.contains('sidebar-open');

    // Only handle horizontal swipes (dx much larger than dy)
    if (Math.abs(dx) < 40 || dy > Math.abs(dx)) return;

    if (dx > 60 && _touchStartX < 30 && !isSidebarOpen) {
      // Swipe right from left edge → open sidebar
      sidebar?.classList.add('sidebar-open');
      overlay?.classList.add('active');
      hamburger?.classList.add('open');
    } else if (dx < -60 && isSidebarOpen) {
      // Swipe left → close sidebar
      closeMobileSidebar();
    }
  };

  document.addEventListener('touchstart', window.__flymTouchStart, { passive: true });
  document.addEventListener('touchend',   window.__flymTouchEnd,   { passive: true });
}

function closeMobileSidebar() {
  document.querySelector('#gym-sidebar .sidebar')?.classList.remove('sidebar-open');
  document.getElementById('sidebar-overlay')?.classList.remove('active');
  document.getElementById('hamburger-btn')?.classList.remove('open');
}


export { bindThemeToggle, buildSidebar, bindSidebar, closeMobileSidebar };
