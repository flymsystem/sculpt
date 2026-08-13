// src/components/sidebar.js
// ─────────────────────────────────────────────────────────────────
// Shared sidebar for gym dashboard and admin panel
// ─────────────────────────────────────────────────────────────────

import { signOut } from '../lib/auth.js';

const GYM_NAV = [
  { id: 'overview',  label: 'Dashboard',       section: 'Overview',  icon: iconGrid() },
  { id: 'members',   label: 'All Members',      section: 'Members',   icon: iconUsers() },
  { id: 'payments',  label: 'Payment Tracker',  section: 'Members',   icon: iconCard() },
  { id: 'expiry',    label: 'Expiry Alerts',    section: 'Members',   icon: iconClock() },
  { id: 'plans',     label: 'Plan Settings',    section: 'Settings',  icon: iconCheck() },
  { id: 'gymconfig', label: 'Gym Settings',     section: 'Settings',  icon: iconSettings() },
];

const ADMIN_NAV = [
  { id: 'a-overview',     label: 'Overview',        section: 'Admin',   icon: iconGrid() },
  { id: 'a-gyms',         label: 'Gyms',            section: 'Admin',   icon: iconHome() },
  { id: 'a-credentials',  label: 'Credentials',     section: 'Admin',   icon: iconLock() },
  { id: 'a-activity',     label: 'Activity Log',    section: 'Admin',   icon: iconActivity() },
];

export function renderSidebar(container, { role, gymName, gymCode, onNavigate, router }) {
  const isAdmin = role === 'admin';
  const navItems = isAdmin ? ADMIN_NAV : GYM_NAV;

  container.innerHTML = `
    <div class="sidebar">
      <!-- Logo -->
      <div class="sidebar-logo">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 380" width="100" height="auto">
          <path d="M 112 178 Q 312 85 556 138" fill="none" stroke="#1A6FD4" stroke-width="1.5" opacity="0.7" stroke-linecap="round"/>
          <path d="M 124 188 Q 314 100 552 148" fill="none" stroke="#2A8FFF" stroke-width="2.8" stroke-linecap="round"/>
          <circle cx="552" cy="148" r="7" fill="#2A8FFF"/>
          <circle cx="552" cy="148" r="3" fill="#E6F4FF"/>
          <text x="100" y="290" font-family="'Helvetica Neue',sans-serif" font-size="148" font-weight="200" fill="#FFFFFF" letter-spacing="-4">flym</text>
          <rect x="100" y="310" width="${isAdmin ? 300 : 520}" height="2" rx="1" fill="${isAdmin ? '#FFB020' : '#2A8FFF'}" opacity="0.8"/>
        </svg>
      </div>

      <!-- Identity -->
      <div class="sidebar-identity">
        <div class="sidebar-identity-label">${isAdmin ? 'Logged in as' : 'Active Gym'}</div>
        <div class="sidebar-identity-name" id="sidebar-name">${isAdmin ? 'Flym Admin' : (gymName || 'Your Gym')}</div>
        ${gymCode ? `<div class="sidebar-identity-code">${gymCode}</div>` : ''}
        <span class="sidebar-badge ${isAdmin ? 'sidebar-badge-admin' : ''}">${isAdmin ? 'SUPERADMIN' : 'GYM OWNER'}</span>
      </div>

      <!-- Navigation -->
      <nav class="sidebar-nav" id="sidebar-nav">
        ${buildNavHTML(navItems)}
      </nav>

      <!-- Footer -->
      <div class="sidebar-footer">
        <button class="sidebar-logout" id="sidebar-logout">
          ${iconLogout()}
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  `;

  // Nav click handlers
  container.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      container.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      onNavigate(id);
    });
  });

  // Logout — always bind via container.querySelector (container is a DOM element, not document)
  container.querySelector('#sidebar-logout')?.addEventListener('click', async () => {
    await signOut();
    router.go('landing');
  });

  // Return method to programmatically set active
  return {
    setActive(id) {
      container.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      const el = container.querySelector(`[data-id="${id}"]`);
      if (el) el.classList.add('active');
    }
  };
}

function buildNavHTML(items) {
  let html = '';
  let lastSection = null;
  items.forEach(item => {
    if (item.section !== lastSection) {
      html += `<div class="nav-section-label">${item.section}</div>`;
      lastSection = item.section;
    }
    html += `
      <div class="nav-item" data-id="${item.id}">
        <span class="nav-icon">${item.icon}</span>
        <span>${item.label}</span>
      </div>
    `;
  });
  return html;
}

// SVG icons
function iconGrid()     { return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`; }
function iconUsers()    { return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`; }
function iconCard()     { return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`; }
function iconClock()    { return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`; }
function iconCheck()    { return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`; }
function iconSettings() { return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>`; }
function iconHome()     { return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`; }
function iconLock()     { return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`; }
function iconActivity() { return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`; }
function iconLogout()   { return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`; }
